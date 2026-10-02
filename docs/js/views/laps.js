import { S } from '../state.js';
import { fmtLap, fmtGap, paceStats, degradationPoints, stintAt, compoundOf, COMPOUND } from '../data.js';
import { $, h, esc, driverChips, selectedDrivers, upsertChart, axis, driverStyle, cssVar, emptyState } from '../ui.js';

let root;
const opt = { mode: 'time', limit: 1.15, hideOut: true };

function controls() {
  const box = $('#lap-controls', root);
  box.innerHTML = '';
  const seg = h('div', { class: 'seg' },
    ...[['time', 'Tempo'], ['delta', 'Δ vs best assoluto'], ['rel', 'Δ vs proprio best']].map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': opt.mode === k, onclick: () => { opt.mode = k; controls(); redraw(); } }, label)));
  const sel = h('select', { id: 'lap-limit', onchange: e => { opt.limit = Number(e.target.value); redraw(); } },
    ...[[1.05, '105%'], [1.07, '107%'], [1.1, '110%'], [1.15, '115%'], [1.3, '130%'], [99, 'Tutti']].map(([v, l]) => h('option', { value: v, selected: v === opt.limit }, l)));
  const out = h('label', {}, h('input', { type: 'checkbox', id: 'lap-out', checked: opt.hideOut, onchange: e => { opt.hideOut = e.target.checked; redraw(); } }), 'Nascondi out-lap');
  box.append(seg, h('label', {}, 'Soglia giri lenti', sel), out);
}

function lapChart() {
  const M = S.M;
  const ref = M.overall.lap?.dur;
  const drivers = selectedDrivers();
  const datasets = drivers.map(d => {
    const best = M.best.get(d.num)?.dur;
    const pts = (M.lapsBy.get(d.num) || []).filter(l => l.lap_duration != null && (!opt.hideOut || !l.is_pit_out_lap) && (ref == null || l.lap_duration <= ref * opt.limit));
    const data = pts.map(l => {
      const st = stintAt(M, d.num, l.lap_number);
      let y = l.lap_duration;
      if (opt.mode === 'delta' && ref != null) y -= ref;
      if (opt.mode === 'rel' && best != null) y -= best;
      return { x: l.lap_number, y, lap: l.lap_number, dur: l.lap_duration, comp: st?.compound };
    });
    return driverStyle(d, {
      data,
      pointBackgroundColor: data.map(p => compoundOf(p.comp).color),
      pointBorderColor: d.color,
      pointBorderWidth: 2,
      pointRadius: 3.5,
    });
  });
  upsertChart($('#c-laps', root), {
    type: 'line',
    data: { datasets },
    options: {
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: {
          title: items => `Giro ${items[0].raw.lap}`,
          label: c => ` ${c.dataset.label}  ${fmtLap(c.raw.dur)}  ${opt.mode !== 'time' ? `(${fmtGap(c.parsed.y, true)})` : ''}  ${c.raw.comp ? compoundOf(c.raw.comp).label : ''}`,
        } },
      },
      scales: {
        x: axis('Giro', { type: 'linear', ticks: { precision: 0, color: cssVar('--muted') } }),
        y: axis(opt.mode === 'time' ? 'Tempo sul giro' : 'Differenza (s)', { ticks: { color: cssVar('--muted'), callback: v => (opt.mode === 'time' ? fmtLap(v) : v.toFixed(1)) } }),
      },
    },
  });
}

function paceChart() {
  const M = S.M;
  let stats = paceStats(M);
  if (S.sel.size) stats = stats.filter(s => S.sel.has(s.driver));
  const labels = stats.map(s => M.drv.get(s.driver).acr);
  const colors = stats.map(s => M.drv.get(s.driver).color);
  upsertChart($('#c-pace', root), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Q1–Q3 (50% dei giri)', data: stats.map(s => [s.q1, s.q3]), backgroundColor: colors.map(c => `${c}99`), borderColor: colors, borderWidth: 2, borderSkipped: false, barPercentage: 0.6 },
        { type: 'line', label: 'Mediana', data: stats.map(s => s.med), showLine: false, pointStyle: 'rectRot', pointRadius: 6, pointBackgroundColor: cssVar('--fg'), pointBorderColor: cssVar('--bg'), pointBorderWidth: 1 },
        { type: 'line', label: 'Miglior giro', data: stats.map(s => s.min), showLine: false, pointStyle: 'triangle', pointRadius: 6, pointBackgroundColor: cssVar('--purple'), pointBorderColor: cssVar('--bg') },
      ],
    },
    options: {
      plugins: { tooltip: { callbacks: { label: c => {
        const s = stats[c.dataIndex];
        if (c.datasetIndex === 0) return ` Q1 ${fmtLap(s.q1)} · Q3 ${fmtLap(s.q3)} (${s.n} giri)`;
        return ` ${c.dataset.label}: ${fmtLap(c.parsed.y)}`;
      } } } },
      scales: { x: axis(''), y: axis('', { min: stats.length ? Math.floor(Math.min(...stats.map(x => x.min)) - 0.5) : undefined, max: stats.length ? Math.ceil(Math.max(...stats.map(x => x.q3)) + 0.5) : undefined, ticks: { color: cssVar('--muted'), callback: v => fmtLap(v) } }) },
    },
  });
}

