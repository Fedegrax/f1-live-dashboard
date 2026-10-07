// Customisable dashboard: pick widgets, reorder them, resize them. The layout is saved in the browser.
import { S, on } from '../state.js';
import { t } from '../i18n.js';
import { $, h, esc, driverChips, emptyState, isCompact } from '../ui.js';
import { timingRows } from '../data.js';
import { towerHtml, driverDialog, rcList } from './overview.js';
import { timeline } from './strategy.js';
import { renderWidget as lapsWidget } from './laps.js';
import { renderWidget as raceWidget } from './race.js';
import { renderWidget as sectorsWidget } from './sectors.js';
import { renderWidget as feedWidget } from './feed.js';
import { radarPanel } from './radar.js';
import { driversHtml, teamsHtml, noteText, compute as champCompute } from './championship.js';

const LS = 'f1d.layout.v1';
const SPANS = [[4, '⅓'], [6, '½'], [8, '⅔'], [12, '1']];
const HEIGHTS = [[220, 'S'], [320, 'M'], [480, 'L'], [680, 'XL']];

// type -> definition. body(): static markup; update(el): fill it; race: only meaningful in races
const WIDGETS = {
  standings: { span: 6, h: 480, body: () => '<div class="wscroll" data-role="tower"></div>', update(el) {
    const M = S.M;
    const box = $('[data-role="tower"]', el);
    const rows = M ? timingRows(M, S.kind) : [];
    box.innerHTML = rows.length ? towerHtml(M, S.kind, rows) : emptyState(t('empty.nodata.title'), t('empty.nodata.text'));
  } },
  laptimes: { span: 6, h: 480, body: () => '<div class="controls" id="lap-controls"></div><div class="chartbox fill"><canvas id="c-laps"></canvas></div>', update: el => lapsWidget(el, 'laptimes') },
  pace: { span: 6, h: 320, body: () => '<div class="chartbox fill"><canvas id="c-pace"></canvas></div>', update: el => lapsWidget(el, 'pace') },
  degradation: { span: 6, h: 320, body: () => '<div class="controls" id="deg-controls"></div><div class="chartbox fill"><canvas id="c-deg"></canvas></div><div id="deg-table"></div>', update: el => lapsWidget(el, 'degradation') },
  positions: { race: true, span: 6, h: 320, body: () => '<div class="chartbox fill"><canvas id="c-pos"></canvas></div>', update: el => raceWidget(el, 'positions') },
  gaps: { race: true, span: 6, h: 320, body: () => '<div class="chartbox fill"><canvas id="c-gap"></canvas></div>', update: el => raceWidget(el, 'gaps') },
  stints: { span: 12, h: 320, body: () => '<div class="wscroll" data-role="stints"></div>', update(el) {
    const M = S.M;
    $('[data-role="stints"]', el).innerHTML = M && M.stintsBy.size ? timeline(M) : emptyState(t('st.empty.title'), t('st.empty.text'));
  } },
  sectors: { span: 6, h: 320, body: () => '<div class="wscroll" id="sec-table"></div>', update: el => sectorsWidget(el) },
  weather: { span: 6, h: 220, body: () => '<div class="two"><div class="chartbox fill"><canvas id="c-temp"></canvas></div><div class="chartbox fill"><canvas id="c-wind"></canvas></div></div>', update: el => feedWidget(el) },
  champdrivers: { span: 6, h: 480, body: () => '<div class="wscroll" data-role="champ"></div><p class="hint" data-role="note" style="margin:6px 2px 0"></p>', update(el) {
    const ch = champCompute();
    $('[data-role="champ"]', el).innerHTML = driversHtml(ch);
    $('[data-role="note"]', el).textContent = noteText(ch);
  } },
  champteams: { span: 6, h: 320, body: () => '<div class="wscroll" data-role="champ"></div>', update(el) { $('[data-role="champ"]', el).innerHTML = teamsHtml(champCompute()); } },
  radar: { span: 6, h: 480, body: () => '<div class="radar-host"></div>', update(el) { if (S.meeting) radarPanel($('.radar-host', el), { chart: false }).setCircuit(S.meeting); } },
  racecontrol: { span: 6, h: 320, body: () => '<ul class="feed" data-role="rc"></ul>', update(el) {
    const M = S.M;
    $('[data-role="rc"]', el).innerHTML = M && M.rc.length ? rcList(M, 40) : `<li><span></span><span></span><span class="muted">${t('rc.none')}</span></li>`;
  } },
};

