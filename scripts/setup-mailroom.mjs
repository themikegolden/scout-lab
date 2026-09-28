import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const envPath = join(root, '.env.local');
const binDir = join(root, 'bin');
const tunnelBin = join(binDir, 'tunnel-client');

function parseEnv(text='') {
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i=line.indexOf('=');
    map.set(line.slice(0,i).trim(), line.slice(i+1));
  }
  return map;
}

function serialize(map) {
  const preferred = [
    'SCOUT_MAILROOM_MODE',
    'CHATGPT_AGENT_TRIGGER_ID',
    'CHATGPT_WORKSPACE_AGENT_TOKEN',
    'SCOUT_TUNNEL_PROFILE',
    'SCOUT_TUNNEL_ID',
    'CONTROL_PLANE_API_KEY'
  ];
  const lines = [
    '# Scout Lab private local configuration. Do not commit this file.',
    '# Created by npm run setup:mailroom.'
  ];
  for (const key of preferred) if (map.get(key)) lines.push(`${key}=${map.get(key)}`);
  for (const [key,value] of map) if (!preferred.includes(key)) lines.push(`${key}=${value}`);
  return lines.join('\n')+'\n';
}

function mask(v='') {
  const s=String(v);
  return s.length < 10 ? '[set]' : `${s.slice(0,5)}…${s.slice(-4)}`;
}

async function promptRequired(rl, label, current='', validate=()=>true, hint='') {
  while (true) {
    const suffix = current ? ` [current ${mask(current)} — Enter to keep]` : '';
    const answer=(await rl.question(`${label}${suffix}: `)).trim();
    const value=answer || current;
    if (value && validate(value)) return value;
    console.log(hint || `${label} is required.`);
  }
}

async function installTunnelClient() {
  if (existsSync(tunnelBin)) return tunnelBin;

  const platform=os.platform();
  if (platform !== 'darwin') throw new Error('Automatic tunnel-client installation currently supports macOS only.');

  const archRaw=os.arch();
  const arch=archRaw === 'arm64' ? 'arm64' : archRaw === 'x64' ? 'amd64' : null;
  if (!arch) throw new Error(`Unsupported Mac architecture: ${archRaw}`);

  console.log('\nScout Lab: downloading the latest official OpenAI tunnel-client…');
  const releaseRes=await fetch('https://api.github.com/repos/openai/tunnel-client/releases/latest', {
    headers:{'accept':'application/vnd.github+json','user-agent':'scout-lab-mailroom-setup'}
  });
  if (!releaseRes.ok) throw new Error(`Could not look up tunnel-client release (${releaseRes.status}).`);
  const release=await releaseRes.json();
  const expected=`tunnel-client-${release.tag_name}-darwin-${arch}.zip`;
  const asset=(release.assets || []).find((x)=>x.name===expected);
  if (!asset?.browser_download_url) throw new Error(`Could not find ${expected} in the latest release.`);

  await mkdir(binDir,{recursive:true});
  const zipPath=join(binDir,'tunnel-client.zip');
  const zipRes=await fetch(asset.browser_download_url,{redirect:'follow',headers:{'user-agent':'scout-lab-mailroom-setup'}});
  if(!zipRes.ok) throw new Error(`Could not download tunnel-client (${zipRes.status}).`);
  await writeFile(zipPath, Buffer.from(await zipRes.arrayBuffer()));

  execFileSync('/usr/bin/unzip',['-o',zipPath,'-d',binDir],{stdio:'inherit'});
  let found=tunnelBin;
  if(!existsSync(found)) {
    const candidates=[
      join(binDir,`tunnel-client-${release.tag_name}-darwin-${arch}`),
      join(binDir,'tunnel-client')
    ];
    found=candidates.find(existsSync);
  }
  if(!found || !existsSync(found)) throw new Error('Downloaded tunnel-client but could not locate the binary.');
  if(found!==tunnelBin) execFileSync('/bin/mv',[found,tunnelBin],{stdio:'inherit'});
  await chmod(tunnelBin,0o755);
  try { execFileSync('/usr/bin/xattr',['-d','com.apple.quarantine',tunnelBin],{stdio:'ignore'}); } catch (_) {}
  execFileSync(tunnelBin,['--version'],{stdio:'inherit'});
  return tunnelBin;
}

