// Admin Panel → Regularisation Deletion (rg_* functions, admin only). Deletes a regularisation request completely, in any
// status. If the request had changed the day's attendance, the day is put back to what it is without it: the copy saved at
// approval when there is one, otherwise rebuilt from the punches actually recorded. A day edited by an admin or covered by
// leave keeps its attendance; another approved request for the same day is applied again.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { regularisedTimes } from '../utils/attendanceRules.js';
import { dayWithoutRegularisation, applyRequest, APPLIED_STATUSES, ownsDay, summary } from '../utils/regularisationRestore.js';
import { buildSessions, closeTrailingOpenSession, computeStatusFromSessions, applyDeclaredStatus, applyHalfDayLeaveStatus, getHalfDayOverrideHours, getShift } from './attendancelog.js';
import { markMissingAttendanceAsAbsent } from '../cron/attendanceAutomation.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
const dateOf = (r) => String(r.attendance_date || r.date || '').slice(0, 10);
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function employeeOf(userId) {
  const row = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
  return (row && parse(row.data)) || {};
}

// every machine punch of this person on the day, minus any that the previous day's record already carries (night shift)
async function loggedPunches(userId, emp, date) {
  const codes = [emp.employee_code, emp.biometric_id].filter(Boolean).map((c) => String(c).trim().toUpperCase());
  for (const r of await all("SELECT data FROM entities WHERE type='BiometricCodeMapping' AND data::jsonb->>'user_id'=$1", [userId])) { const m = parse(r.data); if (m?.biometric_code) codes.push(String(m.biometric_code).trim().toUpperCase()); }
  const rows = await all("SELECT data FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'LogDate' LIKE $1 AND (data::jsonb->>'user_id'=$2 OR (COALESCE(data::jsonb->>'user_id','')='' AND UPPER(TRIM(data::jsonb->>'EmployeeCode')) = ANY($3::text[])))", [`${date}%`, userId, codes]);
  const previous = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const prevRow = await one("SELECT data FROM entities WHERE type='Attendance' AND (user_id=$1 OR data::jsonb->>'user_id'=$1) AND data::jsonb->>'date'=$2", [userId, previous]);
  const prev = prevRow ? parse(prevRow.data) : null;
  const taken = [...(prev?.raw_punches || []), ...(prev?.biometric_punches || [])].map((p) => Date.parse(String(p.time).replace(' ', 'T')));
  return rows.map((r) => parse(r.data)).filter(Boolean).map((l) => ({ time: String(l.LogDate).trim().replace(' ', 'T'), device_direction: ['OUT', 'EXIT'].includes(String(l.Direction || '').toUpperCase()) ? 'OUT' : 'IN' }))
    .filter((p) => !/T00:00:00(\.000)?Z?$/.test(p.time) && !taken.some((t) => Math.abs(t - Date.parse(p.time)) < 1000));
}

/** What deleting this request does to the day. Reads only. */
async function plan(reg) {
  const date = dateOf(reg);
  const row = date ? await one("SELECT id, data FROM entities WHERE type='Attendance' AND (user_id=$1 OR data::jsonb->>'user_id'=$1) AND data::jsonb->>'date'=$2", [reg.user_id, date]) : null;
  const att = row ? parse(row.data) : null;
  const others = (await all("SELECT id, data FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1 AND id<>$2", [reg.user_id, reg.id]))
    .map((r) => ({ ...parse(r.data), id: r.id })).filter((r) => dateOf(r) === date && APPLIED_STATUSES.includes(r.status))
    .sort((a, b) => String(b.hr_approved_at || b.manager_approved_at || '').localeCompare(String(a.hr_approved_at || a.manager_approved_at || '')));
  if (!att || !ownsDay(att, reg)) return { date, row, action: 'unchanged', before: att && summary(att), after: att && summary(att), note: 'This request is not what set the attendance of that day, so attendance does not change.' };

  const emp = await employeeOf(reg.user_id);
  const shift = await getShift(emp);
  const halfHours = await getHalfDayOverrideHours(date, shift);
  const punches = await loggedPunches(reg.user_id, emp, date);
  const engine = { buildSessions, closeTrailingOpenSession, applyDeclaredStatus, applyHalfDayLeaveStatus, compute: (sd) => computeStatusFromSessions(sd, shift, halfHours) };
  const result = dayWithoutRegularisation(att, reg, punches, { past: date < istToday(), engine });
  let { day } = result;
  let note = result.note;
  if (result.action !== 'kept' && others[0]) {
    day = applyRequest(day || { id: att.id, user_id: reg.user_id, date, created_by_regularisation: true }, others[0], regularisedTimes(others[0], day, date), engine);
    note = 'Another approved request for this day is applied again.';
  }
  const action = result.action === 'kept' ? 'kept' : day ? 'restored' : 'removed';
  return { date, row, emp, action, day, note, before: summary(att), after: day ? summary(day) : null };
}

