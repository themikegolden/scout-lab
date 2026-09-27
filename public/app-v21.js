'use strict';

const CONFIG = Object.freeze({ apiBase: '/api', pollMs: 15000 });
const FEEDS = ['candidates', 'emails', 'history'];
const STAGES = ['New', 'Review', 'Shortlist', 'Contacted', 'Outcome'];

const state = {
  active: 'candidates',
  candidates: { records: [], freshness: {}, control: { status: 'idle' }, error: '', loaded: false },
  emails: { records: [], freshness: {}, control: { status: 'idle' }, error: '', loaded: false },
  history: { records: [], error: '', loaded: false },
  store: { orders: { count: null }, paymentIssues: [], appAlerts: [], freshness: {}, loaded: false },
  integrations: { chatgptAgent: { ready: false }, shopify: { ready: false } },
  pendingMailRefresh: false,
  liveConnected: false,
  paused: matchMedia('(prefers-reduced-motion: reduce)').matches
};

const $ = (id) => document.getElementById(id);
const escapeText = (value) => value == null ? '' : String(value);
const isoNow = () => new Date().toISOString();
const dateText = (value) => {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(CONFIG.apiBase + path, {
    credentials: 'same-origin',
    ...options,
    headers,
    signal: AbortSignal.timeout(20000)
  });
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = data && data.error ? data.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data || {};
}

function freshnessValues() {
  if (state.active === 'history') {
    const newest = state.history.records[0];
    return {
      researched: newest?.sourceTimestamp || newest?.startedAt,
      published: newest?.finishedAt,
      checked: newest?.checkedAt || newest?.finishedAt
    };
  }
  const f = state[state.active].freshness || {};
  return {
    researched: f.lastResearchedAt,
    published: f.lastPublishedAt,
    checked: f.lastCheckedAt
  };
}

function renderFreshness() {
  const f = freshnessValues();
  $('fresh-researched').textContent = dateText(f.researched);
  $('fresh-published').textContent = dateText(f.published);
  $('fresh-checked').textContent = dateText(f.checked);
}

function renderTabs() {
  for (const feed of FEEDS) {
    const tab = $('tab-' + feed);
    const selected = feed === state.active;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  }
  $('count-candidates').textContent = state.candidates.records.length;
  $('count-emails').textContent = state.emails.records.length;
  $('count-history').textContent = state.history.records.length;
  $('feed-panel').setAttribute('aria-labelledby', 'tab-' + state.active);
}

function statusText() {
  if (state.active === 'history') return 'TASK HISTORY';
  const bucket = state[state.active];
  if (!bucket.loaded) return 'LOADING…';
  const prefix = state.active === 'candidates' ? 'IG PIPELINE' : 'SHOPIFY MAILROOM';
  return `${prefix} · ${(bucket.control?.status || 'idle').toUpperCase()}`;
}

function renderStatus() {
  $('status').textContent = statusText();
  const bucket = state.active === 'history' ? null : state[state.active];
  $('dot').className = 'dot ' + (bucket?.control?.status || 'idle');
  $('run').hidden = state.active !== 'emails';
  $('run').disabled = state.pendingMailRefresh;
  $('run').textContent = state.pendingMailRefresh ? 'STARTING CHATGPT…' : 'REFRESH EMAIL';
  const agentReady = !!state.integrations.chatgptAgent?.ready;
  $('agent-state').textContent = agentReady ? 'CHATGPT AGENT READY' : 'CHATGPT AGENT SETUP REQUIRED';
  $('agent-state').className = 'integration-pill ' + (agentReady ? 'ready' : 'waiting');
  renderIntegrationMeta();
  $('error').hidden = true;
  const error = state.active === 'history' ? state.history.error : bucket?.error;
  if (error) { $('error').hidden = false; $('error').textContent = error; }
  renderFreshness();
}


