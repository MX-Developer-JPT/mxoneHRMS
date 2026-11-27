// Gate pass rules. Run: node backend/tests/gatePass.test.mjs
import assert from 'node:assert/strict';
import { TRAVEL, isTravel, guardPatch, stampTimes, permissions, officeGateAdmins, stageOf, travelLabel, passesForDate, passNo } from '../utils/gatePassRules.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const trip = (x = {}) => ({ id: 'abc12-9', request_date: '2026-11-27', employee_user_id: 'emp', outing_type: TRAVEL, current_location: 'Duhai', destination_location: 'Ghaziabad', status: 'approved', ...x });
const viewer = (x = {}) => ({ id: 'g1', role: 'gate_admin', assigned: ['Duhai'], manages: false, ...x });

t('inter-office means travel with a destination', () => { assert.ok(isTravel(trip())); assert.ok(!isTravel(trip({ destination_location: '' }))); assert.ok(!isTravel({ outing_type: 'official_outing' })); assert.equal(passNo(trip()), 'GP-261127-ABC12'); });
t('only the origin gate admin marks Out; only the destination gate admin marks arrival', () => {
  assert.ok(permissions(trip(), viewer()).gate_out);
  assert.ok(!permissions(trip(), viewer({ assigned: ['Ghaziabad'] })).gate_out);
  const out = trip({ status: 'departed' });
  assert.ok(permissions(out, viewer({ assigned: ['Ghaziabad'] })).arrive);
  assert.ok(!permissions(out, viewer()).arrive);
  for (const role of ['hr', 'admin', 'management', 'front_desk_admin', 'employee']) { assert.ok(!permissions(trip(), viewer({ role })).gate_out, role); assert.ok(!permissions(out, viewer({ role, assigned: null })).arrive, role); }
});
t('nobody confirms their own movement, and a finished trip allows nothing', () => {
  assert.ok(!permissions(trip({ status: 'departed' }), viewer({ id: 'emp', assigned: null })).arrive);
  assert.ok(Object.values(permissions(trip({ status: 'completed' }), viewer({ role: 'admin', assigned: null }))).every((x) => !x));
});
t('after Gate-Out only the manager or HR can redirect or close a trip', () => {
  const out = trip({ status: 'departed' });
  const self = permissions(out, viewer({ id: 'emp', role: 'employee' }));
  assert.ok(!self.cancel_trip && !self.change_destination);
  assert.ok(permissions(trip(), viewer({ id: 'emp', role: 'employee' })).cancel_trip);
  for (const v of [viewer({ role: 'hr' }), viewer({ role: 'employee', manages: true })]) { const p = permissions(out, v); assert.ok(p.cancel_trip && p.change_destination); }
  assert.ok(!permissions(out, viewer()).change_destination);
});
t('the generic API cannot move a trip, change its offices or write its record', () => {
  for (const status of ['departed', 'returned', 'completed', 'auto_closed']) assert.ok(guardPatch(trip(), { status }), status);
  const patch = { departure_time: '2000-01-01', arrival_time: 'x', history: [], destination_location: 'Elsewhere', outing_type: 'half_day', employee_user_id: 'other', field_trip_id: 'f' };
  assert.equal(guardPatch(trip({ status: 'departed' }), patch), null); assert.deepEqual(patch, { field_trip_id: 'f' });
  assert.equal(guardPatch(trip({ status: 'pending_approval' }), { status: 'approved' }), null);
  assert.ok(guardPatch(trip({ status: 'departed' }), { status: 'cancelled' }));
  assert.ok(guardPatch({ outing_type: 'short_break', status: 'departed' }, { status: 'completed' }));
  assert.equal(guardPatch({ outing_type: 'short_break', status: 'departed' }, { status: 'returned' }), null);
});
t('gate times come from the server', () => {
  const p = { status: 'departed', departure_time: '2000-01-01' }; stampTimes(p, { status: 'approved' }, 'NOW'); assert.equal(p.departure_time, 'NOW');
  const q = { departure_time: '2000-01-01', return_time: 'y' }; stampTimes(q, { status: 'departed' }, 'NOW'); assert.deepEqual(q, {});
});
t('only the destination office gate admins are told; unassigned ones only when nobody is assigned', () => {
  const admins = [{ id: 'a', locations: ['Duhai'] }, { id: 'b', locations: ['Ghaziabad'] }, { id: 'c', locations: null }];
  assert.deepEqual(officeGateAdmins(admins, 'Ghaziabad'), ['b']); assert.deepEqual(officeGateAdmins(admins, 'Pune'), ['c']);
});
t('stages and attendance wording', () => {
  assert.equal(stageOf(trip({ status: 'departed' })), 'in_transit'); assert.equal(stageOf({ status: 'departed', outing_type: 'short_break' }), 'outside');
  assert.equal(travelLabel(trip({ status: 'departed' })), 'Travelling to Ghaziabad'); assert.equal(travelLabel(trip({ status: 'completed' })), 'Arrived at Ghaziabad');
});
t('All Attendance keeps an open trip visible on later days and shows it on the arrival date', () => {
  const open = trip({ status: 'departed' }), done = trip({ status: 'completed', arrival_time: '2026-11-28T09:00:00Z' }), pending = trip({ status: 'pending_approval' });
  assert.equal(passesForDate([open, pending], '2026-11-28', '2026-11-28').length, 1);
  assert.equal(passesForDate([open], '2026-11-29', '2026-11-28').length, 0);
  assert.equal(passesForDate([done], '2026-11-28', '2026-11-30').length, 1);
  assert.equal(passesForDate([done], '2026-11-29', '2026-11-30').length, 0);
  assert.equal(passesForDate([trip({ status: 'cancelled' }), trip({ status: 'cancelled', departure_time: 'x' })], '2026-11-27', '2026-11-27').length, 1);
});
console.log(`\n${n} passed`);
