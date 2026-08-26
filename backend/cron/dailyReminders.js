// Daily reminder jobs — run once a day (see server.js for the schedule).
// 1. Absent-without-leave: nag the employee every day until they apply
//    leave covering that date; escalate to their manager once it's been 4+
//    days with still no leave applied.
// 2. Late/short-attendance/half-day: nag the employee every day until they
//    submit a regularisation request covering that date.
// 3. Birthdays & work anniversaries — congratulate the employee, notify
//    their department + manager.
// 4. Upcoming holiday reminder — once, a few days before each holiday.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateString(dayOffset = 0) {
  return new Date(Date.now() + IST_OFFSET_MS + dayOffset * 86400000).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

async function notifyUser(userId, { title, message, type = 'info', link = '' }) {
  if (!userId) return;
  try {
    await run(
      "INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)",
      [uuidv4(), userId, title, message, type, link || null]
    );
    const { sendPushToUser } = await import('../utils/push.js');
    sendPushToUser(userId, { title, message, type, link }); // fire-and-forget
  } catch (e) { console.error('[daily-reminders] notify failed:', e.message); }
}

// One generic dedup log — {user_id, date, kind, sent_at} — reused across all
// the reminder kinds below instead of a separate entity type per kind.
async function alreadyRemindedToday(userId, date, kind) {
  const row = await one(
    "SELECT id,data FROM entities WHERE type='ReminderLog' AND user_id=$1 AND data::jsonb->>'date'=$2 AND data::jsonb->>'kind'=$3",
    [userId, date, kind]
  );
  if (!row) return { already: false, rowId: null };
  const d = JSON.parse(row.data);
  return { already: d.last_sent_date === istDateString(0), rowId: row.id };
}
async function markReminded(userId, date, kind, rowId) {
  const payload = { user_id: userId, date, kind, last_sent_date: istDateString(0), sent_at: new Date().toISOString() };
  if (rowId) await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ id: rowId, ...payload }), rowId]);
  else { const id = uuidv4(); await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ReminderLog',$2,'sent',$3)", [id, userId, JSON.stringify({ id, ...payload })]); }
}
// A one-time (never-repeats) marker — used for the manager escalation and
// the holiday reminder, which should fire exactly once, not daily.
async function alreadySentEver(userId, date, kind) {
  const row = await one(
    "SELECT id FROM entities WHERE type='ReminderLog' AND user_id=$1 AND data::jsonb->>'date'=$2 AND data::jsonb->>'kind'=$3",
    [userId, date, kind]
  );
  return !!row;
}
async function markSentEver(userId, date, kind) {
  const id = uuidv4();
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ReminderLog',$2,'sent',$3)", [id, userId, JSON.stringify({ id, user_id: userId, date, kind, sent_at: new Date().toISOString() })]);
}

// How far back to look for an absence/late/short/half-day day still needing
// action — bounded so a years-old pre-existing record (or one from before
// this feature shipped) doesn't suddenly start nagging someone forever.
const LOOKBACK_DAYS = 30;
// Escalate to the manager once an absence has gone this many days with no
// leave applied.
const ESCALATE_AFTER_DAYS = 4;

async function hasLeaveCoveringDate(userId, date) {
  const row = await one(
    "SELECT id FROM entities WHERE type='Leave' AND user_id=$1 AND data::jsonb->>'start_date'<=$2 AND data::jsonb->>'end_date'>=$2 LIMIT 1",
    [userId, date]
  );
  return !!row;
}
async function hasRegularisationCoveringDate(userId, date) {
  const row = await one(
    "SELECT id FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1 AND data::jsonb->>'attendance_date'=$2 LIMIT 1",
    [userId, date]
  );
  return !!row;
}

