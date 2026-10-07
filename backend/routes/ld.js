// Learning & Development module — back end.
//
// Called through the existing functions endpoint (see the `ld_` prefix hook in functions.js), so it
// reuses the platform's authentication, roles, notifications and entity storage instead of
// creating a parallel system. All data lives in the generic `entities` table:
//   LdConfig · LdTemplate (versioned) · LdInduction (a workflow instance per employee) · LdCourse ·
//   LdPath · LdAssignment · LdAssessment · LdAttempt · LdCertificate · LdWaiver · LdTrainer ·
//   LdSkill · LdEmpSkill · LdFeedback · LdAudit
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { DEFAULT_CONFIG, DEFAULT_TEMPLATE, DEFAULT_ASSESSMENT, DEFAULT_COURSES } from '../utils/ldSeed.js';

const IST_MS = 5.5 * 3600000;
export const todayIST = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const clone = (o) => JSON.parse(JSON.stringify(o));
const clean = (s, n = 4000) => String(s ?? '').trim().slice(0, n);

// ── storage helpers ───────────────────────────────────────────────────────
const parse = (r) => { try { const d = JSON.parse(r.data); return { ...d, id: d.id || r.id }; } catch { return null; } };
export async function list(type, extraSql = '', params = []) {
  return (await all(`SELECT id, data FROM entities WHERE type=$1 ${extraSql}`, [type, ...params])).map(parse).filter(Boolean);
}
export async function get(type, id) {
  if (!id) return null;
  const r = await one("SELECT id, data FROM entities WHERE type=$1 AND id=$2", [type, id]);
  return r ? parse(r) : null;
}
async function create(type, data, userId = null) {
  const id = data.id || uuidv4();
  const doc = { ...data, id, created_at: data.created_at || nowIso() };
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,$2,$3,$4,$5)", [id, type, userId, doc.status || null, JSON.stringify(doc)]);
  return doc;
}
async function save(type, doc) {
  doc.updated_at = nowIso();
  await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3 AND type=$4", [JSON.stringify(doc), doc.status || null, doc.id, type]);
  return doc;
}

// One writer at a time per induction (a trainer and the employee can act at the same moment).
const locks = new Map();
export function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run_ = prev.catch(() => {}).then(fn);
  const tail = run_.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run_;
}

async function audit(entityType, entityId, action, actorId, details = {}, userId = null) {
  try {
    await create('LdAudit', { entity_type: entityType, entity_id: entityId, action, actor_id: actorId || 'system', user_id: userId, details, at: nowIso() }, userId);
  } catch (e) { console.warn('[ld] audit failed:', e.message); }
}

async function notify(userIds, { title, message, type = 'info', link = '/MyLearning' }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  for (const uid of ids) {
    try {
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [uuidv4(), uid, title, message, type, link]);
      const { sendPushToUser } = await import('../utils/push.js');
      sendPushToUser(uid, { title, message, type, link });
    } catch (e) { console.warn('[ld] notify failed:', e.message); }
  }
}

// ── config / seed ─────────────────────────────────────────────────────────
export async function getConfig() {
  const d = await get('LdConfig', 'ld-config');
  return { ...DEFAULT_CONFIG, ...(d || {}), escalation_days: { ...DEFAULT_CONFIG.escalation_days, ...(d?.escalation_days || {}) } };
}
let seeded = false;
export async function ensureSeed() {
  if (seeded) return;
  seeded = true;
  try {
    if (!(await list('LdTemplate')).length) await create('LdTemplate', clone(DEFAULT_TEMPLATE));
    if (!(await list('LdAssessment')).some(a => a.key === DEFAULT_ASSESSMENT.key)) await create('LdAssessment', clone(DEFAULT_ASSESSMENT));
    if (!(await list('LdCourse')).length) for (const c of DEFAULT_COURSES) await create('LdCourse', { ...c, status: 'active', version: 1, code: 'C-' + uuidv4().slice(0, 6).toUpperCase() });
    if (!(await get('LdConfig', 'ld-config'))) await create('LdConfig', { ...DEFAULT_CONFIG, id: 'ld-config' });
  } catch (e) { seeded = false; console.error('[ld] seed failed:', e.message); }
}

// ── people / roles ────────────────────────────────────────────────────────
async function getUserRow(id) { return id ? await one("SELECT id, email, full_name, role, custom_role FROM users WHERE id=$1", [id]) : null; }
async function getEmployee(userId) {
  const r = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
  return r ? parse(r) : null;
}
async function nameOf(userId) {
  if (!userId) return '';
  const e = await getEmployee(userId);
  if (e?.display_name) return e.display_name;
  return (await getUserRow(userId))?.full_name || '';
}
async function deptHead(deptName) {
  if (!deptName) return null;
  const d = (await list('Department')).find(x => String(x.name || '').toLowerCase() === String(deptName).toLowerCase());
  return d?.head_user_id || null;
}

export async function getCtx(cu) {
  const u = await getUserRow(cu.id);
  const role = u?.custom_role || u?.role || 'user';
  const cfg = await getConfig();
  const trainerRows = await list('LdTrainer');
  const isAdmin = role === 'admin' || u?.role === 'admin';
  const isHR = isAdmin || role === 'hr' || u?.role === 'hr';
  return {
    id: cu.id, user: u, role, cfg, isAdmin, isHR,
    isLdAdmin: isHR || cfg.ld_admin_user_ids.includes(cu.id),
    isManagement: role === 'management',
    isTrainer: trainerRows.some(t => t.user_id === cu.id && t.active !== false),
  };
}

// Which roles may act on THIS induction (an employee can never act as an owner on their own induction).
function rolesOnInduction(ctx, ind) {
  if (ctx.id === ind.user_id) return new Set();
  const r = new Set();
  if (ctx.isHR) r.add('hr');
  if (ctx.isLdAdmin) r.add('ld');
  if (ind.employee.reporting_manager_id === ctx.id) r.add('manager');
  if (ind.hod_user_id === ctx.id) r.add('hod');
  if (ind.trainer_user_id === ctx.id || ctx.isTrainer) r.add('trainer');
  if (ind.hr_spoc_user_id === ctx.id) r.add('hr_spoc');
  return r;
}
const canOwn = (ctx, ind, gate) => {
  if (ctx.id === ind.user_id) return false;
  if (ctx.isAdmin) return true;
  const mine = rolesOnInduction(ctx, ind);
  return gate.owner_roles.some(r => mine.has(r)) || (ctx.isHR && gate.owner_roles.includes('hr_spoc'));
};
const canView = (ctx, ind) => ctx.id === ind.user_id || ctx.isLdAdmin || ctx.isManagement || ind.buddy_user_id === ctx.id || rolesOnInduction(ctx, ind).size > 0;

// ── workflow engine ───────────────────────────────────────────────────────
const TERMINAL = new Set(['PASSED', 'WAIVED', 'CANCELLED']);
const ACTIVE = new Set(['READY', 'IN_PROGRESS', 'OVERDUE', 'SUBMITTED', 'UNDER_REVIEW']);
const OKAY = (s) => s === 'PASSED' || s === 'WAIVED';
const STAGES = ['LEARN', 'OBSERVE', 'PRACTISE', 'PERFORM', 'IMPROVE'];

function buildGate(tpl, anchor) {
  const g = clone(tpl);
  g.status = 'LOCKED';
  g.due_date = addDays(anchor, g.due_offset_days || 0);
  g.available_from = addDays(anchor, g.available_from_offset_days ?? -3650);
  g.tasks = (g.tasks || []).map(x => ({ ...x, done: false, done_at: null, done_by: null, evidence: '' }));
  g.attempts = [];
  g.signoffs = [];
  g.form_data = {};
  g.history = [];
  g.escalation_level = 0;
  g.reminded = {};
  if (g.completion === 'competency') g.competencies = (g.competencies || []).map(c => ({ ...c, stage: 'LEARN', evidence: [], history: [] }));
  return g;
}

function setStatus(gate, status, by, note = '') {
  if (gate.status === status) return;
  gate.history.push({ at: nowIso(), from: gate.status, to: status, by: by || 'system', note });
  gate.status = status;
}

// Unlock gates whose dependencies are satisfied and whose availability date has arrived.
function recompute(ind, today = todayIST()) {
  const byId = Object.fromEntries(ind.gates.map(g => [g.gate_id, g]));
  const unlocked = [];
  for (const g of ind.gates) {
    if (g.status !== 'LOCKED') continue;
    const depsOk = (g.depends_on || []).every(d => !byId[d] || OKAY(byId[d].status) || (byId[d].required === false && byId[d].status === 'CANCELLED'));
    if (depsOk && g.available_from <= today) { setStatus(g, 'READY', 'system', 'dependencies satisfied'); g.unlocked_at = nowIso(); unlocked.push(g); }
  }
  return unlocked;
}

function requiredTasksDone(g) { return g.tasks.filter(t => t.required !== false).every(t => t.done); }
function formComplete(g) { return !g.form || g.form.every(f => clean(g.form_data[f.key]).length > 0); }
function competenciesReady(g) { return (g.competencies || []).every(c => STAGES.indexOf(c.stage) >= STAGES.indexOf('PERFORM')); }

// After any change: move a gate forward when its completion criteria are met.
function evaluateGate(ind, g) {
  if (!ACTIVE.has(g.status) && g.status !== 'FAILED') return null;
  if (['FAILED', 'SUBMITTED', 'UNDER_REVIEW', 'BLOCKED'].includes(g.status)) return null;
  const started = g.tasks.some(t => t.done) || Object.keys(g.form_data || {}).length || (g.competencies || []).some(c => c.stage !== 'LEARN');
  if (started && g.status === 'READY') setStatus(g, 'IN_PROGRESS', 'system');
  const tasksOk = requiredTasksDone(g);
  switch (g.completion) {
    case 'auto':
      if (tasksOk && g.tasks.length) { setStatus(g, 'PASSED', 'system', 'all tasks completed'); g.completed_at = nowIso(); return 'PASSED'; }
      break;
    case 'assessment':
      return null; // result comes from the assessment attempt
    case 'competency':
      if (tasksOk && competenciesReady(g)) { setStatus(g, 'SUBMITTED', 'system', 'competencies demonstrated'); return 'SUBMITTED'; }
      break;
    case 'form':
      if (tasksOk && formComplete(g)) { setStatus(g, 'SUBMITTED', 'system', 'form completed'); return 'SUBMITTED'; }
      break;
    default: // owner_signoff
      if (tasksOk && g.tasks.length) { setStatus(g, 'SUBMITTED', 'system', 'tasks completed'); return 'SUBMITTED'; }
  }
  return null;
}

function allRequiredDone(ind) { return ind.gates.filter(g => g.required !== false).every(g => OKAY(g.status)); }

async function nextCertificateId() {
  const year = new Date(Date.now() + IST_MS).getUTCFullYear();
  const n = (await list('LdCertificate')).filter(c => String(c.certificate_id || '').startsWith(`MV-IND-${year}`)).length + 1;
  return `MV-IND-${year}-${String(n).padStart(4, '0')}`;
}

async function maybeComplete(ind, actorId) {
  if (ind.status === 'COMPLETED' || !allRequiredDone(ind)) return false;
  ind.status = 'COMPLETED';
  ind.completed_at = nowIso();
  const g5 = ind.gates.find(g => g.gate_id === 'G05');
  const cert = await create('LdCertificate', {
    certificate_id: await nextCertificateId(), user_id: ind.user_id, employee_name: ind.employee.name, employee_code: ind.employee.code,
    title: 'New Employee Induction & Training Program', source: 'induction', induction_id: ind.id,
    score: g5?.last_score ?? null, trainer_name: ind.trainer_name || '', issue_date: todayIST(), expiry_date: null, status: 'VALID',
  }, ind.user_id);
  ind.certificate_id = cert.id;
  await audit('LdInduction', ind.id, 'induction_completed', actorId, { certificate: cert.certificate_id }, ind.user_id);
  await notify([ind.user_id, ind.employee.reporting_manager_id, ind.hod_user_id, ind.buddy_user_id].filter(Boolean), {
    title: 'Induction completed 🎉', message: `${ind.employee.name} has completed the New Employee Induction. Certificate ${cert.certificate_id} issued.`, type: 'success', link: ind.user_id ? '/MyLearning' : '/LdControlCentre',
  });
  await notify(await hrUserIds(), { title: 'Induction completed', message: `${ind.employee.name} (${ind.employee.department}) completed the induction.`, link: `/LdInductionDetail?id=${ind.id}` });
  return true;
}

