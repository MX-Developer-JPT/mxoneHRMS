/**
 * External Attendance Log API
 * Receives punch events from biometric devices / external attendance apps.
 *
 * Auth: Bearer token using ATTENDANCE_API_KEY env var (set in Railway).
 *
 * POST /api/attendance-log
 * Body (single eBio punch):
 *   { EmployeeCode, LogDate, Direction, DeviceName?, SerialNumber?, VerificationType? }
 * Body (direct format):
 *   { employee_code, punch_time, type: "in"|"out", device_id? }
 * Body (batch):
 *   { records: [...] }
 *
 * All punches are stored as AttendanceLog entities regardless of employee match.
 * If employee is found (by employee_code or biometric_id), Attendance record is also updated.
 */

import express from 'express';
import { one, all, run } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const DEDUP_THRESHOLD_MS = 60 * 1000; // 60 seconds — ignore duplicate punches within this window

async function getApiKey() {
  if (process.env.ATTENDANCE_API_KEY) return process.env.ATTENDANCE_API_KEY;
  try {
    const row = await one("SELECT value FROM settings WHERE key='attendance_api_key'");
    return row?.value || null;
  } catch { return null; }
}

async function authMiddleware(req, res, next) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(401).json({ error: 'Attendance API key not configured. Generate one in HRMS Settings.' });
  }
  const header = req.headers['authorization'] || req.headers['x-api-key'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key', hint: 'Set Authorization: Bearer <key> header' });
  }
  next();
}

// Resolve shift for an employee (by shift_id or default shift)
async function getShift(empData) {
  if (empData?.shift_id) {
    const row = await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [empData.shift_id]);
    if (row) return JSON.parse(row.data);
  }
  const row = await one(
    "SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'is_default'='1') LIMIT 1"
  );
  return row ? JSON.parse(row.data) : { start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15 };
}

/**
 * Build sessions, breaks, and working-time summary from raw punches.
 *
 * Alternating-position model:
 *   1st punch → Check In (Session 1)
 *   2nd punch → Check Out (Session 1)
 *   3rd punch → Check In (Session 2)  …
 *
 * rawPunches: [{ time: ISO, device_direction: 'IN'|'OUT' }]
 */
