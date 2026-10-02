import { S } from '../state.js';
import { get, iso } from '../api.js';
import { buildTrace, resample, dominance, fmtLap, fmtGap } from '../data.js';
import { $, h, esc, upsertChart, axis, cssVar, fitCanvas, projector, ramp } from '../ui.js';

let root;
const T = { a: null, b: null, mode: 'speed', trA: null, trB: null, rsA: null, rsB: null, hover: null, busy: false, error: '', initFor: null, timer: 0, token: 0 };

const lapOptions = (M, n) => (M.lapsBy.get(n) || []).filter(l => l.lap_duration != null && l.t0 != null);

function bestLapNo(M, n) { return M.best.get(n)?.lap ?? lapOptions(M, n)[0]?.lap_number ?? null; }

function driverList(M) {
  return [...M.drv.values()].filter(d => lapOptions(M, d.num).length).sort((a, b) => (M.best.get(a.num)?.dur ?? 9999) - (M.best.get(b.num)?.dur ?? 9999));
}

function fillSelects() {
  const M = S.M;
  const ds = driverList(M);
  const mkDrv = (id, withNone, val) => {
    const sel = $(id, root);
    sel.innerHTML = (withNone ? '<option value="">— nessuno —</option>' : '') + ds.map(d => `<option value="${d.num}">${esc(d.acr)} · ${esc(d.name)}</option>`).join('');
    sel.value = val == null ? '' : String(val);
  };
  const mkLap = (id, n, val) => {
    const sel = $(id, root);
    if (n == null) { sel.innerHTML = ''; return; }
    const best = M.best.get(n)?.lap;
    sel.innerHTML = lapOptions(M, n).map(l => `<option value="${l.lap_number}">Giro ${l.lap_number} · ${fmtLap(l.lap_duration)}${l.lap_number === best ? ' ★' : ''}${l.is_pit_out_lap ? ' (out)' : ''}</option>`).join('');
    sel.value = String(val);
  };
  mkDrv('#tl-da', false, T.a?.num);
  mkLap('#tl-la', T.a?.num, T.a?.lap);
  mkDrv('#tl-db', true, T.b?.num);
  mkLap('#tl-lb', T.b?.num, T.b?.lap);
}

function initDefaults() {
  const M = S.M;
  const ds = driverList(M);
  if (!ds.length) return false;
  T.a = { num: ds[0].num, lap: bestLapNo(M, ds[0].num) };
  T.b = ds[1] ? { num: ds[1].num, lap: bestLapNo(M, ds[1].num) } : null;
  T.initFor = S.session.session_key;
  return true;
}

async function loadOne(sel) {
  const M = S.M;
  const lap = (M.lapsBy.get(sel.num) || []).find(l => l.lap_number === sel.lap);
  if (!lap || lap.t0 == null || lap.lap_duration == null) throw new Error('Giro senza dati temporali');
  const t0 = lap.t0;
  const t1 = lap.t0 + lap.lap_duration * 1000;
  const f = [['session_key', '=', S.session.session_key], ['driver_number', '=', sel.num], ['date', '>=', iso(t0 - 600)], ['date', '<=', iso(t1 + 600)]];
  const persist = S.state === 'finished' && Date.now() > Date.parse(S.session.date_end) + 3600e3;
  const [car, loc] = await Promise.all([get('car_data', f, { persist }), get('location', f, { persist })]);
  const tr = buildTrace(car, loc, t0, t1);
  if (!tr) throw new Error('Telemetria non disponibile per questo giro');
  return tr;
}

async function load() {
  if (!T.a) return;
  const mine = ++T.token;
  T.busy = true; T.error = '';
  render();
  try {
    const [ta, tb] = await Promise.all([loadOne(T.a), T.b ? loadOne(T.b) : Promise.resolve(null)]);
    if (mine !== T.token) return;
    T.trA = ta; T.trB = tb;
    T.rsA = resample(ta, 400);
    T.rsB = tb ? resample(tb, 400) : null;
  } catch (e) {
    if (mine !== T.token) return;
    T.trA = T.trB = T.rsA = T.rsB = null;
    T.error = e.kind === 'locked' ? 'La telemetria live è riservata agli abbonati OpenF1 (Impostazioni → Accedi).' : e.kind === 'too-much' ? 'Troppi dati richiesti per questo giro.' : e.message || 'Errore nel caricamento';
  }
  T.busy = false;
  render();
}

