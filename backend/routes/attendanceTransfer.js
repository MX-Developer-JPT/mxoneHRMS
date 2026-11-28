// Admin tool (xf_*): move attendance from a left employee's old record to the same person's new record. Everything is
// previewed first, done in one transaction, logged with the original rows, and can be undone.
import { v4 as uuidv4 } from 'uuid';
import { one, all, withTransaction } from '../db.js';
import { isLeaver, lastWorkingDay, ymd } from '../utils/leavers.js';
import { planTransfer, suggestPairs } from '../utils/attendanceTransferRules.js';
import { clearOvertimeCache } from '../utils/overtimeData.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const fail = (res, error, code = 200) => res.status(code).json({ success: false, error });
const now = () => new Date().toISOString();

async function employees(db = null) {
  const sql = "SELECT id, user_id, data FROM entities WHERE type='Employee'";
  const rows = db ? (await db.query(sql)).rows : await all(sql);
  return rows.map((r) => { const d = parse(r.data); return { ...d, _row: r.id, user_id: d.user_id || r.user_id }; }).filter((e) => e.user_id);
}
const q = async (db, sql, params) => (db ? (await db.query(sql, params)).rows : all(sql, params));
// matched on either the table column or the record's own user_id: older biometric rows only carry one of them
const rowsOf = async (db, type, userId) => (await q(db, `SELECT id, user_id, status, data FROM entities WHERE type='${type}' AND (user_id=$1 OR data::jsonb->>'user_id'=$1)${db ? ' FOR UPDATE' : ''}`, [userId]))
  .map((r) => ({ id: r.id, user_id: r.user_id, status: r.status, raw: r.data, data: parse(r.data) }))
  .filter((r) => !r.data.user_id || r.data.user_id === userId);

async function logsFor(db, oldEmp) {
  const codes = [...new Set([oldEmp.employee_code, oldEmp.biometric_id].filter(Boolean).map((c) => String(c).trim().toUpperCase()))];
  return (await q(db, `SELECT id, user_id, data FROM entities WHERE type='AttendanceLog' AND (user_id=$1 OR data::jsonb->>'user_id'=$1 OR UPPER(TRIM(data::jsonb->>'EmployeeCode')) = ANY($2))`, [oldEmp.user_id, codes]))
    .map((r) => ({ id: r.id, user_id: r.user_id, raw: r.data, data: parse(r.data) }))
    .filter((r) => !r.data.user_id || r.data.user_id === oldEmp.user_id);
}

function checkPair(emps, p) {
  const oldEmp = emps.find((e) => e.user_id === p.old_user_id), newEmp = emps.find((e) => e.user_id === p.new_user_id);
  if (!oldEmp || !newEmp) return { error: 'Choose both the old and the new employee' };
  if (oldEmp.user_id === newEmp.user_id) return { error: 'The old and the new employee are the same record' };
  if (!isLeaver(oldEmp)) return { error: `${oldEmp.display_name} (${oldEmp.employee_code}) is not marked as left` };
  if (isLeaver(newEmp)) return { error: `${newEmp.display_name} (${newEmp.employee_code}) is marked as left: choose the current record` };
  for (const k of ['from', 'to']) if (p[k] && !/^\d{4}-\d{2}-\d{2}$/.test(p[k])) return { error: 'Choose valid dates' };
  if (p.from && p.to && p.to < p.from) return { error: 'The end date is before the start date' };
  return { oldEmp, newEmp };
}

async function planFor(db, oldEmp, newEmp, p) {
  const plan = planTransfer(await rowsOf(db, 'Attendance', oldEmp.user_id), await rowsOf(db, 'Attendance', newEmp.user_id), { from: p.from, to: p.to, onClash: p.on_clash });
  const inRange = (d) => d && (!p.from || d >= p.from) && (!p.to || d <= p.to);
  const kept = new Set(plan.keep.map((r) => String(r.data.date).slice(0, 10)));
  const logs = (await logsFor(db, oldEmp)).filter((l) => inRange(ymd(l.data.LogDate)));
  const regs = (await rowsOf(db, 'AttendanceRegularisation', oldEmp.user_id)).filter((r) => inRange(ymd(r.data.attendance_date || r.data.date)) && !kept.has(ymd(r.data.attendance_date || r.data.date)));
  return { ...plan, logs: logs.filter((l) => !kept.has(ymd(l.data.LogDate))), logsKept: logs.filter((l) => kept.has(ymd(l.data.LogDate))), regs, kept };
}
const summary = (plan) => ({ move: plan.move.length, replace: plan.remove.length, stay: plan.keep.length, clashes: plan.clashes, first: plan.first, last: plan.last, punches: plan.logs.length, regularisations: plan.regs.length });
const describe = (e) => ({ user_id: e.user_id, name: e.display_name || '', code: e.employee_code || '', department: e.department || '', date_of_joining: ymd(e.date_of_joining), last_working_date: isLeaver(e) ? lastWorkingDay(e) : '' });

