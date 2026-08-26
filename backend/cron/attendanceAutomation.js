// Nightly attendance automation — runs unattended (see server.js for the schedule).
// 1. Employees with no Attendance row at all on a completed working day → marked absent.
// 2. Employees who checked in but never checked out before 2 AM the next day → marked absent.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { buildSessions, computeStatusFromSessions, closeTrailingOpenSession, getHalfDayOverrideHours } from '../routes/attendancelog.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "Today" in IST as YYYY-MM-DD, optionally shifted by a number of whole days.
function istDateString(dayOffset = 0) {
  return new Date(Date.now() + IST_OFFSET_MS + dayOffset * 86400000).toISOString().slice(0, 10);
}

async function getDefaultShift() {
  const row = await one("SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'is_default'='1') LIMIT 1");
  return row ? JSON.parse(row.data) : {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    start_time: '09:00', end_time: '18:00', grace_period_minutes: 15,
  };
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

  // A half-day holiday is still a (partially) working day — only a FULL
  // holiday skips absence-marking entirely, otherwise nobody who simply
  // never showed up on a half day would ever get flagged.
  const holidayRow = await one("SELECT id FROM entities WHERE type='Holiday' AND data::jsonb->>'date'=$1 AND data::jsonb->>'is_half_day' IS DISTINCT FROM 'true'", [date]);
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

// Force-close any Attendance row that's still "in progress" (a session
// checked in but never checked out) once the 2 AM cutoff has passed.
//
// Previously this blanket-marked the ENTIRE day 'absent' whenever the final
// session was left open — discarding any real hours already worked in
// earlier sessions that day (e.g. a normal 9-6 shift, then a forgotten
// supplementary check-in at 8 PM that was never checked out, wiped the whole
// day to absent instead of just flagging the stray trailing punch). Now the
// trailing open session is closed as zero-duration (see
// closeTrailingOpenSession) and the day's status is recomputed from
// whatever was actually, legitimately worked.
// Auto-ends whichever FieldTrip THIS attendance record auto-started (via
// markSelfieAttendance's OD flow) if it's still active when the day gets
// force-closed by one of the safety-net jobs below — a forgotten checkout
// must not leave Field Duty Tracking running indefinitely. Never touches a
// trip the employee started manually and hasn't linked to this attendance id.
async function closeLinkedFieldTrip(userId, attendanceId) {
  if (!attendanceId) return;
  const row = await one(
    "SELECT id,data FROM entities WHERE type='FieldTrip' AND user_id=$1 AND data::jsonb->>'status'='active' AND data::jsonb->>'linked_attendance_id'=$2",
    [userId, attendanceId]
  );
  if (!row) return;
  const trip = JSON.parse(row.data);
  await run("UPDATE entities SET data=$1, status='completed' WHERE id=$2", [
    JSON.stringify({ ...trip, status: 'completed', end_time: new Date().toISOString(), auto_closed: true }), row.id,
  ]);
}

export async function closeUnfinishedSessions(targetDate) {
  const date = targetDate || istDateString(-1);
  const rows = await all("SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1", [date]);

  const defaultShift = await getDefaultShift();
  const empCache = {};
  let marked = 0;

  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (d.status === 'regularised') continue;

    // Older records may predate the multi-session model and only carry
    // check_in_time/check_out_time — seed raw_punches from those so this
    // still finalizes them correctly instead of skipping.
    let rawPunches = Array.isArray(d.raw_punches) && d.raw_punches.length ? d.raw_punches : [];
    if (!rawPunches.length && d.check_in_time) {
      rawPunches = [{ time: d.check_in_time, device_direction: 'IN' }];
      if (d.check_out_time) rawPunches.push({ time: d.check_out_time, device_direction: 'OUT' });
    }
    if (!rawPunches.length) continue;

    const currentSd = buildSessions(rawPunches);
    if (!currentSd.is_in_progress) continue; // already fully checked out

    if (!(d.user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [d.user_id]);
      empCache[d.user_id] = empRow ? JSON.parse(empRow.data) : {};
    }
    const shift = await getShiftForEmployee(empCache[d.user_id], defaultShift);
    const halfDayHours = await getHalfDayOverrideHours(date, shift);

    const sessionData = closeTrailingOpenSession(rawPunches);
    const statusResult = computeStatusFromSessions(sessionData, shift, halfDayHours);
    // A WFH/OD day the employee forgot to check out of must stay WFH/OD —
    // not silently revert to whatever present/late/half-day the raw punch
    // timeline alone computes to.
    // Preserve WFH/OD however it was set — via the employee's own selfie
    // flow (selfie_reason) or an admin manually pinning the status in the
    // Manual Attendance editor (d.status) — so a day left "in progress"
    // (check-in given, no check-out) doesn't get silently recomputed back
    // to present/late/half-day when this safety net closes it out.
    const finalStatus = (d.selfie_reason === 'wfh' || d.status === 'work_from_home') ? 'work_from_home'
      : (d.selfie_reason === 'od' || d.status === 'on_duty') ? 'on_duty'
      : statusResult.status;
    const updated = {
      ...d, ...sessionData, ...statusResult, status: finalStatus,
      auto_closed_at: new Date().toISOString(),
      auto_closed_reason: 'Final session of the day was never checked out before the 2 AM cutoff — closed as a zero-duration session at the last recorded punch; status reflects hours actually worked in completed sessions.',
    };
    await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [finalStatus, JSON.stringify(updated), row.id]);
    await closeLinkedFieldTrip(d.user_id, d.id);
    marked++;
  }
  return { date, checked: rows.length, marked };
}

