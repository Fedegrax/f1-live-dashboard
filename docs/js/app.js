import { S, on, emit } from './state.js';
import * as api from './api.js';
import { prepare, sessionKind, sessionState, maxLap, fmtLap } from './data.js';
import { $, $$, h, esc, ensureSelection, chartTheme, dayTime, hhmm, clock } from './ui.js';
import { overview } from './views/overview.js';
import { laps } from './views/laps.js';
import { sectors } from './views/sectors.js';
import { strategy } from './views/strategy.js';
import { race } from './views/race.js';
import { telemetry } from './views/telemetry.js';
import { map } from './views/map.js';
import { feed } from './views/feed.js';

const views = [overview, laps, sectors, strategy, race, telemetry, map, feed];
const FLAG_IT = { GREEN: 'VERDE', YELLOW: 'GIALLA', 'DOUBLE YELLOW': 'DOPPIA GIALLA', RED: 'ROSSA', CHEQUERED: 'A SCACCHI', CLEAR: 'VIA LIBERA', BLUE: 'BLU' };
let allSessions = [];
let calendarFallback = null;
let loadToken = 0;
let usingFallback = false;
let lastPoll = 0;
let refreshing = false;
let tickN = 0;
let renderTimer = 0;

const finishedLongAgo = () => S.state === 'finished' && Date.now() > Date.parse(S.session.date_end) + 3600e3;

// ---------- theme ----------
function applyTheme(mode) {
  if (mode === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
  try { localStorage.setItem('f1d.theme', mode); } catch { /* ignore */ }
  chartTheme();
  emit('theme');
  renderActive();
}
function initTheme() {
  let mode = 'auto';
  try { mode = localStorage.getItem('f1d.theme') || 'auto'; } catch { /* ignore */ }
  if (mode !== 'auto') document.documentElement.dataset.theme = mode;
  $('#btn-theme').addEventListener('click', () => {
    const cur = (() => { try { return localStorage.getItem('f1d.theme') || 'auto'; } catch { return 'auto'; } })();
    applyTheme({ auto: 'light', light: 'dark', dark: 'auto' }[cur]);
    $('#btn-theme').title = 'Tema';
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chartTheme(); renderActive(); });
}

// ---------- hash ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { y: Number(p.get('y')) || null, m: Number(p.get('m')) || null, s: Number(p.get('s')) || null, t: p.get('t') };
}
function writeHash() {
  const p = new URLSearchParams();
  p.set('y', S.year);
  if (S.meeting) p.set('m', S.meeting.meeting_key);
  if (S.session) p.set('s', S.session.session_key);
  p.set('t', S.tab);
  history.replaceState(null, '', `#${p}`);
}

// ---------- calendar ----------
async function loadCalendarFallback() {
  if (!calendarFallback) {
    try { calendarFallback = await (await fetch('data/calendar.json')).json(); } catch { calendarFallback = { meetings: [], sessions: [] }; }
  }
  return calendarFallback;
}

async function loadYear(year) {
  S.year = year;
  let meetings = [];
  let sessions = [];
  usingFallback = false;
  try {
    [meetings, sessions] = await Promise.all([
      api.get('meetings', [['year', '=', year]], { ttl: 600e3 }),
      api.get('sessions', [['year', '=', year]], { ttl: 600e3 }),
    ]);
  } catch { /* fall through to snapshot */ }
  if (!meetings.length || !sessions.length) {
    const fb = await loadCalendarFallback();
    meetings = fb.meetings.filter(m => m.year === year);
    sessions = fb.sessions.filter(s => s.year === year);
    usingFallback = meetings.length > 0;
  }
  S.meetings = meetings.slice().sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  allSessions = sessions.slice().sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  renderMeetings();
}

function pickDefaultSession() {
  const now = Date.now();
  const live = allSessions.find(s => sessionState(s, now) === 'live');
  if (live) return live;
  const next = allSessions.find(s => Date.parse(s.date_start) > now);
  if (next && Date.parse(next.date_start) - now < 4 * 3600e3) return next;
  const past = allSessions.filter(s => Date.parse(s.date_start) <= now);
  return past[past.length - 1] || allSessions[0] || null;
}

function renderMeetings() {
  const sel = $('#sel-meeting');
  sel.innerHTML = '';
  for (const m of S.meetings) {
    const test = /testing/i.test(m.meeting_name);
    sel.append(h('option', { value: m.meeting_key }, `${test ? 'Test · ' : ''}${m.location || m.country_name} · ${m.meeting_name}${m.is_cancelled ? ' (annullato)' : ''}`));
  }
}

