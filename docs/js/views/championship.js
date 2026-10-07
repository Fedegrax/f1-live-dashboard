// World championship with the points being earned in the current Race or Sprint shown in green.
import { S } from '../state.js';
import { t } from '../i18n.js';
import { esc, emptyState } from '../ui.js';
import { timingRows, buildChampionship, pointsTable } from '../data.js';

let root;

export function compute() {
  const M = S.M;
  const c = S.champ || {};
  const rows = M ? timingRows(M, S.kind) : [];
  return buildChampionship({ base: c.base || [], baseTeams: c.baseTeams || [], rows, kind: S.kind, drivers: M ? M.drv : null, official: c.official, officialTeams: c.officialTeams });
}

function move(r) {
  const d = r.posStart - r.pos;
  return d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : '<span class="muted">·</span>';
}
const gainCell = r => (r.gain > 0 ? `<span class="gain">+${r.gain}</span>` : '<span class="muted">–</span>');

export function driversHtml(ch = compute()) {
  if (!ch.drivers.length) return emptyState(t('ch.empty.title'), t('ch.empty.text'));
  const body = ch.drivers.map(r => `<tr class="${r.gain > 0 ? 'scoring' : ''}"><td class="pos">${r.pos}</td><td class="mv">${move(r)}</td><td class="l"><div class="drv"><span class="bar" style="background:${esc(r.d?.color || '#8a8f98')}"></span><div><div class="acr">${esc(r.d?.acr || r.num)}</div><div class="nm">${esc(r.team)}</div></div></div></td><td class="opt">${r.start}</td><td>${gainCell(r)}</td><td class="tot">${r.total}</td></tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th>P</th><th></th><th class="l">${t('tower.driver')}</th><th class="opt">${t('ch.before')}</th><th>${t('ch.live')}</th><th>${t('ch.total')}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function teamsHtml(ch = compute()) {
  if (!ch.teams.length) return emptyState(t('ch.empty.title'), t('ch.empty.text'));
  const body = ch.teams.map(r => `<tr class="${r.gain > 0 ? 'scoring' : ''}"><td class="pos">${r.pos}</td><td class="mv">${move(r)}</td><td class="l"><div class="drv"><span class="bar" style="background:${esc(r.color)}"></span><div class="acr" style="font-size:15px">${esc(r.name)}</div></div></td><td class="opt">${r.start}</td><td>${gainCell(r)}</td><td class="tot">${r.total}</td></tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th>P</th><th></th><th class="l">${t('ch.team')}</th><th class="opt">${t('ch.before')}</th><th>${t('ch.live')}</th><th>${t('ch.total')}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function noteText(ch = compute()) {
  const c = S.champ || {};
  if (c.official && c.official.length) return t('ch.note.official');
  if (S.kind.code === 'GP') return t('ch.note.race');
  if (S.kind.code === 'SPR') return t('ch.note.sprint');
  return t('ch.note.none');
}

export const championship = {
  id: 'championship',
  available: () => true,
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="grid">
        <p class="hint" id="ch-note" style="margin:0"></p>
        <div class="grid cols-2">
          <section class="card"><header><h2>${t('w.champdrivers')}</h2></header><div id="ch-drivers"></div></section>
          <section class="card"><header><h2>${t('w.champteams')}</h2></header><div id="ch-teams"></div></section>
        </div>
      </div>`;
  },
  update() {
    if (!S.session) return;
    const ch = compute();
    root.querySelector('#ch-note').textContent = noteText(ch);
    root.querySelector('#ch-drivers').innerHTML = driversHtml(ch);
    root.querySelector('#ch-teams').innerHTML = teamsHtml(ch);
  },
};
