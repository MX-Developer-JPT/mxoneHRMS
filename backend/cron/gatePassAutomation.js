// Gate Pass automation — runs unattended (see server.js for the schedule).
// Closes out any gate pass still 'departed' (marked out by the gate admin,
// never marked back in) once the employee's own shift has ended, so a
// forgotten/never-returning outing doesn't stay "Currently Outside" forever.
// Also closes out any gate pass still 'pending_approval' (manager never
// actioned it) or 'approved' (manager cleared it, but the employee never
// actually left — no gate admin ever marked departure) once the DAY it was
// requested for has fully passed — see closeStaleGatePassRequests below.
// GatePassRequest.jsx treats all three of these statuses as "active" (its
// own activePasses filter), so left unattended they'd otherwise sit in an
// employee's Active Passes list indefinitely.
//
// Closing rule for a pass still 'departed' at shift end (all attendance rules live in attendancelog.js applyGatePassOuting):
//   - official_outing / travelling_to_another_office: full day PRESENT, whatever the check-out time
//   - half_day: attendance was already marked half day at departure (departure = check-out)
//   - unofficial_outing / short_break / early_leave: the DEPARTURE time is used as the check-out and the day is graded by
//     hours actually worked (present / half day / short attendance) - never absent
// The pass becomes 'auto_closed' with NO return time: the employee never came back, so none is invented.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { shiftEndDateTime, applyGatePassOuting, isOfficialOuting } from '../routes/attendancelog.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istNowISO() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString();
}
function istDateString() {
  return istNowISO().slice(0, 10);
}

async function getDefaultShift() {
  const row = await one("SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'is_default'='1') LIMIT 1");
  return row ? JSON.parse(row.data) : { end_time: '18:00' };
}
async function getShiftForEmployee(emp, defaultShift) {
  if (emp?.shift_id) {
    const row = await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id]);
    if (row) return JSON.parse(row.data);
  }
  return defaultShift;
}

async function getHrAdminUserIds() {
  const rows = await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')");
  return rows.map(r => r.id);
}

export async function closeUnreturnedGatePasses() {
  const nowMs = Date.now() + IST_OFFSET_MS;
  const nowISO = istNowISO();
  const today = istDateString();

  const rows = await all("SELECT id, data FROM entities WHERE type='GatePass' AND status='departed'");
  if (rows.length === 0) return { checked: 0, closed: 0 };

  const defaultShift = await getDefaultShift();
  const empCache = {};
  const hrAdminIds = await getHrAdminUserIds();
  let closed = 0;

  for (const row of rows) {
    const pass = JSON.parse(row.data);
    if (!pass.employee_user_id) continue;

    if (!(pass.employee_user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [pass.employee_user_id]);
      empCache[pass.employee_user_id] = empRow ? JSON.parse(empRow.data) : null;
    }
    const emp = empCache[pass.employee_user_id];
    const shift = await getShiftForEmployee(emp, defaultShift);
    // Real datetime comparison, anchored to the day the gate pass was
    // requested — correctly lands an overnight shift's (e.g. 20:00->08:00)
    // end on the day AFTER request_date instead of comparing bare
    // clock-minutes, which previously read almost any evening time as
    // "past" an 08:00 end (480 minutes) and closed the pass out within
    // minutes of departure.
    const passDateForShift = pass.request_date || today;
    const endMs = shiftEndDateTime(passDateForShift, { ...defaultShift, ...shift }).getTime();
    if (nowMs < endMs) continue; // this employee's shift hasn't ended yet

    const outingType = pass.outing_type;
    const isHalfDayType = outingType === 'half_day';
    const official = isOfficialOuting(outingType);

    // Attendance consequence (all rules live in attendancelog.js applyGatePassOuting):
    //  - official / travelling: full day PRESENT whatever the check-out;
    //  - half day: already marked at departure (departure = check-out);
    //  - unofficial / short break / early leave: the DEPARTURE time becomes the check-out and the day is graded by hours
    //    actually worked (present / half day / short attendance) - never absent.
    let att = null;
    try { att = isHalfDayType ? null : await applyGatePassOuting(pass, 'autoclose'); } catch (e) { console.error('[gatepass-auto-close] attendance update failed:', e.message); }
    const resultStatus = official ? 'present' : (att?.status || (isHalfDayType ? 'half_day' : 'short_attendance'));
    const lopDays = resultStatus === 'half_day' ? 0.5 : 0;

    // The pass is closed WITHOUT a return time - the employee never came back, so no "returned" time is invented.
    const updatedPass = {
      ...pass,
      status: 'auto_closed',
      lop_deduction_days: lopDays,
      auto_closed: true,
      auto_closed_at: nowISO,
      auto_closed_reason: isHalfDayType
        ? 'Half-day outing - auto-closed at shift end (no return expected)'
        : official
          ? 'Did not return by shift end - official outing, day counted as full present'
          : `Did not return by shift end - departure time used as check-out, day marked ${resultStatus.replace(/_/g, ' ')}`,
    };
    await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [updatedPass.status, JSON.stringify(updatedPass), row.id]);
    const lop = { status: resultStatus, lopDays };

    // Notify HR/admin, the reporting manager, and the employee — same
    // "who gets told about an automated attendance event" pattern as the
    // shift-reminder and late-arrival crons.
    try {
      const { sendPushToUser } = await import('../utils/push.js');
      const empName = emp?.display_name || 'An employee';
      const recipients = new Set(hrAdminIds);
      if (emp?.reporting_manager_id) recipients.add(emp.reporting_manager_id);
      recipients.add(pass.employee_user_id);
      const title = 'Gate Pass Auto-Closed';
      const message = isHalfDayType
        ? `${empName}'s half-day gate pass was auto-closed at shift end.`
        : official
          ? `${empName} did not return by shift end — official outing, auto-closed and counted as a full present day.`
          : `${empName} did not return by shift end — gate pass auto-closed; departure time used as check-out, day marked ${lop.status.replace(/_/g, ' ')}.`;
      for (const uid of recipients) {
        const nid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, uid, title, message, 'warning', '/GatePassRequest']);
        sendPushToUser(uid, { title, message, type: 'warning', link: '/GatePassRequest' });
      }
    } catch (e) { console.error('[gatepass-auto-close] notify failed:', e.message); }

    closed++;
  }
  return { checked: rows.length, closed };
}

