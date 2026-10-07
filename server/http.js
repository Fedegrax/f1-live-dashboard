// HTTP layer shared by the live relay and the replay server: OpenF1-shaped API, relay status and the static site.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { query } from './model.js';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
const json = (res, status, body) => { res.writeHead(status, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

export function createHandler({ model, isConnected, root }) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    if (url.pathname === '/live') return json(res, 200, { ...model.status_(), connected: isConnected() });
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    const m = url.pathname.match(/^\/v1\/([a-z_]+)$/);
    if (m) {
      const out = query(model, m[1], url.search);
      return json(res, out.status, out.rows);
    }
    if (!root) { res.writeHead(404).end('Not found'); return; }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel.endsWith('/') || rel === '.' ? join(rel, 'index.html') : rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end('Not found'); }
  };
}
