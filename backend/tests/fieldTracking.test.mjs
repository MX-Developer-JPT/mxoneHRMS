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
  assert.ok(r.total === 700 && r.rejected.invalid === 0 && r.accepted.length === 350);   // a long offline queue is not cut off
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

test('sessions: ineligible or over-long sessions are closed, healthy ones are left alone', async () => {
  const { sessionCloseReason, sessionEndMs } = await import('../utils/fieldTracking.js');
  const mk = (hoursAgo, extra = {}) => ({ status: 'active', start_time: new Date(NOW - hoursAgo * 3600000).toISOString(), ...extra });
  assert.equal(sessionCloseReason(mk(2), true, NOW), null);
  assert.equal(sessionCloseReason(mk(2), false, NOW).code, 'not_eligible');
  assert.equal(sessionCloseReason(mk(17), true, NOW).code, 'too_long');
  assert.equal(sessionCloseReason(mk(15), true, NOW), null);
  assert.equal(sessionCloseReason({ ...mk(99), status: 'completed' }, false, NOW), null);
  assert.equal(sessionCloseReason(mk(24 * 60), true, NOW, { ...FT_DEFAULTS, max_session_hours: 48 }).code, 'too_long');
  // recorded end: last sign of life, but never beyond the allowed length
  const long = mk(24 * 60, { last_point_at: new Date(NOW).toISOString() });
  assert.equal(sessionEndMs(long), Date.parse(long.start_time) + 16 * 3600000);
  const quiet = mk(30, { last_point_at: new Date(NOW - 29 * 3600000).toISOString() });
  assert.equal(sessionEndMs(quiet), Date.parse(quiet.last_point_at));
  assert.equal(sessionEndMs(mk(5)), Date.parse(mk(5).start_time));
  assert.equal(normalizeConfig({ max_session_hours: 1000 }).max_session_hours, 48);
});

const P = (x, y, minAgo, extra = {}) => ({ lat: 28.6 + y / 111195, lng: 77.2 + x / (111195 * Math.cos(28.6 * Math.PI / 180)), t: new Date(NOW - minAgo * 60000).toISOString(), ...extra });

test('stays: a long stop is measured from arrival to departure, short pauses are ignored, offices are never flagged', async () => {
  const { detectStops } = await import('../utils/fieldTracking.js');
  const pts = [P(0, 0, 240), P(500, 0, 220), P(1000, 0, 200),            // driving
               P(1010, 5, 190), P(1020, 8, 100), P(1015, 3, 70),         // arrives at 190 min ago, still there 70 min ago (parked: few points)
               P(2500, 0, 60), P(3000, 0, 50)];                           // leaves
  const s = detectStops(pts, [], { startMs: NOW - 240 * 60000, endMs: NOW - 50 * 60000, open: false }, []);
  assert.equal(s.length, 1);
  assert.equal(s[0].minutes, 130); assert.equal(s[0].long, true); assert.equal(s[0].at_office, false);   // arrival fix 200 min ago, last fix there 70 min ago
  assert.equal(s[0].verified_minutes, 130);
  // 10 minute pause is below the stop threshold
  assert.equal(detectStops([P(0, 0, 100), P(5, 0, 90), P(900, 0, 80)], [], { endMs: NOW - 80 * 60000 }, []).length, 0);
  // same stay inside an office geofence: listed, not flagged
  const office = [{ name: 'E82 office', latitude: 28.6 + 4 / 111195, longitude: 77.2 + 1015 / (111195 * Math.cos(28.6 * Math.PI / 180)), geofence_radius: 150 }];
  const so = detectStops(pts, [], { endMs: NOW - 50 * 60000 }, office);
  assert.equal(so[0].at_office, true); assert.equal(so[0].long, false); assert.equal(so[0].place, 'E82 office');
});

