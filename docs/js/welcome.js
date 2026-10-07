// First-visit welcome screen: shown once (or when the logo is clicked), then the dashboard.
import { $, $$ } from './ui.js';
import { t, LANGS, lang, setLang } from './i18n.js';

const SEEN = 'f1d.welcomed';
const KEEP = 'f1d.welcome.keep';
const BASE = [
  { x: 150, y: 120, rx: 110, ry: 70, fill: '#2b6cff', o: 0.55 },
  { x: 260, y: 90, rx: 90, ry: 55, fill: '#22d3ee', o: 0.5 },
  { x: 210, y: 190, rx: 60, ry: 40, fill: '#a3e635', o: 0.55 },
  { x: 90, y: 230, rx: 70, ry: 45, fill: '#facc15', o: 0.45 },
  { x: 330, y: 170, rx: 55, ry: 38, fill: '#ef4444', o: 0.4 },
];

function get(k, store = localStorage) { try { return store.getItem(k); } catch { return null; } }
function set(k, v, store = localStorage) { try { store.setItem(k, v); } catch { /* ignore */ } }

function drawRain(step) {
  const ns = 'http://www.w3.org/2000/svg';
  const g = $('#w-cells');
  g.textContent = '';
  BASE.forEach((c, i) => {
    const e = document.createElementNS(ns, 'ellipse');
    e.setAttribute('cx', c.x + step * 105);
    e.setAttribute('cy', c.y + step * 32 + (i % 2) * step * 8);
    e.setAttribute('rx', c.rx + step * 6);
    e.setAttribute('ry', c.ry + step * 4);
    e.setAttribute('fill', c.fill);
    e.setAttribute('opacity', Math.max(0.15, c.o - (i > 2 ? step * 0.06 : 0)));
    g.appendChild(e);
  });
  $$('.wstep').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.step === step)));
  $('#w-step-label').textContent = t(`welcome.step.${step}`);
}

export function initWelcome(cfg = {}) {
  const root = $('#welcome');
  if (!root) return;
  const close = () => { root.hidden = true; document.body.classList.remove('w-open'); };
  const open = () => { root.hidden = false; document.body.classList.add('w-open'); root.scrollTop = 0; $('#w-open').focus({ preventScroll: true }); };
  for (const id of ['#w-open', '#w-open2']) $(id).addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });
  $('#brand-home').addEventListener('click', e => { e.preventDefault(); open(); });
  const sel = $('#w-lang');
  sel.innerHTML = LANGS.map(([c, n]) => `<option value="${c}"${c === lang ? ' selected' : ''}>${n}</option>`).join('');
  sel.addEventListener('change', () => { set(KEEP, '1', sessionStorage); setLang(sel.value); });
  if (cfg.repoUrl) { const a = $('#w-star'); a.href = cfg.repoUrl; a.hidden = false; }
  if (cfg.donateUrl) for (const id of ['#w-sponsor', '#w-sponsor2']) { const a = $(id); a.href = cfg.donateUrl; a.hidden = false; }
  $$('.wstep').forEach(b => b.addEventListener('click', () => drawRain(+b.dataset.step)));
  drawRain(0);
  const keep = get(KEEP, sessionStorage);
  if (keep) set(KEEP, '', sessionStorage);
  if (keep || (!location.hash && !get(SEEN))) { set(SEEN, '1'); open(); }
}
