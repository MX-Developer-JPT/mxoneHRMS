// Nightly attendance automation — runs unattended (see server.js for the schedule).
// 1. Employees with no Attendance row at all on a completed working day → marked absent.
// 2. Employees who checked in but never checked out before 2 AM the next day → marked absent.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "Today" in IST as YYYY-MM-DD, optionally shifted by a number of whole days.
function istDateString(dayOffset = 0) {
  return new Date(Date.now() + IST_OFFSET_MS + dayOffset * 86400000).toISOString().slice(0, 10);
}

async function getDefaultShift() {
  const row = await one("SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'is_default'='1') LIMIT 1");
  return row ? JSON.parse(row.data) : { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
}

async function getShiftForEmployee(emp, defaultShift) {
  if (emp.shift_id) {
    const row = await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id]);
    if (row) return JSON.parse(row.data);
  }
  return defaultShift;
}

// Mark employees absent when they have zero Attendance record for a working day
// that has already ended. Skips holidays, the employee's scheduled off-days
// (per their Shift's `days` list), approved leave, and pre-joining dates.
export async function markMissingAttendanceAsAbsent(targetDate) {
  const date = targetDate || istDateString(-1);
  const weekday = WEEKDAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()];

  const holidayRow = await one("SELECT id FROM entities WHERE type='Holiday' AND data::jsonb->>'date'=$1", [date]);
  if (holidayRow) return { date, checked: 0, marked: 0, reason: 'company holiday' };

  const employees = (await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"))
    .map(r => JSON.parse(r.data))
    .filter(e => e.user_id && !e.is_attendance_exempt)
    .filter(e => !e.date_of_joining || e.date_of_joining <= date);

  if (employees.length === 0) return { date, checked: 0, marked: 0 };

  const defaultShift = await getDefaultShift();

  const approvedLeaves = (await all(
    "SELECT data FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'start_date'<=$1 AND data::jsonb->>'end_date'>=$1",
    [date]
  )).map(r => JSON.parse(r.data));
  const onLeaveUserIds = new Set(approvedLeaves.map(l => l.user_id));

  let marked = 0;
  for (const emp of employees) {
    if (onLeaveUserIds.has(emp.user_id)) continue;

    const shift = await getShiftForEmployee(emp, defaultShift);
    const workingDays = Array.isArray(shift.days) && shift.days.length ? shift.days : defaultShift.days;
    if (workingDays && !workingDays.includes(weekday)) continue; // scheduled off-day, not absence

    const existing = await one(
      "SELECT id FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
      [emp.user_id, date]
    );
    if (existing) continue;

    const id = uuidv4();
    const attData = {
      id,
      user_id: emp.user_id,
      date,
      status: 'absent',
      employee_code: emp.employee_code || '',
      auto_marked: true,
      auto_marked_reason: 'No attendance record found for this working day',
      source: 'auto_cron',
    };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'absent',$3)", [id, emp.user_id, JSON.stringify(attData)]);
    marked++;
  }
  return { date, checked: employees.length, marked };
}

// Force-close any Attendance row that's still "in progress" (checked in, never
// checked out) once the 2 AM cutoff has passed — regardless of hours worked.
export async function markUnclosedCheckInsAsAbsent(targetDate) {
  const date = targetDate || istDateString(-1);
  const rows = await all("SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1", [date]);

  let marked = 0;
  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (d.status === 'regularised') continue;
    if (!d.is_in_progress && d.status !== 'in_progress') continue; // already checked out

    const updated = {
      ...d,
      status: 'absent',
      is_in_progress: false,
      auto_closed_at: new Date().toISOString(),
      auto_closed_reason: 'Checked in but did not check out before 2 AM the next day — marked absent automatically',
      sessions: (d.sessions || []).map(s => (s.is_complete ? s : { ...s, auto_closed: true })),
    };
    await run("UPDATE entities SET status='absent', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(updated), row.id]);
    marked++;
  }
  return { date, checked: rows.length, marked };
}

export async function runNightlyAttendanceAutomation(targetDate) {
  const date = targetDate || istDateString(-1);
  const noRecord = await markMissingAttendanceAsAbsent(date);
  const unclosed = await markUnclosedCheckInsAsAbsent(date);
  console.log(`[attendance-cron] ${date} — no-record absent: ${noRecord.marked}/${noRecord.checked}, unclosed check-in absent: ${unclosed.marked}/${unclosed.checked}`);
  return { date, noRecord, unclosed };
}
