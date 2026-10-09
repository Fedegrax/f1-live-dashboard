import { S, on, emit } from './state.js';
import * as api from './api.js';
import { prepare, sessionKind, sessionState, maxLap, fmtLap } from './data.js';
import { $, $$, h, esc, ensureSelection, chartTheme, dayTime, hhmm, clock, applyCompact, toggleCompact, isCompact } from './ui.js';
import { t, initI18n, setLang, LANGS, lang, applyStatic } from './i18n.js';
import { initWelcome } from './welcome.js';
import { dashboard } from './views/dashboard.js';
import { overview } from './views/overview.js';
import { championship } from './views/championship.js';
import { radar } from './views/radar.js';
import { laps } from './views/laps.js';
import { sectors } from './views/sectors.js';
import { strategy } from './views/strategy.js';
import { race } from './views/race.js';
import { telemetry } from './views/telemetry.js';
import { map } from './views/map.js';
import { feed } from './views/feed.js';

const views = [dashboard, overview, championship, radar, laps, sectors, strategy, race, telemetry, map, feed];
const flagName = f => { const k = `flag.${String(f).replace(/ /g, '_')}`; const v = t(k); return v === k ? f : v; };
const kindLabel = k => { const key = `session.${k.code}`; const v = t(key); return v === key ? k.label : v; };
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
    sel.append(h('option', { value: m.meeting_key }, `${test ? `${t('meeting.test')} · ` : ''}${m.location || m.country_name} · ${m.meeting_name}${m.is_cancelled ? ` (${t('meeting.cancelled')})` : ''}`));
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
  revealCurrentSession();
}

