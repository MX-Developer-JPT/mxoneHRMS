// Field Duty Tracking rules — the server-side gatekeeper in front of utils/fieldTrip.js (which turns accepted fixes
// into a trail + distance). Pure functions only (no DB / Express) so every rule is unit-tested.
//
// What this module decides:
//   * who may be tracked at all (eligible employee, on an approved field-duty day)          -> eligibilityProblem / dutyDayProblem
//   * which incoming GPS points are believable (stale, future, out of order, mock, poor accuracy, too frequent, impossible speed)
//                                                                                          -> screenPoints
//   * where tracking went dark (phone off, permission revoked, no signal)                   -> recordBeats / detectGaps
//   * what a route for one employee on one day looks like (merged trips, distance, gaps)    -> buildRoute
//   * who may look at it                                                                    -> canViewLocation
// Every threshold is configurable (setting `field_tracking_config`) but the defaults are strict.
import { havM, processPoints } from './fieldTrip.js';

export const FT_DEFAULTS = {
  require_duty_day: true,      // tracking may only start on a day the employee is on approved field duty (OD attendance / official gate pass)
  reject_mock: true,           // reject fixes flagged as mocked / simulated by the phone
  max_accuracy_m: 30,          // a fix less accurate than this is not stored
  first_fix_accuracy_m: 60,    // the very first fix of a session may be a little rougher so the start is not lost
  min_interval_s: 5,           // fixes closer together than this are dropped (battery / flood protection)
  max_speed_kmh: 130,          // an implied speed above this between two fixes is a jump
  max_point_age_h: 6,          // a fix older than this when it arrives is stale (a phone dumping an old buffer)
  max_future_s: 120,           // a fix timestamped later than this ahead of the server clock is rejected
  gap_minutes: 5,              // nothing heard from the phone for this long = tracking gap
  gap_moved_m: 150,            // a gap during which the phone moved at least this far is also counted as estimated distance
  live_stale_minutes: 5,       // a "live" position older than this is shown as offline
  stop_radius_m: 100,          // staying within this distance of where you stopped counts as the same place
  stop_min_minutes: 15,        // a stay at least this long is listed as a stop on the day's route
  long_stop_minutes: 45,       // a stay this long (away from an office) is highlighted as too long in one place
  checkpoint_minutes: 30,      // a timed checkpoint (time, place, km so far) is marked on the route this often
  max_session_hours: 16,       // a field-duty session may not stay open longer than this; it is closed automatically
  geofence_max_accuracy_m: 50,   // geofence ENTER (attendance in) is refused when the fix is less accurate than this
  geofence_slack_m: 20,          // how far outside a fence boundary an arrival may be reported from (plus half the fix error); was 200 m
  geofence_exit_accuracy_m: 100, // geofence EXIT: a little looser, because refusing it would leave a session wrongly open
  geofence_max_event_age_h: 6,   // a queued geofence event older than this is refused (was 48 h)
  require_location_permission: 'off',       // who is BLOCKED from the app without location access: 'tracked' (field-duty / geofence employees), 'all', or 'off' (off for now)
  guide_location_permission: 'tracked',     // who is GUIDED (not blocked) to enable it, and alerted if they switch it off: 'tracked', 'all' or 'off'
  require_background_permission: true,      // "Allow all the time" is required, not just while-using
  require_battery_exemption: true,          // Android: the app must be exempt from battery optimisation or the OS kills tracking
  device_report_minutes: 5,                 // the phone reports its permission / GPS / battery state at least this often while the app is open
  snap_to_roads: true,         // draw routes along the road network (needs the OSRM service; display only, never changes distance)
};

const LIMITS = {
  max_accuracy_m: [5, 100], first_fix_accuracy_m: [10, 150], geofence_max_accuracy_m: [10, 150], geofence_slack_m: [0, 100], geofence_exit_accuracy_m: [10, 250], geofence_max_event_age_h: [1, 48], device_report_minutes: [1, 60], min_interval_s: [1, 120], max_speed_kmh: [30, 300], max_point_age_h: [1, 72],
  max_future_s: [0, 600], gap_minutes: [2, 120], gap_moved_m: [20, 2000], live_stale_minutes: [2, 120], max_session_hours: [2, 48], stop_radius_m: [30, 500], stop_min_minutes: [5, 120], long_stop_minutes: [10, 480], checkpoint_minutes: [5, 120],
};

// Anything missing or out of range falls back to the strict default (clamped, never trusted blindly).
export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const cfg = { ...FT_DEFAULTS };
  for (const k of ['require_duty_day', 'reject_mock', 'snap_to_roads', 'require_background_permission', 'require_battery_exemption']) if (typeof r[k] === 'boolean') cfg[k] = r[k];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(r[k]);
    if (r[k] != null && r[k] !== '' && Number.isFinite(v)) cfg[k] = Math.min(hi, Math.max(lo, v));
  }
  if (['off', 'tracked', 'all'].includes(r.require_location_permission)) cfg.require_location_permission = r.require_location_permission;
  if (['off', 'tracked', 'all'].includes(r.guide_location_permission)) cfg.guide_location_permission = r.guide_location_permission;
  return cfg;
}

/* ── who may be tracked ─────────────────────────────────────────────────── */

// emp: the Employee record (or null). Returns a plain-language reason, or null when the employee may be tracked.
export function eligibilityProblem(emp) {
  if (!emp) return 'No employee record is linked to this account';
  if (emp.status && emp.status !== 'active') return 'Your employee record is not active';
  if (!emp.field_duty_tracking_eligible) return 'You are not enabled for Field Duty Tracking. Ask HR to enable you under Field Duty Eligibility.';
  return null;
}

const DEAD_PASS = new Set(['rejected', 'cancelled', 'canceled', 'withdrawn', 'expired']);
const isODAttendance = (a) => !!a && (a.selfie_reason === 'od' || a.status === 'on_duty');

