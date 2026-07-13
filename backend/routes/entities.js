import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { one, all, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';
import { sendPushToUser } from '../utils/push.js';
import { JWT_SECRET } from './auth.js';

const router = Router();

// Location Master (AppLocation) is admin-only to manage — everyone else can
// still read it (employees need the list client-side for geofence matching),
// but only an admin may create/update/delete a configured location.
async function requireAdminForType(req, res, type) {
  if (type !== 'AppLocation') return true;
  const token = req.headers.authorization?.replace('Bearer ', '');
  let role = null;
  try { role = token ? jwt.verify(token, JWT_SECRET).role : null; } catch { role = null; }
  if (role !== 'admin') { res.status(403).json({ error: 'Admin role required to manage locations' }); return false; }
  return true;
}

// Employees may submit at most 5 AttendanceRegularisation requests per
// calendar month (IST). Rejected requests don't count against the quota —
// they were declined, not a wasted submission slot. Enforced server-side
// here (not just as a frontend nicety) since creation goes through this
// generic entity route rather than a dedicated function-route case.
async function checkRegularisationLimit(res, type, data) {
  if (type !== 'AttendanceRegularisation') return true;
  if (!data.user_id) return true;
  const rows = await all("SELECT data, created_at FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1", [data.user_id]);
  const nowIST = new Date(Date.now() + 5.5 * 3600000);
  const curYM = `${nowIST.getUTCFullYear()}-${String(nowIST.getUTCMonth() + 1).padStart(2, '0')}`;
  const countThisMonth = rows.filter(r => {
    let d;
    try { d = JSON.parse(r.data); } catch { return false; }
    if (d.status === 'rejected') return false;
    if (!r.created_at) return false;
    // created_at is Postgres CURRENT_TIMESTAMP::TEXT (UTC) — shift to IST so
    // the "calendar month" boundary matches the rest of the app's convention.
    const createdUtcMs = Date.parse(r.created_at.replace(' ', 'T') + (r.created_at.includes('Z') ? '' : 'Z'));
    if (isNaN(createdUtcMs)) return false;
    const createdIST = new Date(createdUtcMs + 5.5 * 3600000);
    const ym = `${createdIST.getUTCFullYear()}-${String(createdIST.getUTCMonth() + 1).padStart(2, '0')}`;
    return ym === curYM;
  }).length;
  if (countThisMonth >= 5) {
    res.status(400).json({ error: 'You have already submitted 5 attendance regularisation requests this month — the monthly limit has been reached.' });
    return false;
  }
  return true;
}

// Work-From-Home requests are submitted as a Leave with is_wfh/leave_type
// set client-side (Leave.jsx only shows the WFH option when the employee's
// wfh_eligible flag is set) — enforce that same rule server-side too, since
// this generic route is reachable directly without going through the UI.
async function checkWfhEligibility(res, type, data) {
  if (type !== 'Leave') return true;
  if (!data.is_wfh && data.leave_type !== 'work_from_home') return true;
  if (!data.user_id) return true;
  const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [data.user_id]);
  const emp = empRow ? JSON.parse(empRow.data) : null;
  if (!emp?.wfh_eligible) {
    res.status(403).json({ error: 'You are not eligible for Work From Home.' });
    return false;
  }
  return true;
}

/* ── helpers ─────────────────────────────────────────── */

const parseRow = (row) => {
  if (!row) return null;
  const d = JSON.parse(row.data);
  d.id           = row.id;
  d.created_date = row.created_at;
  d.updated_date = row.updated_at;
  return d;
};

