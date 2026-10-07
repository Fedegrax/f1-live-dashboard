import { S } from '../state.js';
import { t } from '../i18n.js';
import { $, esc, h, upsertChart, axis, cssVar, emptyState, clock } from '../ui.js';
import { rcList } from './overview.js';

let root;
let cat = 'all';

function weatherCharts() {
  const M = S.M;
  const w = M.weather;
  const pts = k => w.map(r => ({ x: r.t, y: r[k] }));
  const timeAxis = (title) => axis(title, { type: 'linear', ticks: { color: cssVar('--muted'), maxTicksLimit: 6, callback: v => clock(v).slice(0, 5) } });
  upsertChart($('#c-temp', root), {
    type: 'line',
    data: { datasets: [
      { label: t('feed.track') + ' °C', data: pts('track_temperature'), borderColor: cssVar('--live'), backgroundColor: cssVar('--live'), pointRadius: 0, borderWidth: 2 },
      { label: t('feed.air') + ' °C', data: pts('air_temperature'), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), pointRadius: 0, borderWidth: 2 },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: i => clock(i[0].parsed.x) } } }, scales: { x: timeAxis(''), y: axis('') } },
  });
  upsertChart($('#c-wind', root), {
    type: 'line',
    data: { datasets: [
      { label: t('chip.wind') + ' m/s', data: pts('wind_speed'), borderColor: cssVar('--good'), backgroundColor: cssVar('--good'), pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
      { label: t('chip.humidity') + ' %', data: pts('humidity'), borderColor: cssVar('--purple'), backgroundColor: cssVar('--purple'), pointRadius: 0, borderWidth: 2, yAxisID: 'y1' },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: i => clock(i[0].parsed.x) } } },
      scales: { x: timeAxis(''), y: axis('m/s', { beginAtZero: true, position: 'left' }), y1: axis('%', { position: 'right', grid: { drawOnChartArea: false } }) } },
  });
}

function radio() {
  const M = S.M;
  const list = M.radio.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (!list.length) return emptyState(t('feed.radio.none.title'), t('feed.radio.none.text'));
  return list.slice(0, 60).map(r => {
    const d = M.drv.get(r.driver_number);
    return `<div class="radio"><span class="num muted">${clock(Date.parse(r.date))}</span><b style="color:${esc(d?.color || 'inherit')};font-family:var(--font-display);font-size:16px">${esc(d?.acr || r.driver_number)}</b><audio controls preload="none" src="${esc(r.recording_url)}"></audio></div>`;
  }).join('');
}

function renderRc() {
  const M = S.M;
  const f = cat === 'all' ? null : r => r.category === cat;
  $('#rc-full', root).innerHTML = M.rc.length ? rcList(M, 200, f) : `<li><span></span><span></span><span class="muted">${t('rc.none')}</span></li>`;
}

export function renderWidget(el) {
  const prev = root;
  root = el;
  try { if (S.M && S.M.weather.length) weatherCharts(); } finally { root = prev; }
}

export const feed = {
  id: 'feed',
  label: 'Direzione gara & meteo',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid side">
        <section class="card"><header><h2>${t('feed.card.rc')}</h2><select class="spacer" id="rc-cat" style="background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:5px 8px"></select></header><ul class="feed" id="rc-full" style="max-height:640px"></ul></section>
        <div class="grid">
          <section class="card"><header><h2>${t('feed.card.temp')}</h2></header><div class="body"><div class="chartbox short"><canvas id="c-temp"></canvas></div></div></section>
          <section class="card"><header><h2>${t('feed.card.wind')}</h2></header><div class="body"><div class="chartbox short"><canvas id="c-wind"></canvas></div></div></section>
          <section class="card"><header><h2>${t('feed.card.radio')}</h2></header><div id="radio" style="max-height:420px;overflow:auto"></div></section>
        </div>
      </div>`;
    $('#rc-cat', el).addEventListener('change', e => { cat = e.target.value; renderRc(); });
  },
  update() {
    const M = S.M;
    if (!M) return;
    const cats = [...new Set(M.rc.map(r => r.category).filter(Boolean))];
    const sel = $('#rc-cat', root);
    const cur = sel.value || 'all';
    sel.innerHTML = `<option value="all">${t('feed.all')}</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
    sel.value = cats.includes(cur) || cur === 'all' ? cur : 'all';
    cat = sel.value;
    renderRc();
    if (M.weather.length) weatherCharts();
    $('#radio', root).innerHTML = radio();
  },
};