function selectMeeting(m, preferKey) {
  S.meeting = m;
  $('#sel-meeting').value = m ? String(m.meeting_key) : '';
  S.sessions = allSessions.filter(s => s.meeting_key === m.meeting_key);
  const now = Date.now();
  let s = preferKey ? S.sessions.find(x => x.session_key === preferKey) : null;
  if (!s) s = S.sessions.find(x => sessionState(x, now) === 'live');
  if (!s) { const next = S.sessions.find(x => Date.parse(x.date_start) > now); const past = S.sessions.filter(x => Date.parse(x.date_start) <= now); s = (next && Date.parse(next.date_start) - now < 4 * 3600e3) ? next : (past[past.length - 1] || next || S.sessions[0]); }
  renderSessions();
  if (s) selectSession(s);
}

function renderSessions() {
  const box = $('#sessions');
  box.innerHTML = '';
  const now = Date.now();
  for (const s of S.sessions) {
    const k = sessionKind(s);
    const st = sessionState(s, now);
    box.append(h('button', { class: 'spill', type: 'button', 'aria-pressed': S.session?.session_key === s.session_key, title: `${s.session_name} · ${dayTime(Date.parse(s.date_start))}`, onclick: () => { S.auto = false; syncAuto(); selectSession(s); } }, h('span', { class: `dot ${st}` }), k.code));
  }
}

function syncAuto() { $('#btn-auto').setAttribute('aria-pressed', String(S.auto)); }

// ---------- session load ----------
function selectSession(s) {
  S.session = s;
  S.kind = sessionKind(s);
  S.state = sessionState(s);
  S.raw = {};
  S.M = null;
  S.failed.clear();
  S.sel = new Set();
  S.selTouched = false;
  renderSessions();
  renderHero();
  renderTabs();
  if (!views.find(v => v.id === S.tab)?.available()) setTab('overview');
  writeHash();
  loadSession();
  renderActive();
}

// official results only count once the session is over; live order comes from lap times / positions
function buildModel() {
  return prepare(S.state === 'live' ? { ...S.raw, results: [] } : S.raw);
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = 0;
    if (!S.session) return;
    S.M = buildModel();
    ensureSelection();
    renderHero();
    renderBanners();
    renderActive();
  }, 90);
}

async function loadSession() {
  const token = ++loadToken;
  const s = S.session;
  const key = s.session_key;
  const persist = finishedLongAgo();
  lastPoll = Date.now();
  const q = (ep, extra = []) => api.get(ep, [['session_key', '=', key], ...extra], { persist });
  const jobs = {
    drivers: q('drivers'),
    laps: q('laps'),
    stints: q('stints'),
    pits: q('pit'),
    positions: q('position'),
    rc: q('race_control'),
    weather: q('weather'),
    results: q('session_result'),
    radio: q('team_radio'),
  };
  if (S.kind.race) jobs.grid = q('starting_grid');
  if (S.kind.race && S.state === 'live') jobs.intervals = q('intervals', [['date', '>=', api.iso(Date.now() - 120e3)]]);
  S.raw.drivers = [];
  S.M = buildModel();
  renderActive();
  await Promise.all(Object.entries(jobs).map(([name, p]) => p.then(rows => {
    if (token !== loadToken) return;
    S.raw[name] = rows;
    S.failed.delete(name);
    scheduleRender();
  }).catch(() => {
    if (token !== loadToken) return;
    S.failed.add(name);
    scheduleRender();
  })));
  if (token === loadToken) scheduleRender();
}

// ---------- incremental refresh ----------
function mergeRows(old, rows, keyFn) {
  if (!rows.length) return old;
  const seen = new Set((old || []).slice(-400).map(keyFn));
  const add = rows.filter(r => !seen.has(keyFn(r)));
  return add.length ? (old || []).concat(add) : old;
}
function mergeByKey(old, rows, keyFn) {
  if (!rows.length) return old;
  const m = new Map((old || []).map(r => [keyFn(r), r]));
  for (const r of rows) m.set(keyFn(r), r);
  return [...m.values()];
}
const lastDate = rows => (rows && rows.length ? Date.parse(rows[rows.length - 1].date) : null);