const preset = (...items) => items.map(([id, span, hh]) => ({ id, span: span ?? WIDGETS[id].span, h: hh ?? WIDGETS[id].h }));
const PRESETS = {
  race: () => preset(['standings', 6, 680], ['laptimes', 6, 320], ['degradation', 6, 320], ['champdrivers', 6, 480], ['pace', 6, 320], ['radar', 6, 480], ['positions'], ['gaps'], ['stints'], ['racecontrol'], ['weather']),
  practice: () => preset(['standings', 6, 680], ['laptimes', 6, 320], ['pace', 6, 320], ['degradation', 6, 320], ['sectors'], ['stints'], ['weather'], ['racecontrol']),
  quali: () => preset(['standings', 6, 680], ['laptimes', 6, 320], ['sectors', 6, 320], ['racecontrol', 6, 320]),
  all: () => preset(...Object.keys(WIDGETS).map(k => [k])),
};

let root;
let layout = null;
let editing = false;
let built = '';

function defaultFor() {
  return PRESETS[S.kind?.race ? 'race' : S.kind?.quali ? 'quali' : 'practice']();
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(LS));
    if (Array.isArray(v) && v.every(w => WIDGETS[w.id])) return v;
  } catch { /* fall through */ }
  return null;
}
function save() { try { localStorage.setItem(LS, JSON.stringify(layout)); } catch { /* ignore */ } }
let layoutKind = '';
const kindKey = () => (S.kind?.race ? 'race' : S.kind?.quali ? 'quali' : 'practice');
const current = () => {
  if (!layout) { const saved = load(); layout = saved || defaultFor(); layoutKind = saved ? '' : kindKey(); }
  return layout;
};

function destroyCharts(el) {
  for (const r of el.querySelectorAll('.radar-host')) r._panel?.destroy();
  for (const c of el.querySelectorAll('canvas')) window.Chart?.getChart(c)?.destroy();
}

function widgetEl(item) {
  const def = WIDGETS[item.id];
  const el = h('section', { class: 'card widget', 'data-id': item.id, style: `--span:${item.span};--wh:${item.h}px` });
  const tools = h('div', { class: 'wtools' },
    h('select', { 'aria-label': t('dash.width'), onchange: e => { item.span = Number(e.target.value); save(); el.style.setProperty('--span', item.span); resizeCharts(el); } },
      ...SPANS.map(([v, l]) => h('option', { value: v, selected: v === item.span }, l))),
    h('select', { 'aria-label': t('dash.height'), onchange: e => { item.h = Number(e.target.value); save(); el.style.setProperty('--wh', `${item.h}px`); resizeCharts(el); } },
      ...HEIGHTS.map(([v, l]) => h('option', { value: v, selected: v === item.h }, l))),
    h('button', { class: 'btn sm', type: 'button', title: t('dash.up'), onclick: () => move(item.id, -1) }, '←'),
    h('button', { class: 'btn sm', type: 'button', title: t('dash.down'), onclick: () => move(item.id, 1) }, '→'),
    h('button', { class: 'btn sm', type: 'button', title: t('dash.remove'), onclick: () => { removeWidget(item.id); } }, '✕'));
  el.append(
    h('header', {}, h('span', { class: 'wdrag', title: t('dash.drag'), draggable: 'true' }, '⠿'), h('h2', {}, t(`w.${item.id}`)), tools),
    h('div', { class: 'body wbody', html: def.body() }));
  // drag and drop reordering
  const handle = $('.wdrag', el);
  handle.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  handle.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('over');
    const from = e.dataTransfer.getData('text/plain');
    if (from && from !== item.id) reorder(from, item.id);
  });
  return el;
}

function resizeCharts(el) { setTimeout(() => { el.querySelectorAll('canvas').forEach(c => window.Chart?.getChart(c)?.resize()); el.querySelectorAll('.radar-host').forEach(r => r._panel?.invalidate()); }, 0); }