function slope(pts) {
  const n = pts.length;
  if (n < 5) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  if (!den) return null;
  const m = num / den;
  return { m, b: my - m * mx, x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)) };
}

const deg = { team: 'sel', comp: 'all', by: 'compound', fuel: false };
const FUEL_S_PER_LAP = 0.055; // ~1.8 kg/lap x 0.03 s/kg

function degControls() {
  const M = S.M;
  const box = $('#deg-controls', root);
  const teams = [...new Set([...M.drv.values()].filter(d => M.lapsBy.has(d.num) && d.team).map(d => d.team))].sort();
  if (deg.team !== 'sel' && deg.team !== 'all' && !teams.includes(deg.team)) deg.team = 'sel';
  const team = h('select', { id: 'deg-team', 'aria-label': 'Team', onchange: e => { deg.team = e.target.value; degChart(); } },
    h('option', { value: 'sel', selected: deg.team === 'sel' }, 'Piloti selezionati'),
    h('option', { value: 'all', selected: deg.team === 'all' }, 'Tutti i team'),
    ...teams.map(t => h('option', { value: t, selected: deg.team === t }, t)));
  const comp = h('select', { id: 'deg-comp', 'aria-label': 'Mescola', onchange: e => { deg.comp = e.target.value; degChart(); } },
    h('option', { value: 'all', selected: deg.comp === 'all' }, 'Tutte le mescole'),
    ...['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].map(c => h('option', { value: c, selected: deg.comp === c }, COMPOUND[c].label)));
  const by = h('div', { class: 'seg' }, ...[['compound', 'Colora per mescola'], ['team', 'Confronta team']].map(([k, l]) =>
    h('button', { type: 'button', 'aria-pressed': deg.by === k, onclick: () => { deg.by = k; degControls(); degChart(); } }, l)));
  const kids = [h('label', {}, 'Team', team), h('label', {}, 'Mescola', comp), by];
  if (S.kind.race) kids.push(h('label', {}, h('input', { type: 'checkbox', id: 'deg-fuel', checked: deg.fuel, onchange: e => { deg.fuel = e.target.checked; degChart(); } }), `Correggi carburante (${FUEL_S_PER_LAP} s/giro)`));
  box.replaceChildren(...kids);
}

function fitOf(pts) {
  const r = slope(pts.map(p => ({ x: p.x, y: p.y })));
  return r;
}

function degChart() {
  const M = S.M;
  const teamOf = n => M.drv.get(n).team || '—';
  let base = degradationPoints(M);
  if (deg.fuel && S.kind.race) {
    // the car gets lighter every lap: add the fuel gain back, then re-zero each driver on their own fastest corrected lap
    const minBy = new Map();
    for (const p of base) { const v = p.delta + FUEL_S_PER_LAP * p.lap; if (!minBy.has(p.driver) || v < minBy.get(p.driver)) minBy.set(p.driver, v); }
    base = base.map(p => ({ ...p, delta: p.delta + FUEL_S_PER_LAP * p.lap - minBy.get(p.driver) }));
  }
  const all = base.filter(p => {
    if (deg.comp !== 'all' && (p.compound || '').toUpperCase() !== deg.comp) return false;
    if (deg.team === 'sel') return !S.sel.size || S.sel.has(p.driver);
    if (deg.team === 'all') return true;
    return teamOf(p.driver) === deg.team;
  });
  const datasets = [];
  const rows = [];
  const groups = new Map();
  for (const p of all) {
    const key = deg.by === 'team' ? teamOf(p.driver) : (p.compound || 'UNKNOWN').toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ x: p.age, y: p.delta, drv: M.drv.get(p.driver).acr, lap: p.lap, dur: p.dur, comp: p.compound });
  }
  const order = deg.by === 'team' ? [...groups.keys()].sort() : Object.keys(COMPOUND).filter(k => groups.has(k));
  for (const key of order) {
    const pts = groups.get(key);
    const color = deg.by === 'team' ? ([...M.drv.values()].find(d => d.team === key)?.color || '#8a8f98') : COMPOUND[key].color;
    const label = deg.by === 'team' ? key : COMPOUND[key].label;
    const reg = fitOf(pts);
    rows.push({ label, color, n: pts.length, slope: reg ? reg.m : null });
    datasets.push({ label: `${label}${reg ? ` · ${reg.m >= 0 ? '+' : ''}${reg.m.toFixed(3)} s/giro` : ''}`, data: pts, backgroundColor: `${color}cc`, borderColor: color, pointRadius: 4, showLine: false });
    if (reg) datasets.push({ label: `fit ${label}`, data: [{ x: reg.x0, y: reg.m * reg.x0 + reg.b }, { x: reg.x1, y: reg.m * reg.x1 + reg.b }], type: 'line', borderColor: color, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, _fit: true });
  }
  upsertChart($('#c-deg', root), {
    type: 'scatter',
    data: { datasets },
    options: {
      plugins: {
        legend: { labels: { filter: it => !it.text.startsWith('fit ') } },
        tooltip: { filter: it => !it.dataset._fit, callbacks: { label: c => ` ${c.raw.drv} · giro ${c.raw.lap} · ${fmtLap(c.raw.dur)} (${fmtGap(c.raw.y, true)} dal proprio best)${c.raw.comp ? ` · ${compoundOf(c.raw.comp).label}` : ''}` } },
      },
      scales: { x: axis('Età gomma (giri)', { ticks: { precision: 0, color: cssVar('--muted') } }), y: axis(deg.fuel && S.kind.race ? 'Δ corretto per carburante (s)' : 'Δ vs proprio miglior giro (s)') },
    },
  });
  $('#deg-table', root).innerHTML = rows.length
    ? `<div class="scroll"><table><thead><tr><th class="l">${deg.by === 'team' ? 'Team' : 'Mescola'}</th><th>Giri</th><th>Degrado s/giro</th></tr></thead><tbody>${rows.map(r => `<tr><td class="l"><span style="color:${esc(r.color)}">●</span> ${esc(r.label)}</td><td>${r.n}</td><td><b>${r.slope == null ? '–' : `${r.slope >= 0 ? '+' : ''}${r.slope.toFixed(3)}`}</b></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="hint">Nessun giro con questi filtri.</p>';
}