async function load(id) {
  const row = id ? await one("SELECT data FROM entities WHERE type='AttendanceRegularisation' AND id=$1", [id]) : null;
  return row ? { ...parse(row.data), id } : null;
}

export async function handleRegularisationAdmin(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const u = await one('SELECT role, custom_role, full_name, email FROM users WHERE id=$1', [cu.id]) || {};
  if (![u.role, u.custom_role].includes('admin')) return fail(res, 'Admin access required', 403);

  if (name === 'rg_list') {
    const emps = new Map((await all("SELECT user_id, data FROM entities WHERE type='Employee'")).map((r) => [r.user_id, parse(r.data) || {}]));
    const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : '';
    const q = String(p.search || '').trim().toLowerCase();
    const rows = (await all("SELECT id, data, created_at FROM entities WHERE type='AttendanceRegularisation' ORDER BY created_at DESC")).map((r) => {
      const d = parse(r.data) || {}, e = emps.get(d.user_id) || {};
      return { id: r.id, user_id: d.user_id, employee_name: e.display_name || d.employee_name || '', employee_code: e.employee_code || '', department: e.department || '', date: dateOf(d), status: d.status || '', reason: d.reason || '', requested_status: d.requested_status || 'present', requested_check_in: d.requested_check_in || '', requested_check_out: d.requested_check_out || '', created_at: r.created_at };
    }).filter((r) => (!month || r.date.startsWith(month)) && (!p.status || r.status === p.status) && (!q || `${r.employee_name} ${r.employee_code} ${r.department}`.toLowerCase().includes(q)));
    return res.json({ success: true, total: rows.length, requests: rows.slice(0, 300) });
  }

  const reg = await load(p.regularisation_id);
  if (!reg) return fail(res, 'Regularisation request not found. It may already be deleted.', 404);

  if (name === 'rg_preview') {
    const { date, action, before, after, note } = await plan(reg);
    return res.json({ success: true, date, action, before, after, note });
  }

  if (name === 'rg_delete') {
    const reason = String(p.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return fail(res, 'Give a reason for deleting this request.');
    const done = await plan(reg);
    // the request goes first, so a repeated click finds nothing to do
    const removed = await run("DELETE FROM entities WHERE type='AttendanceRegularisation' AND id=$1", [reg.id]);
    if (removed?.rowCount === 0) return fail(res, 'This request was already deleted.', 404);
    if (done.action === 'removed') {
      await run("DELETE FROM entities WHERE type='Attendance' AND id=$1", [done.row.id]);
      // a past working day with nothing recorded is absent, by the same rules as the nightly job
      if (done.date < istToday()) await markMissingAttendanceAsAbsent(done.date, reg.user_id);
    } else if (done.action === 'restored' || (done.action === 'kept' && done.day)) {
      await run("UPDATE entities SET status=$1, data=$2, user_id=$3, updated_at=NOW()::TEXT WHERE id=$4", [done.day.status || null, JSON.stringify(done.day), reg.user_id, done.row.id]);
    }
    const final = done.row || done.action === 'removed' ? await one("SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2", [reg.user_id, done.date]) : null;
    const after = final ? summary(parse(final.data)) : null;
    const id = uuidv4(), at = new Date().toISOString();
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [id, cu.id, JSON.stringify({ id, entity_type: 'AttendanceRegularisation', entity_id: reg.id, change_type: 'deleted', actor_name: u.full_name || u.email || '', employee_user_id: reg.user_id, attendance_date: done.date, request_status: reg.status, reason, attendance_action: done.action, attendance_before: done.before, attendance_after: after, timestamp: at })]);
    try {
      const title = 'Regularisation request deleted', message = `Your regularisation request for ${done.date} was deleted by an administrator. Reason: ${reason}`;
      await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), reg.user_id, title, message, 'warning', '/AttendanceRegularisation']);
      const { sendPushToUser } = await import('../utils/push.js');
      sendPushToUser(reg.user_id, { title, message, type: 'warning', link: '/AttendanceRegularisation' });
    } catch (e) { console.warn('[regularisation delete] notify failed:', e.message); }
    return res.json({ success: true, date: done.date, action: done.action, before: done.before, after });
  }
  return res.status(400).json({ error: `Unknown function ${name}` });
}
