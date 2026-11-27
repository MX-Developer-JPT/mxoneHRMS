// Gate pass functions (gp_*): the role-scoped board and detail views, and every inter-office travel action. Each action
// locks the pass row, re-checks the rules, stamps the server time and appends to the pass history in one transaction, so a
// double click or two gate admins at once cannot record a movement twice.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run, withTransaction } from '../db.js';
import { applyGatePassOuting } from './attendancelog.js';
import { cacheInvalidate } from './entities.js';
import { TRAVEL, isTravel, istNow, passNo, historyEntry, withHistory, permissions, stageOf, travelLabel, officeGateAdmins } from '../utils/gatePassRules.js';

const roleOf = (u) => u?.custom_role || u?.role || '';
const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });

export async function notifyIds(ids, { title, message, type = 'info', link = '/GatePassRequest' }) {
  const { sendPushToUser } = await import('../utils/push.js');
  for (const uid of new Set((ids || []).filter(Boolean))) {
    try {
      await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), uid, title, message, type, link]);
      sendPushToUser(uid, { title, message, type, link });
    } catch (e) { console.error('[gatepass] notify failed:', e.message); }
  }
}

async function gateAdmins() {
  const users = await all("SELECT id FROM users WHERE disabled_at IS NULL AND COALESCE(NULLIF(custom_role,''), role)='gate_admin'");
  const rows = await all("SELECT user_id, data FROM entities WHERE type='GateAdminLocation'");
  const map = Object.fromEntries(rows.map((r) => [r.user_id, parse(r.data).locations]));
  return users.map((u) => ({ id: u.id, locations: Array.isArray(map[u.id]) ? map[u.id] : null }));
}
export const gateAdminIdsFor = async (office) => officeGateAdmins(await gateAdmins(), office);
const hrIds = async () => (await all("SELECT id FROM users WHERE disabled_at IS NULL AND COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')")).map((r) => r.id);

async function activeOffices() {
  return (await all("SELECT data FROM entities WHERE type='AppLocation'")).map((r) => parse(r.data)).filter((l) => l.name && String(l.is_active) !== 'false' && l.is_active !== 0).map((l) => l.name).sort();
}

// People directory + reporting chain, loaded once per request.
async function directory() {
  const people = {};
  for (const u of await all('SELECT id, full_name, role, custom_role FROM users')) people[u.id] = { name: u.full_name, role: roleOf(u) };
  for (const r of await all("SELECT user_id, data FROM entities WHERE type='Employee'")) {
    const e = parse(r.data);
    if (r.user_id) people[r.user_id] = { ...people[r.user_id], name: e.display_name || people[r.user_id]?.name, code: e.employee_code || '', department: e.department || '', designation: e.designation || '', manager: e.reporting_manager_id || null };
  }
  const manages = (managerId, userId) => {
    const seen = new Set(); let cur = userId;
    while (cur && !seen.has(cur)) { seen.add(cur); const m = people[cur]?.manager; if (!m) return false; if (m === managerId) return true; cur = m; }
    return false;
  };
  return { people, manages };
}

async function viewerFor(cu) {
  const u = await one('SELECT id, full_name, role, custom_role FROM users WHERE id=$1', [cu.id]);
  const role = roleOf(u);
  let assigned = null;
  if (['gate_admin', 'front_desk_admin'].includes(role)) {
    const row = await one("SELECT data FROM entities WHERE type='GateAdminLocation' AND user_id=$1", [cu.id]);
    const l = row ? parse(row.data).locations : null;
    assigned = Array.isArray(l) ? l : null;
  }
  const dir = await directory();
  return { id: cu.id, role, assigned, dir, actor: { id: cu.id, name: dir.people[cu.id]?.name || u?.full_name || 'User', code: dir.people[cu.id]?.code || '', role } };
}

const permsFor = (pass, v) => permissions(pass, { id: v.id, role: v.role, assigned: v.assigned, manages: v.dir.manages(v.id, pass.employee_user_id) });

function canSee(pass, v) {
  if (pass.employee_user_id === v.id || ['hr', 'admin'].includes(v.role)) return true;
  if (v.role === 'gate_admin' || v.role === 'front_desk_admin') {
    if (v.assigned === null || !pass.current_location) return true;
    return v.assigned.includes(pass.current_location) || (isTravel(pass) && v.assigned.includes(pass.destination_location));
  }
  return v.dir.manages(v.id, pass.employee_user_id);
}