async function waitForPort(proc, timeoutMs=12000) {
  const start=Date.now();
  while(Date.now()-start<timeoutMs) {
    try {
      const r=await fetch('http://127.0.0.1:3100/healthz');
      if(r.ok) return;
    } catch (_) {}
    if(proc.exitCode != null) throw new Error('Scout Lab exited before the setup health check completed.');
    await new Promise(r=>setTimeout(r,350));
  }
  throw new Error('Scout Lab did not become ready on http://127.0.0.1:3100.');
}

const existing = existsSync(envPath) ? await readFile(envPath,'utf8') : '';
const values = parseEnv(existing);
const rl = readline.createInterface({ input:process.stdin, output:process.stdout });

console.log('\nScout Lab Mailroom — one-time ChatGPT backend setup');
console.log('This keeps credentials only in .env.local on this Mac. Nothing here is committed to GitHub.\n');

const trigger=await promptRequired(
  rl,
  'Workspace Agent API trigger ID (agtch_...)',
  values.get('CHATGPT_AGENT_TRIGGER_ID') || '',
  (v)=>/^agtch_[A-Za-z0-9_-]+$/.test(v),
  'The trigger ID should start with agtch_.'
);

const agentToken=await promptRequired(
  rl,
  'Workspace Agent access token',
  values.get('CHATGPT_WORKSPACE_AGENT_TOKEN') || '',
  (v)=>v.length>=12,
  'Paste the Workspace Agent access token created in ChatGPT Admin > Access tokens.'
);

const tunnelId=await promptRequired(
  rl,
  'Secure MCP Tunnel ID (tunnel_...)',
  values.get('SCOUT_TUNNEL_ID') || '',
  (v)=>/^tunnel_[A-Za-z0-9_-]+$/.test(v),
  'The tunnel ID should start with tunnel_.'
);

const controlKey=await promptRequired(
  rl,
  'OpenAI Platform runtime API key for tunnel-client (sk-...)',
  values.get('CONTROL_PLANE_API_KEY') || '',
  (v)=>/^sk-/.test(v),
  'Paste the OpenAI Platform API key created for the Secure MCP Tunnel runtime.'
);

const currentProfile=values.get('SCOUT_TUNNEL_PROFILE') || 'scout-lab';
const profile=(await rl.question(`Tunnel profile [${currentProfile}]: `)).trim() || currentProfile;

values.set('SCOUT_MAILROOM_MODE','workspace_agent');
values.set('CHATGPT_AGENT_TRIGGER_ID',trigger);
values.set('CHATGPT_WORKSPACE_AGENT_TOKEN',agentToken);
values.set('SCOUT_TUNNEL_PROFILE',profile);
values.set('SCOUT_TUNNEL_ID',tunnelId);
values.set('CONTROL_PLANE_API_KEY',controlKey);

await writeFile(envPath,serialize(values),{mode:0o600});
rl.close();

const client=await installTunnelClient();

console.log('\nScout Lab: initializing the Secure MCP Tunnel profile…');
const tunnelEnv={...process.env,CONTROL_PLANE_API_KEY:controlKey};
execFileSync(client,[
  'init',
  '--force',
  '--sample','sample_mcp_remote_no_auth',
  '--profile',profile,
  '--tunnel-id',tunnelId,
  '--mcp-server-url','http://127.0.0.1:3100/mcp'
],{stdio:'inherit',env:tunnelEnv,cwd:root});

console.log('\nScout Lab: validating the local MCP server and tunnel profile…');
const node=spawn(process.execPath,['--env-file-if-exists=.env.local','src/node-server.mjs'],{
  cwd:root,
  env:{...process.env,...Object.fromEntries(values)},
  stdio:['ignore','pipe','pipe']
});
node.stdout?.on('data',d=>process.stdout.write(d));
node.stderr?.on('data',d=>process.stderr.write(d));

try {
  await waitForPort(node);
  execFileSync(client,['doctor','--profile',profile,'--explain'],{stdio:'inherit',env:tunnelEnv,cwd:root});
} finally {
  if(node.exitCode == null) node.kill('SIGTERM');
}

console.log('\nScout Lab Mailroom setup is saved.');
console.log('From now on, start Scout Lab normally with: npm start');
console.log('The REFRESH EMAIL button will stay in the dashboard, trigger the ChatGPT Workspace Agent, read connected Gmail, and receive the published Mailroom snapshot through the Secure MCP Tunnel.');
