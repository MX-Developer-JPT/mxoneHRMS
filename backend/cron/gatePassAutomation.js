// Gate Pass automation — runs unattended (see server.js for the schedule).
// Closes out any gate pass still 'departed' (marked out by the gate admin,
// never marked back in) once the employee's own shift has ended, so a
// forgotten/never-returning outing doesn't stay "Currently Outside" forever.
//
// Per-outing-type closing rule (mirrors GateAdminDashboard.jsx's own
// calculateLOP exactly, fed the employee's shift-end time as the return
// time — i.e. this produces the same result a gate admin manually clicking
// "Mark Returned" at that exact moment would have gotten):
//   - official_outing:                 status -> returned, present, 0 LOP
//   - unofficial_outing / early_leave: status -> returned, half_day, 0.5 LOP
//   - short_break:                     status -> returned, half_day, 0.5 LOP
//                                       (duration by shift-end is always >3h)
//   - half_day: never expected to return that day — status -> auto_closed
//               (NOT 'returned'), attendance still closed out as half_day
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { shiftEndDateTime } from '../routes/attendancelog.js';

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

// Exact mirror of GateAdminDashboard.jsx's calculateLOP — kept in sync
// deliberately rather than shared, since one lives in frontend bundle scope
// and the other here; if the frontend rule changes, update both.
function calculateLOP(outingType, departureTime, returnTime) {
  if (outingType === 'official_outing' || outingType === 'travelling_to_another_office') return { lopDays: 0, status: 'present' };
  if (outingType === 'short_break') {
    if (!returnTime || !departureTime) return { lopDays: 0.5, status: 'half_day' };
    const durationHrs = (new Date(returnTime) - new Date(departureTime)) / 3600000;
    if (durationHrs <= 3) return { lopDays: 0, status: 'present' };
    return { lopDays: 0.5, status: 'half_day' };
  }
  return { lopDays: 0.5, status: 'half_day' };
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
    const lop = calculateLOP(outingType, pass.departure_time, isHalfDayType ? null : nowISO);

    const updatedPass = {
      ...pass,
      status: isHalfDayType ? 'auto_closed' : 'returned',
      return_time: isHalfDayType ? pass.return_time : nowISO,
      lop_deduction_days: lop.lopDays,
      auto_closed: true,
      auto_closed_reason: isHalfDayType
        ? 'Half-day outing — auto-closed at shift end (no return expected)'
        : `No return recorded by shift end — auto-closed as ${lop.status.replace(/_/g, ' ')}`,
    };
    await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [updatedPass.status, JSON.stringify(updatedPass), row.id]);

    // Mirror GateAdminDashboard.jsx's markReturn attendance side-effect.
    const passDate = pass.request_date || today;
    const attNote = `Gate pass: ${outingType || 'outing'} — auto-closed at shift end, ${lop.lopDays > 0 ? 'LOP deducted' : 'no LOP'}`;
    const existingAtt = await one("SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2", [pass.employee_user_id, passDate]);
    if (existingAtt) {
      const attData = JSON.parse(existingAtt.data);
      const updatedAtt = { ...attData, status: lop.status, lop_applicable: lop.lopDays > 0, lop_deduction_days: lop.lopDays, notes: attNote };
      await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3", [lop.status, JSON.stringify(updatedAtt), existingAtt.id]);
    } else {
      const attId = uuidv4();
      const attData = { id: attId, user_id: pass.employee_user_id, date: passDate, status: lop.status, lop_applicable: lop.lopDays > 0, lop_deduction_days: lop.lopDays, notes: attNote, auto_marked: true };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)", [attId, pass.employee_user_id, lop.status, JSON.stringify(attData)]);
    }

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
        : `${empName} did not return by shift end — gate pass auto-closed as ${lop.status.replace(/_/g, ' ')}${lop.lopDays > 0 ? ` (${lop.lopDays} day LOP)` : ''}.`;
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
