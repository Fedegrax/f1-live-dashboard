import { S } from '../state.js';
import { get, iso } from '../api.js';
import { lastAtOrBefore, stintAt, compoundOf, fmtLap } from '../data.js';
import { $, esc, h, fitCanvas, projector, cssVar, clock } from '../ui.js';

let root;
const CH = 30000; // chunk length (ms)
const R = {
  sessionKey: null, outline: null, chunks: new Map(), version: 0, merged: new Map(),
  t: null, playing: false, speed: 1, live: false, raf: 0, last: 0, timer: 0, active: false, proj: null, projKey: '',
  loading: new Set(), error: '', bounds: null,
};

const range = () => {
  const s = S.session;
  return [Date.parse(s.date_start) - 5 * 60e3, Date.parse(s.date_end) + 5 * 60e3];
};

function resetFor() {
  R.sessionKey = S.session.session_key;
  R.outline = null; R.chunks = new Map(); R.merged = new Map(); R.version++; R.loading = new Set(); R.error = '';
  R.playing = false; R.live = S.state === 'live';
  const M = S.M;
  const [lo] = range();
  const first = M && M.overall.lap ? (M.lapsBy.get(M.overall.lap.driver) || []).find(l => l.lap_number === M.overall.lap.lap)?.t0 : null;
  R.t = R.live ? Date.now() - 6000 : (first ? first + 3000 : lo + 10 * 60e3);
  R.proj = null;
}

async function loadChunk(k) {
  const key = k;
  const [, hi] = range();
  const start = k * CH;
  const end = start + CH;
  const fresh = Date.now() < end + 15000; // chunk may still grow
  const c = R.chunks.get(k);
  if (c && !(fresh && S.state === 'live' && Date.now() - c.loadedAt > 4000)) return;
  if (R.loading.has(key)) return;
  R.loading.add(key);
  try {
    const persist = !fresh && S.state === 'finished' && Date.now() > Date.parse(S.session.date_end) + 3600e3;
    const rows = await get('location', [['session_key', '=', S.session.session_key], ['date', '>=', iso(start)], ['date', '<', iso(end)]], { persist });
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.driver_number)) by.set(r.driver_number, []);
      by.get(r.driver_number).push({ t: Date.parse(r.date), x: r.x, y: r.y });
    }
    for (const a of by.values()) a.sort((p, q) => p.t - q.t);
    R.chunks.set(k, { by, loadedAt: Date.now() });
    R.version++;
    R.error = '';
  } catch (e) {
    R.error = e.kind === 'locked' ? 'La posizione live delle monoposto è riservata agli abbonati OpenF1 (Impostazioni → Accedi). Il replay è gratuito a sessione conclusa.' : e.message;
  } finally { R.loading.delete(key); }
}

function ensureLoaded() {
  const k = Math.floor(R.t / CH);
  const ahead = R.playing ? 3 : 1;
  for (let i = -1; i <= ahead; i++) loadChunk(k + i);
}

function samplesFor(n, k) {
  const key = `${n}:${k}:${R.version}`;
  let arr = R.merged.get(key);
  if (!arr) {
    arr = [];
    for (const kk of [k - 1, k, k + 1]) { const c = R.chunks.get(kk); if (c && c.by.has(n)) arr = arr.concat(c.by.get(n)); }
    R.merged.set(key, arr);
    if (R.merged.size > 400) R.merged = new Map([[key, arr]]);
  }
  return arr;
}