// A tracked session needs a reason to exist today: the employee is on OD (selfie attendance reason OD / status on_duty), or
// carries an official-outing gate pass of theirs for today that has not been rejected/cancelled.
export function dutyDayProblem({ today, attendance, gatePass, userId }, cfg = FT_DEFAULTS) {
  if (!cfg.require_duty_day) return null;
  if (isODAttendance(attendance) && (!attendance.date || attendance.date === today)) return null;
  if (gatePass) {
    const mine = !gatePass.user_id || gatePass.user_id === userId || gatePass.employee_user_id === userId;
    const official = gatePass.outing_type === 'official_outing';
    const todays = !gatePass.request_date || gatePass.request_date === today;
    const status = String(gatePass.status || '').toLowerCase();
    if (mine && official && todays && !DEAD_PASS.has(status)) return null;
  }
  return 'Field Duty can only be tracked on an approved field-duty day: check in with Outduty (OD) or raise an official-outing gate pass first.';
}

/* ── incoming points ────────────────────────────────────────────────────── */

const emptyRej = () => ({ invalid: 0, mock: 0, stale: 0, future: 0, before_start: 0, out_of_order: 0, accuracy: 0, interval: 0, speed: 0 });

// incoming: [{lat,lng,t,acc,sp?,hb?,mock?|simulated?|is_mock?}]
// ctx: { nowMs, tripStartMs, last: {lat,lng,t}|null }   (last = newest point already stored for this trip)
// Returns { accepted: [...], rejected: {reason: count}, total, hardRejected }. Heartbeats pass the same believability checks
// (mock, stale, order) but are exempt from accuracy/interval so a parked phone can still say "I am here".
export function screenPoints(incoming, ctx, cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const now = ctx?.nowMs ?? Date.now();
  const rej = emptyRej();
  const list = Array.isArray(incoming) ? incoming.slice(0, MAX_UPLOAD) : [];
  const overflow = Array.isArray(incoming) ? Math.max(0, incoming.length - MAX_UPLOAD) : 0;
  if (overflow) rej.invalid += overflow;

  const norm = [];
  for (const raw of list) {
    const lat = Number(raw?.lat), lng = Number(raw?.lng);
    const tMs = raw?.t ? Date.parse(raw.t) : now;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0) || !Number.isFinite(tMs)) { rej.invalid++; continue; }
    norm.push({ ...raw, lat, lng, acc: Number(raw?.acc) || 0, tMs });
  }
  norm.sort((a, b) => a.tMs - b.tMs);

  const startMs = ctx?.tripStartMs ?? 0;
  let last = ctx?.last && Number.isFinite(Date.parse(ctx.last.t)) ? { lat: ctx.last.lat, lng: ctx.last.lng, tMs: Date.parse(ctx.last.t) } : null;
  const accepted = [], late = [];
  const trail = Array.isArray(ctx?.trail) ? ctx.trail.map(q => ({ lat: q.lat, lng: q.lng, tMs: Date.parse(q.t) })).filter(q => Number.isFinite(q.tMs)).sort((a, b) => a.tMs - b.tMs) : null;
  for (const p of norm) {
    const mock = p.mock === true || p.simulated === true || p.is_mock === true || p.isFromMockProvider === true;
    if (cfg.reject_mock && mock) { rej.mock++; continue; }
    if (p.tMs > now + cfg.max_future_s * 1000) { rej.future++; continue; }
    if (p.tMs < now - cfg.max_point_age_h * 3600000) { rej.stale++; continue; }
    if (startMs && p.tMs < startMs - 60000) { rej.before_start++; continue; }   // recorded before this session began
    if (!p.hb) {
      const accLimit = last ? cfg.max_accuracy_m : Math.max(cfg.max_accuracy_m, cfg.first_fix_accuracy_m);
      if (p.acc > accLimit) { rej.accuracy++; continue; }
      if (last && p.tMs <= last.tMs) {
        // Older than the newest stored point. With the stored trail to hand this is a LATE fix (an offline queue arriving after newer
        // points, or the phone's two uploaders overtaking each other): it is kept if it fills a hole and fits between its neighbours.
        const why = trail ? lateFixProblem(p, trail, cfg) : 'out_of_order';
        if (why) { rej[why]++; continue; }
        trail.splice(lowerBound(trail, p.tMs), 0, { lat: p.lat, lng: p.lng, tMs: p.tMs });
        const { tMs: lt, mock: _a, simulated: _b, is_mock: _c, isFromMockProvider: _d, ...lc } = p;
        late.push({ ...lc, t: new Date(lt).toISOString() });
        continue;
      }
      if (last && (p.tMs - last.tMs) / 1000 < cfg.min_interval_s) { rej.interval++; continue; }
      if (last) {
        const dt = Math.max((p.tMs - last.tMs) / 1000, 1);
        if (havM(last, p) / dt * 3.6 > cfg.max_speed_kmh) { rej.speed++; continue; }
      }
      last = { lat: p.lat, lng: p.lng, tMs: p.tMs };
    }
    const { tMs, mock: _m, simulated: _s, is_mock: _i, isFromMockProvider: _f, ...clean } = p;
    accepted.push({ ...clean, t: new Date(tMs).toISOString() });
  }
  const total = list.length + overflow;
  return { accepted, late, rejected: rej, total, rejectedCount: Object.values(rej).reduce((a, b) => a + b, 0) };
}

// Running totals of what was refused, kept on the trip so HR can see a phone that keeps sending bad data.
export function addRejectStats(prev, rej) {
  const out = { ...emptyRej(), ...(prev || {}) };
  for (const k of Object.keys(emptyRej())) out[k] = (out[k] || 0) + (rej?.[k] || 0);
  return out;
}

/* ── liveness + gaps ────────────────────────────────────────────────────── */

