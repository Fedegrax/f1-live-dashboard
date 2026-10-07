// OpenF1 client: throttled queue, retries, optional OAuth login, IndexedDB cache for finished sessions.
const BASE = 'https://api.openf1.org';
const LS_AUTH = 'f1d.auth';
const MAX_ACTIVE = 2;
const MIN_GAP_MS = 380; // ~2.6 req/s (free tier: 3 req/s, 30 req/min)
const FREE_PER_MIN = 27;
const stamps = [];

export class ApiError extends Error {
  constructor(message, status, kind) {
    super(message);
    this.status = status;
    this.kind = kind; // 'locked' | 'too-much' | 'rate' | 'network' | 'server'
  }
}

export const status = {
  locked: false,
  lastError: null,
  lastOk: 0,
  requests: 0,
  rateLimited: 0,
};

const subs = new Set();
export function onStatus(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { subs.forEach(fn => { try { fn(status); } catch { /* ignore */ } }); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- auth ----------
function readAuth() {
  try { return JSON.parse(localStorage.getItem(LS_AUTH)) || {}; } catch { return {}; }
}
function writeAuth(a) {
  try { localStorage.setItem(LS_AUTH, JSON.stringify(a)); } catch { /* storage unavailable */ }
}
let auth = readAuth();

export function authInfo() {
  return {
    loggedIn: !!auth.token && auth.exp > Date.now(),
    user: auth.user || '',
    remembered: !!auth.pass,
    expires: auth.exp || 0,
  };
}

export async function login(user, pass, remember) {
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* not json */ }
    throw new ApiError(detail || `Login fallito (${res.status})`, res.status, 'locked');
  }
  const j = await res.json();
  auth = {
    token: j.access_token,
    exp: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    user,
    pass: remember ? pass : undefined,
  };
  writeAuth(auth);
  status.locked = false;
  emit();
  return auth;
}

export function setToken(token) {
  auth = { token, exp: Date.now() + 55 * 60 * 1000, user: 'token' };
  writeAuth(auth);
  status.locked = false;
  emit();
}

export function logout() {
  auth = {};
  writeAuth(auth);
  emit();
}

async function ensureToken() {
  if (auth.token && auth.exp - 60000 > Date.now()) return auth.token;
  if (auth.user && auth.pass) {
    try { await login(auth.user, auth.pass, true); } catch { /* fall through unauthenticated */ }
    return auth.token || null;
  }
  return null;
}

// ---------- queue ----------
let active = 0;
let nextSlot = 0;
const waiters = [];
async function acquire() {
  while (active >= MAX_ACTIVE) await new Promise(r => waiters.push(r));
  active++;
  if (!(auth.token && auth.exp > Date.now())) {
    // free tier: stay under the per-minute cap so we never get rate limited
    for (;;) {
      const now0 = Date.now();
      while (stamps.length && now0 - stamps[0] > 60000) stamps.shift();
      if (stamps.length < FREE_PER_MIN) break;
      await sleep(stamps[0] + 60000 - now0 + 50);
    }
    stamps.push(Date.now());
  }
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await sleep(wait);
}
function release() {
  active--;
  const w = waiters.shift();
  if (w) w();
}