export function buildSessions(rawPunches) {
  if (!rawPunches || rawPunches.length === 0) {
    return {
      raw_punches: [], sessions: [], breaks: [], punch_sessions: [],
      total_working_minutes: 0, total_break_minutes: 0,
      session_count: 0, punch_count: 0, is_in_progress: false,
      check_in_time: null, check_out_time: null,
      working_hours: 0, break_hours: 0,
    };
  }

  // Strip punches with missing or unparseable timestamps before sorting.
  // An empty-string or null time would sort before real timestamps (falsy → position 0)
  // and produce sessions[0].check_in = "" → check_in_time = null, which is the root
  // cause of "First In: — / Last Out: 10:06 AM" display bug.
  const validPunches = rawPunches.filter(p => {
    const t = String(p?.time ?? '').trim();
    if (!t || t === 'null' || t === 'undefined') return false;
    const ms = new Date(t.replace(' ', 'T')).getTime();
    if (isNaN(ms) || ms <= 0) return false;
    // Reject exact midnight (00:00:00) — biometric devices write this as a daily-reset or
    // placeholder row when the actual punch time was not captured. These entries sort
    // before any real punch and corrupt sessions: the real arrival ends up at the check_out
    // position instead of check_in, making the all-attendance page show arrival as "Last Out".
    if (/[T ]00:00:00/.test(t)) return false;
    return true;
  });
  if (validPunches.length === 0) {
    return {
      raw_punches: [], sessions: [], breaks: [], punch_sessions: [],
      total_working_minutes: 0, total_break_minutes: 0,
      session_count: 0, punch_count: 0, is_in_progress: false,
      check_in_time: null, check_out_time: null,
      working_hours: 0, break_hours: 0,
    };
  }

  // Sort chronologically — normalise space→T first so mixed-format logs sort correctly
  const sorted = [...validPunches]
    .map(p => ({ ...p, time: String(p.time).trim().replace(' ', 'T') }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // Deduplicate: skip punches within DEDUP_THRESHOLD_MS of the previous accepted punch
  const deduped = [];
  for (const p of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && new Date(p.time).getTime() - new Date(last.time).getTime() < DEDUP_THRESHOLD_MS) continue;
    deduped.push(p);
  }

  // Build in/out pairs (alternating position, not device direction)
  const sessions = [];
  for (let i = 0; i < deduped.length; i += 2) {
    const inP  = deduped[i];
    const outP = deduped[i + 1] || null;
    const duration_minutes = outP
      ? Math.round((new Date(outP.time) - new Date(inP.time)) / 60000)
      : null;
    sessions.push({
      session_number: Math.floor(i / 2) + 1,
      check_in:  inP.time,
      check_out: outP?.time || null,
      duration_minutes,
      is_complete: !!outP,
    });
  }

  // Build breaks between consecutive sessions
  const breaks = [];
  for (let i = 0; i < sessions.length - 1; i++) {
    const prev = sessions[i];
    const next = sessions[i + 1];
    if (prev.check_out && next.check_in) {
      breaks.push({
        break_number: i + 1,
        start: prev.check_out,
        end:   next.check_in,
        duration_minutes: Math.round((new Date(next.check_in) - new Date(prev.check_out)) / 60000),
      });
    }
  }

  const total_working_minutes = sessions.reduce((s, sess) => s + (sess.duration_minutes || 0), 0);
  const total_break_minutes   = breaks.reduce((s, b) => s + b.duration_minutes, 0);
  const is_in_progress        = deduped.length % 2 === 1; // odd punches → last is an open check-in

  const check_in_time  = sessions[0]?.check_in || null;
  const completeSess   = sessions.filter(s => s.is_complete);
  const check_out_time = completeSess.length ? completeSess[completeSess.length - 1].check_out : null;

  // punch_sessions: rich format consumed by AttendanceDetailsDialog
  const punch_sessions = sessions.map((sess, i) => ({
    session_number:    sess.session_number,
    punch_in:          sess.check_in,
    punch_out:         sess.check_out,
    duration_hours:    sess.duration_minutes != null ? Math.round(sess.duration_minutes * 100 / 60) / 100 : null,
    break_before_hours: i > 0 && breaks[i - 1] ? Math.round(breaks[i - 1].duration_minutes * 100 / 60) / 100 : 0,
  }));

  return {
    raw_punches: deduped,
    sessions,
    breaks,
    punch_sessions,
    total_working_minutes,
    total_break_minutes,
    session_count:  sessions.length,
    punch_count:    deduped.length,
    is_in_progress,
    check_in_time,
    check_out_time,
    working_hours: Math.round(total_working_minutes / 60 * 100) / 100,
    break_hours:   Math.round(total_break_minutes   / 60 * 100) / 100,
  };
}

/**
 * Derive attendance status + late/early/overtime figures from session summary + shift config.
 *
 * late_minutes / late_arrival(_minutes) — first check-in vs shift start + grace.
 * early_departure(_minutes) — last check-out vs shift end - grace (only once the day is
 * complete, i.e. not still in_progress — an open session isn't "early" yet).
 * overtime_minutes — last check-out beyond shift end + grace.
 */
export function computeStatusFromSessions(sessionData, shift) {
  const toMins    = (t) => { const [h, m] = String(t || '00:00').split(':').map(Number); return h * 60 + m; };
  const isoToMins = (iso) => toMins(iso ? iso.slice(11, 16) : null);

  const { total_working_minutes, is_in_progress, check_in_time, check_out_time } = sessionData;
  const shiftStart = toMins(shift.start_time || '09:00');
  const shiftEnd   = toMins(shift.end_time   || '18:00');
  const grace      = Number(shift.grace_period_minutes || 15);
  const shiftHours = Number(shift.working_hours || 9);

  let status = 'present', late_minutes = 0, early_departure_minutes = 0, overtime_minutes = 0;

  if (is_in_progress && total_working_minutes === 0) {
    status = 'in_progress';
  } else if (is_in_progress) {
    // Still working — don't finalise status yet
    status = 'in_progress';
  } else if (total_working_minutes > 0) {
    const wh = total_working_minutes / 60;
    if (wh < shiftHours / 2)    status = 'short_attendance';
    else if (wh < shiftHours * 0.9) status = 'half_day';
    else status = 'present';
  }

  if (check_in_time) {
    const firstInMins = isoToMins(check_in_time);
    if (firstInMins !== null && firstInMins > shiftStart + grace) {
      late_minutes = firstInMins - shiftStart - grace;
      if (status === 'present') status = 'late';
    }
  }

  if (!is_in_progress && check_out_time) {
    const lastOutMins = isoToMins(check_out_time);
    if (lastOutMins !== null) {
      if (lastOutMins < shiftEnd - grace)      early_departure_minutes = shiftEnd - grace - lastOutMins;
      else if (lastOutMins > shiftEnd + grace) overtime_minutes = lastOutMins - shiftEnd - grace;
    }
  }

  return {
    status, late_minutes, early_departure_minutes, overtime_minutes,
    late_arrival: late_minutes > 0,
    late_arrival_minutes: late_minutes,
    early_departure: early_departure_minutes > 0,
  };
}

async function processRecord(record) {
  // Normalise field names — accept eBio Pascal-case and snake_case formats
  const codeStr    = String(record.employee_code || record.EmployeeCode || '');
  const directUid  = record.user_id;
  // When LogDate is explicitly "" (MxOneSync sends this when the eBioServer DB column is NULL),
  // do NOT fall back to DownloadDate — that's the sync timestamp, not the actual punch time.
  // Only use DownloadDate when LogDate is entirely absent (undefined / not sent).
  const logDate    = record.LogDate;
  const punch_time = record.punch_time ||
    (logDate !== undefined ? (logDate || null) : null) ||
    (logDate === undefined ? record.DownloadDate : null);
  const dirRaw     = (record.type || record.Direction || 'IN').toString().toUpperCase();
  const direction  = dirRaw === 'OUT' || dirRaw === 'EXIT' ? 'OUT' : 'IN';
  const deviceName = record.DeviceName || record.device_id || null;
  const serial     = record.SerialNumber || null;
  const verType    = record.VerificationType || null;

  if (!punch_time) return { ok: false, reason: 'punch_time is required' };

  // "Store IST, display IST" — biometric devices send local IST time without timezone info.
  const punchIso = (() => {
    const clean = String(punch_time).trim().replace(' ', 'T');
    if (!/Z$|[+-]\d{2}:?\d{2}$/.test(clean)) {
      return clean.replace(/(\.\d+)?$/, '.000Z');
    }
    const IST_MS = 5.5 * 60 * 60 * 1000;
    return new Date(new Date(clean).getTime() + IST_MS).toISOString();
  })();
  // Reject midnight — the biometric device writes 00:00:00 as a daily-reset or placeholder
  // row when it cannot record the actual punch time. Storing it creates a ghost punch that
  // chronologically precedes the real arrival, pushing the real arrival into the check_out
  // slot in buildSessions and displaying it as "Last Out" instead of "First In".
  if (/T00:00:00\.000Z$/.test(punchIso)) {
    return { ok: false, reason: 'punch_time is midnight (00:00:00) — biometric device placeholder, not a real punch. Skipped.' };
  }

  const punchDate = punchIso.slice(0, 10);

  // 1. Resolve employee
  let userId = directUid || null;
  let empData = null;
  if (!userId && codeStr) {
    const mappingRow = await one(
      "SELECT data FROM entities WHERE type='BiometricCodeMapping' AND data::jsonb->>'biometric_code'=$1 LIMIT 1",
      [codeStr]
    );
    if (mappingRow) {
      const m = JSON.parse(mappingRow.data);
      userId = m.user_id || null;
    }
    if (!userId) {
      const empRow = await one(
        "SELECT user_id, data FROM entities WHERE type='Employee' AND (data::jsonb->>'employee_code'=$1 OR data::jsonb->>'biometric_id'=$1) LIMIT 1",
        [codeStr]
      );
      if (empRow) { userId = empRow.user_id; empData = JSON.parse(empRow.data); }
    }
  }
  if (userId && !empData) {
    const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1 LIMIT 1", [userId]);
    if (empRow) empData = JSON.parse(empRow.data);
  }

  // 2. Store raw punch as AttendanceLog (deduplicate by code + exact timestamp)
  let logStored = false;
  const existingLog = await one(
    "SELECT id FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'EmployeeCode'=$1 AND data::jsonb->>'LogDate'=$2",
    [codeStr, punchIso]
  );
  if (!existingLog) {
    const logId = uuidv4();
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceLog',$2,'active',$3)",
      [logId, userId || null, JSON.stringify({
        id: logId,
        EmployeeCode: codeStr,
        LogDate: punchIso,
        Direction: direction,
        DeviceName: deviceName,
        SerialNumber: serial,
        VerificationType: verType,
        user_id: userId || null,
        ProcessedAt: new Date().toISOString(),
        source: 'webhook',
      })]
    );
    logStored = true;
  }

  if (!userId) {
    return {
      ok: true, log_stored: logStored, attendance_updated: false,
      note: `employee_code=${codeStr} not yet mapped — set the Biometric ID on the employee record`,
    };
  }

  // 3. Find or create today's Attendance record
  const row = await one(
    "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
    [userId, punchDate]
  );

  const shift = await getShift(empData);
  const newPunch = { time: punchIso, device_direction: direction };

  if (!row) {
    // First punch of the day — create new Attendance record
    const sd = buildSessions([newPunch]);
    const statusResult = computeStatusFromSessions(sd, shift);
    const { status } = statusResult;
    const id = uuidv4();
    const attData = {
      id, user_id: userId, date: punchDate,
      source: 'biometric', biometric_synced: true, device_id: deviceName,
      employee_code: empData?.employee_code || codeStr,
      ...sd, ...statusResult,
    };
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)",
      [id, userId, status, JSON.stringify(attData)]
    );
    return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: id, action: 'created', status };
  }

  // 4. Update existing — never overwrite a regularised record
  const data = JSON.parse(row.data);
  if (data.status === 'regularised') {
    return { ok: true, log_stored: logStored, attendance_updated: false, attendance_id: row.id, action: 'skipped_regularised' };
  }

  // Merge new punch into the existing raw_punches list and rebuild sessions
  const existingPunches = data.raw_punches || [];
  // Also migrate old punch_sessions format (time/type) if raw_punches not yet present
  if (!existingPunches.length && Array.isArray(data.punch_sessions)) {
    const oldFmt = data.punch_sessions.filter(s => s.time); // old format has .time
    if (oldFmt.length) {
      const inTimes  = data.check_in_time  ? [data.check_in_time]  : [];
      const outTimes = data.check_out_time ? [data.check_out_time] : [];
      // Collect unique times from old sessions
      oldFmt.forEach(s => {
        if (s.type === 'in' && !existingPunches.find(p => p.time === s.time))
          existingPunches.push({ time: s.time, device_direction: 'IN' });
        if (s.type === 'out' && !existingPunches.find(p => p.time === s.time))
          existingPunches.push({ time: s.time, device_direction: 'OUT' });
      });
    }
  }

  // Add new punch if not already present — compare by millisecond value so that
  // "2026-06-29T10:23:40" and "2026-06-29T10:23:40.000Z" are treated as the same punch.
  const punchMs = new Date(punchIso).getTime();
  const alreadyPresent = existingPunches.some(p => {
    const t = String(p?.time ?? '').trim().replace(' ', 'T');
    return Math.abs(new Date(t).getTime() - punchMs) < 1000; // within 1 second = same tap
  });
  const mergedPunches  = alreadyPresent ? existingPunches : [...existingPunches, newPunch];

  const sd = buildSessions(mergedPunches);
  const statusResult = computeStatusFromSessions(sd, shift);
  const { status } = statusResult;

  const updated = {
    ...data,
    biometric_synced: true,
    device_id: deviceName || data.device_id,
    employee_code: empData?.employee_code || data.employee_code || codeStr,
    ...sd, ...statusResult,
  };

  await run(
    "UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3",
    [status, JSON.stringify(updated), row.id]
  );
  return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: row.id, action: 'updated', status };
}