function present(pass, v) {
  const e = v.dir.people[pass.employee_user_id] || {};
  return {
    ...pass, pass_no: passNo(pass), stage: stageOf(pass), travel_label: travelLabel(pass),
    employee: { name: e.name || 'Unknown', code: e.code || '', department: e.department || '', designation: e.designation || '' },
    approver_name: v.dir.people[pass.manager_user_id]?.name || '',
    can: permsFor(pass, v),
  };
}

const readPass = (r) => ({ ...parse(r.data), id: r.id, created_date: parse(r.data).created_date || r.created_at });

// Lock the pass, let `change` decide, and save. change(pass, client) returns { error } or { pass }.
async function transition(id, change) {
  const out = await withTransaction(async (client) => {
    const { rows } = await client.query("SELECT id, data, created_at FROM entities WHERE type='GatePass' AND id=$1 FOR UPDATE", [id]);
    if (!rows[0]) return { error: 'Gate pass not found', code: 404 };
    const stored = parse(rows[0].data);
    const result = await change(readPass(rows[0]), client);
    if (result.error) return result;
    const next = { ...stored, ...result.pass };
    next.pass_no = passNo(next);
    await client.query('UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3', [JSON.stringify(next), next.status, id]);
    return { pass: { ...next, id } };
  });
  if (!out.error) cacheInvalidate('GatePass');
  return out;
}

const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' });
function travelDetails(pass, v) {
  const e = v.dir.people[pass.employee_user_id] || {};
  return `${e.name || 'Employee'}${e.code ? ` (${e.code})` : ''}${e.designation || e.department ? `, ${[e.designation, e.department].filter(Boolean).join(', ')}` : ''}`;
}
const eta = (p) => (p.expected_arrival_time ? ` Expected arrival: ${when(String(p.expected_arrival_time).length === 16 ? `${p.expected_arrival_time}:00Z` : p.expected_arrival_time)}.` : '');

