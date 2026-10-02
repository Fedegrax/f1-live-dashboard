import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as D from '../docs/js/data.js';

const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/fp1-${n}.json`, import.meta.url)));
const raw = {
  drivers: fx('drivers'), laps: fx('laps'), stints: fx('stints'), pits: fx('pit'),
  positions: fx('position'), rc: fx('race_control'), weather: fx('weather'), results: fx('session_result'),
};
const M = D.prepare(raw);
const FP = D.sessionKind({ session_name: 'Practice 1' });

test('sessionKind / sessionState', () => {
  assert.equal(D.sessionKind({ session_name: 'Race' }).race, true);
  assert.equal(D.sessionKind({ session_name: 'Sprint Qualifying' }).code, 'SQ');
  const s = { date_start: '2026-10-03T04:30:00+00:00', date_end: '2026-10-03T05:30:00+00:00' };
  assert.equal(D.sessionState(s, Date.parse('2026-10-03T04:00:00Z')), 'upcoming');
  assert.equal(D.sessionState(s, Date.parse('2026-10-03T05:00:00Z')), 'live');
  assert.equal(D.sessionState(s, Date.parse('2026-10-03T07:00:00Z')), 'finished');
});

test('formatting', () => {
  assert.equal(D.fmtLap(97.52), '1:37.520');
  assert.equal(D.fmtLap(59.1), '59.100');
  assert.equal(D.fmtLap(null), '–');
  assert.equal(D.fmtGap(0.383), '+0.383');
});

test('timing rows follow the session result order and best laps', () => {
  const rows = D.timingRows(M, FP);
  assert.ok(rows.length >= 18);
  assert.equal(rows[0].num, 3);
  for (const r of rows) if (r.best) assert.ok(r.best.dur > 60 && r.best.dur < 200);
  const withBest = rows.filter(r => r.best);
  assert.ok(withBest.length > 10);
  assert.equal(rows[0].gapBest, 0);
  assert.ok(rows[1].gapBest >= 0);
});

test('timing rows without results fall back to best-lap order', () => {
  const rows = D.timingRows(D.prepare({ ...raw, results: [] }), FP);
  const bests = rows.filter(r => r.best).map(r => r.best.dur);
  assert.deepEqual(bests, [...bests].sort((a, b) => a - b));
});

test('empty dataset gives no rows (upcoming session)', () => {
  assert.deepEqual(D.timingRows(D.prepare({ drivers: raw.drivers }), FP), []);
});

test('degradation and pace stats', () => {
  assert.ok(D.degradationPoints(M).length > 20);
  const ps = D.paceStats(M);
  assert.ok(ps.length > 5);
  for (const p of ps) assert.ok(p.min <= p.q1 && p.q1 <= p.med && p.med <= p.q3 && p.q3 <= p.max);
});

test('positions by lap are consistent', () => {
  const { laps, series } = D.positionsByLap(M);
  assert.ok(laps.length > 3);
  for (const arr of series.values()) assert.equal(arr.length, laps.length);
});

test('trace building, resampling and dominance', () => {
  const t0 = 0;
  const car = Array.from({ length: 300 }, (_, i) => ({ date: new Date(i * 250).toISOString(), speed: 200 + 50 * Math.sin(i / 20), throttle: 80, brake: 0, n_gear: 6, rpm: 10000 }));
  const loc = Array.from({ length: 300 }, (_, i) => ({ date: new Date(i * 250).toISOString(), x: i, y: i * 2 }));
  const tr = D.buildTrace(car, loc, t0, 75000);
  assert.ok(tr.length > 1000);
  const rs = D.resample(tr, 100);
  assert.equal(rs.length, 100);
  assert.ok(Math.abs(rs[99].d - tr.length) < 1e-6);
  const dom = D.dominance(rs, rs, 10);
  assert.equal(dom.length, 10);
});
