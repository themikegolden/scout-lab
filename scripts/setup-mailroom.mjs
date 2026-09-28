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
  const keys=['SCOUT_MAILROOM_MODE','OPENAI_API_KEY','OPENAI_MAIL_MODEL','GMAIL_USER','GMAIL_APP_PASSWORD'];
  const lines=['# Scout Lab private local configuration. Do not commit this file.'];
  for(const key of keys) if(map.get(key)) lines.push(key+'='+map.get(key));
  for(const [key,value] of map) if(!keys.includes(key)) lines.push(key+'='+value);
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

console.log('\nScout Lab Mailroom — no-agent setup');
console.log('Gmail is read locally in read-only mode; OpenAI Responses API performs the email selection and summaries. This does not use Workspace Agent quota.\n');

const apiKey=await ask(
  rl,
  'OpenAI API key (sk-...)',
  values.get('OPENAI_API_KEY')||'',
  v=>/^sk-/.test(v),
  'Use an OpenAI Platform API key.'
);

const gmailUser=await ask(
  rl,
  'Gmail address',
  values.get('GMAIL_USER')||'',
  v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  'Enter the Gmail address to read.'
);

const appPassword=await ask(
  rl,
  'Google App Password',
  values.get('GMAIL_APP_PASSWORD')||'',
  v=>String(v).replace(/\s+/g,'').length>=16,
  'Use a Google App Password, not your normal Google password.'
);

values.set('SCOUT_MAILROOM_MODE','openai_api');
values.set('OPENAI_API_KEY',apiKey);
values.set('OPENAI_MAIL_MODEL',values.get('OPENAI_MAIL_MODEL')||'gpt-5-mini');
values.set('GMAIL_USER',gmailUser);
values.set('GMAIL_APP_PASSWORD',appPassword);

await writeFile(envPath,serialize(values),{mode:0o600});
rl.close();

console.log('\nSaved. This mode does not use Workspace Agents.');
console.log('From now on, normal startup is only: npm start');