async function hrUserIds() { return (await all("SELECT id FROM users WHERE role IN ('hr','admin') OR custom_role IN ('hr','admin')")).map(r => r.id); }

// After a gate state change: unlock dependants, complete the induction if everything is done.
async function afterChange(ind, actorId) {
  const unlocked = recompute(ind);
  for (const g of unlocked) {
    await notify(ind.user_id, { title: 'New step unlocked', message: `"${g.name}" is ready. Due ${g.due_date}.`, link: '/MyLearning' });
    const ownerIds = await ownersOf(ind, g);
    if (ownerIds.length) await notify(ownerIds, { title: 'Induction step ready', message: `${ind.employee.name}: "${g.name}" is ready for you.`, link: `/LdInductionDetail?id=${ind.id}` });
    if (/Review/.test(g.name)) await notify(ownerIds, { title: 'Development review due', message: `${ind.employee.name}: ${g.name} is due ${g.due_date}.`, type: 'warning', link: `/LdInductionDetail?id=${ind.id}` });
  }
  await maybeComplete(ind, actorId);
  ind.progress = progressOf(ind);
}

async function ownersOf(ind, g) {
  const ids = [];
  for (const r of g.owner_roles || []) {
    if (r === 'manager') ids.push(ind.employee.reporting_manager_id);
    else if (r === 'hod') ids.push(ind.hod_user_id);
    else if (r === 'trainer') ids.push(ind.trainer_user_id);
    else if (r === 'hr') ids.push(ind.hr_spoc_user_id, ...(ind.hr_spoc_user_id ? [] : await hrUserIds()));
    else if (r === 'ld') ids.push(...(await getConfig()).ld_admin_user_ids);
  }
  return [...new Set(ids.filter(Boolean))];
}

function progressOf(ind) {
  const req = ind.gates.filter(g => g.required !== false);
  const done = req.filter(g => OKAY(g.status)).length;
  return { done, total: req.length, percent: req.length ? Math.round((done / req.length) * 100) : 0 };
}

async function runAutoChecks(ind) {
  const pending = ind.gates.filter(g => ACTIVE.has(g.status) || g.status === 'READY').flatMap(g => g.tasks.filter(t => t.auto_check && !t.done).map(t => ({ g, t })));
  if (!pending.length) return false;
  const cache = {};
  const check = async (key) => {
    if (key in cache) return cache[key];
    let v = false;
    if (key === 'buddy_assigned') v = !!ind.buddy_user_id;
    else if (key === 'onboarding_approved') { const e = await getEmployee(ind.user_id); v = !!e && e.status === 'active' && e.onboarding_rejected !== true; }
    else if (key === 'attendance_marked') v = !!(await one("SELECT id FROM entities WHERE type='Attendance' AND user_id=$1 LIMIT 1", [ind.user_id]));
    else if (key === 'helpdesk_ticket') v = !!(await one("SELECT id FROM entities WHERE type='Ticket' AND user_id=$1 LIMIT 1", [ind.user_id]));
    return (cache[key] = v);
  };
  let changed = false;
  for (const { g, t } of pending) {
    if (await check(t.auto_check)) { t.done = true; t.done_at = nowIso(); t.done_by = 'system'; changed = true; evaluateGate(ind, g); }
  }
  return changed;
}

export async function createInduction(userId, { actorId = 'system', buddy_user_id = null, trainer_user_id = null, force = false } = {}) {
  await ensureSeed();
  const existing = (await list('LdInduction')).find(i => i.user_id === userId && i.status !== 'CANCELLED');
  if (existing) { if (!force) return existing; }
  const emp = await getEmployee(userId);
  if (!emp) throw new Error('Employee record not found for this user');
  const tpls = (await list('LdTemplate')).filter(t => t.status === 'active').sort((a, b) => (b.version || 0) - (a.version || 0));
  const tpl = tpls[0];
  if (!tpl) throw new Error('No active induction template');

  const today = todayIST();
  const doj = String(emp.date_of_joining || '').slice(0, 10) || today;
  const anchor = daysBetween(doj, today) <= 3 ? doj : today; // an employee enrolled late is not "overdue" on day one
  const mgrId = emp.reporting_manager_id || null;
  const hod = await deptHead(emp.department);
  const ind = {
    user_id: userId, status: 'IN_PROGRESS', started_at: nowIso(), anchor_date: anchor, doj,
    employee: {
      name: emp.display_name || '', code: emp.employee_code || '', department: emp.department || '', designation: emp.designation || '',
      grade: emp.grade || emp.level || '', location: emp.work_location || '', reporting_manager_id: mgrId, reporting_manager_name: await nameOf(mgrId),
    },
    hod_user_id: hod && hod !== userId ? hod : null, hod_name: hod ? await nameOf(hod) : '',
    hr_spoc_user_id: emp.hr_spoc_user_id || null,
    buddy_user_id, buddy_name: buddy_user_id ? await nameOf(buddy_user_id) : '',
    trainer_user_id, trainer_name: trainer_user_id ? await nameOf(trainer_user_id) : '',
    template_id: tpl.id, template_name: tpl.name, template_version: tpl.version,
    gates: tpl.gates.map(g => buildGate(g, anchor)),
    buddy_checkins: [],
  };
  await runAutoChecks(ind);
  const unlockedPre = recompute(ind);
  for (const g of ind.gates) evaluateGate(ind, g);
  recompute(ind);
  ind.progress = progressOf(ind);
  const doc = await create('LdInduction', ind, userId);
  await audit('LdInduction', doc.id, 'induction_created', actorId, { template: `${tpl.name} v${tpl.version}`, anchor }, userId);
  await notify(userId, { title: 'Welcome to Maxvolt — your induction is ready', message: 'Open My Learning to see what to do next.', type: 'success', link: '/MyLearning' });
  const hrs = await hrUserIds();
  await notify([...hrs, mgrId, ind.hod_user_id], { title: 'New joiner induction started', message: `${ind.employee.name} (${ind.employee.department}) — induction workflow created automatically.`, link: `/LdInductionDetail?id=${doc.id}` });
  void unlockedPre;
  return doc;
}

export async function startForUser(userId) {
  const cfg = await getConfig();
  if (!cfg.auto_start_induction) return null;
  return createInduction(userId, { actorId: 'system' });
}

// ── assessments ───────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').trim().toLowerCase();
function scoreQuestion(q, ans) {
  if (q.type === 'multi') {
    const a = Array.isArray(ans) ? ans.map(Number).sort() : [];
    const c = [...q.correct].map(Number).sort();
    return a.length === c.length && a.every((v, i) => v === c[i]);
  }
  if (q.type === 'short') return (q.accepted || []).some(x => norm(ans).includes(norm(x)));
  const a = Array.isArray(ans) ? Number(ans[0]) : Number(ans);
  return q.correct.map(Number).includes(a);
}
function publicQuestions(a, order) {
  const byId = Object.fromEntries(a.questions.map(q => [q.id, q]));
  return order.map(id => byId[id]).filter(Boolean).map(q => ({ id: q.id, type: q.type, text: q.text, options: q.options, points: q.points || 1, scenario: !!q.scenario }));
}
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── main dispatcher ───────────────────────────────────────────────────────
const ok = (res, body = {}) => res.json({ success: true, ...body });
const fail = (res, error, status = 200) => res.status(status).json({ success: false, error });
const forbid = (res, msg = 'Not allowed') => res.status(403).json({ success: false, error: msg });

function publicInduction(ind, ctx) {
  const d = clone(ind);
  for (const g of d.gates) { g.attempts = (g.attempts || []).map(a => ({ attempt_id: a.attempt_id, at: a.at, score: a.score, passed: a.passed, gaps: a.gaps })); }
  d._can = {};
  for (const g of d.gates) d._can[g.gate_id] = { owner: canOwn(ctx, ind, g), self: ctx.id === ind.user_id };
  d._viewer = { is_employee: ctx.id === ind.user_id, is_buddy: ind.buddy_user_id === ctx.id, is_hr: ctx.isHR, is_ld: ctx.isLdAdmin };
  return d;
}

export async function handleLd(name, p, cu, res) {
  if (!cu) return fail(res, 'Unauthorized', 401);
  await ensureSeed();
  const ctx = await getCtx(cu);
  const fn = HANDLERS[name];
  if (!fn) return fail(res, `Unknown L&D function: ${name}`, 404);
  return fn(p || {}, ctx, res);
}

async function loadInduction(id) { const i = await get('LdInduction', id); return i; }
async function mutate(indId, ctx, res, fn) {
  return withLock('ind:' + indId, async () => {
    const ind = await loadInduction(indId);
    if (!ind) return fail(res, 'Induction not found', 404);
    const out = await fn(ind);
    if (out === false) return; // handler already responded
    await runAutoChecks(ind);
    await afterChange(ind, ctx.id);
    await save('LdInduction', ind);
    return ok(res, { induction: publicInduction(ind, ctx), ...(out || {}) });
  });
}

