// Live model: turns the raw F1 live-timing topics into OpenF1-shaped tables that the dashboard already understands.
import zlib from 'node:zlib';

export const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Deep merge of an incremental patch. F1 sends arrays either whole or as {"index": value} objects.
export function merge(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (k === '_kf' || k === '_deleted') continue;
    if (isObj(v)) {
      if (Array.isArray(target[k])) {
        for (const idx of Object.keys(v)) {
          const i = Number(idx);
          target[k][i] = isObj(v[idx]) ? merge(isObj(target[k][i]) ? target[k][i] : {}, v[idx]) : v[idx];
        }
      } else {
        target[k] = merge(isObj(target[k]) ? target[k] : {}, v);
      }
    } else target[k] = v;
  }
  return target;
}

export function parseLap(s) {
  if (s == null || s === '') return null;
  const m = String(s).match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000) / 1000;
}
const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
export function parseGap(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\+?\d+(\.\d+)?$/.test(s)) return Number(s.replace('+', ''));
  return s; // "LAP 1", "1L", ...
}
export const decodeZ = b64 => JSON.parse(zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8'));
const iso = ms => new Date(ms).toISOString().replace('Z', '+00:00');
const arr = x => (Array.isArray(x) ? x : isObj(x) ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);
const at = (x, i) => (x == null ? undefined : x[i]);

const LAP_FIELDS = ['date_start', '_t0'];

export class LiveModel {
  constructor() { this.reset(); }

  reset() {
    this.session = {};
    this.sessionKey = null;
    this.status = 'Inactive';
    this.drivers = new Map();
    this.timing = new Map(); // driver -> merged TimingData line
    this.app = new Map(); // driver -> merged TimingAppData line
    this.scratch = new Map(); // driver -> current lap sector/speed scratch
    this.lapEnd = new Map(); // driver -> ms of last lap completion
    this.outNext = new Map();
    this.laps = new Map(); // driver -> Map(lap -> row)
    this.positions = [];
    this.intervals = [];
    this.pits = [];
    this.rc = [];
    this.rcSeen = new Set();
    this.weather = [];
    this.radio = [];
    this.radioSeen = new Set();
    this.car = new Map(); // driver -> [[t, rpm, speed, gear, throttle, brake, drs], ...]
    this.loc = new Map(); // driver -> [[t, x, y, z], ...]
    this.part = null; // qualifying part
    this.pitTimes = [];
    this.lapCount = {};
    this.trackStatus = null;
    this.lastMessage = 0;
    this.partial = false;
    this.messages = 0;
  }

  get sessionStart() { return this.session.StartDate ? Date.parse(this.session.StartDate + 'Z') - this.gmtMs() : null; }
  gmtMs() {
    const g = this.session.GmtOffset || '00:00:00';
    const sign = g.startsWith('-') ? -1 : 1;
    const [h, m] = g.replace(/^[+-]/, '').split(':').map(Number);
    return sign * (h * 60 + m) * 60000;
  }

  // ---------- ingestion ----------
  ingest(topic, data, tsMs = Date.now()) {
    this.lastMessage = Date.now();
    this.messages++;
    switch (topic) {
      case 'SessionInfo': this.onSessionInfo(data); break;
      case 'SessionStatus': if (data.Status) this.status = data.Status; break;
      case 'DriverList': this.onDriverList(data); break;
      case 'TimingData': this.onTiming(data, tsMs); break;
      case 'TimingAppData': this.onApp(data); break;
      case 'WeatherData': this.onWeather(data, tsMs); break;
      case 'RaceControlMessages': this.onRc(data, tsMs); break;
      case 'TeamRadio': this.onRadio(data); break;
      case 'PitLaneTimeCollection': this.onPitLane(data); break;
      case 'LapCount': merge(this.lapCount, data); break;
      case 'TrackStatus': this.trackStatus = data; break;
      case 'CarData.z': this.onCar(typeof data === 'string' ? decodeZ(data) : data); break;
      case 'Position.z': this.onPos(typeof data === 'string' ? decodeZ(data) : data); break;
      default: break;
    }
  }

  onSessionInfo(d) {
    const key = d.Key ?? this.session.Key;
    if (key != null && this.sessionKey != null && key !== this.sessionKey) { const keep = { ...d }; this.reset(); this.session = keep; this.sessionKey = key; return; }
    merge(this.session, d);
    if (key != null) this.sessionKey = key;
  }

  onDriverList(d) {
    for (const [n, v] of Object.entries(d)) {
      if (!isObj(v)) continue;
      const cur = this.drivers.get(Number(n)) || {};
      this.drivers.set(Number(n), { ...cur, ...v });
    }
  }

  scratchOf(n) {
    if (!this.scratch.has(n)) this.scratch.set(n, { s: [null, null, null], i1: null, i2: null, st: null, seg: [[], [], []] });
    return this.scratch.get(n);
  }

  onTiming(d, ts) {
    if (d.SessionPart != null && d.SessionPart !== this.part) {
      this.part = d.SessionPart;
      this.rc.push({ _t: ts, date: iso(ts), driver_number: null, lap_number: null, category: 'SessionStatus', flag: null, scope: null, sector: null, qualifying_phase: this.part, message: `Q${this.part} STARTED` });
    }
    for (const [key, patch] of Object.entries(d.Lines || {})) {
      const n = Number(key);
      if (!isObj(patch)) continue;
      const st = this.timing.get(n) || {};
      const prevPos = st.Position;
      const prevInPit = st.InPit;
      const sc = this.scratchOf(n);
      // scratch (current lap sectors / speeds / mini sectors) follows the patch before the lap is closed
      for (const [i, s] of Object.entries(patch.Sectors || {})) {
        if (!isObj(s)) continue;
        const idx = Number(i);
        if ('Value' in s) sc.s[idx] = s.Value === '' ? null : parseLap(s.Value);
        for (const [j, g] of Object.entries(s.Segments || {})) if (isObj(g) && 'Status' in g) sc.seg[idx][Number(j)] = g.Status;
      }
      for (const [k, v] of Object.entries(patch.Speeds || {})) {
        const val = isObj(v) ? num(v.Value) : null;
        if (k === 'I1') sc.i1 = val; else if (k === 'I2') sc.i2 = val; else if (k === 'ST') sc.st = val;
      }
      merge(st, patch);
      this.timing.set(n, st);

      if (patch.PitOut === true) this.outNext.set(n, true);
      if (patch.InPit === true && prevInPit !== true) this.pits.push({ _t: ts, date: iso(ts), driver_number: n, lap_number: (num(st.NumberOfLaps) ?? 0) + 1, pit_duration: null, stop_duration: null, lane_duration: null });

      const ll = patch.LastLapTime;
      if (isObj(ll) && ll.Value) this.endLap(n, st, parseLap(ll.Value), ts);
      else if (patch.NumberOfLaps != null && num(st.NumberOfLaps) > 0) this.endLap(n, st, null, ts); // e.g. lap 1 has no LastLapTime

      if (patch.Position != null && patch.Position !== prevPos) this.positions.push({ _t: ts, date: iso(ts), driver_number: n, position: Number(patch.Position) });
      if (patch.GapToLeader != null || isObj(patch.IntervalToPositionAhead)) {
        this.intervals.push({ _t: ts, date: iso(ts), driver_number: n, gap_to_leader: parseGap(st.GapToLeader), interval: parseGap(st.IntervalToPositionAhead?.Value) });
      }
    }
  }

  endLap(n, st, dur, ts) {
    const lapNo = num(st.NumberOfLaps);
    if (lapNo == null) return;
    const sc = this.scratchOf(n);
    const laps = this.laps.get(n) || new Map();
    this.laps.set(n, laps);
    let row = laps.get(lapNo);
    const fresh = !row;
    if (fresh) {
      const t0 = this.lapEnd.get(n) ?? this.sessionStart ?? ts - (dur || 90) * 1000;
      row = {
        _t0: t0, date_start: iso(t0), driver_number: n, lap_number: lapNo, lap_duration: null,
        duration_sector_1: null, duration_sector_2: null, duration_sector_3: null, i1_speed: null, i2_speed: null, st_speed: null,
        is_pit_out_lap: !!this.outNext.get(n), segments_sector_1: [], segments_sector_2: [], segments_sector_3: [],
      };
      laps.set(lapNo, row);
    }
    if (dur != null) row.lap_duration = dur;
    const fill = (k, v) => { if (row[k] == null && v != null) row[k] = v; };
    fill('duration_sector_1', sc.s[0]); fill('duration_sector_2', sc.s[1]); fill('duration_sector_3', sc.s[2]);
    fill('i1_speed', sc.i1); fill('i2_speed', sc.i2); fill('st_speed', sc.st);
    if (!row.segments_sector_1.length) { row.segments_sector_1 = sc.seg[0].slice(); row.segments_sector_2 = sc.seg[1].slice(); row.segments_sector_3 = sc.seg[2].slice(); }
    if (fresh) {
      this.lapEnd.set(n, ts);
      this.outNext.set(n, false);
      this.scratch.set(n, { s: [null, null, null], i1: null, i2: null, st: null, seg: [[], [], []] });
    }
  }

  onApp(d) {
    for (const [key, patch] of Object.entries(d.Lines || {})) {
      if (!isObj(patch)) continue;
      const n = Number(key);
      const st = this.app.get(n) || {};
      merge(st, patch);
      this.app.set(n, st);
    }
  }

  onWeather(d, ts) {
    this.weather.push({ _t: ts, date: iso(ts), air_temperature: num(d.AirTemp), track_temperature: num(d.TrackTemp), humidity: num(d.Humidity), pressure: num(d.Pressure), rainfall: num(d.Rainfall), wind_direction: num(d.WindDirection), wind_speed: num(d.WindSpeed) });
  }

  onRc(d, ts) {
    for (const m of arr(d.Messages)) {
      if (!m || !m.Message) continue;
      const key = `${m.Utc}|${m.Message}`;
      if (this.rcSeen.has(key)) continue;
      this.rcSeen.add(key);
      const t = m.Utc ? Date.parse(m.Utc + (/[Zz]|[+-]\d\d:?\d\d$/.test(m.Utc) ? '' : 'Z')) : ts;
      this.rc.push({ _t: t, date: iso(t), driver_number: m.RacingNumber ? Number(m.RacingNumber) : null, lap_number: m.Lap ?? null, category: m.Category || null, flag: m.Flag || null, scope: m.Scope || null, sector: m.Sector ?? null, qualifying_phase: this.part, message: m.Message });
    }
  }

  onRadio(d) {
    for (const c of arr(d.Captures)) {
      if (!c || !c.Path || this.radioSeen.has(c.Path)) continue;
      this.radioSeen.add(c.Path);
      const t = Date.parse(c.Utc);
      this.radio.push({ _t: t, date: iso(t), driver_number: Number(c.RacingNumber), recording_url: `https://livetiming.formula1.com/static/${this.session.Path || ''}${c.Path}` });
    }
  }

  onPitLane(d) {
    for (const [n, v] of Object.entries(d.PitTimes || {})) {
      if (n === '_deleted' || !isObj(v)) continue;
      const dur = num(v.Duration);
      const lap = num(v.Lap);
      const drv = Number(n);
      const cand = [...this.pits].reverse().find(p => p.driver_number === drv && (lap == null || Math.abs(p.lap_number - lap) <= 1));
      if (cand) { cand.pit_duration = dur; cand.lane_duration = dur; } else this.pits.push({ _t: Date.now(), date: iso(Date.now()), driver_number: drv, lap_number: lap, pit_duration: dur, stop_duration: null, lane_duration: dur });
    }
  }

  onCar(d) {
    for (const e of d.Entries || []) {
      const t = Date.parse(e.Utc);
      for (const [n, c] of Object.entries(e.Cars || {})) {
        const ch = c.Channels || {};
        const a = this.car.get(Number(n)) || [];
        a.push([t, ch[0] ?? 0, ch[2] ?? 0, ch[3] ?? 0, ch[4] ?? 0, ch[5] ?? 0, ch[45] ?? 0]);
        this.car.set(Number(n), a);
      }
    }
  }

  onPos(d) {
    for (const p of d.Position || []) {
      const t = Date.parse(p.Timestamp);
      for (const [n, c] of Object.entries(p.Entries || {})) {
        if (c.X === 0 && c.Y === 0 && c.Z === 0) continue;
        const a = this.loc.get(Number(n)) || [];
        a.push([t, c.X, c.Y, c.Z]);
        this.loc.set(Number(n), a);
      }
    }
  }

  // The first message of a connection is a snapshot of the whole current state: load it without inventing laps.
  loadSnapshot(topics, nowMs = Date.now()) {
    const z = k => (typeof topics[k] === 'string' ? null : topics[k]);
    if (topics.SessionInfo) this.onSessionInfo(topics.SessionInfo);
    if (topics.SessionStatus?.Status) this.status = topics.SessionStatus.Status;
    if (topics.DriverList) this.onDriverList(topics.DriverList);
    if (topics.TimingAppData) this.onApp(topics.TimingAppData);
    if (topics.TimingData) {
      for (const [key, line] of Object.entries(topics.TimingData.Lines || {})) {
        const n = Number(key);
        const st = this.timing.get(n) || {};
        merge(st, line);
        this.timing.set(n, st);
        if (line.Position != null && !this.positions.some(p => p.driver_number === n)) this.positions.push({ _t: nowMs, date: iso(nowMs), driver_number: n, position: Number(line.Position) });
      }
    }
    if (topics.WeatherData) this.onWeather(topics.WeatherData, nowMs);
    if (topics.RaceControlMessages) this.onRc(topics.RaceControlMessages, nowMs);
    if (topics.TeamRadio) this.onRadio(topics.TeamRadio);
    if (topics.LapCount) merge(this.lapCount, topics.LapCount);
    if (topics.TrackStatus) this.trackStatus = topics.TrackStatus;
    this.partial = (this.status === 'Started' || this.status === 'Aborted') && this.laps.size === 0;
    return z;
  }

  // ---------- OpenF1-shaped tables ----------
  base() { return { session_key: this.sessionKey, meeting_key: this.session.Meeting?.Key ?? null }; }

  table(endpoint) {
    const b = this.base();
    const withBase = rows => rows.map(r => ({ ...r, ...b }));
    switch (endpoint) {
      case 'drivers': return [...this.drivers.entries()].map(([n, d]) => ({ ...b, driver_number: n, broadcast_name: d.BroadcastName, full_name: d.FullName, name_acronym: d.Tla, team_name: d.TeamName, team_colour: d.TeamColour, first_name: d.FirstName, last_name: d.LastName, headshot_url: d.HeadshotUrl, country_code: d.CountryCode || null }));
      case 'laps': return [...this.laps.values()].flatMap(m => [...m.values()]).map(r => ({ ...r, ...b }));
      case 'stints': return this.stintRows();
      case 'pit': return withBase(this.pits);
      case 'position': return withBase(this.positions);
      case 'intervals': return withBase(this.intervals);
      case 'race_control': return withBase(this.rc);
      case 'weather': return withBase(this.weather);
      case 'team_radio': return withBase(this.radio);
      case 'session_result': case 'starting_grid': return [];
      default: return null;
    }
  }

  stintRows() {
    const rows = [];
    for (const [n, a] of this.app) {
      let lap = 1;
      arr(a.Stints).forEach((s, i) => {
        if (!s || !s.Compound) return;
        const startAge = num(s.StartLaps) ?? 0;
        const total = num(s.TotalLaps) ?? startAge;
        const driven = Math.max(0, total - startAge);
        const last = i === arr(a.Stints).length - 1;
        const lapEndNo = last ? null : lap + Math.max(driven, 1) - 1;
        rows.push({ ...this.base(), stint_number: i + 1, driver_number: n, lap_start: lap, lap_end: lapEndNo ?? (driven > 0 ? lap + driven - 1 : lap), compound: String(s.Compound).toUpperCase(), tyre_age_at_start: startAge });
        lap += Math.max(driven, 1);
      });
    }
    return rows;
  }

  // sample tables: windowed by driver and time
  samples(endpoint, filters) {
    const store = endpoint === 'car_data' ? this.car : this.loc;
    const out = [];
    const drv = filters.find(f => f.key === 'driver_number' && f.op === '=');
    let lo = -Infinity; let hi = Infinity;
    for (const f of filters) {
      if (f.key !== 'date') continue;
      const t = parseDate(f.value);
      if (f.op === '>=' || f.op === '>') lo = Math.max(lo, t);
      if (f.op === '<=' || f.op === '<') hi = Math.min(hi, t);
    }
    const b = this.base();
    for (const [n, a] of store) {
      if (drv && Number(drv.value) !== n) continue;
      let i = lowerBound(a, lo);
      for (; i < a.length && a[i][0] <= hi; i++) {
        const s = a[i];
        out.push(endpoint === 'car_data'
          ? { ...b, date: iso(s[0]), driver_number: n, rpm: s[1], speed: s[2], n_gear: s[3], throttle: s[4], brake: s[5] > 0 ? 100 : 0, drs: s[6], _t: s[0] }
          : { ...b, date: iso(s[0]), driver_number: n, x: s[1], y: s[2], z: s[3], _t: s[0] });
        if (out.length > 200000) return null;
      }
    }
    return out;
  }

  status_() {
    return {
      relay: true,
      sessionKey: this.sessionKey,
      meetingKey: this.session.Meeting?.Key ?? null,
      sessionName: this.session.Name || null,
      sessionType: this.session.Type || null,
      meeting: this.session.Meeting?.Name || null,
      location: this.session.Meeting?.Location || null,
      sessionStatus: this.status,
      lastMessageAt: this.lastMessage || null,
      partial: this.partial,
      counts: {
        drivers: this.drivers.size,
        laps: [...this.laps.values()].reduce((a, m) => a + m.size, 0),
        carSamples: [...this.car.values()].reduce((a, x) => a + x.length, 0),
        locationSamples: [...this.loc.values()].reduce((a, x) => a + x.length, 0),
        raceControl: this.rc.length,
      },
    };
  }
}

export function parseDate(v) {
  const s = String(v);
  return Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}
function lowerBound(a, t) {
  let lo = 0; let hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < t) lo = m + 1; else hi = m; }
  return lo;
}

