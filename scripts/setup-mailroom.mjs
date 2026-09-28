import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import process from 'node:process';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const envPath=join(root,'.env.local');
const binDir=join(root,'bin');
const tunnelBin=join(binDir,'tunnel-client');

function parseEnv(text=''){
  const map=new Map();
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    if(!line || line.startsWith('#') || !line.includes('=')) continue;
    const i=line.indexOf('=');
    map.set(line.slice(0,i).trim(),line.slice(i+1));
  }
  return map;
}

function serialize(map){
  const preferred=[
    'SCOUT_MAILROOM_MODE',
    'CHATGPT_AGENT_TRIGGER_ID',
    'CHATGPT_WORKSPACE_AGENT_TOKEN',
    'SCOUT_TUNNEL_PROFILE',
    'SCOUT_TUNNEL_ID',
    'CONTROL_PLANE_API_KEY'
  ];
  const lines=[
    '# Scout Lab private local configuration. Do not commit this file.',
    '# Mailroom: dashboard -> Workspace Agent -> connected Gmail -> Scout Lab MCP -> SQLite'
  ];
  for(const key of preferred) if(map.get(key)) lines.push(key+'='+map.get(key));
  for(const [key,value] of map) if(!preferred.includes(key)) lines.push(key+'='+value);
  return lines.join('\n')+'\n';
}

function mask(v=''){
  const s=String(v);
  if(!s) return '';
  return s.length<10?'[set]':s.slice(0,5)+'…'+s.slice(-4);
}

async function ask(rl,label,current='',validate=()=>true,help='Value is required.'){
  while(true){
    const suffix=current?' [current '+mask(current)+' — Enter to keep]':'';
    const answer=(await rl.question(label+suffix+': ')).trim();
    const value=answer||current;
    if(value && validate(value)) return value;
    console.log(help);
  }
}

async function installTunnelClient(){
  if(existsSync(tunnelBin)) return tunnelBin;

  if(os.platform()!=='darwin') throw new Error('Automatic tunnel-client installation currently supports macOS only.');
  const raw=os.arch();
  const arch=raw==='arm64'?'arm64':raw==='x64'?'amd64':null;
  if(!arch) throw new Error('Unsupported Mac architecture: '+raw);

  console.log('\nDownloading the latest official OpenAI tunnel-client...');
  const releaseRes=await fetch('https://api.github.com/repos/openai/tunnel-client/releases/latest',{
    headers:{accept:'application/vnd.github+json','user-agent':'scout-lab'}
  });
  if(!releaseRes.ok) throw new Error('Could not look up tunnel-client release ('+releaseRes.status+').');
  const release=await releaseRes.json();
  const name='tunnel-client-'+release.tag_name+'-darwin-'+arch+'.zip';
  const asset=(release.assets||[]).find(x=>x.name===name);
  if(!asset?.browser_download_url) throw new Error('Could not find '+name+' in the latest tunnel-client release.');

  await mkdir(binDir,{recursive:true});
  const zip=join(binDir,'tunnel-client.zip');
  const dl=await fetch(asset.browser_download_url,{redirect:'follow',headers:{'user-agent':'scout-lab'}});
  if(!dl.ok) throw new Error('Could not download tunnel-client ('+dl.status+').');
  await writeFile(zip,Buffer.from(await dl.arrayBuffer()));
  execFileSync('/usr/bin/unzip',['-o',zip,'-d',binDir],{stdio:'inherit'});

  if(!existsSync(tunnelBin)){
    const found=[
      join(binDir,'tunnel-client-'+release.tag_name+'-darwin-'+arch),
      join(binDir,'tunnel-client')
    ].find(existsSync);
    if(!found) throw new Error('Downloaded tunnel-client but could not locate the binary.');
    if(found!==tunnelBin) execFileSync('/bin/mv',[found,tunnelBin],{stdio:'inherit'});
  }

  await chmod(tunnelBin,0o755);
  try{ execFileSync('/usr/bin/xattr',['-d','com.apple.quarantine',tunnelBin],{stdio:'ignore'}); }catch(_){}
  return tunnelBin;
}