const HANDLERS = {
  // ── roles / my learning ──
  async ld_getMyRoles(p, ctx, res) {
    const inductions = await list('LdInduction');
    const asManager = inductions.some(i => i.employee.reporting_manager_id === ctx.id && i.status !== 'CANCELLED');
    const asHod = inductions.some(i => i.hod_user_id === ctx.id);
    const asBuddy = inductions.some(i => i.buddy_user_id === ctx.id && i.status !== 'COMPLETED');
    const mine = inductions.find(i => i.user_id === ctx.id && i.status !== 'CANCELLED');
    const reports = (await list('Employee')).some(e => e.reporting_manager_id === ctx.id);
    return ok(res, { is_ld_admin: ctx.isLdAdmin, is_hr: ctx.isHR, is_trainer: ctx.isTrainer, is_manager: asManager || reports, is_hod: asHod || !!(await one("SELECT id FROM entities WHERE type='Department' AND data::jsonb->>'head_user_id'=$1", [ctx.id])), is_buddy: asBuddy, has_induction: !!mine });
  },

  async ld_getMyLearning(p, ctx, res) {
    const inds = (await list('LdInduction')).filter(i => i.status !== 'CANCELLED');
    let mine = inds.find(i => i.user_id === ctx.id);
    if (mine) {
      await withLock('ind:' + mine.id, async () => {
        const fresh = await loadInduction(mine.id);
        if (await runAutoChecks(fresh)) { await afterChange(fresh, 'system'); await save('LdInduction', fresh); }
        mine = fresh;
      });
    }
    const today = todayIST();
    const assignments = (await list('LdAssignment')).filter(a => a.user_id === ctx.id && a.status !== 'CANCELLED');
    const courses = Object.fromEntries((await list('LdCourse')).map(c => [c.id, c]));
    const enriched = assignments.map(a => ({ ...a, course: courses[a.course_id] ? { id: a.course_id, title: courses[a.course_id].title, type: courses[a.course_id].type, duration_min: courses[a.course_id].duration_min, category: courses[a.course_id].category, content_url: courses[a.course_id].content_url, file: courses[a.course_id].file, assessment_id: courses[a.course_id].assessment_id } : null, overdue: a.status !== 'COMPLETED' && a.status !== 'WAIVED' && a.due_date && a.due_date < today }));
    const certs = (await list('LdCertificate')).filter(c => c.user_id === ctx.id).map(c => ({ ...c, status: certStatus(c, ctx.cfg) }));
    const buddyFor = inds.filter(i => i.buddy_user_id === ctx.id && i.status !== 'COMPLETED').map(i => ({ id: i.id, name: i.employee.name, department: i.employee.department, progress: i.progress, doj: i.doj, checkins: (i.buddy_checkins || []).length, last_checkin: (i.buddy_checkins || []).slice(-1)[0]?.at || null }));

    let next = null;
    if (mine) {
      const g = mine.gates.find(x => ['OVERDUE', 'FAILED', 'IN_PROGRESS', 'READY', 'SUBMITTED', 'UNDER_REVIEW'].includes(x.status) && x.status !== 'SUBMITTED' && x.status !== 'UNDER_REVIEW') || mine.gates.find(x => x.status === 'SUBMITTED' || x.status === 'UNDER_REVIEW');
      if (g) {
        const empTasks = g.tasks.filter(t => !t.done && t.actor === 'employee');
        const waiting = g.status === 'SUBMITTED' || g.status === 'UNDER_REVIEW';
        next = {
          gate_id: g.gate_id, gate_name: g.name, status: g.status, due_date: g.due_date, overdue: g.due_date < today && !waiting,
          required_action: g.status === 'FAILED' ? 'Waiting for retraining / reassessment to be approved' : waiting ? 'Waiting for sign-off' : (g.completion === 'assessment' && !empTasks.length ? 'Take the assessment' : empTasks.length ? `${empTasks.length} action(s) for you` : 'Waiting for your trainer / manager'),
          approver: (await ownersOf(mine, g).then(ids => Promise.all(ids.slice(0, 2).map(nameOf)))).filter(Boolean).join(', ') || (g.owner_roles || []).join(' / ').toUpperCase(),
          next_gate: mine.gates.find(x => x.seq > g.seq)?.name || null,
        };
      }
    }
    const reviewsToDo = [];
    for (const i of inds) {
      if (i.employee.reporting_manager_id !== ctx.id && i.hod_user_id !== ctx.id) continue;
      for (const g of i.gates) if (['READY', 'IN_PROGRESS', 'OVERDUE', 'SUBMITTED', 'UNDER_REVIEW'].includes(g.status) && canOwn(ctx, i, g)) reviewsToDo.push({ induction_id: i.id, employee: i.employee.name, gate: g.name, status: g.status, due_date: g.due_date });
    }
    return ok(res, {
      induction: mine ? publicInduction(mine, ctx) : null, next,
      assignments: enriched, certificates: certs, buddy_for: buddyFor, actions_for_me: reviewsToDo,
      stats: {
        mandatory_total: enriched.filter(a => a.mandatory).length,
        mandatory_done: enriched.filter(a => a.mandatory && ['COMPLETED', 'WAIVED'].includes(a.status)).length,
        overdue: enriched.filter(a => a.overdue).length + (mine ? mine.gates.filter(g => g.status === 'OVERDUE').length : 0),
        hours: Math.round(enriched.filter(a => a.status === 'COMPLETED').reduce((s, a) => s + (a.course?.duration_min || 0), 0) / 6) / 10,
      },
    });
  },

  async ld_getInduction(p, ctx, res) {
    let ind = p.id ? await loadInduction(p.id) : (await list('LdInduction')).filter(i => i.user_id === p.user_id && i.status !== 'CANCELLED')[0];
    if (!ind) return fail(res, 'Induction not found', 404);
    if (!canView(ctx, ind)) return forbid(res);
    await withLock('ind:' + ind.id, async () => {
      const fresh = await loadInduction(ind.id);
      if (await runAutoChecks(fresh)) { await afterChange(fresh, 'system'); await save('LdInduction', fresh); }
      ind = fresh;
    });
    const trail = (await list('LdAudit')).filter(a => a.entity_id === ind.id).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200);
    const waivers = (await list('LdWaiver')).filter(w => w.induction_id === ind.id);
    const people = {};
    for (const uid of new Set(trail.map(a => a.actor_id).filter(x => x && x !== 'system'))) people[uid] = await nameOf(uid);
    return ok(res, { induction: publicInduction(ind, ctx), audit: trail.map(a => ({ ...a, actor_name: a.actor_id === 'system' ? 'System' : (people[a.actor_id] || a.actor_id) })), waivers });
  },

  // ── tasks / forms / gate actions ──
  async ld_completeTask(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      const t = g?.tasks.find(x => x.id === p.task_id);
      if (!g || !t) { fail(res, 'Task not found', 404); return false; }
      if (!ACTIVE.has(g.status) && g.status !== 'FAILED') { fail(res, `This step is ${g.status.replace('_', ' ').toLowerCase()} — it cannot be changed right now`); return false; }
      if (g.status === 'FAILED') { fail(res, 'This step failed — retraining must be approved first'); return false; }
      if (t.actor === 'employee') { if (ctx.id !== ind.user_id && !ctx.isHR) { forbid(res, 'Only the employee can complete this item'); return false; } }
      else if (!canOwn(ctx, ind, g)) { forbid(res, 'Only the trainer / manager / HR responsible for this step can complete this item'); return false; }
      if (t.auto_check && !p.undo) { fail(res, 'This item completes automatically when the action is done in Maxvolt One'); return false; }
      if (t.evidence_required && !p.undo && clean(p.evidence).length < 10) { fail(res, 'Please write your answer (at least a sentence) before marking this done'); return false; }
      if (p.undo) {
        if (!(ctx.isHR || ctx.isAdmin)) { forbid(res, 'Only HR can undo a completed item'); return false; }
        t.done = false; t.done_at = null; t.done_by = null;
        if (['SUBMITTED', 'UNDER_REVIEW'].includes(g.status)) setStatus(g, 'IN_PROGRESS', ctx.id, 'item reopened');
      } else {
        t.done = true; t.done_at = nowIso(); t.done_by = ctx.id; if (p.evidence) t.evidence = clean(p.evidence);
      }
      await audit('LdInduction', ind.id, p.undo ? 'task_reopened' : 'task_completed', ctx.id, { gate: g.gate_id, task: t.id, title: t.title }, ind.user_id);
      evaluateGate(ind, g);
      if (g.status === 'SUBMITTED') {
        const owners = await ownersOf(ind, g);
        await notify(owners, { title: 'Sign-off needed', message: `${ind.employee.name}: "${g.name}" is complete and awaiting your sign-off.`, link: `/LdInductionDetail?id=${ind.id}` });
      }
    });
  },

  async ld_saveGateForm(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g || !g.form) { fail(res, 'This step has no form', 404); return false; }
      if (!canOwn(ctx, ind, g)) { forbid(res, 'Only the manager / HOD / trainer responsible for this step can fill this form'); return false; }
      if (!ACTIVE.has(g.status) || ['SUBMITTED', 'UNDER_REVIEW'].includes(g.status) && !ctx.isHR) { fail(res, `This step is ${g.status.replace('_', ' ').toLowerCase()}`); return false; }
      for (const f of g.form) if (p.data && f.key in p.data) g.form_data[f.key] = clean(p.data[f.key]);
      g.form_saved_by = ctx.id; g.form_saved_at = nowIso();
      await audit('LdInduction', ind.id, 'form_saved', ctx.id, { gate: g.gate_id }, ind.user_id);
      evaluateGate(ind, g);
      if (g.status === 'SUBMITTED') await notify(await ownersOf(ind, g), { title: 'Sign-off needed', message: `${ind.employee.name}: "${g.name}" is complete and awaiting sign-off.`, link: `/LdInductionDetail?id=${ind.id}` });
    });
  },

  async ld_advanceCompetency(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      const c = g?.competencies?.find(x => x.id === p.competency_id);
      if (!g || !c) { fail(res, 'Competency not found', 404); return false; }
      if (ctx.id === ind.user_id) { forbid(res, 'You cannot sign off your own practical capability'); return false; }
      if (!canOwn(ctx, ind, g)) { forbid(res, 'Only the trainer / manager can sign off practical capability'); return false; }
      if (!ACTIVE.has(g.status) || g.status === 'SUBMITTED') { fail(res, `This step is ${g.status.replace('_', ' ').toLowerCase()}`); return false; }
      const target = p.stage || STAGES[Math.min(STAGES.length - 1, STAGES.indexOf(c.stage) + 1)];
      if (!STAGES.includes(target)) { fail(res, 'Invalid stage'); return false; }
      c.history.push({ from: c.stage, to: target, by: ctx.id, at: nowIso(), note: clean(p.note, 500) });
      c.stage = target;
      if (p.note) c.evidence.push({ by: ctx.id, at: nowIso(), note: clean(p.note, 800) });
      await audit('LdInduction', ind.id, 'competency_signoff', ctx.id, { gate: g.gate_id, competency: c.name, stage: target }, ind.user_id);
      evaluateGate(ind, g);
    });
  },

  async ld_decideGate(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g) { fail(res, 'Step not found', 404); return false; }
      if (ctx.id === ind.user_id) { forbid(res, 'You cannot approve your own induction'); return false; }
      if (!canOwn(ctx, ind, g)) { forbid(res, 'You are not an approver for this step'); return false; }
      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(g.status)) { fail(res, `This step is ${g.status.replace('_', ' ').toLowerCase()} — it has nothing to approve`); return false; }
      const decision = p.decision === 'fail' ? 'fail' : 'pass';
      const comments = clean(p.comments, 1500);
      if (decision === 'fail' && comments.length < 5) { fail(res, 'Please give a reason / the gap identified'); return false; }
      // which sign-off role is this person filling?
      const need = g.required_signoffs || ['any'];
      const mine = rolesOnInduction(ctx, ind);
      let role = need.includes('any') ? 'any' : need.find(r => mine.has(r) && !g.signoffs.some(s => s.role === r && s.decision === 'pass'));
      if (!role && ctx.isAdmin) role = need.find(r => !g.signoffs.some(s => s.role === r && s.decision === 'pass')) || need[0];
      if (!role) { fail(res, 'Your sign-off is not required (or already recorded) for this step'); return false; }
      g.signoffs = g.signoffs.filter(s => s.role !== role);
      g.signoffs.push({ role, by: ctx.id, by_name: await nameOf(ctx.id), at: nowIso(), decision, comments });
      await audit('LdInduction', ind.id, decision === 'pass' ? 'gate_signed_off' : 'gate_failed', ctx.id, { gate: g.gate_id, role, comments }, ind.user_id);
      if (decision === 'fail') {
        setStatus(g, 'FAILED', ctx.id, comments);
        g.remediation = { stage: 'GAP_IDENTIFIED', gap: comments, at: nowIso(), history: [{ stage: 'GAP_IDENTIFIED', by: ctx.id, at: nowIso(), note: comments }] };
        await notify(ind.user_id, { title: 'Step needs more work', message: `"${g.name}" was not passed: ${comments}`, type: 'warning', link: '/MyLearning' });
      } else {
        const done = need.includes('any') || need.every(r => g.signoffs.some(s => s.role === r && s.decision === 'pass'));
        if (done) { setStatus(g, 'PASSED', ctx.id, 'signed off'); g.completed_at = nowIso(); await notify(ind.user_id, { title: 'Step completed', message: `"${g.name}" has been signed off.`, type: 'success', link: '/MyLearning' }); }
        else { setStatus(g, 'UNDER_REVIEW', ctx.id, 'awaiting remaining sign-off'); const rest = need.filter(r => !g.signoffs.some(s => s.role === r && s.decision === 'pass')); await notify(await ownersOf(ind, g), { title: 'Your sign-off is needed', message: `${ind.employee.name}: "${g.name}" still needs ${rest.join(' & ').toUpperCase()} sign-off.`, link: `/LdInductionDetail?id=${ind.id}` }); }
      }
    });
  },

  // FAILED → GAP IDENTIFIED → REMEDIATION → RETRAINING → REASSESSMENT → PASSED
  async ld_remediate(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g || g.status !== 'FAILED') { fail(res, 'Only a failed step can be remediated'); return false; }
      if (!canOwn(ctx, ind, g) && !ctx.isLdAdmin) { forbid(res); return false; }
      const order = ['GAP_IDENTIFIED', 'REMEDIATION', 'RETRAINING', 'REASSESSMENT'];
      const cur = g.remediation?.stage || 'GAP_IDENTIFIED';
      const next = order[Math.min(order.length - 1, order.indexOf(cur) + 1)];
      g.remediation = g.remediation || { history: [] };
      g.remediation.stage = next; g.remediation.history.push({ stage: next, by: ctx.id, at: nowIso(), note: clean(p.note, 800) });
      if (next === 'REASSESSMENT') {
        // Reopen for a real second attempt. Earlier attempts / sign-offs stay on record (history), but the
        // work must be done again: owner/employee items are reset, assessment attempts start a fresh count.
        g.superseded_signoffs = [...(g.superseded_signoffs || []), ...g.signoffs];
        g.signoffs = [];
        g.attempt_base = (g.attempts || []).length;
        if (g.completion !== 'assessment') g.tasks.forEach(t => { if (!t.auto_check) { t.done = false; t.done_at = null; t.done_by = null; } });
        if (g.competencies) g.competencies.forEach(c => { if (STAGES.indexOf(c.stage) > STAGES.indexOf('PRACTISE')) { c.history.push({ from: c.stage, to: 'PRACTISE', by: ctx.id, at: nowIso(), note: 'retraining' }); c.stage = 'PRACTISE'; } });
        setStatus(g, 'READY', ctx.id, 'reassessment allowed');
        await notify(ind.user_id, { title: 'Retake approved', message: `You can retry "${g.name}" now.`, type: 'info', link: '/MyLearning' });
      }
      await audit('LdInduction', ind.id, 'remediation_' + next.toLowerCase(), ctx.id, { gate: g.gate_id, note: p.note }, ind.user_id);
    });
  },

  async ld_setGateBlocked(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      if (!ctx.isLdAdmin) { forbid(res); return false; }
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g) { fail(res, 'Step not found', 404); return false; }
      if (p.blocked) { if (TERMINAL.has(g.status)) { fail(res, 'Already completed'); return false; } g.status_before_block = g.status; setStatus(g, 'BLOCKED', ctx.id, clean(p.reason, 500)); g.block_reason = clean(p.reason, 500); }
      else if (g.status === 'BLOCKED') { setStatus(g, g.status_before_block || 'READY', ctx.id, 'unblocked'); g.block_reason = ''; }
      await audit('LdInduction', ind.id, p.blocked ? 'gate_blocked' : 'gate_unblocked', ctx.id, { gate: g.gate_id, reason: p.reason }, ind.user_id);
    });
  },

  async ld_changeDueDate(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g || !ctx.isLdAdmin || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.due_date || ''))) { fail(res, 'Not allowed or invalid date'); return false; }
      const old = g.due_date; g.due_date = p.due_date; g.escalation_level = 0; g.reminded = {};
      if (g.status === 'OVERDUE' && g.due_date >= todayIST()) setStatus(g, g.status_before_overdue || 'READY', ctx.id, 'due date extended');
      await audit('LdInduction', ind.id, 'due_date_changed', ctx.id, { gate: g.gate_id, from: old, to: p.due_date, reason: p.reason }, ind.user_id);
    });
  },

  async ld_assignPeople(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      if (!ctx.isLdAdmin && ind.employee.reporting_manager_id !== ctx.id) { forbid(res); return false; }
      const set = {};
      if ('buddy_user_id' in p) {
        if (p.buddy_user_id && (p.buddy_user_id === ind.user_id || p.buddy_user_id === ind.employee.reporting_manager_id)) { fail(res, 'The buddy must be a peer — not the new joiner or the Reporting Manager'); return false; }
        ind.buddy_user_id = p.buddy_user_id || null; ind.buddy_name = await nameOf(ind.buddy_user_id); set.buddy = ind.buddy_name;
        if (ind.buddy_user_id) await notify(ind.buddy_user_id, { title: "You're a buddy", message: `You are ${ind.employee.name}'s buddy. Help them settle in — check in regularly.`, link: '/MyLearning' });
      }
      if ('hod_user_id' in p) { ind.hod_user_id = p.hod_user_id || null; ind.hod_name = await nameOf(ind.hod_user_id); set.hod = ind.hod_name; }
      if ('trainer_user_id' in p) { ind.trainer_user_id = p.trainer_user_id || null; ind.trainer_name = await nameOf(ind.trainer_user_id); set.trainer = ind.trainer_name; }
      if ('hr_spoc_user_id' in p) { ind.hr_spoc_user_id = p.hr_spoc_user_id || null; set.hr_spoc = await nameOf(ind.hr_spoc_user_id); }
      await audit('LdInduction', ind.id, 'people_assigned', ctx.id, set, ind.user_id);
    });
  },

  async ld_buddyCheckin(p, ctx, res) {
    return withLock('ind:' + p.induction_id, async () => {
      const ind = await loadInduction(p.induction_id);
      if (!ind) return fail(res, 'Induction not found', 404);
      if (ind.buddy_user_id !== ctx.id && !ctx.isLdAdmin) return forbid(res, 'Only the assigned buddy can log a check-in');
      ind.buddy_checkins = ind.buddy_checkins || [];
      ind.buddy_checkins.push({ at: nowIso(), by: ctx.id, note: clean(p.note, 800) });
      await save('LdInduction', ind);
      await audit('LdInduction', ind.id, 'buddy_checkin', ctx.id, { note: p.note }, ind.user_id);
      return ok(res, { checkins: ind.buddy_checkins.length });
    });
  },

  async ld_startInduction(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    if (!p.user_id) return fail(res, 'user_id required');
    try { const d = await createInduction(p.user_id, { actorId: ctx.id, buddy_user_id: p.buddy_user_id || null, trainer_user_id: p.trainer_user_id || null }); return ok(res, { induction: publicInduction(d, ctx) }); }
    catch (e) { return fail(res, e.message); }
  },

  async ld_cancelInduction(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      if (!ctx.isLdAdmin) { forbid(res); return false; }
      ind.status = 'CANCELLED'; ind.cancelled_at = nowIso(); ind.cancel_reason = clean(p.reason, 500);
      ind.gates.forEach(g => { if (!TERMINAL.has(g.status)) setStatus(g, 'CANCELLED', ctx.id, 'induction cancelled'); });
      await audit('LdInduction', ind.id, 'induction_cancelled', ctx.id, { reason: p.reason }, ind.user_id);
    });
  },

  // ── waivers ──
  async ld_requestWaiver(p, ctx, res) {
    const ind = await loadInduction(p.induction_id);
    if (!ind) return fail(res, 'Induction not found', 404);
    const g = ind.gates.find(x => x.gate_id === p.gate_id);
    if (!g) return fail(res, 'Step not found', 404);
    if (ctx.id === ind.user_id) return forbid(res, 'You cannot request a waiver for your own induction');
    if (!(ctx.isLdAdmin || ind.employee.reporting_manager_id === ctx.id || ind.hod_user_id === ctx.id)) return forbid(res);
    if (TERMINAL.has(g.status)) return fail(res, 'This step is already completed / waived');
    if (clean(p.reason).length < 10) return fail(res, 'A reason (at least a sentence) is required');
    const w = await create('LdWaiver', { induction_id: ind.id, gate_id: g.gate_id, gate_name: g.name, user_id: ind.user_id, employee_name: ind.employee.name, reason: clean(p.reason, 1500), evidence: clean(p.evidence, 1500), requester_id: ctx.id, requester_name: await nameOf(ctx.id), status: 'PENDING' }, ind.user_id);
    await audit('LdInduction', ind.id, 'waiver_requested', ctx.id, { gate: g.gate_id, reason: p.reason }, ind.user_id);
    await notify([...(await hrUserIds()), ...(await getConfig()).ld_admin_user_ids], { title: 'Waiver request', message: `${w.requester_name} requested a waiver of "${g.name}" for ${ind.employee.name}.`, type: 'warning', link: `/LdInductionDetail?id=${ind.id}` });
    if (p.approve_now && ctx.isLdAdmin) return HANDLERS.ld_decideWaiver({ waiver_id: w.id, decision: 'approve', comments: clean(p.comments || 'Approved at request'), }, ctx, res);
    return ok(res, { waiver: w });
  },

  async ld_decideWaiver(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res, 'Only authorised HR / L&D users can decide a waiver');
    const w = await get('LdWaiver', p.waiver_id);
    if (!w || w.status !== 'PENDING') return fail(res, 'Waiver not found or already decided');
    if (clean(p.comments).length < 3) return fail(res, 'Comments are required');
    return mutate(w.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === w.gate_id);
      w.status = p.decision === 'approve' ? 'APPROVED' : 'REJECTED'; w.approver_id = ctx.id; w.approver_name = await nameOf(ctx.id); w.decided_at = nowIso(); w.comments = clean(p.comments, 1500);
      await save('LdWaiver', w);
      if (w.status === 'APPROVED' && g && !TERMINAL.has(g.status)) { setStatus(g, 'WAIVED', ctx.id, 'waiver ' + w.id); g.waiver_id = w.id; g.completed_at = nowIso(); }
      await audit('LdInduction', ind.id, 'waiver_' + w.status.toLowerCase(), ctx.id, { gate: w.gate_id, comments: w.comments }, ind.user_id);
      await notify([ind.user_id, w.requester_id], { title: `Waiver ${w.status.toLowerCase()}`, message: `"${w.gate_name}" — ${w.comments}`, link: '/MyLearning' });
      return { waiver: w };
    });
  },

  // ── assessments ──
  async ld_startAttempt(p, ctx, res) {
    let ind = null, gate = null, assessment = null, assignment = null;
    if (p.induction_id) {
      ind = await loadInduction(p.induction_id);
      gate = ind?.gates.find(g => g.gate_id === p.gate_id);
      if (!ind || !gate || gate.completion !== 'assessment') return fail(res, 'Assessment step not found', 404);
      if (ind.user_id !== ctx.id) return forbid(res, 'Only the employee can take their own assessment');
      if (!['READY', 'IN_PROGRESS', 'OVERDUE'].includes(gate.status)) return fail(res, `This assessment is ${gate.status.replace('_', ' ').toLowerCase()}`);
      if (!requiredTasksDone(gate)) return fail(res, 'Complete the preparation items first');
      assessment = (await list('LdAssessment')).filter(a => a.key === gate.assessment_key && a.status !== 'archived').sort((a, b) => b.version - a.version)[0];
      const max = gate.max_attempts || assessment?.max_attempts || ctx.cfg.max_attempts;
      if ((gate.attempts || []).length - (gate.attempt_base || 0) >= max) return fail(res, 'Maximum attempts used — ask HR / L&D to approve retraining');
    } else if (p.assignment_id) {
      assignment = await get('LdAssignment', p.assignment_id);
      if (!assignment || assignment.user_id !== ctx.id) return fail(res, 'Assignment not found', 404);
      const course = await get('LdCourse', assignment.course_id);
      assessment = await get('LdAssessment', course?.assessment_id);
      if (!assessment) return fail(res, 'This course has no assessment');
      const used = (await list('LdAttempt')).filter(a => a.user_id === ctx.id && a.assignment_id === assignment.id).length;
      if (used >= (assessment.max_attempts || ctx.cfg.max_attempts)) return fail(res, 'Maximum attempts used');
    } else return fail(res, 'induction_id + gate_id or assignment_id required');
    if (!assessment) return fail(res, 'Assessment not configured', 404);
    const order = (assessment.randomize ? shuffle : (x) => x)(assessment.questions.map(q => q.id));
    const attempt = await create('LdAttempt', { user_id: ctx.id, assessment_id: assessment.id, assessment_version: assessment.version, assessment_title: assessment.title, induction_id: ind?.id || null, gate_id: gate?.gate_id || null, assignment_id: assignment?.id || null, order, started_at: nowIso(), expires_at: assessment.time_limit_min ? new Date(Date.now() + (assessment.time_limit_min + 1) * 60000).toISOString() : null, status: 'IN_PROGRESS' }, ctx.id);
    if (ind) await withLock('ind:' + ind.id, async () => { const f = await loadInduction(ind.id); const g = f.gates.find(x => x.gate_id === gate.gate_id); if (g.status === 'READY') setStatus(g, 'IN_PROGRESS', ctx.id, 'assessment started'); await save('LdInduction', f); });
    return ok(res, { attempt_id: attempt.id, title: assessment.title, time_limit_min: assessment.time_limit_min || null, pass_score: assessment.pass_score, questions: publicQuestions(assessment, order), expires_at: attempt.expires_at });
  },

  async ld_submitAttempt(p, ctx, res) {
    const att = await get('LdAttempt', p.attempt_id);
    if (!att || att.user_id !== ctx.id) return fail(res, 'Attempt not found', 404);
    if (att.status !== 'IN_PROGRESS') return fail(res, 'This attempt was already submitted');
    const assessment = await get('LdAssessment', att.assessment_id);
    if (att.expires_at && Date.now() > Date.parse(att.expires_at)) { att.status = 'EXPIRED'; await save('LdAttempt', att); return fail(res, 'Time limit exceeded — this attempt was not scored'); }
    const answers = p.answers || {};
    let got = 0, total = 0; const gaps = [], detail = [];
    for (const q of assessment.questions) {
      total += q.points || 1;
      const right = scoreQuestion(q, answers[q.id]);
      if (right) got += q.points || 1; else gaps.push(q.text);
      detail.push({ id: q.id, correct: right });
    }
    const score = Math.round((got / total) * 1000) / 10;
    const gateNeed = att.induction_id ? null : null;
    void gateNeed;
    att.answers = answers; att.score = score; att.submitted_at = nowIso(); att.status = 'SUBMITTED'; att.results = detail; att.gaps = gaps;
    if (att.induction_id) {
      return mutate(att.induction_id, ctx, res, async (ind) => {
        const g = ind.gates.find(x => x.gate_id === att.gate_id);
        const need = g.pass_score || assessment.pass_score || ctx.cfg.induction_pass_score;
        att.passed = score >= need; att.pass_score = need;
        await save('LdAttempt', att);
        g.attempts.push({ attempt_id: att.id, at: att.submitted_at, score, passed: att.passed, gaps });
        g.last_score = score;
        await audit('LdInduction', ind.id, att.passed ? 'assessment_passed' : 'assessment_failed', ctx.id, { gate: g.gate_id, score, pass: need }, ind.user_id);
        if (att.passed) {
          setStatus(g, 'PASSED', ctx.id, `assessment ${score}%`); g.completed_at = nowIso();
          await notify([ind.user_id, ind.employee.reporting_manager_id], { title: 'Assessment passed', message: `${ind.employee.name} scored ${score}% on the induction knowledge check.`, type: 'success', link: '/MyLearning' });
        } else {
          setStatus(g, 'FAILED', ctx.id, `assessment ${score}% (pass ${need}%)`);
          g.remediation = { stage: 'GAP_IDENTIFIED', gap: gaps.slice(0, 12).join(' | '), at: nowIso(), history: [{ stage: 'GAP_IDENTIFIED', by: 'system', at: nowIso(), note: `Scored ${score}%` }] };
          await notify([ind.user_id, ...(await ownersOf(ind, g)), ind.employee.reporting_manager_id], { title: 'Assessment not passed', message: `${ind.employee.name} scored ${score}% (pass mark ${need}%). Gaps identified — retraining needed.`, type: 'warning', link: `/LdInductionDetail?id=${ind.id}` });
        }
        return { result: { score, passed: att.passed, pass_score: need, results: detail, gaps, attempt_no: g.attempts.length } };
      });
    }
    // course assessment
    const course = att.assignment_id ? await get('LdCourse', (await get('LdAssignment', att.assignment_id))?.course_id) : null;
    const need = assessment.pass_score || ctx.cfg.induction_pass_score;
    att.passed = score >= need; att.pass_score = need;
    await save('LdAttempt', att);
    if (att.passed && att.assignment_id) await completeAssignment(att.assignment_id, ctx.id, score);
    void course;
    return ok(res, { result: { score, passed: att.passed, pass_score: need, results: detail, gaps } });
  },

  // ── courses / paths / assignments ──
  async ld_listCourses(p, ctx, res) {
    const courses = (await list('LdCourse')).filter(c => ctx.isLdAdmin || c.status === 'active');
    const assignments = await list('LdAssignment');
    return ok(res, { courses: courses.map(c => ({ ...c, enrolled: assignments.filter(a => a.course_id === c.id && a.status !== 'CANCELLED').length, completed: assignments.filter(a => a.course_id === c.id && a.status === 'COMPLETED').length })) });
  },
  async ld_saveCourse(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const c = p.course || {};
    if (!clean(c.title)) return fail(res, 'Title is required');
    const base = { title: clean(c.title, 200), category: clean(c.category, 60) || 'General', type: clean(c.type, 40) || 'document', description: clean(c.description, 2000), content_url: clean(c.content_url, 500), file: c.file || undefined, duration_min: Number(c.duration_min) || 0, mandatory: !!c.mandatory, validity_months: Number(c.validity_months) || 0, issues_certificate: !!c.issues_certificate, assessment_id: c.assessment_id || null, skill_ids: c.skill_ids || [], trainer_user_ids: c.trainer_user_ids || [], status: c.status === 'archived' ? 'archived' : 'active' };
    if (c.id) {
      const cur = await get('LdCourse', c.id); if (!cur) return fail(res, 'Course not found', 404);
      const changedContent = ['content_url', 'file', 'description', 'duration_min'].some(k => String(cur[k] ?? '') !== String(base[k] ?? ''));
      const doc = { ...cur, ...base, version: changedContent ? (cur.version || 1) + 1 : (cur.version || 1) };
      await save('LdCourse', doc); await audit('LdCourse', doc.id, 'course_updated', ctx.id, { version: doc.version });
      return ok(res, { course: doc });
    }
    const doc = await create('LdCourse', { ...base, version: 1, code: 'C-' + uuidv4().slice(0, 6).toUpperCase() });
    await audit('LdCourse', doc.id, 'course_created', ctx.id, { title: doc.title });
    return ok(res, { course: doc });
  },
  async ld_listPaths(p, ctx, res) { return ok(res, { paths: (await list('LdPath')).filter(x => ctx.isLdAdmin || x.status === 'active') }); },
  async ld_savePath(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const x = p.path || {};
    if (!clean(x.name)) return fail(res, 'Name is required');
    const doc = { name: clean(x.name, 200), description: clean(x.description, 1500), items: (x.items || []).map((i, n) => ({ course_id: i.course_id, seq: n + 1, required: i.required !== false })), audience: { all: !!x.audience?.all, departments: x.audience?.departments || [], designations: x.audience?.designations || [] }, mandatory: !!x.mandatory, due_days: Number(x.due_days) || 30, status: x.status === 'archived' ? 'archived' : 'active' };
    if (x.id) { const cur = await get('LdPath', x.id); if (!cur) return fail(res, 'Path not found', 404); const d = { ...cur, ...doc }; await save('LdPath', d); await audit('LdPath', d.id, 'path_updated', ctx.id); return ok(res, { path: d }); }
    const d = await create('LdPath', doc); await audit('LdPath', d.id, 'path_created', ctx.id, { name: d.name }); return ok(res, { path: d });
  },

  async ld_assign(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isManagement) return forbid(res, 'Only HR / L&D can assign training');
    const course = p.course_id ? await get('LdCourse', p.course_id) : null;
    const path = p.path_id ? await get('LdPath', p.path_id) : null;
    if (!course && !path) return fail(res, 'Pick a course or a learning path');
    let users = new Set(p.user_ids || []);
    const emps = await list('Employee');
    const active = emps.filter(e => e.user_id && e.status !== 'inactive');
    if (p.all) active.forEach(e => users.add(e.user_id));
    for (const d of p.departments || []) active.filter(e => String(e.department || '').toLowerCase() === String(d).toLowerCase()).forEach(e => users.add(e.user_id));
    if (!users.size) return fail(res, 'Select at least one employee or department');
    const items = path ? path.items.map(i => i.course_id) : [course.id];
    const due = p.due_date || addDays(todayIST(), Number(p.due_days) || path?.due_days || 30);
    const existing = await list('LdAssignment');
    let created = 0, skipped = 0;
    for (const uid of users) {
      for (const cid of items) {
        if (existing.some(a => a.user_id === uid && a.course_id === cid && !['COMPLETED', 'CANCELLED'].includes(a.status))) { skipped++; continue; }
        const c = await get('LdCourse', cid); if (!c) continue;
        await create('LdAssignment', { user_id: uid, course_id: cid, course_title: c.title, path_id: path?.id || null, assigned_by: ctx.id, assigned_at: nowIso(), due_date: due, mandatory: p.mandatory !== undefined ? !!p.mandatory : (!!c.mandatory || !!path?.mandatory), source: 'manual', status: 'ASSIGNED', progress: 0, course_version: c.version || 1 }, uid);
        created++;
      }
      await notify(uid, { title: 'Training assigned', message: `${path ? `Path "${path.name}"` : `"${course.title}"`} — due ${due}.`, link: '/MyLearning' });
    }
    await audit(path ? 'LdPath' : 'LdCourse', (path || course).id, 'assigned', ctx.id, { users: users.size, created, skipped, due });
    return ok(res, { created, skipped });
  },

  async ld_updateProgress(p, ctx, res) {
    const a = await get('LdAssignment', p.assignment_id);
    if (!a) return fail(res, 'Assignment not found', 404);
    const isOwner = a.user_id === ctx.id;
    if (!isOwner && !ctx.isLdAdmin && !ctx.isTrainer) return forbid(res);
    const course = await get('LdCourse', a.course_id);
    if (p.action === 'start' && isOwner) { if (a.status === 'ASSIGNED') { a.status = 'IN_PROGRESS'; a.started_at = nowIso(); await save('LdAssignment', a); } return ok(res, { assignment: a }); }
    if (p.action === 'complete') {
      if (course?.assessment_id) return fail(res, 'This course is completed by passing its assessment');
      const live = ['live_classroom', 'webinar', 'workshop', 'shadowing', 'on_the_job', 'practical_task'].includes(course?.type);
      if (live && isOwner && !ctx.isLdAdmin && !ctx.isTrainer) return fail(res, 'A trainer / manager marks this one complete after you attend');
      await completeAssignment(a.id, ctx.id, p.score ?? null);
      return ok(res, { assignment: await get('LdAssignment', a.id) });
    }
    if (p.action === 'waive' && ctx.isLdAdmin) { a.status = 'WAIVED'; a.waived_by = ctx.id; a.waive_reason = clean(p.reason, 500); await save('LdAssignment', a); await audit('LdAssignment', a.id, 'assignment_waived', ctx.id, { reason: p.reason }, a.user_id); return ok(res, { assignment: a }); }
    return fail(res, 'Unknown action');
  },

  async ld_listAssignments(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const today = todayIST();
    const users = Object.fromEntries((await list('Employee')).map(e => [e.user_id, e]));
    const rows = (await list('LdAssignment')).filter(a => a.status !== 'CANCELLED').filter(a => !p.course_id || a.course_id === p.course_id).map(a => ({ ...a, employee_name: users[a.user_id]?.display_name || '', employee_code: users[a.user_id]?.employee_code || '', department: users[a.user_id]?.department || '', overdue: !['COMPLETED', 'WAIVED'].includes(a.status) && a.due_date && a.due_date < today }));
    return ok(res, { assignments: rows.slice(0, 2000) });
  },

  async ld_markComplete(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isTrainer) return forbid(res, 'Only a trainer / L&D can mark attendance');
    let n = 0;
    for (const id of p.assignment_ids || []) { const a = await get('LdAssignment', id); if (a && a.status !== 'COMPLETED') { await completeAssignment(id, ctx.id, p.score ?? null); n++; } }
    return ok(res, { completed: n });
  },

  // ── assessments admin ──
  async ld_listAssessments(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isTrainer) return forbid(res);
    return ok(res, { assessments: await list('LdAssessment') });
  },
  async ld_saveAssessment(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const a = p.assessment || {};
    if (!clean(a.title) || !Array.isArray(a.questions) || !a.questions.length) return fail(res, 'Title and at least one question are required');
    const qs = a.questions.map((q, i) => ({ id: q.id || `Q${i + 1}`, type: ['mcq', 'multi', 'truefalse', 'short'].includes(q.type) ? q.type : 'mcq', text: clean(q.text, 800), options: (q.options || []).map(o => clean(o, 300)), correct: (q.correct || []).map(Number), accepted: (q.accepted || []).map(x => clean(x, 200)), points: Number(q.points) || 1, scenario: !!q.scenario }));
    for (const q of qs) { if (!q.text) return fail(res, 'Every question needs text'); if (q.type !== 'short' && (q.options.length < 2 || !q.correct.length)) return fail(res, `Question "${q.text.slice(0, 40)}" needs options and a correct answer`); }
    const base = { title: clean(a.title, 200), description: clean(a.description, 1000), pass_score: Number(a.pass_score) || 80, max_attempts: Number(a.max_attempts) || 3, time_limit_min: Number(a.time_limit_min) || 0, randomize: a.randomize !== false, status: a.status === 'archived' ? 'archived' : 'active', questions: qs };
    if (a.id) {
      const cur = await get('LdAssessment', a.id); if (!cur) return fail(res, 'Assessment not found', 404);
      // keep history intact: editing questions creates a new version (old attempts reference the old content)
      const changed = JSON.stringify(cur.questions) !== JSON.stringify(qs);
      if (changed) { cur.status = 'archived'; await save('LdAssessment', cur); const nd = await create('LdAssessment', { ...base, key: cur.key || ('A-' + uuidv4().slice(0, 6)), version: (cur.version || 1) + 1 }); await audit('LdAssessment', nd.id, 'assessment_new_version', ctx.id, { version: nd.version }); return ok(res, { assessment: nd }); }
      const d = { ...cur, ...base }; await save('LdAssessment', d); return ok(res, { assessment: d });
    }
    const d = await create('LdAssessment', { ...base, key: 'A-' + uuidv4().slice(0, 6), version: 1 }); await audit('LdAssessment', d.id, 'assessment_created', ctx.id); return ok(res, { assessment: d });
  },

  // ── certificates ──
  async ld_listCertificates(p, ctx, res) {
    const mine = !ctx.isLdAdmin;
    const emps = Object.fromEntries((await list('Employee')).map(e => [e.user_id, e]));
    const rows = (await list('LdCertificate')).filter(c => !mine || c.user_id === ctx.id).map(c => ({ ...c, status: certStatus(c, ctx.cfg), employee_name: c.employee_name || emps[c.user_id]?.display_name || '', department: emps[c.user_id]?.department || '' }));
    return ok(res, { certificates: rows.sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date))) });
  },
  async ld_issueCertificate(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isTrainer) return forbid(res);
    const e = await getEmployee(p.user_id);
    if (!e || !clean(p.title)) return fail(res, 'Employee and title are required');
    const year = new Date().getUTCFullYear();
    const n = (await list('LdCertificate')).length + 1;
    const c = await create('LdCertificate', { certificate_id: `MV-${p.external ? 'EXT' : 'CRT'}-${year}-${String(n).padStart(4, '0')}`, user_id: p.user_id, employee_name: e.display_name, employee_code: e.employee_code, title: clean(p.title, 200), source: p.external ? 'external' : 'course', issuer: clean(p.issuer, 120), score: p.score ?? null, trainer_name: clean(p.trainer_name, 100), issue_date: p.issue_date || todayIST(), expiry_date: p.expiry_date || null, status: 'VALID', issued_by: ctx.id }, p.user_id);
    await audit('LdCertificate', c.id, 'certificate_issued', ctx.id, { to: e.display_name, title: c.title }, p.user_id);
    await notify(p.user_id, { title: 'Certificate issued', message: `${c.title} — ${c.certificate_id}`, type: 'success', link: '/MyLearning' });
    return ok(res, { certificate: c });
  },
  async ld_revokeCertificate(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const c = await get('LdCertificate', p.id); if (!c) return fail(res, 'Not found', 404);
    c.status = 'REVOKED'; c.revoked_reason = clean(p.reason, 500); c.revoked_by = ctx.id; await save('LdCertificate', c);
    await audit('LdCertificate', c.id, 'certificate_revoked', ctx.id, { reason: p.reason }, c.user_id);
    return ok(res, { certificate: c });
  },

  // ── trainers ──
  async ld_listTrainers(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isTrainer && !ctx.isManagement) return forbid(res);
    const trainers = await list('LdTrainer');
    const inds = await list('LdInduction');
    const fb = await list('LdFeedback');
    const out = [];
    for (const t of trainers) {
      const mine = inds.filter(i => i.trainer_user_id === t.user_id);
      const ratings = fb.filter(f => f.trainer_user_id === t.user_id && f.rating).map(f => f.rating);
      out.push({ ...t, name: t.name || await nameOf(t.user_id), inductions: mine.length, signoffs: mine.reduce((s, i) => s + i.gates.reduce((x, g) => x + g.signoffs.filter(so => so.by === t.user_id).length, 0), 0), avg_rating: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 10) / 10 : null, feedback_count: ratings.length });
    }
    return ok(res, { trainers: out });
  },
  async ld_saveTrainer(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    if (!p.user_id) return fail(res, 'user_id required');
    const cur = (await list('LdTrainer')).find(t => t.user_id === p.user_id);
    const doc = { ...(cur || {}), user_id: p.user_id, name: await nameOf(p.user_id), expertise: (p.expertise || []).map(x => clean(x, 60)).filter(Boolean), active: p.active !== false, bio: clean(p.bio, 500) };
    if (cur) await save('LdTrainer', doc); else await create('LdTrainer', doc, p.user_id);
    await audit('LdTrainer', doc.id || p.user_id, 'trainer_saved', ctx.id, { name: doc.name });
    return ok(res, { trainer: doc });
  },

  // ── skills ──
  async ld_listSkills(p, ctx, res) { return ok(res, { skills: await list('LdSkill'), levels: ['', 'Awareness', 'Basic', 'Working', 'Advanced', 'Expert'] }); },
  async ld_saveSkill(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const s = p.skill || {}; if (!clean(s.name)) return fail(res, 'Name is required');
    const doc = { name: clean(s.name, 100), category: clean(s.category, 60) || 'General', description: clean(s.description, 500) };
    if (s.id) { const cur = await get('LdSkill', s.id); if (!cur) return fail(res, 'Not found', 404); const d = { ...cur, ...doc }; await save('LdSkill', d); return ok(res, { skill: d }); }
    return ok(res, { skill: await create('LdSkill', doc) });
  },
  async ld_rateSkill(p, ctx, res) {
    const e = await getEmployee(p.user_id);
    if (!e) return fail(res, 'Employee not found', 404);
    const sk = await get('LdSkill', p.skill_id); if (!sk) return fail(res, 'Skill not found', 404);
    if (!(ctx.isLdAdmin || ctx.isTrainer || e.reporting_manager_id === ctx.id)) return forbid(res, 'Only the manager, a trainer or L&D can rate skills');
    const cur = Number(p.current), req = Number(p.required);
    if (![cur, req].every(n => n >= 1 && n <= 5)) return fail(res, 'Proficiency must be 1–5');
    const existing = (await list('LdEmpSkill')).find(x => x.user_id === p.user_id && x.skill_id === p.skill_id);
    const doc = { ...(existing || {}), user_id: p.user_id, employee_name: e.display_name, department: e.department, skill_id: sk.id, skill_name: sk.name, current: cur, required: req, evidence: clean(p.evidence, 800), last_assessed: todayIST(), next_assessment: p.next_assessment || addDays(todayIST(), 180), assessed_by: ctx.id, history: [...(existing?.history || []), { at: nowIso(), by: ctx.id, current: cur, required: req }].slice(-30) };
    if (existing) await save('LdEmpSkill', doc); else await create('LdEmpSkill', doc, p.user_id);
    await audit('LdEmpSkill', doc.id || `${p.user_id}:${sk.id}`, 'skill_rated', ctx.id, { skill: sk.name, current: cur, required: req }, p.user_id);
    return ok(res, { skill: doc });
  },
  async ld_getSkillGaps(p, ctx, res) {
    const emps = Object.fromEntries((await list('Employee')).map(e => [e.user_id, e]));
    let rows = await list('LdEmpSkill');
    if (!ctx.isLdAdmin) rows = rows.filter(r => r.user_id === ctx.id || emps[r.user_id]?.reporting_manager_id === ctx.id);
    const courses = (await list('LdCourse')).filter(c => c.status === 'active');
    const out = rows.map(r => ({ ...r, gap: Math.max(0, r.required - r.current), due: r.next_assessment && r.next_assessment < todayIST(), recommended: r.required > r.current ? courses.filter(c => (c.skill_ids || []).includes(r.skill_id)).map(c => ({ id: c.id, title: c.title })) : [] }));
    return ok(res, { skills: out });
  },

  // ── feedback ──
  async ld_submitFeedback(p, ctx, res) {
    const rating = Number(p.rating); if (!(rating >= 1 && rating <= 5)) return fail(res, 'Rating must be 1–5');
    let trainer = null, title = '';
    if (p.induction_id) { const ind = await loadInduction(p.induction_id); if (!ind || ind.user_id !== ctx.id) return forbid(res); trainer = ind.trainer_user_id; title = 'New Employee Induction'; }
    if (p.assignment_id) { const a = await get('LdAssignment', p.assignment_id); if (!a || a.user_id !== ctx.id) return forbid(res); title = a.course_title; const c = await get('LdCourse', a.course_id); trainer = (c?.trainer_user_ids || [])[0] || null; }
    const f = await create('LdFeedback', { user_id: ctx.id, induction_id: p.induction_id || null, assignment_id: p.assignment_id || null, title, trainer_user_id: trainer, rating, comments: clean(p.comments, 1200), at: nowIso() }, ctx.id);
    await audit('LdFeedback', f.id, 'feedback_submitted', ctx.id, { rating }, ctx.id);
    return ok(res, { feedback: f });
  },

  // ── dashboards / lists ──
  async ld_listInductions(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isManagement) return forbid(res);
    const today = todayIST();
    let rows = (await list('LdInduction')).filter(i => i.status !== 'CANCELLED' || p.include_cancelled);
    if (p.department) rows = rows.filter(i => i.employee.department === p.department);
    const out = rows.map(i => summarise(i, today));
    return ok(res, { inductions: out.sort((a, b) => String(b.doj).localeCompare(String(a.doj))) });
  },

  async ld_getDashboard(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isManagement) return forbid(res);
    const today = todayIST();
    const inds = (await list('LdInduction')).filter(i => i.status !== 'CANCELLED');
    const sums = inds.map(i => summarise(i, today));
    const emps = await list('Employee');
    const eligible = emps.filter(e => e.user_id && e.status === 'active' && e.date_of_joining && daysBetween(String(e.date_of_joining).slice(0, 10), today) <= 120 && daysBetween(String(e.date_of_joining).slice(0, 10), today) >= -14);
    const withInd = new Set(inds.map(i => i.user_id));
    const gateStats = {};
    for (const i of inds) for (const g of i.gates) {
      const s = (gateStats[g.gate_id] ||= { gate_id: g.gate_id, name: g.name, seq: g.seq, total: 0, passed: 0, overdue: 0, failed: 0, days: [] });
      s.total++; if (OKAY(g.status)) s.passed++; if (g.status === 'OVERDUE') s.overdue++; if (g.status === 'FAILED') s.failed++;
      if (OKAY(g.status) && g.unlocked_at && g.completed_at) s.days.push((Date.parse(g.completed_at) - Date.parse(g.unlocked_at)) / 86400000);
    }
    const attempts = inds.flatMap(i => i.gates.flatMap(g => g.attempts || []));
    const completed = inds.filter(i => i.status === 'COMPLETED' && i.completed_at);
    const pendingApprovals = sums.reduce((s, x) => s + x.pending_signoffs, 0);
    const assignments = (await list('LdAssignment')).filter(a => a.status !== 'CANCELLED');
    const dept = {};
    for (const a of assignments.filter(a => a.mandatory)) {
      const d = (emps.find(e => e.user_id === a.user_id)?.department) || 'Unassigned';
      const s = (dept[d] ||= { department: d, total: 0, done: 0, overdue: 0 });
      s.total++; if (['COMPLETED', 'WAIVED'].includes(a.status)) s.done++; else if (a.due_date && a.due_date < today) s.overdue++;
    }
    const reviews = inds.flatMap(i => i.gates.filter(g => /Review/.test(g.name)));
    return ok(res, {
      kpis: {
        total: sums.length, not_started: sums.filter(s => s.status_label === 'Not started').length, in_progress: sums.filter(s => s.status_label === 'In progress').length,
        completed: sums.filter(s => s.status_label === 'Completed').length, overdue: sums.filter(s => s.overdue_gates > 0).length, blocked: sums.filter(s => s.blocked_gates > 0).length,
        assessment_failures: sums.reduce((s, x) => s + x.failed_gates, 0), pending_approvals: pendingApprovals,
        avg_completion_days: completed.length ? Math.round(completed.reduce((s, i) => s + (Date.parse(i.completed_at) - Date.parse(i.started_at)) / 86400000, 0) / completed.length * 10) / 10 : null,
        assessment_pass_rate: attempts.length ? Math.round(attempts.filter(a => a.passed).length / attempts.length * 100) : null,
        practical_signoff_rate: pct(inds.filter(i => OKAY(i.gates.find(g => g.gate_id === 'G08')?.status)).length, inds.length),
        review_completion: pct(reviews.filter(g => OKAY(g.status)).length, reviews.filter(g => g.due_date <= today || OKAY(g.status)).length),
        missing_inductions: eligible.filter(e => !withInd.has(e.user_id)).length,
      },
      gates: Object.values(gateStats).sort((a, b) => a.seq - b.seq).map(s => ({ ...s, days: undefined, completion_pct: pct(s.passed, s.total), avg_days: s.days.length ? Math.round(s.days.reduce((a, b) => a + b, 0) / s.days.length * 10) / 10 : null })),
      departments: Object.values(dept).map(d => ({ ...d, compliance_pct: pct(d.done, d.total) })).sort((a, b) => a.compliance_pct - b.compliance_pct),
      missing: eligible.filter(e => !withInd.has(e.user_id)).map(e => ({ user_id: e.user_id, name: e.display_name, code: e.employee_code, department: e.department, doj: String(e.date_of_joining).slice(0, 10) })),
      inductions: sums.sort((a, b) => String(b.doj).localeCompare(String(a.doj))).slice(0, 300),
    });
  },

  async ld_getTeamLearning(p, ctx, res) {
    const today = todayIST();
    const emps = await list('Employee');
    const myDepts = (await list('Department')).filter(d => d.head_user_id === ctx.id).map(d => d.name);
    const team = emps.filter(e => e.user_id && e.status !== 'inactive' && (e.reporting_manager_id === ctx.id || myDepts.includes(e.department) || (ctx.isLdAdmin && p.all)));
    const ids = new Set(team.map(e => e.user_id));
    const inds = (await list('LdInduction')).filter(i => ids.has(i.user_id) && i.status !== 'CANCELLED').map(i => ({ ...summarise(i, today), pending_for_me: i.gates.filter(g => ['SUBMITTED', 'UNDER_REVIEW', 'READY', 'IN_PROGRESS', 'OVERDUE'].includes(g.status) && canOwn(ctx, i, g)).map(g => ({ gate_id: g.gate_id, name: g.name, status: g.status, due_date: g.due_date })) }));
    const assignments = (await list('LdAssignment')).filter(a => ids.has(a.user_id) && a.status !== 'CANCELLED').map(a => ({ ...a, employee_name: team.find(e => e.user_id === a.user_id)?.display_name, overdue: !['COMPLETED', 'WAIVED'].includes(a.status) && a.due_date < today }));
    const gaps = (await list('LdEmpSkill')).filter(s => ids.has(s.user_id) && s.required > s.current);
    const isHod = myDepts.length > 0;
    return ok(res, { is_hod: isHod, departments: myDepts, team: team.map(e => ({ user_id: e.user_id, name: e.display_name, code: e.employee_code, department: e.department, designation: e.designation, mandatory_total: assignments.filter(a => a.user_id === e.user_id && a.mandatory).length, mandatory_done: assignments.filter(a => a.user_id === e.user_id && a.mandatory && ['COMPLETED', 'WAIVED'].includes(a.status)).length, overdue: assignments.filter(a => a.user_id === e.user_id && a.overdue).length })), inductions: inds, assignments: assignments.filter(a => a.overdue || a.status !== 'COMPLETED').slice(0, 300), skill_gaps: gaps });
  },

  // ── config / template ──
  async ld_getConfig(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const tpls = (await list('LdTemplate')).sort((a, b) => (b.version || 0) - (a.version || 0));
    const admins = []; for (const id of ctx.cfg.ld_admin_user_ids) admins.push({ user_id: id, name: await nameOf(id) });
    return ok(res, { config: ctx.cfg, ld_admins: admins, templates: tpls.map(t => ({ id: t.id, name: t.name, version: t.version, status: t.status, gates: t.gates.length })), active_template: tpls.find(t => t.status === 'active') || null });
  },
  async ld_saveConfig(p, ctx, res) {
    if (!ctx.isAdmin && !ctx.isHR) return forbid(res);
    const c = p.config || {};
    const cur = await get('LdConfig', 'ld-config');
    const doc = { ...(cur || { id: 'ld-config' }), induction_pass_score: Number(c.induction_pass_score) || 80, max_attempts: Number(c.max_attempts) || 3, due_soon_days: Number(c.due_soon_days) || 2, expiring_cert_days: Number(c.expiring_cert_days) || 30, auto_start_induction: c.auto_start_induction !== false, escalation_days: { ...DEFAULT_CONFIG.escalation_days, ...(c.escalation_days || {}) }, ld_admin_user_ids: Array.isArray(c.ld_admin_user_ids) ? c.ld_admin_user_ids : (cur?.ld_admin_user_ids || []) };
    if (cur) await save('LdConfig', doc); else await create('LdConfig', doc);
    await audit('LdConfig', 'ld-config', 'config_changed', ctx.id, { escalation_days: doc.escalation_days, pass: doc.induction_pass_score });
    return ok(res, { config: await getConfig() });
  },
  // A template edit never changes people already enrolled — it creates the next version.
  async ld_saveTemplate(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const t = p.template;
    if (!t || !Array.isArray(t.gates) || !t.gates.length) return fail(res, 'Template with gates required');
    const cur = (await list('LdTemplate')).filter(x => x.name === (t.name || 'New Employee Induction')).sort((a, b) => b.version - a.version)[0];
    if (cur) { cur.status = 'superseded'; await save('LdTemplate', cur); }
    const doc = await create('LdTemplate', { ...clone(t), name: t.name || 'New Employee Induction', version: (cur?.version || 0) + 1, status: 'active', previous_version: cur?.version || null, changed_by: ctx.id });
    await audit('LdTemplate', doc.id, 'template_new_version', ctx.id, { version: doc.version });
    return ok(res, { template: doc });
  },
  async ld_getTemplate(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    return ok(res, { template: (await list('LdTemplate')).filter(t => t.status === 'active').sort((a, b) => b.version - a.version)[0] || null });
  },

  // ── reports ──
  async ld_getReport(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isManagement) return forbid(res);
    return ok(res, await buildReport(p.report, p.filters || {}));
  },
  async ld_exportReport(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isManagement) return forbid(res);
    const rep = await buildReport(p.report, p.filters || {});
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(rep.title.slice(0, 28));
    ws.addRow([`Maxvolt Energy — ${rep.title}`]); ws.mergeCells(1, 1, 1, Math.max(rep.columns.length, 2));
    Object.assign(ws.getCell(1, 1), { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3C5E' } } });
    ws.addRow([`Generated ${todayIST()} (IST)`]);
    ws.addRow([]);
    const h = ws.addRow(rep.columns.map(c => c.label));
    h.eachCell(c => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5986' } }, alignment: { horizontal: 'center', wrapText: true } }));
    for (const r of rep.rows) ws.addRow(rep.columns.map(c => r[c.key] ?? ''));
    rep.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 18; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    const buf = await wb.xlsx.writeBuffer();
    return ok(res, { base64: Buffer.from(buf).toString('base64'), filename: `LD_${rep.title.replace(/\W+/g, '_')}_${todayIST()}.xlsx` });
  },

  async ld_getAudit(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    let rows = await list('LdAudit');
    if (p.entity_id) rows = rows.filter(a => a.entity_id === p.entity_id);
    if (p.action) rows = rows.filter(a => a.action === p.action);
    rows = rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, Number(p.limit) || 300);
    const names = {}; for (const id of new Set(rows.map(r => r.actor_id).filter(x => x && x !== 'system'))) names[id] = await nameOf(id);
    return ok(res, { audit: rows.map(r => ({ ...r, actor_name: r.actor_id === 'system' ? 'System' : names[r.actor_id] || r.actor_id })) });
  },

  async ld_runDailyTick(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const { ldDailyTick } = await import('../cron/ldAutomation.js');
    return ok(res, { result: await ldDailyTick() });
  },
};