// Sweep EVERY Attendance row still "in progress" whose date is before today
// (IST), regardless of how many days old — not just yesterday's date like
// closeUnfinishedSessions above. Two ways a stale session can end up here
// beyond a single missed nightly run:
//   1. It genuinely never got processed (server was mid-deploy at 2 AM the
//      night it was due, so that date's one-shot window passed silently).
//   2. It WAS closed by a previous run, but a late-arriving biometric sync
//      batch (devices can queue and upload punches hours/days late) merged
//      a fresh punch into the day afterward, silently reopening it — with
//      no further nightly run ever revisiting that specific past date again.
// Runs on the frequent cron (see server.js) so either case self-heals within
// the run interval instead of staying stuck indefinitely.
export async function closeStaleOpenSessions() {
  const todayIST = istDateString(0);
  const rows = await all(
    "SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'is_in_progress'='true' AND data::jsonb->>'date' < $1",
    [todayIST]
  );
  if (rows.length === 0) return { checked: 0, marked: 0 };

  const defaultShift = await getDefaultShift();
  const empCache = {};
  let marked = 0;

  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (d.status === 'regularised') continue;

    let rawPunches = Array.isArray(d.raw_punches) && d.raw_punches.length ? d.raw_punches : [];
    if (!rawPunches.length && d.check_in_time) {
      rawPunches = [{ time: d.check_in_time, device_direction: 'IN' }];
      if (d.check_out_time) rawPunches.push({ time: d.check_out_time, device_direction: 'OUT' });
    }
    if (!rawPunches.length) continue;

    const currentSd = buildSessions(rawPunches);
    if (!currentSd.is_in_progress) continue; // already fully checked out

    if (!(d.user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [d.user_id]);
      empCache[d.user_id] = empRow ? JSON.parse(empRow.data) : {};
    }
    const shift = await getShiftForEmployee(empCache[d.user_id], defaultShift);
    const halfDayHours = await getHalfDayOverrideHours(d.date, shift);

    const sessionData = closeTrailingOpenSession(rawPunches);
    const statusResult = computeStatusFromSessions(sessionData, shift, halfDayHours);
    // Preserve WFH/OD however it was set — via the employee's own selfie
    // flow (selfie_reason) or an admin manually pinning the status in the
    // Manual Attendance editor (d.status) — so a day left "in progress"
    // (check-in given, no check-out) doesn't get silently recomputed back
    // to present/late/half-day when this safety net closes it out.
    const finalStatus = (d.selfie_reason === 'wfh' || d.status === 'work_from_home') ? 'work_from_home'
      : (d.selfie_reason === 'od' || d.status === 'on_duty') ? 'on_duty'
      : statusResult.status;
    const updated = {
      ...d, ...sessionData, ...statusResult, status: finalStatus,
      auto_closed_at: new Date().toISOString(),
      auto_closed_reason: 'Checked in but never checked out for a past day — the last recorded check-in was treated as the final check-out; status reflects hours actually worked in completed sessions.',
    };
    await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [finalStatus, JSON.stringify(updated), row.id]);
    await closeLinkedFieldTrip(d.user_id, d.id);
    marked++;
  }
  return { checked: rows.length, marked };
}

