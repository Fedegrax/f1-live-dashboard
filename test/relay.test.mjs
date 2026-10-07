import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { LiveModel, merge, parseLap, parseGap, query, parseQuery } from '../server/model.js';

const T0 = Date.parse('2026-10-09T05:00:00Z');
const z = obj => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj))).toString('base64');

test('merge applies index-keyed patches onto arrays and keeps siblings', () => {
  const s = { Sectors: [{ Value: '25.1' }, { Value: '' }, { Value: '' }], A: { x: 1 } };
  merge(s, { Sectors: { 1: { Value: '32.2' } }, A: { y: 2 } });
  assert.equal(s.Sectors[0].Value, '25.1');
  assert.equal(s.Sectors[1].Value, '32.2');
  assert.deepEqual(s.A, { x: 1, y: 2 });
});

test('parsers', () => {
  assert.equal(parseLap('1:37.520'), 97.52);
  assert.equal(parseLap('59.100'), 59.1);
  assert.equal(parseLap(''), null);
  assert.equal(parseGap('+0.621'), 0.621);
  assert.equal(parseGap('LAP 1'), 'LAP 1');
  assert.deepEqual(parseQuery('?session_key=1&date>=2026-10-09T05:00:00&lap_number<5'), [
    { key: 'session_key', op: '=', value: '1' }, { key: 'date', op: '>=', value: '2026-10-09T05:00:00' }, { key: 'lap_number', op: '<', value: '5' }]);
});

function session() {
  const m = new LiveModel();
  m.ingest('SessionInfo', { Meeting: { Key: 9, Name: 'Test Grand Prix', Location: 'Nowhere' }, Key: 100, Type: 'Practice', Name: 'Practice 1', StartDate: '2026-10-09T05:00:00', GmtOffset: '00:00:00', Path: '2026/x/' }, T0);
  m.ingest('DriverList', { 1: { RacingNumber: '1', Tla: 'AAA', FullName: 'A Driver', TeamName: 'Alpha', TeamColour: 'FF0000' } }, T0);
  return m;
}

test('a lap is recorded once with sectors, speeds and pit-out flag', () => {
  const m = session();
  m.ingest('TimingData', { Lines: { 1: { PitOut: true, Sectors: { 0: { Value: '' } } } } }, T0 + 1000);
  m.ingest('TimingData', { Lines: { 1: { Sectors: { 0: { Value: '25.100' } }, Speeds: { I1: { Value: '280' } } } } }, T0 + 30000);
  m.ingest('TimingData', { Lines: { 1: { Sectors: { 1: { Value: '32.500' } }, Speeds: { I2: { Value: '140' } } } } }, T0 + 60000);
  m.ingest('TimingData', { Lines: { 1: { NumberOfLaps: 1, Sectors: { 2: { Value: '40.000' } }, LastLapTime: { Value: '1:37.600' }, Speeds: { ST: { Value: '312' } } } } }, T0 + 100000);
  m.ingest('TimingData', { Lines: { 1: { LastLapTime: { Value: '1:37.600', PersonalFastest: true } } } }, T0 + 100500); // duplicate update
  const laps = query(m, 'laps', '?session_key=100').rows;
  assert.equal(laps.length, 1);
  const l = laps[0];
  assert.equal(l.lap_number, 1);
  assert.equal(l.lap_duration, 97.6);
  assert.deepEqual([l.duration_sector_1, l.duration_sector_2, l.duration_sector_3], [25.1, 32.5, 40]);
  assert.deepEqual([l.i1_speed, l.i2_speed, l.st_speed], [280, 140, 312]);
  assert.equal(l.is_pit_out_lap, true);
  assert.equal(l.date_start, '2026-10-09T05:00:00.000+00:00');
});

test('next lap starts when the previous one ended and is not a pit-out lap', () => {
  const m = session();
  m.ingest('TimingData', { Lines: { 1: { NumberOfLaps: 1, LastLapTime: { Value: '1:40.000' } } } }, T0 + 100000);
  m.ingest('TimingData', { Lines: { 1: { NumberOfLaps: 2, LastLapTime: { Value: '1:38.000' } } } }, T0 + 198000);
  const laps = query(m, 'laps', '?session_key=100&lap_number>=2').rows;
  assert.equal(laps.length, 1);
  assert.equal(laps[0].date_start, new Date(T0 + 100000).toISOString().replace('Z', '+00:00'));
  assert.equal(laps[0].is_pit_out_lap, false);
});

