// Pure data derivations (no DOM). Everything here is unit-tested in test/data.test.mjs.

export const COMPOUND = {
  SOFT: { color: '#ff3b4e', short: 'S', label: 'Soft' },
  MEDIUM: { color: '#ffd23f', short: 'M', label: 'Medium' },
  HARD: { color: '#f2f2f2', short: 'H', label: 'Hard' },
  INTERMEDIATE: { color: '#3fcf63', short: 'I', label: 'Intermedia' },
  WET: { color: '#3d8bff', short: 'W', label: 'Wet' },
  UNKNOWN: { color: '#8a8f98', short: '?', label: 'n/d' },
};
export const compoundOf = name => COMPOUND[String(name || '').toUpperCase()] || COMPOUND.UNKNOWN;

export function sessionKind(s) {
  const n = String(s.session_name || '').toLowerCase();
  const map = {
    'practice 1': ['FP1', 'FP1', false, false],
    'practice 2': ['FP2', 'FP2', false, false],
    'practice 3': ['FP3', 'FP3', false, false],
    'sprint qualifying': ['SQ', 'Sprint Quali', false, true],
    'sprint shootout': ['SQ', 'Sprint Quali', false, true],
    sprint: ['SPR', 'Sprint', true, false],
    qualifying: ['Q', 'Qualifiche', false, true],
    race: ['GP', 'Gara', true, false],
  };
  const m = map[n];
  if (m) return { code: m[0], label: m[1], race: m[2], quali: m[3] };
  return { code: s.session_name || '?', label: s.session_name || '?', race: false, quali: false };
}

export function sessionState(s, now = Date.now()) {
  const start = Date.parse(s.date_start);
  const end = Date.parse(s.date_end);
  if (now < start) return 'upcoming';
  if (now <= end + 10 * 60 * 1000) return 'live';
  return 'finished';
}

// ---------- formatting ----------
export function fmtLap(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}
export function fmtGap(sec, plus = true) {
  if (sec == null || !isFinite(sec)) return '–';
  if (sec === 0) return plus ? '–' : '0.000';
  return `${plus && sec > 0 ? '+' : ''}${sec.toFixed(3)}`;
}
export function fmtSec(sec) { return sec == null || !isFinite(sec) ? '–' : sec.toFixed(3); }

