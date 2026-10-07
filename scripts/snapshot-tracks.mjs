// Builds docs/data/tracks.json: the official F1 layout of every circuit (with corner numbers) placed on the real map.
// The layout comes from the MultiViewer circuit API (local x/y in 1/10 m). It is fitted onto the OpenStreetMap road
// network around the circuit (rotation, mirroring and offset found by minimising the distance to the roads).
// usage: node scripts/snapshot-tracks.mjs [from-to]   e.g. 0-9 to process part of the list (results are merged)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { circuitLatLon } from '../docs/js/circuits.js';

const OUT = new URL('../docs/data/tracks.json', import.meta.url);
const MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cal = JSON.parse(readFileSync(new URL('../docs/data/calendar.json', import.meta.url)));

const circuits = new Map();
for (const m of cal.meetings.filter(x => x.year >= 2025 && !/testing/i.test(x.meeting_name))) if (!circuits.has(m.circuit_key)) circuits.set(m.circuit_key, m);
const list = [...circuits.entries()];
const [from, to] = (process.argv[2] || `0-${list.length - 1}`).split('-').map(Number);

async function layoutFor(key) {
  for (let y = 2026; y >= 2016; y--) {
    try {
      const r = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${y}`);
      if (r.ok) { const j = await r.json(); if (j.x && j.x.length > 50) return j; }
    } catch { /* next year */ }
  }
  return null;
}

async function roadsAround(lat, lon, radius) {
  const q = `[out:json][timeout:90];way(around:${radius},${lat},${lon})["highway"~"^(raceway|motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out geom;`;
  for (const m of MIRRORS) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 110000);
      const res = await fetch(m, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'pitwall-live/1.0' }, body: `data=${encodeURIComponent(q)}`, signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) return (await res.json()).elements.map(e => e.geometry.map(g => [g.lat, g.lon]));
    } catch { /* next mirror */ }
  }
  return null;
}

// ---- geometry helpers (local metres around lat0/lon0)
const proj = (lat0, lon0) => {
  const kN = 110574; const kE = 111320 * Math.cos(lat0 * Math.PI / 180);
  return { toXY: (lat, lon) => [(lon - lon0) * kE, (lat - lat0) * kN], toLL: (e, n) => [lat0 + n / kN, lon0 + e / kE] };
};

function distanceField(ways, P, R, cell) {
  const N = Math.ceil((2 * R) / cell);
  const INF = 1e9;
  const g = new Float32Array(N * N).fill(INF);
  const mark = (e, n) => { const i = Math.floor((e + R) / cell); const j = Math.floor((n + R) / cell); if (i >= 0 && j >= 0 && i < N && j < N) g[j * N + i] = 0; };
  for (const w of ways) {
    for (let k = 0; k < w.length - 1; k++) {
      const [e0, n0] = P.toXY(...w[k]); const [e1, n1] = P.toXY(...w[k + 1]);
      const steps = Math.max(1, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / (cell / 2)));
      for (let s = 0; s <= steps; s++) mark(e0 + (e1 - e0) * s / steps, n0 + (n1 - n0) * s / steps);
    }
  }
  const D1 = 1; const D2 = Math.SQRT2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = g[j * N + i];
    if (i > 0) v = Math.min(v, g[j * N + i - 1] + D1);
    if (j > 0) { v = Math.min(v, g[(j - 1) * N + i] + D1); if (i > 0) v = Math.min(v, g[(j - 1) * N + i - 1] + D2); if (i < N - 1) v = Math.min(v, g[(j - 1) * N + i + 1] + D2); }
    g[j * N + i] = v;
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    let v = g[j * N + i];
    if (i < N - 1) v = Math.min(v, g[j * N + i + 1] + D1);
    if (j < N - 1) { v = Math.min(v, g[(j + 1) * N + i] + D1); if (i < N - 1) v = Math.min(v, g[(j + 1) * N + i + 1] + D2); if (i > 0) v = Math.min(v, g[(j + 1) * N + i - 1] + D2); }
    g[j * N + i] = v;
  }
  return { at: (e, n) => { const i = Math.floor((e + R) / cell); const j = Math.floor((n + R) / cell); return i < 0 || j < 0 || i >= N || j >= N ? 60 : Math.min(60, g[j * N + i] * cell); } };
}

function fit(layout, field, R) {
  const step = Math.max(1, Math.floor(layout.x.length / 70));
  const base = [];
  for (let i = 0; i < layout.x.length; i += step) base.push([layout.x[i] / 10, layout.y[i] / 10]);
  const cx = base.reduce((a, p) => a + p[0], 0) / base.length; const cy = base.reduce((a, p) => a + p[1], 0) / base.length;
  let best = [];
  const score = (flip, th, te, tn) => {
    const c = Math.cos(th); const s = Math.sin(th); let sum = 0;
    for (const [x, y0] of base) { const y = flip * y0; const qx = x - cx; const qy = flip * (y0 - cy) ; const e = qx * c - qy * s + te; const n = qx * s + qy * c + tn; sum += field.at(e, n); }
    return sum / base.length;
  };
  const cands = [];
  for (const flip of [1, -1]) {
    for (let deg = 0; deg < 360; deg += 3) {
      const th = deg * Math.PI / 180;
      let bs = 1e9; let be = 0; let bn = 0;
      for (let te = -1600; te <= 1600; te += 32) for (let tn = -1600; tn <= 1600; tn += 32) { const sc = score(flip, th, te, tn); if (sc < bs) { bs = sc; be = te; bn = tn; } }
      cands.push({ flip, th, te: be, tn: bn, sc: bs });
    }
  }
  cands.sort((a, b) => a.sc - b.sc);
  const top = cands.slice(0, 8);
  for (const c of top) {
    let cur = { ...c };
    for (const [dth, dt] of [[3, 32], [0.8, 8], [0.2, 2]]) {
      let imp = { ...cur };
      for (let a = -dth; a <= dth + 1e-9; a += dth / 4) for (let e = -dt; e <= dt; e += dt / 4) for (let n = -dt; n <= dt; n += dt / 4) {
        const th = cur.th + a * Math.PI / 180; const sc = score(cur.flip, th, cur.te + e, cur.tn + n);
        if (sc < imp.sc) imp = { flip: cur.flip, th, te: cur.te + e, tn: cur.tn + n, sc };
      }
      cur = imp;
    }
    best.push(cur);
  }
  best.sort((a, b) => a.sc - b.sc);
  return { ...best[0], cx, cy };
}

