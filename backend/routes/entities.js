import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { one, all, run, withTransaction } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';
import { sendPushToUser } from '../utils/push.js';
import { JWT_SECRET } from './auth.js';

const router = Router();

// Entity types carrying financial, statutory, or otherwise highly sensitive
// data. Every route below additionally restricts these to HR/admin/
// management (unrestricted) or the record's own owner — closing the gap
// where this whole router previously had no authorization at all, so any
// caller (authenticated or not) could read/write PAN/Aadhaar/bank details,
// payroll, loans, insurance claims, and POSH case records for anyone.
const SENSITIVE_TYPES = new Set([
  'Payroll', 'PayrollConfiguration', 'SalaryStructure', 'Loan', 'InsuranceClaim',
  'POSHRecord', 'TaxDeclaration', 'Form16', 'BankDetail', 'LeaveBalance', 'Document',
  'Reimbursement',
  // Visitor is location-scoped (a Duhai gate admin must never be able to
  // list an E82 visitor by calling the generic list/filter API directly,
  // per the Visitor Management location-isolation requirement). Every
  // legitimate read now goes through functions.js's getMyVisitors (self) or
  // getVisitorsScoped (gate admin/HR, location-filtered server-side)
  // instead — this just closes the generic route as a bypass. The default
  // fallback below (owner-only) is a safe, never-leaks-cross-location floor
  // for any caller that still hits this route directly.
  'Visitor',
]);
const PRIVILEGED_ROLES = new Set(['hr', 'admin', 'management']);
// LeaveBalance is the one SENSITIVE_TYPE that must never be self-editable,
// even by its own owner — every other sensitive type's "own record" carve-
// out below is intentional (an employee reading/updating their own Document,
// Loan application, etc.), but a leave balance is a system-computed running
// total, not something an employee ever legitimately edits directly. The
// generic own-record exception used to let a plain employee PATCH literally
// any field of their own LeaveBalance (including `available`) — which is
// exactly what Leave.jsx's client-side "deduct on submit / restore on
// cancel" calls were doing, non-atomically, from the browser. That's the
// root of imported balances drifting: two racing submits (or a submit whose
// follow-up balance PATCH never completes) reading/writing the same row with
// no locking. Fixed at the source: PATCH now requires HR/admin/management
// for LeaveBalance, full stop, and the actual reserve/release bookkeeping
// moved server-side into the Leave create/cancel/delete paths below (see
// reserveLeaveBalance/releaseLeaveReservation), atomic and race-free.
const SELF_EDIT_EXEMPT_TYPES = new Set(['LeaveBalance']);

// Leave balance reservation model: `available` is decremented (and
// `pending_approval` incremented by the same amount) the INSTANT a Leave
// request is created as 'pending' — not deferred to approval — so a second
// concurrent request against the same balance can never be approved past
// what's actually left. Approval (runLeaveAction in functions.js) then just
// moves the reserved days from pending_approval to used, leaving `available`
// where creation already put it. Rejection/cancellation/deletion of a still-
// pending request releases that reservation back via releaseLeaveReservation
// — the single place that does this arithmetic, so it can never drift out of
// sync between the different ways a pending leave can end.
async function reserveLeaveBalance(userId, leavePolicyId, year, days, client) {
  if (!userId || !leavePolicyId || !days) return;
  const balRows = (await client.query("SELECT id,data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [userId])).rows;
  const balRow = balRows.map(r => ({ id: r.id, d: JSON.parse(r.data) })).find(x => x.d.leave_policy_id === leavePolicyId && x.d.year === year);
  if (!balRow) return; // no matching balance row — nothing to reserve against (checkLeaveBalanceSufficiency already let a 0-balance request through as a pre-existing edge case)
  const upd = { ...balRow.d, available: Math.max((balRow.d.available || 0) - days, 0), pending_approval: (balRow.d.pending_approval || 0) + days };
  await client.query("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), balRow.id]);
}

async function releaseLeaveReservation(userId, leavePolicyId, year, days) {
  if (!userId || !leavePolicyId || !days) return;
  const balRows = await all("SELECT id,data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [userId]);
  const balRow = balRows.map(r => ({ id: r.id, d: JSON.parse(r.data) })).find(x => x.d.leave_policy_id === leavePolicyId && x.d.year === year);
  if (!balRow) return;
  const upd = { ...balRow.d, available: (balRow.d.available || 0) + days, pending_approval: Math.max((balRow.d.pending_approval || 0) - days, 0) };
  await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), balRow.id]);
}

// Live DB lookup (not the JWT's embedded role, which can go stale for the
// life of a 30-day token if the user is later promoted/demoted) — mirrors
// the hasRole() convention used throughout routes/functions.js.
async function getEffectiveRole(cu) {
  if (!cu) return null;
  try {
    const row = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]);
    return row?.custom_role || row?.role || cu.custom_role || cu.role || null;
  } catch { return cu.custom_role || cu.role || null; }
}

// Reimbursement and LeaveBalance both carry data sensitive enough to
// restrict like every other SENSITIVE_TYPES entry — but unlike the rest, a
// non-privileged 'manager' role legitimately needs to see their own direct
// reports' records too, not just their own: Reimbursement for approval
// (checkApprovalAuthorization below), LeaveBalance because
// LeaveManagement.jsx/LeaveDashboard.jsx read the whole team's balances to
// show available-days context while a manager reviews a pending leave
// request. These two helpers mirror checkApprovalAuthorization's manager
// scoping exactly, so read access and write/approval access never disagree.
const MANAGER_VISIBLE_SENSITIVE_TYPES = new Set(['Reimbursement', 'LeaveBalance']);
async function getDirectReportUserIds(managerId) {
  const rows = await all("SELECT user_id FROM entities WHERE type='Employee' AND data::jsonb->>'reporting_manager_id'=$1", [managerId]);
  return new Set(rows.map(r => r.user_id));
}