// Beats are the moments the server heard from the phone (accepted points AND heartbeats), thinned to one per `spacingS`.
// A parked phone stores no new trail points but keeps beating, so silence in the beats is what reveals a dead phone.
export function recordBeats(beats, incomingTimesMs, spacingS = 45, cap = 2500) {
  const out = Array.isArray(beats) ? beats.slice() : [];
  let lastMs = out.length ? Date.parse(out[out.length - 1]) : 0;
  for (const ms of [...incomingTimesMs].filter(Number.isFinite).sort((a, b) => a - b)) {
    if (ms - lastMs >= spacingS * 1000) { out.push(new Date(ms).toISOString()); lastMs = ms; }
  }
  return out.length > cap ? out.slice(out.length - cap) : out;
}

// points: stored trail points [{lat,lng,t}], beats: ISO list, window: { startMs, endMs, open }
// A gap is a stretch longer than cfg.gap_minutes with nothing heard. If the trip has beats, silence alone is a gap;
// for old trips with no beats only a stretch in which the phone moved (so was certainly not parked) is reported.
export function detectGaps(points, beats, win, cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const pts = (points || []).filter(p => Number.isFinite(Date.parse(p.t))).map(p => ({ ...p, ms: Date.parse(p.t) })).sort((a, b) => a.ms - b.ms);
  const hasBeats = Array.isArray(beats) && beats.length > 0;
  const times = pts.map(p => p.ms);
  if (hasBeats) for (const b of beats) { const ms = Date.parse(b); if (Number.isFinite(ms)) times.push(ms); }
  times.sort((a, b) => a - b);
  if (!times.length) return [];
  const limit = cfg.gap_minutes * 60000;
  const before = (ms) => { let r = null; for (const p of pts) { if (p.ms <= ms) r = p; else break; } return r; };
  const after = (ms) => pts.find(p => p.ms >= ms) || null;
  const gaps = [];
  const add = (fromMs, toMs, open) => {
    const a = before(fromMs), b = open ? null : after(toMs);
    const moved = a && b ? Math.round(havM(a, b)) : 0;
    const movedFlag = moved >= cfg.gap_moved_m;
    if (!hasBeats && !movedFlag && !open) return;          // old trip with no beats: a still phone stores no points, so silence proves nothing
    gaps.push({
      from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), minutes: Math.round((toMs - fromMs) / 60000),
      moved_m: moved, kind: open ? 'offline_now' : movedFlag ? 'signal_lost_moving' : 'silent',
      from_pos: a ? { lat: a.lat, lng: a.lng } : null, to_pos: b ? { lat: b.lat, lng: b.lng } : null, open: !!open,
    });
  };
  const startMs = win?.startMs;
  if (hasBeats && Number.isFinite(startMs) && times[0] - startMs > limit) add(startMs, times[0], false);
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > limit) add(times[i - 1], times[i], false);
  const endMs = win?.endMs;
  if (Number.isFinite(endMs) && endMs - times[times.length - 1] > limit && (hasBeats || win?.open)) add(times[times.length - 1], endMs, !!win?.open);
  return gaps;
}

/* ── route for one employee / one day ───────────────────────────────────── */

export function pathDistanceM(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += havM(points[i - 1], points[i]);
  return m;
}

export function liveStatus(lastPosT, nowMs, cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const ms = Date.parse(lastPosT);
  if (!Number.isFinite(ms)) return { state: 'no_fix', age_minutes: null };
  const age = Math.max(0, Math.round((nowMs - ms) / 60000));
  return { state: age > cfg.live_stale_minutes ? 'offline' : 'live', age_minutes: age };
}

// trips: stored FieldTrip documents of ONE employee for the day. Returns the whole picture HR needs on a map.
export function buildRoute(trips, nowMs, cfgIn, maxPoints = 4000, fences = []) {
  const cfg = cfgIn || FT_DEFAULTS;
  const sorted = [...(trips || [])].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const segments = [], gaps = [], stops = [], checkpointsAll = [], accs = [];
  let distanceM = 0, estimatedM = 0, live = null, accepted = 0, rejected = 0;
  for (const tr of sorted) {
    const pts = (tr.points || []).filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Date.parse(p.t))).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const clean = cleanTrail(pts);     // GPS spikes removed: distance, stays, checkpoints and the drawn line all come from the cleaned trail
    const open = tr.status === 'active';
    const startMs = Date.parse(tr.start_time), endMs = open ? nowMs : Date.parse(tr.end_time || tr.last_point_at || tr.start_time);
    const tripGaps = detectGaps(pts, tr.beats, { startMs, endMs, open }, cfg).map(g => ({ ...g, trip_id: tr.id }));
    gaps.push(...tripGaps);
    stops.push(...detectStops(clean, tripGaps, { startMs, endMs, open, liveMs: Date.parse(tr.last_pos?.t || '') }, fences, cfg).map(s => ({ ...s, trip_id: tr.id })));
    checkpointsAll.push(...checkpoints(clean, startMs, endMs, cfg).map(c => ({ ...c, trip_id: tr.id })));
    const dM = pathDistanceM(clean);
    let est = 0;
    for (let i = 1; i < clean.length; i++) if (clean[i].g) est += havM(clean[i - 1], clean[i]);
    accs.push(...clean.map(p => Number(p.acc)).filter(Number.isFinite));
    distanceM += dM; estimatedM += est;
    accepted += tr.stats?.accepted || pts.length;
    rejected += Object.values(tr.rule_stats || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const step = clean.length > maxPoints ? Math.ceil(clean.length / maxPoints) : 1;
    segments.push({
      trip_id: tr.id, status: tr.status, vehicle_type: tr.vehicle_type, purpose: tr.purpose || '', source: tr.source || '',
      start_time: tr.start_time, end_time: tr.end_time || null,
      points: clean.filter((_, i) => i % step === 0 || i === clean.length - 1).map(p => ({ lat: p.lat, lng: p.lng, t: p.t, g: p.g ? 1 : undefined })),
      distance_km: Math.round(dM / 10) / 100,
    });
    const lp = tr.last_pos || pts[pts.length - 1];
    if (lp && (!live || Date.parse(lp.t) > Date.parse(live.t))) live = { lat: lp.lat, lng: lp.lng, acc: lp.acc || 0, t: lp.t, trip_id: tr.id, active: open };
  }
  const flat = segments.flatMap(s => s.points);
  const anyActive = segments.some(s => s.status === 'active');
  return {
    segments, gaps,
    start: flat[0] ? { ...flat[0] } : null, end: flat.length ? { ...flat[flat.length - 1] } : null,
    live: live ? { ...live, ...liveStatus(live.t, nowMs, cfg) } : null,
    on_duty_now: anyActive,
    distance_km: Math.round(distanceM / 10) / 100,
    estimated_km: Math.round(estimatedM / 10) / 100,
    gap_minutes_total: gaps.reduce((a, g) => a + g.minutes, 0),
    points_accepted: accepted, points_rejected: rejected,
    stops, checkpoints: checkpointsAll, accuracy: accuracyStats(accs),
    duration_min: Math.round(segments.reduce((a, s) => a + Math.max(0, (Date.parse(s.end_time || '') || (s.status === 'active' ? nowMs : Date.parse(s.start_time))) - Date.parse(s.start_time)), 0) / 60000),
    longest_stop_min: stops.reduce((m, s) => (s.at_office ? m : Math.max(m, s.minutes)), 0),
  };
}