// ── helpers used by handlers / reports / cron ─────────────────────────────
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function certStatus(c, cfg) {
  if (c.status === 'REVOKED') return 'REVOKED';
  if (!c.expiry_date) return 'VALID';
  const today = todayIST();
  if (c.expiry_date < today) return 'EXPIRED';
  if (daysBetween(today, c.expiry_date) <= (cfg?.expiring_cert_days || 30)) return 'EXPIRING';
  return 'VALID';
}

async function completeAssignment(id, actorId, score = null) {
  const a = await get('LdAssignment', id);
  if (!a || a.status === 'COMPLETED') return;
  a.status = 'COMPLETED'; a.progress = 100; a.completed_at = nowIso(); a.score = score; a.completed_by = actorId;
  await save('LdAssignment', a);
  await audit('LdAssignment', a.id, 'assignment_completed', actorId, { course: a.course_title, score }, a.user_id);
  const c = await get('LdCourse', a.course_id);
  if (c?.issues_certificate || c?.validity_months) {
    const e = await getEmployee(a.user_id);
    const n = (await list('LdCertificate')).length + 1;
    await create('LdCertificate', { certificate_id: `MV-CRT-${new Date().getUTCFullYear()}-${String(n).padStart(4, '0')}`, user_id: a.user_id, employee_name: e?.display_name || '', employee_code: e?.employee_code || '', title: c.title, source: 'course', course_id: c.id, score, issue_date: todayIST(), expiry_date: c.validity_months ? addMonths(todayIST(), c.validity_months) : null, status: 'VALID' }, a.user_id);
  }
  await notify(a.user_id, { title: 'Training completed', message: `"${a.course_title}" is marked complete.`, type: 'success', link: '/MyLearning' });
}
function addMonths(d, m) { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); }

