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
import { one, run } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

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
    // No key configured — reject to prevent unguarded access
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

// Compute attendance status from all sessions + shift
function computeStatus(sessions, shift) {
  const toMins = (t) => {
    const [h, m] = String(t || '00:00').split(':').map(Number);
    return h * 60 + m;
  };
  // Extract HH:MM from ISO string (stored as "IST digits Z")
  const isoToMins = (iso) => toMins(iso ? iso.slice(11, 16) : null);

  const inTimes  = sessions.filter(s => s.type === 'in').map(s => isoToMins(s.time)).sort((a, b) => a - b);
  const outTimes = sessions.filter(s => s.type === 'out').map(s => isoToMins(s.time)).sort((a, b) => b - a);

  const firstInMins  = inTimes[0]  ?? null;
  const lastOutMins  = outTimes[0] ?? null;

  const shiftStart   = toMins(shift.start_time  || '09:00');
  const grace        = Number(shift.grace_period_minutes || 15);
  const shiftHours   = Number(shift.working_hours || 9);

  let status = 'present', working_hours = 0, late_minutes = 0;

  if (firstInMins !== null && lastOutMins !== null && lastOutMins > firstInMins) {
    working_hours = (lastOutMins - firstInMins) / 60;
    if (working_hours < shiftHours / 2) status = 'short_attendance';
    else if (working_hours < shiftHours * 0.9) status = 'half_day';
    else status = 'present';
  } else if (firstInMins !== null) {
    status = 'in_progress'; // checked in, not yet checked out
  }

  if (firstInMins !== null && firstInMins > shiftStart + grace) {
    late_minutes = firstInMins - shiftStart - grace;
    if (status === 'present') status = 'late';
  }

  return { status, working_hours: Math.round(working_hours * 100) / 100, late_minutes };
}

async function processRecord(record) {
  // Normalise field names — accept eBio Pascal-case and snake_case formats
  const codeStr    = String(record.employee_code || record.EmployeeCode || '');
  const directUid  = record.user_id;
  const punch_time = record.punch_time || record.LogDate || record.DownloadDate;
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
  const punchDate = punchIso.slice(0, 10);
  const punchType = direction === 'OUT' ? 'out' : 'in';

  // 1. Resolve employee early so we can set user_id on the AttendanceLog
  let userId = directUid || null;
  let empData = null;
  if (!userId && codeStr) {
    // Try BiometricCodeMapping first, then employee_code, then biometric_id
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

  // No employee match — log stored, attendance deferred until employee is mapped
  if (!userId) {
    return {
      ok: true,
      log_stored: logStored,
      attendance_updated: false,
      note: `employee_code=${codeStr} not yet mapped — set the Biometric ID on the employee record`,
    };
  }

  // 3. Find or create today's Attendance record
  const row = await one(
    "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
    [userId, punchDate]
  );

  // Load shift for status computation
  const shift = await getShift(empData);

  if (!row) {
    // First punch of the day — create new Attendance record
    const sessions = [{ time: punchIso, type: punchType }];
    const computed = computeStatus(sessions, shift);
    const id = uuidv4();
    const attData = {
      id, user_id: userId, date: punchDate,
      check_in_time:  punchType === 'in'  ? punchIso : null,
      check_out_time: punchType === 'out' ? punchIso : null,
      source: 'biometric', biometric_synced: true,
      device_id: deviceName,
      punch_sessions: sessions,
      punch_count: 1,
      employee_code: empData?.employee_code || codeStr,
      ...computed,
    };
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)",
      [id, userId, computed.status, JSON.stringify(attData)]
    );
    return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: id, action: 'created', status: computed.status };
  }

  // 4. Update existing — never overwrite a regularised record
  const data = JSON.parse(row.data);
  if (data.status === 'regularised') {
    return { ok: true, log_stored: logStored, attendance_updated: false, attendance_id: row.id, action: 'skipped_regularised' };
  }

  // Add punch to sessions (deduplicate)
  const sessions = data.punch_sessions || [];
  const alreadyStored = sessions.some(s => s.time === punchIso);
  if (!alreadyStored) sessions.push({ time: punchIso, type: punchType });

  // Recompute check_in / check_out from all sessions
  const inSessions  = sessions.filter(s => s.type === 'in').map(s => s.time).sort();
  const outSessions = sessions.filter(s => s.type === 'out').map(s => s.time).sort();
  const firstIn     = inSessions[0]   || data.check_in_time  || null;
  const lastOut     = outSessions.length ? outSessions[outSessions.length - 1] : (data.check_out_time || null);

  // Recompute status from all punches
  const computed = computeStatus(sessions, shift);

  const updated = {
    ...data,
    check_in_time:   firstIn,
    check_out_time:  lastOut,
    punch_sessions:  sessions,
    punch_count:     sessions.length,
    biometric_synced: true,
    device_id: deviceName || data.device_id,
    employee_code: empData?.employee_code || data.employee_code || codeStr,
    ...computed,
  };

  await run(
    "UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3",
    [computed.status, JSON.stringify(updated), row.id]
  );
  return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: row.id, action: 'updated', status: computed.status };
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
// POST /api/attendance-log/reprocess  { date_from: 'yyyy-MM-dd', date_to: 'yyyy-MM-dd' }
router.post('/reprocess', authMiddleware, async (req, res) => {
  try {
    const { date_from, date_to } = req.body;
    if (!date_from) return res.status(400).json({ error: 'date_from is required (yyyy-MM-dd)' });
    const toDate = date_to || date_from;

    // Pull all AttendanceLogs; the stored LogDate has IST digits with a Z suffix so slice(0,10) gives the date
    const logRows = await all("SELECT data FROM entities WHERE type='AttendanceLog'");
    const logsInRange = logRows
      .map(r => JSON.parse(r.data))
      .filter(log => {
        const d = log.LogDate ? String(log.LogDate).slice(0, 10) : null;
        return d && d >= date_from && d <= toDate;
      });

    if (logsInRange.length === 0)
      return res.json({ success: true, total_logs: 0, attendance_updated: 0, message: 'No logs found in date range' });

    // Re-use processRecord so shift lookup + status computation is identical to live punch flow
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
    description: 'Maxvolt HR — External Attendance Log API',
    version: '2.0',
    auth: 'Authorization: Bearer <ATTENDANCE_API_KEY>',
    note: 'All punches stored as AttendanceLog. Attendance record updated only if employee Biometric ID matches.',
    endpoints: {
      'POST /api/attendance-log': {
        eBio: { EmployeeCode: 'string', LogDate: 'ISO8601', Direction: 'IN|OUT', DeviceName: 'optional' },
        direct: { employee_code: 'string', punch_time: 'ISO8601', type: '"in"|"out"' },
        batch: { records: '[{ EmployeeCode, LogDate, Direction }]' },
      },
    },
  });
});

export default router;