async function filterSensitive(data, cu, type) {
  if (!SENSITIVE_TYPES.has(type)) return data;
  const role = await getEffectiveRole(cu);
  if (PRIVILEGED_ROLES.has(role)) return data;
  if (MANAGER_VISIBLE_SENSITIVE_TYPES.has(type) && role === 'manager') {
    const reportIds = await getDirectReportUserIds(cu.id);
    return data.filter(d => d.user_id === cu.id || reportIds.has(d.user_id));
  }
  return data.filter(d => d.user_id === cu.id);
}

async function canAccessSensitive(cu, type, ownerUserId) {
  if (!SENSITIVE_TYPES.has(type)) return true;
  if (ownerUserId === cu.id) return true;
  const role = await getEffectiveRole(cu);
  if (PRIVILEGED_ROLES.has(role)) return true;
  if (MANAGER_VISIBLE_SENSITIVE_TYPES.has(type) && role === 'manager') {
    const row = await one("SELECT data::jsonb->>'reporting_manager_id' AS mgr FROM entities WHERE type='Employee' AND user_id=$1", [ownerUserId]);
    return row?.mgr === cu.id;
  }
  return false;
}

// Location Master (AppLocation) is admin-only to manage — everyone else can
// still read it (employees need the list client-side for geofence matching),
// but only an admin may create/update/delete a configured location. Takes
// the already-authenticated `cu` and re-checks the CURRENT role via
// getEffectiveRole (live DB lookup), not the JWT's embedded role directly —
// that raw-JWT-role version of this check let a demoted admin keep managing
// locations for up to 30 days, the same staleness bug fixed everywhere else
// in this file's authorization pass.
async function requireAdminForType(cu, res, type) {
  if (type !== 'AppLocation') return true;
  const role = await getEffectiveRole(cu);
  if (role !== 'admin') { res.status(403).json({ error: 'Admin role required to manage locations' }); return false; }
  return true;
}

// Employees may submit at most 5 AttendanceRegularisation requests per
// calendar month (IST). Rejected requests don't count against the quota —
// they were declined, not a wasted submission slot. Enforced server-side
// here (not just as a frontend nicety) since creation goes through this
// generic entity route rather than a dedicated function-route case.
// `client` (a locked transaction connection — see withTransaction call sites
// below) is optional so this can still be called standalone; when provided,
// the read runs on the SAME connection holding the advisory lock, so it sees
// a consistent view relative to the insert that follows inside that
// transaction — closing the read-then-write race where two concurrent
// requests could both read "4 this month" and both be allowed through.
async function checkRegularisationLimit(res, type, data, client) {
  if (type !== 'AttendanceRegularisation') return true;
  if (!data.user_id) return true;
  const rows = client
    ? (await client.query("SELECT data, created_at FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1", [data.user_id])).rows
    : await all("SELECT data, created_at FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1", [data.user_id]);
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

function getCurrentUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// GatePass, Reimbursement and AttendanceRegularisation have no dedicated
// approve/reject action of their own (unlike Leave/CompOff, which go through
// runLeaveAction/decideCompOff in routes/functions.js) — approval happens by
// PATCHing status straight through this generic entity route, which
// previously had NO authorization check at all: any authenticated user could
// approve/reject any employee's request for any of these three types.
// Restricts an approved/rejected status change to: HR/admin/management
// (unrestricted), or a 'manager' role approving only their own direct
// report's request (Employee.reporting_manager_id === approver's id).
const APPROVAL_SCOPED_TYPES = new Set(['GatePass', 'Reimbursement', 'AttendanceRegularisation', 'Leave']);
// GatePass has a second scoped transition beyond approve/reject: the
// physical gate-in/gate-out logging (departed/returned) done by whoever is
// staffing the gate. Previously NEITHER transition had any check at all for
// these two statuses, so any authenticated user (any role) could PATCH any
// employee's gate pass to "departed"/"returned" directly.
const GATE_LOG_TRANSITIONS = new Set(['departed', 'returned']);
// Except for GatePass, every one of these approval-scoped types must clear
// the reporting manager's own approval before HR/management can act — only
// admin retains a blanket override. An employee with no reporting manager
// configured at all is the one exception (there'd otherwise be no one who
// could ever clear that first step for them).
// Same GateAdminLocation entity/rule as Visitor Management's location
// scoping (see functions.js) — one row per user_id, {locations:[name,...]}.
// null = never configured = unrestricted (every location), for the same
// backward-compatible reason: an existing gate admin must keep working
// exactly as before until an admin explicitly narrows them to specific
// location(s). Duplicated here (rather than imported from functions.js)
// since entities.js and functions.js are separate route files with no
// existing cross-import of this kind — keeps this route self-contained.
async function getGateAdminAssignedLocations(userId) {
  const row = await one("SELECT data FROM entities WHERE type='GateAdminLocation' AND user_id=$1", [userId]);
  if (!row) return null;
  const d = JSON.parse(row.data);
  return Array.isArray(d.locations) ? d.locations : null;
}

async function getGateAdminUserIdsForLocation(locationName) {
  const rows = await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role)='gate_admin'");
  const out = [];
  for (const r of rows) {
    const assigned = await getGateAdminAssignedLocations(r.id);
    if (assigned === null || assigned.includes(locationName)) out.push(r.id);
  }
  return out;
}

async function hasManagerCleared(type, current) {
  if (!current.user_id) return true; // no owner to resolve a manager for — nothing to gate on
  const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [current.user_id]);
  const emp = empRow ? JSON.parse(empRow.data) : null;
  if (!emp?.reporting_manager_id) return true;
  if (type === 'Leave') return (current.current_approval_level || 1) > 1 || current.status === 'approved';
  if (type === 'AttendanceRegularisation') return current.status === 'manager_approved';
  if (type === 'Reimbursement') return !!current.manager_approved_by;
  return true;
}