// ---------- stats ----------
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const median = arr => quantile([...arr].sort((a, b) => a - b), 0.5);
export function stdev(arr) {
  if (arr.length < 2) return null;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

// index of the last element with arr[i][key] <= t, or -1
export function lastAtOrBefore(arr, t, key = 't') {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const groupBy = (arr, key) => {
  const m = new Map();
  for (const x of arr) {
    const k = x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

// ---------- model ----------
export function prepare(raw) {
  const drv = new Map();
  for (const d of raw.drivers || []) {
    drv.set(d.driver_number, {
      num: d.driver_number,
      acr: d.name_acronym || String(d.driver_number),
      name: d.full_name || d.broadcast_name || `#${d.driver_number}`,
      first: d.first_name || '',
      last: d.last_name || d.full_name || '',
      team: d.team_name || '',
      color: d.team_colour ? `#${d.team_colour}` : '#8a8f98',
      headshot: d.headshot_url || '',
    });
  }
  // drivers seen in data but missing from /drivers
  const ensure = n => {
    if (!drv.has(n)) drv.set(n, { num: n, acr: String(n), name: `#${n}`, first: '', last: `#${n}`, team: '', color: '#8a8f98', headshot: '' });
  };

  const laps = (raw.laps || []).map(l => {
    ensure(l.driver_number);
    const t0 = l.date_start ? Date.parse(l.date_start) : null;
    return { ...l, t0, t1: t0 != null && l.lap_duration != null ? t0 + l.lap_duration * 1000 : null };
  });
  const lapsBy = groupBy(laps, 'driver_number');
  for (const arr of lapsBy.values()) arr.sort((a, b) => a.lap_number - b.lap_number);

  // team mates share a colour: mark second driver (by number order) for dashed lines
  const byTeam = groupBy([...drv.values()], 'team');
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => a.num - b.num);
    arr.forEach((d, i) => { d.second = i > 0; });
  }

  const best = new Map(); // driver -> {dur, lap}
  const pbSector = new Map(); // driver -> [s1,s2,s3]
  const overall = { lap: null, s: [null, null, null], st: null };
  for (const [n, arr] of lapsBy) {
    let b = null;
    const sb = [null, null, null];
    for (const l of arr) {
      if (l.lap_duration != null && !l.is_pit_out_lap && (!b || l.lap_duration < b.dur)) b = { dur: l.lap_duration, lap: l.lap_number };
      [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3].forEach((v, i) => {
        if (v != null && (sb[i] == null || v < sb[i])) sb[i] = v;
      });
      if (l.st_speed != null && (overall.st == null || l.st_speed > overall.st)) overall.st = l.st_speed;
    }
    if (b) best.set(n, b);
    pbSector.set(n, sb);
    sb.forEach((v, i) => { if (v != null && (overall.s[i] == null || v < overall.s[i])) overall.s[i] = v; });
    if (b && (overall.lap == null || b.dur < overall.lap.dur)) overall.lap = { ...b, driver: n };
  }

  const stintsBy = groupBy(raw.stints || [], 'driver_number');
  for (const arr of stintsBy.values()) arr.sort((a, b) => a.stint_number - b.stint_number);
  const pitsBy = groupBy((raw.pits || []).map(p => ({ ...p, t: Date.parse(p.date) })), 'driver_number');
  for (const arr of pitsBy.values()) arr.sort((a, b) => a.t - b.t);

  const posSeries = groupBy((raw.positions || []).map(p => ({ t: Date.parse(p.date), pos: p.position, driver_number: p.driver_number })), 'driver_number');
  for (const arr of posSeries.values()) arr.sort((a, b) => a.t - b.t);
  const posLatest = new Map();
  for (const [n, arr] of posSeries) { ensure(n); posLatest.set(n, arr[arr.length - 1].pos); }

  const intervalLatest = new Map();
  const ivBy = groupBy((raw.intervals || []).map(i => ({ ...i, t: Date.parse(i.date) })), 'driver_number');
  for (const [n, arr] of ivBy) { arr.sort((a, b) => a.t - b.t); intervalLatest.set(n, arr[arr.length - 1]); }

  const results = new Map();
  for (const r of raw.results || []) { ensure(r.driver_number); results.set(r.driver_number, r); }
  const grid = new Map();
  for (const g of raw.grid || []) grid.set(g.driver_number, g.position);
  // starting_grid is often missing: the first published order is the grid
  const gridFallback = new Map();
  for (const [n, arr] of posSeries) gridFallback.set(n, arr[0].pos);

  const rc = (raw.rc || []).map(r => ({ ...r, t: Date.parse(r.date) })).sort((a, b) => a.t - b.t);
  const phaseStart = {};
  for (const r of rc) if (r.qualifying_phase != null && phaseStart[r.qualifying_phase] == null) phaseStart[r.qualifying_phase] = r.t;

  // the feed sometimes reports 0 °C sensor glitches
  const weather = (raw.weather || []).filter(w => w.track_temperature > 0 && w.air_temperature > 0).map(w => ({ ...w, t: Date.parse(w.date) })).sort((a, b) => a.t - b.t);

  return { drv, laps, lapsBy, best, pbSector, overall, stintsBy, pitsBy, posSeries, posLatest, intervalLatest, results, grid, gridFallback, rc, phaseStart, weather, radio: raw.radio || [] };
}

export function phaseOf(M, t) {
  let p = null;
  for (const k of Object.keys(M.phaseStart).map(Number).sort()) if (M.phaseStart[k] <= t) p = k;
  return p;
}

export function currentStint(M, n) {
  const arr = M.stintsBy.get(n);
  return arr && arr.length ? arr[arr.length - 1] : null;
}
export function stintAt(M, n, lap) {
  const arr = M.stintsBy.get(n) || [];
  return arr.find(s => lap >= s.lap_start && (s.lap_end == null || lap <= s.lap_end)) || null;
}

// state of a sector time vs bests: 'overall' (purple), 'personal' (green), 'slow' (yellow)
export function sectorState(M, n, idx, v) {
  if (v == null) return 'none';
  if (M.overall.s[idx] != null && v <= M.overall.s[idx] + 0.0004) return 'overall';
  const pb = M.pbSector.get(n);
  if (pb && pb[idx] != null && v <= pb[idx] + 0.0004) return 'personal';
  return 'slow';
}

export function timingRows(M, kind) {
  const rows = [];
  for (const d of M.drv.values()) {
    const arr = M.lapsBy.get(d.num) || [];
    const res = M.results.get(d.num);
    const cur = arr[arr.length - 1] || null;
    let lastDone = null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].lap_duration != null) { lastDone = arr[i]; break; }
    const b = M.best.get(d.num) || null;
    const st = currentStint(M, d.num);
    const sectors = cur ? [cur.duration_sector_1, cur.duration_sector_2, cur.duration_sector_3] : [null, null, null];
    let topSpeed = null;
    for (const l of arr) if (l.st_speed != null && (topSpeed == null || l.st_speed > topSpeed)) topSpeed = l.st_speed;
    const pits = (M.pitsBy.get(d.num) || []).length;
    const row = {
      num: d.num, d, laps: arr.length, completed: arr.filter(l => l.lap_duration != null).length,
      cur, lastDone, best: b, sectors,
      sectorStates: sectors.map((v, i) => sectorState(M, d.num, i, v)),
      compound: st ? st.compound : null,
      tyreAge: st && cur ? st.tyre_age_at_start + Math.max(0, cur.lap_number - st.lap_start) : null,
      stintNo: st ? st.stint_number : null,
      pits, topSpeed, res,
      outLap: !!(cur && cur.is_pit_out_lap),
      status: res ? (res.dsq ? 'DSQ' : res.dns ? 'DNS' : res.dnf ? 'DNF' : '') : '',
      phases: [null, null, null],
      grid: M.grid.get(d.num) ?? M.gridFallback.get(d.num) ?? null,
    };
    if (kind.quali && Object.keys(M.phaseStart).length) {
      for (const l of arr) {
        if (l.lap_duration == null || l.is_pit_out_lap) continue;
        const ph = phaseOf(M, l.t1 ?? l.t0 ?? 0);
        if (ph && ph >= 1 && ph <= 3 && (row.phases[ph - 1] == null || l.lap_duration < row.phases[ph - 1])) row.phases[ph - 1] = l.lap_duration;
      }
    }
    rows.push(row);
  }

  const hasDrivenData = rows.some(r => r.laps > 0) || M.posLatest.size > 0 || M.results.size > 0;
  if (!hasDrivenData) return [];

  const active = rows.filter(r => r.laps > 0 || M.posLatest.has(r.num) || M.results.has(r.num));
  let ordered;
  if (kind.race) {
    ordered = active.sort((a, b) => {
      const ra = M.results.get(a.num)?.position;
      const rb = M.results.get(b.num)?.position;
      if (ra != null && rb != null) return ra - rb;
      const pa = M.posLatest.get(a.num) ?? 99;
      const pb = M.posLatest.get(b.num) ?? 99;
      return pa - pb || b.laps - a.laps;
    });
  } else {
    const resOrder = M.results.size >= active.length * 0.6 && [...M.results.values()].every(r => r.position != null);
    ordered = active.sort((a, b) => {
      if (resOrder) return (M.results.get(a.num)?.position ?? 99) - (M.results.get(b.num)?.position ?? 99);
      if (a.best && b.best) return a.best.dur - b.best.dur;
      if (a.best) return -1;
      if (b.best) return 1;
      return b.laps - a.laps;
    });
  }

  const leaderBest = ordered.find(r => r.best)?.best.dur ?? null;
  ordered.forEach((r, i) => {
    r.pos = i + 1;
    r.gapBest = r.best && leaderBest != null ? r.best.dur - leaderBest : null;
    r.prevGap = i > 0 && r.best && ordered[i - 1].best ? r.best.dur - ordered[i - 1].best.dur : null;
    const iv = M.intervalLatest.get(r.num);
    r.gapLeader = iv ? iv.gap_to_leader : null;
    r.interval = iv ? iv.interval : null;
    if (r.res && kind.race && r.res.gap_to_leader != null) r.gapLeader = r.res.gap_to_leader;
  });
  return ordered;
}