const write = (db, id, userId, status, data) => db.query('UPDATE entities SET user_id=$1, status=$2, data=$3, updated_at=NOW()::TEXT WHERE id=$4', [userId, status, JSON.stringify(data), id]);

async function transferOne(oldId, newId, p, actor) {
  return withTransaction(async (db) => {
    // one transfer at a time: two clicks cannot both move (or half-move) the same rows
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['attendance-transfer']);
    const emps = await employees(db);
    const { oldEmp, newEmp, error } = checkPair(emps, { ...p, old_user_id: oldId, new_user_id: newId });
    if (error) return { error };
    const plan = await planFor(db, oldEmp, newEmp, p);
    if (!plan.move.length && !plan.logs.length && !plan.regs.length) return { error: `Nothing to move from ${oldEmp.employee_code} for this period` };
    const batchId = uuidv4();
    const snap = { removed: [], attendance: [], regs: [], logs: [], employees: {}, mapping_id: '' };

    for (const r of plan.remove) { snap.removed.push({ id: r.id, user_id: r.user_id, status: r.status, data: r.raw }); await db.query("DELETE FROM entities WHERE id=$1 AND type='Attendance'", [r.id]); }
    for (const [list, bag] of [[plan.move, snap.attendance], [plan.regs, snap.regs]]) for (const r of list) {
      bag.push({ id: r.id, user_id: r.user_id, employee_code: r.data.employee_code ?? null });
      await write(db, r.id, newEmp.user_id, r.status, { ...r.data, user_id: newEmp.user_id, employee_code: newEmp.employee_code, transferred_from_user_id: oldEmp.user_id, transferred_from_code: oldEmp.employee_code, transfer_id: batchId });
    }
    for (const l of plan.logs) {
      snap.logs.push({ id: l.id, user_id: l.user_id, data_user_id: l.data.user_id ?? null, off_role: l.data.off_role ?? null });
      await db.query('UPDATE entities SET user_id=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3', [newEmp.user_id, JSON.stringify({ ...l.data, user_id: newEmp.user_id, off_role: false, transfer_id: batchId }), l.id]);
    }
    // punches of days that stay with the old record must not follow the code mapping to the new one
    for (const l of plan.logsKept) if (!l.data.user_id) {
      snap.logs.push({ id: l.id, user_id: l.user_id, data_user_id: null, off_role: l.data.off_role ?? null });
      await db.query('UPDATE entities SET user_id=$1, data=$2 WHERE id=$3', [oldEmp.user_id, JSON.stringify({ ...l.data, user_id: oldEmp.user_id }), l.id]);
    }

    // future punches the machine still sends under the old code
    const oldCode = String(oldEmp.biometric_id || oldEmp.employee_code || '').trim();
    let mappingNote = '';
    if (p.map_old_code !== false && oldCode) {
      const taken = emps.find((e) => e.user_id !== oldEmp.user_id && [e.employee_code, e.biometric_id].some((c) => String(c || '').trim().toUpperCase() === oldCode.toUpperCase()));
      const existing = (await db.query("SELECT data FROM entities WHERE type='BiometricCodeMapping' AND UPPER(TRIM(data::jsonb->>'biometric_code'))=$1", [oldCode.toUpperCase()])).rows[0];
      if (taken && taken.user_id !== newEmp.user_id) mappingNote = `Code ${oldCode} now belongs to ${taken.display_name}, so new punches under it are not redirected.`;
      else if (existing) mappingNote = parse(existing.data).user_id === newEmp.user_id ? '' : `Code ${oldCode} is already mapped to someone else; check the biometric code mapping.`;
      else if (!taken) {
        snap.mapping_id = uuidv4();
        await db.query("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'BiometricCodeMapping',$2,'active',$3)", [snap.mapping_id, newEmp.user_id, JSON.stringify({ id: snap.mapping_id, biometric_code: oldCode, user_id: newEmp.user_id, employee_code: newEmp.employee_code, employee_name: newEmp.display_name, note: 'Old code after attendance transfer', created_at: now() })]);
      }
    }

    // the new record shows attendance from the first day moved; the old one drops off month reports once it has none left
    const patchEmployee = async (e, patch) => {
      const row = (await db.query('SELECT data FROM entities WHERE id=$1 FOR UPDATE', [e._row])).rows[0];
      const data = parse(row.data);
      snap.employees[e.user_id] = Object.fromEntries(Object.keys(patch).map((k) => [k, data[k] ?? null]));
      await db.query('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify({ ...data, ...patch }), e._row]);
    };
    if (plan.first) await patchEmployee(newEmp, { attendance_from: [ymd(newEmp.attendance_from), plan.first].filter(Boolean).sort()[0] });
    await patchEmployee(oldEmp, { attendance_transferred_to: newEmp.user_id, attendance_transferred_to_code: newEmp.employee_code || '' });

    const record = {
      id: batchId, old: describe(oldEmp), new: describe(newEmp), from: p.from || '', to: p.to || '', on_clash: p.on_clash === 'use_old' ? 'use_old' : 'keep_new',
      counts: summary(plan), snapshot: snap, mapping_note: mappingNote, by: actor.id, by_name: actor.name, created_at: now(), status: 'done',
    };
    await db.query("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceTransfer',$2,'done',$3)", [batchId, newEmp.user_id, JSON.stringify(record)]);
    await db.query("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [uuidv4(), actor.id, JSON.stringify({ entity_type: 'AttendanceTransfer', entity_id: batchId, change_type: 'attendance_transferred', from_code: oldEmp.employee_code, to_code: newEmp.employee_code, moved: plan.move.length, actor_name: actor.name, timestamp: now() })]);
    return { batch_id: batchId, counts: record.counts, mapping_note: mappingNote };
  });
}

async function undo(batchId, actor) {
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['attendance-transfer']);
    const row = (await db.query("SELECT data FROM entities WHERE type='AttendanceTransfer' AND id=$1 FOR UPDATE", [batchId])).rows[0];
    if (!row) return { error: 'Transfer not found' };
    const b = parse(row.data);
    if (b.status !== 'done') return { error: 'This transfer has already been undone' };
    const later = (await db.query("SELECT data FROM entities WHERE type='AttendanceTransfer' AND status='done' AND id<>$1", [batchId])).rows.map((r) => parse(r.data))
      .find((x) => x.created_at > b.created_at && [x.old.user_id, x.new.user_id].some((u) => [b.old.user_id, b.new.user_id].includes(u)));
    if (later) return { error: `Undo the later transfer (${later.old.code} to ${later.new.code}) first` };
    const s = b.snapshot;
    // ownership goes back; anything corrected on a row after the transfer is kept
    let restored = 0;
    for (const r of [...s.attendance, ...s.regs]) {
      const cur = (await db.query('SELECT status, data FROM entities WHERE id=$1 FOR UPDATE', [r.id])).rows[0];
      if (!cur) continue;
      const { transferred_from_user_id, transferred_from_code, transfer_id, employee_code, ...data } = parse(cur.data);
      await write(db, r.id, r.user_id, cur.status, { ...data, user_id: b.old.user_id, ...(r.employee_code === null ? {} : { employee_code: r.employee_code }) });
      restored++;
    }
    for (const r of s.removed) await db.query("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4) ON CONFLICT (id) DO NOTHING", [r.id, r.user_id, r.status, r.data]);
    for (const l of s.logs) {
      const cur = (await db.query('SELECT data FROM entities WHERE id=$1 FOR UPDATE', [l.id])).rows[0];
      if (!cur) continue;
      const { transfer_id, off_role, ...data } = parse(cur.data);
      await db.query('UPDATE entities SET user_id=$1, data=$2 WHERE id=$3', [l.user_id, JSON.stringify({ ...data, user_id: l.data_user_id, ...(l.off_role === null ? {} : { off_role: l.off_role }) }), l.id]);
    }
    if (s.mapping_id) await db.query("DELETE FROM entities WHERE type='BiometricCodeMapping' AND id=$1", [s.mapping_id]);
    for (const [userId, before] of Object.entries(s.employees)) {
      const e = (await db.query("SELECT id, data FROM entities WHERE type='Employee' AND (user_id=$1 OR data::jsonb->>'user_id'=$1) FOR UPDATE", [userId])).rows[0];
      if (!e) continue;
      const data = parse(e.data);
      for (const [k, v] of Object.entries(before)) { if (v === null) delete data[k]; else data[k] = v; }
      await db.query('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(data), e.id]);
    }
    await db.query("UPDATE entities SET status='undone', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ ...b, status: 'undone', undone_by: actor.id, undone_by_name: actor.name, undone_at: now() }), batchId]);
    await db.query("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [uuidv4(), actor.id, JSON.stringify({ entity_type: 'AttendanceTransfer', entity_id: batchId, change_type: 'attendance_transfer_undone', actor_name: actor.name, timestamp: now() })]);
    return { restored };
  });
}

export async function handleAttendanceTransfer(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const u = (await one('SELECT role, custom_role, full_name FROM users WHERE id=$1', [cu.id])) || {};
  if (![u.role, u.custom_role].includes('admin')) return fail(res, 'Only an administrator can transfer attendance records', 403);
  const actor = { id: cu.id, name: u.full_name || '' };

  if (name === 'xf_options') {
    const emps = await employees();
    const count = Object.fromEntries((await all("SELECT COALESCE(data::jsonb->>'user_id', user_id) AS u, COUNT(*) AS n FROM entities WHERE type='Attendance' GROUP BY 1")).map((r) => [r.u, Number(r.n)]));
    const view = (e) => ({ ...describe(e), records: count[e.user_id] || 0, transferred_to: e.attendance_transferred_to_code || '' });
    const left = emps.filter(isLeaver), current = emps.filter((e) => !isLeaver(e));
    const history = (await all("SELECT data FROM entities WHERE type='AttendanceTransfer' ORDER BY created_at DESC LIMIT 200")).map((r) => { const { snapshot, ...h } = parse(r.data); return h; });
    return res.json({ success: true, left: left.map(view), current: current.map(view), suggestions: suggestPairs(left.filter((e) => count[e.user_id]), current), history });
  }

  const pairs = Array.isArray(p.pairs) ? p.pairs.slice(0, 100) : [];
  if (name === 'xf_preview' || name === 'xf_transfer') {
    if (!pairs.length) return fail(res, 'Add at least one old → new pair');
    const olds = pairs.map((x) => x.old_user_id);
    if (new Set(olds).size !== olds.length) return fail(res, 'The same old employee is listed twice');
    const results = [];
    for (const x of pairs) {
      const opts = { ...x, from: p.from || '', to: p.to || '', on_clash: p.on_clash, map_old_code: p.map_old_code };
      const emps = await employees();
      const { oldEmp, newEmp, error } = checkPair(emps, opts);
      const base = { old_user_id: x.old_user_id, new_user_id: x.new_user_id, old: oldEmp ? describe(oldEmp) : null, new: newEmp ? describe(newEmp) : null };
      if (error) { results.push({ ...base, error }); continue; }
      try {
        if (name === 'xf_preview') results.push({ ...base, ...summary(await planFor(null, oldEmp, newEmp, opts)) });
        else { const out = await transferOne(x.old_user_id, x.new_user_id, opts, actor); results.push(out.error ? { ...base, error: out.error } : { ...base, ...out.counts, batch_id: out.batch_id, mapping_note: out.mapping_note }); }
      } catch (e) { console.error('[attendance-transfer]', e.message); results.push({ ...base, error: `Nothing was changed for this pair: ${e.message}` }); }
    }
    if (name === 'xf_transfer') clearOvertimeCache();
    return res.json({ success: true, results });
  }

  if (name === 'xf_undo') {
    const out = await undo(p.batch_id, actor);
    if (out.error) return fail(res, out.error);
    clearOvertimeCache();
    return res.json({ success: true, ...out });
  }
  return res.status(400).json({ error: `Unknown function ${name}` });
}