test('lap 1 without LastLapTime still closes the lap', () => {
  const m = session();
  m.ingest('TimingData', { Lines: { 1: { NumberOfLaps: 1 } } }, T0 + 120000);
  m.ingest('TimingData', { Lines: { 1: { NumberOfLaps: 2, LastLapTime: { Value: '1:40.000' } } } }, T0 + 220000);
  const laps = query(m, 'laps', '?session_key=100').rows;
  assert.equal(laps.length, 2);
  assert.equal(laps[0].lap_duration, null);
  assert.equal(laps[1].date_start, new Date(T0 + 120000).toISOString().replace('Z', '+00:00'));
});

test('stints, positions, drivers and filters', () => {
  const m = session();
  m.ingest('TimingAppData', { Lines: { 1: { Stints: [{ Compound: 'SOFT', New: 'true', TotalLaps: 4, StartLaps: 0 }] } } }, T0);
  m.ingest('TimingAppData', { Lines: { 1: { Stints: { 1: { Compound: 'HARD', TotalLaps: 2, StartLaps: 0 } } } } }, T0);
  const st = query(m, 'stints', '?session_key=100').rows;
  assert.deepEqual(st.map(s => [s.compound, s.lap_start]), [['SOFT', 1], ['HARD', 5]]);
  m.ingest('TimingData', { Lines: { 1: { Position: '3' } } }, T0 + 1000);
  m.ingest('TimingData', { Lines: { 1: { Position: '2' } } }, T0 + 2000);
  assert.equal(query(m, 'position', '?session_key=100&date>=2026-10-09T05:00:01.500').rows.length, 1);
  assert.equal(query(m, 'drivers', '?session_key=100').rows[0].name_acronym, 'AAA');
  assert.deepEqual(query(m, 'laps', '?session_key=999').rows, []);
});

test('car data and location decode from compressed payloads and window by time', () => {
  const m = session();
  const utc = ms => new Date(ms).toISOString();
  m.ingest('CarData.z', z({ Entries: [0, 1, 2].map(i => ({ Utc: utc(T0 + i * 270), Cars: { 1: { Channels: { 0: 11000, 2: 250 + i, 3: 7, 4: 100, 5: 0, 45: 12 } } } })) }), T0);
  m.ingest('Position.z', z({ Position: [{ Timestamp: utc(T0), Entries: { 1: { Status: 'OnTrack', X: 10, Y: 20, Z: 3 } } }, { Timestamp: utc(T0 + 270), Entries: { 1: { Status: 'OnTrack', X: 11, Y: 21, Z: 3 } } }] }), T0);
  const car = query(m, 'car_data', `?session_key=100&driver_number=1&date>=${utc(T0 + 200).slice(0, 23)}`).rows;
  assert.equal(car.length, 2);
  assert.equal(car[0].speed, 251);
  assert.equal(car[0].n_gear, 7);
  const loc = query(m, 'location', '?session_key=100&driver_number=1').rows;
  assert.deepEqual(loc.map(r => [r.x, r.y]), [[10, 20], [11, 21]]);
});

test('snapshot does not invent laps and a new session resets the model', () => {
  const m = new LiveModel();
  m.loadSnapshot({ SessionInfo: { Key: 5, Name: 'Race', Type: 'Race', StartDate: '2026-10-04T15:00:00', GmtOffset: '08:00:00' }, SessionStatus: { Status: 'Started' }, DriverList: { 1: { RacingNumber: '1', Tla: 'AAA' } }, TimingData: { Lines: { 1: { Position: '1', NumberOfLaps: 30, LastLapTime: { Value: '1:40.000' } } } } });
  assert.equal(query(m, 'laps', '?session_key=5').rows.length, 0);
  assert.equal(m.status_().partial, true);
  m.ingest('SessionInfo', { Key: 6, Name: 'Qualifying' }, T0);
  assert.equal(m.sessionKey, 6);
  assert.equal(m.status_().counts.drivers, 0);
});
