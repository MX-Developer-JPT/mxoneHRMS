// "Roaster" holiday — a leave type for employees posted at the Duhai location.
//   • one Roaster is credited to every active Duhai employee each calendar month (cron/roasterAutomation.js),
//     except the Production, Testing, Quality and Finance & Accounts departments
//   • it can only be taken on a single Saturday of the month it was credited for, never a half day, at most once a month
//   • an unused credit lapses when the next month's one is credited
// The same rules are checked when the employee applies (validateLeaveApplication) and again by the
// generic Leave route (entities.js), so no client can get around them.
export const ROASTER_CODE = 'ROASTER';
export const ROASTER_NAME = 'Roaster';
export const ROASTER_LOCATION = 'duhai';
const INACTIVE_LEAVE = new Set(['rejected', 'cancelled', 'withdrawn']);

export const ROASTER_EXCLUDED_DEPARTMENTS = ['PRODUCTION', 'TESTING', 'QUALITY', 'FINANCE & ACCOUNTS'];
export const isDuhai = (emp) => String(emp?.work_location || '').trim().toLowerCase() === ROASTER_LOCATION;
export const isExcludedDepartment = (emp) => ROASTER_EXCLUDED_DEPARTMENTS.includes(String(emp?.department || '').trim().toUpperCase());
export const isRoasterEligible = (emp) => isDuhai(emp) && !isExcludedDepartment(emp);
export const isRoasterPolicy = (policy) => !!policy && (policy.code === ROASTER_CODE || policy.name === ROASTER_NAME);

const dayOfWeek = (ds) => new Date(String(ds).slice(0, 10) + 'T00:00:00Z').getUTCDay();
export const isSaturday = (ds) => !!ds && dayOfWeek(ds) === 6;

// Returns a list of plain-language errors; empty means the application follows the Roaster rules.
// `existing` = the employee's other Leave rows for this policy (the one being edited must be left out).
export const istMonth = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 7);

export function roasterErrors({ emp, start_date, end_date, half_day, existing = [], nowMonth = istMonth() }) {
  const errors = [];
  if (!isDuhai(emp)) errors.push('Roaster holiday is only available to employees working at the Duhai location.');
  else if (isExcludedDepartment(emp)) errors.push('Roaster holiday is not applicable to your department.');
  const s = String(start_date || '').slice(0, 10), e = String(end_date || start_date || '').slice(0, 10);
  if (s !== e) errors.push('Roaster holiday is for one day only — pick a single Saturday.');
  if (!isSaturday(s)) errors.push('Roaster holiday can only be taken on a Saturday.');
  if (half_day) errors.push('Roaster holiday is a full day — half days are not allowed.');
  const month = s.slice(0, 7);
  if (month && month !== nowMonth) errors.push('Roaster holiday is credited month by month — it can only be taken on a Saturday of the current month.');
  if (month && existing.some(l => !INACTIVE_LEAVE.has(l.status) && String(l.start_date || '').slice(0, 7) === month)) {
    errors.push('You already have a Roaster holiday in this month — only one can be taken per month.');
  }
  return errors;
}
