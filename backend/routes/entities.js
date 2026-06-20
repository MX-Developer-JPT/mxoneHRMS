import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';

const router = Router();

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

/* ── LIST  GET /api/entities/:type ───────────────────── */
router.get('/:type', async (req, res) => {
  const { type } = req.params;
  const { sort, limit } = req.query;
  const rows = await all('SELECT * FROM entities WHERE type = $1', [type]);
  let data = rows.map(parseRow);
  if (sort)  data = sortRows(data, sort);
  if (limit) data = data.slice(0, parseInt(limit, 10));
  res.json(data);
});

/* ── FILTER  POST /api/entities/:type/filter ─────────── */
router.post('/:type/filter', async (req, res) => {
  const { type } = req.params;
  const { query = {}, sort, limit } = req.body;

  const simpleUserId = isPrimitive(query.user_id) ? query.user_id : undefined;
  const simpleStatus = isPrimitive(query.status)  ? query.status  : undefined;

  let rows;
  if (simpleUserId && simpleStatus) {
    rows = await all('SELECT * FROM entities WHERE type=$1 AND user_id=$2 AND status=$3', [type, simpleUserId, simpleStatus]);
  } else if (simpleUserId) {
    rows = await all('SELECT * FROM entities WHERE type=$1 AND user_id=$2', [type, simpleUserId]);
  } else if (simpleStatus) {
    rows = await all('SELECT * FROM entities WHERE type=$1 AND status=$2', [type, simpleStatus]);
  } else if (query.is_active !== undefined && isPrimitive(query.is_active)) {
    rows = await all('SELECT * FROM entities WHERE type=$1 AND is_active=$2', [type, query.is_active ? 1 : 0]);
  } else {
    rows = await all('SELECT * FROM entities WHERE type=$1', [type]);
  }

  let data = rows.map(parseRow).filter(d => matchesFilter(d, query));
  if (sort)  data = sortRows(data, sort);
  if (limit) data = data.slice(0, parseInt(limit, 10));
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
  const body = req.body;
  const id = body.id || uuidv4();
  const data = { ...body, id };

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
          }
        }
      }
    } catch(ne) { console.error('[notif] post-create hook error:', ne.message); }
  })();

  res.status(201).json(parseRow(row));
});

/* ── UPDATE  PATCH /api/entities/:type/:id ─────────────── */
router.patch('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
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

  // Send email when Leave status changes to approved/rejected (fire and forget)
  if (type === 'Leave' && req.body.status && req.body.status !== current.status &&
      ['approved', 'rejected'].includes(req.body.status)) {
    (async () => {
      try {
        const uRow = await one('SELECT email, full_name FROM users WHERE id=$1', [updated.user_id || row.user_id]);
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
            remarks: updated.rejection_reason || updated.comments || ''
          });
          sendEmail({ to: uRow.email, ...tpl }).catch(e =>
            console.error('[email] Leave notification failed:', e.message)
          );

          const leaveUserId = updated.user_id || row.user_id;
          const leaveTypeName = polData.name || updated.leave_type || updated.leave_policy_id || 'leave';
          const notifId = uuidv4();
          await run(
            `INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)`,
            [notifId, leaveUserId,
             `Leave ${req.body.status === 'approved' ? 'Approved' : 'Rejected'}`,
             `Your ${leaveTypeName} request has been ${req.body.status}.`,
             req.body.status === 'approved' ? 'success' : 'warning',
             '/Leave']
          );
        }
      } catch(e) { console.error('[email] Leave email error:', e.message); }
    })();
  }

  res.json(parseRow(newRow));
});

/* ── DELETE  DELETE /api/entities/:type/:id ─────────────── */
router.delete('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const result = await run('DELETE FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

export default router;