function summarise(i, today) {
  const cur = i.gates.find(g => ['OVERDUE', 'FAILED', 'IN_PROGRESS', 'READY', 'SUBMITTED', 'UNDER_REVIEW', 'BLOCKED'].includes(g.status));
  const overdue = i.gates.filter(g => g.status === 'OVERDUE').length;
  const started = i.gates.some(g => g.status !== 'LOCKED' && g.status !== 'READY') || i.gates.some(g => g.tasks.some(t => t.done && t.done_by !== 'system'));
  const label = i.status === 'COMPLETED' ? 'Completed' : !started ? 'Not started' : 'In progress';
  return {
    id: i.id, user_id: i.user_id, name: i.employee.name, code: i.employee.code, department: i.employee.department, designation: i.employee.designation,
    manager: i.employee.reporting_manager_name, buddy: i.buddy_name, hod: i.hod_name, trainer: i.trainer_name, doj: i.doj, status: i.status, status_label: label,
    progress: i.progress || progressOf(i), current_gate: cur ? `${cur.gate_id} · ${cur.name}` : (i.status === 'COMPLETED' ? 'Completed' : '—'), current_status: cur?.status || '',
    due_date: cur?.due_date || '', overdue_gates: overdue, failed_gates: i.gates.filter(g => g.status === 'FAILED').length, blocked_gates: i.gates.filter(g => g.status === 'BLOCKED').length,
    pending_signoffs: i.gates.filter(g => ['SUBMITTED', 'UNDER_REVIEW'].includes(g.status)).length, template: `${i.template_name} v${i.template_version}`, completed_at: i.completed_at || null,
    days_in: Math.max(0, daysBetween(i.doj, today)),
  };
}