/* ── privacy ────────────────────────────────────────────────────────────── */

// Location history is readable by: the employee themself, HR/admin/management (everyone), and a manager for their own
// reporting hierarchy only. visibleIds: null = unrestricted (HR/management), otherwise the viewer's downstream user ids.
export function canViewLocation({ viewerId, subjectId, isMgmt, isManager, visibleIds }) {
  if (!viewerId || !subjectId) return false;
  if (viewerId === subjectId) return true;
  if (isMgmt) return true;
  if (isManager && Array.isArray(visibleIds)) return visibleIds.includes(subjectId);
  return false;
}

/* ── nudging silent sessions ────────────────────────────────────────────── */

export const NUDGE = { QUIET_MIN: 10, EVERY_MIN: 20, MAX: 6, FROM_HOUR: 8, TO_HOUR: 21, WAKE_QUIET_MIN: 2, WAKE_EVERY_MIN: 10, WAKE_MAX: 80 };
// the caps count one silent spell: once the phone has been heard again, a later silence is chased afresh
const spell = (trip, state) => (state && Date.parse(trip?.last_point_at) > state.lastMs ? null : state);

// An active session whose phone has not been heard from recently needs the employee to open the app (the app starts the
// phone's background recorder, which then keeps going with the screen locked or the app closed). state: { count, lastMs }.
export function nudgeDue(trip, state, nowMs) {
  if (!trip || trip.status !== 'active') return false;
  const hour = new Date(nowMs + 5.5 * 3600000).getUTCHours();
  if (hour < NUDGE.FROM_HOUR || hour >= NUDGE.TO_HOUR) return false;               // never at night
  const heardMs = Date.parse(trip.last_point_at || trip.start_time);
  if (!Number.isFinite(heardMs) || nowMs - heardMs < NUDGE.QUIET_MIN * 60000) return false;
  if (state && nowMs - state.lastMs < NUDGE.EVERY_MIN * 60000) return false;
  if (spell(trip, state)?.count >= NUDGE.MAX) return false;
  return true;
}

// The silent wake push is cheap and invisible, so it goes out sooner and more often than the visible reminder.
export function wakeDue(trip, state, nowMs) {
  if (!trip || trip.status !== 'active') return false;
  const hour = new Date(nowMs + 5.5 * 3600000).getUTCHours();
  if (hour < NUDGE.FROM_HOUR || hour >= NUDGE.TO_HOUR) return false;
  const heardMs = Date.parse(trip.last_point_at || trip.start_time);
  if (!Number.isFinite(heardMs) || nowMs - heardMs < NUDGE.WAKE_QUIET_MIN * 60000) return false;
  if (state && nowMs - state.lastMs < NUDGE.WAKE_EVERY_MIN * 60000) return false;
  if (spell(trip, state)?.count >= NUDGE.WAKE_MAX) return false;
  return true;
}

/* ── device state, location gate, geofence events ───────────────────────── */

// Who must have location access to use the app at all. 'tracked' = anyone HR enabled for field duty tracking or geofence attendance.
export function locationRequired(emp, cfg = FT_DEFAULTS) {
  if (cfg.require_location_permission === 'off') return false;
  if (cfg.require_location_permission === 'all') return true;
  return !!(emp && (emp.field_duty_tracking_eligible || emp.geofence_eligible));
}

// Who is guided (a dismissible prompt, never a block) to enable location access and alerted if they switch it off.
export function locationGuide(emp, cfg = FT_DEFAULTS) {
  if (cfg.guide_location_permission === 'off') return false;
  if (cfg.guide_location_permission === 'all') return true;
  return !!(emp && (emp.field_duty_tracking_eligible || emp.geofence_eligible));
}

// report: what the phone says about itself { platform, fg, bg, gps, battery, notif }. Missing facts are not assumed fine for
// the ones that matter; a browser (no bg / battery concept) is only held to foreground location + GPS.
export function devicePolicyProblems(report, cfg = FT_DEFAULTS) {
  const r = report || {};
  const native = r.platform === 'android' || r.platform === 'ios';
  const out = [];
  if (r.fg !== true) out.push('location_denied');
  if (r.gps === false) out.push('gps_off');
  if (native && cfg.require_background_permission && r.bg !== true) out.push('background_location_denied');
  if (r.platform === 'android' && cfg.require_battery_exemption && r.battery !== true) out.push('battery_restricted');
  return out;
}

