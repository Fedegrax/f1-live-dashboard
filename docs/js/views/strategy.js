import { S } from '../state.js';
import { timingRows, maxLap, compoundOf, COMPOUND, stintStats, fmtLap } from '../data.js';
import { $, h, esc, drvCell, emptyState, clock, upsertChart, axis, cssVar, driverStyle, compoundLabel } from '../ui.js';
import { t } from '../i18n.js';

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
    return h('button', { class: 'dchip', type: 'button', style: `--c:${a.d.color}`, 'aria-pressed': cmp.sel.has(a.key), title: `${a.d.name} · ${t('st.stintN', { n: a.stint })} · ${t('st.lapsRange', { a: a.start, b: a.end })}`, onclick: () => { if (cmp.sel.has(a.key)) cmp.sel.delete(a.key); else cmp.sel.add(a.key); rerender(); } },
      h('i'), `${a.d.acr} S${a.stint}`, h('b', { style: `color:${c.color};font:700 13px var(--font-mono)`, title: compoundLabel(a.compound) }, c.short), h('span', { class: 'num', style: 'font:600 12px var(--font-mono);color:var(--muted)' }, fmtLap(a.avg)));
  });
  box.replaceChildren(h('div', { class: 'drvchips', style: 'margin-bottom:8px' },
    quick(compoundLabel('SOFT'), () => byComp('SOFT')), quick(compoundLabel('MEDIUM'), () => byComp('MEDIUM')), quick(compoundLabel('HARD'), () => byComp('HARD')),
    quick(t('st.fastest'), () => list.filter(a => a.n >= 5).sort((a, b) => a.avg - b.avg).slice(0, 8).map(a => a.key)),
    quick(t('chips.all'), () => list.map(a => a.key)), quick(t('chips.none'), () => []),
    h('span', { class: 'hint' }, t('st.sorted'))),
    h('div', { class: 'drvchips', style: 'max-height:150px;overflow:auto' }, ...chips));

  const chosen = list.filter(a => cmp.sel.has(a.key)).sort((a, b) => a.avg - b.avg);
  const fastest = chosen.length ? chosen[0].avg : null;
  upsertChart($('#c-stint-avg', root), {
    type: 'bar',
    data: {
      labels: chosen.map(a => `${a.d.acr} S${a.stint} ${compoundOf(a.compound).short} · ${fmtLap(a.avg)}`),
      datasets: [{ label: t('st.avg'), data: chosen.map(a => a.avg - fastest), backgroundColor: chosen.map(a => `${a.d.color}cc`), borderColor: chosen.map(a => compoundOf(a.compound).color), borderWidth: 3, borderRadius: 3, barPercentage: 0.75 }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => { const a = chosen[c.dataIndex]; return [` ${t('st.avg')} ${fmtLap(a.avg)}${a.avg !== fastest ? `  (+${(a.avg - fastest).toFixed(3)})` : ''}`, ` ${t('tower.best')} ${fmtLap(a.best)} · ${t('st.validLaps', { n: a.n })} · ${compoundLabel(a.compound)}`]; },
      } } },
      scales: {
        x: axis(chosen.length ? t('st.axis.gap', { v: fmtLap(fastest) }) : '', { min: 0, ticks: { color: cssVar('--muted'), callback: v => `+${v.toFixed(1)}` } }),
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
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { title: i => t('st.lapOfStint', { lap: i[0].raw.lap, n: i[0].raw.x }), label: c => ` ${c.dataset.label.split(' · ')[0]}  ${fmtLap(c.raw.y)}` } } },
      scales: { x: axis(t('st.axis.stintLap'), { type: 'linear', ticks: { precision: 0, color: cssVar('--muted') } }), y: axis(t('dlg.lapTime'), { ticks: { color: cssVar('--muted'), callback: v => fmtLap(v) } }) },
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
      const age = s.tyre_age_at_start > 0 ? ` (${t('st.used', { n: s.tyre_age_at_start })})` : ` (${t('st.new')})`;
      return `<div class="stint" style="left:${left}%;width:${width}%;background:${c.color}" title="${esc(compoundLabel(s.compound))} · ${t('st.lapsRange', { a: s.lap_start, b: end })}${age}${avg ? ` · ${t('st.avgOf', { v: avg, n: a.n })}` : ''}">${len >= 3 ? `${c.short}${len}` : ''}${avg && width > 11 ? ` · ${avg}` : ''}</div>`;
    }).join('');
    return `<div class="stint-row"><div>${drvCell(r.d, true)}</div><div class="stint-track">${stints}</div></div>`;
  }).join('');
  const legend = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].map(k => `<span><i style="background:${COMPOUND[k].color}"></i>${compoundLabel(k)}</span>`).join('');
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
  return `<div class="scroll" style="max-height:560px"><table><thead><tr><th class="l">${t('tower.driver')}</th><th>Stint</th><th>${t('tower.tyre')}</th><th>${t('tower.laps')}</th><th>${t('st.lapsCol')}</th><th>${t('st.avg')}</th><th>${t('tower.best')}</th><th>${t('st.valid')}</th></tr></thead><tbody>${body}</tbody></table></div><p class="hint" style="padding:8px 14px">${t('st.avgNote')}</p>`;
}