// Closes out any gate pass still 'pending_approval' or 'approved' once the
// calendar day it was requested for (request_date, IST) has fully passed —
// the employee never actually left on it (no departure_time), so there's no
// LOP/attendance consequence to compute; this purely stops a stale request
// from sitting in "Active Passes" forever once its day is over. A simple
// "the date has passed" cutoff (rather than the per-employee shift-end math
// closeUnreturnedGatePasses uses for 'departed') is deliberate: a request
// that was never approved, or approved but never acted on, has no actual
// departure time to reason about — only whether the day it was FOR is done.
export async function closeStaleGatePassRequests() {
  const today = istDateString();

  const rows = await all(
    "SELECT id, data FROM entities WHERE type='GatePass' AND status IN ('pending_approval','approved') AND COALESCE(data::jsonb->>'request_date','') < $1",
    [today]
  );
  if (rows.length === 0) return { checked: 0, closed: 0 };

  const empCache = {};
  const defaultShift = await getDefaultShift();
  const hrAdminIds = await getHrAdminUserIds();
  let closed = 0;

  for (const row of rows) {
    const pass = JSON.parse(row.data);
    if (!pass.employee_user_id) continue;

    if (!(pass.employee_user_id in empCache)) {
      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [pass.employee_user_id]);
      empCache[pass.employee_user_id] = empRow ? JSON.parse(empRow.data) : null;
    }
    const emp = empCache[pass.employee_user_id];
    // A night-shift employee's day runs into the next calendar date — keep their pass open until that shift ends.
    const stShift = await getShiftForEmployee(emp, defaultShift);
    if (Date.now() + IST_OFFSET_MS < shiftEndDateTime(pass.request_date, { ...defaultShift, ...stShift }).getTime()) continue;
    const wasPending = pass.status === 'pending_approval';
    if (pass.status === 'approved' && isOfficialOuting(pass.outing_type)) { try { await applyGatePassOuting(pass, 'approved_unused'); } catch (e) { console.error('[gatepass-stale-close] official attendance failed:', e.message); } }

    const updatedPass = {
      ...pass,
      status: 'auto_closed',
      auto_closed: true,
      auto_closed_reason: wasPending
        ? 'Manager never actioned this request — auto-closed at day end'
        : 'Approved but never marked departed — auto-closed at day end',
    };
    await run("UPDATE entities SET status='auto_closed', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(updatedPass), row.id]);

    try {
      const { sendPushToUser } = await import('../utils/push.js');
      const empName = emp?.display_name || 'An employee';
      const recipients = new Set([pass.employee_user_id]);
      // Only bother HR/manager for the "manager never actioned it" case —
      // an approved-but-unused pass closing out silently is a non-event for
      // anyone but the employee themselves.
      if (wasPending) {
        hrAdminIds.forEach(id => recipients.add(id));
        if (emp?.reporting_manager_id) recipients.add(emp.reporting_manager_id);
      }
      const title = 'Gate Pass Auto-Closed';
      const message = wasPending
        ? `${empName}'s gate pass request for ${pass.request_date} expired unactioned and was auto-closed.`
        : `Your gate pass for ${pass.request_date} was approved but never used — auto-closed at day end.`;
      for (const uid of recipients) {
        const nid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, uid, title, message, 'info', '/GatePassRequest']);
        sendPushToUser(uid, { title, message, type: 'info', link: '/GatePassRequest' });
      }
    } catch (e) { console.error('[gatepass-stale-close] notify failed:', e.message); }

    closed++;
  }
  return { checked: rows.length, closed };
}