export const PROBLEM_TEXT = {
  location_denied: 'Location permission is off',
  gps_off: 'Phone location (GPS) is switched off',
  background_location_denied: 'Location is not set to "Allow all the time"',
  battery_restricted: 'Battery optimisation is not switched off for Maxvolt One',
};

// A phone that has not reported within 2x the reporting interval + a minute while the app should be open is "unknown", not "fine".
export function deviceReportAge(report, nowMs) {
  const at = Date.parse(report?.at);
  return Number.isFinite(at) ? Math.round((nowMs - at) / 60000) : null;
}

// Geofence attendance events get the same believability rules as field-duty fixes.
export function geofenceEventProblem(ev, cfg, nowMs) {
  const c = cfg || FT_DEFAULTS;
  const e = ev || {};
  if (c.reject_mock && (e.mock === true || e.is_mock === true || e.simulated === true)) return { code: 'MOCK_LOCATION', error: 'Mock locations are not accepted' };
  const acc = Number(e.accuracy);
  const limit = e.event === 'exit' ? c.geofence_exit_accuracy_m : c.geofence_max_accuracy_m;
  if (Number.isFinite(acc) && acc > limit) return { code: 'LOW_ACCURACY', error: `GPS accuracy too low (${Math.round(acc)} m, limit ${limit} m)` };
  if (e.occurredMs != null) {
    if (e.occurredMs > nowMs + c.max_future_s * 1000) return { code: 'FUTURE_EVENT', error: 'Event time is in the future' };
    if (e.occurredMs < nowMs - c.geofence_max_event_age_h * 3600000) return { code: 'STALE_EVENT', error: `Event is older than ${c.geofence_max_event_age_h} hours` };
  }
  if (e.prev && Number.isFinite(e.lat) && Number.isFinite(e.lng) && e.occurredMs != null && Number.isFinite(e.prev.ms) && e.occurredMs > e.prev.ms) {
    const kmh = havM(e.prev, { lat: e.lat, lng: e.lng }) / ((e.occurredMs - e.prev.ms) / 1000) * 3.6;
    if (kmh > c.max_speed_kmh) return { code: 'IMPOSSIBLE_SPEED', error: 'Position jumped faster than a person can travel' };
  }
  return null;
}

/* ── sessions that must not stay open ───────────────────────────────────── */

// Why an open session has to be closed now (or null). A session is only legitimate while its employee is enabled and it has not
// outlived the maximum session length: sessions left open for weeks kept recording people's phones long after the trip ended.
export function sessionCloseReason(trip, eligible, nowMs, cfg = FT_DEFAULTS) {
  if (!trip || trip.status !== 'active') return null;
  if (!eligible) return { code: 'not_eligible', text: 'Employee is not enabled for Field Duty Tracking' };
  const startMs = Date.parse(trip.start_time);
  if (Number.isFinite(startMs) && nowMs - startMs > cfg.max_session_hours * 3600000) {
    return { code: 'too_long', text: `Session was open longer than ${cfg.max_session_hours} hours` };
  }
  return null;
}
// When the closed session is recorded as having ended: its last sign of life, never later than the allowed length.
export function sessionEndMs(trip, cfg = FT_DEFAULTS) {
  const startMs = Date.parse(trip.start_time) || 0;
  const lastMs = Date.parse(trip.last_point_at || '') || startMs;
  return Math.min(Math.max(lastMs, startMs), startMs + cfg.max_session_hours * 3600000);
}

/* ── stays (dwell time) and timed checkpoints ───────────────────────────── */

const norm = (points) => (points || []).filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Date.parse(p.t))).map(p => ({ lat: Number(p.lat), lng: Number(p.lng), t: p.t, ms: Date.parse(p.t) })).sort((a, b) => a.ms - b.ms);

// A stay = the phone stayed within stop_radius_m of where it stopped. A parked phone stores no new trail points, so the time between
// the fix that arrived at a place and the first fix that left it IS the stay. Minutes the phone was silent inside the stay are
// reported separately (silent_minutes) so a dead phone is not mistaken for someone sitting still.
// fences: [{ name, latitude, longitude, geofence_radius }] — a stay inside one is an office stay and is never flagged as "too long".
export function detectStops(points, gaps, win, fences = [], cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const pts = norm(points);
  if (pts.length < 1) return [];
  const out = [];
  const flush = (cluster, endMs) => {
    const first = cluster[0], lastP = cluster[cluster.length - 1];
    const from = first.ms, to = Math.max(endMs, lastP.ms);
    const minutes = Math.round((to - from) / 60000);
    if (minutes < cfg.stop_min_minutes) return;
    const lat = cluster.reduce((a, p) => a + p.lat, 0) / cluster.length, lng = cluster.reduce((a, p) => a + p.lng, 0) / cluster.length;
    let silent = 0;
    for (const g of gaps || []) {
      const gf = Date.parse(g.from), gt = Date.parse(g.to);
      if (g.kind === 'silent' || g.kind === 'offline_now') silent += Math.max(0, Math.min(to, gt) - Math.max(from, gf));
    }
    const fence = (fences || []).find(f => Number.isFinite(Number(f.latitude)) && havM({ lat, lng }, { lat: Number(f.latitude), lng: Number(f.longitude) }) <= Number(f.geofence_radius || f.radius_m || 0) + 50);
    const silentMin = Math.round(silent / 60000);
    out.push({
      lat, lng, from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes,
      silent_minutes: Math.min(silentMin, minutes), verified_minutes: Math.max(0, minutes - silentMin),
      place: fence?.name || '', at_office: !!fence,
      long: !fence && minutes >= cfg.long_stop_minutes,
    });
  };
  let cluster = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const anchor = cluster[0];
    if (havM(anchor, pts[i]) <= cfg.stop_radius_m) { cluster.push(pts[i]); continue; }
    flush(cluster, cluster[cluster.length - 1].ms);
    cluster = [pts[i]];
  }
  // the last cluster runs to the end of the session (or to now, while it is still open and the phone is alive)
  const endMs = Number.isFinite(win?.endMs) ? win.endMs : cluster[cluster.length - 1].ms;
  const lastMs = cluster[cluster.length - 1].ms;
  flush(cluster, win?.open ? Math.max(lastMs, Math.min(Number.isFinite(win.liveMs) ? win.liveMs : lastMs, endMs)) : endMs);
  return out;
}

