/**
 * External Attendance Log API
 * Receives punch events from biometric devices / external attendance apps.
 *
 * Auth: Bearer token using ATTENDANCE_API_KEY env var (set in Railway).
 * If ATTENDANCE_API_KEY is not set, any request with "Bearer anykey" is accepted
 * (useful for dev). Set it in production.
 *
 * POST /api/attendance-log
 * Body (single punch):
 *   { employee_code, user_id, punch_time, type: "in"|"out", device_id? }
 *
 * Body (batch):
 *   { records: [{ employee_code, user_id, punch_time, type }] }
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
  const header = req.headers['authorization'] || req.headers['x-api-key'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;

  if (apiKey && token !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key', hint: 'Set Authorization: Bearer <key> header' });
  }
  next();
}

function toDateStr(dt) {
  return new Date(dt).toISOString().slice(0, 10);
}

async function processRecord(record) {
  // Accept both eBio webhook format (EmployeeCode, LogDate, Direction) and direct format (employee_code, punch_time, type)
  const employee_code = record.employee_code || record.EmployeeCode;
  const directUserId  = record.user_id;
  const punch_time    = record.punch_time || record.LogDate || record.DownloadDate;
  const direction     = (record.type || record.Direction || 'in').toString().toLowerCase();
  const type          = direction === 'out' || direction === 'exit' ? 'out' : 'in';
  const device_id     = record.device_id || record.SerialNumber || record.DeviceName || null;

  if (!punch_time) return { ok: false, reason: 'punch_time is required' };

  const punchDate = toDateStr(punch_time);
  const punchIso  = new Date(punch_time).toISOString();

  // Resolve user
  let userId = directUserId;
  if (!userId && employee_code) {
    const emp = await one(
      "SELECT user_id FROM entities WHERE type='Employee' AND data::jsonb->>'employee_code'=$1 LIMIT 1",
      [employee_code]
    );
    userId = emp?.user_id;
  }
  if (!userId) return { ok: false, reason: `No user found for employee_code=${employee_code}` };

  // Find or create today's attendance record
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
      status: 'present',
      source: 'biometric',
      device_id: device_id || null,
      punch_sessions: [{ time: punchIso, type }],
    };
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)",
      [id, userId, JSON.stringify(data)]
    );
    return { ok: true, attendance_id: id, action: 'created' };
  }

  // Update existing record
  const data = JSON.parse(row.data);
  const sessions = data.punch_sessions || [];
  sessions.push({ time: punchIso, type });
  data.punch_sessions = sessions;
  data.device_id = device_id || data.device_id;

  if (type === 'in') {
    if (!data.check_in_time || punchIso < data.check_in_time) {
      data.check_in_time = punchIso;
    }
  } else if (type === 'out') {
    if (!data.check_out_time || punchIso > data.check_out_time) {
      data.check_out_time = punchIso;
    }
  }

  await run(
    "UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2",
    [JSON.stringify(data), row.id]
  );
  return { ok: true, attendance_id: row.id, action: 'updated' };
}

// Single / batch punch
router.post('/', authMiddleware, async (req, res) => {
  try {
    const body = req.body;

    if (Array.isArray(body.records)) {
      const results = await Promise.all(
        body.records.map(r => processRecord(r).catch(e => ({ ok: false, reason: e.message })))
      );
      const succeeded = results.filter(r => r.ok).length;
      return res.json({ success: true, processed: results.length, succeeded, results });
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
    version: '1.0',
    auth: 'Authorization: Bearer <ATTENDANCE_API_KEY>',
    endpoints: {
      'POST /api/attendance-log': {
        single: { employee_code: 'string', punch_time: 'ISO8601', type: '"in"|"out"', device_id: 'optional' },
        batch:  { records: '[{ employee_code, punch_time, type }]' },
      },
    },
  });
});

export default router;