const schedule = () => { clearTimeout(T.timer); T.timer = setTimeout(load, 250); };

function lineColors() {
  const M = S.M;
  const da = M.drv.get(T.a.num);
  const db = T.b ? M.drv.get(T.b.num) : null;
  return { da, db, ca: da.color, cb: db ? (db.color.toLowerCase() === da.color.toLowerCase() ? cssVar('--fg') : db.color) : null, dashB: db && db.color.toLowerCase() === da.color.toLowerCase() };
}

const syncPlugin = {
  id: 'sync',
  afterDraw(chart) {
    if (T.hover == null || !T.trA) return;
    const x = chart.scales.x.getPixelForValue(T.hover * T.trA.length);
    const { top, bottom } = chart.chartArea;
    const c = chart.ctx;
    c.save(); c.strokeStyle = cssVar('--fg'); c.globalAlpha = 0.55; c.lineWidth = 1; c.setLineDash([4, 3]);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); c.restore();
  },
};

function makeChart(id, key, title, opts = {}) {
  const { da, db, ca, cb, dashB } = lineColors();
  const len = T.trA.length;
  const pts = rs => rs.map(r => ({ x: r.frac * len, y: r[key] }));
  const ds = [{ label: da.acr, data: pts(T.rsA), borderColor: ca, backgroundColor: ca, borderWidth: 1.8, pointRadius: 0, stepped: opts.stepped || false, parsing: false, normalized: true }];
  if (T.rsB) ds.push({ label: db.acr, data: pts(T.rsB), borderColor: cb, backgroundColor: cb, borderWidth: 1.8, borderDash: dashB ? [6, 4] : [], pointRadius: 0, stepped: opts.stepped || false, parsing: false, normalized: true });
  const ch = upsertChart($(id, root), {
    type: 'line',
    data: { datasets: ds },
    plugins: [syncPlugin],
    options: {
      interaction: { mode: 'index', intersect: false },
      onHover: (e, _els, chart) => {
        const v = chart.scales.x.getValueForPixel(e.x);
        if (v == null) return;
        T.hover = Math.min(1, Math.max(0, v / len));
        redrawLinked();
      },
      plugins: { legend: { display: ds.length > 1 || id === '#c-t-speed' }, tooltip: { callbacks: { title: i => `${Math.round(i[0].parsed.x)} m`, label: c => ` ${c.dataset.label}  ${opts.fmt ? opts.fmt(c.parsed.y) : Math.round(c.parsed.y)}` } } },
      scales: { x: axis('Distanza (m)', { type: 'linear', min: 0, max: len, ticks: { color: cssVar('--muted'), maxTicksLimit: 12 } }), y: axis(title, opts.y || {}) },
    },
  });
  return ch;
}