// A timed checkpoint every checkpoint_minutes from the start of the session: where the phone was then and the km travelled so far.
export function checkpoints(points, startMs, endMs, cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const pts = norm(points);
  if (!pts.length || !Number.isFinite(startMs)) return [];
  const step = cfg.checkpoint_minutes * 60000;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + havM(pts[i - 1], pts[i]));
  const out = [];
  const last = Math.min(Number.isFinite(endMs) ? endMs : pts[pts.length - 1].ms, pts[pts.length - 1].ms);
  for (let t = startMs + step, n = 1; t <= last && n <= 200; t += step, n++) {
    let idx = -1;
    for (let i = 0; i < pts.length; i++) { if (pts[i].ms <= t) idx = i; else break; }
    if (idx < 0) continue;                                    // nothing recorded yet at that time
    out.push({ n, at: new Date(t).toISOString(), lat: pts[idx].lat, lng: pts[idx].lng, km: Math.round(cum[idx] / 10) / 100, fix_at: pts[idx].t });
  }
  return out;
}

// One day for one employee, flattened for lists and reports.
export function daySummary(route) {
  const segs = route?.segments || [];
  const flat = segs.flatMap(s => s.points);
  return {
    sessions: segs.length,
    distance_km: route?.distance_km || 0, estimated_km: route?.estimated_km || 0,
    start: segs[0]?.start_time || null, end: segs.length ? (segs[segs.length - 1].end_time || null) : null,
    duration_min: route?.duration_min || 0,
    points: flat.length, gaps: (route?.gaps || []).length, gap_minutes: route?.gap_minutes_total || 0,
    stops: (route?.stops || []).length, long_stops: (route?.stops || []).filter(s => s.long).length, longest_stop_min: route?.longest_stop_min || 0,
    checkpoints: (route?.checkpoints || []).length,
  };
}

/* ── tracking follows OD attendance ─────────────────────────────────────── */

// What to do with one employee's field session given today's attendance. Tracking begins at OD check-in and ends at OD check-out.
//   start: OD checked in (session in progress) and no session is running            -> open one
//   stop:  a session that OD attendance opened (not a gate-pass one) and the OD day is checked out / gone -> close it
export function attendanceSyncAction({ eligible, attendance, activeTrip }) {
  const od = !!attendance && (attendance.selfie_reason === 'od' || attendance.status === 'on_duty');
  const inProgress = od && attendance.is_in_progress === true;
  if (!activeTrip) return eligible && inProgress ? { action: 'start' } : { action: 'none' };
  const odTrip = activeTrip.source === 'od_attendance' || activeTrip.duty_basis === 'od_attendance' || !!activeTrip.linked_attendance_id;
  if (!odTrip) return { action: 'none' };                                   // a gate-pass / manual trip follows its own end
  if (!od) return { action: 'stop', reason: 'OD attendance no longer applies' };
  if (!inProgress) return { action: 'stop', reason: 'OD check-out' };
  return { action: 'none' };
}

/* ── the server's clock decides every time; a phone's clock is only used to measure intervals ───────────── */

// How far the phone's clock is from the server's, measured at upload: the phone sends its own "now" with each upload.
// Anything the phone reports (fix times) is shifted by this, so a phone running minutes or hours fast/slow, or deliberately changed,
// still lands on the true time. null = unusable (missing, or off by more than 12 h: then nothing is shifted and the usual
// stale / future checks refuse what does not fit).
export function clockOffsetMs(deviceNowIso, serverNowMs, maxMs = 12 * 3600000) {
  const d = Date.parse(deviceNowIso);
  if (!Number.isFinite(d)) return null;
  const off = serverNowMs - d;
  if (Math.abs(off) < CLOCK_TOLERANCE_MS) return 0;      // that much is upload delay, not a wrong clock: shifting would blur the fix times
  return Math.abs(off) <= maxMs ? off : null;
}

export function correctPointTimes(points, offsetMs) {
  if (offsetMs == null || !Array.isArray(points)) return points;
  return points.map(p => {
    const ms = Date.parse(p?.t);
    return Number.isFinite(ms) ? { ...p, t: new Date(ms + offsetMs).toISOString() } : p;
  });
}

// When did a geofence crossing happen? Never the phone's clock: the phone reports when it crossed and what its own clock read when it
// uploaded; the difference is how long ago it was (right even if the clock is wrong, as long as it did not change in between), and the
// server subtracts that from ITS time of receipt. No device_now (an older app) = the crossing counts as happening at receipt.
export function geofenceEventTime({ occurred_at, device_now }, serverNowMs) {
  const occ = Date.parse(occurred_at), dev = Date.parse(device_now);
  if (!Number.isFinite(occ) || !Number.isFinite(dev)) return { ms: serverNowMs, fromDevice: false, ageMs: 0 };
  const ageMs = Math.max(0, dev - occ);
  return { ms: serverNowMs - ageMs, fromDevice: true, ageMs };
}

/* ── trail accuracy: spikes, final distance, fix-quality statistics ─────── */

