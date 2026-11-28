// The one overtime calculation used everywhere (attendance screens, Overtime reports, attendance report, salary sheet).
// Pure: no database access.
import { isLeaver, lastWorkingDay, ymd } from './leavers.js';

export const DEFAULT_POLICY = {
  eligible_only: true,        // only employees marked "overtime eligible" earn overtime
  min_minutes: null,          // extra time needed before a working day counts; null = the shift's grace period
  round_to_minutes: 1,        // counted overtime is rounded down to this block
  off_day_all_hours: true,    // on a weekly off or holiday every worked minute is overtime
  max_day_hours: 16,          // a longer day is almost always a punch error: listed for checking, not counted
  multiplier: 2,              // pay rate multiplier (Payroll Settings)
};
export function cleanPolicy(p = {}) {
  const num = (v, d, lo, hi) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };
  return {
    eligible_only: p.eligible_only !== false,
    min_minutes: p.min_minutes === null || p.min_minutes === undefined || p.min_minutes === '' ? null : num(p.min_minutes, null, 0, 600),
    round_to_minutes: num(p.round_to_minutes, 1, 1, 60),
    off_day_all_hours: p.off_day_all_hours !== false,
    max_day_hours: num(p.max_day_hours, 16, 8, 24),
    multiplier: num(p.multiplier, 2, 0, 10),
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SIX_DAYS = WEEKDAYS.slice(1);
const stamp = (v) => {
  if (!v) return NaN;
  const s = String(v).trim().replace(' ', 'T');
  return Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
};
const clockMins = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Standard working minutes of a shift: its configured working hours, else its timings (overnight aware), else 9 hours. */
export function standardMinutes(shift) {
  if (Number(shift?.working_hours) > 0) return Math.round(Number(shift.working_hours) * 60);
  const a = clockMins(shift?.start_time), b = clockMins(shift?.end_time);
  if (a !== null && b !== null && a !== b) return (b - a + 1440) % 1440;
  return 540;
}

/**
 * Worked time from the punches themselves: every completed in/out pair, overlaps and repeats merged so no minute is
 * counted twice. An "in" without an "out" adds nothing and is reported as a missing punch.
 */
export function workedFromPunches(rec) {
  const pair = (a, b) => ({ a: stamp(a), b: stamp(b), hasIn: !!a, hasOut: !!b });
  let list = (rec.sessions?.length ? rec.sessions.map((s) => pair(s.check_in, s.check_out))
    : (rec.punch_sessions || []).map((s) => pair(s.punch_in, s.punch_out)));
  const whole = pair(rec.check_in_time, rec.check_out_time);
  // a day corrected by hand may keep stale sessions: when its first-in / last-out no longer match, the corrected pair wins
  if (list.length && rec.admin_marked && whole.hasIn && whole.hasOut) {
    const first = Math.min(...list.map((x) => x.a).filter(Number.isFinite)), last = Math.max(...list.map((x) => x.b).filter(Number.isFinite));
    if (Math.abs(first - whole.a) > 60000 || Math.abs(last - whole.b) > 60000) list = [whole];
  }
  if (!list.length) list = whole.hasIn || whole.hasOut ? [whole] : [];
  const good = list.filter((x) => Number.isFinite(x.a) && Number.isFinite(x.b) && x.b > x.a).sort((x, y) => x.a - y.a);
  let total = 0, end = -Infinity;
  for (const x of good) { const from = Math.max(x.a, end); if (x.b > from) total += x.b - from; end = Math.max(end, x.b); }
  const missing = list.some((x) => (x.hasIn !== x.hasOut) || (x.hasIn && x.b <= x.a));
  return { minutes: Math.floor(total / 60000), punches: list.length, missing, firstIn: good[0]?.a, lastOut: good.length ? Math.max(...good.map((x) => x.b)) : undefined };
}

export function dayType(date, shift, holiday) {
  if (holiday && !holiday.is_half_day && !['optional', 'restricted'].includes(String(holiday.type || '').toLowerCase())) return 'holiday';
  const days = Array.isArray(shift?.days) && shift.days.length ? shift.days : SIX_DAYS;
  if (!days.includes(WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()])) return 'weekly_off';
  return holiday?.is_half_day ? 'half_holiday' : 'working';
}

/** Overtime of one attendance day. */
export function overtimeForDay({ record, shift, holiday, employee, policy = DEFAULT_POLICY }) {
  const date = ymd(record.date);
  const type = dayType(date, shift, holiday);
  const w = workedFromPunches(record);
  let standard = standardMinutes(shift);
  if (type === 'half_holiday') standard = Number(holiday.half_day_hours) > 0 ? Math.round(Number(holiday.half_day_hours) * 60) : Math.round(standard / 2);
  if (type === 'holiday' || type === 'weekly_off') standard = policy.off_day_all_hours ? 0 : standard;
  const eligible = !policy.eligible_only || !!employee?.overtime_eligible;
  const notes = [];
  let ot = 0, check = false;
  if (w.missing) notes.push('Missing punch: only completed in/out pairs are counted');
  if (record.auto_closed) notes.push('Day was closed automatically (no check-out)');
  const outside = (employee?.date_of_joining && date < ymd(employee.date_of_joining)) || (employee && isLeaver(employee) && lastWorkingDay(employee) && date > lastWorkingDay(employee));
  if (['absent', 'leave'].includes(record.status)) {
    if (w.minutes > 0) notes.push(`Marked ${record.status}: not counted`);
  } else if (outside) {
    notes.push('Outside employment dates: not counted');
  } else if (w.minutes > policy.max_day_hours * 60) {
    check = true; notes.push(`${(w.minutes / 60).toFixed(1)} hours in one day: check the punches (not counted)`);
  } else if (eligible) {
    const extra = w.minutes - standard;
    const needed = policy.min_minutes ?? Number(shift?.grace_period_minutes ?? 15);
    if (extra > 0 && extra >= needed) ot = Math.floor(extra / policy.round_to_minutes) * policy.round_to_minutes;
  }
  return { date, day_type: type, worked_minutes: w.minutes, standard_minutes: standard, ot_minutes: ot, eligible, check, missing_punch: w.missing, first_in: w.firstIn, last_out: w.lastOut, notes: notes.join('; ') };
}

