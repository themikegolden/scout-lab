import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import process from 'node:process';

const envPath = new URL('../.env.local', import.meta.url);

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
    'CONTROL_PLANE_API_KEY'
  ];
  const lines = ['# Scout Lab private local configuration. Do not commit this file.'];
  for (const key of preferred) if (map.get(key)) lines.push(`${key}=${map.get(key)}`);
  for (const [key,value] of map) if (!preferred.includes(key)) lines.push(`${key}=${value}`);
  return lines.join('\n')+'\n';
}

const existing = existsSync(envPath) ? await readFile(envPath,'utf8') : '';
const values = parseEnv(existing);
const rl = readline.createInterface({ input:process.stdin, output:process.stdout });

console.log('\nScout Lab Mailroom setup');
console.log('This stores secrets only in .env.local on this Mac. It does not commit them to GitHub.\n');

const currentTrigger = values.get('CHATGPT_AGENT_TRIGGER_ID') || '';
const trigger = (await rl.question(`Workspace Agent API trigger ID (agtch_...) ${currentTrigger ? '[already set — Enter to keep]' : ''}: `)).trim() || currentTrigger;
if (!/^agtch_/.test(trigger)) {
  console.error('A valid Workspace Agent API trigger ID must start with agtch_.');
  rl.close();
  process.exit(1);
}

const currentToken = values.get('CHATGPT_WORKSPACE_AGENT_TOKEN') || '';
const token = (await rl.question(`Workspace Agent access token ${currentToken ? '[already set — Enter to keep]' : ''}: `)).trim() || currentToken;
if (!token) {
  console.error('Workspace Agent access token is required.');
  rl.close();
  process.exit(1);
}

const currentProfile = values.get('SCOUT_TUNNEL_PROFILE') || 'scout-lab';
const profile = (await rl.question(`Secure MCP Tunnel profile [${currentProfile}]: `)).trim() || currentProfile;

values.set('SCOUT_MAILROOM_MODE','workspace_agent');
values.set('CHATGPT_AGENT_TRIGGER_ID',trigger);
values.set('CHATGPT_WORKSPACE_AGENT_TOKEN',token);
values.set('SCOUT_TUNNEL_PROFILE',profile);

await writeFile(envPath, serialize(values), {mode:0o600});
rl.close();

console.log('\nSaved private Mailroom settings to .env.local.');
console.log('Restart Scout Lab with: npm start');
