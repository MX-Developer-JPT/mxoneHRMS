// Overtime Excel workbook: muster grid, day-wise, month-wise, department-wise, employee-wise and the punches to check.
import { sheetWithTitle, table } from './xlsxSheet.js';
import { hours } from './overtime.js';

const nice = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const clock = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : '');
const TYPE = { working: 'Working day', weekly_off: 'Weekly off', holiday: 'Holiday', half_holiday: 'Half-day holiday' };
const sum = (rows, i) => Math.round(rows.reduce((s, r) => s + (Number(r[i]) || 0), 0) * 100) / 100;
const totals = (labelCol, numeric) => (rows) => rows[0].map((_, i) => (i === labelCol ? 'TOTAL' : numeric.includes(i) ? sum(rows, i) : ''));

export function datesBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 800; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function buildOvertimeWorkbook({ report, from, to, policy, scope, view }, ExcelJS) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One'; wb.created = new Date();
  const sub = `Maxvolt Energy Industries Limited  |  ${nice(from)} to ${nice(to)}  |  ${scope || 'All departments'}  |  Employees with overtime: ${report.totals.employees}  |  Generated ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
  const rule = `Overtime = worked time from completed punches minus the shift's working hours, counted when it reaches ${policy.min_minutes ?? 'the shift grace'}${policy.min_minutes != null ? ' minutes' : ' period'}; ${policy.off_day_all_hours ? 'all hours on weekly offs and holidays' : 'the same rule on weekly offs and holidays'}; days over ${policy.max_day_hours} hours are not counted. ${policy.eligible_only ? 'Overtime-eligible employees only.' : 'All employees.'} Pay = Basic ÷ 26 ÷ 8 × ${policy.multiplier}.`;

  const sheets = {
    muster: () => {
      // a grid like the attendance muster: dates across for a range up to 31 days, months across for longer ones
      const daily = datesBetween(from, to).length <= 31;
      const cols = daily ? datesBetween(from, to) : [...new Set(report.months.map((m) => m.month))].sort();
      const by = {};
      for (const d of report.days) { const k = daily ? d.date : d.date.slice(0, 7); (by[d.user_id] ||= {})[k] = (by[d.user_id][k] || 0) + d.ot_minutes; }
      const ws = sheetWithTitle(wb, 'OT Muster', `OVERTIME MUSTER (hours)`, `${sub}  |  ${rule}`, cols.length + 6);
      const people = [...report.employees].sort((a, b) => a.department.localeCompare(b.department) || a.employee_name.localeCompare(b.employee_name));
      table(ws, ['Code', 'Employee', 'Department', 'Designation', ...cols.map((c) => (daily ? `${c.slice(8, 10)}-${c.slice(5, 7)}` : monthName(c))), 'OT days', 'Total OT hrs'],
        people.map((p) => [p.employee_code, p.employee_name, p.department, p.designation, ...cols.map((c) => (by[p.user_id]?.[c] ? hours(by[p.user_id][c]) : '')), p.ot_days, hours(p.ot_minutes)]),
        [12, 26, 18, 20, ...cols.map(() => (daily ? 6.5 : 10)), 9, 12], { total: totals(1, [...cols.map((_, i) => i + 4), cols.length + 4, cols.length + 5]) });
    },
    day: () => {
      const ws = sheetWithTitle(wb, 'Day-wise', 'DAY-WISE OVERTIME', sub, 13);
      table(ws, ['Date', 'Code', 'Employee', 'Department', 'Shift', 'Day type', 'First in', 'Last out', 'Worked hrs', 'Standard hrs', 'OT hrs', 'Remarks'],
        report.days.map((d) => [nice(d.date), d.employee_code, d.employee_name, d.department, d.shift, TYPE[d.day_type], clock(d.first_in), clock(d.last_out), hours(d.worked_minutes), hours(d.standard_minutes), hours(d.ot_minutes), d.notes]),
        [12, 12, 26, 18, 14, 16, 9, 9, 11, 12, 9, 36], { total: totals(2, [8, 10]) });
    },
    month: () => {
      const ws = sheetWithTitle(wb, 'Month-wise', 'MONTH-WISE OVERTIME', sub, 9);
      table(ws, ['Month', 'Code', 'Employee', 'Department', 'OT days', 'OT hrs', 'Of which off-day hrs', 'OT amount (Rs)'],
        report.months.map((m) => [monthName(m.month), m.employee_code, m.employee_name, m.department, m.ot_days, hours(m.ot_minutes), hours(m.off_day_minutes), m.ot_amount]),
        [12, 12, 26, 20, 10, 10, 16, 15], { total: totals(2, [4, 5, 6, 7]) });
    },
    department: () => {
      const ws = sheetWithTitle(wb, 'Department-wise', 'DEPARTMENT-WISE OVERTIME', sub, 7);
      table(ws, ['Department', 'Employees', 'OT days', 'OT hrs', 'Of which off-day hrs', 'OT amount (Rs)'],
        report.departments.map((d) => [d.department, d.employees, d.ot_days, hours(d.ot_minutes), hours(d.off_day_minutes), d.ot_amount]),
        [28, 12, 10, 12, 18, 16], { total: totals(0, [1, 2, 3, 4, 5]) });
    },
    employee: () => {
      const ws = sheetWithTitle(wb, 'Employee-wise', 'EMPLOYEE-WISE OVERTIME', sub, 9);
      table(ws, ['Code', 'Employee', 'Department', 'Designation', 'OT days', 'OT hrs', 'Of which off-day hrs', 'OT amount (Rs)'],
        report.employees.map((p) => [p.employee_code, p.employee_name, p.department, p.designation, p.ot_days, hours(p.ot_minutes), hours(p.off_day_minutes), p.ot_amount]),
        [12, 26, 20, 22, 10, 10, 16, 15], { total: totals(1, [4, 5, 6, 7]) });
    },
  };
  const first = sheets[view] ? view : 'muster';
  sheets[first]();
  for (const k of Object.keys(sheets)) if (k !== first) sheets[k]();
  const ws = sheetWithTitle(wb, 'Punches to check', 'PUNCHES TO CHECK', `${sub}  |  Missing punches and implausibly long days of overtime-eligible employees`, 8);
  table(ws, ['Date', 'Code', 'Employee', 'Department', 'Worked hrs', 'OT counted hrs', 'Remarks'],
    report.checks.map((d) => [nice(d.date), d.employee_code, d.employee_name, d.department, hours(d.worked_minutes), hours(d.ot_minutes), d.notes]), [12, 12, 26, 18, 11, 15, 60]);
  return { buffer: await wb.xlsx.writeBuffer(), filename: `Overtime_${from}_to_${to}.xlsx` };
}