test('stays: silent minutes inside a stay are counted separately and the last stay runs to the end of the session', async () => {
  const { detectStops } = await import('../utils/fieldTracking.js');
  const pts = [P(0, 0, 200), P(5, 0, 120)];
  const gaps = [{ kind: 'silent', from: new Date(NOW - 190 * 60000).toISOString(), to: new Date(NOW - 130 * 60000).toISOString() }];
  const s = detectStops(pts, gaps, { endMs: NOW - 120 * 60000, open: false }, []);
  assert.equal(s[0].minutes, 80); assert.equal(s[0].silent_minutes, 60); assert.equal(s[0].verified_minutes, 20);
  const tail = detectStops([P(0, 0, 100)], [], { endMs: NOW, open: false }, []);                              // ended 100 minutes after the last fix
  assert.equal(tail[0].minutes, 100);
});

test('checkpoints: one every 30 minutes with the place and the km so far', async () => {
  const { checkpoints } = await import('../utils/fieldTracking.js');
  const pts = [P(0, 0, 100), P(1000, 0, 80), P(2000, 0, 55), P(3000, 0, 25), P(4000, 0, 5)];
  const c = checkpoints(pts, NOW - 100 * 60000, NOW - 5 * 60000);
  assert.deepEqual(c.map(x => x.n), [1, 2, 3]);                              // +30, +60, +90 minutes
  assert.deepEqual(c.map(x => x.km), [1, 2, 3]);                             // 1 km at 80, 2 km at 55 (as of 40 min ago), 3 km at 25 (as of 10 min ago)
  assert.deepEqual(checkpoints([], NOW - 100 * 60000, NOW), []);
});

test('route: includes stops, checkpoints, duration and longest non-office stop', () => {
  const tr = { id: 'a', status: 'completed', start_time: iso(300 * 60), end_time: iso(10 * 60), vehicle_type: '2_wheeler',
    points: [pt(0, 18000), pt(2000, 17000), pt(2010, 15000), pt(2005, 9000), pt(5000, 7000)] };
  const r = buildRoute([tr], NOW);
  assert.ok(r.stops.length >= 1 && r.stops[0].long === true);
  assert.ok(r.longest_stop_min >= 100);
  assert.ok(r.checkpoints.length >= 5);
  assert.equal(r.duration_min, 290);
});

test('daySummary flattens a route', async () => {
  const { daySummary } = await import('../utils/fieldTracking.js');
  const tr = { id: 'a', status: 'completed', start_time: iso(7200), end_time: iso(3600), points: [pt(0, 7200), pt(1000, 6000)] };
  const s = daySummary(buildRoute([tr], NOW));
  assert.equal(s.sessions, 1); assert.ok(Math.abs(s.distance_km - 1) < 0.02); assert.equal(s.duration_min, 60);
});

test('attendance sync: tracking begins at OD check-in and ends at OD check-out', async () => {
  const { attendanceSyncAction: a } = await import('../utils/fieldTracking.js');
  const od = { selfie_reason: 'od', status: 'on_duty', is_in_progress: true };
  assert.equal(a({ eligible: true, attendance: od, activeTrip: null }).action, 'start');
  assert.equal(a({ eligible: false, attendance: od, activeTrip: null }).action, 'none');
  assert.equal(a({ eligible: true, attendance: { selfie_reason: 'wfh', status: 'work_from_home', is_in_progress: true }, activeTrip: null }).action, 'none');
  assert.equal(a({ eligible: true, attendance: { ...od, is_in_progress: false }, activeTrip: null }).action, 'none');
  const t = { status: 'active', source: 'od_attendance' };
  assert.equal(a({ eligible: true, attendance: od, activeTrip: t }).action, 'none');
  assert.equal(a({ eligible: true, attendance: { ...od, is_in_progress: false }, activeTrip: t }).reason, 'OD check-out');
  assert.equal(a({ eligible: true, attendance: null, activeTrip: t }).action, 'stop');
  assert.equal(a({ eligible: true, attendance: { ...od, is_in_progress: false }, activeTrip: { status: 'active' } }).action, 'none');   // a gate-pass trip is not ended by OD check-out
});

