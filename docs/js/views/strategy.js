import { S } from '../state.js';
import { timingRows, maxLap, compoundOf, COMPOUND } from '../data.js';
import { $, esc, drvCell, emptyState, clock } from '../ui.js';

let root;

function timeline(M) {
  const rows = timingRows(M, S.kind);
  const N = Math.max(maxLap(M), 1);
  const step = N > 40 ? 10 : N > 20 ? 5 : N > 10 ? 2 : 1;
  const ticks = [];
  for (let l = 0; l <= N; l += step) ticks.push(l);
  const axisHtml = `<div class="axis"><b></b><div>${ticks.map(t => `<span style="left:${(t / N) * 100}%">${t}</span>`).join('')}</div></div>`;
  const lines = rows.filter(r => M.stintsBy.has(r.num)).map(r => {
    const stints = M.stintsBy.get(r.num).map(s => {
      const end = s.lap_end ?? Math.max(r.laps, s.lap_start);
      const len = Math.max(1, end - s.lap_start + 1);
      const c = compoundOf(s.compound);
      const left = ((s.lap_start - 1) / N) * 100;
      const width = (len / N) * 100;
      const age = s.tyre_age_at_start > 0 ? ` (usata ${s.tyre_age_at_start} giri)` : ' (nuova)';
      return `<div class="stint" style="left:${left}%;width:${width}%;background:${c.color}" title="${esc(c.label)} · giri ${s.lap_start}–${end}${age}">${len >= 3 ? `${c.short}${len}` : ''}</div>`;
    }).join('');
    return `<div class="stint-row"><div>${drvCell(r.d, true)}</div><div class="stint-track">${stints}</div></div>`;
  }).join('');
  const legend = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].map(k => `<span><i style="background:${COMPOUND[k].color}"></i>${COMPOUND[k].label}</span>`).join('');
  return `<div class="legend" style="margin-bottom:10px">${legend}</div>${axisHtml}${lines}`;
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
      <div class="grid side">
        <section class="card"><header><h2>Stint e mescole</h2></header><div class="body" id="stints"></div></section>
        <div class="grid">
          <section class="card"><header><h2>Uso gomme</h2></header><div class="body"><div class="stat-grid" id="cuse"></div></div></section>
          <section class="card"><header><h2>Pit stop</h2></header><div id="pits"></div></section>
        </div>
      </div>`;
  },
  update() {
    const M = S.M;
    if (!M || !M.stintsBy.size) {
      $('#stints', root).innerHTML = emptyState('Nessuno stint registrato', 'Le mescole compaiono appena le monoposto escono dai box.');
      $('#cuse', root).innerHTML = '';
      $('#pits', root).innerHTML = '';
      return;
    }
    $('#stints', root).innerHTML = timeline(M);
    $('#cuse', root).innerHTML = compoundUse(M);
    $('#pits', root).innerHTML = pitTable(M);
  },
};