// ── Absent-without-leave: daily nag + 4-day manager escalation ──────────
export async function sendAbsentLeaveReminders() {
  const today = istDateString(0);
  const since = istDateString(-LOOKBACK_DAYS);
  const rows = await all(
    "SELECT user_id,data FROM entities WHERE type='Attendance' AND data::jsonb->>'status'='absent' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' < $2",
    [since, today]
  );
  let reminded = 0, escalated = 0;
  const empCache = {};
  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (d.regularised) continue;
    if (await hasLeaveCoveringDate(row.user_id, d.date)) continue;

    if (!(row.user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [row.user_id]);
      empCache[row.user_id] = empRow ? JSON.parse(empRow.data) : null;
    }
    const emp = empCache[row.user_id];
    if (!emp || emp.status !== 'active' || emp.is_attendance_exempt) continue;

    const { already, rowId } = await alreadyRemindedToday(row.user_id, d.date, 'absent_leave');
    if (!already) {
      await notifyUser(row.user_id, {
        title: 'Please apply for leave',
        message: `You were marked absent on ${d.date} and haven't applied for leave covering that day yet.`,
        type: 'warning', link: '/Leave',
      });
      await markReminded(row.user_id, d.date, 'absent_leave', rowId);
      reminded++;
    }

    if (daysBetween(d.date, today) >= ESCALATE_AFTER_DAYS && emp.reporting_manager_id) {
      if (!(await alreadySentEver(row.user_id, d.date, 'absent_escalation'))) {
        const uRow = await one('SELECT full_name FROM users WHERE id=$1', [row.user_id]);
        await notifyUser(emp.reporting_manager_id, {
          title: 'Unexplained absence — no leave applied',
          message: `${uRow?.full_name || emp.display_name || 'Your team member'} was absent on ${d.date} and still hasn't applied for leave covering that day (${daysBetween(d.date, today)} days now).`,
          type: 'warning', link: '/AllAttendance',
        });
        await markSentEver(row.user_id, d.date, 'absent_escalation');
        escalated++;
      }
    }
  }
  return { checked: rows.length, reminded, escalated };
}

// ── Late / short-attendance / half-day: daily regularisation nag ────────
export async function sendRegularisationReminders() {
  const today = istDateString(0);
  const since = istDateString(-LOOKBACK_DAYS);
  const rows = await all(
    "SELECT user_id,data FROM entities WHERE type='Attendance' AND data::jsonb->>'status' = ANY($1) AND data::jsonb->>'date' >= $2 AND data::jsonb->>'date' < $3",
    [['late', 'short_attendance', 'half_day'], since, today]
  );
  let reminded = 0;
  const empCache = {};
  for (const row of rows) {
    const d = JSON.parse(row.data);
    // A half-day already explained by an approved/pending half-day Leave
    // (leave_id set on the record, or any Leave covering the date) doesn't
    // need a regularisation request — the employee already applied, just
    // through Leave instead.
    if (d.regularised || d.leave_id) continue;
    if (await hasRegularisationCoveringDate(row.user_id, d.date)) continue;
    if (await hasLeaveCoveringDate(row.user_id, d.date)) continue;

    if (!(row.user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [row.user_id]);
      empCache[row.user_id] = empRow ? JSON.parse(empRow.data) : null;
    }
    const emp = empCache[row.user_id];
    if (!emp || emp.status !== 'active') continue;

    const { already, rowId } = await alreadyRemindedToday(row.user_id, d.date, 'regularisation');
    if (already) continue;
    const statusLabel = d.status === 'short_attendance' ? 'short attendance' : d.status.replace('_', ' ');
    await notifyUser(row.user_id, {
      title: 'Please apply for regularisation',
      message: `Your attendance on ${d.date} was marked ${statusLabel}. Please submit a regularisation request if this needs correcting.`,
      type: 'warning', link: '/AttendanceRegularisation',
    });
    await markReminded(row.user_id, d.date, 'regularisation', rowId);
    reminded++;
  }
  return { checked: rows.length, reminded };
}

