// Plays an archived session back as if it were live: node scripts/replay-server.mjs <dir with *.jsonStream> [speed=10] [port=8080] [startMinute=0]
// Serves the same API as the live relay (and the dashboard), so the whole app can be tried without a running session.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { LiveModel } from '../server/model.js';
import { createHandler } from '../server/http.js';

const [dir, speedArg, portArg, startArg] = process.argv.slice(2);
if (!dir) { console.error('usage: replay-server.mjs <dir> [speed] [port] [startMinute]'); process.exit(1); }
const speed = Number(speedArg) || 10;
const read = name => {
  const f = join(dir, `${name}.jsonStream`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(l => {
    const m = l.match(/^(\d+):(\d\d):(\d\d\.\d+)(.*)$/);
    return m ? { rel: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000, data: JSON.parse(m[4]) } : null;
  }).filter(Boolean);
};
const hb = read('Heartbeat')[0];
const anchor = Date.parse(hb.data.Utc) - hb.rel;
const names = ['SessionInfo', 'SessionStatus', 'DriverList', 'TimingData', 'TimingAppData', 'WeatherData', 'RaceControlMessages', 'TeamRadio', 'PitLaneTimeCollection', 'LapCount', 'TrackStatus', 'CarData.z', 'Position.z'];
const events = [];
for (const n of names) for (const r of read(n)) events.push({ topic: n, rel: r.rel, t: anchor + r.rel, data: r.data });
events.sort((a, b) => a.rel - b.rel);

const model = new LiveModel();
let i = 0;
let sim = (Number(startArg) || 0) * 60000; // simulated ms since archive start
let last = Date.now();
const advance = () => {
  const now = Date.now();
  sim += (now - last) * speed;
  last = now;
  while (i < events.length && events[i].rel <= sim) { const e = events[i++]; model.ingest(e.topic, e.data, e.t); }
};
advance();
setInterval(advance, 250);
const root = fileURLToPath(new URL('../docs/', import.meta.url));
const port = Number(portArg) || 8080;
createServer(createHandler({ model, isConnected: () => true, root })).listen(port, () => console.log(`replay at ${speed}x on http://localhost:${port} (session ${model.sessionKey ?? '?'})`));