// A GPS spike is one fix that jumps away and straight back (urban canyons, reflections): A -> B -> C where B is far from both
// neighbours but A and C are close together, all within two minutes. It adds distance that was never travelled. A real out-and-back
// (a turn-around, a stop at a far point) has a long time gap or a stop at B, so it is never touched.
// Metres from B to the straight line A-C (local flat-earth projection; fine at these distances).
function lineDeviationM(A, B, C) {
  const kx = 111195 * Math.cos(A.lat * Math.PI / 180), ky = 111195;
  const bx = (B.lng - A.lng) * kx, by = (B.lat - A.lat) * ky, cx = (C.lng - A.lng) * kx, cy = (C.lat - A.lat) * ky;
  const len = Math.hypot(cx, cy);
  return len === 0 ? Math.hypot(bx, by) : Math.abs(bx * cy - by * cx) / len;
}

export function cleanTrail(points) {
  const pts = (points || []).filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Date.parse(p.t)));
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = out[out.length - 1], B = pts[i], C = pts[i + 1];
    const dAB = havM(A, B), dBC = havM(B, C), dAC = havM(A, C);
    const dt = Math.abs(Date.parse(C.t) - Date.parse(A.t));
    // either an out-and-back (A and C close together), or - while moving - a fix with a poor error radius that sits well off the line A-C
    const outAndBack = dAC < 0.5 * Math.min(dAB, dBC);
    const offLine = Number(B.acc) >= 15 && dAB + dBC > 1.25 * dAC + 40 && lineDeviationM(A, B, C) > 60;
    const spike = dt <= 120000 && dAB > 30 && dBC > 30 && (outAndBack || offLine) && !B.g && !C.g;
    if (!spike) out.push(B);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// When a session ends its distance is recomputed from the cleaned trail. It can only go DOWN by removing spikes (never inflate), and
// a cleanup that would remove more than 25% is not trusted: the stored figure stays and the session is flagged for review.
export function finalizeTrip(trip) {
  const pts = (trip?.points || []);
  if (pts.length < 3 || !(trip.distance_km > 0)) return trip;
  const cleanKm = pathDistanceM(cleanTrail(pts)) / 1000;
  const rawKm = trip.distance_km;
  if (cleanKm >= rawKm * 0.999) return { ...trip, distance_raw_km: rawKm };
  if (cleanKm >= rawKm * 0.75) return { ...trip, distance_raw_km: rawKm, distance_km: Math.round(cleanKm * 100) / 100, spike_km_removed: Math.round((rawKm - cleanKm) * 100) / 100 };
  return { ...trip, distance_raw_km: rawKm, distance_review: true };
}

// How good the recorded fixes were (reported error radius in metres): median, 90th percentile and the share within 20 m.
export function accuracyStats(accs) {
  const a = (accs || []).map(Number).filter(n => Number.isFinite(n) && n >= 0).sort((x, y) => x - y);
  if (!a.length) return { n: 0, median_m: null, p90_m: null, good_pct: null };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { n: a.length, median_m: Math.round(q(0.5)), p90_m: Math.round(q(0.9)), good_pct: Math.round(a.filter(x => x <= 20).length / a.length * 100) };
}

// How far outside a fence boundary an arrival may be reported from: half the fix error (capped) plus a small fixed slack.
export function geofenceAllowedM(radiusM, accuracyM, cfg = FT_DEFAULTS) {
  return Number(radiusM) + Math.min(Number(accuracyM) || 0, cfg.geofence_max_accuracy_m) * 0.5 + cfg.geofence_slack_m;
}

// Is this device token cancelled? data = { floors: {userId: ms}, dids: {deviceId: expiresMs} } (see deviceTokens.js).
// A phone's own token is cancelled by its device id; every token of a person issued before the person's floor time is cancelled too.
export function tokenRevoked(data, decoded, nowMs = Date.now()) {
  if (!decoded) return true;
  const d = data || {};
  if (decoded.did && d.dids && d.dids[String(decoded.did)] && d.dids[String(decoded.did)] > nowMs) return true;
  const floor = d.floors && d.floors[decoded.id];
  return !!floor && Number(decoded.iat) * 1000 < floor;
}

/* ── late uploads ───────────────────────────────────────────────────────── */

export const MAX_UPLOAD = 6000;             // the phone's whole offline queue; nothing it recorded is cut off
const CLOCK_TOLERANCE_MS = 15000;

function lowerBound(list, ms) { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].tMs < ms) lo = m + 1; else hi = m; } return lo; }

// null = this late fix can be inserted; otherwise the name of the rule that refuses it. 'out_of_order' = already have that moment.
function lateFixProblem(p, trail, cfg) {
  if (p.acc > cfg.max_accuracy_m) return 'accuracy';
  const i = lowerBound(trail, p.tMs), before = trail[i - 1], after = trail[i];
  for (const n of [before, after]) {
    if (!n) continue;
    const dt = Math.abs(p.tMs - n.tMs) / 1000;
    if (dt < cfg.min_interval_s || (dt < 60 && havM(n, p) < 3)) return 'out_of_order';
    if (havM(n, p) / Math.max(dt, 1) * 3.6 > cfg.max_speed_kmh) return 'speed';
  }
  return null;
}

// Puts late fixes into their place in the trail and works the distance and gaps out again over the whole path.
export function backfillTrail(trip, late, nowMs) {
  if (!late || !late.length) return trip;
  const merged = [...(trip.points || []), ...late].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const re = processPoints({ ...trip, points: [], stats: undefined, distance_km: 0, point_count: 0, last_pos: null }, merged, nowMs).trip;
  const stats = { ...re.stats };
  for (const k of ['rej_accuracy', 'rej_jump', 'rej_still']) stats[k] = (trip.stats?.[k] || 0) + (stats[k] || 0);
  return { ...trip, points: re.points, distance_km: re.distance_km, point_count: re.point_count, stats, rev: (trip.rev || 0) + 1 };
}

/* ── when was the employee at a point on the map? ───────────────────────── */