async function waitForNode(proc,timeoutMs=12000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    try{
      const r=await fetch('http://127.0.0.1:3100/healthz');
      if(r.ok) return;
    }catch(_){}
    if(proc.exitCode!=null) throw new Error('Scout Lab exited during the connection test.');
    await new Promise(r=>setTimeout(r,300));
  }
  throw new Error('Scout Lab did not become ready on http://127.0.0.1:3100.');
}

const values=parseEnv(existsSync(envPath)?await readFile(envPath,'utf8'):'');
const rl=readline.createInterface({input:process.stdin,output:process.stdout});

console.log('\nScout Lab Mailroom — one-time direct ChatGPT connection');
console.log('This wires ChatGPT directly to the local Scout Lab MCP server through OpenAI Secure MCP Tunnel.\n');

const trigger=await ask(
  rl,
  'Workspace Agent API trigger ID (agtch_...)',
  values.get('CHATGPT_AGENT_TRIGGER_ID')||'',
  v=>/^agtch_[A-Za-z0-9_-]+$/.test(v),
  'The API channel trigger ID must start with agtch_.'
);

const workspaceToken=await ask(
  rl,
  'Workspace Agent access token',
  values.get('CHATGPT_WORKSPACE_AGENT_TOKEN')||'',
  v=>v.length>=12,
  'Create this in ChatGPT Admin > Access tokens with the Workspace Agents scope.'
);

const tunnelId=await ask(
  rl,
  'OpenAI Secure MCP Tunnel ID (tunnel_...)',
  values.get('SCOUT_TUNNEL_ID')||'',
  v=>/^tunnel_[A-Za-z0-9_-]+$/.test(v),
  'The tunnel ID must start with tunnel_.'
);

const runtimeKey=await ask(
  rl,
  'OpenAI Platform runtime API key for tunnel-client (sk-...)',
  values.get('CONTROL_PLANE_API_KEY')||'',
  v=>/^sk-/.test(v),
  'Use the runtime API key created for the Secure MCP Tunnel.'
);

const currentProfile=values.get('SCOUT_TUNNEL_PROFILE')||'scout-lab';
const profile=(await rl.question('Tunnel profile ['+currentProfile+']: ')).trim()||currentProfile;

values.set('SCOUT_MAILROOM_MODE','workspace_agent_direct_publish');
values.set('CHATGPT_AGENT_TRIGGER_ID',trigger);
values.set('CHATGPT_WORKSPACE_AGENT_TOKEN',workspaceToken);
values.set('SCOUT_TUNNEL_PROFILE',profile);
values.set('SCOUT_TUNNEL_ID',tunnelId);
values.set('CONTROL_PLANE_API_KEY',runtimeKey);
await writeFile(envPath,serialize(values),{mode:0o600});
rl.close();

const client=await installTunnelClient();
const tunnelEnv={...process.env,CONTROL_PLANE_API_KEY:runtimeKey};

console.log('\nConfiguring Secure MCP Tunnel profile "'+profile+'"...');
execFileSync(client,[
  'init',
  '--force',
  '--sample','sample_mcp_remote_no_auth',
  '--profile',profile,
  '--tunnel-id',tunnelId,
  '--mcp-server-url','http://127.0.0.1:3100/mcp'
],{stdio:'inherit',env:tunnelEnv,cwd:root});

console.log('\nTesting Scout Lab MCP + tunnel...');
const node=spawn(process.execPath,['--env-file-if-exists=.env.local','src/node-server.mjs'],{
  cwd:root,
  env:{...process.env,...Object.fromEntries(values)},
  stdio:['ignore','pipe','pipe']
});
node.stdout?.on('data',d=>process.stdout.write(d));
node.stderr?.on('data',d=>process.stderr.write(d));

try{
  await waitForNode(node);
  execFileSync(client,['doctor','--profile',profile,'--explain'],{stdio:'inherit',env:tunnelEnv,cwd:root});
}finally{
  if(node.exitCode==null) node.kill('SIGTERM');
}

console.log('\nConnection profile is ready.');
console.log('Final ChatGPT-side step: create a Developer Mode app using Connection = Tunnel, select this tunnel, and enable publish_mailroom_snapshot for the Scout Lab Mailroom Workspace Agent.');
console.log('After that, normal use is only: npm start');
