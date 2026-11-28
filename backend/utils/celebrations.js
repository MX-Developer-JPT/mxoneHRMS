// Month-wise birthdays and work anniversaries (pure). Birth years are never returned: only the day and month.
import { isLeaver } from './leavers.js';
import { sheetWithTitle, table } from './xlsxSheet.js';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** { y, m, d } from YYYY-MM-DD or DD-MM-YYYY (imports), else null. */
export function dateParts(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else return null;
  const real = new Date(Date.UTC(y, mo - 1, d));
  return y > 1900 && real.getUTCMonth() === mo - 1 && real.getUTCDate() === d ? { y, m: mo, d } : null;
}

const pad = (n) => String(n).padStart(2, '0');
const dayLabel = (p) => `${pad(p.d)} ${MONTHS[p.m - 1].slice(0, 3)}`;

/**
 * Everyone currently employed with a birthday, or a work anniversary (one year or more by `year`), in `month`.
 * One row per person, ordered by the day of the month.
 */
export function celebrationsFor(employees, month, year) {
  const people = employees.filter((e) => e.status === 'active' && !isLeaver(e));
  const rows = [];
  let noBirthDate = 0, noJoiningDate = 0;
  for (const e of people) {
    const dob = dateParts(e.date_of_birth), doj = dateParts(e.date_of_joining);
    if (!dob) noBirthDate++;
    if (!doj) noJoiningDate++;
    const birthday = dob && dob.m === month ? dob : null;
    const anniversary = doj && doj.m === month && year - doj.y >= 1 ? doj : null;
    if (!birthday && !anniversary) continue;
    rows.push({
      employee_code: e.employee_code || '', name: e.display_name || '', department: e.department || '', designation: e.designation || '',
      birthday: birthday ? dayLabel(birthday) : '', birthday_day: birthday?.d || null,
      anniversary: anniversary ? dayLabel(anniversary) : '', anniversary_day: anniversary?.d || null,
      joined: anniversary ? `${dayLabel(anniversary)} ${anniversary.y}` : '', years: anniversary ? year - anniversary.y : null,
    });
  }
  const first = (r) => Math.min(r.birthday_day ?? 99, r.anniversary_day ?? 99);
  rows.sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name));
  return {
    month, year, rows,
    totals: { birthdays: rows.filter((r) => r.birthday).length, anniversaries: rows.filter((r) => r.anniversary).length, employees: people.length, missing_birth_date: noBirthDate, missing_joining_date: noJoiningDate },
  };
}

/** Excel: for one month a combined list plus separate birthday and anniversary sheets; for a whole year one sheet per month. */
export async function buildCelebrationWorkbook(employees, { month, year, kind = 'all' }, ExcelJS) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One'; wb.created = new Date();
  const generated = `Generated ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
  const combined = (m, name) => {
    const r = celebrationsFor(employees, m, year);
    const rows = r.rows.filter((x) => (kind === 'birthday' ? x.birthday : kind === 'anniversary' ? x.anniversary : true));
    const ws = sheetWithTitle(wb, name, `BIRTHDAYS & WORK ANNIVERSARIES — ${MONTHS[m - 1].toUpperCase()} ${year}`, `Maxvolt Energy Industries Limited  |  Birthdays: ${r.totals.birthdays}  |  Work anniversaries: ${r.totals.anniversaries}  |  ${generated}`, 7);
    table(ws, ['Employee code', 'Name', 'Department', 'Designation', 'Birthday', 'Work anniversary', 'Years completed'],
      rows.map((x) => [x.employee_code, x.name, x.department, x.designation, x.birthday, x.anniversary, x.years ?? '']), [15, 28, 20, 24, 12, 18, 16]);
    return r;
  };
  if (!month) {
    MONTHS.forEach((label, i) => combined(i + 1, label));
    return { buffer: await wb.xlsx.writeBuffer(), filename: `Birthdays_Anniversaries_${year}.xlsx` };
  }
  const r = combined(month, `${MONTHS[month - 1]} list`);
  const sub = `Maxvolt Energy Industries Limited  |  ${MONTHS[month - 1]} ${year}  |  ${generated}`;
  if (kind !== 'anniversary') {
    const ws = sheetWithTitle(wb, 'Birthdays', `BIRTHDAYS — ${MONTHS[month - 1].toUpperCase()}`, sub, 5);
    table(ws, ['Birthday', 'Employee code', 'Name', 'Department', 'Designation'], r.rows.filter((x) => x.birthday).sort((a, b) => a.birthday_day - b.birthday_day || a.name.localeCompare(b.name)).map((x) => [x.birthday, x.employee_code, x.name, x.department, x.designation]), [12, 15, 28, 20, 24]);
  }
  if (kind !== 'birthday') {
    const ws = sheetWithTitle(wb, 'Work anniversaries', `WORK ANNIVERSARIES — ${MONTHS[month - 1].toUpperCase()} ${year}`, sub, 7);
    table(ws, ['Anniversary', 'Employee code', 'Name', 'Department', 'Designation', 'Date of joining', 'Years completed'], r.rows.filter((x) => x.anniversary).sort((a, b) => a.anniversary_day - b.anniversary_day || a.name.localeCompare(b.name)).map((x) => [x.anniversary, x.employee_code, x.name, x.department, x.designation, x.joined, x.years]), [14, 15, 28, 20, 24, 17, 16]);
  }
  return { buffer: await wb.xlsx.writeBuffer(), filename: `${kind === 'birthday' ? 'Birthdays' : kind === 'anniversary' ? 'Work_Anniversaries' : 'Birthdays_Anniversaries'}_${MONTHS[month - 1]}_${year}.xlsx` };
}