// nearest position on the segment a-b to p, as a fraction 0..1, with the distance in metres (local flat projection)
function projectOnSegment(p, a, b) {
  const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const f = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return { f, d: Math.hypot(ax + f * dx, ay + f * dy), lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

// trips: one employee's sessions for a day. Returns every pass within radiusM of the clicked point, oldest first. The time is
// interpolated between the two recorded fixes either side of that spot and says how far it can be trusted:
//   precise       fixes at most 30 s apart
//   interpolated  further apart: constant speed between them is assumed
//   stayed        the phone did not move between two fixes: the employee was there for the whole of from..to
//   gap           nothing was recorded across this stretch: only "some time between from and to" is known
export function timeAtPoint(trips, click, radiusM, cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const p = { lat: Number(click?.lat), lng: Number(click?.lng) };
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return { visits: [], radius_m: 0 };
  const radius = Math.min(300, Math.max(15, Number(radiusM) || 40));
  const visits = [], gapHits = [];
  for (const tr of [...(trips || [])].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))) {
    const pts = cleanTrail([...(tr.points || [])].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))).map(q => ({ ...q, ms: Date.parse(q.t) }));
    if (!pts.length) continue;
    const beats = (tr.beats || []).map(b => Date.parse(b));
    const lp = tr.last_pos, tail = pts[pts.length - 1];
    if (lp && Date.parse(lp.t) > tail.ms && havM(tail, lp) < 40) pts.push({ ...lp, ms: Date.parse(lp.t) });    // still standing there (heartbeats)
    const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
    let run = null;
    const close = () => { if (run) visits.push(finishVisit(run, p, tr.id)); run = null; };
    segs.forEach(([a, b], i) => {
      const dt = (b.ms - a.ms) / 1000, moved = havM(a, b), pr = projectOnSegment(p, a, b);
      const silent = dt > cfg.gap_minutes * 60 && (b.g === 1 || moved >= 40 || !beats.some(x => x > a.ms + 30000 && x < b.ms - 30000));
      const kind = moved < 40 && dt > 60 && !silent ? 'stayed' : silent || (b.g === 1 && dt > 120) ? 'gap' : dt <= 30 ? 'precise' : 'interpolated';
      if (pr.d > radius) {
        if (kind === 'gap' && havM(a, p) + havM(p, b) <= 1.3 * moved + 300) gapHits.push(finishVisit([{ i, a, b, dt, kind, pr }], p, tr.id));
        close(); return;
      }
      const hit = { i, a, b, dt, kind, pr };
      if (run && a.ms - run[run.length - 1].b.ms <= 60000) run.push(hit); else { close(); run = [hit]; }
    });
    close();
  }
  const out = visits.length ? visits : gapHits;
  return { radius_m: radius, visits: out.sort((x, y) => x.at.localeCompare(y.at)) };
}

function finishVisit(run, p, tripId) {
  const best = run.reduce((m, h) => (h.pr.d < m.pr.d ? h : m), run[0]);
  const timeAt = (h) => Math.round(h.a.ms + (h.b.ms - h.a.ms) * h.pr.f);
  const stay = run.filter(h => h.kind === 'stayed');
  const uncertain = best.kind === 'gap';
  const fromMs = uncertain ? best.a.ms : stay.length ? Math.min(stay[0].a.ms, timeAt(run[0])) : timeAt(run[0]);
  const toMs = uncertain ? best.b.ms : stay.length ? Math.max(stay[stay.length - 1].b.ms, timeAt(run[run.length - 1])) : timeAt(run[run.length - 1]);
  const kind = uncertain ? 'gap' : stay.length && toMs - fromMs >= 120000 ? 'stayed' : best.kind === 'stayed' ? 'interpolated' : best.kind;
  const near = havM(best.a, p) <= havM(best.b, p) ? best.a : best.b;
  const at = timeAt(best);
  return {
    trip_id: tripId, kind, at: new Date(at).toISOString(), from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
    uncertainty_s: uncertain ? Math.round(best.dt / 2) : Math.max(1, Math.round(Math.min(at - best.a.ms, best.b.ms - at) / 1000)),
    distance_m: Math.round(best.pr.d), lat: best.pr.lat, lng: best.pr.lng,
    nearest_fix: { t: new Date(near.ms).toISOString(), lat: near.lat, lng: near.lng, acc: Math.round(Number(near.acc) || 0), distance_m: Math.round(havM(near, p)) },
  };
}

/* ── is each eligible employee actually sending data? ───────────────────── */

// { state, text } for one eligible employee: trip = the open session (or null), device = the phone's last status report (or null).
export function sendingStatus({ trip, device, hasAndroidApp }, nowMs, cfgIn) {
  const cfg = cfgIn || FT_DEFAULTS;
  const probs = device?.problems || [];
  const web = device?.platform === 'web';
  const fix = !device && !hasAndroidApp ? 'has never opened Maxvolt One on a phone'
    : probs.includes('location_denied') ? 'location permission is off' + (web ? ' (using the website, not the app)' : '')
    : probs.includes('gps_off') ? 'GPS is switched off'
    : probs.includes('background_location_denied') ? 'location is not "Allow all the time"'
    : probs.includes('battery_restricted') ? 'battery optimisation is on'
    : web && !hasAndroidApp ? 'uses the website: it cannot record once the screen is off (needs the app)'
    : '';
  if (!trip) return { state: 'off_duty', text: fix ? 'Not on duty · ' + fix : 'Not on duty', attention: !!fix };
  const heard = Date.parse(trip.last_point_at);
  if (Number.isFinite(heard) && nowMs - heard <= cfg.live_stale_minutes * 60000 && (trip.points || []).length) return { state: 'sending', text: 'Sending location', attention: false };
  const age = Number.isFinite(heard) ? Math.round((nowMs - heard) / 60000) : null;
  return {
    state: 'not_sending', attention: true,
    text: (age == null ? 'On duty, nothing received' : 'On duty, nothing for ' + (age >= 60 ? Math.floor(age / 60) + ' h ' + (age % 60) + ' min' : age + ' min')) + ' · ' + (fix || 'ask them to open the app (Android may have stopped it)'),
  };
}
