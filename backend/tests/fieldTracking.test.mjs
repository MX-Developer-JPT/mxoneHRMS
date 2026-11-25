// Field Duty Tracking rules. Run: node --test backend/tests/fieldTracking.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FT_DEFAULTS, normalizeConfig, eligibilityProblem, dutyDayProblem, screenPoints, addRejectStats,
  recordBeats, detectGaps, buildRoute, liveStatus, canViewLocation, pathDistanceM,
} from '../utils/fieldTracking.js';
import { processPoints } from '../utils/fieldTrip.js';

const NOW = Date.parse('2026-11-25T10:00:00Z');
const iso = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
const M = 111195, O = { lat: 28.6, lng: 77.2 };
const pt = (xM, secAgo, extra = {}) => ({ lat: O.lat, lng: O.lng + xM / (M * Math.cos(O.lat * Math.PI / 180)), t: iso(secAgo), acc: 8, ...extra });
const ctx = (over = {}) => ({ nowMs: NOW, tripStartMs: NOW - 3 * 3600000, last: null, ...over });

test('config: strict defaults, clamped overrides, junk ignored', () => {
  assert.deepEqual(normalizeConfig(null), FT_DEFAULTS);
  const c = normalizeConfig({ max_accuracy_m: 9999, min_interval_s: 'x', gap_minutes: 1, reject_mock: false, require_duty_day: 'yes' });
  assert.equal(c.max_accuracy_m, 100);               // clamped to the ceiling
  assert.equal(c.min_interval_s, FT_DEFAULTS.min_interval_s);
  assert.equal(c.gap_minutes, 2);                    // clamped to the floor
  assert.equal(c.reject_mock, false);
  assert.equal(c.require_duty_day, true);            // non-boolean ignored
});

test('eligibility: only active employees enabled by HR', () => {
  assert.ok(eligibilityProblem(null));
  assert.ok(eligibilityProblem({ status: 'active' }));
  assert.ok(eligibilityProblem({ status: 'left', field_duty_tracking_eligible: true }));
  assert.equal(eligibilityProblem({ status: 'active', field_duty_tracking_eligible: true }), null);
});

test('duty day: OD attendance today or an official gate pass; nothing else', () => {
  const base = { today: '2026-11-25', userId: 'u1' };
  assert.ok(dutyDayProblem({ ...base }));
  assert.ok(dutyDayProblem({ ...base, attendance: { date: '2026-11-25', selfie_reason: 'wfh', status: 'work_from_home' } }));
  assert.ok(dutyDayProblem({ ...base, attendance: { date: '2026-11-24', selfie_reason: 'od' } }));          // yesterday's OD
  assert.equal(dutyDayProblem({ ...base, attendance: { date: '2026-11-25', selfie_reason: 'od' } }), null);
  assert.equal(dutyDayProblem({ ...base, gatePass: { user_id: 'u1', outing_type: 'official_outing', request_date: '2026-11-25', status: 'pending_approval' } }), null);
  assert.ok(dutyDayProblem({ ...base, gatePass: { user_id: 'u1', outing_type: 'official_outing', request_date: '2026-11-25', status: 'rejected' } }));
  assert.ok(dutyDayProblem({ ...base, gatePass: { user_id: 'u2', outing_type: 'official_outing', request_date: '2026-11-25', status: 'approved' } }));   // someone else's pass
  assert.ok(dutyDayProblem({ ...base, gatePass: { user_id: 'u1', outing_type: 'personal', request_date: '2026-11-25', status: 'approved' } }));
  assert.equal(dutyDayProblem({ ...base }, { ...FT_DEFAULTS, require_duty_day: false }), null);
});