async function checkApprovalAuthorization(req, res, type, current, newStatus) {
  if (!APPROVAL_SCOPED_TYPES.has(type)) return true;
  if (!newStatus || newStatus === current.status) return true;

  const isGateLogTransition = type === 'GatePass' && GATE_LOG_TRANSITIONS.has(newStatus);
  const isApprovalTransition = ['approved', 'rejected'].includes(newStatus);
  if (!isGateLogTransition && !isApprovalTransition) return true;

  const cu = getCurrentUser(req);
  if (!cu) { res.status(401).json({ error: 'Unauthorized' }); return false; }

  const uRow = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]);
  const role = uRow?.custom_role || uRow?.role || cu.custom_role || cu.role;

  if (isGateLogTransition) {
    if (['hr', 'admin'].includes(role)) return true;
    if (role === 'gate_admin') {
      // A "travelling to another office" pass is tied to a specific
      // departure location (current_location) — a gate admin restricted to
      // one office must not be able to mark departure/return for a pass
      // leaving from a DIFFERENT office. Every other outing type has no
      // location of its own, so this check only applies to this one type —
      // unaffected gate passes keep the original unrestricted-to-any-gate-
      // admin behavior.
      if (current.outing_type === 'travelling_to_another_office' && current.current_location) {
        const assigned = await getGateAdminAssignedLocations(cu.id);
        if (assigned !== null && !assigned.includes(current.current_location)) {
          res.status(403).json({ error: `You are not assigned to ${current.current_location} — this gate pass belongs to another office` });
          return false;
        }
      }
      return true;
    }
    res.status(403).json({ error: 'Access denied — gate admin access required' });
    return false;
  }

  if (['hr', 'admin', 'management'].includes(role)) {
    if (role !== 'admin' && type !== 'GatePass' && !(await hasManagerCleared(type, current))) {
      res.status(403).json({ error: 'This request requires reporting manager approval first.' });
      return false;
    }
    return true;
  }

  if (role === 'manager') {
    const targetUserId = current.user_id;
    const empRow = await one("SELECT data::jsonb->>'reporting_manager_id' AS mgr FROM entities WHERE type='Employee' AND user_id=$1", [targetUserId]);
    if (empRow?.mgr === cu.id) return true;
  }

  // Reimbursement's configurable ApprovalWorkflow (module 'expense') can
  // assign a step to a 'specific_user' who isn't the claimant's manager —
  // Approvals.jsx already surfaces such claims to that person (matching
  // WorkflowBuilder.jsx's "integrated: true" note for this module), so the
  // backend must recognize them as the authorized approver for their step
  // too, not just HR/admin/management/direct-manager.
  if (type === 'Reimbursement') {
    const wfRow = await one("SELECT data FROM entities WHERE type='ApprovalWorkflow' AND data::jsonb->>'module'='expense'");
    const wf = wfRow ? JSON.parse(wfRow.data) : null;
    if (wf?.is_active !== false && Array.isArray(wf?.steps) && wf.steps.length > 0) {
      const step = wf.steps[current.wf_level || 0];
      if (step?.approver_type === 'specific_user' && step.specific_user_id === cu.id) return true;
    }
  }

  res.status(403).json({ error: 'Access denied — not authorized to approve this request' });
  return false;
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