// Circuits without an official layout: largest connected group of OSM "raceway" ways (pit lane, skidpads and karting excluded)
async function osmLoop(lat, lon) {
  const q = `[out:json][timeout:60];way(around:2000,${lat},${lon})["highway"="raceway"];out tags geom;`;
  let els = null;
  for (const m of MIRRORS) {
    try { const res = await fetch(m, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'pitwall-live/1.0' }, body: `data=${encodeURIComponent(q)}` }); if (res.ok) { els = (await res.json()).elements; break; } } catch { /* next */ }
  }
  if (!els) return null;
  const P = proj(lat, lon);
  const ways = els.filter(e => e.tags?.service !== 'pit_lane' && !/pit|paddock|drag|kart|skid|dynamic/i.test(`${e.tags?.name || ''} ${e.tags?.service || ''}`)).map(e => e.geometry.map(g => [g.lat, g.lon]));
  const parent = ways.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = new Map();
  const cellKey = ([la, lo]) => { const [e, n] = P.toXY(la, lo); return `${Math.round(e / 6)},${Math.round(n / 6)}`; };
  ways.forEach((w, i) => { for (const p of [w[0], w[w.length - 1]]) { const [e, n] = P.toXY(...p); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = `${Math.round(e / 6) + a},${Math.round(n / 6) + b}`; if (ends.has(k)) parent[find(i)] = find(ends.get(k)); } ends.set(cellKey(p), i); } });
  const len = w => w.reduce((a, p, i) => (i ? a + Math.hypot(...P.toXY(...p).map((v, k) => v - P.toXY(...w[i - 1])[k])) : 0), 0);
  const groups = new Map();
  ways.forEach((w, i) => { const r = find(i); const g = groups.get(r) || { ways: [], len: 0 }; g.ways.push(w); g.len += len(w); groups.set(r, g); });
  const best = [...groups.values()].sort((a, b) => b.len - a.len)[0];
  return best && best.len > 2500 ? best.ways.map(w => w.map(([la, lo]) => [Number(la.toFixed(5)), Number(lo.toFixed(5))])) : null;
}

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
if (from === 0 && Object.keys(out).some(k => k.includes(','))) for (const k of Object.keys(out)) if (k.includes(',')) delete out[k]; // drop the old lat,lon keyed data
for (let idx = from; idx <= Math.min(to, list.length - 1); idx++) {
  const [key, meeting] = list[idx];
  const t0 = Date.now();
  const pos = await circuitLatLon(meeting);
  const layout = await layoutFor(key);
  if (pos && !layout) {
    const lines = await osmLoop(pos.lat, pos.lon);
    console.log(idx, key, meeting.circuit_short_name, lines ? `OSM loop, ${lines.length} ways` : 'SKIP (no layout, no mapped loop)');
    if (lines) { out[key] = { name: meeting.circuit_short_name, fit: null, lines, corners: [] }; writeFileSync(OUT, JSON.stringify(out)); }
    continue;
  }
  if (!pos || !layout) { console.log(idx, key, meeting.circuit_short_name, 'SKIP (no position)'); continue; }
  await sleep(1500);
  const R = 3000;
  const ways = await roadsAround(pos.lat, pos.lon, R + 300);
  if (!ways || !ways.length) { console.log(idx, key, meeting.circuit_short_name, 'SKIP (no roads)'); continue; }
  const P = proj(pos.lat, pos.lon);
  const field = distanceField(ways, P, R, 4);
  const f = fit(layout, field, R);
  const place = (x, y0) => { const qx = x / 10 - f.cx; const qy = f.flip * (y0 / 10 - f.cy); const c = Math.cos(f.th); const s = Math.sin(f.th); const [la, lo] = P.toLL(qx * c - qy * s + f.te, qx * s + qy * c + f.tn); return [Number(la.toFixed(5)), Number(lo.toFixed(5))]; };
  const ok = f.sc < 14;
  console.log(idx, key, meeting.circuit_short_name.padEnd(18), `ways ${ways.length}`, `fit ${f.sc.toFixed(1)} m`, ok ? 'OK' : 'POOR', `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (ok) {
    out[key] = { name: meeting.circuit_short_name, fit: Number(f.sc.toFixed(1)), lines: [layout.x.map((x, i) => place(x, layout.y[i]))], corners: (layout.corners || []).map(c => ({ n: c.number, p: place(c.trackPosition.x, c.trackPosition.y) })) };
  } else delete out[key];
  writeFileSync(OUT, JSON.stringify(out));
  await sleep(2000);
}
console.log('saved', Object.keys(out).length, 'circuits');