function deltaChart() {
  if (!T.rsB) { const old = window.Chart.getChart($('#c-t-delta', root)); if (old) old.destroy(); return null; }
  const { da, db, ca, cb } = lineColors();
  const len = T.trA.length;
  const data = T.rsA.map((r, i) => ({ x: r.frac * len, y: T.rsB[i].t - r.t }));
  return upsertChart($('#c-t-delta', root), {
    type: 'line',
    data: { datasets: [{ label: `${db.acr} − ${da.acr}`, data, borderColor: cssVar('--accent'), backgroundColor: `${cssVar('--accent')}33`, fill: { target: 'origin' }, borderWidth: 2, pointRadius: 0, parsing: false, normalized: true }] },
    plugins: [syncPlugin],
    options: {
      interaction: { mode: 'index', intersect: false },
      onHover: (e, _els, chart) => { const v = chart.scales.x.getValueForPixel(e.x); if (v == null) return; T.hover = Math.min(1, Math.max(0, v / len)); redrawLinked(); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${Math.round(i[0].parsed.x)} m`, label: c => ` ${c.parsed.y >= 0 ? da.acr + ' davanti di' : db.acr + ' davanti di'} ${Math.abs(c.parsed.y).toFixed(3)} s` } } },
      scales: { x: axis('Distanza (m)', { type: 'linear', min: 0, max: len }), y: axis(`Δ tempo ${db.acr} − ${da.acr} (s)`) },
    },
  });
}

function redrawLinked() {
  for (const id of ['#c-t-speed', '#c-t-throttle', '#c-t-brake', '#c-t-gear', '#c-t-delta']) {
    const c = window.Chart.getChart($(id, root));
    if (c) c.draw();
  }
  drawMap();
}

function drawMap() {
  const canvas = $('#tl-map', root);
  if (!canvas || !T.rsA) return;
  const { ctx, w, h: hh } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, hh);
  const pts = T.rsA.filter(p => p.x != null);
  const P = projector(pts, w, hh);
  if (!P) return;
  const { ca, cb } = lineColors();
  const dom = T.rsB && T.mode === 'dom' ? dominance(T.rsA, T.rsB) : null;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // track base
  ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 12;
  ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  const vmax = Math.max(...T.rsA.map(r => r.speed)); const vmin = Math.min(...T.rsA.map(r => r.speed));
  ctx.lineWidth = 6;
  for (let i = 1; i < T.rsA.length; i++) {
    const a = T.rsA[i - 1]; const b = T.rsA[i];
    if (a.x == null || b.x == null) continue;
    let col;
    if (T.mode === 'speed') col = ramp((b.speed - vmin) / Math.max(1, vmax - vmin));
    else if (T.mode === 'gear') col = ramp((b.gear - 1) / 7);
    else if (T.mode === 'pedals') col = b.brake > 0 ? cssVar('--live') : b.throttle >= 95 ? cssVar('--good') : b.throttle > 10 ? cssVar('--warn') : cssVar('--muted');
    else if (dom) { const seg = dom.find(s => i >= s.i0 && i <= s.i1); col = seg && seg.winner === 'b' ? cb : ca; } else col = ca;
    ctx.strokeStyle = col;
    const [x0, y0] = P(a.x, a.y); const [x1, y1] = P(b.x, b.y);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  // start/finish
  const [sx, sy] = P(pts[0].x, pts[0].y);
  ctx.fillStyle = cssVar('--fg'); ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.fill();
  ctx.font = '600 11px ' + cssVar('--font-body'); ctx.fillText('S/F', sx + 8, sy - 8);
  // hover markers
  if (T.hover != null) {
    const i = Math.round(T.hover * (T.rsA.length - 1));
    const mark = (r, col) => { if (!r || r.x == null) return; const [x, y] = P(r.x, r.y); ctx.fillStyle = col; ctx.strokeStyle = cssVar('--bg'); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.stroke(); };
    mark(T.rsA[i], ca);
    if (T.rsB) { const rb = T.rsB[i]; if (rb && rb.x != null) { const pa = T.rsA[i]; if (pa.x != null) { /* B drawn on A's line (aligned by distance) */ const [x, y] = P(pa.x, pa.y); ctx.fillStyle = cb; ctx.strokeStyle = cssVar('--bg'); ctx.beginPath(); ctx.arc(x + 0, y - 0, 4, 0, 7); ctx.fill(); ctx.stroke(); } } }
  }
}

function legendFor() {
  const el = $('#tl-legend', root);
  if (!T.rsA) { el.innerHTML = ''; return; }
  const { da, db, ca, cb } = lineColors();
  const vmax = Math.max(...T.rsA.map(r => r.speed)); const vmin = Math.min(...T.rsA.map(r => r.speed));
  let html = '';
  if (T.mode === 'speed') html = `<span>${Math.round(vmin)} km/h</span><span style="display:inline-block;width:140px;height:10px;border-radius:5px;background:linear-gradient(90deg,${ramp(0)},${ramp(1)})"></span><span>${Math.round(vmax)} km/h</span>`;
  else if (T.mode === 'gear') html = `<span>1ª</span><span style="display:inline-block;width:140px;height:10px;border-radius:5px;background:linear-gradient(90deg,${ramp(0)},${ramp(1)})"></span><span>8ª</span>`;
  else if (T.mode === 'pedals') html = `<span><i style="background:${cssVar('--good')}"></i>Gas a fondo</span><span><i style="background:${cssVar('--warn')}"></i>Parzializzazione</span><span><i style="background:${cssVar('--muted')}"></i>Rilascio</span><span><i style="background:${cssVar('--live')}"></i>Freno</span>`;
  else if (T.mode === 'dom') html = db ? `<span><i style="background:${ca}"></i>${esc(da.acr)} più veloce</span><span><i style="background:${cb}"></i>${esc(db.acr)} più veloce</span>` : '<span>Scegli un secondo pilota per il confronto</span>';
  el.innerHTML = html;
}

function stats(rs, lap) {
  const n = rs.length;
  const sp = rs.map(r => r.speed);
  let shifts = 0; let brakes = 0;
  for (let i = 1; i < n; i++) { if (rs[i].gear !== rs[i - 1].gear) shifts++; if (rs[i].brake > 0 && !(rs[i - 1].brake > 0)) brakes++; }
  return {
    time: lap.lap_duration, vmax: Math.max(...sp), vmin: Math.min(...sp), vavg: sp.reduce((a, b) => a + b, 0) / n,
    full: rs.filter(r => r.throttle >= 98).length / n * 100, brake: rs.filter(r => r.brake > 0).length / n * 100, shifts, brakes,
    s: [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3],
  };
}

function statsTable() {
  const el = $('#tl-stats', root);
  if (!T.rsA) { el.innerHTML = ''; return; }
  const M = S.M;
  const la = (M.lapsBy.get(T.a.num) || []).find(l => l.lap_number === T.a.lap);
  const sa = stats(T.rsA, la);
  let sb = null;
  if (T.rsB) { const lb = (M.lapsBy.get(T.b.num) || []).find(l => l.lap_number === T.b.lap); sb = stats(T.rsB, lb); }
  const da = M.drv.get(T.a.num); const db = T.b ? M.drv.get(T.b.num) : null;
  const rows = [
    ['Tempo', s => fmtLap(s.time)], ['Settore 1', s => s.s[0]?.toFixed(3) ?? '–'], ['Settore 2', s => s.s[1]?.toFixed(3) ?? '–'], ['Settore 3', s => s.s[2]?.toFixed(3) ?? '–'],
    ['Vel. massima', s => `${Math.round(s.vmax)} km/h`], ['Vel. minima', s => `${Math.round(s.vmin)} km/h`], ['Vel. media', s => `${Math.round(s.vavg)} km/h`],
    ['Gas a fondo', s => `${s.full.toFixed(0)}%`], ['In frenata', s => `${s.brake.toFixed(0)}%`], ['Staccate', s => String(s.brakes)], ['Cambiate', s => String(s.shifts)],
  ];
  el.innerHTML = `<div class="scroll"><table><thead><tr><th class="l"></th><th>${esc(da.acr)} · G${T.a.lap}</th>${sb ? `<th>${esc(db.acr)} · G${T.b.lap}</th><th>Δ</th>` : ''}</tr></thead><tbody>${rows.map(([k, f], i) => {
    const d = sb && i === 0 ? fmtGap(sb.time - sa.time, true) : sb && i >= 1 && i <= 3 ? fmtGap((sb.s[i - 1] ?? NaN) - (sa.s[i - 1] ?? NaN), true) : '';
    return `<tr><td class="l muted">${k}</td><td>${f(sa)}</td>${sb ? `<td>${f(sb)}</td><td>${d}</td>` : ''}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function render() {
  if (!S.M) return;
  const status = $('#tl-status', root);
  $('#tl-main', root).hidden = !T.rsA;
  status.innerHTML = T.busy ? '<div class="loading">Scarico telemetria…</div>' : T.error ? `<div class="banner err"><p>${esc(T.error)}</p></div>` : T.rsA ? '' : '<div class="empty"><b>Scegli un giro</b>Seleziona pilota e giro per vedere telemetria e mappa.</div>';
  if (!T.rsA) return;
  makeChart('#c-t-speed', 'speed', 'km/h', { y: { min: 0 } });
  makeChart('#c-t-throttle', 'throttle', 'Acceleratore %', { y: { min: 0, max: 100 } });
  makeChart('#c-t-brake', 'brake', 'Freno', { stepped: true, y: { min: 0, max: 100, ticks: { callback: v => (v === 100 ? 'ON' : v === 0 ? 'OFF' : '') } }, fmt: v => (v > 0 ? 'ON' : 'OFF') });
  makeChart('#c-t-gear', 'gear', 'Marcia', { stepped: true, y: { min: 0, max: 9, ticks: { stepSize: 1 } } });
  deltaChart();
  $('#tl-delta-card', root).hidden = !T.rsB;
  legendFor(); statsTable(); drawMap();
}

export const telemetry = {
  id: 'telemetry',
  label: 'Telemetria',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid">
        <section class="card"><header><h2>Confronto giri</h2></header>
          <div class="body"><div class="controls">
            <label>Pilota A <select id="tl-da"></select></label><label>Giro <select id="tl-la"></select></label>
            <span class="sep"></span>
            <label>Pilota B <select id="tl-db"></select></label><label>Giro <select id="tl-lb"></select></label>
          </div></div></section>
        <div id="tl-status"></div>
        <div id="tl-main" class="grid" hidden>
          <div class="grid side">
            <section class="card"><header><h2>Mappa del giro</h2>
              <div class="seg spacer" id="tl-mode">
                <button type="button" data-m="speed" aria-pressed="true">Velocità</button><button type="button" data-m="gear" aria-pressed="false">Marcia</button><button type="button" data-m="pedals" aria-pressed="false">Pedali</button><button type="button" data-m="dom" aria-pressed="false">Dominio A/B</button>
              </div></header>
              <div class="body"><div class="mapwrap mapbox sm"><canvas id="tl-map"></canvas></div><div class="legend" id="tl-legend" style="margin-top:10px"></div></div></section>
            <section class="card"><header><h2>Numeri del giro</h2></header><div id="tl-stats"></div></section>
          </div>
          <section class="card"><header><h2>Velocità</h2><span class="hint spacer">Passa il mouse sul grafico: il punto si muove sulla mappa</span></header><div class="body"><div class="chartbox"><canvas id="c-t-speed"></canvas></div></div></section>
          <section class="card" id="tl-delta-card"><header><h2>Delta tempo</h2></header><div class="body"><div class="chartbox short"><canvas id="c-t-delta"></canvas></div></div></section>
          <div class="grid cols-3">
            <section class="card"><header><h2>Acceleratore</h2></header><div class="body"><div class="chartbox short"><canvas id="c-t-throttle"></canvas></div></div></section>
            <section class="card"><header><h2>Freno</h2></header><div class="body"><div class="chartbox short"><canvas id="c-t-brake"></canvas></div></div></section>
            <section class="card"><header><h2>Marcia</h2></header><div class="body"><div class="chartbox short"><canvas id="c-t-gear"></canvas></div></div></section>
          </div>
        </div>
      </div>`;
    const sync = () => {
      const num = id => ($(id, el).value === '' ? null : Number($(id, el).value));
      const M = S.M;
      const a = num('#tl-da'); const b = num('#tl-db');
      const keepA = T.a && T.a.num === a;
      const keepB = T.b && T.b.num === b;
      T.a = a == null ? null : { num: a, lap: keepA ? Number($('#tl-la', el).value) : bestLapNo(M, a) };
      T.b = b == null ? null : { num: b, lap: keepB ? Number($('#tl-lb', el).value) : bestLapNo(M, b) };
      fillSelects();
      schedule();
    };
    for (const id of ['#tl-da', '#tl-la', '#tl-db', '#tl-lb']) $(id, el).addEventListener('change', sync);
    $('#tl-mode', el).addEventListener('click', e => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      T.mode = b.dataset.m;
      el.querySelectorAll('#tl-mode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      legendFor(); drawMap();
    });
    $('#tl-map', el).addEventListener('mouseleave', () => { T.hover = null; redrawLinked(); });
    $('#tl-map', el).addEventListener('mousemove', e => {
      if (!T.rsA) return;
      const r = e.target.getBoundingClientRect();
      const { w, h: hh } = { w: r.width, h: r.height };
      const P = projector(T.rsA.filter(p => p.x != null), w, hh);
      if (!P) return;
      let best = 0; let bd = Infinity;
      T.rsA.forEach((p, i) => { if (p.x == null) return; const [x, y] = P(p.x, p.y); const d = (x - (e.clientX - r.left)) ** 2 + (y - (e.clientY - r.top)) ** 2; if (d < bd) { bd = d; best = i; } });
      T.hover = best / (T.rsA.length - 1);
      redrawLinked();
    });
    window.addEventListener('resize', () => { if (el.classList.contains('active')) drawMap(); });
  },
  update() {
    const M = S.M;
    if (!M || !M.laps.length) { $('#tl-status', root).innerHTML = '<div class="empty"><b>Nessun giro disponibile</b>La telemetria si sblocca dopo i primi giri.</div>'; $('#tl-main', root).hidden = true; return; }
    if (T.initFor !== S.session.session_key) {
      T.trA = T.trB = T.rsA = T.rsB = null; T.error = '';
      if (initDefaults()) { fillSelects(); load(); }
    } else {
      fillSelects();
    }
  },
  show() { if (T.rsA) setTimeout(() => { render(); }, 0); },
};