function revealCurrentSession() { $('#sessions [aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }

function syncAuto() { $('#btn-auto').setAttribute('aria-pressed', String(S.auto)); }

// ---------- session load ----------
function selectSession(s) {
  S.session = s;
  S.kind = sessionKind(s);
  S.state = sessionState(s);
  api.setContext(s.session_key, S.state);
  S.raw = {};
  S.M = null;
  S.failed.clear();
  S.sel = new Set();
  S.selTouched = false;
  renderSessions();
  renderHero();
  renderTabs();
  if (!views.find(v => v.id === S.tab)?.available()) setTab('dashboard');
  writeHash();
  loadSession();
  renderActive();
}

// official results only count once the session is over; live order comes from lap times / positions, or from the relay's live order
function buildModel() {
  return prepare(S.state === 'live' && !api.relayActive() ? { ...S.raw, results: [] } : S.raw);
}

let dirty = false;
function scheduleRender() {
  if (document.hidden) { dirty = true; return; }
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
  loadChampionship(token);
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

// ---------- championship (points before the session + official points once published) ----------
async function loadChampionship(token) {
  S.champ = { base: [], baseTeams: [], official: null, officialTeams: null };
  const s = S.session;
  const start = Date.parse(s.date_start);
  const prev = allSessions.filter(x => (x.session_name === 'Race' || x.session_name === 'Sprint') && Date.parse(x.date_end) < start && x.session_key !== s.session_key).pop();
  const jobs = [];
  if (prev) {
    const f = [['session_key', '=', prev.session_key]];
    jobs.push(api.get('championship_drivers', f, { persist: true }).then(r => { S.champ.base = r; }));
    jobs.push(api.get('championship_teams', f, { persist: true }).then(r => { S.champ.baseTeams = r; }));
  }
  jobs.push(fetchOfficialChampionship(token));
  await Promise.allSettled(jobs);
  if (token === loadToken) scheduleRender();
}

async function fetchOfficialChampionship(token) {
  const s = S.session;
  if (S.state !== 'finished' || !(s.session_name === 'Race' || s.session_name === 'Sprint')) return;
  const f = [['session_key', '=', s.session_key]];
  const persist = finishedLongAgo();
  const [d, tm] = await Promise.all([api.get('championship_drivers', f, { persist }), api.get('championship_teams', f, { persist })]);
  if (token !== loadToken) return;
  if (d.length) { S.champ.official = d; S.champ.officialTeams = tm.length ? tm : null; }
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
    if (tick % 3 === 0 && S.state === 'finished' && !S.champ.official) tasks.push(fetchOfficialChampionship(token));
    if (tick % 4 === 0) tasks.push(q('team_radio').then(rows => { R.radio = rows; }));
    await Promise.allSettled(tasks);
    if (token === loadToken) scheduleRender();
  } finally { refreshing = false; }
}

function desiredInterval() {
  if (!S.session) return 0;
  if (S.state === 'live' && api.relayActive()) return 5000;
  if (api.status.locked) return 30000;
  if (S.state === 'live') return 12000;
  const end = Date.parse(S.session.date_end);
  if (S.state === 'finished' && Date.now() < end + 90 * 60e3) return 45000;
  return 0;
}

let lastRelay = 0;
async function relayTick() {
  if (!api.relay.url || Date.now() - lastRelay < 10000) return;
  lastRelay = Date.now();
  const before = api.relayActive();
  await api.refreshRelay();
  renderBanners();
  if (!before && api.relayActive() && S.state === 'live') loadSession();
}

function loop() {
  if (!S.session) return;
  relayTick();
  const st = sessionState(S.session);
  if (st !== S.state) {
    S.state = st;
    api.setContext(S.session.session_key, st);
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
  const pill = S.state === 'live' ? `<span class="status-pill live">${t('status.live')}</span><span class="fresh" id="fresh"></span>` : S.state === 'upcoming' ? `<span class="status-pill">${t('status.startsIn')} <span class="num" id="countdown">${countdown(start - Date.now())}</span></span>` : `<span class="status-pill">${t('status.ended')}</span>`;
  const w = M && M.weather.length ? M.weather[M.weather.length - 1] : null;
  const flagRow = M ? [...M.rc].reverse().find(r => r.category === 'Flag' && (r.scope === 'Track' || r.scope == null)) : null;
  const flag = flagRow ? flagName(flagRow.flag) : null;
  const chips = [];
  if (flag) chips.push(chip(t('chip.flag'), flag, 'flag'));
  if (w) {
    chips.push(chip(t('chip.track'), `${w.track_temperature?.toFixed(1)}°`));
    chips.push(chip(t('chip.air'), `${w.air_temperature?.toFixed(1)}°`));
    chips.push(chip(t('chip.humidity'), `${Math.round(w.humidity)}%`));
    chips.push(chip(t('chip.wind'), `${w.wind_speed?.toFixed(1)} m/s`));
    chips.push(chip(t('chip.rain'), w.rainfall ? t('common.yes') : t('common.no')));
  }
  if (M && M.laps.length) {
    chips.push(chip(S.kind.race ? t('chip.lap') : t('chip.totalLaps'), S.kind.race ? String(maxLap(M)) : String(M.laps.filter(l => l.lap_duration != null).length)));
    if (M.overall.lap) chips.push(chip(t('chip.best'), fmtLap(M.overall.lap.dur)));
  }
  hero.innerHTML = `
    <div>
      <h1>${esc(m.meeting_name)}</h1>
      <div class="sub"><span>${esc(m.circuit_short_name || m.location)} · ${esc(m.country_name)}</span><span><b style="color:var(--fg)">${esc(kindLabel(S.kind))}</b> · ${esc(dayTime(start))} (${t('hero.local', { time: local })})</span>${usingFallback ? `<span>${t('hero.fallback')}</span>` : ''}</div>
    </div>
    <div>${pill}</div>
    ${chips.length ? `<div class="chips" style="grid-column:1/-1">${chips.join('')}</div>` : ''}`;
}

function renderBanners() {
  const box = $('#banners');
  const a = api.authInfo();
  const out = [];
  const liveRelay = S.state === 'live' && api.relayActive();
  if (liveRelay) out.push(`<div class="banner info${api.relay.info.partial ? '' : ' quiet'}"><p><b>${t('ban.relay.title')}</b> ${t('ban.relay.text')}${api.relay.info.partial ? ` ${t('ban.relay.partial')}` : ''}</p></div>`);
  const liveBlocked = !liveRelay && (api.status.locked || (S.state === 'live' && !a.loggedIn && S.failed.size >= 4));
  if (liveBlocked) {
    out.push(a.loggedIn
      ? `<div class="banner err"><p><b>${t('ban.rejected.title')}</b> ${t('ban.rejected.text')}</p><button class="btn" data-open="settings" type="button">${t('ban.account')}</button></div>`
      : `<div class="banner"><p><b>${t('ban.locked.title')}</b> ${t('ban.locked.text')}</p><button class="btn primary" data-open="settings" type="button">${t('ban.locked.cta')}</button></div>`);
  } else if (S.failed.size >= 4 && api.status.lastError) {
    out.push(`<div class="banner err"><p><b>${t('ban.error.title')}</b> ${esc(api.status.lastError)}. ${t('ban.error.retry')}</p></div>`);
  }
  if (usingFallback && !api.status.locked) out.push(`<div class="banner info"><p>${t('ban.calendar')}</p></div>`);
  box.innerHTML = out.join('');
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const v of views) {
    if (!v.available()) continue;
    nav.append(h('button', { class: 'tab', role: 'tab', id: `tab-${v.id}`, 'aria-controls': `panel-${v.id}`, tabindex: v.id === S.tab ? 0 : -1, 'aria-selected': v.id === S.tab, onclick: () => setTab(v.id), onkeydown: tabKey }, t(`tab.${v.id}`)));
  }
}

function tabKey(e) {
  const tabs = $$('.tab');
  const i = tabs.indexOf(e.currentTarget);
  const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
  if (j < 0) return;
  e.preventDefault();
  tabs[j].focus();
  tabs[j].click();
}

function setTab(id) {
  const prev = views.find(v => v.id === S.tab);
  if (prev && prev.id !== id && prev.hide) prev.hide();
  S.tab = id;
  $$('.tab').forEach(tb => { tb.setAttribute('aria-selected', String(tb.id === `tab-${id}`)); tb.tabIndex = tb.id === `tab-${id}` ? 0 : -1; });
  $(`#tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
    if (el) el.insertAdjacentHTML('afterbegin', `<div class="banner err"><p>${t('ban.view')} ${esc(e.message)}</p></div>`);
  }
}

// ---------- settings dialog ----------
function renderSettings() {
  const a = api.authInfo();
  $('#set-state').innerHTML = a.loggedIn
    ? `<div class="banner info"><p>${t('set.connected', { user: esc(a.user), time: hhmm(a.expires) })}${a.remembered ? ` ${t('set.renews')}` : ''}</p></div>`
    : `<div class="banner"><p>${t('set.disconnected')}</p></div>`;
}

function renderRelayState() {
  const el = $('#relay-state');
  const r = api.relay;
  if (!r.url) el.innerHTML = `<div class="banner"><p>${t('set.relay.none')}</p></div>`;
  else if (!r.ok) el.innerHTML = `<div class="banner err"><p>${t('set.relay.down', { url: esc(r.url) })}</p></div>`;
  else el.innerHTML = `<div class="banner info"><p>${t('set.relay.ok', { url: esc(r.url), session: esc([r.info.meeting, r.info.sessionName].filter(Boolean).join(' · ') || '–') })}</p></div>`;
  $('#in-relay').value = r.url || '';
}

function initSettings() {
  const dlg = $('#setdlg');
  const open = () => { renderSettings(); renderRelayState(); dlg.showModal(); };
  document.addEventListener('click', e => { if (e.target.closest('[data-open="settings"]')) open(); });
  $('#btn-settings').addEventListener('click', open);
  $('#form-relay').addEventListener('submit', async e => { e.preventDefault(); await api.setRelayUrl($('#in-relay').value); renderRelayState(); renderBanners(); if (api.relayActive() && S.state === 'live') loadSession(); });
  $('#btn-relay-clear').addEventListener('click', async () => { await api.setRelayUrl(''); renderRelayState(); renderBanners(); });
  $('#setdlg-close').addEventListener('click', () => dlg.close());
  $('#drvdlg-close').addEventListener('click', () => $('#drvdlg').close());
  $('#aboutdlg-close').addEventListener('click', () => $('#aboutdlg').close());
  $('#btn-about').addEventListener('click', () => { $('#about-body').innerHTML = t('about.body'); $('#aboutdlg').showModal(); });
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
  for (const d of ['#drvdlg', '#setdlg', '#aboutdlg']) $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });
}

// ---------- language, donate and footer links ----------
let wake = null;
async function keepAwake() {
  const on = $('#btn-wake').getAttribute('aria-pressed') === 'true';
  try {
    if (on && !wake && !document.hidden) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    if (!on && wake) { await wake.release(); wake = null; }
  } catch { /* not granted */ }
}

function freshness() {
  const el = $('#fresh');
  if (!el) return;
  const last = api.status.lastOk;
  if (!last || S.state === 'finished') { el.textContent = ''; return; }
  const sec = Math.max(0, Math.round((Date.now() - last) / 1000));
  el.textContent = sec < 3 ? t('fresh.now') : t('fresh.ago', { s: sec });
  el.classList.toggle('stale', sec > 45 && S.state === 'live');
}

function initChrome() {
  const cfg = window.PITWALL || {};
  const compactBtn = $('#btn-compact');
  const syncCompact = () => compactBtn.setAttribute('aria-pressed', String(isCompact()));
  applyCompact(); syncCompact();
  compactBtn.addEventListener('click', () => { toggleCompact(); syncCompact(); renderActive(); });
  matchMedia('(max-width: 720px)').addEventListener('change', () => { applyCompact(); syncCompact(); renderActive(); });
  const menu = $('#btn-menu');
  menu.addEventListener('click', () => { const open = $('.topbar').classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  if ('wakeLock' in navigator) {
    const wb = $('#btn-wake');
    wb.hidden = false;
    wb.addEventListener('click', () => { wb.setAttribute('aria-pressed', String(wb.getAttribute('aria-pressed') !== 'true')); keepAwake(); });
  }
  setInterval(freshness, 1000);
  if ('serviceWorker' in navigator && /^(https:|http:\/\/localhost)/.test(location.href) && !new URLSearchParams(location.search).has('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
  const sel = $('#sel-lang');
  for (const [code, name] of LANGS) sel.append(h('option', { value: code, selected: code === lang }, name));
  sel.addEventListener('change', () => setLang(sel.value));
  if (cfg.donateUrl) {
    for (const id of ['#btn-donate', '#foot-donate-link']) $(id).href = cfg.donateUrl;
    $('#btn-donate').hidden = false;
    $('#foot-donate').hidden = false;
  }
  initWelcome(cfg);
  if (cfg.repoUrl) { $('#foot-repo').href = cfg.repoUrl; $('#foot-issues').href = `${cfg.repoUrl}/issues`; }
  if (cfg.relayUrl) { try { if (!localStorage.getItem('f1d.relay')) localStorage.setItem('f1d.relay', cfg.relayUrl); } catch { /* ignore */ } }
}

// ---------- boot ----------
async function boot() {
  await initI18n();
  initChrome();
  initTheme();
  chartTheme();
  initSettings();
  for (const v of views) {
    const panel = h('section', { class: 'panel', id: `panel-${v.id}`, role: 'tabpanel' });
    $('#panels').append(panel);
    v.mount(panel);
  }
  on('selection', () => renderActive());
  api.onStatus(() => { renderBanners(); const f = $('#foot-status'); if (f) f.textContent = api.status.lastOk ? t('foot.updated', { time: clock(api.status.lastOk) }) : ''; });

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

  await api.initRelay();
  const year = H.y || now;
  ysel.value = String(year);
  await loadYear(year);
  let target = H.s ? allSessions.find(s => s.session_key === H.s) : null;
  if (!target) target = pickDefaultSession();
  if (!target) { $('#hero').innerHTML = `<div class="empty"><b>${t('empty.noSession.title')}</b>${t('empty.noSession.text')}</div>`; return; }
  const m = S.meetings.find(x => x.meeting_key === target.meeting_key);
  renderTabs();
  selectMeeting(m, target.session_key);
  setTab(S.tab);
  setInterval(loop, 3000);
  window.addEventListener('resize', () => { if (S.tab === 'map' || S.tab === 'telemetry') renderActive(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (dirty) { dirty = false; scheduleRender(); } loop(); keepAwake(); } });
}

boot();
