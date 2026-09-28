import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import process from 'node:process';

const envPath = new URL('../.env.local', import.meta.url);

function parseEnv(text='') {
  const map=new Map();
  for(const raw of String(text).split(/\r?\n/)) {
    const line=raw.trim();
    if(!line || line.startsWith('#') || !line.includes('=')) continue;
    const i=line.indexOf('=');
    map.set(line.slice(0,i).trim(),line.slice(i+1));
  }
  return map;
}

function serialize(map) {
  const keys=['SCOUT_MAILROOM_MODE','GMAIL_USER','GMAIL_APP_PASSWORD'];
  const lines=[
    '# Scout Lab private local configuration. Do not commit this file.',
    '# ChatGPT reads/summarizes the source inbox; this Mac only reads the self-addressed snapshot email.'
  ];
  for(const key of keys) if(map.get(key)) lines.push(key+'='+map.get(key));
  for(const [key,value] of map) if(!keys.includes(key) && !['OPENAI_API_KEY','OPENAI_MAIL_MODEL','CHATGPT_AGENT_TRIGGER_ID','CHATGPT_WORKSPACE_AGENT_TOKEN','SCOUT_TUNNEL_PROFILE','SCOUT_TUNNEL_ID','CONTROL_PLANE_API_KEY'].includes(key)) {
    lines.push(key+'='+value);
  }
  return lines.join('\n')+'\n';
}

function mask(v='') {
  const s=String(v);
  return s.length<10?'[set]':s.slice(0,5)+'…'+s.slice(-4);
}

async function ask(rl,label,current='',validate=()=>true,help='Value is required.') {
  while(true) {
    const suffix=current?' [current '+mask(current)+' — Enter to keep]':'';
    const answer=(await rl.question(label+suffix+': ')).trim();
    const value=answer||current;
    if(value && validate(value)) return value;
    console.log(help);
  }
}

const values=parseEnv(existsSync(envPath)?await readFile(envPath,'utf8'):'');
const rl=readline.createInterface({input:process.stdin,output:process.stdout});

console.log('\nScout Lab Mailroom — simple ChatGPT Gmail sync');
console.log('ChatGPT summarizes your connected Gmail hourly. Scout Lab only reads the one private snapshot email ChatGPT sends back to the same inbox.\n');

const gmailUser=await ask(
  rl,
  'Gmail address connected to ChatGPT',
  values.get('GMAIL_USER')||'',
  v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  'Enter the Gmail address connected to ChatGPT.'
);

const appPassword=await ask(
  rl,
  'Google App Password for reading the snapshot',
  values.get('GMAIL_APP_PASSWORD')||'',
  v=>String(v).replace(/\s+/g,'').length>=16,
  'Use a Google App Password, not your normal Google password.'
);

values.set('SCOUT_MAILROOM_MODE','chatgpt_task_relay');
values.set('GMAIL_USER',gmailUser);
values.set('GMAIL_APP_PASSWORD',appPassword);

await writeFile(envPath,serialize(values),{mode:0o600});
rl.close();

console.log('\nSaved. No Workspace Agent, OpenAI API key, or MCP tunnel is required.');
console.log('From now on, start Scout Lab with: npm start');