function renderIntegrationMeta() {
  const databaseMode = state.integrations.database?.mode || '';
  const local = /sqlite/i.test(databaseMode);
  if (local) {
    $('mode').textContent = state.liveConnected ? 'LOCAL NODE + SQLITE · LIVE' : 'LOCAL NODE + SQLITE';
    $('privacy').textContent = state.integrations.chatgptAgent?.ready
      ? 'Local SQLite · live Node connection · ChatGPT bridge configured'
      : 'Local SQLite · live Node connection · data stays on this computer';
  } else {
    $('mode').textContent = 'DATABASE + CHATGPT BRIDGE';
    $('privacy').textContent = 'Database snapshots · ChatGPT task bridge · store integrations stay server-side';
  }
}

let liveSocket = null;
let liveRetry = null;
function connectLive() {
  if (!('WebSocket' in window)) return;
  if (liveSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(liveSocket.readyState)) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  liveSocket = new WebSocket(`${protocol}//${location.host}/live`);
  liveSocket.addEventListener('open', () => {
    state.liveConnected = true;
    renderIntegrationMeta();
  });
  liveSocket.addEventListener('message', (event) => {
    let message = null;
    try { message = JSON.parse(event.data); } catch (_) {}
    if (message?.type === 'refresh') refreshAll({ quiet: true });
  });
  liveSocket.addEventListener('close', () => {
    state.liveConnected = false;
    renderIntegrationMeta();
    clearTimeout(liveRetry);
    liveRetry = setTimeout(connectLive, 2000);
  });
  liveSocket.addEventListener('error', () => liveSocket?.close());
}

function stageClass(stage) {
  return 'stage-' + String(stage || 'New').toLowerCase().replace(/[^a-z]+/g, '-');
}