// Mid-day safety net for geofence-driven check-ins. Exit is normally detected
// client-side (JS watcher or the native Android headless service) the moment
// a phone reports leaving the radius — but if tracking silently dies after
// check-in (GPS disabled, an OEM battery killer force-stopping the service,
// location permission revoked, app crash) no exit event ever fires, and the
// employee would otherwise stay "checked in" until the *next* day's 2 AM
// cleanup (closeUnfinishedSessions) — a 20+ hour window with an
// incorrect status the whole time. Runs frequently (see server.js) and
// force-closes any GEOFENCE-driven open session that's been running
// implausibly long for one continuous stretch, checking out "now" and
// flagging why. Manual/biometric/selfie check-ins are left alone — this is
// specifically a geofence-tracking-reliability net, not a general
// "forgot to punch out" sweep (that stays the nightly job's responsibility).
const STALE_GEOFENCE_SESSION_HOURS = 10;

export async function closeStaleGeofenceSessions() {
  const date = istDateString(0);
  const rows = await all(
    "SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1 AND data::jsonb->>'is_in_progress'='true' AND data::jsonb->>'auto_geofence'='true'",
    [date]
  );
  if (rows.length === 0) return { date, checked: 0, closed: 0 };

  const defaultShift = await getDefaultShift();
  const empCache = {};
  // Every punch timestamp in this app (buildSessions, nativeGeofenceEvent,
  // markSelfieAttendance, processRecord) is stored using the "IST digits
  // mislabeled as UTC" convention — a 9:00 AM IST punch is stored as
  // "...T09:00:00.000Z". This function was the one exception: it stored
  // real, un-shifted UTC as the checkout time (wrong displayed time/hours),
  // AND compared that real UTC "now" against the IST-labeled check-in time
  // when computing hoursOpen — inflating the elapsed time by 5.5h, so the
  // "10 hour" stale threshold actually fired after only ~4.5 real hours.
  const nowIST = new Date(Date.now() + 5.5 * 3600000);
  const nowIso = nowIST.toISOString();
  let closed = 0;

  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (d.status === 'regularised') continue;
    const openSession = (d.sessions || [])[d.sessions.length - 1];
    if (!openSession?.check_in) continue;
    const openedMs = new Date(openSession.check_in).getTime();
    if (!isFinite(openedMs)) continue;
    const hoursOpen = (nowIST.getTime() - openedMs) / 3600000;
    if (hoursOpen < STALE_GEOFENCE_SESSION_HOURS) continue;

    if (!(d.user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [d.user_id]);
      empCache[d.user_id] = empRow ? JSON.parse(empRow.data) : {};
    }
    const shift = await getShiftForEmployee(empCache[d.user_id], defaultShift);
    const halfDayHours = await getHalfDayOverrideHours(date, shift);

    const rawPunches = [...(d.raw_punches || []), { time: nowIso, device_direction: 'OUT' }];
    const sessionData = buildSessions(rawPunches);
    const statusResult = computeStatusFromSessions(sessionData, shift, halfDayHours);
    const updated = {
      ...d, ...sessionData, ...statusResult,
      auto_closed_at: nowIso,
      auto_closed_reason: `Geofence tracking appears to have stopped (session open ${Math.round(hoursOpen)}h with no exit detected) — auto-checked-out for review`,
    };
    await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [statusResult.status, JSON.stringify(updated), row.id]);
    closed++;
  }
  return { date, checked: rows.length, closed };
}