function pitTable(M) {
  const rows = [];
  for (const [n, arr] of M.pitsBy) for (const p of arr) rows.push({ d: M.drv.get(n), ...p });
  if (!rows.length) return emptyState(t('st.nopit.title'), t('st.nopit.text'));
  const withDur = rows.some(r => r.pit_duration != null);
  rows.sort((a, b) => (withDur ? (a.pit_duration ?? 999) - (b.pit_duration ?? 999) : a.t - b.t));
  const body = rows.map(r => `<tr><td class="l">${drvCell(r.d, true)}</td><td>${r.lap_number ?? '–'}</td><td>${clock(r.t)}</td><td>${r.pit_duration != null ? r.pit_duration.toFixed(1) + ' s' : '–'}</td><td>${r.stop_duration != null ? r.stop_duration.toFixed(1) + ' s' : '–'}</td></tr>`).join('');
  return `<div class="scroll" style="max-height:480px"><table><thead><tr><th class="l">${t('tower.driver')}</th><th>${t('th.lap')}</th><th>${t('th.clock')}</th><th>${t('st.lane')}</th><th>${t('st.stop')}</th></tr></thead><tbody>${body}</tbody></table></div>`;
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
  return [...use.entries()].map(([k, v]) => `<div class="stat"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${compoundOf(k).color};margin-right:6px"></i>${compoundLabel(k)}</span><b>${v.laps}<em>${t('st.use', { n: v.stints })}</em></b></div>`).join('');
}

export const strategy = {
  id: 'strategy',
  label: 'Strategia',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <section class="card" id="cmp-card" style="margin-bottom:14px"><header><h2>${t('st.card.compare')}</h2><span class="hint spacer">${t('st.compare.hint')}</span></header>
        <div class="body"><div id="cmp-chips" style="margin-bottom:12px"></div>
        <div class="grid cols-2"><div><div class="chartbox"><canvas id="c-stint-avg"></canvas></div></div><div><div class="chartbox"><canvas id="c-stint-lines"></canvas></div></div></div>
        <p class="hint" style="margin-top:8px">${t('st.compare.note')}</p></div></section>
      <div class="grid side">
        <section class="card"><header><h2>${t('st.card.stints')}</h2></header><div class="body" id="stints"></div></section>
        <div class="grid">
          <section class="card"><header><h2>${t('st.card.use')}</h2></header><div class="body"><div class="stat-grid" id="cuse"></div></div></section>
          <section class="card"><header><h2>${t('st.card.pits')}</h2></header><div id="pits"></div></section>
        </div>
      </div>
      <section class="card" style="margin-top:14px"><header><h2>${t('st.card.avg')}</h2></header><div id="stint-avg"></div></section>`;
  },
  update() {
    const M = S.M;
    if (!M || !M.stintsBy.size) {
      $('#stints', root).innerHTML = emptyState(t('st.empty.title'), t('st.empty.text'));
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
