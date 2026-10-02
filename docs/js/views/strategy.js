import { S } from '../state.js';
import { timingRows, maxLap, compoundOf, COMPOUND, stintStats, fmtLap } from '../data.js';
import { $, h, esc, drvCell, emptyState, clock, upsertChart, axis, cssVar, driverStyle } from '../ui.js';

let root;
const cmp = { sel: new Set(), touched: false, session: null };
const keyOf = (n, stint) => `${n}:${stint}`;

function allStints(M) {
  const stats = stintStats(M);
  const out = [];
  for (const [n, arr] of stats) for (const a of arr) out.push({ ...a, num: n, d: M.drv.get(n), key: keyOf(n, a.stint) });
  return out;
}

function compare(M) {
  const list = allStints(M).filter(a => a.avg != null);
  if (cmp.session !== S.session.session_key) { cmp.session = S.session.session_key; cmp.sel = new Set(); cmp.touched = false; }
  if (!cmp.touched) {
    cmp.sel = new Set(list.filter(a => a.n >= 5).sort((a, b) => a.avg - b.avg).slice(0, 8).map(a => a.key));
    if (!cmp.sel.size) cmp.sel = new Set(list.sort((a, b) => a.avg - b.avg).slice(0, 8).map(a => a.key));
  }
  const rerender = () => { cmp.touched = true; compare(M); };
  const box = $('#cmp-chips', root);
  const quick = (label, fn) => h('button', { class: 'btn sm', type: 'button', onclick: () => { cmp.sel = new Set(fn()); rerender(); } }, label);
  const byComp = c => list.filter(a => (a.compound || '').toUpperCase() === c).map(a => a.key);
  const chips = list.slice().sort((a, b) => a.avg - b.avg).map(a => {
    const c = compoundOf(a.compound);
    return h('button', { class: 'dchip', type: 'button', style: `--c:${a.d.color}`, 'aria-pressed': cmp.sel.has(a.key), title: `${a.d.name} · stint ${a.stint} · giri ${a.start}–${a.end}`, onclick: () => { if (cmp.sel.has(a.key)) cmp.sel.delete(a.key); else cmp.sel.add(a.key); rerender(); } },
      h('i'), `${a.d.acr} S${a.stint}`, h('b', { style: `color:${c.color};font:700 13px var(--font-mono)`, title: c.label }, c.short), h('span', { class: 'num', style: 'font:600 12px var(--font-mono);color:var(--muted)' }, fmtLap(a.avg)));
  });
  box.replaceChildren(h('div', { class: 'drvchips', style: 'margin-bottom:8px' },
    quick('Soft', () => byComp('SOFT')), quick('Medium', () => byComp('MEDIUM')), quick('Hard', () => byComp('HARD')),
    quick('Più veloci', () => list.filter(a => a.n >= 5).sort((a, b) => a.avg - b.avg).slice(0, 8).map(a => a.key)),
    quick('Tutti', () => list.map(a => a.key)), quick('Nessuno', () => []),
    h('span', { class: 'hint' }, 'Ordinati per media, dal più veloce')),
    h('div', { class: 'drvchips', style: 'max-height:150px;overflow:auto' }, ...chips));

  const chosen = list.filter(a => cmp.sel.has(a.key)).sort((a, b) => a.avg - b.avg);
  const fastest = chosen.length ? chosen[0].avg : null;
  upsertChart($('#c-stint-avg', root), {
    type: 'bar',
    data: {
      labels: chosen.map(a => `${a.d.acr} S${a.stint} ${compoundOf(a.compound).short} · ${fmtLap(a.avg)}`),
      datasets: [{ label: 'Media', data: chosen.map(a => a.avg - fastest), backgroundColor: chosen.map(a => `${a.d.color}cc`), borderColor: chosen.map(a => compoundOf(a.compound).color), borderWidth: 3, borderRadius: 3, barPercentage: 0.75 }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => { const a = chosen[c.dataIndex]; return [` Media ${fmtLap(a.avg)}${a.avg !== fastest ? `  (+${(a.avg - fastest).toFixed(3)})` : ''}`, ` Miglior ${fmtLap(a.best)} · ${a.n} giri validi · ${compoundOf(a.compound).label}`]; },
      } } },
      scales: {
        x: axis(chosen.length ? `Distacco dalla media più veloce (${fmtLap(fastest)})` : '', { min: 0, ticks: { color: cssVar('--muted'), callback: v => `+${v.toFixed(1)}` } }),
        y: axis('', { grid: { display: false } }),
      },
    },
  });
  upsertChart($('#c-stint-lines', root), {
    type: 'line',
    data: { datasets: chosen.map(a => driverStyle(a.d, {
      label: `${a.d.acr} S${a.stint} · ${fmtLap(a.avg)}`,
      data: a.times.map(t => ({ x: t.i, y: t.dur, lap: t.lap, comp: a.compound })),
      pointBackgroundColor: compoundOf(a.compound).color, pointBorderColor: a.d.color, pointBorderWidth: 2, pointRadius: 3,
      borderDash: chosen.filter(b => b.num === a.num).indexOf(a) > 0 ? [6, 4] : [],
    })) },
    options: {
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { title: i => `Giro ${i[0].raw.lap} (${i[0].raw.x}° dello stint)`, label: c => ` ${c.dataset.label.split(' · ')[0]}  ${fmtLap(c.raw.y)}` } } },
      scales: { x: axis('Giro dello stint', { type: 'linear', ticks: { precision: 0, color: cssVar('--muted') } }), y: axis('Tempo sul giro', { ticks: { color: cssVar('--muted'), callback: v => fmtLap(v) } }) },
    },
  });
}

