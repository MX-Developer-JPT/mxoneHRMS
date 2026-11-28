// One person's (or several leavers') attendance history: de-duplication, totals and the Excel workbook. No database access.
import { sheetWithTitle, table } from './xlsxSheet.js';

const score = (r) => (r.regularised ? 16 : 0) + (r.admin_marked ? 8 : 0) + (r.biometric_synced ? 4 : 0) + (r.check_in_time ? 2 : 0) + (r.status && r.status !== 'absent' ? 1 : 0);

/** One record per person per day (same preference as the attendance screens), newest date first. */
export function dedupeAttendance(records) {
  const best = new Map();
  for (const r of records) {
    if (!r.user_id || !r.date) continue;
    const key = `${r.user_id}|${String(r.date).slice(0, 10)}`;
    const prev = best.get(key);
    if (!prev || score(r) > score(prev) || (score(r) === score(prev) && String(r.check_in_time || '~') < String(prev.check_in_time || '~'))) best.set(key, { ...r, date: String(r.date).slice(0, 10) });
  }
  return [...best.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export const CODE = { present: 'P', late: 'P*', absent: 'A', half_day: 'HD', leave: 'L', holiday: 'PH', week_off: 'WO', on_duty: 'OD', work_from_home: 'WFH', short_attendance: 'SA', in_progress: 'IP' };
export const dayCode = (r) => {
  if (r.status === 'half_day' && r.leave_id && r.leave_half_day) return 'PHL';
  if (r.status === 'leave') return r.leave_policy_code || 'L';
  if (r.regularised && (r.status === 'present' || !r.status)) return 'PR';
  return CODE[r.status] || (r.check_in_time ? 'P' : 'A');
};

export function attendanceSummary(records, lastWorkingDate = '') {
  const s = { days: records.length, present: 0, half_day: 0, absent: 0, leave: 0, off: 0, hours: 0, after_exit: 0 };
  for (const r of records) {
    const c = dayCode(r);
    if (['P', 'P*', 'PR', 'OD', 'WFH', 'SA', 'PHL'].includes(c)) s.present++;
    else if (c === 'HD') s.half_day++;
    else if (c === 'A') s.absent++;
    else if (c === 'PH' || c === 'WO') s.off++;
    else if (r.status === 'leave') s.leave++;
    else s.present++;
    s.hours += Number(r.working_hours) || 0;
    if (lastWorkingDate && r.date > lastWorkingDate) s.after_exit++;
  }
  s.hours = Math.round(s.hours * 100) / 100;
  return s;
}

const clock = (v) => { const m = String(v || '').match(/[T ](\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ''; };
const nice = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function buildHistoryWorkbook({ people, records, from, to }, ExcelJS) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One'; wb.created = new Date();
  const period = from || to ? `${from ? nice(from) : 'Joining'} to ${to ? nice(to) : 'latest record'}` : 'Complete history';
  const single = people.length === 1 ? people[0] : null;
  const sub = `Maxvolt Energy Industries Limited  |  ${single ? `${single.name} (${single.employee_code})  |  ` : `${people.length} left employees  |  `}${period}  |  Generated ${nice(new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10))}`;
  const byUser = {};
  for (const r of records) (byUser[r.user_id] ||= []).push(r);

  const ws = sheetWithTitle(wb, 'Summary', 'ATTENDANCE HISTORY — LEFT EMPLOYEES', sub, 15);
  table(ws, ['Code', 'Employee', 'Department', 'Designation', 'Joined', 'Last working day', 'Days recorded', 'Present', 'Half day', 'Absent', 'Leave', 'Week off / holiday', 'Hours worked', 'Records after last working day', 'Exit type'],
    people.map((p) => { const s = attendanceSummary(byUser[p.user_id] || [], p.last_working_date); return [p.employee_code, p.name, p.department, p.designation, nice(p.date_of_joining), nice(p.last_working_date), s.days, s.present, s.half_day, s.absent, s.leave, s.off, s.hours, s.after_exit, String(p.exit_type || '')]; }),
    [12, 26, 20, 24, 12, 16, 12, 10, 10, 10, 10, 14, 12, 16, 14]);

  // Muster: one row per employee per month, one column per day, blank where no record exists.
  const mu = sheetWithTitle(wb, 'Monthly muster', 'MONTHLY MUSTER', `${sub}  |  P Present, P* Late, PR Regularised, HD Half day, A Absent, L/leave code Leave, WO Week off, PH Holiday, OD On duty, WFH Work from home`, 37);
  const rows = [];
  for (const p of people) {
    const months = {};
    for (const r of byUser[p.user_id] || []) (months[r.date.slice(0, 7)] ||= {})[Number(r.date.slice(8, 10))] = dayCode(r);
    for (const m of Object.keys(months).sort()) rows.push([p.employee_code, p.name, `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`, ...Array.from({ length: 31 }, (_, i) => months[m][i + 1] || ''), Object.keys(months[m]).length, m === p.last_working_date?.slice(0, 7) ? 'Last working month' : '']);
  }
  table(mu, ['Code', 'Employee', 'Month', ...Array.from({ length: 31 }, (_, i) => String(i + 1)), 'Days', 'Note'], rows, [12, 24, 10, ...Array(31).fill(4.5), 7, 18]);

  const dl = sheetWithTitle(wb, 'Daily records', 'DAILY ATTENDANCE RECORDS', sub, 12);
  const detail = [];
  for (const p of people) for (const r of [...(byUser[p.user_id] || [])].reverse()) {
    detail.push([p.employee_code, p.name, nice(r.date), dayCode(r), String(r.status || '').replace(/_/g, ' '), clock(r.check_in_time), clock(r.check_out_time), Number(r.working_hours) || 0, Number(r.late_minutes) || 0, r.biometric_synced ? 'Biometric' : r.regularised ? 'Regularised' : r.admin_marked ? 'Manual' : r.source || '', r.notes || r.regularisation_reason || '', p.last_working_date && r.date > p.last_working_date ? 'After last working day' : '']);
  }
  table(dl, ['Code', 'Employee', 'Date', 'Code', 'Status', 'First in', 'Last out', 'Hours', 'Late (min)', 'Source', 'Remarks', 'Note'], detail, [12, 24, 12, 7, 16, 9, 9, 8, 9, 12, 36, 20]);
  const safe = single ? `${single.employee_code || single.name}`.replace(/[^A-Za-z0-9_-]+/g, '_') : 'All';
  return { buffer: await wb.xlsx.writeBuffer(), filename: `Left_Employee_Attendance_${safe}${from ? `_${from}` : ''}${to ? `_to_${to}` : ''}.xlsx` };
}
