import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app-v21.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker.mjs', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../migrations/001_v21_live_data.sql', import.meta.url), 'utf8');

const requiredHtml = ['tab-candidates','tab-emails','tab-history','fresh-researched','fresh-published','fresh-checked','store-health','mail-led-text'];
const requiredJs = ['New', 'Review', 'Shortlist', 'Contacted', 'Outcome', '/mailroom/refresh', '/ig-leads/'];
const requiredWorker = ['/api/task-results', '/api/mailroom/refresh', 'publish_mailroom_snapshot', 'api.chatgpt.com/v1/workspace_agents', 'feed_snapshots_v21', 'task_runs_v21'];
const requiredSql = ['CREATE TABLE IF NOT EXISTS feed_snapshots_v21', 'CREATE TABLE IF NOT EXISTS task_runs_v21', 'CREATE TABLE IF NOT EXISTS ig_leads', 'CREATE TABLE IF NOT EXISTS mail_messages', 'CREATE TABLE IF NOT EXISTS store_health_snapshots'];

for (const [name, haystack, needles] of [['HTML',html,requiredHtml],['frontend',js,requiredJs],['worker',worker,requiredWorker],['migration',sql,requiredSql]]) {
  for (const needle of needles) {
    if (!haystack.includes(needle)) throw new Error(`${name} is missing required marker: ${needle}`);
  }
}
if ((html.match(/id="stage"/g) || []).length !== 1) throw new Error('Expected exactly one stage scene.');
if ((html.match(/class="mail-led"/g) || []).length !== 1) throw new Error('Expected exactly one mailroom LED overlay.');
console.log('Scout Lab v21 static checks passed.');