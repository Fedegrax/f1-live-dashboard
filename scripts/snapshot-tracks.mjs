// Saves the OpenStreetMap geometry of every known circuit to docs/data/tracks.json (used to highlight the track on the rain radar).
import { writeFileSync } from 'node:fs';
import { CIRCUITS } from '../docs/js/circuits.js';

const MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

// Douglas-Peucker on lat/lon (tolerance in degrees, ~2 m)
function simplify(pts, tol = 0.000007) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0; let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const d = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(dx, dy) || 1e-12);
    if (d > max) { max = d; idx = i; }
  }
  return max > tol ? [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)] : [a, b];
}

async function query(lat, lon) {
  const q = `[out:json][timeout:30];way(around:1800,${lat},${lon})["highway"="raceway"];out tags geom;`;
  for (const m of MIRRORS) {
    try {
      const res = await fetch(m, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'pitwall-live/1.0' }, body: `data=${encodeURIComponent(q)}` });
      if (res.ok) return (await res.json()).elements || [];
    } catch { /* try next mirror */ }
  }
  return null;
}

const out = {};
const seen = new Set();
for (const [, lat, lon] of CIRCUITS) {
  const k = key(lat, lon);
  if (seen.has(k)) continue;
  seen.add(k);
  const els = await query(lat, lon);
  await sleep(2500);
  if (!els) { console.log('FAILED', k); continue; }
  const ways = els
    .filter(e => !/pit|paddock|drag|kart|service/i.test(`${e.tags?.name || ''} ${e.tags?.service || ''} ${e.tags?.raceway || ''}`) || e.tags?.service === undefined && !/pit|paddock|drag|kart/i.test(e.tags?.name || ''))
    .filter(e => e.tags?.service !== 'pit_lane')
    .map(e => simplify(e.geometry.map(g => [Number(g.lat.toFixed(5)), Number(g.lon.toFixed(5))])))
    .filter(w => w.length > 3);
  out[k] = ways;
  console.log(k, `${els.length} ways -> kept ${ways.length}, ${ways.reduce((a, w) => a + w.length, 0)} points`);
}
writeFileSync(new URL('../docs/data/tracks.json', import.meta.url), JSON.stringify(out));
console.log('saved', Object.keys(out).length, 'circuits');
