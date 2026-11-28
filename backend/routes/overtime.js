// Overtime functions (ot_*): report, Excel export and the overtime policy. Figures come only from utils/overtime.js.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { buildOvertimeReport, cleanPolicy } from '../utils/overtime.js';
import { loadOvertimeContext, loadPolicy, clearOvertimeCache } from '../utils/overtimeData.js';
import { buildOvertimeWorkbook } from '../utils/overtimeExport.js';

const VIEW_ROLES = ['hr', 'admin', 'management'];
const EDIT_ROLES = ['hr', 'admin'];
const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const monthEnd = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

export async function overtimeFor({ from, to, department, user_id }) {
  const ctx = await loadOvertimeContext();
  let employees = ctx.employees;
  if (department && department !== 'all') employees = employees.filter((e) => (e.department || 'Unassigned') === department);
  if (user_id) employees = employees.filter((e) => e.user_id === user_id);
  const ids = employees.map((e) => e.user_id).filter(Boolean);
  const records = ids.length ? (await all(
    "SELECT user_id, data FROM entities WHERE type='Attendance' AND (user_id = ANY($1) OR data::jsonb->>'user_id' = ANY($1)) AND data::jsonb->>'date' >= $2 AND data::jsonb->>'date' <= $3",
    [ids, from, to])).map((r) => { const d = parse(r.data); return { ...d, user_id: d.user_id || r.user_id }; }) : [];
  const basicByUser = {};
  for (const r of await all("SELECT user_id, data FROM entities WHERE type='SalaryStructure' AND status='active'")) {
    const s = parse(r.data); if (!(r.user_id in basicByUser)) basicByUser[r.user_id] = s.basic_salary || s.basic_monthly || 0;
  }
  const report = buildOvertimeReport({ records, employees, shiftById: ctx.shiftById, defaultShift: ctx.defaultShift, holidayByDate: ctx.holidayByDate, basicByUser, policy: ctx.policy });
  return { report, policy: ctx.policy, employees: ctx.employees };
}

export async function handleOvertime(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const u = await one('SELECT role, custom_role, full_name FROM users WHERE id=$1', [cu.id]) || {};
  const has = (list) => [u.role, u.custom_role].some((r) => list.includes(r));
  if (!has(VIEW_ROLES)) return res.status(403).json({ error: 'HR / Management access required' });

  if (name === 'ot_save_policy') {
    if (!has(EDIT_ROLES)) return res.status(403).json({ error: 'HR / Admin access required' });
    const before = await loadPolicy();
    const { multiplier, ...policy } = cleanPolicy(p.policy || {});
    const data = { ...policy, updated_by: cu.id, updated_by_name: u.full_name || '', updated_at: new Date().toISOString() };
    const row = await one("SELECT id FROM entities WHERE type='OvertimePolicy' LIMIT 1");
    if (row) await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify({ ...data, id: row.id }), row.id]);
    else { const id = uuidv4(); await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'OvertimePolicy',NULL,'active',$2)", [id, JSON.stringify({ ...data, id })]); }
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)",
      [uuidv4(), cu.id, JSON.stringify({ entity_type: 'OvertimePolicy', change_type: 'policy_updated', before, after: policy, actor_name: u.full_name || '', timestamp: data.updated_at })]);
    clearOvertimeCache();
    return res.json({ success: true, policy: await loadPolicy() });
  }

  let { from, to } = p;
  if ((!from || !to) && p.month && p.year) { from = `${p.year}-${String(p.month).padStart(2, '0')}-01`; to = monthEnd(Number(p.year), Number(p.month)); }
  // one employee with no dates = their complete history
  if (p.user_id && !from) from = '2000-01-01';
  if (p.user_id && !to) to = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  if (!isDate(from) || !isDate(to) || to < from) return res.status(400).json({ success: false, error: 'Choose a valid period' });
  if (!p.user_id && (Date.parse(to) - Date.parse(from)) / 86400000 > 370) return res.status(400).json({ success: false, error: 'Choose at most one year, or pick one employee for the complete history' });

  const { report, policy, employees } = await overtimeFor({ from, to, department: p.department, user_id: p.user_id });

  if (name === 'ot_report') {
    const departments = [...new Set(employees.map((e) => e.department || 'Unassigned'))].sort();
    const people = employees.filter((e) => e.user_id && (!policy.eligible_only || e.overtime_eligible))
      .map((e) => ({ user_id: e.user_id, name: e.display_name || '', code: e.employee_code || '' })).sort((a, b) => a.name.localeCompare(b.name));
    return res.json({ success: true, from, to, policy, can_edit: has(EDIT_ROLES), departments_list: departments, people, eligible_count: employees.filter((e) => e.overtime_eligible && e.status === 'active').length, ...report });
  }
  if (name === 'ot_export') {
    const ExcelJS = (await import('exceljs')).default;
    const person = p.user_id ? employees.find((e) => e.user_id === p.user_id) : null;
    const scope = person ? `${person.display_name || ''} (${person.employee_code || ''})` : p.department && p.department !== 'all' ? `Department: ${p.department}` : 'All departments';
    const first = person && from === '2000-01-01' ? report.days[0]?.date || to : from;
    const out = await buildOvertimeWorkbook({ report, from: first, to, policy, scope, view: p.view }, ExcelJS);
    return res.json({ success: true, base64: Buffer.from(out.buffer).toString('base64'), filename: out.filename });
  }
  return res.status(400).json({ error: `Unknown function ${name}` });
}