// ── Birthdays & work anniversaries ───────────────────────────────────────
export async function sendCelebrationNotifications() {
  const today = new Date(Date.now() + IST_OFFSET_MS);
  const todayStr = istDateString(0);
  const empRows = await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'");
  let sent = 0;
  for (const row of empRows) {
    const emp = JSON.parse(row.data);
    if (!emp.user_id) continue;
    const uRow = await one('SELECT full_name FROM users WHERE id=$1', [emp.user_id]);
    const name = uRow?.full_name || emp.display_name || 'Employee';

    const isBirthday = emp.date_of_birth && emp.date_of_birth.slice(5, 10) === todayStr.slice(5, 10);
    const isAnniversary = emp.date_of_joining && emp.date_of_joining.slice(5, 10) === todayStr.slice(5, 10)
      && today.getUTCFullYear() > Number(emp.date_of_joining.slice(0, 4));

    if (isBirthday && !(await alreadySentEver(emp.user_id, todayStr, 'birthday'))) {
      await notifyUser(emp.user_id, { title: '🎂 Happy Birthday!', message: `Wishing you a wonderful day, ${name}!`, type: 'success', link: '/EmployeeEngagementPortal' });
      const colleagues = await all(
        "SELECT user_id FROM entities WHERE type='Employee' AND status='active' AND (data::jsonb->>'department'=$1 OR user_id=$2) AND user_id != $3",
        [emp.department || '__none__', emp.reporting_manager_id || '__none__', emp.user_id]
      );
      for (const c of colleagues) notifyUser(c.user_id, { title: '🎂 Birthday Today', message: `It's ${name}'s birthday today — wish them well!`, type: 'info', link: '/EmployeeEngagementPortal' }).catch(() => {});
      await markSentEver(emp.user_id, todayStr, 'birthday');
      sent++;
    }

    if (isAnniversary && !(await alreadySentEver(emp.user_id, todayStr, 'anniversary'))) {
      const years = today.getUTCFullYear() - Number(emp.date_of_joining.slice(0, 4));
      await notifyUser(emp.user_id, { title: '🎉 Happy Work Anniversary!', message: `Congratulations on ${years} year${years > 1 ? 's' : ''} with us, ${name}!`, type: 'success', link: '/EmployeeEngagementPortal' });
      const colleagues = await all(
        "SELECT user_id FROM entities WHERE type='Employee' AND status='active' AND (data::jsonb->>'department'=$1 OR user_id=$2) AND user_id != $3",
        [emp.department || '__none__', emp.reporting_manager_id || '__none__', emp.user_id]
      );
      for (const c of colleagues) notifyUser(c.user_id, { title: '🎉 Work Anniversary Today', message: `It's ${name}'s ${years}-year work anniversary today!`, type: 'info', link: '/EmployeeEngagementPortal' }).catch(() => {});
      await markSentEver(emp.user_id, todayStr, 'anniversary');
      sent++;
    }
  }
  return { checked: empRows.length, sent };
}

// ── Upcoming holiday reminder — once, a few days ahead ───────────────────
const HOLIDAY_REMINDER_LEAD_DAYS = 3;
export async function sendUpcomingHolidayReminders() {
  const targetDate = istDateString(HOLIDAY_REMINDER_LEAD_DAYS);
  const holidayRow = await one("SELECT data FROM entities WHERE type='Holiday' AND data::jsonb->>'date'=$1", [targetDate]);
  if (!holidayRow) return { sent: 0 };
  const holiday = JSON.parse(holidayRow.data);
  if (await alreadySentEver('org', targetDate, 'holiday_reminder')) return { sent: 0, already_sent: true };

  const empRows = await all("SELECT user_id FROM entities WHERE type='Employee' AND status='active'");
  let sent = 0;
  for (const row of empRows) {
    await notifyUser(row.user_id, {
      title: 'Upcoming Holiday',
      message: `${holiday.name || 'A holiday'} is coming up on ${targetDate}${holiday.is_half_day ? ' (half day)' : ''}.`,
      type: 'info', link: '/HolidayCalendar',
    });
    sent++;
  }
  await markSentEver('org', targetDate, 'holiday_reminder');
  return { sent };
}
