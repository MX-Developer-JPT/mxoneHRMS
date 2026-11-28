// On Duty (OD) attendance follows the same rules as biometric attendance from this date: the day's status comes from the
// punches (Present shown as On Duty, Late, Half Day, Short Attendance, Absent), and a day left without a check-out is
// Absent for the whole day. Earlier days keep the status they were given. Work From Home is not covered and is unchanged.
export const OD_RULES_FROM = '2026-11-28';
export const isRuledOd = (r) => r?.selfie_reason === 'od' && !(r.date && String(r.date).slice(0, 10) < OD_RULES_FROM);