test('screen: garbage, future, stale, before-session and mock fixes are refused', () => {
  const r = screenPoints([
    { lat: 'x', lng: 1, t: iso(10) }, { lat: 0, lng: 0, t: iso(10) }, { lat: 95, lng: 10, t: iso(10) },
    pt(0, -3600),                                  // an hour in the future
    pt(0, 13 * 3600),                              // 13 h old
    pt(0, 4 * 3600),                               // before the session began (3 h ago)
    pt(0, 100, { mock: true }), pt(10, 90, { simulated: true }),
    pt(20, 60),                                    // the one good fix
  ], ctx());
  assert.equal(r.accepted.length, 1);
  assert.equal(r.rejected.invalid, 3);
  assert.equal(r.rejected.future, 1);
  assert.equal(r.rejected.stale, 1);
  assert.equal(r.rejected.before_start, 1);
  assert.equal(r.rejected.mock, 2);
  assert.equal(r.accepted[0].mock, undefined);
});

test('screen: mock allowed only when HR turns the rule off', () => {
  const r = screenPoints([pt(0, 100, { mock: true })], ctx(), { ...FT_DEFAULTS, reject_mock: false });
  assert.equal(r.accepted.length, 1);
});

test('screen: poor accuracy, out of order, too frequent, impossible speed', () => {
  const last = { lat: O.lat, lng: O.lng, t: iso(300) };
  const r = screenPoints([
    pt(0, 400),                                    // older than the stored newest point
    pt(30, 298),                                   // only 2 s after the last stored point -> too frequent
    pt(60, 290, { acc: 80 }),                      // 80 m accuracy
    pt(5000, 240),                                 // 5 km in 60 s = 300 km/h
    pt(100, 200),                                  // fine
    pt(110, 198),                                  // 2 s later -> too frequent
    pt(250, 100),                                  // fine
  ], ctx({ last }));
  assert.deepEqual(r.accepted.map(p => Math.round((Date.parse(p.t) - NOW) / -1000)), [200, 100]);
  assert.equal(r.rejected.out_of_order, 1);
  assert.equal(r.rejected.interval, 2);
  assert.equal(r.rejected.accuracy, 1);
  assert.equal(r.rejected.speed, 1);
});

test('screen: a batch uploaded out of order is sorted, the first fix may be a little rougher, heartbeats skip accuracy/interval', () => {
  const r = screenPoints([pt(40, 50), pt(0, 100, { acc: 55 }), pt(40, 49, { hb: true, acc: 150 })], ctx());
  assert.deepEqual(r.accepted.map(p => !!p.hb), [false, false, true]);
  assert.equal(r.rejectedCount, 0);
});

test('screen: batches are capped and heartbeats still refuse mock/stale', () => {
  const many = Array.from({ length: 700 }, (_, i) => pt(i * 3, 3000 - i * 4));
  const r = screenPoints(many, ctx({ tripStartMs: 0 }));
  assert.ok(r.total === 700 && r.rejected.invalid === 200);
  const hb = screenPoints([pt(0, 10, { hb: true, mock: true }), pt(0, 99999, { hb: true })], ctx({ tripStartMs: 0 }));
  assert.equal(hb.accepted.length, 0);
});

test('screen + processPoints: a spoofed teleport never becomes distance', () => {
  const trip = { id: 't', status: 'active', points: [], distance_km: 0, point_count: 0 };
  const fixes = [pt(0, 600), pt(100, 560), pt(200, 520), { ...pt(0, 480), lat: 19.07, lng: 72.87 }, pt(300, 440)];
  const s = screenPoints(fixes, ctx());
  const { trip: out } = processPoints(trip, s.accepted, NOW);
  assert.equal(s.rejected.speed, 1);
  assert.ok(out.distance_km > 0.28 && out.distance_km < 0.33, String(out.distance_km));
});

test('reject stats accumulate', () => {
  const a = addRejectStats(null, { mock: 2, speed: 1 });
  const b = addRejectStats(a, { mock: 1 });
  assert.equal(b.mock, 3); assert.equal(b.speed, 1); assert.equal(b.stale, 0);
});

test('beats: thinned to the spacing, capped', () => {
  const b = recordBeats([], [NOW, NOW + 10000, NOW + 50000, NOW + 51000, NOW + 100000], 45);
  assert.equal(b.length, 3);
  assert.equal(recordBeats(b, [NOW + 200000], 45, 3).length, 3);
});

