// Left Employees (le_*): the archive list, each person's complete attendance history and its Excel download. Read-only:
// nothing here changes an employee or an attendance record.
import { all } from '../db.js';
import { isLeaver, lastWorkingDay, ymd } from '../utils/leavers.js';
import { dedupeAttendance, attendanceSummary, buildHistoryWorkbook } from '../utils/attendanceHistory.js';

const ROLES = ['hr', 'admin', 'management'];
const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

async function leavers() {
  const emps = (await all("SELECT id, user_id, data FROM entities WHERE type='Employee'"))
    .map((r) => { const d = parse(r.data); return { ...d, id: r.id, user_id: d.user_id || r.user_id }; }).filter(isLeaver);
  const users = Object.fromEntries((await all('SELECT id, full_name, email, former_email FROM users')).map((u) => [u.id, u]));
  const exits = (await all("SELECT data FROM entities WHERE type='Exit'")).map((r) => parse(r.data));
  return emps.map((e) => {
    const mine = exits.filter((x) => x.user_id === e.user_id).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const exit = mine.find((x) => x.status === 'completed') || mine.find((x) => !['withdrawn', 'cancelled', 'manager_rejected', 'hr_rejected'].includes(x.status)) || null;
    const u = users[e.user_id] || {};
    return { e, exit, row: {
      user_id: e.user_id, employee_id: e.id, name: e.display_name || u.full_name || '', employee_code: e.employee_code || '',
      department: e.department || '', designation: e.designation || '', date_of_joining: ymd(e.date_of_joining),
      email: u.former_email || u.email || '', status: e.status || e.employee_status || '',
      resignation_date: ymd(exit?.resignation_date), last_working_date: lastWorkingDay(e, exit),
      exit_type: exit?.exit_type || e.status || '', reason_category: exit?.reason_category || '',
      reason: e.exit_reason || exit?.reason || '', exit: exit || null,
    } };
  }).sort((a, b) => String(b.row.last_working_date).localeCompare(String(a.row.last_working_date)) || a.row.name.localeCompare(b.row.name));
}

// Attendance is matched on either the record's own user_id or the table column: older biometric rows only carry one of them.
async function attendanceFor(userIds, from, to) {
  if (!userIds.length) return [];
  const params = [userIds];
  let sql = "SELECT user_id, data FROM entities WHERE type='Attendance' AND (user_id = ANY($1) OR data::jsonb->>'user_id' = ANY($1))";
  if (from) { params.push(from); sql += ` AND data::jsonb->>'date' >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND data::jsonb->>'date' <= $${params.length}`; }
  return dedupeAttendance((await all(sql, params)).map((r) => { const d = parse(r.data); return { ...d, user_id: d.user_id || r.user_id }; }));
}

export async function handleLeftEmployees(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const u = (await all('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]))[0] || {};
  if (![u.role, u.custom_role].some((r) => ROLES.includes(r))) return res.status(403).json({ error: 'HR / Management access required' });
  const from = ymd(p.from), to = ymd(p.to);
  const people = await leavers();

  if (name === 'le_list') {
    const att = await attendanceFor(people.map((x) => x.row.user_id), '', '');
    const count = {};
    for (const a of att) { const c = (count[a.user_id] ||= { days: 0, first: a.date, last: a.date }); c.days++; if (a.date < c.first) c.first = a.date; if (a.date > c.last) c.last = a.date; }
    return res.json({ success: true, employees: people.map((x) => ({ ...x.row, attendance_days: count[x.row.user_id]?.days || 0, attendance_first: count[x.row.user_id]?.first || '', attendance_last: count[x.row.user_id]?.last || '' })) });
  }

  if (name === 'le_attendance') {
    const person = people.find((x) => x.row.user_id === p.user_id);
    if (!person) return res.status(404).json({ success: false, error: 'This employee is not in the Left Employees list' });
    const records = await attendanceFor([p.user_id], from, to);
    return res.json({ success: true, employee: person.row, summary: attendanceSummary(records, person.row.last_working_date), records });
  }

  if (name === 'le_export') {
    const chosen = p.user_id ? people.filter((x) => x.row.user_id === p.user_id)
      : Array.isArray(p.user_ids) && p.user_ids.length ? people.filter((x) => p.user_ids.includes(x.row.user_id)) : people;
    if (!chosen.length) return res.status(404).json({ success: false, error: 'No left employee matches' });
    const records = await attendanceFor(chosen.map((x) => x.row.user_id), from, to);
    const ExcelJS = (await import('exceljs')).default;
    const out = await buildHistoryWorkbook({ people: chosen.map((x) => x.row), records, from, to }, ExcelJS);
    return res.json({ success: true, base64: Buffer.from(out.buffer).toString('base64'), filename: out.filename, total_records: records.length });
  }

  return res.status(400).json({ error: `Unknown function ${name}` });
}
