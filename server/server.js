// Pitwall Live relay: reads the F1 live feed, keeps the session in memory and serves it with the OpenF1 API shape.
import { createServer } from 'node:http';
import { readFile, mkdir, appendFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveModel } from './model.js';
import { F1Feed } from './feed.js';
import { createHandler } from './http.js';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = fileURLToPath(new URL('../docs/', import.meta.url));
const DATA = process.env.DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const model = new LiveModel();
let connected = false;
let logFile = null;
let logQueue = Promise.resolve();

function persist(topic, data, t) {
  if (!logFile || topic === 'Heartbeat') return;
  const line = JSON.stringify({ t, topic, data }) + '\n';
  logQueue = logQueue.then(() => appendFile(logFile, line)).catch(() => {});
}

// resume after a restart: replay the newest recording of the current session
async function resume() {
  try {
    await mkdir(DATA, { recursive: true });
    const files = (await readdir(DATA)).filter(f => f.startsWith('live-') && f.endsWith('.jsonl'));
    let newest = null;
    for (const f of files) { const s = await stat(join(DATA, f)); if (!newest || s.mtimeMs > newest.m) newest = { f, m: s.mtimeMs }; }
    if (newest && Date.now() - newest.m < 6 * 3600e3) {
      const text = await readFile(join(DATA, newest.f), 'utf8');
      let n = 0;
      for (const line of text.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); model.ingest(r.topic, r.data, r.t); n++; } catch { /* skip */ } }
      logFile = join(DATA, newest.f);
      log(`resumed ${n} messages from ${newest.f}`);
    }
  } catch (e) { log('resume skipped:', e.message); }
}

function fileFor(key) { return join(DATA, `live-${key}.jsonl`); }

const feed = new F1Feed({
  log,
  onState: c => { connected = c; log(c ? 'feed connected' : 'feed disconnected'); },
  onSnapshot: async snap => {
    const key = snap.SessionInfo?.Key;
    if (key != null && key !== model.sessionKey) { model.reset(); log(`new session ${key}`); }
    if (key != null) { logFile = fileFor(key); await mkdir(DATA, { recursive: true }).catch(() => {}); }
    model.loadSnapshot(snap);
    log(`snapshot: session ${model.sessionKey} ${model.session.Name} (${model.status})${model.partial ? ' - joined mid-session, earlier laps unavailable' : ''}`);
  },
  onMessage: (topic, data, t) => {
    if (topic === 'SessionInfo' && data.Key != null && data.Key !== model.sessionKey) { logFile = fileFor(data.Key); log(`new session ${data.Key}`); }
    try { model.ingest(topic, data, t); } catch (e) { log(`ingest ${topic}:`, e.message); }
    persist(topic, data, t);
  },
});

const handler = createHandler({ model, isConnected: () => connected, root: ROOT });
const server = createServer(handler);

await resume();
server.listen(PORT, () => { log(`relay listening on :${PORT}`); feed.start(); });
