import { S, emit, on } from './state.js';
import { t, lang } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

export const clock = ms => new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const hhmm = ms => new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
export const dayTime = ms => new Date(ms).toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

// ---------- charts ----------
export function chartTheme() {
  if (!window.Chart) return;
  const C = window.Chart;
  C.defaults.font.family = cssVar('--font-body') || 'sans-serif';
  C.defaults.font.size = 12;
  C.defaults.color = cssVar('--muted');
  C.defaults.borderColor = cssVar('--grid');
  C.defaults.animation = false;
  C.defaults.maintainAspectRatio = false;
  C.defaults.plugins.legend.labels.usePointStyle = true;
  C.defaults.plugins.legend.labels.boxWidth = 8;
  C.defaults.plugins.tooltip.backgroundColor = cssVar('--surface-2');
  C.defaults.plugins.tooltip.titleColor = cssVar('--fg');
  C.defaults.plugins.tooltip.bodyColor = cssVar('--fg');
  C.defaults.plugins.tooltip.borderColor = cssVar('--line');
  C.defaults.plugins.tooltip.borderWidth = 1;
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.plugins.tooltip.bodyFont = { family: cssVar('--font-mono'), size: 12 };
}

export function upsertChart(canvas, cfg) {
  const old = window.Chart.getChart(canvas);
  if (old) {
    if (old.config.type === cfg.type) {
      old.data = cfg.data;
      old.options = cfg.options;
      old.update('none');
      return old;
    }
    old.destroy();
  }
  return new window.Chart(canvas, cfg);
}

export const axis = (title, extra = {}) => ({
  title: { display: !!title, text: title, color: cssVar('--muted') },
  grid: { color: cssVar('--grid') },
  border: { color: cssVar('--line') },
  ticks: { color: cssVar('--muted'), maxTicksLimit: 10 },
  ...extra,
});

export function driverStyle(d, extra = {}) {
  return {
    label: d.acr,
    borderColor: d.color,
    backgroundColor: d.color,
    borderDash: d.second ? [6, 4] : [],
    borderWidth: 2,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    tension: 0,
    ...extra,
  };
}

// ---------- driver chips shared between tabs ----------
export function driverChips(container, { quick = true } = {}) {
  container.innerHTML = '';
  const M = S.M;
  if (!M) return;
  const list = [...M.drv.values()].filter(d => M.lapsBy.has(d.num) || M.posLatest.has(d.num)).sort((a, b) => (M.best.get(a.num)?.dur ?? 9999) - (M.best.get(b.num)?.dur ?? 9999));
  const wrap = h('div', { class: 'drvchips' });
  if (quick) {
    const mk = (label, fn) => h('button', { class: 'btn sm', type: 'button', onclick: () => { fn(); S.selTouched = true; emit('selection'); } }, label);
    wrap.append(
      mk(t('chips.top5'), () => setSel(list.slice(0, 5))),
      mk(t('chips.top10'), () => setSel(list.slice(0, 10))),
      mk(t('chips.all'), () => setSel(list)),
      mk(t('chips.none'), () => setSel([])),
      h('span', { class: 'sep' }),
    );
  }
  for (const d of list) {
    const b = h('button', { class: 'dchip', type: 'button', style: `--c:${d.color}`, 'aria-pressed': S.sel.has(d.num), title: `${d.name} · ${d.team}`, onclick: () => {
      if (S.sel.has(d.num)) S.sel.delete(d.num); else S.sel.add(d.num);
      S.selTouched = true;
      emit('selection');
    } }, h('i'), d.acr);
    wrap.append(b);
  }
  container.append(wrap);
}
function setSel(drivers) { S.sel = new Set(drivers.map(d => d.num)); }

// default selection: top 6 once data exists, unless the user already chose
export function ensureSelection() {
  if (S.selTouched || !S.M) return;
  const M = S.M;
  const list = [...M.drv.values()].filter(d => M.best.has(d.num)).sort((a, b) => M.best.get(a.num).dur - M.best.get(b.num).dur);
  if (list.length) S.sel = new Set(list.slice(0, 6).map(d => d.num));
}

export function selectedDrivers() {
  const M = S.M;
  if (!M) return [];
  return [...S.sel].map(n => M.drv.get(n)).filter(Boolean).sort((a, b) => (M.best.get(a.num)?.dur ?? 9999) - (M.best.get(b.num)?.dur ?? 9999));
}

export function drvCell(d, sm = false) {
  return `<div class="drv ${sm ? 'sm' : ''}"><span class="bar" style="background:${esc(d.color)}"></span><div><div class="acr">${esc(d.acr)}</div>${sm ? '' : `<div class="nm">${esc(d.team)}</div>`}</div></div>`;
}

export function emptyState(title, text) {
  return `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;
}

export function onTheme(fn) { on('theme', fn); }

// ---------- canvas helpers ----------
export function fitCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.round(r.width * dpr));
  const hh = Math.max(10, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

// returns (x, y) => [px, py] fitting all points in w×h with padding; y axis flipped
export function projector(points, w, h, pad = 28) {
  let minx = Infinity; let maxx = -Infinity; let miny = Infinity; let maxy = -Infinity;
  for (const p of points) {
    if (p.x == null) continue;
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  if (!isFinite(minx)) return null;
  const dx = Math.max(maxx - minx, 1);
  const dy = Math.max(maxy - miny, 1);
  const s = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy);
  const ox = (w - dx * s) / 2;
  const oy = (h - dy * s) / 2;
  return (x, y) => [ox + (x - minx) * s, h - oy - (y - miny) * s];
}

// sequential ramp (one hue, dark → bright) for speed/gear on the track map
export function ramp(t) {
  t = Math.min(1, Math.max(0, t));
  const light = document.documentElement.dataset.theme === 'light' || (document.documentElement.dataset.theme !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches);
  const a = light ? [190, 228, 245] : [18, 62, 82];
  const b = light ? [6, 70, 120] : [150, 240, 255];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

export const compoundLabel = name => t(`compound.${String(name || 'UNKNOWN').toUpperCase()}`);
