import fs from 'node:fs';

const sourcePath = new URL('../public/index.html', import.meta.url);
const outputPath = new URL('../public/chatgpt-widget.html', import.meta.url);
let html = fs.readFileSync(sourcePath, 'utf8');

const bridge = `<script id="scout-mcp-app-bridge">
(() => {
  const EXTERNAL_URL = __SCOUT_EXTERNAL_URL_JSON__;
  let rpcId = 0;
  const pending = new Map();
  let initialized = false;

  function send(message) { window.parent.postMessage(message, '*'); }
  function rpcRequest(method, params) {
    const id = ++rpcId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        reject(new Error(\`ChatGPT bridge timed out: \${method}\`));
      }, 30000);
    });
  }
  function rpcNotify(method, params) { send({ jsonrpc: '2.0', method, params }); }
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || 'MCP Apps bridge error'));
      else item.resolve(message.result);
    }
  }, { passive: true });

  const ready = rpcRequest('ui/initialize', {
    appInfo: { name: 'scout-lab', version: '22.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26'
  }).then(() => {
    initialized = true;
    rpcNotify('ui/notifications/initialized', {});
    try { window.openai?.setOpenInAppUrl?.({ href: EXTERNAL_URL }); } catch (_) {}
  });

  async function callTool(name, args = {}) {
    await ready;
    const result = await rpcRequest('tools/call', { name, arguments: args });
    if (result?.isError) {
      const message = result?.content?.map?.((x) => x?.text).filter(Boolean).join(' ') || 'Scout Lab tool failed.';
      throw new Error(message);
    }
    return result?.structuredContent ?? {};
  }

  const nativeFetch = window.fetch.bind(window);
  const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  const parseBody = (init) => {
    if (!init?.body) return {};
    try { return typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch (_) { return {}; }
  };

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return nativeFetch(input, init);
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    try {
      let data;
      if (method === 'GET' && url.pathname === '/api/ig-recommendations') data = await callTool('get_ig_recommendations');
      else if (method === 'GET' && url.pathname === '/api/shopify-mailroom') data = await callTool('get_shopify_mailroom');
      else if (method === 'GET' && url.pathname === '/api/store-summary') data = await callTool('get_store_health');
      else if (method === 'GET' && url.pathname === '/api/history') data = await callTool('get_task_history');
      else if (method === 'GET' && url.pathname === '/api/integrations') data = await callTool('get_integrations');
      else if (method === 'POST' && url.pathname === '/api/scout/run') data = await callTool('run_ig_scout', parseBody(init));
      else if (method === 'POST' && (url.pathname === '/api/mailroom/refresh' || url.pathname === '/api/refresh')) data = await callTool('refresh_mailroom', parseBody(init));
      else if (method === 'PATCH' && url.pathname.startsWith('/api/ig-leads/')) {
        const handle = decodeURIComponent(url.pathname.slice('/api/ig-leads/'.length));
        data = await callTool('update_ig_lead', { handle, ...parseBody(init) });
      } else return jsonResponse({ error: \`Unsupported ChatGPT app request: \${method} \${url.pathname}\` }, 404);
      return jsonResponse(data, 200);
    } catch (error) {
      return jsonResponse({ error: error?.message || 'Scout Lab ChatGPT tool failed.' }, 500);
    }
  };

  window.__SCOUT_CHATGPT_APP__ = { ready, callTool, externalUrl: EXTERNAL_URL, get initialized() { return initialized; } };
})();
</script>`;

const hostControls = `<script id="scout-chatgpt-host-controls">
(() => {
  const btn = document.getElementById('fullscreen');
  const mode = document.getElementById('mode');
  const privacy = document.getElementById('privacy');
  if (mode) mode.textContent = 'CHATGPT APP + SHARED DATABASE';
  if (privacy) privacy.textContent = 'Same Scout Lab data · MCP tools · browser URL + ChatGPT interface';
  const updateButton = () => {
    if (!btn) return;
    const full = window.openai?.displayMode === 'fullscreen';
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
    btn.textContent = full ? '⛶ EXIT FULL SCREEN' : '⛶ FULL SCREEN';
  };
  if (btn) {
    btn.addEventListener('click', async (event) => {
      if (!window.openai?.requestDisplayMode) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const full = window.openai?.displayMode === 'fullscreen';
      try { await window.openai.requestDisplayMode({ mode: full ? 'inline' : 'fullscreen' }); } catch (_) {}
      updateButton();
    }, true);
  }
  window.addEventListener('openai:set_globals', updateButton, { passive: true });
  updateButton();
})();
</script>`;

if (!html.includes("<script>'use strict';")) throw new Error('Scout Lab inline app script marker not found.');
html = html.replace('<html lang="en">', '<html data-scout-surface="chatgpt" lang="en">');
html = html.replace("<script>'use strict';", `${bridge}\n<script>'use strict';`);
html = html.replace('</body></html>', `${hostControls}</body></html>`);
fs.writeFileSync(outputPath, html);
console.log('Built public/chatgpt-widget.html from public/index.html');