// ---------- cache ----------
const mem = new Map();
const inflight = new Map();
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise(resolve => {
      try {
        const rq = indexedDB.open('f1d-cache', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbp;
}
async function idbGet(key) {
  const d = await db();
  if (!d) return undefined;
  return new Promise(resolve => {
    try {
      const rq = d.transaction('kv').objectStore('kv').get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
async function idbSet(key, value) {
  const d = await db();
  if (!d) return;
  try { d.transaction('kv', 'readwrite').objectStore('kv').put(value, key); } catch { /* quota */ }
}

// ---------- live relay ----------
// A relay (server/server.js) reads the free F1 live feed and serves it with the OpenF1 API shape.
const LS_RELAY = 'f1d.relay';
const RELAY_ENDPOINTS = new Set(['drivers', 'laps', 'stints', 'pit', 'position', 'intervals', 'race_control', 'weather', 'team_radio', 'car_data', 'location']);
export const relay = { url: '', info: null, ok: false, key: null, state: null };

function relayCandidates() {
  const out = [];
  try { const p = new URLSearchParams(location.search).get('relay'); if (p) { out.push(p); localStorage.setItem(LS_RELAY, p); } } catch { /* ignore */ }
  try { const v = localStorage.getItem(LS_RELAY); if (v) out.push(v); } catch { /* ignore */ }
  if (/^https?:$/.test(location.protocol)) out.push(location.origin);
  return [...new Set(out.map(u => u.replace(/\/+$/, '')))];
}

export async function probeRelay(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${url}/live`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.relay ? j : null;
  } catch { return null; }
}

export async function initRelay() {
  for (const url of relayCandidates()) {
    const info = await probeRelay(url);
    if (info) { Object.assign(relay, { url, info, ok: true }); emit(); return true; }
  }
  return false;
}

export async function setRelayUrl(url) {
  url = (url || '').trim().replace(/\/+$/, '');
  try { if (url) localStorage.setItem(LS_RELAY, url); else localStorage.removeItem(LS_RELAY); } catch { /* ignore */ }
  if (!url) { Object.assign(relay, { url: '', info: null, ok: false }); emit(); return null; }
  const info = await probeRelay(url);
  Object.assign(relay, { url, info, ok: !!info });
  emit();
  return info;
}

export async function refreshRelay() {
  if (!relay.url) return;
  const info = await probeRelay(relay.url);
  relay.info = info;
  relay.ok = !!info;
  emit();
}

export function setContext(key, state) { relay.key = key; relay.state = state; }

// true when the relay is connected to the session the dashboard is showing
export const relayActive = () => relay.ok && relay.info && relay.info.connected && relay.info.sessionKey === relay.key && relay.info.counts.drivers > 0;

async function relayGet(endpoint, filters) {
  const res = await fetch(buildUrl(endpoint, filters).replace('https://api.openf1.org', relay.url));
  if (res.status === 404) return [];
  if (!res.ok) throw new ApiError(`Relay ${res.status}`, res.status, res.status === 422 ? 'too-much' : 'server');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function relayApplies(endpoint, filters) {
  if (!relayActive() || !RELAY_ENDPOINTS.has(endpoint)) return false;
  const sk = filters.find(f => f[0] === 'session_key' && f[1] === '=');
  return !!sk && Number(sk[2]) === relay.info.sessionKey;
}

// ---------- requests ----------
// filters: array of [key, op, value]; op one of '=', '>=', '<=', '>', '<'
export function buildUrl(endpoint, filters = []) {
  const qs = filters.map(([k, op, v]) => `${k}${op}${encodeURIComponent(v)}`).join('&');
  return `${BASE}/v1/${endpoint}${qs ? `?${qs}` : ''}`;
}

async function fetchJson(url, attempt = 0) {
  await acquire();
  let res;
  try {
    const token = await ensureToken();
    const headers = { accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    status.requests++;
    res = await fetch(url, { headers });
  } catch (e) {
    release();
    status.lastError = 'Rete non raggiungibile';
    emit();
    if (attempt < 2) { await sleep(800 * (attempt + 1)); return fetchJson(url, attempt + 1); }
    throw new ApiError('Rete non raggiungibile', 0, 'network');
  }
  release();

  if (res.status === 429) {
    status.rateLimited++;
    emit();
    if (attempt < 5) {
      const ra = Number(res.headers.get('retry-after')) || 1.5 * (attempt + 1);
      await sleep(ra * 1000);
      return fetchJson(url, attempt + 1);
    }
    throw new ApiError('Troppe richieste (rate limit)', 429, 'rate');
  }
  if (res.status === 404) { status.lastOk = Date.now(); return []; }
  if (res.status === 401 || res.status === 403) {
    status.locked = true;
    status.lastError = 'Dati live riservati agli abbonati OpenF1';
    emit();
    throw new ApiError('Accesso live non autorizzato', res.status, 'locked');
  }
  if (res.status === 422) throw new ApiError('Richiesta troppo grande', 422, 'too-much');
  if (!res.ok) {
    if (attempt < 2) { await sleep(1000 * (attempt + 1)); return fetchJson(url, attempt + 1); }
    status.lastError = `Errore server ${res.status}`;
    emit();
    throw new ApiError(`Errore server ${res.status}`, res.status, 'server');
  }
  status.locked = false;
  status.lastError = null;
  status.lastOk = Date.now();
  emit();
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// opts.persist: store in IndexedDB (only for immutable, finished-session data)
// opts.ttl: ms to reuse the in-memory copy
export async function get(endpoint, filters = [], opts = {}) {
  if (relayApplies(endpoint, filters)) {
    if (relay.state === 'live') {
      try { return await relayGet(endpoint, filters); } catch { /* fall back to OpenF1 */ }
    } else if (relay.state === 'finished') {
      // finished session: OpenF1 has the complete record, the relay only fills the gaps
      try {
        const rows = await getDirect(endpoint, filters, opts);
        if (rows.length) return rows;
      } catch (e) { if (e.kind !== 'locked') throw e; }
      return relayGet(endpoint, filters);
    }
  }
  return getDirect(endpoint, filters, opts);
}

async function getDirect(endpoint, filters, opts) {
  const url = buildUrl(endpoint, filters);
  const hit = mem.get(url);
  if (hit && (opts.persist || (opts.ttl && Date.now() - hit.t < opts.ttl))) return hit.data;
  if (inflight.has(url)) return inflight.get(url);

  const p = (async () => {
    if (opts.persist) {
      const stored = await idbGet(url);
      if (stored && stored.length !== undefined) { mem.set(url, { t: Date.now(), data: stored }); return stored; }
    }
    const data = await fetchJson(url);
    if (opts.persist || opts.ttl) mem.set(url, { t: Date.now(), data });
    if (opts.persist && data.length) idbSet(url, data);
    return data;
  })();
  inflight.set(url, p);
  try { return await p; } finally { inflight.delete(url); }
}

export const iso = ms => new Date(ms).toISOString().slice(0, 23);
