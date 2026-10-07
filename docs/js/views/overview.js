import { S } from '../state.js';
import { timingRows, fmtLap, fmtGap, fmtSec, compoundOf, sectorState, median, stdev } from '../data.js';
import { $, esc, drvCell, emptyState, clock, upsertChart, axis, cssVar, compoundLabel } from '../ui.js';
import { t } from '../i18n.js';

let root;
const SEG = { 2051: 'p', 2049: 'g', 2048: 'y', 2064: 'b' };

export function flagClass(f) {
  return String(f || '').split(' ')[0].toUpperCase();
}

function gapText(r, kind) {
  if (kind.race) {
    if (r.pos === 1) return t('tower.leader');
    const g = r.gapLeader;
    if (g == null) return '–';
    return typeof g === 'number' ? fmtGap(g) : esc(g);
  }
  return r.pos === 1 ? '' : fmtGap(r.gapBest);
}

function intervalText(r) {
  if (r.pos === 1) return '';
  const v = r.interval;
  if (v == null) return '–';
  return typeof v === 'number' ? fmtGap(v) : esc(v);
}

function lastLapCell(M, r) {
  const l = r.lastDone;
  if (!l) return '–';
  let cls = '';
  if (M.overall.lap && l.lap_duration <= M.overall.lap.dur + 0.0004) cls = 'overall';
  else if (r.best && l.lap_duration <= r.best.dur + 0.0004) cls = 'personal';
  return `<span class="sec ${cls}">${fmtLap(l.lap_duration)}</span>`;
}

function tyreCell(r) {
  if (!r.compound) return '–';
  const c = compoundOf(r.compound);
  return `<span class="tyre"><i style="border-color:${c.color}">${c.short}</i>${r.tyreAge != null ? r.tyreAge : ''}</span>`;
}

function table(M, kind, rows) {
  const race = kind.race;
  const quali = kind.quali && rows.some(r => r.phases.some(p => p != null));
  const cols = [];
  cols.push(`<th>P</th><th class="l">${t('tower.driver')}</th>`);
  if (race) cols.push(`<th>${t('tower.laps')}</th><th>${t('tower.gapLeader')}</th><th>${t('tower.interval')}</th><th>${t('tower.last')}</th><th>${t('tower.best')}</th>`);
  else cols.push(`<th>${t('tower.best')}</th><th>${t('tower.gap')}</th><th>${t('tower.prev')}</th>`);
  if (quali) cols.push('<th>Q1</th><th>Q2</th><th>Q3</th>');
  if (!race) cols.push(`<th>${t('tower.last')}</th>`);
  cols.push(`<th>S1</th><th>S2</th><th>S3</th><th>${t('tower.tyre')}</th>`);
  if (!race) cols.push(`<th>${t('tower.laps')}</th>`);
  cols.push(`<th>${t('tower.pit')}</th><th>${t('tower.vmax')}</th>`);
  if (race) cols.push(`<th>${t('tower.grid')}</th>`);

  const body = rows.map(r => {
    const d = r.d;
    const best = r.best ? `<span class="best-cell ${M.overall.lap && r.best.dur <= M.overall.lap.dur + 0.0004 ? 'overall' : ''}">${fmtLap(r.best.dur)}</span>` : '–';
    const sec = r.sectors.map((v, i) => `<td><span class="sec ${r.sectorStates[i]}">${fmtSec(v)}</span></td>`).join('');
    let cells = `<td class="pos">${r.pos}</td><td class="l">${drvCell(d)}${r.status ? `<span class="tag">${r.status}</span>` : ''}${r.outLap ? '<span class="tag pit">OUT</span>' : ''}</td>`;
    if (race) cells += `<td>${r.laps}</td><td>${gapText(r, kind)}</td><td>${intervalText(r)}</td><td>${lastLapCell(M, r)}</td><td>${best}</td>`;
    else cells += `<td>${best}</td><td>${gapText(r, kind)}</td><td>${r.pos === 1 ? '' : fmtGap(r.prevGap)}</td>`;
    if (quali) cells += r.phases.map(p => `<td>${p != null ? fmtLap(p) : '–'}</td>`).join('');
    if (!race) cells += `<td>${lastLapCell(M, r)}</td>`;
    cells += sec + `<td>${tyreCell(r)}</td>`;
    if (!race) cells += `<td>${r.laps}</td>`;
    cells += `<td>${r.pits || ''}</td><td>${r.topSpeed ?? '–'}</td>`;
    if (race) {
      const g = r.grid;
      const diff = g != null ? g - r.pos : null;
      cells += `<td>${g ?? '–'}${diff ? ` <span class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}</span>` : ''}</td>`;
    }
    return `<tr class="row" data-num="${r.num}">${cells}</tr>`;
  }).join('');
  return `<div class="scroll"><table><thead><tr>${cols.join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function highlights(M, kind, rows) {
  const items = [];
  if (M.overall.lap) {
    const d = M.drv.get(M.overall.lap.driver);
    items.push([t('hl.fastest'), fmtLap(M.overall.lap.dur), `${d.acr} · ${t('hl.lapN', { n: M.overall.lap.lap })}`]);
  }
  if (M.overall.s.every(v => v != null)) {
    const ideal = M.overall.s.reduce((a, b) => a + b, 0);
    items.push([t('hl.ideal'), fmtLap(ideal), M.overall.lap ? t('hl.vsBest', { gap: fmtGap(ideal - M.overall.lap.dur, false) }) : '']);
  }
  let top = null;
  for (const r of rows) if (r.topSpeed != null && (!top || r.topSpeed > top.topSpeed)) top = r;
  if (top) items.push([t('hl.topspeed'), `${top.topSpeed} km/h`, top.d.acr]);
  items.push([t('hl.totalLaps'), String(M.laps.filter(l => l.lap_duration != null).length), t('hl.onTrack', { n: rows.filter(r => r.laps > 0).length })]);
  return items.map(([k, v, s]) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b>${s ? `<em class="muted">${esc(s)}</em>` : ''}</div>`).join('');
}