// end timestamp of a lap (ms): next lap's start, else own start+duration
export function lapEnd(M, n, lapNo) {
  const arr = M.lapsBy.get(n) || [];
  const nxt = arr.find(l => l.lap_number === lapNo + 1);
  if (nxt && nxt.t0 != null) return nxt.t0;
  const l = arr.find(x => x.lap_number === lapNo);
  return l ? l.t1 : null;
}

export function maxLap(M) {
  let m = 0;
  for (const arr of M.lapsBy.values()) for (const l of arr) if (l.lap_number > m) m = l.lap_number;
  return m;
}

// per-lap race positions. returns {laps:[1..N], series: Map(driver -> [pos|null])}
export function positionsByLap(M) {
  const N = maxLap(M);
  const laps = [];
  const series = new Map();
  for (const n of M.posSeries.keys()) series.set(n, []);
  for (let L = 1; L <= N; L++) {
    let T = null;
    for (const n of M.lapsBy.keys()) {
      const e = lapEnd(M, n, L);
      if (e != null && (T == null || e < T)) T = e;
    }
    if (T == null) continue;
    laps.push(L);
    for (const [n, arr] of M.posSeries) {
      const i = lastAtOrBefore(arr, T);
      series.get(n).push(i >= 0 ? arr[i].pos : null);
    }
  }
  return { laps, series };
}