// ── Shift start / forgot-to-checkout push reminders ──────────────────────
// Two independent nags, both fire-and-forget push (+ in-app notification):
//   1. Shift started and the employee still has no Attendance record at all
//      for today (i.e. hasn't checked in) — reminds them shortly after their
//      shift's grace period elapses, once per user per day.
//   2. Shift ended and the employee is still "in progress" (checked in, never
//      checked out) — reminds them once, a short grace period after their
//      shift's end time.
// Overnight shifts (end_time < start_time, crossing midnight) aren't
// supported here — same limitation as the rest of this file's shift-window
// logic (see markMissingAttendanceAsAbsent / getShiftForEmployee callers).
const END_REMINDER_GRACE_MIN    = 15; // minutes after shift end before nagging about checkout
const END_REMINDER_WINDOW_MIN   = 30; // width of the checkout-reminder window
const REPEAT_REMINDER_GAP_MIN   = 15; // how often the "still haven't checked in" nudge repeats

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Minutes since IST midnight, "now".
function nowISTMinutes() {
  const nowIST = new Date(Date.now() + IST_OFFSET_MS);
  return nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
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
  } catch (e) { console.error('[shift-reminders] notify failed:', e.message); }
}

// Dedup log for shift reminders — one ShiftReminderLog row per
// (user, date, reminder_type), tracking when it last fired. Recency-based
// (not "has this ever fired today") so the post-shift "you haven't checked
// in" nudge can repeat every N minutes until the employee actually checks
// in, while the once-daily pre-shift reminder just uses a gap wider than a
// single day so it only ever fires once.
async function alreadyRemindedRecently(userId, date, reminderType, minGapMinutes) {
  const row = await one(
    "SELECT id,data FROM entities WHERE type='ShiftReminderLog' AND user_id=$1 AND data::jsonb->>'date'=$2 AND data::jsonb->>'reminder_type'=$3",
    [userId, date, reminderType]
  );
  if (!row) return { already: false, rowId: null };
  const d = JSON.parse(row.data);
  const elapsedMin = (Date.now() - new Date(d.sent_at).getTime()) / 60000;
  return { already: elapsedMin < minGapMinutes, rowId: row.id };
}

async function markReminded(userId, date, reminderType, rowId) {
  const now = new Date().toISOString();
  if (rowId) {
    await run(
      "UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2",
      [JSON.stringify({ id: rowId, user_id: userId, date, reminder_type: reminderType, sent_at: now }), rowId]
    );
  } else {
    const id = uuidv4();
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ShiftReminderLog',$2,'sent',$3)",
      [id, userId, JSON.stringify({ id, user_id: userId, date, reminder_type: reminderType, sent_at: now })]
    );
  }
}

export async function sendShiftStartReminders() {
  const date = istDateString(0);
  const weekday = WEEKDAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()];
  const nowMin = nowISTMinutes();

  const holidayRow = await one("SELECT id FROM entities WHERE type='Holiday' AND data::jsonb->>'date'=$1 AND data::jsonb->>'is_half_day' IS DISTINCT FROM 'true'", [date]);
  if (holidayRow) return { date, checked: 0, sent: 0, reason: 'company holiday' };

  const employees = (await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"))
    .map(r => JSON.parse(r.data))
    .filter(e => e.user_id && !e.is_attendance_exempt)
    .filter(e => !e.date_of_joining || e.date_of_joining <= date);
  if (employees.length === 0) return { date, checked: 0, sent: 0 };

  const defaultShift = await getDefaultShift();
  const approvedLeaves = (await all(
    "SELECT data FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'start_date'<=$1 AND data::jsonb->>'end_date'>=$1",
    [date]
  )).map(r => JSON.parse(r.data));
  const onLeaveUserIds = new Set(approvedLeaves.map(l => l.user_id));

  let checked = 0, sent = 0;
  for (const emp of employees) {
    if (onLeaveUserIds.has(emp.user_id)) continue;

    const shift = await getShiftForEmployee(emp, defaultShift);
    const workingDays = Array.isArray(shift.days) && shift.days.length ? shift.days : defaultShift.days;
    if (workingDays && !workingDays.includes(weekday)) continue; // scheduled off-day

    const startMin = toMinutes(shift.start_time || defaultShift.start_time);
    const grace = Number(shift.grace_period_minutes ?? defaultShift.grace_period_minutes ?? 15);
    const windowStart = startMin + grace;
    // No upper bound on the window — keeps repeating (throttled to once per
    // REPEAT_REMINDER_GAP_MIN below) for as long as the employee still
    // hasn't checked in, rather than firing once in a narrow window after
    // grace and then falling silent for the rest of the day.
    if (nowMin < windowStart) continue;
    checked++;

    const existing = await one(
      "SELECT id FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
      [emp.user_id, date]
    );
    if (existing) continue; // already has a record (checked in, regularised, etc.)

    const { already, rowId } = await alreadyRemindedRecently(emp.user_id, date, 'post_shift_checkin', REPEAT_REMINDER_GAP_MIN);
    if (already) continue;

    await notifyUser(emp.user_id, {
      title: 'Your shift has started',
      message: `Your shift started at ${shift.start_time || defaultShift.start_time} and you haven't checked in yet.`,
      type: 'warning',
      link: '/Attendance',
    });
    await markReminded(emp.user_id, date, 'post_shift_checkin', rowId);
    sent++;
  }
  return { date, checked, sent };
}

