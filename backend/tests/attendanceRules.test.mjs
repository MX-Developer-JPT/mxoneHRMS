// Run: node --test backend/tests/attendanceRules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { toStamp, regularisedTimes, originalPunches, canContinuePreviousDay, feedStatus } from '../utils/attendanceRules.js';

const D = '2026-11-02';

test('a requested "HH:mm" becomes a real time on that day', () => {
  assert.equal(toStamp('09:56', D), '2026-11-02T09:56:00.000Z');
  assert.equal(toStamp('9:05:07', D), '2026-11-02T09:05:07.000Z');
  assert.equal(toStamp('2026-11-02T09:56:11.000Z', D), '2026-11-02T09:56:11.000Z');
  assert.equal(toStamp('2026-11-02 09:56:11', D), '2026-11-02T09:56:11.000Z');
  for (const bad of ['', null, undefined, '25:00', 'soon']) assert.equal(toStamp(bad, D), null);
});

test('a regularised day gets sessions and worked hours (it used to be wiped to zero)', () => {
  const t = regularisedTimes({ requested_check_in: '09:56', requested_check_out: '19:02' }, { raw_punches: [] }, D);
  // both ends must be real instants, or the session builder drops them and the day reads 0 hours
  assert.equal((Date.parse(t.check_out_time) - Date.parse(t.check_in_time)) / 60000, 546);
});

test('only the requested side changes; a night shift ends next morning', () => {
  const att = { check_in_time: '2026-11-02T09:00:00.000Z' };
  assert.deepEqual(regularisedTimes({ requested_check_out: '18:00' }, att, D), { check_in_time: '2026-11-02T09:00:00.000Z', check_out_time: '2026-11-02T18:00:00.000Z' });
  assert.equal(regularisedTimes({ requested_check_in: '19:32', requested_check_out: '08:06' }, {}, D).check_out_time, '2026-11-03T08:06:00.000Z');
});

test('the original punches are kept once, never replaced by a later correction', () => {
  const real = [{ time: '2026-11-02T10:20:00.000Z' }];
  assert.deepEqual(originalPunches({ raw_punches: real }, { check_in_time: '2026-11-02T09:00:00.000Z' }), real);
  assert.deepEqual(originalPunches({ raw_punches: [{ time: 'x' }], original_punches: real }, {}), real);
  assert.deepEqual(originalPunches({ raw_punches: real, regularised: true }, {}), []);
});

test('yesterday is only continued by a punch within 20 hours of its first punch', () => {
  const prev = { date: D, is_in_progress: true, check_in_time: '2026-11-02T20:00:00.000Z' };
  assert.equal(canContinuePreviousDay(prev, '2026-11-03T05:00:00.000Z'), true);
  assert.equal(canContinuePreviousDay({ ...prev, check_in_time: '2026-11-02T05:00:11.000Z' }, '2026-11-03T05:01:24.000Z'), false);
  assert.equal(canContinuePreviousDay({ ...prev, is_in_progress: false }, '2026-11-03T01:00:00.000Z'), false);
});

test('machine feed: flagged only when silent long during working hours', () => {
  const noon = Date.parse('2026-11-26T06:30:00Z');
  const f = feedStatus([{ device: 'B', last_received: new Date(noon - 4 * 3600000).toISOString() }, { device: 'A', last_received: new Date(noon - 60000).toISOString() }], noon);
  assert.deepEqual(f.map(x => [x.device, x.attention]), [['A', false], ['B', true]]);
  assert.equal(feedStatus([{ device: 'B', last_received: '2026-11-25T10:00:00Z' }], Date.parse('2026-11-25T22:00:00Z'))[0].attention, false);
});