const isPrimitive = (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const matchesFilter = (data, filter) => {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => {
    if (v === undefined || v === null) return true;
    const fv = k === 'id' ? data.id : data[k];
    if (typeof v === 'object' && !Array.isArray(v)) {
      if ('$in'  in v) return Array.isArray(v.$in) && v.$in.includes(fv);
      if ('$nin' in v) return Array.isArray(v.$nin) && !v.$nin.includes(fv);
      if ('$ne'  in v) return fv !== v.$ne;
      if ('$gt'  in v) return fv >  v.$gt;
      if ('$gte' in v) return fv >= v.$gte;
      if ('$lt'  in v) return fv <  v.$lt;
      if ('$lte' in v) return fv <= v.$lte;
      return true;
    }
    if (Array.isArray(v)) return v.includes(fv);
    return fv === v;
  });
};

const sortRows = (arr, sortField) => {
  if (!sortField) return arr;
  const desc = sortField.startsWith('-');
  const field = desc ? sortField.slice(1) : sortField;
  return [...arr].sort((a, b) => {
    const av = a[field] ?? a.created_date ?? '';
    const bv = b[field] ?? b.created_date ?? '';
    const cmp = String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });
};

/* ── In-memory cache for slow-changing entity types ───────── */
// Caches list/filter results for 45 seconds; invalidated on write.
const _cache = new Map();
const CACHE_TTL = 45_000;
const CACHEABLE = new Set([
  'Employee', 'Department', 'LeavePolicy', 'Shift', 'AppLocation',
  'PayrollConfiguration', 'Holiday', 'HelpdeskCategory', 'ShiftPolicy'
]);

function cacheGet(key) {
  const e = _cache.get(key);
  if (e && Date.now() < e.exp) return e.data;
  _cache.delete(key);
  return null;
}
function cacheSet(key, data) {
  _cache.set(key, { data, exp: Date.now() + CACHE_TTL });
}
function cacheInvalidate(type) {
  for (const k of _cache.keys()) {
    if (k.startsWith(type + ':')) _cache.delete(k);
  }
}

/* ── SQL ORDER BY + LIMIT builder ─────────────────────────── */
// Pushes sorting and limiting into the database query so the server
// never loads thousands of rows just to slice them in JavaScript.
function buildOrderLimit(sort, limit) {
  let order = '';
  if (sort) {
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    const dir = desc ? 'DESC' : 'ASC';
    if (field === 'created_date' || field === 'created_at') {
      order = ` ORDER BY created_at ${dir}`;
    } else if (field === 'updated_date' || field === 'updated_at') {
      order = ` ORDER BY updated_at ${dir}`;
    } else if (/^[A-Za-z0-9_]+$/.test(field)) {
      // JSON field — safe because we validated it's alphanumeric+underscore
      order = ` ORDER BY data::jsonb->>'${field}' ${dir} NULLS LAST`;
    }
  }
  const lim = limit ? ` LIMIT ${Math.min(parseInt(limit, 10), 50000)}` : '';
  return order + lim;
}

/* ── LIST  GET /api/entities/:type ───────────────────── */
router.get('/:type', async (req, res) => {
  const { type } = req.params;
  const { sort, limit } = req.query;

  const cacheKey = `${type}:list:${sort || ''}:${limit || ''}`;
  if (CACHEABLE.has(type)) {
    const hit = cacheGet(cacheKey);
    if (hit) return res.json(hit);
  }

  const sql = `SELECT * FROM entities WHERE type = $1${buildOrderLimit(sort, limit)}`;
  const rows = await all(sql, [type]);
  const data = rows.map(parseRow);

  if (CACHEABLE.has(type)) cacheSet(cacheKey, data);
  res.json(data);
});

