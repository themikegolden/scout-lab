import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import process from 'node:process';

const envPath = new URL('../.env.local', import.meta.url);

function parseEnv(text = '') {
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    map.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  return map;
}

function serialize(map) {
  const preferred = [
    'SCOUT_MAILROOM_MODE',
    'CHATGPT_AGENT_TRIGGER_ID',
    'CHATGPT_WORKSPACE_AGENT_TOKEN',
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD'
  ];
  const lines = ['# Scout Lab private local configuration. Do not commit this file.'];
  for (const key of preferred) {
    if (map.get(key)) lines.push(key + '=' + map.get(key));
  }
  for (const [key, value] of map) {
    if (!preferred.includes(key)) lines.push(key + '=' + value);
  }
  return lines.join('\n') + '\n';
}

function mask(value = '') {
  const s = String(value);
  if (!s) return '';
  if (s.length < 10) return '[set]';
  return s.slice(0, 5) + '…' + s.slice(-4);
}

async function ask(rl, label, current = '', validate = () => true, help = 'Value is required.') {
  while (true) {
    const suffix = current ? ' [current ' + mask(current) + ' — Enter to keep]' : '';
    const answer = (await rl.question(label + suffix + ': ')).trim();
    const value = answer || current;
    if (value && validate(value)) return value;
    console.log(help);
  }
}

const existing = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
const values = parseEnv(existing);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\nScout Lab Mailroom — one-time ChatGPT backend setup');
console.log('ChatGPT searches connected Gmail in the backend. A private self-email carries only the finished JSON summary back to Scout Lab.\n');

const trigger = await ask(
  rl,
  'Workspace Agent API trigger ID (agtch_...)',
  values.get('CHATGPT_AGENT_TRIGGER_ID') || '',
  (v) => /^agtch_[A-Za-z0-9_-]+$/.test(v),
  'The trigger ID must start with agtch_.'
);

const token = await ask(
  rl,
  'Workspace Agent access token',
  values.get('CHATGPT_WORKSPACE_AGENT_TOKEN') || '',
  (v) => v.length >= 12,
  'Paste the Workspace Agent access token from ChatGPT Admin > Access tokens.'
);

const gmailUser = await ask(
  rl,
  'Gmail address used by the ChatGPT Mailroom',
  values.get('GMAIL_USER') || '',
  (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  'Enter the Gmail address connected to ChatGPT.'
);

const appPassword = await ask(
  rl,
  'Google App Password for the private result relay',
  values.get('GMAIL_APP_PASSWORD') || '',
  (v) => String(v).replace(/\s+/g, '').length >= 16,
  'Use a Google App Password, not your normal Google password.'
);

values.set('SCOUT_MAILROOM_MODE', 'workspace_agent_gmail_relay');
values.set('CHATGPT_AGENT_TRIGGER_ID', trigger);
values.set('CHATGPT_WORKSPACE_AGENT_TOKEN', token);
values.set('GMAIL_USER', gmailUser);
values.set('GMAIL_APP_PASSWORD', appPassword);

await writeFile(envPath, serialize(values), { mode: 0o600 });
rl.close();

console.log('\nSaved private Mailroom settings to .env.local.');
console.log('From now on, normal startup is only: npm start');