function redraw() {
  if (!S.M || !S.M.laps.length) return;
  lapChart();
  paceChart();
  degControls();
  degChart();
}

export const laps = {
  id: 'laps',
  label: 'Giri & passo',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid">
        <section class="card"><header><h2>Piloti</h2></header><div class="body"><div id="lap-chips"></div></div></section>
        <div id="lap-empty"></div>
        <div id="lap-grid" class="grid">
          <section class="card"><header><h2>Tempi sul giro</h2><div class="controls spacer" id="lap-controls"></div></header>
            <div class="body"><div class="chartbox tall"><canvas id="c-laps"></canvas></div>
            <p class="hint" style="margin-top:8px">Il riempimento del punto indica la mescola, il bordo la scuderia.</p></div></section>
          <div class="grid cols-2">
            <section class="card"><header><h2>Distribuzione del passo</h2></header><div class="body"><div class="chartbox"><canvas id="c-pace"></canvas></div><p class="hint" style="margin-top:8px">Giri puliti entro il 107% del best della sessione.</p></div></section>
            <section class="card"><header><h2>Degrado gomme</h2><div class="controls spacer" id="deg-controls"></div></header><div class="body"><div class="chartbox"><canvas id="c-deg"></canvas></div><p class="hint" style="margin:8px 0">Pendenza in secondi per giro di vita gomma. In gara puoi correggere per il carburante. Un fit richiede almeno 5 giri.</p><div id="deg-table"></div></div></section>
          </div>
        </div>
      </div>`;
    controls();
  },
  update() {
    const M = S.M;
    const has = M && M.laps.length;
    $('#lap-grid', root).hidden = !has;
    $('#lap-empty', root).innerHTML = has ? '' : `<section class="card">${emptyState('Nessun giro registrato', 'I grafici compaiono appena arrivano i primi tempi.')}</section>`;
    if (!has) return;
    driverChips($('#lap-chips', root));
    redraw();
  },
};