/* ── FILTER  POST /api/entities/:type/filter ─────────── */
router.post('/:type/filter', async (req, res) => {
  const { type } = req.params;
  const { query = {}, sort, limit } = req.body;

  const simpleUserId = isPrimitive(query.user_id) ? query.user_id : undefined;
  const simpleStatus = isPrimitive(query.status)  ? query.status  : undefined;

  // Only push LIMIT/ORDER to SQL when the entire filter is handled by SQL columns
  // (pushing LIMIT before JS filtering would cut off valid matching records)
  const isSimpleFilter = !!(simpleUserId || simpleStatus ||
    (query.is_active !== undefined && isPrimitive(query.is_active) && Object.keys(query).length === 1));
  const sqlSuffix = isSimpleFilter ? buildOrderLimit(sort, limit) : '';

  let rows;
  if (simpleUserId && simpleStatus) {
    rows = await all(`SELECT * FROM entities WHERE type=$1 AND user_id=$2 AND status=$3${sqlSuffix}`, [type, simpleUserId, simpleStatus]);
  } else if (simpleUserId) {
    rows = await all(`SELECT * FROM entities WHERE type=$1 AND user_id=$2${sqlSuffix}`, [type, simpleUserId]);
  } else if (simpleStatus) {
    rows = await all(`SELECT * FROM entities WHERE type=$1 AND status=$2${sqlSuffix}`, [type, simpleStatus]);
  } else if (query.is_active !== undefined && isPrimitive(query.is_active)) {
    rows = await all(`SELECT * FROM entities WHERE type=$1 AND is_active=$2${sqlSuffix}`, [type, query.is_active ? 1 : 0]);
  } else {
    rows = await all('SELECT * FROM entities WHERE type=$1', [type]);
  }

  let data = rows.map(parseRow).filter(d => matchesFilter(d, query));
  if (!isSimpleFilter) {
    if (sort)  data = sortRows(data, sort);
    if (limit) data = data.slice(0, parseInt(limit, 10));
  }
  res.json(data);
});

/* ── GET ONE  GET /api/entities/:type/:id ─────────────── */
router.get('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const row = await one('SELECT * FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseRow(row));
});

