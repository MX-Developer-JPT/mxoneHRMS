// "Roaster" holiday — a leave type for employees posted at the Duhai location.
//   • one Roaster is credited to every active Duhai employee each calendar month (cron/roasterAutomation.js)
//   • it can only be taken on a single Saturday, never a half day, and at most one per calendar month
// The same rules are checked when the employee applies (validateLeaveApplication) and again by the
// generic Leave route (entities.js), so no client can get around them.
export const ROASTER_CODE = 'ROASTER';
export const ROASTER_NAME = 'Roaster';
export const ROASTER_LOCATION = 'duhai';
const INACTIVE_LEAVE = new Set(['rejected', 'cancelled', 'withdrawn']);

export const isDuhai = (emp) => String(emp?.work_location || '').trim().toLowerCase() === ROASTER_LOCATION;
export const isRoasterPolicy = (policy) => !!policy && (policy.code === ROASTER_CODE || policy.name === ROASTER_NAME);

const dayOfWeek = (ds) => new Date(String(ds).slice(0, 10) + 'T00:00:00Z').getUTCDay();
export const isSaturday = (ds) => !!ds && dayOfWeek(ds) === 6;

// Returns a list of plain-language errors; empty means the application follows the Roaster rules.
// `existing` = the employee's other Leave rows for this policy (the one being edited must be left out).
export function roasterErrors({ emp, start_date, end_date, half_day, existing = [] }) {
  const errors = [];
  if (!isDuhai(emp)) errors.push('Roaster holiday is only available to employees working at the Duhai location.');
  const s = String(start_date || '').slice(0, 10), e = String(end_date || start_date || '').slice(0, 10);
  if (s !== e) errors.push('Roaster holiday is for one day only — pick a single Saturday.');
  if (!isSaturday(s)) errors.push('Roaster holiday can only be taken on a Saturday.');
  if (half_day) errors.push('Roaster holiday is a full day — half days are not allowed.');
  const month = s.slice(0, 7);
  if (month && existing.some(l => !INACTIVE_LEAVE.has(l.status) && String(l.start_date || '').slice(0, 7) === month)) {
    errors.push('You already have a Roaster holiday in this month — only one can be taken per month.');
  }
  return errors;
}