async function refresh() {
  if (refreshing || !S.session) return;
  refreshing = true;
  lastPoll = Date.now();
  const token = loadToken;
  const key = S.session.session_key;
  const q = (ep, extra = []) => api.get(ep, [['session_key', '=', key], ...extra]);
  const tick = tickN++;
  try {
    const tasks = [];
    const R = S.raw;
    const lapRows = R.laps || [];
    const maxT0 = lapRows.reduce((m, l) => (l.date_start ? Math.max(m, Date.parse(l.date_start)) : m), 0);
    const fullLaps = !maxT0 || tick % 6 === 0;
    tasks.push(q('laps', fullLaps ? [] : [['date_start', '>=', api.iso(maxT0 - 10 * 60e3)]]).then(rows => { R.laps = fullLaps ? rows : mergeByKey(R.laps, rows, l => `${l.driver_number}|${l.lap_number}`); }));
    const lp = lastDate(R.positions);
    tasks.push(q('position', lp ? [['date', '>=', api.iso(lp)]] : []).then(rows => { R.positions = lp ? mergeRows(R.positions, rows, p => `${p.driver_number}|${p.date}`) : rows; }));
    const lr = lastDate(R.rc);
    tasks.push(q('race_control', lr ? [['date', '>=', api.iso(lr)]] : []).then(rows => { R.rc = lr ? mergeRows(R.rc, rows, p => `${p.date}|${p.message}`) : rows; }));
    if (tick % 2 === 0) {
      tasks.push(q('stints').then(rows => { R.stints = rows; }));
      tasks.push(q('pit').then(rows => { R.pits = rows; }));
      tasks.push(q('session_result').then(rows => { R.results = rows; }));
      const lw = lastDate(R.weather);
      tasks.push(q('weather', lw ? [['date', '>=', api.iso(lw)]] : []).then(rows => { R.weather = lw ? mergeRows(R.weather, rows, p => p.date) : rows; }));
      if (S.kind.race && S.state === 'live') tasks.push(q('intervals', [['date', '>=', api.iso(Date.now() - 90e3)]]).then(rows => { R.intervals = rows; }));
    }
    if (tick % 4 === 0) tasks.push(q('team_radio').then(rows => { R.radio = rows; }));
    await Promise.allSettled(tasks);
    if (token === loadToken) scheduleRender();
  } finally { refreshing = false; }
}

function desiredInterval() {
  if (!S.session) return 0;
  if (api.status.locked) return 30000;
  if (S.state === 'live') return 12000;
  const end = Date.parse(S.session.date_end);
  if (S.state === 'finished' && Date.now() < end + 90 * 60e3) return 45000;
  return 0;
}

function loop() {
  if (!S.session) return;
  const st = sessionState(S.session);
  if (st !== S.state) {
    S.state = st;
    renderSessions();
    renderHero();
    loadSession();
  } else {
    const every = desiredInterval();
    if (every && Date.now() - lastPoll >= every) {
      if (api.status.locked) loadSession(); else refresh();
    }
  }
  if (S.auto) {
    const live = allSessions.find(s => sessionState(s) === 'live');
    if (live && live.session_key !== S.session.session_key) {
      const m = S.meetings.find(x => x.meeting_key === live.meeting_key);
      if (m) selectMeeting(m, live.session_key);
    }
  }
  const cd = $('#countdown');
  if (cd && S.state === 'upcoming') cd.textContent = countdown(Date.parse(S.session.date_start) - Date.now());
}

