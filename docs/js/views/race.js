import { S } from '../state.js';
import { positionsByLap, gapsByLap, timingRows, fmtGap } from '../data.js';
import { $, esc, h, driverChips, selectedDrivers, upsertChart, axis, driverStyle, cssVar, emptyState, drvCell } from '../ui.js';

let root;

function posChart() {
  const M = S.M;
  const { laps, series } = positionsByLap(M);
  const ds = selectedDrivers().filter(d => series.has(d.num)).map(d => driverStyle(d, { data: laps.map((l, i) => ({ x: l, y: series.get(d.num)[i] })), pointRadius: 1.5, stepped: false }));
  const n = M.posLatest.size || 20;
  upsertChart($('#c-pos', root), {
    type: 'line',
    data: { datasets: ds },
    options: {
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}  P${c.parsed.y}` } } },
      scales: {
        x: axis('Giro', { type: 'linear', min: 1, max: laps[laps.length - 1], ticks: { precision: 0, color: cssVar('--muted') } }),
        y: axis('Posizione', { reverse: true, min: 0.5, max: n + 0.5, ticks: { stepSize: 1, precision: 0, color: cssVar('--muted'), callback: v => (Number.isInteger(v) ? v : '') } }),
      },
    },
  });
}

function gapChart() {
  const M = S.M;
  const { laps, series } = gapsByLap(M);
  const ds = selectedDrivers().filter(d => series.has(d.num)).map(d => driverStyle(d, { data: laps.map((l, i) => ({ x: l, y: series.get(d.num)[i] })), pointRadius: 1.5 }));
  upsertChart($('#c-gap', root), {
    type: 'line',
    data: { datasets: ds },
    options: {
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}  ${fmtGap(c.parsed.y, true)} s` } } },
      scales: { x: axis('Giro', { type: 'linear', min: 1, max: laps[laps.length - 1], ticks: { precision: 0, color: cssVar('--muted') } }), y: axis('Distacco dal leader (s)', { beginAtZero: true }) },
    },
  });
}

function gridTable() {
  const M = S.M;
  const rows = timingRows(M, S.kind);
  const body = rows.map(r => {
    const diff = r.grid != null ? r.grid - r.pos : null;
    return `<tr><td class="pos">${r.pos}</td><td class="l">${drvCell(r.d, true)}</td><td>${r.grid ?? '–'}</td><td class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff == null ? '–' : diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : '='}</td><td>${r.pits}</td><td>${r.laps}</td></tr>`;
  }).join('');
  $('#gridtbl', root).innerHTML = `<div class="scroll"><table><thead><tr><th>Pos.</th><th class="l">Pilota</th><th>Griglia</th><th>Guadagno</th><th>Pit</th><th>Giri</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export const race = {
  id: 'race',
  label: 'Gara',
  available: () => !!S.kind?.race,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid">
        <section class="card"><header><h2>Piloti</h2></header><div class="body"><div id="race-chips"></div></div></section>
        <div id="race-empty"></div>
        <div id="race-main" class="grid">
          <section class="card"><header><h2>Posizioni giro per giro</h2></header><div class="body"><div class="chartbox tall"><canvas id="c-pos"></canvas></div></div></section>
          <div class="grid cols-2">
            <section class="card"><header><h2>Distacco dal leader</h2></header><div class="body"><div class="chartbox"><canvas id="c-gap"></canvas></div></div></section>
            <section class="card"><header><h2>Griglia e arrivo</h2></header><div id="gridtbl"></div></section>
          </div>
        </div>
      </div>`;
  },
  update() {
    const M = S.M;
    const has = M && M.laps.length > 1 && M.posSeries.size;
    $('#race-main', root).hidden = !has;
    $('#race-empty', root).innerHTML = has ? '' : `<section class="card">${emptyState('Gara non ancora iniziata', 'Posizioni e distacchi compaiono dopo il primo giro.')}</section>`;
    if (!has) return;
    driverChips($('#race-chips', root));
    posChart();
    gapChart();
    gridTable();
  },
};