// filters: [{key, op, value}] -> predicate on a row
export function applyFilters(rows, filters) {
  return rows.filter(r => filters.every(({ key, op, value }) => {
    if (!(key in r) && key !== 'date') return true;
    let a = r[key];
    let b = value;
    if (key === 'date' || key === 'date_start') { a = key === 'date' ? r._t : r._t0; b = parseDate(value); if (a == null) return false; }
    else if (typeof a === 'number') b = Number(value);
    else if (typeof a === 'boolean') b = value === 'true';
    if (a == null) return false;
    switch (op) {
      case '=': return a === b || String(a) === String(b);
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '<': return a < b;
      default: return true;
    }
  }));
}

export function parseQuery(search) {
  const out = [];
  for (const part of search.replace(/^\?/, '').split('&').filter(Boolean)) {
    const m = part.match(/^([^<>=!]+)(>=|<=|=|>|<)(.*)$/);
    if (m) out.push({ key: decodeURIComponent(m[1]), op: m[2], value: decodeURIComponent(m[3].replace(/\+/g, '%20')) });
  }
  return out;
}

export function query(model, endpoint, search) {
  const filters = parseQuery(search);
  const sk = filters.find(f => f.key === 'session_key');
  if (sk && sk.value !== 'latest' && model.sessionKey != null && Number(sk.value) !== model.sessionKey) return { status: 200, rows: [] };
  let rows;
  if (endpoint === 'car_data' || endpoint === 'location') {
    rows = model.samples(endpoint, filters);
    if (rows == null) return { status: 422, rows: { detail: "Failed to retrieve information. You're likely asking for too much data at once." } };
  } else {
    const t = model.table(endpoint);
    if (t == null) return { status: 404, rows: { detail: 'Unknown endpoint' } };
    rows = applyFilters(t, filters.filter(f => f.key !== 'session_key' && f.key !== 'meeting_key'));
  }
  return { status: 200, rows: rows.map(r => { const o = { ...r }; delete o._t; delete o._t0; return o; }) };
}