function reorder(fromId, beforeId) {
  const L = current();
  const i = L.findIndex(w => w.id === fromId);
  const [it] = L.splice(i, 1);
  L.splice(L.findIndex(w => w.id === beforeId), 0, it);
  save(); rebuild();
}
function move(id, dir) {
  const L = current();
  const i = L.findIndex(w => w.id === id);
  const j = i + dir;
  if (j < 0 || j >= L.length) return;
  [L[i], L[j]] = [L[j], L[i]];
  save(); rebuild();
}
function removeWidget(id) { layout = current().filter(w => w.id !== id); save(); rebuild(); }
function addWidget(id) { if (!WIDGETS[id] || current().some(w => w.id === id)) return; current().push({ id, span: WIDGETS[id].span, h: WIDGETS[id].h }); save(); rebuild(); }
function applyPreset(name) { layout = PRESETS[name](); save(); rebuild(); }

function toolbar() {
  const bar = $('#dash-bar', root);
  bar.innerHTML = '';
  bar.append(h('button', { class: 'btn', type: 'button', 'aria-pressed': editing, onclick: () => { editing = !editing; toolbar(); root.classList.toggle('editing', editing); } }, editing ? t('dash.done') : t('dash.edit')));
  if (editing) {
    const free = Object.keys(WIDGETS).filter(k => !current().some(w => w.id === k));
    bar.append(
      h('select', { 'aria-label': t('dash.add'), onchange: e => { if (e.target.value) addWidget(e.target.value); } },
        h('option', { value: '' }, `+ ${t('dash.add')}`), ...free.map(k => h('option', { value: k }, t(`w.${k}`)))),
      h('select', { 'aria-label': t('dash.preset'), onchange: e => { if (e.target.value) applyPreset(e.target.value); e.target.value = ''; } },
        h('option', { value: '' }, t('dash.preset')), ...Object.keys(PRESETS).map(k => h('option', { value: k }, t(`dash.preset.${k}`)))),
      h('button', { class: 'btn', type: 'button', onclick: () => { layout = null; try { localStorage.removeItem(LS); } catch { /* ignore */ } rebuild(); } }, t('dash.reset')),
      h('span', { class: 'hint' }, t('dash.hint')));
  }
}

function rebuild() {
  const grid = $('#dash-grid', root);
  destroyCharts(grid);
  grid.innerHTML = '';
  const L = current();
  if (!L.length) { grid.innerHTML = `<div class="card">${emptyState(t('dash.empty.title'), t('dash.empty.text'))}</div>`; }
  for (const item of L) grid.append(widgetEl(item));
  built = L.map(w => w.id).join();
  toolbar();
  updateAll();
}

function updateAll() {
  if (!S.session) return;
  for (const el of $('#dash-grid', root).querySelectorAll('.widget')) {
    const id = el.dataset.id;
    const def = WIDGETS[id];
    const body = $('.wbody', el);
    if (def.race && !S.kind.race) {
      if (!body.dataset.na) { destroyCharts(body); body.dataset.na = '1'; body.innerHTML = emptyState(t('dash.na.title'), t('dash.na.text')); }
      continue;
    }
    if (body.dataset.na) { delete body.dataset.na; body.innerHTML = def.body(); delete el.dataset.sig; }
    try { def.update(body); } catch (e) { console.error(id, e); }
  }
}

export const dashboard = {
  id: 'dashboard',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid">
        <div class="dash-top">
          <details class="card drivers" id="dash-drivers"${isCompact() ? '' : ' open'}><summary><h2>${t('dash.drivers')}</h2><span class="muted" id="dash-count"></span></summary><div class="body"><div id="dash-chips"></div></div></details>
          <div id="dash-bar" class="wbar"></div>
        </div>
        <div id="dash-grid" class="dash-grid"></div>
      </div>`;
    el.addEventListener('click', e => {
      const tr = e.target.closest('tr.row');
      if (tr && S.M) driverDialog(Number(tr.dataset.num));
    });
    on('widgets', () => { if (root.classList.contains('active')) updateAll(); });
    on('lang', () => {});
  },
  update() {
    if (!S.session) return;
    if (layoutKind && layoutKind !== kindKey()) layout = null; // untouched default follows the session type
    const L = current();
    if (!$('#dash-grid', root).children.length || built !== L.map(w => w.id).join()) rebuild();
    if (S.M) driverChips($('#dash-chips', root));
    $('#dash-count', root).textContent = t('dash.drivers.n', { n: S.sel.size });
    updateAll();
  },
  show() { setTimeout(() => { $('#dash-grid', root).querySelectorAll('canvas').forEach(c => window.Chart?.getChart(c)?.resize()); }, 0); },
};
