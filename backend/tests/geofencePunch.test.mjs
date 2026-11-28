// Geofence check-in / check-out on a day's punches. Run: node backend/tests/geofencePunch.test.mjs
import assert from 'node:assert/strict';
import { applyGeofencePunch } from '../utils/geofencePunch.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const at = (h) => Date.parse(`2026-11-28T${h}.000Z`);
const iso = (h) => new Date(at(h)).toISOString();

// the same double-tap rule as the attendance engine: a punch under a minute after the previous one is dropped
const dedup = (p) => p.reduce((o, x) => (o.length && Date.parse(x.time) - Date.parse(o.at(-1).time) < 60000 ? o : [...o, x]), []);
function day() {
  let att = null;
  return {
    get att() { return att; },
    send(event, h, fenceName = 'Duhai') {
      const punches = att?.raw_punches || [];
      const r = applyGeofencePunch({ att, punches, inProgress: punches.length % 2 === 1, event, atMs: at(h), fenceName });
      if (r.skip) return r.skip;
      const kept = dedup(r.punches);
      assert.equal(kept.length, r.punches.length, 'no punch may be lost to the double-tap rule');
      att = { ...att, raw_punches: kept, geofence_open_in: r.openIn, geofence_location: fenceName, ...(event === 'exit' ? { check_out_source: 'geofence' } : { check_in_source: 'geofence' }) };
      return r.reason || r.action;
    },
    times() { return (att?.raw_punches || []).map((p) => `${p.time.slice(11, 19)} ${p.device_direction}`); },
  };
}

t('a normal day with a lunch break checks out every time', () => {
  const d = day();
  assert.deepEqual([d.send('enter', '08:15:00'), d.send('exit', '13:00:00'), d.send('enter', '13:30:00'), d.send('exit', '18:00:00')], ['checked_in', 'checked_out', 'checked_in', 'checked_out']);
});
t('a quick return does not stop the later check-out (the reported fault)', () => {
  const d = day();
  d.send('enter', '08:15:13'); d.send('exit', '11:01:10');
  assert.equal(d.send('enter', '11:01:35'), 'session_resumed');
  assert.equal(d.att.geofence_open_in, iso('08:15:13'));
  assert.equal(d.send('exit', '18:02:00'), 'checked_out');
  assert.deepEqual(d.times(), ['08:15:13 IN', '18:02:00 OUT']);
});
t('a return between 30 and 60 seconds also resumes instead of leaving the person checked out', () => {
  const d = day(); d.send('enter', '08:15:00'); d.send('exit', '11:00:00');
  assert.equal(d.send('enter', '11:00:50'), 'session_resumed'); assert.equal(d.times().length, 1);
  assert.equal(d.send('exit', '17:00:00'), 'checked_out');
});
t('leaving within a minute of arriving still checks out; within 5 seconds is noise', () => {
  const d = day(); d.send('enter', '09:00:00');
  assert.equal(d.send('exit', '09:00:03'), 'too_soon_after_enter');
  assert.equal(d.send('exit', '09:00:20'), 'checked_out'); assert.deepEqual(d.times(), ['09:00:00 IN', '09:01:00 OUT']);
  assert.equal(d.send('enter', '09:00:40'), 'session_resumed'); assert.equal(d.send('exit', '12:00:00'), 'checked_out');
});
t('moving to another office keeps the session open and still checks out', () => {
  const d = day(); d.send('enter', '09:00:00', 'Duhai');
  assert.equal(d.send('enter', '12:00:00', 'E82'), 'location_transfer'); assert.equal(d.att.geofence_location, 'E82'); assert.equal(d.times().length, 1);
  assert.equal(d.send('exit', '18:00:00', 'E82'), 'checked_out');
});
t('days already carrying the wrong marker can now be closed', () => {
  const att = { raw_punches: [{ time: iso('08:15:13'), device_direction: 'IN' }], geofence_open_in: iso('11:01:35') };
  assert.equal(applyGeofencePunch({ att, punches: att.raw_punches, inProgress: true, event: 'exit', atMs: at('18:10:00') }).action, 'checked_out');
});
t('a session opened by another method is never closed by the geofence', () => {
  for (const att of [{ raw_punches: [{ time: iso('09:00:00'), device_direction: 'IN' }] },
    { raw_punches: [{ time: iso('08:00:00'), device_direction: 'IN' }, { time: iso('09:00:00'), device_direction: 'OUT' }, { time: iso('14:00:00'), device_direction: 'IN' }], geofence_open_in: iso('08:00:00') }]) {
    assert.equal(applyGeofencePunch({ att, punches: att.raw_punches, inProgress: true, event: 'exit', atMs: at('18:00:00') }).skip, 'not_geofence_session');
  }
});
t('late, repeated and pointless events change nothing', () => {
  const d = day(); assert.equal(d.send('exit', '08:00:00'), 'not_checked_in'); d.send('enter', '09:00:00');
  assert.equal(d.send('enter', '10:00:00'), 'already_checked_in'); assert.equal(d.send('exit', '08:00:00'), 'stale_event');
  d.send('exit', '18:00:00'); assert.equal(d.send('exit', '18:05:00'), 'already_checked_out');
});
console.log(`\n${n} passed`);