test('clock: a phone running fast or slow is corrected to server time; nonsense offsets are not trusted', async () => {
  const { clockOffsetMs, correctPointTimes, geofenceEventTime } = await import('../utils/fieldTracking.js');
  // phone is 7 minutes fast: its "now" reads 10:07 while the server says 10:00
  const off = clockOffsetMs('2026-11-25T10:07:00.000Z', Date.parse('2026-11-25T10:00:00.000Z'));
  assert.equal(off, -7 * 60000);
  const fixed = correctPointTimes([{ t: '2026-11-25T10:05:00.000Z', lat: 1, lng: 1 }, { t: 'bad', lat: 1, lng: 1 }], off);
  assert.equal(fixed[0].t, '2026-11-25T09:58:00.000Z'); assert.equal(fixed[1].t, 'bad');
  assert.equal(clockOffsetMs('2026-11-25T23:00:00.000Z', Date.parse('2026-11-25T10:00:00.000Z')), null);   // 13 h off: ignored
  assert.equal(clockOffsetMs(undefined, 1), null);
  assert.equal(correctPointTimes([{ t: 'x' }], null)[0].t, 'x');
  // a point stamped "in the future" by a fast phone becomes a valid recent one after correction
  const s = screenPoints(correctPointTimes([pt(0, -400)], clockOffsetMs(new Date(NOW + 400000).toISOString(), NOW)), ctx());
  assert.equal(s.accepted.length, 1);
  // geofence crossing: phone clock wrong by +3 h, crossing reported 90 s before upload -> server time minus 90 s, not the phone's time
  const ev = geofenceEventTime({ occurred_at: '2026-11-25T13:00:00.000Z', device_now: '2026-11-25T13:01:30.000Z' }, NOW);
  assert.equal(ev.ms, NOW - 90000); assert.equal(ev.fromDevice, true);
  assert.equal(geofenceEventTime({ occurred_at: '2026-11-25T13:00:00.000Z' }, NOW).ms, NOW);              // older app: receipt time
  assert.equal(geofenceEventTime({ occurred_at: '2026-11-25T13:05:00.000Z', device_now: '2026-11-25T13:00:00.000Z' }, NOW).ms, NOW);   // negative age is clamped
});

test('accuracy: a one-fix spike is removed, a real turn-around and a stop are kept', async () => {
  const { cleanTrail, finalizeTrip, accuracyStats, geofenceAllowedM, pathDistanceM } = await import('../utils/fieldTracking.js');
  const mk = (x, y, secAgo, extra = {}) => ({ lat: 28.6 + y / 111195, lng: 77.2 + x / (111195 * Math.cos(28.6 * Math.PI / 180)), t: new Date(NOW - secAgo * 1000).toISOString(), acc: 10, ...extra });
  const spiky = [mk(0, 0, 100), mk(100, 0, 90), mk(100, 150, 80), mk(110, 0, 70), mk(200, 0, 60)];         // the third fix jumps 150 m north and straight back
  const c = cleanTrail(spiky);
  assert.equal(c.length, 4);
  assert.ok(Math.abs(pathDistanceM(c) - 200) < 5, String(pathDistanceM(c)));
  assert.ok(pathDistanceM(spiky) > 490);
  // real out-and-back (drive 150 m out, wait 10 minutes, come back): untouched
  const real = [mk(0, 0, 1000), mk(0, 150, 900), mk(0, 150, 300), mk(0, 0, 200)];
  assert.equal(cleanTrail(real).length, 4);
  // gap-flagged fixes are never treated as spikes
  assert.equal(cleanTrail([mk(0, 0, 100), mk(100, 150, 80, { g: 1 }), mk(200, 0, 60)]).length, 3);
  // final distance: spike km removed, original kept, never inflated, huge cuts flagged instead of applied
  const longTrail = Array.from({ length: 12 }, (_, i) => mk(i * 300, 0, 1200 - i * 60));                // 3.3 km, one 150 m spike in the middle
  longTrail.splice(6, 0, mk(1800 + 5, 150, 1200 - 6 * 60 + 30, { acc: 25 }));   // a poor-accuracy fix well off the road line
  const rawKm = pathDistanceM(longTrail) / 1000;
  const t1 = finalizeTrip({ points: longTrail, distance_km: rawKm });
  assert.equal(t1.distance_raw_km, rawKm); assert.ok(t1.distance_km < rawKm - 0.15 && t1.distance_km > 3.2 && t1.spike_km_removed > 0.15, JSON.stringify([t1.distance_km, rawKm]));
  const t1b = finalizeTrip({ points: spiky, distance_km: 0.49 });                      // would remove >25%: flagged, not applied
  assert.equal(t1b.distance_km, 0.49); assert.equal(t1b.distance_review, true);
  const t2 = finalizeTrip({ points: [mk(0, 0, 100), mk(100, 0, 90), mk(200, 0, 80)], distance_km: 0.2 });
  assert.equal(t2.distance_km, 0.2);
  assert.deepEqual(finalizeTrip({ points: [], distance_km: 0 }), { points: [], distance_km: 0 });
  // fix-quality statistics
  assert.deepEqual(accuracyStats([5, 8, 12, 15, 40]), { n: 5, median_m: 12, p90_m: 40, good_pct: 80 });
  assert.equal(accuracyStats([]).median_m, null);
  // a route reports its accuracy and distance from the cleaned trail
  const r = buildRoute([{ id: 'a', status: 'completed', start_time: iso(200), end_time: iso(50), points: spiky }], NOW);
  assert.ok(r.distance_km < 0.25); assert.equal(r.accuracy.median_m, 10);
  // geofence: an arrival may be reported from at most radius + half the error + 20 m (was radius + error + 200 m)
  assert.equal(geofenceAllowedM(100, 30), 135);
  assert.equal(geofenceAllowedM(100, 500), 100 + 25 + 20);                              // error beyond the accuracy limit is capped
});

