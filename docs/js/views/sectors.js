import { S } from '../state.js';
import { fmtLap, fmtSec, fmtGap } from '../data.js';
import { t } from '../i18n.js';
import { $, esc, drvCell, upsertChart, axis, cssVar, selectedDrivers, driverChips, emptyState } from '../ui.js';

let root;

function maxSpeeds(M) {
  const out = new Map();
  for (const [n, arr] of M.lapsBy) {
    const o = { st: null, i1: null, i2: null };
    for (const l of arr) {
      if (l.st_speed != null && (o.st == null || l.st_speed > o.st)) o.st = l.st_speed;
      if (l.i1_speed != null && (o.i1 == null || l.i1_speed > o.i1)) o.i1 = l.i1_speed;
      if (l.i2_speed != null && (o.i2 == null || l.i2_speed > o.i2)) o.i2 = l.i2_speed;
    }
    out.set(n, o);
  }
  return out;
}

function speedChart(id, key, title) {
  const M = S.M;
  const sp = maxSpeeds(M);
  const rows = [...sp.entries()].filter(([, v]) => v[key] != null).sort((a, b) => b[1][key] - a[1][key]);
  const lo = rows.length ? Math.min(...rows.map(r => r[1][key])) : 0;
  upsertChart($(id, root), {
    type: 'bar',
    data: {
      labels: rows.map(([n]) => M.drv.get(n).acr),
      datasets: [{ label: title, data: rows.map(([, v]) => v[key]), backgroundColor: rows.map(([n]) => M.drv.get(n).color), borderRadius: 3, barPercentage: 0.7 }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x} km/h` } } },
      scales: { x: axis('km/h', { min: Math.max(0, Math.floor(lo / 10) * 10 - 10) }), y: axis('', { grid: { display: false } }) },
    },
  });
}

function sectorDelta() {
  const M = S.M;
  const ds = selectedDrivers().map(d => {
    const pb = M.pbSector.get(d.num) || [];
    return { label: d.acr, backgroundColor: d.color, borderColor: d.color, data: pb.map((v, i) => (v != null && M.overall.s[i] != null ? v - M.overall.s[i] : null)), borderRadius: 3 };
  });
  upsertChart($('#c-secdelta', root), {
    type: 'bar',
    data: { labels: [t('sec.n', { n: 1 }), t('sec.n', { n: 2 }), t('sec.n', { n: 3 })], datasets: ds },
    options: { plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label} ${fmtGap(c.parsed.y, true)}` } } }, scales: { x: axis('', { grid: { display: false } }), y: axis(t('sec.axis.gap'), { beginAtZero: true }) } },
  });
}

function table() {
  const M = S.M;
  const sp = maxSpeeds(M);
  const rows = [...M.drv.values()].filter(d => M.pbSector.has(d.num)).map(d => {
    const pb = M.pbSector.get(d.num);
    const ideal = pb.every(v => v != null) ? pb.reduce((a, b) => a + b, 0) : null;
    return { d, pb, ideal, best: M.best.get(d.num)?.dur ?? null, sp: sp.get(d.num) };
  }).sort((a, b) => (a.ideal ?? 9999) - (b.ideal ?? 9999));
  const cell = (v, i, pb) => `<td><span class="sec ${v != null && M.overall.s[i] != null && v <= M.overall.s[i] + 0.0004 ? 'overall' : ''}">${fmtSec(v)}</span></td>`;
  const body = rows.map((r, i) => `<tr><td class="pos">${i + 1}</td><td class="l">${drvCell(r.d, true)}</td>${r.pb.map((v, k) => cell(v, k)).join('')}<td><b>${r.ideal != null ? fmtLap(r.ideal) : '–'}</b></td><td>${r.best != null ? fmtLap(r.best) : '–'}</td><td>${r.ideal != null && r.best != null ? fmtGap(Math.abs(r.best - r.ideal) < 0.0005 ? 0 : r.best - r.ideal, true) : '–'}</td><td>${r.sp?.i1 ?? '–'}</td><td>${r.sp?.i2 ?? '–'}</td><td>${r.sp?.st ?? '–'}</td></tr>`).join('');
  $('#sec-table', root).innerHTML = `<div class="scroll"><table><thead><tr><th>#</th><th class="l">${t('tower.driver')}</th><th>${t('sec.bestN', { n: 1 })}</th><th>${t('sec.bestN', { n: 2 })}</th><th>${t('sec.bestN', { n: 3 })}</th><th>${t('sec.ideal')}</th><th>${t('sec.actual')}</th><th>${t('sec.potential')}</th><th>I1 km/h</th><th>I2 km/h</th><th>${t('sec.trap')} km/h</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderWidget(el) {
  const prev = root;
  root = el;
  try { if (S.M && S.M.laps.length) table(); } finally { root = prev; }
}

export const sectors = {
  id: 'sectors',
  label: 'Settori & velocità',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid">
        <div id="sec-empty"></div>
        <div id="sec-main" class="grid">
          <section class="card"><header><h2>${t('sec.card.table')}</h2><span class="hint spacer">${t('sec.hint.purple')}</span></header><div id="sec-table"></div></section>
          <section class="card"><header><h2>${t('sec.card.compare')}</h2></header><div class="body"><div id="sec-chips" style="margin-bottom:10px"></div><div class="chartbox"><canvas id="c-secdelta"></canvas></div></div></section>
          <div class="grid cols-3">
            <section class="card"><header><h2>${t('sec.trap')}</h2></header><div class="body"><div class="chartbox tall"><canvas id="c-st"></canvas></div></div></section>
            <section class="card"><header><h2>${t('sec.inter', { n: 1 })}</h2></header><div class="body"><div class="chartbox tall"><canvas id="c-i1"></canvas></div></div></section>
            <section class="card"><header><h2>${t('sec.inter', { n: 2 })}</h2></header><div class="body"><div class="chartbox tall"><canvas id="c-i2"></canvas></div></div></section>
          </div>
        </div>
      </div>`;
  },
  update() {
    const M = S.M;
    const has = M && M.laps.length;
    $('#sec-main', root).hidden = !has;
    $('#sec-empty', root).innerHTML = has ? '' : `<section class="card">${emptyState(t('sec.empty.title'), t('sec.empty.text'))}</section>`;
    if (!has) return;
    table();
    driverChips($('#sec-chips', root));
    sectorDelta();
    speedChart('#c-st', 'st', t('sec.trap'));
    speedChart('#c-i1', 'i1', 'I1');
    speedChart('#c-i2', 'i2', 'I2');
  },
};
