// What an attendance day is without a regularisation request (pure: the attendance engine is passed in).
import { isRuledOd, absentForNoCheckout } from './odRules.js';

export const APPLIED_STATUSES = ['manager_approved', 'completed', 'approved'];
const REG_FIELDS = ['regularised', 'regularisation_id', 'pre_regularisation', 'created_by_regularisation', 'original_punches'];
const strip = (d) => { const x = { ...d }; for (const k of REG_FIELDS) delete x[k]; return x; };

/** The copy of a day kept at approval, so that deleting the request can put it back. A later request keeps the first copy. */
export const snapshotBefore = (att) => (att.regularised ? att.pre_regularisation : strip(att));

/** Did this request set the attendance of the day? */
export const ownsDay = (att, reg) => !!att && !!att.regularised && (att.regularisation_id ? att.regularisation_id === reg.id : APPLIED_STATUSES.includes(reg.status));

export const summary = (d) => ({ status: d.status || '', check_in_time: d.check_in_time || null, check_out_time: d.check_out_time || null, regularised: !!d.regularised });

// a status someone set on purpose, which punches must not overwrite
const isSetByHand = (d) => !!(d.admin_marked || d.status === 'leave' || (d.leave_id && !d.leave_half_day) || d.attendance_exempt
  || /^imported from muster/i.test(String(d.notes || '')) || (!isRuledOd(d) && ['holiday', 'week_off', 'weekly_off', 'on_leave'].includes(d.status)));

function merge(lists) {
  const out = [];
  for (const p of lists.flat().filter((x) => x?.time).sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
    if (!out.some((q) => Math.abs(Date.parse(q.time) - Date.parse(p.time)) < 1000)) out.push({ time: p.time, device_direction: p.device_direction || 'IN' });
  }
  return out;
}

// times on a day saved before copies were kept that the request did not supply, so they were really recorded
function keptTimes(att, reg) {
  const out = [];
  if (!reg.requested_check_in && att.check_in_time) out.push({ time: att.check_in_time, device_direction: 'IN' });
  if (!reg.requested_check_out && att.check_out_time) out.push({ time: att.check_out_time, device_direction: 'OUT' });
  return out;
}

/**
 * Returns { action: 'restored' | 'removed' | 'kept', day, note }. `day` null means the day has no record without the request.
 * `punches` are the machine punches logged for the day; `past` closes a session that was never checked out.
 */
export function dayWithoutRegularisation(att, reg, punches, { past, engine }) {
  const saved = att.pre_regularisation;
  // an admin edit or full-day leave made after the approval stands
  if ((att.admin_marked && !saved?.admin_marked) || att.status === 'leave' || (att.leave_id && !att.leave_half_day)) {
    return { action: 'kept', day: strip(att), note: 'The day was edited by an admin or is covered by leave, so its attendance stays. Only the regularisation mark is removed.' };
  }
  const base = saved || (att.created_by_regularisation ? null : strip(att));
  const recorded = merge([
    saved ? saved.raw_punches || [] : att.original_punches || [],
    saved ? [saved.check_in_time && { time: saved.check_in_time, device_direction: 'IN' }, saved.check_out_time && { time: saved.check_out_time, device_direction: 'OUT' }] : att.created_by_regularisation ? [] : keptTimes(att, reg),
    att.biometric_punches || [], punches,
  ]);
  if (saved && isSetByHand(saved)) return { action: 'restored', day: { ...saved, ...(recorded.length ? { biometric_punches: recorded } : {}) }, note: 'The day goes back to what it was before the approval.' };
  if (!recorded.length) {
    return saved ? { action: 'restored', day: saved, note: 'The day goes back to what it was before the approval.' }
      : { action: 'removed', day: null, note: 'No punch was recorded that day. The record made by the request is removed; a past working day then shows Absent.' };
  }
  const seed = { ...(base || { id: att.id, user_id: att.user_id, date: att.date, source: 'biometric' }) };
  // flags that described the corrected times, or an earlier closing of the day, are worked out afresh
  for (const k of ['sessions', 'punch_sessions', 'check_in_time', 'check_out_time', 'auto_closed', 'auto_closed_at', 'auto_closed_reason', 'auto_closed_no_checkout', 'biometric_punches', 'working_hours', 'total_working_minutes']) delete seed[k];
  let sd = engine.buildSessions(recorded);
  const open = past && sd.is_in_progress;
  if (open) sd = engine.closeTrailingOpenSession(recorded);
  const judged = engine.applyDeclaredStatus(seed, engine.applyHalfDayLeaveStatus(seed, sd, engine.compute(sd)));
  // Work From Home / On Duty never checked out of is absent; with an earlier session the last check-in is the check-out
  const noCheckout = open && ['wfh', 'od'].includes(seed.selfie_reason) && absentForNoCheckout(seed.date, sd.sessions.length);
  const day = { ...seed, ...sd, ...judged, ...(noCheckout ? { status: 'absent', auto_closed_no_checkout: true, late_minutes: 0, late_arrival: false, late_arrival_minutes: 0 } : {}) };
  if (sd.is_in_progress) day.check_out_time = null;
  return { action: 'restored', day, note: saved ? 'The day goes back to its recorded punches.' : 'This approval is from before copies were kept, so the day is worked out again from the recorded punches.' };
}

/** Applies another approved request on top of the restored day. */
export function applyRequest(day, reg, times, engine) {
  const { check_in_time, check_out_time } = times;
  const punches = [check_in_time && { time: check_in_time, device_direction: 'IN' }, check_out_time && { time: check_out_time, device_direction: 'OUT' }].filter(Boolean);
  const { check_in_time: _in, check_out_time: _out, ...fields } = engine.buildSessions(punches);
  return {
    ...day, ...fields, pre_regularisation: day.created_by_regularisation ? undefined : strip(day), status: reg.requested_status || 'present', regularised: true, regularisation_id: reg.id,
    check_in_time, check_out_time, early_departure: false, early_departure_minutes: 0, late_arrival: false, late_minutes: 0, late_arrival_minutes: 0, overtime_minutes: 0,
  };
}