// ── Pre-shift "starting soon" reminder — fires once, ~10 minutes before
// each employee's shift starts. Runs alongside sendShiftStartReminders on
// the same 5-minute cron tick; PRE_SHIFT_LEAD_MIN's window is sized to the
// cron cadence so it can't be skipped between ticks.
const PRE_SHIFT_LEAD_MIN = 10;
export async function sendPreShiftReminders() {
  const date = istDateString(0);
  const weekday = WEEKDAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()];
  const nowMin = nowISTMinutes();

  const holidayRow = await one("SELECT id FROM entities WHERE type='Holiday' AND data::jsonb->>'date'=$1 AND data::jsonb->>'is_half_day' IS DISTINCT FROM 'true'", [date]);
  if (holidayRow) return { date, checked: 0, sent: 0, reason: 'company holiday' };

  const employees = (await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"))
    .map(r => JSON.parse(r.data))
    .filter(e => e.user_id && !e.is_attendance_exempt)
    .filter(e => !e.date_of_joining || e.date_of_joining <= date);
  if (employees.length === 0) return { date, checked: 0, sent: 0 };

  const defaultShift = await getDefaultShift();
  const approvedLeaves = (await all(
    "SELECT data FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'start_date'<=$1 AND data::jsonb->>'end_date'>=$1",
    [date]
  )).map(r => JSON.parse(r.data));
  const onLeaveUserIds = new Set(approvedLeaves.map(l => l.user_id));

  let checked = 0, sent = 0;
  for (const emp of employees) {
    if (onLeaveUserIds.has(emp.user_id)) continue;

    const shift = await getShiftForEmployee(emp, defaultShift);
    const workingDays = Array.isArray(shift.days) && shift.days.length ? shift.days : defaultShift.days;
    if (workingDays && !workingDays.includes(weekday)) continue;

    const startMin = toMinutes(shift.start_time || defaultShift.start_time);
    const targetMin = startMin - PRE_SHIFT_LEAD_MIN;
    // A 5-minute-wide window matching the cron cadence — wide enough that
    // one tick always lands inside it, narrow enough it only fires once.
    if (nowMin < targetMin || nowMin >= targetMin + 5) continue;
    checked++;

    const { already, rowId } = await alreadyRemindedRecently(emp.user_id, date, 'pre_shift', 12 * 60);
    if (already) continue;

    await notifyUser(emp.user_id, {
      title: 'Your shift starts soon',
      message: `Your shift starts at ${shift.start_time || defaultShift.start_time} in about ${PRE_SHIFT_LEAD_MIN} minutes.`,
      type: 'info',
      link: '/Attendance',
    });
    await markReminded(emp.user_id, date, 'pre_shift', rowId);
    sent++;
  }
  return { date, checked, sent };
}