async function buildReport(key, f) {
  const today = todayIST();
  const emps = await list('Employee');
  const empBy = Object.fromEntries(emps.map(e => [e.user_id, e]));
  const inds = (await list('LdInduction')).filter(i => i.status !== 'CANCELLED');
  const dept = (r) => !f.department || r.department === f.department;
  const col = (key, label, width) => ({ key, label, width });
  switch (key) {
    case 'new_joiner_induction': {
      const rows = inds.map(i => summarise(i, today)).filter(dept).map(s => ({ code: s.code, name: s.name, department: s.department, designation: s.designation, doj: s.doj, manager: s.manager, buddy: s.buddy, status: s.status_label, progress: `${s.progress.done}/${s.progress.total} (${s.progress.percent}%)`, current_gate: s.current_gate, due: s.due_date, overdue_steps: s.overdue_gates, certificate: s.completed_at ? 'Issued' : '' }));
      return { title: 'New Joiner Induction Report', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('designation', 'Designation', 22), col('doj', 'Joined', 12), col('manager', 'Manager', 22), col('buddy', 'Buddy', 20), col('status', 'Status', 14), col('progress', 'Progress', 16), col('current_gate', 'Current step', 36), col('due', 'Due', 12), col('overdue_steps', 'Overdue steps', 12), col('certificate', 'Certificate', 12)], rows };
    }
    case 'new_joiner_completion': {
      const rows = inds.filter(i => i.status === 'COMPLETED').map(i => ({ code: i.employee.code, name: i.employee.name, department: i.employee.department, doj: i.doj, completed: String(i.completed_at).slice(0, 10), days: daysBetween(i.doj, String(i.completed_at).slice(0, 10)), certificate: i.certificate_id ? 'Issued' : '' })).filter(dept);
      return { title: 'New Joiner Completion', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('doj', 'Joined', 12), col('completed', 'Completed on', 14), col('days', 'Days taken', 12), col('certificate', 'Certificate', 12)], rows };
    }
    case 'mandatory_compliance': {
      const as = (await list('LdAssignment')).filter(a => a.mandatory && a.status !== 'CANCELLED');
      const by = {};
      for (const a of as) { const e = empBy[a.user_id]; const k = e?.department || 'Unassigned'; const s = (by[k] ||= { department: k, assigned: 0, completed: 0, overdue: 0 }); s.assigned++; if (['COMPLETED', 'WAIVED'].includes(a.status)) s.completed++; else if (a.due_date < today) s.overdue++; }
      const rows = Object.values(by).filter(dept).map(s => ({ ...s, pending: s.assigned - s.completed, compliance: pct(s.completed, s.assigned) + '%' }));
      return { title: 'Mandatory Training Compliance', columns: [col('department', 'Department', 24), col('assigned', 'Assigned', 12), col('completed', 'Completed', 12), col('pending', 'Pending', 12), col('overdue', 'Overdue', 12), col('compliance', 'Compliance', 14)], rows };
    }
    case 'overdue_training': {
      const rows = [];
      for (const a of (await list('LdAssignment')).filter(a => !['COMPLETED', 'WAIVED', 'CANCELLED'].includes(a.status) && a.due_date && a.due_date < today)) { const e = empBy[a.user_id]; rows.push({ code: e?.employee_code, name: e?.display_name, department: e?.department || '', item: a.course_title, kind: a.mandatory ? 'Mandatory' : 'Assigned', due: a.due_date, days_overdue: daysBetween(a.due_date, today) }); }
      for (const i of inds) for (const g of i.gates.filter(g => g.status === 'OVERDUE')) rows.push({ code: i.employee.code, name: i.employee.name, department: i.employee.department, item: `Induction — ${g.name}`, kind: 'Induction', due: g.due_date, days_overdue: daysBetween(g.due_date, today) });
      return { title: 'Overdue Training', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('item', 'Training', 40), col('kind', 'Type', 12), col('due', 'Due', 12), col('days_overdue', 'Days overdue', 12)], rows: rows.filter(dept).sort((a, b) => b.days_overdue - a.days_overdue) };
    }
    case 'training_history': {
      const rows = [];
      for (const a of (await list('LdAssignment')).filter(a => a.status === 'COMPLETED')) { const e = empBy[a.user_id]; rows.push({ code: e?.employee_code, name: e?.display_name, department: e?.department || '', training: a.course_title, completed: String(a.completed_at).slice(0, 10), score: a.score ?? '', hours: Math.round(((await get('LdCourse', a.course_id))?.duration_min || 0) / 6) / 10 }); }
      for (const i of inds.filter(i => i.status === 'COMPLETED')) rows.push({ code: i.employee.code, name: i.employee.name, department: i.employee.department, training: 'New Employee Induction', completed: String(i.completed_at).slice(0, 10), score: i.gates.find(g => g.gate_id === 'G05')?.last_score ?? '', hours: '' });
      return { title: 'Employee Training History', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('training', 'Training', 40), col('completed', 'Completed', 14), col('score', 'Score %', 10), col('hours', 'Hours', 10)], rows: rows.filter(dept) };
    }
    case 'assessment_results': {
      const rows = (await list('LdAttempt')).filter(a => a.status === 'SUBMITTED').map(a => { const e = empBy[a.user_id]; return { code: e?.employee_code, name: e?.display_name, department: e?.department || '', assessment: a.assessment_title, version: a.assessment_version, score: a.score, pass_mark: a.pass_score, result: a.passed ? 'Passed' : 'Failed', at: String(a.submitted_at).slice(0, 16).replace('T', ' ') }; });
      return { title: 'Assessment Results', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('assessment', 'Assessment', 36), col('version', 'Ver', 6), col('score', 'Score %', 10), col('pass_mark', 'Pass %', 10), col('result', 'Result', 10), col('at', 'Date', 18)], rows: rows.filter(dept) };
    }
    case 'practical_capability': {
      const rows = [];
      for (const i of inds) { const g = i.gates.find(x => x.gate_id === 'G08'); if (!g) continue; for (const c of g.competencies || []) rows.push({ code: i.employee.code, name: i.employee.name, department: i.employee.department, competency: c.name, stage: c.stage, gate_status: g.status, signed_off_by: (g.signoffs || []).map(s => s.by_name).join(', ') }); }
      return { title: 'Practical Capability', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('competency', 'Competency', 44), col('stage', 'Stage', 12), col('gate_status', 'Gate', 14), col('signed_off_by', 'Signed off by', 24)], rows: rows.filter(dept) };
    }
    case 'department_training': {
      const by = {};
      for (const i of inds) { const k = i.employee.department || 'Unassigned'; const s = (by[k] ||= { department: k, joiners: 0, completed: 0, overdue: 0, dept_gate_done: 0 }); s.joiners++; if (i.status === 'COMPLETED') s.completed++; if (i.gates.some(g => g.status === 'OVERDUE')) s.overdue++; if (OKAY(i.gates.find(g => g.gate_id === 'G06')?.status)) s.dept_gate_done++; }
      return { title: 'Department Training', columns: [col('department', 'Department', 26), col('joiners', 'New joiners', 12), col('dept_gate_done', 'Department induction done', 22), col('completed', 'Induction completed', 18), col('overdue', 'With overdue steps', 18)], rows: Object.values(by).filter(dept) };
    }
    case 'skill_gap': {
      const rows = (await list('LdEmpSkill')).filter(s => s.required > s.current).map(s => ({ name: s.employee_name, department: s.department || '', skill: s.skill_name, current: s.current, required: s.required, gap: s.required - s.current, next: s.next_assessment })).filter(dept);
      return { title: 'Skill Gap', columns: [col('name', 'Employee', 26), col('department', 'Department', 20), col('skill', 'Skill', 28), col('current', 'Current (1-5)', 12), col('required', 'Required (1-5)', 14), col('gap', 'Gap', 8), col('next', 'Next assessment', 16)], rows: rows.sort((a, b) => b.gap - a.gap) };
    }
    case 'certification': {
      const cfg = await getConfig();
      const rows = (await list('LdCertificate')).map(c => ({ certificate_id: c.certificate_id, name: c.employee_name, code: c.employee_code, department: empBy[c.user_id]?.department || '', title: c.title, score: c.score ?? '', issue: c.issue_date, expiry: c.expiry_date || '', status: certStatus(c, cfg) })).filter(dept);
      return { title: 'Certification', columns: [col('certificate_id', 'Certificate ID', 20), col('code', 'Code', 12), col('name', 'Employee', 26), col('department', 'Department', 20), col('title', 'Certificate', 38), col('score', 'Score', 8), col('issue', 'Issued', 12), col('expiry', 'Expires', 12), col('status', 'Status', 12)], rows };
    }
    case 'training_hours': {
      const hrs = {};
      const courses = Object.fromEntries((await list('LdCourse')).map(c => [c.id, c]));
      for (const a of (await list('LdAssignment')).filter(a => a.status === 'COMPLETED')) hrs[a.user_id] = (hrs[a.user_id] || 0) + (courses[a.course_id]?.duration_min || 0) / 60;
      for (const i of inds.filter(i => i.status === 'COMPLETED')) hrs[i.user_id] = (hrs[i.user_id] || 0) + 7; // standard induction programme ≈ 7 hrs of scheduled sessions
      const rows = emps.filter(e => e.user_id && e.status !== 'inactive').map(e => ({ code: e.employee_code, name: e.display_name, department: e.department || '', hours: Math.round((hrs[e.user_id] || 0) * 10) / 10, target: (e.department || '').match(/production|store|service|logistics/i) ? 30 : 40 })).filter(dept).map(r => ({ ...r, achieved: pct(r.hours, r.target) + '%' }));
      return { title: 'Training Hours', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 22), col('hours', 'Hours', 10), col('target', 'Target / yr', 12), col('achieved', 'Achieved', 12)], rows: rows.sort((a, b) => a.hours - b.hours) };
    }
    case 'training_effectiveness': {
      const rows = (await list('LdFeedback')).map(f => ({ name: empBy[f.user_id]?.display_name || '', department: empBy[f.user_id]?.department || '', training: f.title, rating: f.rating, comments: f.comments, at: String(f.at).slice(0, 10) })).filter(dept);
      return { title: 'Training Effectiveness', columns: [col('name', 'Employee', 24), col('department', 'Department', 20), col('training', 'Training', 34), col('rating', 'Rating (1-5)', 12), col('comments', 'Comments', 50), col('at', 'Date', 12)], rows };
    }
    case 'review_30_60_90': {
      const rows = [];
      for (const i of inds) for (const g of i.gates.filter(g => /Review/.test(g.name))) rows.push({ code: i.employee.code, name: i.employee.name, department: i.employee.department, review: g.name, due: g.due_date, status: g.status.replace('_', ' '), manager: i.employee.reporting_manager_name, completed: g.completed_at ? String(g.completed_at).slice(0, 10) : '' });
      return { title: '30/60/90 Review', columns: [col('code', 'Code', 12), col('name', 'Name', 26), col('department', 'Department', 20), col('review', 'Review', 44), col('due', 'Due', 12), col('status', 'Status', 14), col('manager', 'Manager', 22), col('completed', 'Completed', 12)], rows: rows.filter(dept) };
    }
    case 'trainer_performance': {
      const fb = await list('LdFeedback');
      const rows = [];
      for (const t of await list('LdTrainer')) {
        const mine = inds.filter(i => i.trainer_user_id === t.user_id); const r = fb.filter(x => x.trainer_user_id === t.user_id).map(x => x.rating);
        rows.push({ name: t.name || await nameOf(t.user_id), expertise: (t.expertise || []).join(', '), inductions: mine.length, signoffs: mine.reduce((s, i) => s + i.gates.reduce((x, g) => x + g.signoffs.filter(so => so.by === t.user_id).length, 0), 0), rating: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10 : '', feedback: r.length });
      }
      return { title: 'Trainer Performance', columns: [col('name', 'Trainer', 26), col('expertise', 'Expertise', 30), col('inductions', 'Inductions', 12), col('signoffs', 'Sign-offs', 12), col('rating', 'Avg rating', 12), col('feedback', 'Feedback #', 12)], rows };
    }
    default:
      return { title: 'Unknown report', columns: [], rows: [] };
  }
}

export const LD_REPORTS = [
  ['new_joiner_induction', 'New Joiner Induction'], ['new_joiner_completion', 'New Joiner Completion'], ['mandatory_compliance', 'Mandatory Training Compliance'],
  ['overdue_training', 'Overdue Training'], ['training_history', 'Employee Training History'], ['assessment_results', 'Assessment Results'],
  ['practical_capability', 'Practical Capability'], ['department_training', 'Department Training'], ['skill_gap', 'Skill Gap'],
  ['certification', 'Certification'], ['training_hours', 'Training Hours'], ['training_effectiveness', 'Training Effectiveness'],
  ['review_30_60_90', '30/60/90 Review'], ['trainer_performance', 'Trainer Performance'],
];

// ── used by the daily job ─────────────────────────────────────────────────
export const ldInternals = { list, get, save, create, notify, audit, loadInduction, withLock, runAutoChecks, afterChange, recompute, evaluateGate, setStatus, ownersOf, hrUserIds, getConfig, nameOf, ACTIVE, TERMINAL, daysBetween, addDays, certStatus };