// Leave.jsx only enables Submit once client-side validation confirms
// available >= total_days — but that's purely a UI nicety, bypassable by
// calling this generic entity route directly. Enforced here too so a
// request can never be created for more days than the employee actually
// has, regardless of client. WFH doesn't draw from a leave balance at all
// (see checkWfhEligibility above), so it's exempt from this check.
async function checkLeaveBalanceSufficiency(res, type, data, client) {
  if (type !== 'Leave') return true;
  if (data.is_wfh || data.leave_type === 'work_from_home') return true;
  if (!data.user_id || !data.leave_policy_id || !data.total_days) return true;
  const year = new Date(data.start_date || Date.now()).getFullYear();
  const balRows = client
    ? (await client.query("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [data.user_id])).rows
    : await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [data.user_id]);
  const bal = balRows.map(r => JSON.parse(r.data)).find(b => b.leave_policy_id === data.leave_policy_id && b.year === year);
  const available = bal?.available ?? 0;
  if (data.total_days > available) {
    res.status(400).json({ error: `Insufficient leave balance — requested ${data.total_days} day(s), only ${available} available.` });
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
export { cacheInvalidate };

/* ── Notification helpers ─────────────────────────────────── */
// Fire-and-forget: writes one notifications row + push per recipient.
async function notifyMany(userIds, { title, message, type = 'info', link = '' }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  for (const uid of ids) {
    try {
      await run(
        `INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), uid, title, message, type, link || null]
      );
      sendPushToUser(uid, { title, message, type, link });
    } catch (e) { console.error('[notif] notifyMany error:', e.message); }
  }
}

async function getHrAdminUserIds() {
  const rows = await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')");
  return rows.map(r => r.id);
}

// Announcement audience: 'all' (or unset) → every active employee;
// 'specific_locations' → every active employee whose work_location is one
// of target_locations (matches AppLocation.name, per Location Master —
// see OnboardingApproval.jsx's location dropdown); anything else (the
// existing 'specific_departments' path) → every active employee in one of
// target_departments (matches Employee.department, which is always stored
// as the department's NAME — see OnboardingApproval.jsx's department
// dropdown — never its short code).
export async function getAnnouncementAudienceUserIds(data) {
  const audience = data.target_audience || 'all';
  if (audience === 'specific_locations') {
    const locs = Array.isArray(data.target_locations) ? data.target_locations : [];
    if (!locs.length) {
      const rows = await all("SELECT user_id FROM entities WHERE type='Employee' AND status='active'");
      return rows.map(r => r.user_id).filter(Boolean);
    }
    const rows = await all(
      "SELECT user_id FROM entities WHERE type='Employee' AND status='active' AND data::jsonb->>'work_location' = ANY($1)",
      [locs]
    );
    return rows.map(r => r.user_id).filter(Boolean);
  }
  const depts = Array.isArray(data.target_departments) ? data.target_departments : [];
  if (audience === 'all' || depts.length === 0) {
    const rows = await all("SELECT user_id FROM entities WHERE type='Employee' AND status='active'");
    return rows.map(r => r.user_id).filter(Boolean);
  }
  const rows = await all(
    "SELECT user_id FROM entities WHERE type='Employee' AND status='active' AND data::jsonb->>'department' = ANY($1)",
    [depts]
  );
  return rows.map(r => r.user_id).filter(Boolean);
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
  const cu = getCurrentUser(req);
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const { type } = req.params;
  const { sort, limit } = req.query;

  const cacheKey = `${type}:list:${sort || ''}:${limit || ''}`;
  let data;
  if (CACHEABLE.has(type)) {
    const hit = cacheGet(cacheKey);
    if (hit) data = hit;
  }
  if (!data) {
    const sql = `SELECT * FROM entities WHERE type = $1${buildOrderLimit(sort, limit)}`;
    const rows = await all(sql, [type]);
    data = rows.map(parseRow);
    if (CACHEABLE.has(type)) cacheSet(cacheKey, data);
  }

  data = await filterSensitive(data, cu, type);
  res.json(data);
});

/* ── FILTER  POST /api/entities/:type/filter ─────────── */
router.post('/:type/filter', async (req, res) => {
  const cu = getCurrentUser(req);
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const { type } = req.params;
  const { query = {}, sort, limit } = req.body;

  const simpleUserId = isPrimitive(query.user_id) ? query.user_id : undefined;
  const simpleStatus = isPrimitive(query.status)  ? query.status  : undefined;

  // Only push LIMIT/ORDER to SQL when the entire filter is handled by SQL columns
  // (pushing LIMIT before JS filtering would cut off valid matching records)
  const isSimpleFilter = !!(simpleUserId || simpleStatus ||
    (query.is_active !== undefined && isPrimitive(query.is_active) && Object.keys(query).length === 1));
  const sqlSuffix = isSimpleFilter ? buildOrderLimit(sort, limit) : '';

  const baseParams = [type];
  let sql;
  if (simpleUserId && simpleStatus) {
    sql = `SELECT * FROM entities WHERE type=$1 AND user_id=$2 AND status=$3`;
    baseParams.push(simpleUserId, simpleStatus);
  } else if (simpleUserId) {
    sql = `SELECT * FROM entities WHERE type=$1 AND user_id=$2`;
    baseParams.push(simpleUserId);
  } else if (simpleStatus) {
    sql = `SELECT * FROM entities WHERE type=$1 AND status=$2`;
    baseParams.push(simpleStatus);
  } else if (query.is_active !== undefined && isPrimitive(query.is_active)) {
    sql = `SELECT * FROM entities WHERE type=$1 AND is_active=$2`;
    baseParams.push(query.is_active ? 1 : 0);
  } else {
    sql = `SELECT * FROM entities WHERE type=$1`;
  }

  // Additionally push a `date` range down to SQL when present, regardless
  // of isSimpleFilter — a purely additive fetch-size narrowing. matchesFilter()
  // below still re-validates every condition (including this one)
  // identically, so a bug here could only ever under-narrow — same behavior
  // as before this change — never return wrong results. This matters most
  // for large, long-lived tables like Attendance: a `{date: {$gte, $lte}}`
  // filter isn't one of the "simple" fields above, so before this change no
  // SQL WHERE was ever applied and the entire table (every Attendance row
  // ever created, for every employee) was pulled into Node memory on every
  // date-ranged report/page load before being filtered down in JS.
  const dateFilter = query.date;
  if (dateFilter && typeof dateFilter === 'object' && !Array.isArray(dateFilter)) {
    const gte = isPrimitive(dateFilter.$gte) ? dateFilter.$gte : undefined;
    const lte = isPrimitive(dateFilter.$lte) ? dateFilter.$lte : undefined;
    if (gte !== undefined) { baseParams.push(gte); sql += ` AND data::jsonb->>'date' >= $${baseParams.length}`; }
    if (lte !== undefined) { baseParams.push(lte); sql += ` AND data::jsonb->>'date' <= $${baseParams.length}`; }
  }

  sql += sqlSuffix;
  const rows = await all(sql, baseParams);

  let data = rows.map(parseRow).filter(d => matchesFilter(d, query));
  if (!isSimpleFilter) {
    if (sort)  data = sortRows(data, sort);
    if (limit) data = data.slice(0, parseInt(limit, 10));
  }
  data = await filterSensitive(data, cu, type);
  res.json(data);
});

/* ── GET ONE  GET /api/entities/:type/:id ─────────────── */
router.get('/:type/:id', async (req, res) => {
  const cu = getCurrentUser(req);
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const { type, id } = req.params;
  const row = await one('SELECT * FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const data = parseRow(row);
  if (!(await canAccessSensitive(cu, type, data.user_id))) return res.status(403).json({ error: 'Access denied' });
  res.json(data);
});

/* ── CREATE  POST /api/entities/:type ─────────────────── */
router.post('/:type', async (req, res) => {
  const cu = getCurrentUser(req);
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const { type } = req.params;
  if (!(await requireAdminForType(cu, res, type))) return;
  const body = req.body;
  const id = body.id || uuidv4();
  const data = { ...body, id };

  // A non-privileged caller may only create a record attributed to
  // themselves — closes the gap where any authenticated user could POST a
  // Loan/Leave/etc. with someone else's user_id in the body and have it
  // silently attributed to that other person.
  if (data.user_id && data.user_id !== cu.id) {
    const role = await getEffectiveRole(cu);
    if (!PRIVILEGED_ROLES.has(role)) return res.status(403).json({ error: 'Cannot create a record on behalf of another user' });
  }

  // SENSITIVE_TYPES also need a create-time gate — GET/PATCH/DELETE all
  // restrict these, but creation had no type-level check at all, so a plain
  // employee could self-fabricate e.g. a LeaveBalance with an inflated
  // `available` and have checkLeaveBalanceSufficiency trust it, or POST a
  // brand-new org-wide PayrollConfiguration (which has no user_id at all,
  // so even the "on behalf of another user" check above never applies to
  // it). A few of these types ARE legitimately self-created by an ordinary
  // employee (LoanManagement.jsx's self-service loan application,
  // OnboardingForm.jsx's own-document upload) — those keep working via the
  // self-ownership exception; everything else requires HR/admin/management.
  if (SENSITIVE_TYPES.has(type)) {
    const SELF_CREATABLE = new Set(['Loan', 'InsuranceClaim', 'Document']);
    const isSelfCreatable = SELF_CREATABLE.has(type) && data.user_id === cu.id;
    if (!isSelfCreatable) {
      const role = await getEffectiveRole(cu);
      if (!PRIVILEGED_ROLES.has(role)) return res.status(403).json({ error: 'Not authorized to create this record' });
    }
  }

  if (!(await checkWfhEligibility(res, type, data))) return;

  let row;
  if (type === 'AttendanceRegularisation' || type === 'Leave') {
    // These two have a read-then-write quota/balance check that a bare
    // check-then-insert can't make atomic under concurrent requests from
    // the same user — serialize per (type,user_id) with a transaction-scoped
    // advisory lock so the second of two racing requests re-reads the
    // first's effect before its own check runs.
    let ok = true;
    try {
      row = await withTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${type}:${data.user_id}`]);
        if (!(await checkRegularisationLimit(res, type, data, client))) { ok = false; return null; }
        if (!(await checkLeaveBalanceSufficiency(res, type, data, client))) { ok = false; return null; }
        await client.query(
          `INSERT INTO entities (id, type, user_id, status, is_active, data) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, type, data.user_id ?? null, data.status ?? null, data.is_active !== false ? 1 : 0, JSON.stringify(data)]
        );
        // Reserve the requested days against the balance the instant a
        // normal (self-service, still-'pending') Leave is created — same
        // advisory lock, same transaction as the sufficiency check above, so
        // the two can never race. Scoped to status==='pending' specifically:
        // HRApplyOnBehalf.jsx creates a Leave already 'approved' (HR applying
        // on an employee's behalf, decided on the spot) and does its own
        // direct used/available adjustment for that case — reserving here
        // too would double-deduct it.
        const isWfhLeave = type === 'Leave' && (data.is_wfh || data.leave_type === 'work_from_home');
        if (type === 'Leave' && !isWfhLeave && data.status === 'pending' && data.user_id && data.leave_policy_id && data.total_days) {
          const leaveYear = new Date(data.start_date || Date.now()).getFullYear();
          await reserveLeaveBalance(data.user_id, data.leave_policy_id, leaveYear, data.total_days, client);
        }
        const { rows } = await client.query('SELECT * FROM entities WHERE id=$1', [id]);
        return rows[0];
      });
    } catch (e) {
      if (ok) { console.error('[entities] transactional create failed:', e.message); return res.status(500).json({ error: 'Failed to create record' }); }
    }
    if (!ok) return; // checkRegularisationLimit/checkLeaveBalanceSufficiency already sent the response
  } else {
    await run(
      `INSERT INTO entities (id, type, user_id, status, is_active, data) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, type, data.user_id ?? null, data.status ?? null, data.is_active !== false ? 1 : 0, JSON.stringify(data)]
    );
    row = await one('SELECT * FROM entities WHERE id=$1', [id]);
  }

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

  // Broadcast / support-inbox notifications on creation (fire and forget)
  (async () => {
    try {
      if (type === 'Announcement' && data.status === 'published') {
        const audience = await getAnnouncementAudienceUserIds(data);
        await notifyMany(audience, {
          title: `📢 ${data.title || 'New Announcement'}`,
          message: (data.content || '').slice(0, 180),
          type: 'info',
          link: '/Announcements',
        });
      } else if (type === 'JobRequisition') {
        if (data.status === 'pending_manager_approval' && data.hiring_manager_id) {
          await notifyMany([data.hiring_manager_id], {
            title: 'Job Requisition Awaiting Your Approval',
            message: `A requisition for ${data.number_of_positions || 1} × ${data.title || 'position'} (${data.department || ''}) needs your approval.`,
            type: 'info', link: '/JobRequisitions',
          });
        } else if (data.status === 'pending_hr_approval') {
          await notifyMany(await getHrAdminUserIds(), {
            title: 'Job Requisition Awaiting HR Approval',
            message: `A requisition for ${data.number_of_positions || 1} × ${data.title || 'position'} (${data.department || ''}) needs HR approval.`,
            type: 'info', link: '/JobRequisitions',
          });
        }
      } else if (type === 'Ticket') {
        // HR/admin always see every ticket (oversight), plus everyone in the
        // ticket's assigned_department (set from the chosen HelpdeskCategory's
        // default_department_name at creation — see Helpdesk.jsx) so the
        // concerned department is notified immediately, not just once HR
        // manually assigns it to a specific person later (see the
        // assigned_to notification on Ticket update, below).
        const ticketAudience = new Set(await getHrAdminUserIds());
        if (data.assigned_department) {
          const deptRows = await all(
            "SELECT user_id FROM entities WHERE type='Employee' AND status='active' AND data::jsonb->>'department'=$1",
            [data.assigned_department]
          );
          for (const r of deptRows) if (r.user_id) ticketAudience.add(r.user_id);
        }
        // A category can also name one specific default assignee (set on
        // HelpdeskCategoryManagement) — routed at creation time, not only
        // once HR manually assigns it later. Gets its own clearer "assigned
        // to you" wording rather than the generic department-broadcast one.
        if (data.assigned_to) ticketAudience.delete(data.assigned_to);
        await notifyMany([...ticketAudience], {
          title: 'New Helpdesk Ticket',
          message: `${data.subject || 'A new ticket'} (${data.priority || 'medium'} priority) was raised.`,
          type: data.priority === 'high' || data.priority === 'urgent' ? 'warning' : 'info',
          link: '/Helpdesk',
        });
        if (data.assigned_to) {
          await notifyMany([data.assigned_to], {
            title: 'Helpdesk Ticket Assigned to You',
            message: `${data.subject || 'A new ticket'} (${data.priority || 'medium'} priority) was routed to you.`,
            type: 'info', link: '/Helpdesk',
          });
        }
        // Acknowledgement to whoever raised it — confirms it was received
        // and says where it went, so they're not left wondering.
        if (data.user_id) {
          const routedTo = data.assigned_to
            ? (await one('SELECT full_name FROM users WHERE id=$1', [data.assigned_to]))?.full_name
            : (data.assigned_department || null);
          await notifyMany([data.user_id], {
            title: 'Ticket Raised',
            message: `Your ticket "${data.subject || 'support request'}" has been raised${routedTo ? ` and routed to ${routedTo}` : ''}. We'll update you as it progresses.`,
            type: 'info', link: '/Helpdesk',
          });
        }
      } else if (type === 'POSHRecord') {
        await notifyMany(await getHrAdminUserIds(), {
          title: 'New POSH Record Logged',
          message: `A new ${(data.record_type || 'POSH').replace(/_/g,' ')} record was logged and needs review.`,
          type: 'warning', link: '/POSHCompliance',
        });
      }
    } catch (ne) { console.error('[notif] post-create broadcast hook error:', ne.message); }
  })();

  cacheInvalidate(type);
  res.status(201).json(parseRow(row));
});

/* ── UPDATE  PATCH /api/entities/:type/:id ─────────────── */
router.patch('/:type/:id', async (req, res) => {
  const cu = getCurrentUser(req);
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const { type, id } = req.params;
  if (!(await requireAdminForType(cu, res, type))) return;
  const row = await one('SELECT * FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const current = JSON.parse(row.data);
  if (!(await checkApprovalAuthorization(req, res, type, current, req.body.status))) return;

  // Is this PATCH exactly the approve/reject (or GatePass gate-log)
  // transition checkApprovalAuthorization just verified above? That
  // function already correctly allows a direct manager (or, for
  // Reimbursement, a workflow specific_user) to flip `status` on someone
  // else's record — but that authorization is scoped to THIS ONE
  // transition, not a blanket "may edit any field of a report's record."
  // Both checks below must treat it as its own case, not fold it into the
  // general owner-or-privileged rule.
  const isScopedTransition = APPROVAL_SCOPED_TYPES.has(type) && req.body.status && req.body.status !== current.status;

  // Financial/statutory/compliance records may only be edited by HR/admin/
  // management or the record's own owner for anything OTHER than that one
  // already-authorized transition — deliberately NOT using the
  // manager-of-report read exception here (canAccessSensitive), since that
  // exists so a manager can SEE a report's LeaveBalance/Reimbursement, not
  // edit arbitrary fields of it.
  if (!isScopedTransition && SENSITIVE_TYPES.has(type) && (row.user_id !== cu.id || SELF_EDIT_EXEMPT_TYPES.has(type))) {
    const role = await getEffectiveRole(cu);
    if (!PRIVILEGED_ROLES.has(role)) return res.status(403).json({ error: 'Access denied' });
  }

  // General ownership baseline for every OTHER type that carries a user_id
  // (Ticket, Feedback360, SkillEntry, Document, etc.) — previously these had
  // no write authorization at all beyond "any authenticated user." Skipped
  // when: the record has no user_id (an org-wide config type — Department,
  // HolidayCalendar, AppLocation — left to their existing role-gated UI);
  // this is the already-authorized scoped transition above; or the caller
  // is the record's assignee (assigned_to) — the pattern Helpdesk tickets
  // use for support staff who aren't the ticket's original raiser.
  if (!isScopedTransition && current.user_id && current.user_id !== cu.id && current.assigned_to !== cu.id && current.assigned_to_user_id !== cu.id) {
    const genRole = await getEffectiveRole(cu);
    if (!PRIVILEGED_ROLES.has(genRole)) return res.status(403).json({ error: 'Access denied — not your record' });
  }

  const updated = { ...current, ...req.body, id };

  // Leave's WFH-eligibility and balance-sufficiency rules were previously
  // only enforced at creation (POST) — an owner could PATCH their own
  // already-created Leave to raise total_days past their balance, or flip
  // is_wfh/leave_type to 'work_from_home' without being wfh_eligible.
  // Re-validate, but ONLY when one of those leave-determining fields is
  // actually part of this PATCH, and NOT on an approve/reject transition —
  // deliberately narrow, since LeaveBalance's available/pending_approval
  // bookkeeping around the approval step (runLeaveAction) isn't something
  // this generic route should second-guess with its own re-derivation.
  const isLeaveContentChange = type === 'Leave' && ['total_days', 'is_wfh', 'leave_type', 'leave_policy_id', 'start_date'].some(f => f in req.body);
  if (isLeaveContentChange && !isScopedTransition) {
    if (!(await checkWfhEligibility(res, type, updated))) return;
    if (!(await checkLeaveBalanceSufficiency(res, type, updated))) return;
  }

  await run(
    `UPDATE entities SET data=$1, user_id=$2, status=$3, is_active=$4, updated_at=NOW()::TEXT WHERE id=$5`,
    [JSON.stringify(updated), updated.user_id ?? row.user_id, updated.status ?? row.status,
     updated.is_active !== false ? 1 : 0, id]
  );

  // Releasing a still-'pending' Leave's reservation (see reserveLeaveBalance
  // above) — only when it was actually reserved: a WFH request never drew
  // from a balance, and a request already approved/rejected had its
  // reservation resolved by runLeaveAction already, not here. This covers
  // both the employee's own self-service cancel (Leave.jsx) and an HR/
  // manager-initiated withdrawal, since both land here as a bare status PATCH.
  if (type === 'Leave' && current.status === 'pending' && ['cancelled', 'withdrawn'].includes(req.body.status)
      && !(current.is_wfh || current.leave_type === 'work_from_home') && current.leave_policy_id && current.total_days) {
    try {
      const leaveYear = new Date(current.start_date || Date.now()).getFullYear();
      await releaseLeaveReservation(current.user_id, current.leave_policy_id, leaveYear, current.total_days);
    } catch (e) { console.error(`[entities] leave balance release failed for ${id}:`, e.message); }
  }

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

  // Broadcast / workflow-step notifications on update (fire and forget)
  (async () => {
    try {
      if (type === 'Announcement' && req.body.status === 'published' && current.status !== 'published') {
        const audience = await getAnnouncementAudienceUserIds(updated);
        await notifyMany(audience, {
          title: `📢 ${updated.title || 'New Announcement'}`,
          message: (updated.content || '').slice(0, 180),
          type: 'info', link: '/Announcements',
        });
      } else if (type === 'JobRequisition') {
        const posLabel = `${updated.number_of_positions || 1} × ${updated.title || 'position'} (${updated.department || ''})`;
        if (req.body.manager_approval_status === 'approved' && current.manager_approval_status !== 'approved') {
          await notifyMany(await getHrAdminUserIds(), {
            title: 'Job Requisition Awaiting HR Approval',
            message: `${posLabel} was approved by the hiring manager and needs HR approval.`,
            type: 'info', link: '/JobRequisitions',
          });
        }
        if (req.body.manager_approval_status === 'rejected' && current.manager_approval_status !== 'rejected') {
          await notifyMany([updated.requested_by].filter(Boolean), {
            title: 'Job Requisition Rejected',
            message: `${posLabel} was rejected by the hiring manager${updated.manager_rejection_reason ? ` — ${updated.manager_rejection_reason}` : '.'}`,
            type: 'warning', link: '/JobRequisitions',
          });
        }
        if (req.body.hr_approval_status === 'approved' && current.hr_approval_status !== 'approved') {
          await notifyMany([updated.requested_by, updated.hiring_manager_id].filter(Boolean), {
            title: 'Job Requisition Approved',
            message: `${posLabel} was approved by HR. Generate & approve the JD to publish it.`,
            type: 'success', link: '/JobRequisitions',
          });
        }
        if (req.body.hr_approval_status === 'rejected' && current.hr_approval_status !== 'rejected') {
          await notifyMany([updated.requested_by, updated.hiring_manager_id].filter(Boolean), {
            title: 'Job Requisition Rejected',
            message: `${posLabel} was rejected by HR${updated.rejection_reason ? ` — ${updated.rejection_reason}` : '.'}`,
            type: 'warning', link: '/JobRequisitions',
          });
        }
        if (req.body.status === 'published' && current.status !== 'published') {
          await notifyMany([updated.requested_by, updated.hiring_manager_id].filter(Boolean), {
            title: 'Job Requisition Published',
            message: `${posLabel} is now live and accepting applications.`,
            type: 'success', link: '/JobRequisitions',
          });
        }
      } else if (type === 'Ticket') {
        if (req.body.assigned_to && req.body.assigned_to !== current.assigned_to) {
          await notifyMany([req.body.assigned_to], {
            title: 'Helpdesk Ticket Assigned to You',
            message: `${updated.subject || 'A ticket'} was assigned to you.`,
            type: 'info', link: '/Helpdesk',
          });
        }
        if (req.body.status && ['resolved', 'closed'].includes(req.body.status) && !['resolved', 'closed'].includes(current.status) && updated.user_id) {
          await notifyMany([updated.user_id], {
            title: `Ticket ${req.body.status === 'resolved' ? 'Resolved' : 'Closed'}`,
            message: `${updated.subject || 'Your ticket'} was marked ${req.body.status}.`,
            type: 'success', link: '/Helpdesk',
          });
        }
        if (req.body.status === 'in_progress' && current.status !== 'in_progress' && updated.user_id) {
          await notifyMany([updated.user_id], {
            title: 'Ticket In Progress',
            message: `${updated.subject || 'Your ticket'} is now being worked on.`,
            type: 'info', link: '/Helpdesk',
          });
        }
        // A new comment — notify whoever DIDN'T just write it: the raiser if
        // the assignee/department commented, or the assignee (falling back
        // to HR/admin if unassigned) if the raiser themselves commented.
        if (Array.isArray(req.body.comments) && req.body.comments.length > (current.comments?.length || 0)) {
          const lastComment = req.body.comments[req.body.comments.length - 1];
          const commenterId = lastComment?.author_id;
          const commentPreview = (lastComment?.text || '').slice(0, 120);
          const recipients = commenterId === updated.user_id
            ? (updated.assigned_to ? [updated.assigned_to] : await getHrAdminUserIds())
            : [updated.user_id].filter(Boolean);
          await notifyMany(recipients.filter(id => id !== commenterId), {
            title: 'New Comment on Ticket',
            message: `${lastComment?.author_name || 'Someone'} commented on "${updated.subject || 'a ticket'}"${commentPreview ? `: ${commentPreview}` : ''}`,
            type: 'info', link: '/Helpdesk',
          });
        }
      } else if (type === 'Asset') {
        if (req.body.assigned_to_user_id && req.body.assigned_to_user_id !== current.assigned_to_user_id) {
          await notifyMany([req.body.assigned_to_user_id], {
            title: 'Asset Assigned to You',
            message: `${updated.asset_name || 'An asset'} (${updated.asset_id || ''}) has been assigned to you.`,
            type: 'info', link: '/AssetTracking',
          });
        }
      } else if (type === 'GatePass' && req.body.status === 'approved' && current.status !== 'approved' && updated.outing_type === 'travelling_to_another_office' && updated.current_location) {
        // Manager just cleared a "travelling to another office" gate pass —
        // route it to whichever gate admin(s) are assigned to the
        // DEPARTURE office (current_location), not a blanket broadcast to
        // every gate admin, so it actually lands in the right office's
        // queue the way every other outing type already implicitly does
        // (any gate admin can already see/act on those — this type is the
        // one exception with a real office to route to).
        const emp = updated.employee_user_id
          ? JSON.parse((await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [updated.employee_user_id]))?.data || '{}')
          : {};
        const empName = emp?.display_name || 'An employee';
        const gateAdminIds = await getGateAdminUserIdsForLocation(updated.current_location);
        await notifyMany(gateAdminIds, {
          title: 'Inter-Office Travel — Gate Pass Approved',
          message: `${empName}'s gate pass to travel from ${updated.current_location} to ${updated.destination_location || 'another office'} was approved by their manager — awaiting departure.`,
          type: 'info', link: '/GateAdminDashboard',
        });
      } else if (type === 'GatePass' && req.body.status && req.body.status !== current.status && ['departed', 'returned'].includes(req.body.status)) {
        // Gate-log transitions (mark-out/mark-in by the gate admin) — notify
        // the employee themselves ("you're currently out" / "welcome back")
        // and their reporting manager, so both see live outing status
        // without having to open All Attendance / Gate Admin Dashboard.
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [updated.employee_user_id]);
        const emp = empRow ? JSON.parse(empRow.data) : null;
        const empName = emp?.display_name || 'Employee';
        const managerId = emp?.reporting_manager_id;
        const outingLabels = { official_outing: 'Official Outing', unofficial_outing: 'Unofficial Outing', half_day: 'Half Day', short_break: 'Short Break', early_leave: 'Early Leave', travelling_to_another_office: 'Travelling to Another Office' };
        const outingLabel = outingLabels[updated.outing_type] || updated.outing_type || 'outing';
        if (req.body.status === 'departed') {
          await notifyMany([updated.employee_user_id].filter(Boolean), {
            title: "You're Currently Out",
            message: `Your gate pass (${outingLabel}) is active — you're marked out${updated.reason ? `: ${updated.reason}` : '.'}`,
            type: 'info', link: '/GatePassRequest',
          });
          await notifyMany([managerId].filter(Boolean), {
            title: `${empName} is Currently Out`,
            message: `${empName} has stepped out on a gate pass (${outingLabel})${updated.reason ? ` — ${updated.reason}` : '.'}`,
            type: 'info', link: '/AllAttendance',
          });
        } else {
          await notifyMany([updated.employee_user_id].filter(Boolean), {
            title: 'Welcome Back',
            message: `Your gate pass outing (${outingLabel}) has been marked as returned.`,
            type: 'success', link: '/GatePassRequest',
          });
          await notifyMany([managerId].filter(Boolean), {
            title: `${empName} Has Returned`,
            message: `${empName} is back from their gate pass outing (${outingLabel}).`,
            type: 'success', link: '/AllAttendance',
          });
        }
      } else if (type === 'Candidate' && req.body.status === 'rejected' && current.status !== 'rejected' && updated.email) {
        // Candidates aren't app users — there's no in-app notification target,
        // only email. Previously a rejection only changed the status field
        // silently; the candidate never heard back at all.
        const tpl = emailTemplates.candidateRejection({
          candidateName: updated.full_name || 'Applicant',
          position: updated.position_applied || 'the role',
        });
        sendEmail({ to: updated.email, ...tpl }).catch(e => console.error('[email] Candidate rejection notification failed:', e.message));
      }
    } catch (ne) { console.error('[notif] post-update broadcast hook error:', ne.message); }
  })();

  cacheInvalidate(type);
  res.json(parseRow(newRow));
});