const H = {
  async gp_board({ v, res, p }) {
    const since = istNow(Date.now() - (Number(p.days) > 0 ? Math.min(Number(p.days), 730) : 90) * 86400000).slice(0, 10);
    const rows = await all("SELECT id, data, created_at FROM entities WHERE type='GatePass' AND (status IN ('pending_approval','approved','departed') OR COALESCE(data::jsonb->>'request_date', LEFT(created_at::text,10)) >= $1) ORDER BY created_at DESC", [since]);
    let passes = rows.map(readPass).filter((x) => x.employee_user_id);
    passes = p.scope === 'mine' ? (await all("SELECT id, data, created_at FROM entities WHERE type='GatePass' AND data::jsonb->>'employee_user_id'=$1 ORDER BY created_at DESC", [v.id])).map(readPass) : passes.filter((x) => canSee(x, v));
    return res.json({ success: true, role: v.role, my_offices: v.assigned, offices: await activeOffices(), since, now: istNow(), passes: passes.map((x) => present(x, v)) });
  },

  async gp_detail({ v, res, p }) {
    const r = await one("SELECT id, data, created_at FROM entities WHERE type='GatePass' AND id=$1", [p.id]);
    if (!r) return fail(res, 'Gate pass not found', 404);
    const pass = readPass(r);
    if (!canSee(pass, v)) return fail(res, 'You do not have access to this gate pass', 403);
    return res.json({ success: true, offices: await activeOffices(), pass: present(pass, v) });
  },

  async gp_gate_out({ v, res, p }) {
    const offices = await activeOffices();
    const out = await transition(p.id, async (pass, client) => {
      if (!isTravel(pass)) return { error: 'This is not an inter-office travel pass' };
      if (pass.status !== 'approved') return { error: pass.status === 'departed' ? 'Gate-Out is already recorded for this pass' : `This pass is ${pass.status.replace(/_/g, ' ')} — it cannot be marked Out` };
      if (!permsFor(pass, v).gate_out) return { error: `Only a Gate Admin of ${pass.current_location} can confirm this Gate-Out`, code: 403 };
      if (!offices.includes(pass.destination_location)) return { error: `${pass.destination_location} is no longer an active office — change the destination first` };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`GatePassTravel:${pass.employee_user_id}`]);
      const other = await client.query("SELECT 1 FROM entities WHERE type='GatePass' AND status='departed' AND id<>$1 AND data::jsonb->>'employee_user_id'=$2 AND data::jsonb->>'outing_type'=$3", [pass.id, pass.employee_user_id, TRAVEL]);
      if (other.rows.length) return { error: 'This employee already has a trip in progress. Close it before starting another.' };
      const at = istNow();
      return { pass: withHistory({ ...pass, status: 'departed', departure_time: at, departed_by_id: v.id, departed_by_name: v.actor.name, departed_by_code: v.actor.code },
        historyEntry({ at, action: 'gate_out', from: 'approved', to: 'departed', actor: v.actor, office: pass.current_location, remarks: p.remarks }),
        historyEntry({ at, action: 'in_transit', from: 'departed', to: 'departed', office: pass.destination_location })) };
    });
    if (out.error) return fail(res, out.error, out.code);
    const pass = out.pass;
    try { await applyGatePassOuting(pass, 'departed'); } catch (e) { console.error('[gatepass] travel attendance failed:', e.message); }
    const admins = await gateAdminIdsFor(pass.destination_location);
    await notifyIds(admins, { title: `Incoming employee — ${pass.destination_location}`, type: 'info', link: '/GateAdminDashboard',
      message: `${travelDetails(pass, v)} has departed from ${pass.current_location} and is travelling to ${pass.destination_location}. Departure: ${when(pass.departure_time)}.${eta(pass)} Gate pass ${passNo(pass)}. Please mark the arrival when the employee reaches your location.` });
    await notifyIds([pass.employee_user_id], { title: `Travelling to ${pass.destination_location}`, message: `Gate-Out recorded at ${pass.current_location} (${when(pass.departure_time)}). Ask the Gate Admin at ${pass.destination_location} to mark your arrival.` });
    await notifyIds([v.dir.people[pass.employee_user_id]?.manager], { title: 'Team member is travelling', message: `${travelDetails(pass, v)} left ${pass.current_location} for ${pass.destination_location} at ${when(pass.departure_time)}.`, link: '/AllAttendance' });
    return res.json({ success: true, pass: present(pass, v), notified_gate_admins: admins.length });
  },

  async gp_arrive({ v, res, p }) {
    const out = await transition(p.id, async (pass) => {
      if (!isTravel(pass)) return { error: 'This is not an inter-office travel pass' };
      if (pass.status === 'completed') return { error: 'Arrival is already recorded for this pass' };
      if (pass.status !== 'departed') return { error: 'Arrival can be marked only after Gate-Out' };
      if (!permsFor(pass, v).arrive) return { error: `Only a Gate Admin of ${pass.destination_location} can confirm this arrival`, code: 403 };
      const at = istNow();
      return { pass: withHistory({ ...pass, status: 'completed', arrival_time: at, arrived_by_id: v.id, arrived_by_name: v.actor.name, arrived_by_code: v.actor.code, arrival_remarks: String(p.remarks || '').slice(0, 500), travel_outcome: 'arrived', lop_deduction_days: 0 },
        historyEntry({ at, action: 'gate_in', from: 'departed', to: 'completed', actor: v.actor, office: pass.destination_location, remarks: p.remarks }),
        historyEntry({ at, action: 'completed', from: 'completed', to: 'completed' })) };
    });
    if (out.error) return fail(res, out.error, out.code);
    const pass = out.pass;
    const msg = `${travelDetails(pass, v)} arrived at ${pass.destination_location} at ${when(pass.arrival_time)} (left ${pass.current_location} at ${when(pass.departure_time)}). Gate pass ${passNo(pass)} is completed.`;
    await notifyIds([pass.employee_user_id], { title: `Arrival recorded — ${pass.destination_location}`, message: msg, type: 'success' });
    await notifyIds([v.dir.people[pass.employee_user_id]?.manager], { title: 'Team member arrived', message: msg, type: 'success', link: '/AllAttendance' });
    await notifyIds(await gateAdminIdsFor(pass.current_location), { title: 'Travel completed', message: msg, type: 'success', link: '/GateAdminDashboard' });
    return res.json({ success: true, pass: present(pass, v) });
  },

  async gp_change_destination({ v, res, p }) {
    const reason = String(p.reason || '').trim(); const to = String(p.destination || '').trim();
    if (!reason) return fail(res, 'Give the reason for changing the destination');
    if (!(await activeOffices()).includes(to)) return fail(res, 'Choose an active company office');
    let before = '';
    const out = await transition(p.id, async (pass) => {
      if (!permsFor(pass, v).change_destination) return { error: 'Only the reporting manager or HR can change the destination of an open trip', code: 403 };
      if (to === pass.destination_location) return { error: 'That is already the destination' };
      if (to === pass.current_location && pass.status !== 'departed') return { error: 'The destination must be different from the departure office. Cancel the trip instead.' };
      before = pass.destination_location;
      const at = istNow();
      return { pass: withHistory({ ...pass, destination_location: to, overdue_notified_at: null, destination_changes: [...(pass.destination_changes || []), { at, from: before, to, by_name: v.actor.name, reason }] },
        historyEntry({ at, action: 'destination_changed', from: pass.status, to: pass.status, actor: v.actor, office: to, remarks: `${before} → ${to}: ${reason}` })) };
    });
    if (out.error) return fail(res, out.error, out.code);
    const pass = out.pass;
    const msg = `${travelDetails(pass, v)}: destination changed from ${before} to ${to} by ${v.actor.name}. Reason: ${reason}. Gate pass ${passNo(pass)}.`;
    await notifyIds(await gateAdminIdsFor(before), { title: 'Incoming employee redirected', message: msg, type: 'warning', link: '/GateAdminDashboard' });
    await notifyIds(await gateAdminIdsFor(to), { title: pass.status === 'departed' ? `Incoming employee — ${to}` : 'Travel destination changed', message: pass.status === 'departed' ? `${msg} Departed ${when(pass.departure_time)}. Please mark the arrival.` : msg, link: '/GateAdminDashboard' });
    if (to !== pass.current_location && before !== pass.current_location) await notifyIds(await gateAdminIdsFor(pass.current_location), { title: 'Travel destination changed', message: msg, link: '/GateAdminDashboard' });
    await notifyIds([pass.employee_user_id], { title: 'Your destination was changed', message: msg, type: 'warning' });
    return res.json({ success: true, pass: present(pass, v) });
  },

  async gp_cancel_trip({ v, res, p }) {
    const reason = String(p.reason || '').trim();
    if (!reason) return fail(res, 'Give the reason');
    let wasOut = false;
    const out = await transition(p.id, async (pass) => {
      if (!permsFor(pass, v).cancel_trip) return { error: pass.status === 'departed' ? 'After Gate-Out only the reporting manager or HR can close a trip' : 'You cannot cancel this trip', code: 403 };
      wasOut = pass.status === 'departed';
      const outcome = !wasOut ? 'cancelled_before_departure' : p.outcome === 'not_arrived' ? 'not_arrived' : 'cancelled_in_transit';
      const at = istNow();
      return { pass: withHistory({ ...pass, status: 'cancelled', travel_outcome: outcome, closed_at: at, closed_by_name: v.actor.name, close_reason: reason },
        historyEntry({ at, action: outcome, from: wasOut ? 'departed' : 'approved', to: 'cancelled', actor: v.actor, remarks: reason })) };
    });
    if (out.error) return fail(res, out.error, out.code);
    const pass = out.pass;
    const what = pass.travel_outcome === 'not_arrived' ? 'did not arrive' : 'trip cancelled';
    const msg = `${travelDetails(pass, v)}: travel ${pass.current_location} → ${pass.destination_location} — ${what} (recorded by ${v.actor.name}: ${reason}). Gate pass ${passNo(pass)}.${wasOut ? ' Please review the day\'s attendance.' : ''}`;
    await notifyIds([...(await gateAdminIdsFor(pass.destination_location)), ...(await gateAdminIdsFor(pass.current_location))], { title: 'Inter-office travel closed', message: msg, type: 'warning', link: '/GateAdminDashboard' });
    await notifyIds([pass.employee_user_id, v.dir.people[pass.employee_user_id]?.manager], { title: 'Inter-office travel closed', message: msg, type: 'warning' });
    if (wasOut) await notifyIds(await hrIds(), { title: 'Travel not completed — review attendance', message: msg, type: 'warning', link: '/AllAttendance' });
    return res.json({ success: true, pass: present(pass, v) });
  },
};

export async function handleGatePass(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const fn = H[name];
  if (!fn) return fail(res, `Unknown function ${name}`, 404);
  return fn({ v: await viewerFor(cu), res, p: p || {} });
}