export function rcList(M, n = 12, filter) {
  let list = M.rc;
  if (filter) list = list.filter(filter);
  return list.slice(-n).reverse().map(r => {
    const f = r.flag ? flagClass(r.flag) : (r.category === 'Drs' ? 'DRS' : r.category === 'SafetyCar' ? 'SC' : (r.category || '').slice(0, 7));
    return `<li><time>${clock(r.t)}</time><span class="flag ${esc(f)}">${esc(f)}</span><span>${esc(r.message)}${r.lap_number ? ` <span class="muted">· ${t('hl.lapN', { n: r.lap_number })}</span>` : ''}</span></li>`;
  }).join('');
}

export function driverDialog(num) {
  const M = S.M;
  const d = M.drv.get(num);
  if (!d) return;
  const dlg = $('#drvdlg');
  const rows = timingRows(M, S.kind);
  const r = rows.find(x => x.num === num);
  const laps = M.lapsBy.get(num) || [];
  const valid = laps.filter(l => l.lap_duration != null && !l.is_pit_out_lap).map(l => l.lap_duration);
  const pb = M.pbSector.get(num) || [];
  const ideal = pb.every(v => v != null) ? pb.reduce((a, b) => a + b, 0) : null;
  const stats = [
    [t('dlg.best'), r?.best ? fmtLap(r.best.dur) : '–'],
    [t('dlg.ideal'), ideal ? fmtLap(ideal) : '–'],
    [t('dlg.laps'), String(laps.length)],
    [t('dlg.median'), valid.length ? fmtLap(median(valid)) : '–'],
    [t('dlg.consistency'), valid.length > 2 ? `${stdev(valid).toFixed(3)} s` : '–'],
    [t('dlg.pits'), String((M.pitsBy.get(num) || []).length)],
    [t('dlg.trap'), r?.topSpeed != null ? `${r.topSpeed} km/h` : '–'],
    [t('dlg.position'), r ? `P${r.pos}` : '–'],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');

  const lapRows = laps.slice().reverse().map(l => {
    const st = (M.stintsBy.get(num) || []).find(s => l.lap_number >= s.lap_start && (s.lap_end == null || l.lap_number <= s.lap_end));
    const c = st ? compoundOf(st.compound) : null;
    const secs = [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3].map((v, i) => `<td><span class="sec ${sectorState(M, num, i, v)}">${fmtSec(v)}</span></td>`).join('');
    const isBest = r?.best && r.best.lap === l.lap_number;
    const mini = ['segments_sector_1', 'segments_sector_2', 'segments_sector_3'].map(k => (l[k] || []).map(c2 => `<i class="${SEG[c2] || ''}"></i>`).join('')).join('');
    return `<tr><td>${l.lap_number}</td><td>${l.lap_duration != null ? `<span class="${isBest ? 'sec personal' : ''}">${fmtLap(l.lap_duration)}</span>` : '–'}${l.is_pit_out_lap ? '<span class="tag pit">OUT</span>' : ''}</td>${secs}<td>${l.st_speed ?? '–'}</td><td>${c ? `<span class="tyre"><i style="border-color:${c.color}">${c.short}</i>${st.tyre_age_at_start + l.lap_number - st.lap_start}</span>` : '–'}</td><td style="min-width:150px"><div class="mini">${mini}</div></td></tr>`;
  }).join('');

  $('#drvdlg-body').innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      ${d.headshot ? `<img class="hdshot" src="${esc(d.headshot)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div><div style="font:700 28px/1 var(--font-display);text-transform:uppercase;letter-spacing:.03em">${esc(d.name)} <span class="num muted" style="font-size:18px">#${d.num}</span></div>
      <div class="muted"><span style="color:${esc(d.color)}">●</span> ${esc(d.team)}</div></div>
    </div>
    <div class="stat-grid">${stats}</div>
    <div class="chartbox short"><canvas id="drvchart"></canvas></div>
    <div class="scroll"><table><thead><tr><th>${t('th.lap')}</th><th>${t('th.time')}</th><th>S1</th><th>S2</th><th>S3</th><th>ST</th><th>${t('tower.tyre')}</th><th class="l">${t('th.mini')}</th></tr></thead><tbody>${lapRows || ''}</tbody></table></div>`;
  $('#drvdlg-title').textContent = d.acr;
  if (!dlg.open) dlg.showModal();

  const data = laps.filter(l => l.lap_duration != null && !l.is_pit_out_lap && r?.best && l.lap_duration < r.best.dur * 1.12).map(l => ({ x: l.lap_number, y: l.lap_duration }));
  upsertChart($('#drvchart'), {
    type: 'line',
    data: { datasets: [{ label: t('dlg.lapTime'), data, borderColor: d.color, backgroundColor: d.color, borderWidth: 2, pointRadius: 3, tension: 0 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtLap(c.parsed.y) } } },
      scales: { x: axis(t('axis.lap'), { type: 'linear' }), y: axis('', { ticks: { callback: v => fmtLap(v), color: cssVar('--muted') } }) },
    },
  });
}

export const overview = {
  id: 'overview',
  label: 'Standings',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid side">
        <section class="card"><header><h2 id="tower-title">${t('tower.title.times')}</h2><span class="hint spacer">${t('tower.hint')}</span></header><div id="tower"></div></section>
        <div class="grid">
          <section class="card"><header><h2>${t('card.highlights')}</h2></header><div class="body"><div class="stat-grid" id="hl"></div></div></section>
          <section class="card"><header><h2>${t('card.raceControl')}</h2></header><ul class="feed" id="rc-short" style="max-height:340px"></ul></section>
        </div>
      </div>`;
    el.addEventListener('click', e => {
      const tr = e.target.closest('tr.row');
      if (tr) driverDialog(Number(tr.dataset.num));
    });
  },
  update() {
    const M = S.M;
    const tower = $('#tower', root);
    $('#tower-title', root).textContent = S.kind.race ? t('tower.title.race') : S.kind.quali ? t('tower.title.quali') : t('tower.title.times');
    if (!M) { tower.innerHTML = `<div class="loading">${t('loading')}</div>`; return; }
    const rows = timingRows(M, S.kind);
    if (!rows.length) {
      const up = S.state === 'upcoming';
      const live = S.state === 'live';
      tower.innerHTML = emptyState(up ? t('empty.up.title') : t('empty.nodata.title'), up ? t('empty.up.text') : live ? t('empty.live.text') : t('empty.nodata.text'));
    } else {
      tower.innerHTML = table(M, S.kind, rows);
    }
    $('#hl', root).innerHTML = rows.length ? highlights(M, S.kind, rows) : '<div class="muted">–</div>';
    $('#rc-short', root).innerHTML = M.rc.length ? rcList(M, 14) : `<li><span></span><span></span><span class="muted">${t('rc.none')}</span></li>`;
  },
};