// Single / batch punch
router.post('/', authMiddleware, async (req, res) => {
  try {
    const body = req.body;

    if (Array.isArray(body.records)) {
      const results = await Promise.all(
        body.records.map(r => processRecord(r).catch(e => ({ ok: false, reason: e.message })))
      );
      const logsStored = results.filter(r => r.ok && r.log_stored).length;
      const attUpdated = results.filter(r => r.ok && r.attendance_updated).length;
      const unmapped   = results.filter(r => r.ok && !r.attendance_updated).length;
      return res.json({
        success: true,
        processed: results.length,
        logs_stored: logsStored,
        attendance_updated: attUpdated,
        unmapped_employees: unmapped,
        results,
      });
    }

    const result = await processRecord(body);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Reprocess existing AttendanceLogs for a date range into Attendance records
router.post('/reprocess', authMiddleware, async (req, res) => {
  try {
    const { date_from, date_to } = req.body;
    if (!date_from) return res.status(400).json({ error: 'date_from is required (yyyy-MM-dd)' });
    const toDate = date_to || date_from;

    const logRows = await all("SELECT data FROM entities WHERE type='AttendanceLog'");
    const logsInRange = logRows
      .map(r => JSON.parse(r.data))
      .filter(log => {
        const d = log.LogDate ? String(log.LogDate).slice(0, 10) : null;
        return d && d >= date_from && d <= toDate;
      });

    if (logsInRange.length === 0)
      return res.json({ success: true, total_logs: 0, attendance_updated: 0, message: 'No logs found in date range' });

    const results = await Promise.all(logsInRange.map(log => {
      const record = {
        employee_code: log.EmployeeCode || log.employee_code || '',
        user_id: log.user_id || null,
        punch_time: log.LogDate,
        type: (log.Direction || log.type || 'IN').toUpperCase() === 'OUT' ? 'out' : 'in',
        device_id: log.DeviceName || log.device_id || null,
      };
      return processRecord(record).catch(e => ({ ok: false, reason: e.message }));
    }));

    const updated = results.filter(r => r.ok && r.attendance_updated).length;
    const skipped = results.filter(r => r.ok && !r.attendance_updated).length;
    const errors  = results.filter(r => !r.ok).length;

    return res.json({ success: true, total_logs: logsInRange.length, attendance_updated: updated, skipped, errors });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Docs endpoint
router.get('/', (_req, res) => {
  res.json({
    description: 'Maxvolt One — External Attendance Log API',
    version: '3.0',
    auth: 'Authorization: Bearer <ATTENDANCE_API_KEY>',
    note: 'Punches interpreted by alternating position (1st=In, 2nd=Out, 3rd=In…). Sessions and break times calculated automatically.',
    endpoints: {
      'POST /api/attendance-log': {
        eBio:   { EmployeeCode: 'string', LogDate: 'ISO8601', Direction: 'IN|OUT', DeviceName: 'optional' },
        direct: { employee_code: 'string', punch_time: 'ISO8601', type: '"in"|"out"' },
        batch:  { records: '[{ EmployeeCode, LogDate, Direction }]' },
      },
      'POST /api/attendance-log/reprocess': { date_from: 'yyyy-MM-dd', date_to: 'yyyy-MM-dd (optional)' },
    },
  });
});

export default router;