function renderCandidates() {
  $('log-title').textContent = 'IG COLLAB PIPELINE';
  $('log-meta').textContent = 'NEW → REVIEW → SHORTLIST → CONTACTED → OUTCOME';
  $('store-health').hidden = true;
  const rows = state.candidates.records;
  const fragment = document.createDocumentFragment();
  if (!rows.length) {
    const box = el('div', 'empty');
    box.append(el('strong', '', 'NO IG LEADS YET'), el('span', '', 'New ChatGPT scouting results will appear here after they are published to Scout Lab.'));
    fragment.append(box);
  }
  for (const r of rows) {
    const card = el('article', 'log pipeline-card');
    const initials = (r.name || r.handle || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    card.append(el('div', 'avatar', initials));
    const content = el('div', 'pipeline-content');
    const top = el('div', 'entry-top');
    top.append(el('span', 'entry-title', r.name || 'Untitled'));
    if (r.handle) top.append(el('span', 'handle', r.handle.startsWith('@') ? r.handle : '@' + r.handle));
    top.append(el('span', 'badge', r.tag || r.category || 'LEAD'));
    const stageBadge = el('span', 'pipeline-stage ' + stageClass(r.pipelineStage), r.pipelineStage || 'New');
    top.append(stageBadge);
    content.append(top);
    if (r.detail) content.append(el('p', 'detail', r.detail));
    if (r.note) content.append(el('p', 'detail', r.note));

    const meta = el('div', 'pipeline-meta');
    meta.append(el('span', '', `FIT: ${r.productFit || 'Not set'}`));
    meta.append(el('span', '', `EST. COST: ${r.estimatedCollabCost || 'Not set'}`));
    if (r.followers) meta.append(el('span', '', `FOLLOWERS: ${r.followers}`));
    content.append(meta);

    const controls = el('div', 'pipeline-controls');
    const stageWrap = el('label', 'field-control'); stageWrap.append(el('span', '', 'Stage'));
    const select = document.createElement('select'); select.dataset.field = 'pipelineStage'; select.dataset.handle = r.handle || '';
    for (const stage of STAGES) { const opt = document.createElement('option'); opt.value = stage; opt.textContent = stage; opt.selected = (r.pipelineStage || 'New') === stage; select.append(opt); }
    stageWrap.append(select); controls.append(stageWrap);

    const fitWrap = el('label', 'field-control'); fitWrap.append(el('span', '', 'Product fit'));
    const fit = document.createElement('input'); fit.type = 'text'; fit.value = r.productFit || ''; fit.placeholder = 'NomadRush / pouch / patches'; fit.dataset.field = 'productFit'; fit.dataset.handle = r.handle || ''; fitWrap.append(fit); controls.append(fitWrap);

    const costWrap = el('label', 'field-control small'); costWrap.append(el('span', '', 'Est. cost'));
    const cost = document.createElement('input'); cost.type = 'text'; cost.value = r.estimatedCollabCost || ''; cost.placeholder = '$ / gifted / TBD'; cost.dataset.field = 'estimatedCollabCost'; cost.dataset.handle = r.handle || ''; costWrap.append(cost); controls.append(costWrap);

    const notesWrap = el('label', 'field-control notes'); notesWrap.append(el('span', '', 'Notes'));
    const notes = document.createElement('input'); notes.type = 'text'; notes.value = r.notes || ''; notes.placeholder = 'Outreach notes or outcome'; notes.dataset.field = 'notes'; notes.dataset.handle = r.handle || ''; notesWrap.append(notes); controls.append(notesWrap);
    const save = el('button', 'mini-action', 'SAVE'); save.type = 'button'; save.dataset.saveHandle = r.handle || ''; controls.append(save);
    content.append(controls);

    const actions = el('div', 'ig-actions');
    const href = r.profileUrl || r.instagramUrl || (r.handle ? `https://www.instagram.com/${String(r.handle).replace(/^@/, '')}/` : null);
    if (href) { const a = el('a', 'ig-link', 'OPEN IG ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a); }
    if (r.sourceUrl) { const a = el('a', 'ig-link', 'SOURCE ↗'); a.href = r.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a); }
    if (actions.children.length) content.append(actions);
    card.append(content, el('time', 'entry-date', dateText(r.lastSeenAt || r.foundAt || r.sourceTimestamp)));
    fragment.append(card);
  }
  $('logs').replaceChildren(fragment);
}

function renderStoreHealth() {
  const box = $('store-health');
  box.hidden = false;
  const orders = state.store.orders || {};
  $('store-orders').textContent = orders.count == null ? '—' : String(orders.count);
  $('store-orders-time').textContent = dateText(orders.lastUpdatedAt || state.store.freshness?.lastCheckedAt);
  $('store-payments').textContent = String((state.store.paymentIssues || []).length);
  $('store-payments-time').textContent = dateText(state.store.paymentIssues?.[0]?.updatedAt || state.store.freshness?.lastCheckedAt);
  $('store-apps').textContent = String((state.store.appAlerts || []).length);
  $('store-apps-time').textContent = dateText(state.store.appAlerts?.[0]?.updatedAt || state.store.freshness?.lastCheckedAt);
  $('store-health-state').textContent = state.integrations.shopify?.ready ? 'SHOPIFY CONNECTED' : 'SHOPIFY CONNECTION PENDING';
}

function renderEmails() {
  $('log-title').textContent = 'LATEST STORE EMAIL';
  $('log-meta').textContent = 'READ ONLY · NEWEST FIRST';
  renderStoreHealth();
  const rows = state.emails.records;
  const fragment = document.createDocumentFragment();
  if (!rows.length) {
    const box = el('div', 'empty');
    box.append(el('strong', '', 'NO STORE EMAILS YET'), el('span', '', 'Use REFRESH EMAIL after the ChatGPT Workspace Agent is configured.'));
    fragment.append(box);
  }
  for (const r of rows) {
    const row = el('article', 'log');
    row.append(el('div', 'avatar', '↳'));
    const content = el('div');
    const top = el('div', 'entry-top');
    top.append(el('span', 'entry-title', r.subject || 'No subject'));
    top.append(el('span', 'badge', r.tag || r.category || 'MAIL'));
    content.append(top);
    if (r.summary) content.append(el('p', 'detail', r.summary));
    content.append(el('div', 'detail', `From: ${r.from || r.sender || 'Unknown sender'}`));
    row.append(content, el('time', 'entry-date', dateText(r.receivedAt)));
    fragment.append(row);
  }
  $('logs').replaceChildren(fragment);
}

function renderHistory() {
  $('log-title').textContent = 'TASK OUTCOMES';
  $('log-meta').textContent = 'START · FINISH · SOURCE · ADDED · CHANGED · ERRORS';
  $('store-health').hidden = true;
  const rows = state.history.records;
  const fragment = document.createDocumentFragment();
  if (!rows.length) {
    const box = el('div', 'empty');
    box.append(el('strong', '', 'NO TASK RUNS YET'), el('span', '', 'ChatGPT and store refresh runs will be recorded here.'));
    fragment.append(box);
  }
  for (const r of rows) {
    const card = el('article', 'history-row');
    const header = el('div', 'history-head');
    header.append(el('strong', '', (r.kind || 'TASK').toUpperCase()));
    header.append(el('span', 'history-status ' + (r.status || 'unknown'), (r.status || 'unknown').toUpperCase()));
    card.append(header);
    const grid = el('div', 'history-grid');
    const items = [
      ['TRIGGER', r.trigger || '—'], ['SOURCE', r.source || '—'], ['START', dateText(r.startedAt)], ['FINISH', dateText(r.finishedAt)],
      ['CHECKED', r.recordsChecked ?? 0], ['ADDED', r.recordsAdded ?? 0], ['CHANGED', r.recordsChanged ?? 0], ['ERRORS', r.error ? 1 : 0]
    ];
    for (const [k, v] of items) { const item = el('div'); item.append(el('span', '', k), el('strong', '', String(v))); grid.append(item); }
    card.append(grid);
    if (r.summary) card.append(el('p', 'detail', r.summary));
    if (r.error) card.append(el('p', 'history-error', r.error));
    fragment.append(card);
  }
  $('logs').replaceChildren(fragment);
}

function renderLed() {
  const latest = state.emails.records[0];
  const sign = $('mail-led-text');
  if (state.pendingMailRefresh) sign.textContent = 'MAILROOM · CHATGPT CHECK IN PROGRESS…';
  else if (latest) sign.textContent = `MAIL · ${escapeText(latest.from || latest.sender || 'SHOPIFY')} · ${escapeText(latest.subject || 'NEW MESSAGE')}`;
  else sign.textContent = 'MAILROOM · NO NEW STORE MAIL';
}

function render() {
  renderTabs(); renderStatus();
  if (state.active === 'candidates') renderCandidates();
  else if (state.active === 'emails') renderEmails();
  else renderHistory();
  renderLed();
  $('stage').classList.toggle('running', state.pendingMailRefresh || state.candidates.control?.status === 'running' || state.emails.control?.status === 'running');
}

async function refreshAll({ quiet = false } = {}) {
  const calls = [
    request('/ig-recommendations'), request('/shopify-mailroom'), request('/store-summary'), request('/history'), request('/integrations')
  ];
  const results = await Promise.allSettled(calls);
  const [ig, mail, store, history, integrations] = results;
  if (ig.status === 'fulfilled') state.candidates = { ...state.candidates, ...ig.value, loaded: true, error: '' };
  else if (!quiet) state.candidates.error = ig.reason.message;
  if (mail.status === 'fulfilled') state.emails = { ...state.emails, ...mail.value, loaded: true, error: '' };
  else if (!quiet) state.emails.error = mail.reason.message;
  if (store.status === 'fulfilled') state.store = { ...state.store, ...store.value, loaded: true };
  if (history.status === 'fulfilled') state.history = { records: Array.isArray(history.value.records) ? history.value.records : [], loaded: true, error: '' };
  else if (!quiet) state.history.error = history.reason.message;
  if (integrations.status === 'fulfilled') state.integrations = integrations.value;
  render();
}

async function saveLead(handle, button) {
  if (!handle) return;
  const inputs = [...document.querySelectorAll(`[data-handle="${CSS.escape(handle)}"]`)];
  const patch = {};
  for (const input of inputs) patch[input.dataset.field] = input.value;
  button.disabled = true; button.textContent = 'SAVING…';
  try {
    const data = await request('/ig-leads/' + encodeURIComponent(handle), { method: 'PATCH', body: JSON.stringify(patch) });
    const index = state.candidates.records.findIndex((x) => String(x.handle).replace(/^@/, '').toLowerCase() === String(handle).replace(/^@/, '').toLowerCase());
    if (index >= 0 && data.record) state.candidates.records[index] = data.record;
    $('announce').textContent = `Saved pipeline changes for ${handle}.`;
  } catch (error) {
    state.candidates.error = error.message;
  } finally { button.disabled = false; button.textContent = 'SAVE'; render(); }
}

async function runMailRefresh() {
  if (state.pendingMailRefresh) return;
  state.pendingMailRefresh = true; state.emails.error = ''; render();
  $('announce').textContent = 'Starting a ChatGPT mailroom task.';
  try {
    const data = await request('/mailroom/refresh', { method: 'POST', body: JSON.stringify({ requestedAt: isoNow() }) });
    $('announce').textContent = `ChatGPT mailroom run ${data.run?.id || ''} started.`;
    state.active = 'history';
    await refreshAll({ quiet: true });
    const start = Date.now();
    while (Date.now() - start < 180000) {
      await new Promise((r) => setTimeout(r, 4000));
      await refreshAll({ quiet: true });
      const run = state.history.records.find((x) => x.id === data.run?.id);
      if (run && ['completed', 'failed'].includes(run.status)) break;
    }
  } catch (error) {
    state.emails.error = error.message;
    $('announce').textContent = 'The ChatGPT mailroom task could not be started.';
  } finally { state.pendingMailRefresh = false; await refreshAll({ quiet: true }); render(); }
}

function selectFeed(feed) { state.active = feed; $('logs').scrollTop = 0; render(); }
for (const feed of FEEDS) {
  const tab = $('tab-' + feed);
  tab.addEventListener('click', () => selectFeed(feed));
  tab.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    let next;
    if (e.key === 'Home') next = FEEDS[0]; else if (e.key === 'End') next = FEEDS[FEEDS.length - 1];
    else { const i = FEEDS.indexOf(state.active); next = FEEDS[(i + (e.key === 'ArrowRight' ? 1 : -1) + FEEDS.length) % FEEDS.length]; }
    selectFeed(next); $('tab-' + next).focus();
  });
}

