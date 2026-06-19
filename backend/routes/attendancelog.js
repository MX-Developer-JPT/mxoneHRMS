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
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

function getApiKey() {
  // Prefer env var, fall back to DB-stored key
  if (process.env.ATTENDANCE_API_KEY) return process.env.ATTENDANCE_API_KEY;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='attendance_api_key'").get();
    return row?.value || null;
  } catch { return null; }
}

function authMiddleware(req, res, next) {
  const apiKey = getApiKey();
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

function processRecord(record) {
  const { employee_code, user_id: directUserId, punch_time, type = 'in', device_id } = record;

  if (!punch_time) return { ok: false, reason: 'punch_time is required' };

  const punchDate = toDateStr(punch_time);
  const punchIso  = new Date(punch_time).toISOString();

  // Resolve user
  let userId = directUserId;
  if (!userId && employee_code) {
    const emp = db.prepare(
      "SELECT user_id FROM entities WHERE type='Employee' AND json_extract(data,'$.employee_code')=? LIMIT 1"
    ).get(employee_code);
    userId = emp?.user_id;
  }
  if (!userId) return { ok: false, reason: `No user found for employee_code=${employee_code}` };

  // Find or create today's attendance record
  let row = db.prepare(
    "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date')=? LIMIT 1"
  ).get(userId, punchDate);

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
    db.prepare(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Attendance',?,'present',?)"
    ).run(id, userId, JSON.stringify(data));
    return { ok: true, attendance_id: id, action: 'created' };
  }

  // Update existing record
  const data = JSON.parse(row.data);
  const sessions = data.punch_sessions || [];
  sessions.push({ time: punchIso, type });
  data.punch_sessions = sessions;
  data.device_id = device_id || data.device_id;

  if (type === 'in') {
    // Keep earliest check-in
    if (!data.check_in_time || punchIso < data.check_in_time) {
      data.check_in_time = punchIso;
    }
  } else if (type === 'out') {
    // Keep latest check-out
    if (!data.check_out_time || punchIso > data.check_out_time) {
      data.check_out_time = punchIso;
    }
  }

  db.prepare(
    "UPDATE entities SET data=?, updated_at=datetime('now') WHERE id=?"
  ).run(JSON.stringify(data), row.id);
  return { ok: true, attendance_id: row.id, action: 'updated' };
}

// Single punch
router.post('/', authMiddleware, (req, res) => {
  try {
    const body = req.body;

    // Batch mode
    if (Array.isArray(body.records)) {
      const results = body.records.map(r => {
        try { return processRecord(r); }
        catch (e) { return { ok: false, reason: e.message }; }
      });
      const success = results.filter(r => r.ok).length;
      return res.json({ success: true, processed: results.length, succeeded: success, results });
    }

    // Single mode
    const result = processRecord(body);
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