export async function sendShiftEndReminders() {
  const date = istDateString(0);
  const nowMin = nowISTMinutes();

  const rows = await all(
    "SELECT id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1 AND data::jsonb->>'is_in_progress'='true'",
    [date]
  );
  if (rows.length === 0) return { date, checked: 0, sent: 0 };

  const defaultShift = await getDefaultShift();
  const empCache = {};
  let sent = 0;

  for (const row of rows) {
    const d = JSON.parse(row.data);
    if (d.status === 'regularised' || d.checkout_reminder_sent) continue;

    if (!(d.user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [d.user_id]);
      empCache[d.user_id] = empRow ? JSON.parse(empRow.data) : {};
    }
    const shift = await getShiftForEmployee(empCache[d.user_id], defaultShift);
    const endMin = toMinutes(shift.end_time || defaultShift.end_time);
    const windowStart = endMin + END_REMINDER_GRACE_MIN;
    const windowEnd = windowStart + END_REMINDER_WINDOW_MIN;
    if (nowMin < windowStart || nowMin >= windowEnd) continue;

    await notifyUser(d.user_id, {
      title: "Don't forget to check out",
      message: `Your shift ended at ${shift.end_time || defaultShift.end_time} and you're still checked in.`,
      type: 'warning',
      link: '/Attendance',
    });
    await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [
      JSON.stringify({ ...d, checkout_reminder_sent: true }), row.id,
    ]);
    sent++;
  }
  return { date, checked: rows.length, sent };
}

// ── Repeated-lateness alert to HR/admin + reporting manager ──────────────
// Runs once daily. Counts each employee's 'late' Attendance days within the
// current IST week (Monday–today) and, once someone crosses the threshold,
// notifies HR/admin plus their reporting manager — once per employee per
// week, even if they rack up further late days afterward.
const LATE_THRESHOLD_PER_WEEK = 3;

async function getHrAdminUserIds() {
  const rows = await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')");
  return rows.map(r => r.id);
}

// Monday of the IST week containing `date` (YYYY-MM-DD).
function istWeekStart(date) {
  const d = new Date(date + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function checkRepeatedLateArrivals() {
  const today = istDateString(0);
  const weekStart = istWeekStart(today);

  const lateRows = await all(
    "SELECT user_id FROM entities WHERE type='Attendance' AND data::jsonb->>'status'='late' AND data::jsonb->>'date'>=$1 AND data::jsonb->>'date'<=$2",
    [weekStart, today]
  );
  if (lateRows.length === 0) return { weekStart, checked: 0, flagged: 0 };

  const countByUser = new Map();
  for (const r of lateRows) countByUser.set(r.user_id, (countByUser.get(r.user_id) || 0) + 1);

  const candidateIds = [...countByUser.entries()].filter(([, c]) => c >= LATE_THRESHOLD_PER_WEEK).map(([id]) => id);
  if (candidateIds.length === 0) return { weekStart, checked: countByUser.size, flagged: 0 };

  const hrAdminIds = await getHrAdminUserIds();
  let flagged = 0;

  for (const userId of candidateIds) {
    const already = await one(
      "SELECT id FROM entities WHERE type='LateArrivalAlertLog' AND user_id=$1 AND data::jsonb->>'week_start'=$2",
      [userId, weekStart]
    );
    if (already) continue;

    const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
    const emp = empRow ? JSON.parse(empRow.data) : {};
    const count = countByUser.get(userId);
    const name = emp.display_name || emp.full_name || 'An employee';
    const message = `${name} has been late ${count} times this week (since ${weekStart}).`;

    const recipients = new Set(hrAdminIds);
    if (emp.reporting_manager_id) recipients.add(emp.reporting_manager_id);
    recipients.delete(userId); // don't alert the late employee about themselves

    for (const rid of recipients) {
      await notifyUser(rid, {
        title: 'Repeated Late Arrivals',
        message,
        type: 'warning',
        link: '/AllAttendance',
      });
    }

    const logId = uuidv4();
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LateArrivalAlertLog',$2,'sent',$3)",
      [logId, userId, JSON.stringify({ id: logId, user_id: userId, week_start: weekStart, late_count: count, sent_at: new Date().toISOString() })]
    );
    flagged++;
  }
  return { weekStart, checked: countByUser.size, flagged };
}

export async function runNightlyAttendanceAutomation(targetDate) {
  const date = targetDate || istDateString(-1);
  const noRecord = await markMissingAttendanceAsAbsent(date);
  const unclosed = await closeUnfinishedSessions(date);
  console.log(`[attendance-cron] ${date} — no-record absent: ${noRecord.marked}/${noRecord.checked}, unclosed sessions closed: ${unclosed.marked}/${unclosed.checked}`);
  return { date, noRecord, unclosed };
}