test('gaps: silence with beats is flagged, a parked phone that keeps beating is not', () => {
  const pts = [pt(0, 3600), pt(100, 3500)];
  const parked = recordBeats([], Array.from({ length: 30 }, (_, i) => NOW - 3500000 + i * 60000), 45);
  const win = { startMs: NOW - 3600000, endMs: NOW, open: false };
  assert.equal(detectGaps(pts, parked, { ...win, endMs: NOW - 3500000 + 30 * 60000 }).length, 0);
  const dead = recordBeats([], [NOW - 3500000, NOW - 3440000], 45);
  const g = detectGaps(pts, dead, { startMs: NOW - 3600000, endMs: NOW, open: false });
  assert.equal(g.length, 1); assert.equal(g[0].kind, 'silent'); assert.ok(g[0].minutes >= 55);
});

test('gaps: an old trip without beats only reports a gap where the phone moved', () => {
  const pts = [pt(0, 3600), pt(10, 3000), pt(2000, 1500)];                 // 10 min silent but parked, then 25 min silent while moving 2 km
  const g = detectGaps(pts, [], { startMs: NOW - 3600000, endMs: NOW - 1500000, open: false });
  assert.equal(g.length, 1); assert.equal(g[0].kind, 'signal_lost_moving'); assert.ok(g[0].moved_m > 1900);
});

test('gaps: an open trip whose phone went quiet shows offline now', () => {
  const g = detectGaps([pt(0, 3600), pt(50, 3550)], recordBeats([], [NOW - 3550000], 45), { startMs: NOW - 3600000, endMs: NOW, open: true });
  assert.equal(g.length, 1); assert.equal(g[0].kind, 'offline_now'); assert.equal(g[0].open, true);
});

test('live status', () => {
  assert.equal(liveStatus(iso(120), NOW).state, 'live');
  assert.equal(liveStatus(iso(1200), NOW).state, 'offline');
  assert.equal(liveStatus(null, NOW).state, 'no_fix');
});

test('route: merges a day\'s trips in time order, distance from stored points, gaps and live position', () => {
  const t1 = { id: 'a', status: 'completed', start_time: iso(7200), end_time: iso(5400), vehicle_type: '2_wheeler', points: [pt(0, 7200), pt(500, 7000), pt(1000, 6800)] };
  const t2 = { id: 'b', status: 'active', start_time: iso(3600), points: [pt(1000, 3600), pt(1600, 3500, { g: 1 })], last_pos: { ...pt(1600, 30), acc: 8 }, beats: [iso(3600), iso(3500)] };
  const r = buildRoute([t2, t1], NOW);
  assert.deepEqual(r.segments.map(s => s.trip_id), ['a', 'b']);
  assert.ok(Math.abs(r.distance_km - 1.6) < 0.02, String(r.distance_km));
  assert.ok(r.estimated_km > 0.55 && r.estimated_km < 0.65);
  assert.equal(r.on_duty_now, true);
  assert.equal(r.live.state, 'live');
  assert.equal(r.gaps.length, 1); assert.equal(r.gaps[0].kind, 'offline_now');
  assert.equal(r.start.t, iso(7200));
  assert.equal(pathDistanceM([pt(0, 10), pt(100, 5)]) > 99, true);
});

test('route: no trips gives an empty, harmless picture', () => {
  const r = buildRoute([], NOW);
  assert.equal(r.distance_km, 0); assert.equal(r.live, null); assert.equal(r.start, null);
});

test('privacy: self, HR/management, own hierarchy only', () => {
  const base = { viewerId: 'v', subjectId: 's', isMgmt: false, isManager: false, visibleIds: null };
  assert.equal(canViewLocation({ ...base, viewerId: 's' }), true);
  assert.equal(canViewLocation(base), false);
  assert.equal(canViewLocation({ ...base, isMgmt: true }), true);
  assert.equal(canViewLocation({ ...base, isManager: true, visibleIds: ['s', 'x'] }), true);
  assert.equal(canViewLocation({ ...base, isManager: true, visibleIds: ['x'] }), false);
  assert.equal(canViewLocation({ ...base, isManager: true, visibleIds: null }), false);
  assert.equal(canViewLocation({ ...base, viewerId: null }), false);
});

