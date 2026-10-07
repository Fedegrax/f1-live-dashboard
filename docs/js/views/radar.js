// Rain radar: past radar frames (RainViewer) and a model forecast grid (Open-Meteo) around the circuit.
import { S, on } from '../state.js';
import { t } from '../i18n.js';
import { $, h, esc, upsertChart, axis, cssVar, hhmm } from '../ui.js';
import { circuitLatLon } from '../circuits.js';

const RV = 'https://api.rainviewer.com/public/weather-maps.json';
const GRID = 9; // 9 x 9 forecast points
const SPAN = 0.9; // degrees of latitude covered (~100 km)
const STOPS = [[0.05, [150, 200, 255, 0.3]], [0.5, [90, 160, 255, 0.55]], [2, [60, 190, 120, 0.7]], [5, [250, 215, 60, 0.75]], [10, [250, 140, 40, 0.8]], [20, [230, 50, 70, 0.85]], [40, [200, 60, 220, 0.9]]];

function rainRgba(v) {
  if (!(v >= STOPS[0][0])) return [0, 0, 0, 0];
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [v0, c0] = STOPS[i - 1]; const [v1, c1] = STOPS[i];
      const f = (v - v0) / (v1 - v0);
      return c0.map((x, k) => x + (c1[k] - x) * f);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const isLight = () => document.documentElement.dataset.theme === 'light' || (document.documentElement.dataset.theme !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches);
// OpenStreetMap tiles (override with window.PITWALL.mapTiles for another provider); dark theme is a CSS filter on the base pane only
const baseUrl = () => (window.PITWALL && window.PITWALL.mapTiles) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

class RadarPanel {
  constructor(el, { chart }) {
    this.el = el;
    this.withChart = chart;
    this.horizon = 2; // hours
    this.frames = [];
    this.idx = 0;
    this.timer = 0;
    this.layers = new Map();
    this.shown = null;
    el._panel = this;
    el.innerHTML = `
      <div class="rd-map"></div>
      <div class="rd-controls">
        <button class="btn sm" type="button" data-r="play">▶</button>
        <input type="range" min="0" max="0" value="0" data-r="slider" aria-label="${esc(t('rd.timeline'))}">
        <button class="btn sm" type="button" data-r="now">${esc(t('rd.now'))}</button>
        <div class="seg" data-r="hz"><button type="button" data-h="2" aria-pressed="true">2 h</button><button type="button" data-h="6" aria-pressed="false">6 h</button><button type="button" data-h="24" aria-pressed="false">24 h</button></div>
      </div>
      <div class="rd-label num" data-r="label"></div>
      <div class="rd-legend"><span>${esc(t('rd.legend.light'))}</span><i></i><span>${esc(t('rd.legend.heavy'))}</span></div>
      <div class="rd-summary" data-r="summary"></div>
      ${chart ? '<div class="chartbox short"><canvas data-r="chart"></canvas></div>' : ''}
      <p class="hint" style="margin:6px 0 0">${esc(t('rd.note'))}</p>`;
    const q = k => $(`[data-r="${k}"]`, el);
    this.q = q;
    q('play').addEventListener('click', () => this.toggle());
    q('slider').addEventListener('input', e => { this.stop(); this.go(Number(e.target.value)); });
    q('now').addEventListener('click', () => { this.stop(); this.go(this.nowIndex()); });
    q('hz').addEventListener('click', e => {
      const b = e.target.closest('button[data-h]'); if (!b) return;
      this.horizon = Number(b.dataset.h);
      el.querySelectorAll('[data-r="hz"] button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      this.buildFrames(); this.go(Math.min(this.idx, this.frames.length - 1)); this.drawChart();
    });
    this.themeOff = on('theme', () => this.setBase());
  }

  async setCircuit(meeting) {
    if (!meeting || this.key === meeting.meeting_key) return;
    this.key = meeting.meeting_key;
    const pos = await circuitLatLon(meeting);
    if (!pos) { this.q('summary').textContent = t('rd.err'); return; }
    this.pos = pos;
    this.initMap();
    this.load();
    clearInterval(this.refresher);
    this.refresher = setInterval(() => { if (this.el.isConnected && this.el.offsetParent) this.load(); }, 5 * 60 * 1000);
  }

  initMap() {
    const L = window.L;
    if (this.map) { this.map.remove(); this.layers.clear(); this.shown = null; }
    const { lat, lon } = this.pos;
    this.map = L.map($('.rd-map', this.el), { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 14 }).setView([lat, lon], 8);
    this.map.createPane('basepane').style.zIndex = 150;
    this.base = L.tileLayer(baseUrl(), { pane: 'basepane', maxZoom: 14, attribution: '© OpenStreetMap contributors · RainViewer · Open-Meteo' }).addTo(this.map);
    this.setBase();
    L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#ff3d3d', fillOpacity: 1 }).addTo(this.map).bindTooltip(this.pos.name || t('rd.track'));
    this.loadTrack();
  }

  setBase() { this.el.querySelector('.rd-map')?.classList.toggle('rd-dark', !isLight()); }

  async loadTrack() {
    const { lat, lon } = this.pos;
    const key = `f1d.track.${lat.toFixed(3)},${lon.toFixed(3)}`;
    let ways = null;
    try { ways = JSON.parse(localStorage.getItem(key)); } catch { /* ignore */ }
    if (!ways) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 9000);
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: `data=${encodeURIComponent(`[out:json][timeout:20];way(around:1800,${lat},${lon})["highway"="raceway"];out geom;`)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        clearTimeout(timer);
        const j = await res.json();
        ways = (j.elements || []).map(e => e.geometry.map(g => [g.lat, g.lon]));
        try { localStorage.setItem(key, JSON.stringify(ways)); } catch { /* quota */ }
      } catch { ways = []; }
    }
    for (const w of ways) if (this.map) window.L.polyline(w, { color: cssVar('--accent') || '#3ccfff', weight: 3, opacity: 0.95 }).addTo(this.map);
  }

  async load() {
    const { lat, lon } = this.pos;
    const step = SPAN / (GRID - 1);
    const lonStep = step / Math.cos(lat * Math.PI / 180);
    const lats = []; const lons = [];
    for (let iy = 0; iy < GRID; iy++) for (let ix = 0; ix < GRID; ix++) { lats.push((lat - SPAN / 2 + iy * step).toFixed(3)); lons.push((lon - (GRID - 1) / 2 * lonStep + ix * lonStep).toFixed(3)); }
    this.bounds = [[lat - SPAN / 2 - step / 2, lon - (GRID - 1) / 2 * lonStep - lonStep / 2], [lat + SPAN / 2 + step / 2, lon + (GRID - 1) / 2 * lonStep + lonStep / 2]];
    const [rv, om] = await Promise.allSettled([
      fetch(RV).then(r => r.json()),
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&minutely_15=precipitation&forecast_minutely_15=96&timeformat=unixtime&timezone=GMT`).then(r => r.json()),
    ]);
    this.radar = rv.status === 'fulfilled' ? rv.value : null;
    this.fc = om.status === 'fulfilled' && Array.isArray(om.value) ? om.value : null;
    if (!this.radar && !this.fc) { this.q('summary').textContent = t('rd.err'); return; }
    this.buildFrames();
    this.go(this.nowIndex());
    this.summary();
    this.drawChart();
  }

  buildFrames() {
    const fr = [];
    const now = Date.now();
    if (this.radar) for (const f of this.radar.radar.past || []) fr.push({ t: f.time * 1000, type: 'radar', path: f.path, host: this.radar.host });
    for (const f of (this.radar && this.radar.radar.nowcast) || []) fr.push({ t: f.time * 1000, type: 'radar', path: f.path, host: this.radar.host });
    if (this.fc) {
      const times = this.fc[0].minutely_15.time;
      times.forEach((ts, k) => { const ms = ts * 1000; if (ms > now - 5 * 60e3 && ms <= now + this.horizon * 3600e3 && (this.horizon <= 2 || k % 2 === 0 || this.horizon <= 6)) fr.push({ t: ms, type: 'fc', k }); });
    }
    this.frames = fr.sort((a, b) => a.t - b.t);
    const s = this.q('slider');
    s.max = Math.max(0, this.frames.length - 1);
  }

  nowIndex() {
    let last = 0;
    this.frames.forEach((f, i) => { if (f.type === 'radar' || f.t <= Date.now()) last = i; });
    return last;
  }

  go(i) {
    if (!this.frames.length || !this.map) return;
    this.idx = Math.max(0, Math.min(i, this.frames.length - 1));
    const f = this.frames[this.idx];
    const L = window.L;
    if (this.shown) { this.map.removeLayer(this.shown); this.shown = null; }
    let layer = this.layers.get(this.idx);
    if (!layer) {
      layer = f.type === 'radar'
        ? L.tileLayer(`${f.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.7, maxNativeZoom: 7, maxZoom: 14, zIndex: 5 })
        : L.imageOverlay(this.forecastImage(f.k), this.bounds, { opacity: 0.75, interactive: false, zIndex: 5 });
      this.layers.set(this.idx, layer);
    }
    layer.addTo(this.map);
    this.shown = layer;
    this.q('slider').value = this.idx;
    const mins = Math.round((f.t - Date.now()) / 60000);
    const rel = Math.abs(mins) < 3 ? t('rd.now') : mins < 0 ? t('rd.ago', { m: -mins }) : t('rd.in', { m: mins });
    this.q('label').textContent = `${hhmm(f.t)} · ${f.type === 'radar' ? t('rd.radar') : t('rd.forecast')} · ${rel}`;
  }

  forecastImage(k) {
    const N = GRID; const W = 96;
    const v = (iy, ix) => (this.fc[iy * N + ix].minutely_15.precipitation[k] ?? 0) * 4; // mm/15min -> mm/h
    const c = document.createElement('canvas');
    c.width = W; c.height = W;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, W);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const gy = (1 - y / (W - 1)) * (N - 1); const gx = (x / (W - 1)) * (N - 1); // north is up
        const y0 = Math.floor(gy); const x0 = Math.floor(gx); const y1 = Math.min(N - 1, y0 + 1); const x1 = Math.min(N - 1, x0 + 1);
        const fy = gy - y0; const fx = gx - x0;
        const val = v(y0, x0) * (1 - fx) * (1 - fy) + v(y0, x1) * fx * (1 - fy) + v(y1, x0) * (1 - fx) * fy + v(y1, x1) * fx * fy;
        const [r, g, b, a] = rainRgba(val);
        const o = (y * W + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  series() {
    if (!this.fc) return [];
    const centre = this.fc[(GRID * GRID - 1) / 2].minutely_15;
    return centre.time.map((ts, k) => ({ t: ts * 1000, v: (centre.precipitation[k] ?? 0) * 4 }));
  }

  summary() {
    const s = this.series().filter(p => p.t > Date.now() - 15 * 60e3);
    const el = this.q('summary');
    if (!s.length) { el.textContent = ''; return; }
    const horizon = this.horizon * 3600e3;
    const cur = s[0];
    const next = s.find(p => p.t <= Date.now() + horizon && p.v >= 0.1);
    el.className = 'rd-summary';
    if (cur.v >= 0.1) { el.textContent = t('rd.summary.now', { v: cur.v.toFixed(1) }); el.classList.add('wet'); }
    else if (next) { el.textContent = t('rd.summary.soon', { m: Math.max(1, Math.round((next.t - Date.now()) / 60000)), v: next.v.toFixed(1) }); el.classList.add('wet'); }
    else el.textContent = t('rd.summary.dry', { h: `${this.horizon} h` });
  }

  drawChart() {
    this.summary();
    const canvas = this.q('chart');
    if (!canvas) return;
    const s = this.series().filter(p => p.t > Date.now() - 15 * 60e3 && p.t <= Date.now() + this.horizon * 3600e3);
    const ss = S.session ? [Date.parse(S.session.date_start), Date.parse(S.session.date_end)] : [0, 0];
    upsertChart(canvas, {
      type: 'bar',
      data: { labels: s.map(p => hhmm(p.t)), datasets: [{ label: t('rd.chart.axis'), data: s.map(p => p.v), backgroundColor: s.map(p => (p.t >= ss[0] && p.t <= ss[1] ? cssVar('--accent') : `${cssVar('--muted')}99`)), borderRadius: 2, barPercentage: 1, categoryPercentage: 0.95 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(1)} mm/h` } } }, scales: { x: axis('', { ticks: { maxTicksLimit: 8, color: cssVar('--muted') }, grid: { display: false } }), y: axis(t('rd.chart.axis'), { beginAtZero: true }) } },
    });
  }

  toggle() { this.timer ? this.stop() : this.play(); }
  play() {
    this.q('play').textContent = '❚❚';
    if (this.idx >= this.frames.length - 1) this.go(0);
    this.timer = setInterval(() => { if (this.idx >= this.frames.length - 1) return this.stop(); this.go(this.idx + 1); }, 650);
  }
  stop() { clearInterval(this.timer); this.timer = 0; this.q('play').textContent = '▶'; }
  invalidate() { if (this.map) setTimeout(() => this.map.invalidateSize(), 0); }
  destroy() { this.stop(); clearInterval(this.refresher); this.themeOff?.(); if (this.map) this.map.remove(); this.map = null; }
}

export function radarPanel(el, opts) { return el._panel || new RadarPanel(el, opts); }

export const radar = {
  id: 'radar',
  available: () => true,
  mount(el) { this.root = el; el.innerHTML = '<div class="card"><header><h2>' + t('w.radar') + '</h2></header><div class="body radar-host" id="rd-host"></div></div>'; },
  update() { if (!S.meeting) return; radarPanel($('#rd-host', this.root), { chart: true }).setCircuit(S.meeting); },
  show() { const p = $('#rd-host', this.root)._panel; if (p) p.invalidate(); },
  hide() { const p = $('#rd-host', this.root)._panel; if (p) p.stop(); },
};
