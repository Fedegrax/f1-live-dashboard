// Replays an archived F1 session through the live model and compares it with OpenF1.
// usage: node scripts/replay-check.mjs <dir with *.jsonStream files> <openf1 session_key>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LiveModel, query } from '../server/model.js';

const [dir, sessionKey] = process.argv.slice(2);
if (!dir || !sessionKey) { console.error('usage: replay-check.mjs <dir> <session_key>'); process.exit(1); }

const read = name => {
  const f = join(dir, `${name}.jsonStream`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(l => {
    const m = l.match(/^(\d+):(\d\d):(\d\d\.\d+)(.*)$/);
    if (!m) return null;
    return { rel: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000, data: JSON.parse(m[4]) };
  }).filter(Boolean);
};
const hb = read('Heartbeat')[0];
const anchor = Date.parse(hb.data.Utc) - hb.rel;
const names = ['SessionInfo', 'SessionStatus', 'DriverList', 'TimingData', 'TimingAppData', 'WeatherData', 'RaceControlMessages', 'TeamRadio', 'PitLaneTimeCollection', 'LapCount', 'TrackStatus', 'CarData.z', 'Position.z'];
const events = [];
for (const n of names) for (const r of read(n)) events.push({ topic: n, t: anchor + r.rel, data: r.data });
events.sort((a, b) => a.t - b.t);
console.log('events', events.length);

const model = new LiveModel();
const t0 = Date.now();
for (const e of events) model.ingest(e.topic, e.data, e.t);
console.log('replayed in', Date.now() - t0, 'ms', JSON.stringify(model.status_().counts));

const get = async (ep) => (await fetch(`https://api.openf1.org/v1/${ep}?session_key=${sessionKey}`)).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const of1 = { laps: await get('laps') }; await sleep(1500);
of1.stints = await get('stints'); await sleep(1500);
of1.drivers = await get('drivers');

const mine = query(model, 'laps', `?session_key=${model.sessionKey}`).rows;
const key = l => `${l.driver_number}|${l.lap_number}`;
const mm = new Map(mine.map(l => [key(l), l]));
let both = 0; let durEq = 0; let s1Eq = 0; let s3Eq = 0; let missing = 0; const bad = [];
for (const o of of1.laps) {
  if (o.lap_duration == null) continue;
  const m = mm.get(key(o));
  if (!m) { missing++; continue; }
  both++;
  if (Math.abs(m.lap_duration - o.lap_duration) < 0.002) durEq++; else bad.push(`${key(o)} mine ${m.lap_duration} of1 ${o.lap_duration}`);
  if (o.duration_sector_1 != null && Math.abs((m.duration_sector_1 ?? -9) - o.duration_sector_1) < 0.002) s1Eq++;
  if (o.duration_sector_3 != null && Math.abs((m.duration_sector_3 ?? -9) - o.duration_sector_3) < 0.002) s3Eq++;
}
console.log(`laps: OpenF1 timed ${of1.laps.filter(l => l.lap_duration != null).length}, mine ${mine.length}, matched ${both}, missing ${missing}`);
console.log(`lap_duration equal ${durEq}/${both}, S1 equal ${s1Eq}, S3 equal ${s3Eq}`);
console.log('mismatches sample', bad.slice(0, 6));

const st = query(model, 'stints', `?session_key=${model.sessionKey}`).rows;
const ofSt = new Map(of1.stints.map(s => [`${s.driver_number}|${s.stint_number}`, s]));
let sOk = 0; let sTot = 0; const sBad = [];
for (const s of st) { const o = ofSt.get(`${s.driver_number}|${s.stint_number}`); if (!o) continue; sTot++; if (o.compound === s.compound && o.lap_start === s.lap_start && Math.abs((o.lap_end ?? s.lap_end) - s.lap_end) <= 1) sOk++; else sBad.push(`${s.driver_number}#${s.stint_number} mine ${s.compound} ${s.lap_start}-${s.lap_end} of1 ${o.compound} ${o.lap_start}-${o.lap_end}`); }
console.log(`stints matching (compound, start, end±1): ${sOk}/${sTot}`, sBad.slice(0, 5));
const loc = query(model, 'location', `?session_key=${model.sessionKey}&driver_number=1&date>=${new Date(anchor + 3600e3).toISOString().slice(0, 23)}&date<=${new Date(anchor + 3600e3 + 20000).toISOString().slice(0, 23)}`).rows;
console.log('location rows in 20 s window', Array.isArray(loc) ? loc.length : loc, Array.isArray(loc) && loc[0] ? JSON.stringify(loc[0]) : '');
console.log('drivers', query(model, 'drivers', '?session_key=' + model.sessionKey).rows.length, 'positions', model.positions.length, 'rc', model.rc.length, 'pits', model.pits.length);