function countdown(ms) {
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${d ? `${d}g ` : ''}${hh ? `${hh}h ` : ''}${mm}m ${String(ss).padStart(2, '0')}s`;
}

// ---------- rendering ----------
function chip(label, value, cls = '') {
  return `<div class="chip ${cls}"><b>${value}</b><span>${esc(label)}</span></div>`;
}

function renderHero() {
  const hero = $('#hero');
  const m = S.meeting;
  const s = S.session;
  if (!m || !s) { hero.innerHTML = ''; return; }
  const M = S.M;
  const start = Date.parse(s.date_start);
  const off = (s.gmt_offset || '00:00:00').slice(0, 6);
  const sign = off.startsWith('-') ? -1 : 1;
  const [oh, om] = off.replace(/^[+-]/, '').split(':').map(Number);
  const local = new Date(start + sign * (oh * 60 + om) * 60000).toISOString().slice(11, 16);
  const pill = S.state === 'live' ? '<span class="status-pill live">Live</span>' : S.state === 'upcoming' ? `<span class="status-pill">Inizia tra <span class="num" id="countdown">${countdown(start - Date.now())}</span></span>` : '<span class="status-pill">Sessione conclusa</span>';
  const w = M && M.weather.length ? M.weather[M.weather.length - 1] : null;
  const flagRow = M ? [...M.rc].reverse().find(r => r.category === 'Flag' && (r.scope === 'Track' || r.scope == null)) : null;
  const flag = flagRow ? (FLAG_IT[flagRow.flag] || flagRow.flag) : null;
  const chips = [];
  if (flag) chips.push(chip('Bandiera', flag, 'flag'));
  if (w) {
    chips.push(chip('Pista', `${w.track_temperature?.toFixed(1)}°`));
    chips.push(chip('Aria', `${w.air_temperature?.toFixed(1)}°`));
    chips.push(chip('Umidità', `${Math.round(w.humidity)}%`));
    chips.push(chip('Vento', `${w.wind_speed?.toFixed(1)} m/s`));
    chips.push(chip('Pioggia', w.rainfall ? 'Sì' : 'No'));
  }
  if (M && M.laps.length) {
    chips.push(chip(S.kind.race ? 'Giro' : 'Giri totali', S.kind.race ? String(maxLap(M)) : String(M.laps.filter(l => l.lap_duration != null).length)));
    if (M.overall.lap) chips.push(chip('Best sessione', fmtLap(M.overall.lap.dur)));
  }
  hero.innerHTML = `
    <div>
      <h1>${esc(m.meeting_name)}</h1>
      <div class="sub"><span>${esc(m.circuit_short_name || m.location)} · ${esc(m.country_name)}</span><span><b style="color:var(--fg)">${esc(S.kind.label)}</b> · ${esc(dayTime(start))} (ora locale ${local})</span>${usingFallback ? '<span>calendario da copia locale</span>' : ''}</div>
    </div>
    <div>${pill}</div>
    ${chips.length ? `<div class="chips" style="grid-column:1/-1">${chips.join('')}</div>` : ''}`;
}

function renderBanners() {
  const box = $('#banners');
  const a = api.authInfo();
  const out = [];
  const liveBlocked = api.status.locked || (S.state === 'live' && !a.loggedIn && S.failed.size >= 4);
  if (liveBlocked) {
    out.push(a.loggedIn
      ? '<div class="banner err"><p><b>OpenF1 ha rifiutato la richiesta.</b> Il tuo account potrebbe non avere l’abbonamento live oppure il token è scaduto.</p><button class="btn" data-open="settings" type="button">Account</button></div>'
      : '<div class="banner"><p><b>Diretta bloccata da OpenF1.</b> Durante una sessione i dati live sono riservati agli abbonati; quelli gratuiti compaiono poco dopo la fine. Questa pagina riprova ogni 30 secondi. Con un account OpenF1 vedi tutto in tempo reale.</p><button class="btn primary" data-open="settings" type="button">Accedi a OpenF1</button></div>');
  } else if (S.failed.size >= 4 && api.status.lastError) {
    out.push(`<div class="banner err"><p><b>Errore di caricamento:</b> ${esc(api.status.lastError)}. Riprovo automaticamente.</p></div>`);
  }
  if (usingFallback && !api.status.locked) out.push('<div class="banner info"><p>Non riesco a leggere il calendario da OpenF1: uso la copia salvata nel sito.</p></div>');
  box.innerHTML = out.join('');
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const v of views) {
    if (!v.available()) continue;
    nav.append(h('button', { class: 'tab', role: 'tab', id: `tab-${v.id}`, 'aria-selected': v.id === S.tab, onclick: () => setTab(v.id) }, v.label));
  }
}

function setTab(id) {
  const prev = views.find(v => v.id === S.tab);
  if (prev && prev.id !== id && prev.hide) prev.hide();
  S.tab = id;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.id === `tab-${id}`)));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${id}`));
  writeHash();
  const v = views.find(x => x.id === id);
  renderActive();
  if (v && v.show) v.show();
}

function renderActive() {
  const v = views.find(x => x.id === S.tab);
  if (!v || !S.session) return;
  try { v.update(); } catch (e) {
    console.error(e);
    const el = $(`#panel-${v.id}`);
    if (el) el.insertAdjacentHTML('afterbegin', `<div class="banner err"><p>Errore nella vista: ${esc(e.message)}</p></div>`);
  }
}

