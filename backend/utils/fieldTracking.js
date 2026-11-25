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
import { havM } from './fieldTrip.js';

export const FT_DEFAULTS = {
  require_duty_day: true,      // tracking may only start on a day the employee is on approved field duty (OD attendance / official gate pass)
  reject_mock: true,           // reject fixes flagged as mocked / simulated by the phone
  max_accuracy_m: 50,          // a fix less accurate than this is not stored (the very first fix of a trip may be 100 m)
  min_interval_s: 5,           // fixes closer together than this are dropped (battery / flood protection)
  max_speed_kmh: 150,          // an implied speed above this between two fixes is a jump
  max_point_age_h: 12,         // a fix older than this when it arrives is stale (a phone dumping an old buffer)
  max_future_s: 120,           // a fix timestamped later than this ahead of the server clock is rejected
  gap_minutes: 10,             // nothing heard from the phone for this long = tracking gap
  gap_moved_m: 150,            // a gap during which the phone moved at least this far is also counted as estimated distance
  live_stale_minutes: 10,      // a "live" position older than this is shown as offline
  max_batch: 500,              // points accepted in one upload
  snap_to_roads: true,         // draw routes along the road network (needs the OSRM service; display only, never changes distance)
};

const LIMITS = {
  max_accuracy_m: [5, 100], min_interval_s: [1, 120], max_speed_kmh: [30, 300], max_point_age_h: [1, 72],
  max_future_s: [0, 600], gap_minutes: [2, 120], gap_moved_m: [20, 2000], live_stale_minutes: [2, 120], max_batch: [10, 1000],
};

// Anything missing or out of range falls back to the strict default (clamped, never trusted blindly).
export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const cfg = { ...FT_DEFAULTS };
  for (const k of ['require_duty_day', 'reject_mock', 'snap_to_roads']) if (typeof r[k] === 'boolean') cfg[k] = r[k];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(r[k]);
    if (r[k] != null && r[k] !== '' && Number.isFinite(v)) cfg[k] = Math.min(hi, Math.max(lo, v));
  }
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
  const list = Array.isArray(incoming) ? incoming.slice(0, cfg.max_batch) : [];
  const overflow = Array.isArray(incoming) ? Math.max(0, incoming.length - cfg.max_batch) : 0;
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
  const accepted = [];
  for (const p of norm) {
    const mock = p.mock === true || p.simulated === true || p.is_mock === true || p.isFromMockProvider === true;
    if (cfg.reject_mock && mock) { rej.mock++; continue; }
    if (p.tMs > now + cfg.max_future_s * 1000) { rej.future++; continue; }
    if (p.tMs < now - cfg.max_point_age_h * 3600000) { rej.stale++; continue; }
    if (startMs && p.tMs < startMs - 60000) { rej.before_start++; continue; }   // recorded before this session began
    if (!p.hb) {
      const accLimit = last ? cfg.max_accuracy_m : Math.max(cfg.max_accuracy_m, 100);
      if (p.acc > accLimit) { rej.accuracy++; continue; }
      if (last && p.tMs <= last.tMs) { rej.out_of_order++; continue; }
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
  return { accepted, rejected: rej, total, rejectedCount: Object.values(rej).reduce((a, b) => a + b, 0) };
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
export function buildRoute(trips, nowMs, cfgIn, maxPoints = 4000) {
  const cfg = cfgIn || FT_DEFAULTS;
  const sorted = [...(trips || [])].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const segments = [], gaps = [];
  let distanceM = 0, estimatedM = 0, live = null, accepted = 0, rejected = 0;
  for (const tr of sorted) {
    const pts = (tr.points || []).filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Date.parse(p.t))).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const open = tr.status === 'active';
    const startMs = Date.parse(tr.start_time), endMs = open ? nowMs : Date.parse(tr.end_time || tr.last_point_at || tr.start_time);
    const tripGaps = detectGaps(pts, tr.beats, { startMs, endMs, open }, cfg).map(g => ({ ...g, trip_id: tr.id }));
    gaps.push(...tripGaps);
    const dM = pathDistanceM(pts);
    let est = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].g) est += havM(pts[i - 1], pts[i]);
    distanceM += dM; estimatedM += est;
    accepted += tr.stats?.accepted || pts.length;
    rejected += Object.values(tr.rule_stats || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const step = pts.length > maxPoints ? Math.ceil(pts.length / maxPoints) : 1;
    segments.push({
      trip_id: tr.id, status: tr.status, vehicle_type: tr.vehicle_type, purpose: tr.purpose || '', source: tr.source || '',
      start_time: tr.start_time, end_time: tr.end_time || null,
      points: pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => ({ lat: p.lat, lng: p.lng, t: p.t, g: p.g ? 1 : undefined })),
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
