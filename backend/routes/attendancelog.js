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

  // Biometric devices send local IST time without any timezone suffix (e.g. "2024-01-15 09:30:00").
  // Node.js / Railway runs in UTC, so new Date("2024-01-15 09:30:00") treats it as UTC, storing
  // a timestamp that is 5h 30m ahead of the actual punch. The frontend then adds another +5:30,
  // making the displayed time 5h 30m wrong.
  // Fix: if no timezone marker is present, subtract IST offset (5h 30m) so the stored UTC is correct.
  const IST_MS = 5.5 * 60 * 60 * 1000;
  function deviceTimeToUTC(raw) {
    const s = String(raw).trim().replace(' ', 'T');
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
      // Has explicit timezone — trust it, convert normally
      return new Date(s).toISOString();
    }
    // No timezone info — assume device sends IST, subtract 5:30 to get UTC
    return new Date(new Date(s).getTime() - IST_MS).toISOString();
  }

  const punchIso  = deviceTimeToUTC(punch_time);
  const punchDate = punchIso.slice(0, 10);

  // 1. Always store the raw punch as AttendanceLog (shown in Biometric Attendance Log page)
  //    Deduplicate by EmployeeCode + exact punch timestamp
  let logStored = false;
  const existingLog = await one(
    "SELECT id FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'EmployeeCode'=$1 AND data::jsonb->>'LogDate'=$2",
    [codeStr, punchIso]
  );
  if (!existingLog) {
    const logId = uuidv4();
    await run(
      "INSERT INTO entities(id,type,status,data) VALUES($1,'AttendanceLog','active',$2)",
      [logId, JSON.stringify({
        id: logId,
        EmployeeCode: codeStr,
        LogDate: punchIso,
        Direction: direction,
        DeviceName: deviceName,
        SerialNumber: serial,
        VerificationType: verType,
        ProcessedAt: new Date().toISOString(),
        source: 'webhook',
      })]
    );
    logStored = true;
  }

  // 2. Try to resolve to an HRMS employee (employee_code first, then biometric_id)
  let userId = directUid;
  if (!userId && codeStr) {
    let emp = await one(
      "SELECT user_id FROM entities WHERE type='Employee' AND data::jsonb->>'employee_code'=$1 LIMIT 1",
      [codeStr]
    );
    if (!emp?.user_id) {
      emp = await one(
        "SELECT user_id FROM entities WHERE type='Employee' AND data::jsonb->>'biometric_id'=$1 LIMIT 1",
        [codeStr]
      );
    }
    userId = emp?.user_id;
  }

  // No employee match — log is stored, attendance will be mapped once Biometric ID is set
  if (!userId) {
    return {
      ok: true,
      log_stored: logStored,
      attendance_updated: false,
      note: `employee_code=${codeStr} not yet mapped — set the Biometric ID on the employee record`,
    };
  }

  // 3. Find or create today's Attendance record
  const type = direction === 'OUT' ? 'out' : 'in';
  const row = await one(
    "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
    [userId, punchDate]
  );

  if (!row) {
    const id = uuidv4();
    const data = {
      id, user_id: userId, date: punchDate,
      check_in_time:  type === 'in'  ? punchIso : null,
      check_out_time: type === 'out' ? punchIso : null,
      status: 'present', source: 'biometric', device_id: deviceName,
      punch_sessions: [{ time: punchIso, type }],
    };
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)",
      [id, userId, JSON.stringify(data)]
    );
    return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: id, action: 'created' };
  }

  // Update existing attendance record
  const data = JSON.parse(row.data);
  const sessions = data.punch_sessions || [];
  sessions.push({ time: punchIso, type });
  data.punch_sessions = sessions;
  data.device_id = deviceName || data.device_id;

  if (type === 'in') {
    if (!data.check_in_time || punchIso < data.check_in_time) data.check_in_time = punchIso;
  } else {
    if (!data.check_out_time || punchIso > data.check_out_time) data.check_out_time = punchIso;
  }

  await run(
    "UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2",
    [JSON.stringify(data), row.id]
  );
  return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: row.id, action: 'updated' };
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