test('device tokens: revoked by device, by person-wide floor, never by accident', async () => {
  const { tokenRevoked } = await import('../utils/fieldTracking.js');
  const t = (iat, did = 'd1', id = 'u1') => ({ id, did, iat });
  const now = Date.parse('2026-11-26T05:00:00Z');
  const floorMs = Date.parse('2026-11-26T04:00:00Z');
  assert.equal(tokenRevoked({}, t(now / 1000), now), false);
  assert.equal(tokenRevoked(undefined, t(now / 1000), now), false);
  assert.equal(tokenRevoked({}, null, now), true);                                                    // no claims = not valid
  // one phone
  const byDid = { dids: { d1: now + 86400000 } };
  assert.equal(tokenRevoked(byDid, t(now / 1000, 'd1'), now), true);
  assert.equal(tokenRevoked(byDid, t(now / 1000, 'd2'), now), false);                                // another phone of the same person is fine
  assert.equal(tokenRevoked({ dids: { d1: now - 1 } }, t(now / 1000, 'd1'), now), false);            // an expired entry no longer matters
  // every phone of a person: tokens issued before the floor die, ones issued after it (renewed) live; other people unaffected
  const byFloor = { floors: { u1: floorMs } };
  assert.equal(tokenRevoked(byFloor, t(floorMs / 1000 - 600), now), true);
  assert.equal(tokenRevoked(byFloor, t(floorMs / 1000 + 600), now), false);
  assert.equal(tokenRevoked(byFloor, t(floorMs / 1000 - 600, 'd9', 'u2'), now), false);
});

test('late uploads: an offline backlog that arrives after newer fixes is put back, duplicates are not', async () => {
  const { backfillTrail } = await import('../utils/fieldTracking.js');
  let trip = { id: 't', status: 'active', points: [], distance_km: 0, point_count: 0 };
  const send = (fixes) => {
    const s = screenPoints(fixes, ctx({ tripStartMs: 0, last: trip.points.at(-1) || null, trail: trip.points }));
    trip = backfillTrail(processPoints(trip, s.accepted, NOW).trip, s.late, NOW);
    return s;
  };
  send([pt(0, 600), pt(100, 580)]);
  send([pt(900, 100)]);                                                        // the newest fix overtakes the queue
  const s = send([pt(200, 500), pt(400, 400), pt(600, 300), pt(100, 580), pt(101, 578)]);
  assert.equal(s.late.length, 3);
  assert.equal(s.rejected.out_of_order, 2);                                    // already stored / same moment
  assert.deepEqual(trip.points.map(p => Math.round((NOW - Date.parse(p.t)) / 1000)), [600, 580, 500, 400, 300, 100]);
  assert.ok(trip.distance_km > 0.85 && trip.distance_km < 0.95, String(trip.distance_km));
  assert.equal(trip.rev, 1);
  assert.equal(send([{ ...pt(0, 450), lat: 19.07 }]).rejected.speed, 1);       // a late teleport is still refused
});

