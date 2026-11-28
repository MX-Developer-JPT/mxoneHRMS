// On Duty (OD) attendance follows the same rules as biometric attendance from this date: the day's status comes from the
// punches (Present shown as On Duty, Late, Half Day, Short Attendance, Absent), and a day left without a check-out is
// Absent. Earlier days keep the status they were given. Work From Home is not covered and is unchanged.
// On every kind of day, when there are several sessions and only the last one is left open, that last check-in is the day's
// check-out and the day is judged on its completed sessions (see closeTrailingOpenSession).
export const OD_RULES_FROM = '2026-11-28';
export const LAST_SESSION_RULE_FROM = '2026-11-28';
/**
 * Is a WFH / OD day that was left open absent? Yes when its only session was never closed. With an earlier session, the last
 * check-in counts as the check-out (days before the rule date stay absent as before).
 */
export const absentForNoCheckout = (date, sessionCount) => !(String(date || '').slice(0, 10) >= LAST_SESSION_RULE_FROM && sessionCount > 1);

export const isRuledOd = (r) => r?.selfie_reason === 'od' && !(r.date && String(r.date).slice(0, 10) < OD_RULES_FROM);