/* ── DELETE  DELETE /api/entities/:type/:id ─────────────── */
router.delete('/:type/:id', async (req, res) => {
  const cu = getCurrentUser(req);
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const { type, id } = req.params;
  if (!(await requireAdminForType(cu, res, type))) return;
  // Deleting a financial/statutory/compliance record is never self-serve —
  // always requires HR/admin/management, regardless of ownership.
  if (SENSITIVE_TYPES.has(type)) {
    const role = await getEffectiveRole(cu);
    if (!PRIVILEGED_ROLES.has(role)) return res.status(403).json({ error: 'Access denied' });
  } else {
    // General ownership baseline for every other type — deleting is
    // destructive/irreversible, so it deserves at least an ownership check
    // even outside the SENSITIVE_TYPES allowlist: any authenticated user
    // could otherwise delete any other employee's Ticket/GatePass/Leave/etc.
    // by id alone. Skipped for records with no user_id (org-wide config).
    const existing = await one('SELECT user_id FROM entities WHERE type=$1 AND id=$2', [type, id]);
    if (existing?.user_id && existing.user_id !== cu.id) {
      const genRole = await getEffectiveRole(cu);
      if (!PRIVILEGED_ROLES.has(genRole)) return res.status(403).json({ error: 'Access denied — not your record' });
    }
  }

  // Deleting a still-'pending' Leave must release its reservation first
  // (see reserveLeaveBalance) — the row (and the days it reserved) is about
  // to disappear entirely, so without this the reservation would be lost
  // for good, permanently understating the employee's real available balance.
  if (type === 'Leave') {
    const lvRow = await one('SELECT data FROM entities WHERE type=$1 AND id=$2', [type, id]);
    const lv = lvRow ? JSON.parse(lvRow.data) : null;
    if (lv && lv.status === 'pending' && !(lv.is_wfh || lv.leave_type === 'work_from_home') && lv.leave_policy_id && lv.total_days) {
      try {
        const leaveYear = new Date(lv.start_date || Date.now()).getFullYear();
        await releaseLeaveReservation(lv.user_id, lv.leave_policy_id, leaveYear, lv.total_days);
      } catch (e) { console.error(`[entities] leave balance release failed for deleted ${id}:`, e.message); }
    }
  }

  const result = await run('DELETE FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  cacheInvalidate(type);
  res.json({ success: true });
});

export default router;