test('clock: a few seconds of upload delay never moves fix times', async () => {
  const { clockOffsetMs } = await import('../utils/fieldTracking.js');
  assert.equal(clockOffsetMs(new Date(NOW - 9000).toISOString(), NOW), 0);
  assert.equal(clockOffsetMs(new Date(NOW - 60000).toISOString(), NOW), 60000);
});

test('time at a point: interpolated while moving, a window for a stay, honest about gaps, every visit listed', async () => {
  const { timeAtPoint } = await import('../utils/fieldTracking.js');
  const at = (x) => ({ lat: O.lat, lng: pt(x, 0).lng });
  const secs = (iso_) => Math.round((NOW - Date.parse(iso_)) / 1000);
  const moving = { id: 'a', start_time: iso(1000), points: [pt(0, 1000), pt(200, 980), pt(400, 960)] };
  const m = timeAtPoint([moving], at(300), 30);
  assert.equal(m.visits.length, 1); assert.equal(m.visits[0].kind, 'precise'); assert.equal(secs(m.visits[0].at), 970);
  assert.equal(timeAtPoint([moving], { lat: O.lat + 0.01, lng: O.lng }, 30).visits.length, 0);
  const stay = { id: 'b', start_time: iso(5000), points: [pt(0, 5000), pt(200, 4980), pt(202, 3200), pt(400, 3180)], beats: [iso(4800), iso(4200), iso(3600)] };
  const st = timeAtPoint([stay], at(200), 25).visits;
  assert.equal(st.length, 1); assert.equal(st[0].kind, 'stayed'); assert.ok(secs(st[0].from) >= 4975 && secs(st[0].to) <= 3205, st[0].from + ' ' + st[0].to);
  const gap = { id: 'c', start_time: iso(2000), points: [pt(0, 2000), pt(5000, 1000, { g: 1 })] };
  const g = timeAtPoint([gap], at(2500), 30).visits[0];
  assert.equal(g.kind, 'gap'); assert.equal(secs(g.from), 2000); assert.equal(secs(g.to), 1000);
  const twice = { id: 'd', start_time: iso(900), points: [pt(0, 900), pt(200, 880), pt(400, 860), pt(200, 600), pt(0, 580)] };
  assert.equal(timeAtPoint([twice], at(100), 20).visits.length, 2);
});

test('coverage: says who is not sending and why', async () => {
  const { sendingStatus, wakeDue, NUDGE } = await import('../utils/fieldTracking.js');
  const trip = { status: 'active', points: [{}], last_point_at: iso(60) };
  assert.equal(sendingStatus({ trip, device: { platform: 'android', problems: [] }, hasAndroidApp: true }, NOW).state, 'sending');
  assert.match(sendingStatus({ trip: { ...trip, last_point_at: iso(7200) }, device: { platform: 'web', problems: ['location_denied'] } }, NOW).text, /2 h 0 min.*website/);
  assert.match(sendingStatus({ trip: null, device: null, hasAndroidApp: false }, NOW).text, /never opened/);
  assert.equal(sendingStatus({ trip: null, device: { platform: 'android', problems: [] }, hasAndroidApp: true }, NOW).attention, false);
  const noon = Date.parse('2026-11-25T06:30:00Z');
  const t = { status: 'active', start_time: new Date(noon - 7200000).toISOString(), last_point_at: new Date(noon - 300000).toISOString() };
  assert.equal(wakeDue(t, { count: NUDGE.WAKE_MAX, lastMs: noon - 3600000 }, noon), true);   // heard since the last push: a new silent spell
});