$('run').addEventListener('click', runMailRefresh);
$('logs').addEventListener('click', (e) => { const button = e.target.closest('[data-save-handle]'); if (button) saveLead(button.dataset.saveHandle, button); });

function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
async function toggleFullscreen() {
  const root = document.documentElement;
  try {
    if (fullscreenElement()) { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); }
    else if (root.requestFullscreen) await root.requestFullscreen(); else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch (_) { $('announce').textContent = 'Fullscreen could not be started by this browser.'; }
  updateFullscreenButton();
}
function updateFullscreenButton() { const active = !!fullscreenElement(); $('fullscreen').setAttribute('aria-pressed', active); $('fullscreen').textContent = active ? '⛶ EXIT FULL SCREEN' : '⛶ FULL SCREEN'; }
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

function motion() { const stage = $('stage'); stage.classList.toggle('paused', state.paused); $('motion').setAttribute('aria-pressed', state.paused); $('motion').textContent = state.paused ? '▶ RESUME MOTION' : 'Ⅱ PAUSE MOTION'; }
$('motion').onclick = () => { state.paused = !state.paused; motion(); };
function resize() { const width = $('viewport').clientWidth; const scale = width / 1040; $('stage').style.left = '0'; $('stage').style.transformOrigin = 'top left'; $('stage').style.transform = `scale(${scale})`; $('viewport').style.minHeight = '0'; }
new ResizeObserver(resize).observe($('viewport'));

document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll({ quiet: true }); });
setInterval(() => { if (!document.hidden && !state.pendingMailRefresh) refreshAll({ quiet: true }); }, CONFIG.pollMs);
$('mode').textContent = 'LOCAL NODE STARTING…';
$('privacy').textContent = 'Connecting Scout Lab…';
connectLive();
motion(); resize(); render(); refreshAll();