function timeline(M) {
  const rows = timingRows(M, S.kind);
  const N = Math.max(maxLap(M), 1);
  const step = N > 40 ? 10 : N > 20 ? 5 : N > 10 ? 2 : 1;
  const ticks = [];
  for (let l = 0; l <= N; l += step) ticks.push(l);
  const axisHtml = `<div class="axis"><b></b><div>${ticks.map(t => `<span style="left:${(t / N) * 100}%">${t}</span>`).join('')}</div></div>`;
  const stats = stintStats(M);
  const lines = rows.filter(r => M.stintsBy.has(r.num)).map(r => {
    const st = stats.get(r.num) || [];
    const stints = M.stintsBy.get(r.num).map((s, i) => {
      const a = st[i];
      const avg = a && a.avg != null ? fmtLap(a.avg) : null;
      const end = s.lap_end ?? Math.max(r.laps, s.lap_start);
      const len = Math.max(1, end - s.lap_start + 1);
      const c = compoundOf(s.compound);
      const left = ((s.lap_start - 1) / N) * 100;
      const width = (len / N) * 100;
      const age = s.tyre_age_at_start > 0 ? ` (usata ${s.tyre_age_at_start} giri)` : ' (nuova)';
      return `<div class="stint" style="left:${left}%;width:${width}%;background:${c.color}" title="${esc(c.label)} · giri ${s.lap_start}–${end}${age}${avg ? ` · media ${avg} (${a.n} giri)` : ''}">${len >= 3 ? `${c.short}${len}` : ''}${avg && width > 11 ? ` · ${avg}` : ''}</div>`;
    }).join('');
    return `<div class="stint-row"><div>${drvCell(r.d, true)}</div><div class="stint-track">${stints}</div></div>`;
  }).join('');
  const legend = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].map(k => `<span><i style="background:${COMPOUND[k].color}"></i>${COMPOUND[k].label}</span>`).join('');
  return `<div class="legend" style="margin-bottom:10px">${legend}</div>${axisHtml}${lines}`;
}

function stintTable(M) {
  const stats = stintStats(M);
  const rows = timingRows(M, S.kind).filter(r => stats.has(r.num));
  if (!rows.length) return '';
  const body = rows.flatMap(r => stats.get(r.num).map((a, i) => {
    const c = compoundOf(a.compound);
    return `<tr><td class="l">${i === 0 ? drvCell(r.d, true) : ''}</td><td>${a.stint}</td><td><span class="tyre"><i style="border-color:${c.color}">${c.short}</i>${a.ageStart > 0 ? `+${a.ageStart}` : ''}</span></td><td>${a.start}–${a.end}</td><td>${a.laps}</td><td><b>${a.avg != null ? fmtLap(a.avg) : '–'}</b></td><td>${a.best != null ? fmtLap(a.best) : '–'}</td><td>${a.n}</td></tr>`;
  })).join('');
  return `<div class="scroll" style="max-height:560px"><table><thead><tr><th class="l">Pilota</th><th>Stint</th><th>Gomma</th><th>Giri</th><th>N°</th><th>Media</th><th>Miglior</th><th>Validi</th></tr></thead><tbody>${body}</tbody></table></div><p class="hint" style="padding:8px 14px">La media esclude out-lap e giri oltre il 107% del miglior giro della sessione (traffico, rientri). “Validi” sono i giri contati.</p>`;
}

