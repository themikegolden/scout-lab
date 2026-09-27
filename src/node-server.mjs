import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import worker from './worker.mjs';
import { PgD1Adapter } from './pg-d1-adapter.mjs';

const usingPostgres = Boolean(process.env.DATABASE_URL);
const localMode = !usingPostgres;
const PORT = Number(process.env.PORT || (localMode ? 3100 : 3000));
const HOST = process.env.HOST || (localMode ? '127.0.0.1' : '0.0.0.0');
const publicDir = resolve(process.cwd(), 'public');
const localUrl = `http://localhost:${PORT}`;
const localOnly = localMode && ['127.0.0.1', 'localhost', '::1'].includes(HOST);

let DB;
let databaseMode;

if (usingPostgres) {
  DB = new PgD1Adapter(process.env.DATABASE_URL);
  databaseMode = 'Postgres';
} else {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    throw new Error('Scout Lab local mode requires Node.js 22 or newer. Install Node 22 LTS, then run npm install and npm start again.');
  }
  const [{ SqliteD1Adapter }, { seedLocalDatabase }] = await Promise.all([
    import('./sqlite-d1-adapter.mjs'),
    import('./local-seed.mjs')
  ]);
  const dbPath = process.env.SCOUT_DB_PATH || resolve(process.cwd(), 'data', 'scout-lab.sqlite');
  DB = await SqliteD1Adapter.open(dbPath);
  await DB.migrate(resolve(process.cwd(), 'migrations', '001_sqlite_local.sql'));
  const seed = await seedLocalDatabase(DB);
  databaseMode = 'Local SQLite';
  if (seed.seeded) console.log(`Scout Lab seeded ${seed.count} baseline IG leads into ${dbPath}`);
}

const env = new Proxy(process.env, {
  get(target, prop) {
    if (prop === 'DB') return DB;
    if (prop === 'DATABASE_MODE') return databaseMode;
    if (prop === 'DEV_BYPASS_AUTH' && localOnly && !target.DEV_BYPASS_AUTH) return '1';
    if (prop === 'SCOUT_PUBLIC_URL' && localMode && !target.SCOUT_PUBLIC_URL) return localUrl;
    if (prop === 'SCOUT_MCP_URL' && localMode && !target.SCOUT_MCP_URL) return `${localUrl}/mcp`;
    if (prop === 'ASSETS') {
      return {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          return serveStatic(pathname);
        }
      };
    }
    return target[prop];
  }
});

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8'
};

function safePublicPath(pathname) {
  const clean = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(clean.split('?')[0]);
  const full = resolve(publicDir, `.${decoded}`);
  if (full !== publicDir && !full.startsWith(publicDir + sep)) return null;
  return full;
}

async function serveStatic(pathname) {
  const full = safePublicPath(pathname);
  if (!full) return new Response('Not found', { status: 404 });
  try {
    const info = await stat(full);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const body = await readFile(full);
    return new Response(body, {
      headers: {
        'content-type': mime[extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': extname(full).toLowerCase() === '.html' ? 'no-store' : 'public, max-age=3600'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function nodeRequestToWeb(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).toString().split(',')[0].trim();
  const url = `${proto}://${host}${req.url || '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value != null) headers.set(key, String(value));
  }
  const method = (req.method || 'GET').toUpperCase();
  const chunks = [];
  if (method !== 'GET' && method !== 'HEAD') {
    for await (const chunk of req) chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(url, { method, headers, body });
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

const wss = new WebSocketServer({ noServer: true });

function broadcast(type = 'refresh', payload = {}) {
  const message = JSON.stringify({ type, at: new Date().toISOString(), ...payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'connected', at: new Date().toISOString(), databaseMode }));
});

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/') || pathname === '/healthz') {
      const request = await nodeRequestToWeb(req);
      const response = await worker.fetch(request, env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } });
      const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes((req.method || 'GET').toUpperCase());
      if (isMutation && response.ok) queueMicrotask(() => broadcast('refresh', { source: pathname }));
      return sendWebResponse(res, response);
    }
    const response = await serveStatic(pathname);
    return sendWebResponse(res, response);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error?.message || 'Internal server error' }));
  }
});

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname !== '/live') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
});

const reconcileTimer = setInterval(() => {
  const pending = [];
  worker.scheduled?.({}, env, { waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
  Promise.allSettled(pending).then(() => broadcast('refresh', { source: 'scheduled' })).catch(() => {});
}, 60_000);
reconcileTimer.unref?.();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('SCOUT LAB ONLINE');
  console.log(`Dashboard: ${localMode ? localUrl : `http://${HOST}:${PORT}`}`);
  console.log(`Database: ${databaseMode}`);
  console.log(localOnly ? 'Access: local computer only' : `Listening on: ${HOST}:${PORT}`);
  console.log('Press Ctrl+C to stop Scout Lab.');
  console.log('');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    clearInterval(reconcileTimer);
    for (const client of wss.clients) client.close();
    wss.close();
    await DB.close().catch(() => {});
    server.close(() => process.exit(0));
  });
}