// ---------- settings dialog ----------
function renderSettings() {
  const a = api.authInfo();
  $('#set-state').innerHTML = a.loggedIn
    ? `<div class="banner info"><p>Connesso come <b>${esc(a.user)}</b>. Il token scade alle ${hhmm(a.expires)}${a.remembered ? ' e si rinnova da solo' : ''}.</p></div>`
    : '<div class="banner"><p>Non sei connesso: limiti di richieste bassi e nessun dato live.</p></div>';
}

function initSettings() {
  const dlg = $('#setdlg');
  document.addEventListener('click', e => { if (e.target.closest('[data-open="settings"]')) { renderSettings(); dlg.showModal(); } });
  $('#btn-settings').addEventListener('click', () => { renderSettings(); dlg.showModal(); });
  $('#setdlg-close').addEventListener('click', () => dlg.close());
  $('#drvdlg-close').addEventListener('click', () => $('#drvdlg').close());
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.login($('#in-user').value.trim(), $('#in-pass').value, $('#in-remember').checked);
      $('#in-pass').value = '';
      renderSettings(); renderBanners();
      dlg.close();
      loadSession();
    } catch (err) {
      $('#set-state').innerHTML = `<div class="banner err"><p>${esc(err.message)}</p></div>`;
    }
  });
  $('#form-token').addEventListener('submit', e => {
    e.preventDefault();
    const t = $('#in-token').value.trim();
    if (!t) return;
    api.setToken(t);
    $('#in-token').value = '';
    renderSettings(); renderBanners();
    dlg.close();
    loadSession();
  });
  $('#btn-logout').addEventListener('click', () => { api.logout(); renderSettings(); renderBanners(); });
  for (const d of ['#drvdlg', '#setdlg']) $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });
}

// ---------- boot ----------
async function boot() {
  initTheme();
  chartTheme();
  initSettings();
  for (const v of views) {
    const panel = h('section', { class: 'panel', id: `panel-${v.id}`, role: 'tabpanel' });
    $('#panels').append(panel);
    v.mount(panel);
  }
  on('selection', () => renderActive());
  api.onStatus(() => { renderBanners(); const f = $('#foot-status'); if (f) f.textContent = api.status.lastOk ? ` Ultimo aggiornamento ${clock(api.status.lastOk)}.` : ''; });

  const H = readHash();
  const now = new Date().getFullYear();
  const ysel = $('#sel-year');
  for (let y = now; y >= 2023; y--) ysel.append(h('option', { value: y }, String(y)));
  S.auto = !(H.s || H.m);
  syncAuto();
  if (H.t && views.some(v => v.id === H.t)) S.tab = H.t;

  ysel.addEventListener('change', async () => {
    S.auto = false; syncAuto();
    await loadYear(Number(ysel.value));
    const last = S.meetings.filter(m => !/testing/i.test(m.meeting_name)).slice(-1)[0] || S.meetings[0];
    if (last) selectMeeting(Number(ysel.value) === new Date().getFullYear() ? (S.meetings.find(m => m.meeting_key === pickDefaultSession()?.meeting_key) || last) : last);
  });
  $('#sel-meeting').addEventListener('change', e => { S.auto = false; syncAuto(); selectMeeting(S.meetings.find(m => m.meeting_key === Number(e.target.value))); });
  $('#btn-auto').addEventListener('click', () => { S.auto = !S.auto; syncAuto(); loop(); });
  $('#btn-refresh').addEventListener('click', () => { if (S.session) { api.status.locked = false; loadSession(); } });

  const year = H.y || now;
  ysel.value = String(year);
  await loadYear(year);
  let target = H.s ? allSessions.find(s => s.session_key === H.s) : null;
  if (!target) target = pickDefaultSession();
  if (!target) { $('#hero').innerHTML = '<div class="empty"><b>Nessuna sessione trovata</b>OpenF1 non restituisce sessioni per questo anno.</div>'; return; }
  const m = S.meetings.find(x => x.meeting_key === target.meeting_key);
  renderTabs();
  selectMeeting(m, target.session_key);
  setTab(S.tab);
  setInterval(loop, 3000);
  window.addEventListener('resize', () => { if (S.tab === 'map' || S.tab === 'telemetry') renderActive(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
}

boot();