export const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;
/** Pay for a month's overtime: basic / 26 days / 8 hours, times the policy multiplier. */
export const otAmount = (basicMonthly, minutes, multiplier) => Math.round((Number(basicMonthly || 0) / 26 / 8) * multiplier * (minutes / 60));

const score = (r) => (r.regularised ? 16 : 0) + (r.admin_marked ? 8 : 0) + (r.biometric_synced ? 4 : 0) + (r.check_in_time ? 2 : 0) + (r.status && r.status !== 'absent' ? 1 : 0);

/**
 * Every figure of an overtime report from raw data. One record per employee per day (duplicates never add up twice);
 * day, month, department and employee totals are all sums of the same daily minutes.
 */
export function buildOvertimeReport({ records, employees, shiftById, defaultShift, holidayByDate, basicByUser = {}, policy }) {
  const byUser = new Map(employees.filter((e) => e.user_id).map((e) => [e.user_id, e]));
  const best = new Map();
  for (const r of records) {
    if (!r.user_id || !byUser.has(r.user_id) || !ymd(r.date)) continue;
    const k = `${r.user_id}|${ymd(r.date)}`, p = best.get(k);
    if (!p || score(r) > score(p) || (score(r) === score(p) && String(r.check_in_time || '~') < String(p.check_in_time || '~'))) best.set(k, r);
  }
  const days = [], checks = [];
  for (const r of best.values()) {
    const e = byUser.get(r.user_id);
    const shift = shiftById[e.shift_id] || defaultShift || {};
    const d = overtimeForDay({ record: r, shift, holiday: holidayByDate[ymd(r.date)], employee: e, policy });
    const row = { ...d, user_id: r.user_id, employee_code: e.employee_code || '', employee_name: e.display_name || '', department: e.department || 'Unassigned', designation: e.designation || '', shift: shift.name || '' };
    if (row.ot_minutes > 0) days.push(row);
    if (row.eligible && (row.check || (row.missing_punch && !['absent', 'leave'].includes(r.status)))) checks.push(row);
  }
  const order = (a, b) => a.date.localeCompare(b.date) || a.department.localeCompare(b.department) || a.employee_name.localeCompare(b.employee_name);
  days.sort(order); checks.sort(order);

  const months = new Map();
  for (const d of days) {
    const k = `${d.user_id}|${d.date.slice(0, 7)}`;
    const m = months.get(k) || { user_id: d.user_id, month: d.date.slice(0, 7), employee_code: d.employee_code, employee_name: d.employee_name, department: d.department, designation: d.designation, ot_days: 0, ot_minutes: 0, off_day_minutes: 0 };
    m.ot_days++; m.ot_minutes += d.ot_minutes;
    if (d.day_type === 'holiday' || d.day_type === 'weekly_off') m.off_day_minutes += d.ot_minutes;
    months.set(k, m);
  }
  const monthRows = [...months.values()].map((m) => ({ ...m, ot_amount: otAmount(basicByUser[m.user_id], m.ot_minutes, policy.multiplier) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.department.localeCompare(b.department) || a.employee_name.localeCompare(b.employee_name));
  const roll = (key, init) => {
    const out = new Map();
    for (const m of monthRows) {
      const k = key(m), x = out.get(k) || { ...init(m), ot_days: 0, ot_minutes: 0, ot_amount: 0, off_day_minutes: 0 };
      x.ot_days += m.ot_days; x.ot_minutes += m.ot_minutes; x.ot_amount += m.ot_amount; x.off_day_minutes += m.off_day_minutes;
      out.set(k, x);
    }
    return [...out.values()];
  };
  const employeeRows = roll((m) => m.user_id, (m) => ({ user_id: m.user_id, employee_code: m.employee_code, employee_name: m.employee_name, department: m.department, designation: m.designation }))
    .sort((a, b) => b.ot_minutes - a.ot_minutes);
  const departments = roll((m) => m.department, (m) => ({ department: m.department, people: new Set() }));
  for (const d of departments) d.employees = new Set(monthRows.filter((m) => m.department === d.department).map((m) => m.user_id)).size;
  const deptRows = departments.map(({ people, ...d }) => d).sort((a, b) => b.ot_minutes - a.ot_minutes);
  return {
    days, months: monthRows, employees: employeeRows, departments: deptRows, checks,
    totals: { ot_minutes: employeeRows.reduce((s, x) => s + x.ot_minutes, 0), ot_amount: employeeRows.reduce((s, x) => s + x.ot_amount, 0), employees: employeeRows.length, ot_days: days.length, checks: checks.length },
  };
}