test('nudge: only silent active sessions, in daytime, rate-limited and capped', async () => {
  const { nudgeDue, NUDGE } = await import('../utils/fieldTracking.js');
  const noon = Date.parse('2026-11-25T06:30:00Z');                         // 12:00 IST
  const t = { status: 'active', start_time: new Date(noon - 3600000).toISOString() };
  assert.equal(nudgeDue(t, null, noon), true);
  assert.equal(nudgeDue({ ...t, last_point_at: new Date(noon - 120000).toISOString() }, null, noon), false);   // heard 2 min ago
  assert.equal(nudgeDue({ ...t, status: 'completed' }, null, noon), false);
  assert.equal(nudgeDue(t, { count: 1, lastMs: noon - 5 * 60000 }, noon), false);                              // too soon
  assert.equal(nudgeDue(t, { count: 1, lastMs: noon - (NUDGE.EVERY_MIN + 1) * 60000 }, noon), true);
  assert.equal(nudgeDue(t, { count: NUDGE.MAX, lastMs: 0 }, noon), false);                                     // capped
  assert.equal(nudgeDue(t, null, Date.parse('2026-11-25T18:30:00Z')), false);                                  // midnight IST
});

test('wake: silent push goes out sooner and more often than the visible reminder, still daytime only and capped', async () => {
  const { wakeDue, nudgeDue, NUDGE } = await import('../utils/fieldTracking.js');
  const noon = Date.parse('2026-11-25T06:30:00Z');
  const t = { status: 'active', start_time: new Date(noon - 3 * 60000).toISOString() };   // started 3 minutes ago, never heard
  assert.equal(wakeDue(t, null, noon), true);
  assert.equal(nudgeDue(t, null, noon), false);                                          // the visible reminder waits 10 min
  assert.equal(wakeDue({ ...t, last_point_at: new Date(noon - 30000).toISOString() }, null, noon), false);
  assert.equal(wakeDue(t, { count: 1, lastMs: noon - 5 * 60000 }, noon), false);
  assert.equal(wakeDue(t, { count: NUDGE.WAKE_MAX, lastMs: 0 }, noon), false);
  assert.equal(wakeDue(t, null, Date.parse('2026-11-25T19:00:00Z')), false);
});

test('strict defaults: accuracy 30 m, speed 130, stale 6 h, gap 5 min; first fix may be 60 m', () => {
  assert.equal(FT_DEFAULTS.max_accuracy_m, 30); assert.equal(FT_DEFAULTS.max_speed_kmh, 130);
  assert.equal(FT_DEFAULTS.max_point_age_h, 6); assert.equal(FT_DEFAULTS.gap_minutes, 5);
  const r = screenPoints([pt(0, 200, { acc: 55 }), pt(30, 150, { acc: 40 }), pt(60, 100, { acc: 25 })], ctx({ tripStartMs: 0 }));
  assert.deepEqual(r.accepted.map(p => p.acc), [55, 25]);              // first fix 55 ok, 40 m refused, 25 m ok
  assert.equal(r.rejected.accuracy, 1);
  assert.equal(screenPoints([pt(0, 7 * 3600)], ctx({ tripStartMs: 0 })).rejected.stale, 1);
});

test('config: location-permission scope and new limits', () => {
  assert.equal(normalizeConfig({ require_location_permission: 'all' }).require_location_permission, 'all');
  assert.equal(normalizeConfig({ require_location_permission: 'nobody' }).require_location_permission, 'off');
  assert.equal(normalizeConfig({ geofence_max_event_age_h: 500 }).geofence_max_event_age_h, 48);
});