// gap to leader (s) at the end of each lap, from absolute lap end times
export function gapsByLap(M) {
  const N = maxLap(M);
  const laps = [];
  const series = new Map();
  for (const n of M.lapsBy.keys()) series.set(n, []);
  for (let L = 1; L <= N; L++) {
    const ends = new Map();
    for (const n of M.lapsBy.keys()) {
      const e = lapEnd(M, n, L);
      if (e != null) ends.set(n, e);
    }
    if (!ends.size) continue;
    const lead = Math.min(...ends.values());
    laps.push(L);
    for (const n of M.lapsBy.keys()) series.get(n).push(ends.has(n) ? (ends.get(n) - lead) / 1000 : null);
  }
  return { laps, series };
}

// tyre degradation points: [{driver, compound, age, delta, lap}]
export function degradationPoints(M, limit = 1.12) {
  const pts = [];
  const ref = M.overall.lap ? M.overall.lap.dur : null;
  if (ref == null) return pts;
  for (const [n, arr] of M.lapsBy) {
    const b = M.best.get(n);
    if (!b) continue;
    for (const l of arr) {
      if (l.lap_duration == null || l.is_pit_out_lap || l.lap_duration > ref * limit) continue;
      const st = stintAt(M, n, l.lap_number);
      if (!st) continue;
      pts.push({ driver: n, compound: st.compound, age: st.tyre_age_at_start + (l.lap_number - st.lap_start), delta: l.lap_duration - b.dur, lap: l.lap_number, dur: l.lap_duration });
    }
  }
  return pts;
}

// pace distribution for the box chart
export function paceStats(M, limit = 1.07) {
  const ref = M.overall.lap ? M.overall.lap.dur : null;
  const out = [];
  if (ref == null) return out;
  for (const [n, arr] of M.lapsBy) {
    const v = arr.filter(l => l.lap_duration != null && !l.is_pit_out_lap && l.lap_duration <= ref * limit).map(l => l.lap_duration).sort((a, b) => a - b);
    if (v.length < 2) continue;
    out.push({ driver: n, n: v.length, min: v[0], q1: quantile(v, 0.25), med: quantile(v, 0.5), q3: quantile(v, 0.75), max: v[v.length - 1], sd: stdev(v) });
  }
  return out.sort((a, b) => a.med - b.med);
}