function pos(n, t) {
  const arr = samplesFor(n, Math.floor(t / CH));
  const i = lastAtOrBefore(arr, t);
  if (i < 0) return null;
  const a = arr[i];
  const b = arr[i + 1];
  if (b && b.t - a.t < 2500) { const f = (t - a.t) / (b.t - a.t); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
  return t - a.t < 3000 ? { x: a.x, y: a.y } : null;
}

async function ensureOutline() {
  const M = S.M;
  if (R.outline || !M || !M.overall.lap || R.outlineBusy) return;
  const { driver, lap } = M.overall.lap;
  const l = (M.lapsBy.get(driver) || []).find(x => x.lap_number === lap);
  if (!l || l.t0 == null) return;
  R.outlineBusy = true;
  try {
    const persist = S.state === 'finished';
    const rows = await get('location', [['session_key', '=', S.session.session_key], ['driver_number', '=', driver], ['date', '>=', iso(l.t0)], ['date', '<=', iso(l.t0 + l.lap_duration * 1000)]], { persist });
    if (rows.length > 20) { R.outline = rows.map(r => ({ x: r.x, y: r.y })); R.proj = null; }
  } catch { /* outline stays empty; dots still draw */ }
  R.outlineBusy = false;
}

function board(t) {
  const M = S.M;
  const rows = [];
  for (const [n, arr] of M.posSeries) {
    const i = lastAtOrBefore(arr, t);
    if (i >= 0) rows.push({ n, p: arr[i].pos });
  }
  rows.sort((a, b) => a.p - b.p);
  return rows.slice(0, 22).map(r => {
    const d = M.drv.get(r.n);
    const laps = M.lapsBy.get(r.n) || [];
    const cur = laps.find(l => l.t0 != null && l.t0 <= t && (l.t1 == null || t < l.t1));
    const st = cur ? stintAt(M, r.n, cur.lap_number) : null;
    const c = st ? compoundOf(st.compound) : null;
    return `<div><span class="num">${r.p}</span><i style="background:${esc(d.color)}"></i><span><b style="font-family:var(--font-display);font-size:14px">${esc(d.acr)}</b> ${c ? `<span class="tyre" style="vertical-align:middle"><i style="border-color:${c.color};width:12px;height:12px;border-width:3px;display:inline-block;border-radius:50%"></i></span>` : ''} <span class="muted">${cur ? `G${cur.lap_number}` : ''}</span></span></div>`;
  }).join('');
}

function draw() {
  const canvas = $('#rp-canvas', root);
  if (!canvas || !S.M) return;
  const { ctx, w, h: hh } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, hh);
  const t = R.t;
  const M = S.M;
  const live = [];
  for (const n of M.drv.keys()) { const p = pos(n, t); if (p) live.push({ n, ...p }); }
  const fitPts = R.outline || live;
  const key = `${w}x${hh}:${R.outline ? 'o' : 'd'}:${R.outline ? R.outline.length : 0}`;
  if (!R.proj || R.projKey !== key) {
    const pts = R.outline || [...R.chunks.values()].flatMap(c => [...c.by.values()].flatMap(a => a.filter((_, i) => i % 6 === 0)));
    R.proj = projector(pts.length ? pts : live, w, hh, 36);
    R.projKey = key;
  }
  const P = R.proj;
  if (!P) { ctx.fillStyle = cssVar('--muted'); ctx.font = '14px ' + cssVar('--font-body'); ctx.textAlign = 'center'; ctx.fillText(R.error || 'In attesa dei dati di posizione…', w / 2, hh / 2); return; }
  if (R.outline) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [lw, col] of [[16, cssVar('--line')], [8, cssVar('--surface')]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      R.outline.forEach((p, i) => { const [x, y] = P(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
    }
  }
  ctx.font = '700 11px ' + cssVar('--font-body'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  live.sort((a, b) => (S.sel.has(a.n) ? 1 : 0) - (S.sel.has(b.n) ? 1 : 0));
  for (const p of live) {
    const d = M.drv.get(p.n);
    const [x, y] = P(p.x, p.y);
    const sel = S.sel.has(p.n);
    ctx.fillStyle = d.color; ctx.strokeStyle = cssVar('--bg'); ctx.lineWidth = sel ? 3 : 2;
    ctx.beginPath(); ctx.arc(x, y, sel ? 8 : 6, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = cssVar('--fg'); ctx.fillText(d.acr, x + 11, y);
  }
  if (!live.length) { ctx.fillStyle = cssVar('--muted'); ctx.font = '14px ' + cssVar('--font-body'); ctx.textAlign = 'center'; ctx.fillText(R.loading.size ? 'Carico le posizioni…' : (R.error || 'Nessuna monoposto in pista in questo istante'), w / 2, hh - 24); }
}

function ui() {
  const [lo, hi] = range();
  const sl = $('#rp-slider', root);
  sl.min = 0; sl.max = Math.round((hi - lo) / 1000);
  if (document.activeElement !== sl) sl.value = Math.round((R.t - lo) / 1000);
  $('#rp-time', root).textContent = `${clock(R.t)}  ·  sessione +${Math.max(0, Math.round((R.t - Date.parse(S.session.date_start)) / 60000))} min`;
  $('#rp-play', root).textContent = R.playing ? '⏸ Pausa' : '▶ Play';
  const lb = $('#rp-live', root);
  lb.hidden = S.state !== 'live';
  lb.setAttribute('aria-pressed', String(R.live));
  $('#rp-board', root).innerHTML = board(R.t);
}

let boardAt = 0;
function frame(ts) {
  if (!R.active) return;
  const dt = R.last ? ts - R.last : 0;
  R.last = ts;
  const [lo, hi] = range();
  if (R.live) R.t = Date.now() - 6000;
  else if (R.playing) { R.t += dt * R.speed; if (R.t >= hi) { R.t = hi; R.playing = false; } }
  if (ts - boardAt > 250) { boardAt = ts; ensureLoaded(); ui(); }
  draw();
  R.raf = requestAnimationFrame(frame);
}

export const map = {
  id: 'map',
  label: 'Mappa & replay',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid side">
        <section class="card"><header><h2>Posizione monoposto</h2><span class="hint spacer" id="rp-hint">Replay della sessione o diretta (con account OpenF1)</span></header>
          <div class="body" style="display:grid;gap:12px">
            <div class="mapwrap mapbox"><canvas id="rp-canvas"></canvas></div>
            <div class="transport">
              <button class="btn primary" id="rp-play" type="button">▶ Play</button>
              <select id="rp-speed" aria-label="Velocità"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option><option value="30">30×</option></select>
              <input id="rp-slider" type="range" min="0" max="100" value="0" aria-label="Posizione nella sessione">
              <button class="btn" id="rp-live" type="button" aria-pressed="false">● LIVE</button>
            </div>
            <div class="num muted" id="rp-time"></div>
          </div></section>
        <section class="card"><header><h2>Ordine di marcia</h2></header><div class="body"><div class="board" id="rp-board"></div></div></section>
      </div>`;
    $('#rp-play', el).addEventListener('click', () => { R.live = false; R.playing = !R.playing; R.last = 0; });
    $('#rp-speed', el).addEventListener('change', e => { R.speed = Number(e.target.value); });
    $('#rp-slider', el).addEventListener('input', e => { const [lo] = range(); R.t = lo + Number(e.target.value) * 1000; R.live = false; ensureLoaded(); });
    $('#rp-live', el).addEventListener('click', () => { R.live = !R.live; R.playing = false; });
  },
  update() {
    if (!S.session) return;
    if (R.sessionKey !== S.session.session_key) resetFor();
    if (S.state === 'live' && R.live === false && R.t == null) R.live = true;
    ensureOutline();
    if (R.active) { ensureLoaded(); ui(); }
  },
  show() {
    if (!S.session) return;
    if (R.sessionKey !== S.session.session_key) resetFor();
    R.active = true; R.last = 0;
    ensureOutline(); ensureLoaded(); ui();
    cancelAnimationFrame(R.raf);
    R.raf = requestAnimationFrame(frame);
  },
  hide() { R.active = false; R.playing = false; cancelAnimationFrame(R.raf); },
};
