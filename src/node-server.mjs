import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import worker from './worker.mjs';
import { PgD1Adapter } from './pg-d1-adapter.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const publicDir = resolve(process.cwd(), 'public');
const DB = new PgD1Adapter(process.env.DATABASE_URL);

const env = new Proxy(process.env, {
  get(target, prop) {
    if (prop === 'DB') return DB;
    if (prop === 'DATABASE_MODE') return 'Postgres';
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

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/') || pathname === '/healthz') {
      const request = await nodeRequestToWeb(req);
      const response = await worker.fetch(request, env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } });
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

const reconcileTimer = setInterval(() => {
  worker.scheduled?.({}, env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); } });
}, 60_000);
reconcileTimer.unref?.();

server.listen(PORT, HOST, () => {
  console.log(`Scout Lab listening on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    clearInterval(reconcileTimer);
    await DB.close().catch(() => {});
    server.close(() => process.exit(0));
  });
}