test('location gate: who must grant location, and which device states block', async () => {
  const { locationRequired, devicePolicyProblems } = await import('../utils/fieldTracking.js');
  const block = { ...FT_DEFAULTS, require_location_permission: 'tracked' };
  assert.equal(locationRequired({ field_duty_tracking_eligible: true }), false);          // blocking is off by default for now
  assert.equal(locationRequired({ field_duty_tracking_eligible: true }, block), true);
  assert.equal(locationRequired({ geofence_eligible: true }, block), true);
  assert.equal(locationRequired({}, block), false);
  const { locationGuide } = await import('../utils/fieldTracking.js');
  assert.equal(locationGuide({ field_duty_tracking_eligible: true }), true);               // guidance is on for tracked employees
  assert.equal(locationGuide({ geofence_eligible: true }), true);
  assert.equal(locationGuide({}), false);
  assert.equal(locationGuide({}, { ...FT_DEFAULTS, guide_location_permission: 'all' }), true);
  assert.equal(locationGuide({ geofence_eligible: true }, { ...FT_DEFAULTS, guide_location_permission: 'off' }), false);
  assert.equal(locationRequired({}, { ...FT_DEFAULTS, require_location_permission: 'all' }), true);
  const good = { platform: 'android', fg: true, bg: true, gps: true, battery: true };
  assert.deepEqual(devicePolicyProblems(good), []);
  assert.deepEqual(devicePolicyProblems({ ...good, fg: false }), ['location_denied']);
  assert.deepEqual(devicePolicyProblems({ ...good, bg: false, battery: false, gps: false }), ['gps_off', 'background_location_denied', 'battery_restricted']);
  assert.deepEqual(devicePolicyProblems({ platform: 'ios', fg: true, bg: false, gps: true }), ['background_location_denied']);
  assert.deepEqual(devicePolicyProblems({ platform: 'web', fg: true, gps: true }), []);       // a browser has no background / battery concept
  assert.deepEqual(devicePolicyProblems({}), ['location_denied']);                            // unknown is not assumed fine
  assert.deepEqual(devicePolicyProblems({ ...good, bg: false, battery: false }, { ...FT_DEFAULTS, require_background_permission: false, require_battery_exemption: false }), []);
});

test('geofence events: mock, accuracy (enter strict, exit looser), stale, future, impossible jump', async () => {
  const { geofenceEventProblem } = await import('../utils/fieldTracking.js');
  const base = { event: 'enter', accuracy: 20, occurredMs: NOW - 1000, lat: 28.6, lng: 77.2 };
  assert.equal(geofenceEventProblem(base, FT_DEFAULTS, NOW), null);
  assert.equal(geofenceEventProblem({ ...base, mock: true }, FT_DEFAULTS, NOW).code, 'MOCK_LOCATION');
  assert.equal(geofenceEventProblem({ ...base, accuracy: 70 }, FT_DEFAULTS, NOW).code, 'LOW_ACCURACY');
  assert.equal(geofenceEventProblem({ ...base, event: 'exit', accuracy: 70 }, FT_DEFAULTS, NOW), null);
  assert.equal(geofenceEventProblem({ ...base, event: 'exit', accuracy: 120 }, FT_DEFAULTS, NOW).code, 'LOW_ACCURACY');
  assert.equal(geofenceEventProblem({ ...base, occurredMs: NOW - 7 * 3600000 }, FT_DEFAULTS, NOW).code, 'STALE_EVENT');
  assert.equal(geofenceEventProblem({ ...base, occurredMs: NOW + 600000 }, FT_DEFAULTS, NOW).code, 'FUTURE_EVENT');
  const jump = { ...base, lat: 19.07, lng: 72.87, prev: { lat: 28.6, lng: 77.2, ms: NOW - 600000 } };
  assert.equal(geofenceEventProblem(jump, FT_DEFAULTS, NOW).code, 'IMPOSSIBLE_SPEED');
  assert.equal(geofenceEventProblem({ ...base, prev: { lat: 28.6, lng: 77.2001, ms: NOW - 600000 } }, FT_DEFAULTS, NOW), null);
});