/* ── CREATE  POST /api/entities/:type ─────────────────── */
router.post('/:type', async (req, res) => {
  const { type } = req.params;
  if (!(await requireAdminForType(req, res, type))) return;
  const body = req.body;
  const id = body.id || uuidv4();
  const data = { ...body, id };
  if (!(await checkRegularisationLimit(res, type, data))) return;
  if (!(await checkWfhEligibility(res, type, data))) return;

  await run(
    `INSERT INTO entities (id, type, user_id, status, is_active, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, type, data.user_id ?? null, data.status ?? null, data.is_active !== false ? 1 : 0, JSON.stringify(data)]
  );

  const row = await one('SELECT * FROM entities WHERE id=$1', [id]);

  // Post-creation hook: notify reporting manager (fire and forget)
  (async () => {
    try {
      const NOTIF_TYPES = ['Leave', 'GatePass', 'AttendanceRegularisation', 'Reimbursement'];
      if (NOTIF_TYPES.includes(type) && data.user_id) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [data.user_id]);
        const emp    = empRow ? JSON.parse(empRow.data) : null;
        const managerId = emp?.reporting_manager_id;
        if (managerId) {
          const empName = emp?.display_name || 'An employee';
          let title = '', message = '', link = '';
          if (type === 'Leave') {
            title   = `Leave Request from ${empName}`;
            message = `${empName} has applied for ${data.total_days || ''} day(s) of leave (${data.start_date || ''} – ${data.end_date || ''}).`;
            link    = '/Approvals';
          } else if (type === 'GatePass') {
            const labels = { official_outing:'Official Outing', unofficial_outing:'Unofficial Outing', half_day:'Half Day', short_break:'Short Break', early_leave:'Early Leave' };
            title   = `Gate Pass Request from ${empName}`;
            message = `${empName} has requested a gate pass (${labels[data.outing_type] || data.outing_type || 'outing'}).`;
            link    = '/Approvals';
          } else if (type === 'AttendanceRegularisation') {
            title   = `Regularisation Request from ${empName}`;
            message = `${empName} has submitted a regularisation request for ${data.date || ''} (${data.reason || ''}).`;
            link    = '/Approvals';
          } else if (type === 'Reimbursement') {
            title   = `Expense Claim from ${empName}`;
            message = `${empName} has submitted a ₹${data.amount || 0} expense claim for ${(data.expense_type || '').replace(/_/g,' ')}.`;
            link    = '/Approvals';
          }
          if (title) {
            const notifId = uuidv4();
            await run(
              `INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)`,
              [notifId, managerId, title, message, 'info', link]
            );
            sendPushToUser(managerId, { title, message, type: 'info', link });
          }
        }
      }
    } catch(ne) { console.error('[notif] post-create hook error:', ne.message); }
  })();

  cacheInvalidate(type);
  res.status(201).json(parseRow(row));
});

/* ── UPDATE  PATCH /api/entities/:type/:id ─────────────── */
router.patch('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (!(await requireAdminForType(req, res, type))) return;
  const row = await one('SELECT * FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const current = JSON.parse(row.data);
  const updated = { ...current, ...req.body, id };

  await run(
    `UPDATE entities SET data=$1, user_id=$2, status=$3, is_active=$4, updated_at=NOW()::TEXT WHERE id=$5`,
    [JSON.stringify(updated), updated.user_id ?? row.user_id, updated.status ?? row.status,
     updated.is_active !== false ? 1 : 0, id]
  );

  const newRow = await one('SELECT * FROM entities WHERE id=$1', [id]);

  // Notify the employee when any request's status changes to approved/rejected.
  const APPROVAL_TYPES = {
    Leave:                    { label: 'Leave request',      link: '/Leave' },
    GatePass:                 { label: 'Gate pass',          link: '/GatePassRequest' },
    Reimbursement:            { label: 'Expense claim',      link: '/Reimbursements' },
    AttendanceRegularisation: { label: 'Regularisation request', link: '/AttendanceRegularisation' },
  };
  if (APPROVAL_TYPES[type] && req.body.status && req.body.status !== current.status &&
      ['approved', 'rejected'].includes(req.body.status)) {
    const cfg = APPROVAL_TYPES[type];
    const targetUserId = updated.user_id || row.user_id;
    const isApproved = req.body.status === 'approved';
    const title = `${cfg.label} ${isApproved ? 'Approved' : 'Rejected'}`;
    const reason = updated.rejection_reason || updated.comments || updated.approval_comments || '';
    const message = `Your ${cfg.label.toLowerCase()} has been ${req.body.status}${reason ? ` — ${reason}` : '.'}`;
    (async () => {
      try {
        // In-app notification
        await run(
          `INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), targetUserId, title, message, isApproved ? 'success' : 'warning', cfg.link]
        );
        // Push notification
        sendPushToUser(targetUserId, { title, message, type: isApproved ? 'success' : 'warning', link: cfg.link });

        // Leave also gets a formatted email
        if (type === 'Leave') {
          const uRow = await one('SELECT email, full_name FROM users WHERE id=$1', [targetUserId]);
          if (uRow?.email) {
            const polRow = await one("SELECT data FROM entities WHERE type='LeavePolicy' AND id=$1", [updated.leave_policy_id]);
            const polData = polRow ? JSON.parse(polRow.data) : {};
            const tpl = emailTemplates.leaveUpdate({
              employeeName: uRow.full_name || 'Employee',
              leaveType: polData.name || updated.leave_type || updated.leave_policy_id || 'Leave',
              startDate: updated.start_date || '',
              endDate: updated.end_date || '',
              days: updated.total_days || '',
              status: req.body.status,
              remarks: reason,
            });
            sendEmail({ to: uRow.email, ...tpl }).catch(e => console.error('[email] Leave notification failed:', e.message));
          }
        }
      } catch (e) { console.error('[approval-notify] error:', e.message); }
    })();
  }

  cacheInvalidate(type);
  res.json(parseRow(newRow));
});

/* ── DELETE  DELETE /api/entities/:type/:id ─────────────── */
router.delete('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (!(await requireAdminForType(req, res, type))) return;
  const result = await run('DELETE FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  cacheInvalidate(type);
  res.json({ success: true });
});

export default router;