function pitTable(M) {
  const rows = [];
  for (const [n, arr] of M.pitsBy) for (const p of arr) rows.push({ d: M.drv.get(n), ...p });
  if (!rows.length) return emptyState('Nessun pit stop', 'Qui compaiono ingressi ai box e durata.');
  const withDur = rows.some(r => r.pit_duration != null);
  rows.sort((a, b) => (withDur ? (a.pit_duration ?? 999) - (b.pit_duration ?? 999) : a.t - b.t));
  const body = rows.map(r => `<tr><td class="l">${drvCell(r.d, true)}</td><td>${r.lap_number ?? '–'}</td><td>${clock(r.t)}</td><td>${r.pit_duration != null ? r.pit_duration.toFixed(1) + ' s' : '–'}</td><td>${r.stop_duration != null ? r.stop_duration.toFixed(1) + ' s' : '–'}</td></tr>`).join('');
  return `<div class="scroll" style="max-height:480px"><table><thead><tr><th class="l">Pilota</th><th>Giro</th><th>Ora</th><th>Corsia box</th><th>Fermo</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function compoundUse(M) {
  const use = new Map();
  for (const arr of M.stintsBy.values()) for (const s of arr) {
    const end = s.lap_end ?? s.lap_start;
    const k = (s.compound || 'UNKNOWN').toUpperCase();
    const o = use.get(k) || { laps: 0, stints: 0 };
    o.laps += end - s.lap_start + 1;
    o.stints += 1;
    use.set(k, o);
  }
  return [...use.entries()].map(([k, v]) => `<div class="stat"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${compoundOf(k).color};margin-right:6px"></i>${compoundOf(k).label}</span><b>${v.laps}<em>giri · ${v.stints} stint</em></b></div>`).join('');
}

export const strategy = {
  id: 'strategy',
  label: 'Strategia',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <section class="card" id="cmp-card" style="margin-bottom:14px"><header><h2>Confronto stint</h2><span class="hint spacer">Scegli gli stint: nome e media sono su ogni pulsante</span></header>
        <div class="body"><div id="cmp-chips" style="margin-bottom:12px"></div>
        <div class="grid cols-2"><div><div class="chartbox"><canvas id="c-stint-avg"></canvas></div></div><div><div class="chartbox"><canvas id="c-stint-lines"></canvas></div></div></div>
        <p class="hint" style="margin-top:8px">Barre: distacco della media dalla più veloce tra gli stint scelti (bordo = mescola, tempo medio nell’etichetta). Linee: tempo giro per giro dentro lo stint. Esclusi out-lap e giri oltre il 107% del best.</p></div></section>
      <div class="grid side">
        <section class="card"><header><h2>Stint e mescole</h2></header><div class="body" id="stints"></div></section>
        <div class="grid">
          <section class="card"><header><h2>Uso gomme</h2></header><div class="body"><div class="stat-grid" id="cuse"></div></div></section>
          <section class="card"><header><h2>Pit stop</h2></header><div id="pits"></div></section>
        </div>
      </div>
      <section class="card" style="margin-top:14px"><header><h2>Media per stint</h2></header><div id="stint-avg"></div></section>`;
  },
  update() {
    const M = S.M;
    if (!M || !M.stintsBy.size) {
      $('#stints', root).innerHTML = emptyState('Nessuno stint registrato', 'Le mescole compaiono appena le monoposto escono dai box.');
      $('#cuse', root).innerHTML = '';
      $('#pits', root).innerHTML = '';
      $('#stint-avg', root).innerHTML = '';
      $('#cmp-card', root).hidden = true;
      return;
    }
    $('#stints', root).innerHTML = timeline(M);
    $('#cuse', root).innerHTML = compoundUse(M);
    $('#pits', root).innerHTML = pitTable(M);
    $('#stint-avg', root).innerHTML = stintTable(M);
    const any = allStints(M).some(a => a.avg != null);
    $('#cmp-card', root).hidden = !any;
    if (any) compare(M);
  },
};