// ---------- telemetry ----------
// Build a lap trace from car_data + location samples. Distance is integrated from speed.
export function buildTrace(car, loc, t0, t1) {
  const cs = car.map(c => ({ ...c, t: Date.parse(c.date) })).filter(c => c.t >= t0 && c.t <= t1).sort((a, b) => a.t - b.t);
  const ls = loc.map(c => ({ ...c, t: Date.parse(c.date) })).filter(c => c.t >= t0 - 500 && c.t <= t1 + 500).sort((a, b) => a.t - b.t);
  if (cs.length < 5) return null;
  const pts = [];
  let dist = 0;
  let j = 0;
  for (let i = 0; i < cs.length; i++) {
    if (i > 0) dist += ((cs[i].speed + cs[i - 1].speed) / 2 / 3.6) * ((cs[i].t - cs[i - 1].t) / 1000);
    while (j < ls.length - 1 && Math.abs(ls[j + 1].t - cs[i].t) <= Math.abs(ls[j].t - cs[i].t)) j++;
    const L = ls[j];
    pts.push({ t: (cs[i].t - t0) / 1000, d: dist, speed: cs[i].speed, throttle: cs[i].throttle, brake: cs[i].brake, gear: cs[i].n_gear, rpm: cs[i].rpm, drs: cs[i].drs, x: L ? L.x : null, y: L ? L.y : null });
  }
  return { pts, length: dist, time: (cs[cs.length - 1].t - t0) / 1000 };
}

// resample a trace on `n` points of normalised distance 0..1
export function resample(trace, n = 400) {
  const { pts, length } = trace;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * length;
    while (j < pts.length - 2 && pts[j + 1].d < d) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const f = b.d === a.d ? 0 : Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d)));
    const lerp = (p, q) => (p == null || q == null ? (p ?? q) : p + (q - p) * f);
    out.push({
      d, frac: i / (n - 1), t: lerp(a.t, b.t), speed: lerp(a.speed, b.speed), throttle: lerp(a.throttle, b.throttle),
      brake: f < 0.5 ? a.brake : b.brake, gear: f < 0.5 ? a.gear : b.gear, rpm: lerp(a.rpm, b.rpm),
      x: lerp(a.x, b.x), y: lerp(a.y, b.y),
    });
  }
  return out;
}

// split rows in `n` equal-distance mini sectors and tell who is faster in each
export function dominance(a, b, parts = 25) {
  const out = [];
  const len = a.length;
  for (let p = 0; p < parts; p++) {
    const i0 = Math.floor((p * (len - 1)) / parts);
    const i1 = Math.floor(((p + 1) * (len - 1)) / parts);
    const ta = a[i1].t - a[i0].t;
    const tb = b[i1].t - b[i0].t;
    out.push({ i0, i1, winner: ta <= tb ? 'a' : 'b', diff: tb - ta });
  }
  return out;
}

// average / best lap of every stint. Laps slower than `limit` x session best (traffic, cool-down) and out-laps are ignored.
export function stintStats(M, limit = 1.07) {
  const ref = M.overall.lap ? M.overall.lap.dur : null;
  const out = new Map(); // driver -> [{stint, compound, start, end, laps, n, avg, best, ageStart}]
  for (const [n, stints] of M.stintsBy) {
    const laps = M.lapsBy.get(n) || [];
    out.set(n, stints.map(st => {
      const end = st.lap_end ?? Math.max(st.lap_start, laps.length ? laps[laps.length - 1].lap_number : st.lap_start);
      const v = laps.filter(l => l.lap_number >= st.lap_start && l.lap_number <= end && l.lap_duration != null && !l.is_pit_out_lap && (ref == null || l.lap_duration <= ref * limit)).map(l => l.lap_duration);
      return {
        stint: st.stint_number, compound: st.compound, start: st.lap_start, end, laps: end - st.lap_start + 1, ageStart: st.tyre_age_at_start,
        n: v.length, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, best: v.length ? Math.min(...v) : null,
        times: laps.filter(l => l.lap_number >= st.lap_start && l.lap_number <= end && l.lap_duration != null && !l.is_pit_out_lap && (ref == null || l.lap_duration <= ref * limit)).map(l => ({ i: l.lap_number - st.lap_start + 1, lap: l.lap_number, dur: l.lap_duration })),
      };
    }));
  }
  return out;
}
