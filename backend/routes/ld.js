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
import { DEFAULT_CONFIG, DEFAULT_TEMPLATE, DEFAULT_ASSESSMENT, DEFAULT_COURSES, SEED_QUESTION_TAGS } from '../utils/ldSeed.js';
import { drawQuestions, makeOptionOrders, publicQuestions, unmapAnswers, gradeAttempt } from '../utils/ldAssess.js';
import { isPdfUrl, openingGates, withOpeningGates, addWatchTime, syncPolicyTasks, policyStates, inductionPolicies, namesMatch, buildDeptOrg, makeOrgQuiz, gradeOrgQuiz, ACK_STATEMENT, WEBSITE_URL, WEBSITE_SECONDS, ORG_QUIZ_QUESTIONS } from '../utils/ldOpening.js';
import { createHash } from 'crypto';

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
    // older databases: give the seeded questions their topic block / critical flag (metadata only)
    for (const a of (await list('LdAssessment')).filter(x => x.key === DEFAULT_ASSESSMENT.key && !x.questions.some(q => q.topic))) {
      for (const q of a.questions) { q.topic = SEED_QUESTION_TAGS.topic[q.id] || 'A'; if (SEED_QUESTION_TAGS.critical.includes(q.id)) q.critical = true; }
      await save('LdAssessment', a);
    }
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
  // The "L&D Trainer" role (custom_role 'ld_trainer') has the full L&D toolset but none of HR's wider powers.
  const isLdTrainerRole = role === 'ld_trainer' || u?.role === 'ld_trainer';
  return {
    id: cu.id, user: u, role, cfg, isAdmin, isHR, isLdTrainerRole,
    isLdAdmin: isHR || isLdTrainerRole || cfg.ld_admin_user_ids.includes(cu.id),
    isManagement: role === 'management',
    isTrainer: isLdTrainerRole || trainerRows.some(t => t.user_id === cu.id && t.active !== false),
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
  if (ctx.isAdmin || ctx.isLdAdmin) return true; // HR / L&D admins can manage every step of anyone else's induction
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
  await syncPolicyGate(ind);
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

export async function createInduction(userId, { actorId = 'system', buddy_user_id = null, trainer_user_id = null, force = false, anchor_override = null, pause_exempt = false } = {}) {
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
  let anchor = daysBetween(doj, today) <= 3 ? doj : today; // an employee enrolled late is not "overdue" on day one
  if (anchor_override && /^\d{4}-\d{2}-\d{2}$/.test(anchor_override)) anchor = anchor_override; // HR chose the date due dates count from
  const mgrId = emp.reporting_manager_id || null;
  const hod = await deptHead(emp.department);
  const ind = {
    user_id: userId, status: 'IN_PROGRESS', started_at: nowIso(), anchor_date: anchor, doj, pause_exempt: !!pause_exempt,
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
  // Long-serving employee: "pre-joining readiness" does not apply, so the induction opens at Corporate Induction.
  if (daysBetween(doj, today) > 30) {
    const g0 = ind.gates.find(x => x.gate_id === 'G00');
    if (g0) setStatus(g0, 'WAIVED', actorId, 'Existing employee — pre-joining readiness not applicable');
  }
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
  if (cfg.paused) { await queueForResume(userId); return null; } // held until HR resumes induction training
  return createInduction(userId, { actorId: 'system' });
}

async function queueForResume(userId) {
  const cur = await get('LdConfig', 'ld-config');
  if (!cur) return;
  if (!(cur.queued_user_ids || []).includes(userId)) { cur.queued_user_ids = [...(cur.queued_user_ids || []), userId]; await save('LdConfig', cur); }
  await audit('LdConfig', 'ld-config', 'induction_queued_while_paused', 'system', { user_id: userId }, userId);
}

// ── assessments ───────────────────────────────────────────────────────────
// Scoring, question drawing and option shuffling live in ../utils/ldAssess.js (pure, unit-tested).
const norm = (s) => String(s ?? '').trim().toLowerCase();
const deviceOf = (res) => String(res?.req?.headers?.['user-agent'] || '').slice(0, 200);

// How often this person has already been served each question of this assessment (so retakes favour new ones).
async function seenCounts(userId, key) {
  const out = {};
  for (const a of await list('LdAttempt', 'AND user_id=$2', [userId])) {
    if ((a.assessment_key || a.assessment_id) !== key && a.assessment_id !== key) continue;
    for (const id of a.order || []) out[id] = (out[id] || 0) + 1;
  }
  return out;
}

// Record an attempt on an induction step and move the step: passed → PASSED; failed with attempts left →
// stays open but the employee must first review the weak topics; last attempt failed → FAILED + remediation.
async function applyGateResult(ind, g, att, gr, need, cfg, actorId) {
  const max = g.max_attempts || att.max_attempts || cfg.max_attempts;
  g.attempts.push({ attempt_id: att.id, at: att.submitted_at, score: gr.score, passed: gr.passed, gaps: gr.gaps, weak_topics: gr.weakTopics, critical_failed: gr.criticalFailed, expired: !!att.forfeited });
  g.last_score = gr.score;
  const used = g.attempts.length - (g.attempt_base || 0);
  const why = gr.passed ? '' : (gr.criticalFailed > 0 && gr.scoreOk ? `${gr.criticalFailed} critical question(s) wrong` : `${gr.score}% (pass ${need}%)`);
  await audit('LdInduction', ind.id, gr.passed ? 'assessment_passed' : 'assessment_failed', actorId, { gate: g.gate_id, score: gr.score, pass: need, critical_failed: gr.criticalFailed, attempt: used, of: max, expired: !!att.forfeited }, ind.user_id);
  if (gr.passed) {
    setStatus(g, 'PASSED', actorId, `assessment ${gr.score}%`); g.completed_at = nowIso(); g.needs_relearn = false;
    await notify([ind.user_id, ind.employee.reporting_manager_id], { title: 'Assessment passed', message: `${ind.employee.name} scored ${gr.score}% on the induction knowledge check.`, type: 'success', link: '/MyLearning' });
  } else if (used >= max) {
    setStatus(g, 'FAILED', actorId, `assessment ${why} — attempts used`);
    g.needs_relearn = false;
    g.remediation = { stage: 'GAP_IDENTIFIED', gap: gr.gaps.slice(0, 12).join(' | '), weak_topics: gr.weakTopics.map(t => t.topic), at: nowIso(), history: [{ stage: 'GAP_IDENTIFIED', by: 'system', at: nowIso(), note: `All ${max} attempts used; last result ${why}` }] };
    await notify([ind.user_id, ...(await ownersOf(ind, g)), ind.employee.reporting_manager_id, ind.trainer_user_id], { title: 'Assessment not passed — retraining needed', message: `${ind.employee.name} used all ${max} attempts on "${g.name}" (${why}). A retraining plan is needed before new attempts are released.`, type: 'warning', link: `/LdInductionDetail?id=${ind.id}` });
  } else {
    if (g.status === 'READY') setStatus(g, 'IN_PROGRESS', actorId, `assessment ${why}`);
    g.needs_relearn = cfg.require_relearn !== false;
    g.relearn_topics = gr.weakTopics.map(t => t.topic);
    g.relearn_from = nowIso();
    await notify(ind.user_id, { title: 'Assessment not passed yet', message: `${why}. ${max - used} attempt(s) left — review the weak topics, then try again.`, type: 'warning', link: '/MyLearning' });
  }
  return { attempts_left: Math.max(0, max - used), final_failure: !gr.passed && used >= max, needs_relearn: !!g.needs_relearn, relearn_topics: g.relearn_topics || [] };
}

// An attempt left open past its time limit is not scored by answers: it is closed as "not passed" and counts as used.
async function forfeitAttempt(att, actorId) {
  att.status = 'EXPIRED'; att.forfeited = true; att.score = 0; att.passed = false; att.submitted_at = nowIso(); att.results = []; att.gaps = [];
  await save('LdAttempt', att);
  if (!att.induction_id) return;
  await withLock('ind:' + att.induction_id, async () => {
    const ind = await loadInduction(att.induction_id);
    const g = ind?.gates.find(x => x.gate_id === att.gate_id);
    if (!g || g.attempts.some(a => a.attempt_id === att.id)) return;
    const cfg = await getConfig();
    const need = g.pass_score || att.pass_score || cfg.induction_pass_score;
    await applyGateResult(ind, g, att, { score: 0, passed: false, gaps: [], weakTopics: [], criticalFailed: 0, scoreOk: false }, need, cfg, actorId);
    await save('LdInduction', ind);
  });
}

// ── main dispatcher ───────────────────────────────────────────────────────
const PAUSED_MSG = 'Induction training is paused by HR — nothing can be completed, submitted or signed off until it resumes.';
// HR can start an induction for selected employees while training is paused; those inductions keep running.
const frozenFor = async (ctx, indId) => !!ctx.cfg.paused && !(indId && (await get('LdInduction', indId))?.pause_exempt);
const pausedInfo = (cfg) => (cfg.paused ? { since: cfg.paused_at, reason: cfg.pause_reason || '', by: cfg.paused_by || null } : null);
const ok = (res, body = {}) => res.json({ success: true, ...body });
const fail = (res, error, status = 200) => res.status(status).json({ success: false, error });
const forbid = (res, msg = 'Not allowed') => res.status(403).json({ success: false, error: msg });

function publicInduction(ind, ctx) {
  const d = clone(ind);
  for (const g of d.gates) {
    g.attempts = (g.attempts || []).map(a => ({ attempt_id: a.attempt_id, at: a.at, score: a.score, passed: a.passed, gaps: a.gaps, weak_topics: a.weak_topics, critical_failed: a.critical_failed, expired: a.expired }));
    if (g.completion === 'assessment') {
      const max = g.max_attempts || ctx.cfg.max_attempts;
      const used = g.attempts.length - (g.attempt_base || 0);
      const wait = ctx.cfg.relearn_min_seconds ?? 60;
      g.attempts_info = { used, max, left: Math.max(0, max - used), needs_relearn: !!g.needs_relearn, relearn_topics: g.relearn_topics || [], relearn_ready_at: g.needs_relearn && g.relearn_from ? new Date(Date.parse(g.relearn_from) + wait * 1000).toISOString() : null, critical_rule: ctx.cfg.critical_rule !== false };
    }
  }
  d._can = {};
  for (const g of d.gates) d._can[g.gate_id] = { owner: canOwn(ctx, ind, g), self: ctx.id === ind.user_id };
  d._viewer = { is_employee: ctx.id === ind.user_id, is_buddy: ind.buddy_user_id === ctx.id, is_hr: ctx.isHR, is_ld: ctx.isLdAdmin };
  return d;
}


// ── opening steps: website tour, policy acknowledgements, department org chart ─────────────
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileHashCache = new Map();
// SHA-256 of the policy file that was shown when it was signed (proves which document was acknowledged); null if it cannot be read.
async function fileHash(fileUrl) {
  const m = String(fileUrl || '').match(/\/api\/upload\/file\/([0-9a-f-]{36})/i);
  if (!m) return null;
  if (fileHashCache.has(m[1])) return fileHashCache.get(m[1]);
  let h = null;
  try {
    const row = await one("SELECT data, storage, r2_key FROM files WHERE id=$1", [m[1]]);
    if (row?.data) h = sha256(row.data);
    else if (row?.storage === 'railway' && row.r2_key) {
      const { getFromBucket } = await import('../utils/bucket.js');
      const obj = await getFromBucket(row.r2_key);
      const chunks = []; for await (const c of obj.Body) chunks.push(c);
      h = sha256(Buffer.concat(chunks));
    }
  } catch (e) { console.warn('[ld] policy file hash failed:', e.message); }
  if (h) fileHashCache.set(m[1], h);
  return h;
}
const ipOf = (res) => { const r = res.req; const f = r?.headers?.['x-forwarded-for']; return String(f ? String(f).split(',')[0] : r?.ip || '').trim().slice(0, 64); };
const gateActive = (g) => !!g && ['READY', 'IN_PROGRESS', 'OVERDUE'].includes(g.status);
async function activeEmployees() {
  const today = todayIST();
  return (await list('Employee')).filter(e => e.user_id && e.status === 'active' && !(e.last_working_date && String(e.last_working_date).slice(0, 10) < today) && !(e.exit_date && String(e.exit_date).slice(0, 10) < today));
}
// Policy step: tasks follow the company policy list (Company Policies page) until the step is finished.
async function syncPolicyGate(ind) {
  const g = ind.gates?.find(x => x.gate_id === 'P1');
  if (!g || TERMINAL.has(g.status)) return false;
  const next = syncPolicyTasks(g.tasks || [], await list('CompanyPolicy'));
  if (JSON.stringify(next.map(x => [x.id, x.title, x.file_url, x.min_read_seconds])) === JSON.stringify((g.tasks || []).map(x => [x.id, x.title, x.file_url, x.min_read_seconds]))) return false;
  g.tasks = next;
  return true;
}
function ackReceiptDoc(a) {
  const f = (v) => ({ text: String(v ?? '—'), fontSize: 10 });
  const when = new Date(Date.parse(a.signed_at) + IST_MS).toISOString().replace('T', ' ').slice(0, 19) + ' IST';
  const row = (k, v) => [{ text: k, bold: true, fontSize: 9, color: '#374151' }, f(v)];
  return {
    pageSize: 'A4', pageMargins: [50, 50, 50, 50], defaultStyle: { font: 'Roboto', color: '#1F2937' },
    content: [
      { text: 'Maxvolt Energy Industries Limited', fontSize: 10, color: '#6B7280' },
      { text: 'Policy Acknowledgement Receipt', fontSize: 20, bold: true, color: '#1A3C5E', margin: [0, 2, 0, 14] },
      { table: { widths: [130, '*'], body: [row('Employee', `${a.employee_name} (${a.employee_code || '—'})`), row('Department / designation', `${a.department || '—'} · ${a.designation || '—'}`), row('Policy', a.policy_title), row('Category', a.policy_category || '—'), row('Policy version', a.policy_version || '—'), row('Signed on', when), row('Time spent reading', `${Math.floor((a.read_seconds || 0) / 60)} min ${(a.read_seconds || 0) % 60} s`)] }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 14] },
      { text: 'Statement acknowledged', bold: true, fontSize: 11, color: '#1A3C5E', margin: [0, 4, 0, 4] },
      { text: `“${a.statement}”`, italics: true, fontSize: 12, margin: [0, 0, 0, 12] },
      { text: 'Signed (typed name)', bold: true, fontSize: 11, color: '#1A3C5E', margin: [0, 0, 0, 4] },
      { text: a.typed_name, fontSize: 18, italics: true, margin: [0, 0, 0, 16] },
      { text: 'Integrity details', bold: true, fontSize: 10, color: '#6B7280', margin: [0, 6, 0, 3] },
      { table: { widths: [130, '*'], body: [row('Receipt ID', a.id), row('Document SHA-256', a.policy_file_sha256 || 'not available'), row('Record SHA-256', a.record_sha256), row('Signed from', a.ip || '—')] }, layout: 'lightHorizontalLines' },
      { text: 'This acknowledgement is stored permanently in Maxvolt One and cannot be edited or deleted.', fontSize: 8, color: '#6B7280', margin: [0, 14, 0, 0] },
    ],
  };
}
async function activeTemplate() { return (await list('LdTemplate')).filter(t => t.status === 'active').sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null; }

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
    return ok(res, { is_ld_admin: ctx.isLdAdmin, is_ld_trainer: ctx.isLdTrainerRole, is_hr: ctx.isHR, is_trainer: ctx.isTrainer, is_manager: asManager || reports, is_hod: asHod || !!(await one("SELECT id FROM entities WHERE type='Department' AND data::jsonb->>'head_user_id'=$1", [ctx.id])), is_buddy: asBuddy, has_induction: !!mine });
  },

  // Home screen for the L&D Trainer role: what needs the trainer's action today, plus the learners most at risk.
  async ld_getTrainerHome(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isTrainer) return forbid(res);
    const today = todayIST();
    const all = p.scope === 'all';
    const inds = (await list('LdInduction')).filter(i => i.status !== 'CANCELLED' && i.status !== 'COMPLETED');
    const mineInds = inds.filter(i => i.trainer_user_id === ctx.id);
    const scoped = all ? inds : mineInds;
    const sums = scoped.map(i => summarise(i, today));
    const awaiting = sums.filter(x => x.pending_signoffs > 0);
    const atRisk = sums.filter(x => x.overdue_gates > 0 || x.failed_gates > 0 || x.blocked_gates > 0);
    const assignments = (await list('LdAssignment')).filter(a => !['CANCELLED', 'COMPLETED', 'WAIVED'].includes(a.status));
    const overdueAssign = assignments.filter(a => a.due_date && a.due_date < today);
    const courses = Object.fromEntries((await list('LdCourse')).map(c => [c.id, c]));
    const emps = Object.fromEntries((await list('Employee')).map(e => [e.user_id, e]));
    const certs = (await list('LdCertificate')).map(c => ({ ...c, status: certStatus(c, ctx.cfg) }));
    const expiring = certs.filter(c => c.expiry_date && c.status !== 'REVOKED' && daysBetween(today, String(c.expiry_date).slice(0, 10)) <= 30 && daysBetween(today, String(c.expiry_date).slice(0, 10)) >= 0);
    const slim = (x) => ({ id: x.id, name: x.name, code: x.code, department: x.department, designation: x.designation, current_gate: x.current_gate, current_status: x.current_status, due_date: x.due_date, progress: x.progress, overdue_gates: x.overdue_gates, failed_gates: x.failed_gates, blocked_gates: x.blocked_gates, pending_signoffs: x.pending_signoffs, days_in: x.days_in });
    return ok(res, {
      scope: all ? 'all' : 'mine',
      kpis: {
        my_learners: mineInds.length, active_inductions: inds.length, awaiting_signoff: awaiting.reduce((n, x) => n + x.pending_signoffs, 0),
        at_risk: atRisk.length, overdue_assignments: overdueAssign.length, open_assignments: assignments.length, certs_expiring_30d: expiring.length,
        pending_waivers: (await list('LdWaiver')).filter(w => w.status === 'PENDING').length,
      },
      awaiting_signoff: awaiting.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 25).map(slim),
      at_risk: atRisk.sort((a, b) => (b.overdue_gates + b.failed_gates) - (a.overdue_gates + a.failed_gates)).slice(0, 25).map(slim),
      overdue_assignments: overdueAssign.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 25).map(a => ({ id: a.id, employee_name: emps[a.user_id]?.display_name || '', department: emps[a.user_id]?.department || '', course: courses[a.course_id]?.title || '', due_date: a.due_date, mandatory: !!a.mandatory })),
      expiring_certs: expiring.sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date))).slice(0, 25).map(c => ({ certificate_id: c.certificate_id, employee_name: c.employee_name || emps[c.user_id]?.display_name || '', title: c.title, expiry_date: c.expiry_date })),
      paused: pausedInfo(ctx.cfg),
    });
  },

  async ld_getMyLearning(p, ctx, res) {
    const inds = (await list('LdInduction')).filter(i => i.status !== 'CANCELLED');
    let mine = inds.find(i => i.user_id === ctx.id);
    const mineFrozen = !!(mine && ctx.cfg.paused && !mine.pause_exempt);
    if (mine && !mineFrozen) {
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
          required_action: g.status === 'FAILED' ? 'Waiting for retraining / reassessment to be approved' : waiting ? 'Waiting for sign-off' : (g.completion === 'assessment' && !empTasks.length ? (g.needs_relearn ? 'Review the weak topics, then retake the assessment' : 'Take the assessment') : empTasks.length ? `${empTasks.length} action(s) for you` : 'Waiting for your trainer / manager'),
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
      paused: mineFrozen ? pausedInfo(ctx.cfg) : null,
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
    const frozen = !!ctx.cfg.paused && !ind.pause_exempt;
    if (!frozen) await withLock('ind:' + ind.id, async () => {
      const fresh = await loadInduction(ind.id);
      if (await runAutoChecks(fresh)) { await afterChange(fresh, 'system'); await save('LdInduction', fresh); }
      ind = fresh;
    });
    const trail = (await list('LdAudit')).filter(a => a.entity_id === ind.id).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200);
    const waivers = (await list('LdWaiver')).filter(w => w.induction_id === ind.id);
    const people = {};
    for (const uid of new Set(trail.map(a => a.actor_id).filter(x => x && x !== 'system'))) people[uid] = await nameOf(uid);
    return ok(res, { paused: frozen ? pausedInfo(ctx.cfg) : null, induction: publicInduction(ind, ctx), audit: trail.map(a => ({ ...a, actor_name: a.actor_id === 'system' ? 'System' : (people[a.actor_id] || a.actor_id) })), waivers });
  },

  // ── tasks / forms / gate actions ──
  async ld_completeTask(p, ctx, res) {
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      const t = g?.tasks.find(x => x.id === p.task_id);
      if (!g || !t) { fail(res, 'Task not found', 404); return false; }
      if (!ACTIVE.has(g.status) && g.status !== 'FAILED') { fail(res, `This step is ${g.status.replace('_', ' ').toLowerCase()} — it cannot be changed right now`); return false; }
      if (g.status === 'FAILED') { fail(res, 'This step failed — retraining must be approved first'); return false; }
      if (t.actor === 'employee') { if (ctx.id !== ind.user_id && !ctx.isHR) { forbid(res, 'Only the employee can complete this item'); return false; } }
      else if (!canOwn(ctx, ind, g)) { forbid(res, 'Only the trainer / manager / HR responsible for this step can complete this item'); return false; }
      if (t.auto_check && !p.undo) { fail(res, 'This item completes automatically when the action is done in Maxvolt One'); return false; }
      if (t.server_only && !p.undo) { fail(res, 'Open this step and complete it there — it cannot be ticked off by hand'); return false; }
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
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
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
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
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
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
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
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
    return mutate(p.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g || g.status !== 'FAILED') { fail(res, 'Only a failed step can be remediated'); return false; }
      if (!canOwn(ctx, ind, g) && !ctx.isLdAdmin) { forbid(res); return false; }
      const order = ['GAP_IDENTIFIED', 'REMEDIATION', 'RETRAINING', 'REASSESSMENT'];
      const cur = g.remediation?.stage || 'GAP_IDENTIFIED';
      const next = p.finish ? 'REASSESSMENT' : order[Math.min(order.length - 1, order.indexOf(cur) + 1)];
      g.remediation = g.remediation || { history: [] };
      g.remediation.stage = next; g.remediation.history.push({ stage: next, by: ctx.id, at: nowIso(), note: clean(p.note, 800) });
      if (next === 'REASSESSMENT') {
        // Reopen for a real second attempt. Earlier attempts / sign-offs stay on record (history), but the
        // work must be done again: owner/employee items are reset, assessment attempts start a fresh count.
        g.superseded_signoffs = [...(g.superseded_signoffs || []), ...g.signoffs];
        g.signoffs = [];
        g.attempt_base = (g.attempts || []).length;
        g.needs_relearn = false;
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

  // Start induction for one or many employees (new or long-serving). While induction training is paused the
  // selected employees still start and keep running; everyone else stays frozen.
  async ld_startInduction(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const waveIds = p.wave ? (await resolveWave(p.wave)).user_ids : [];
    const ids = [...new Set([...(Array.isArray(p.user_ids) ? p.user_ids : []), ...(p.user_id ? [p.user_id] : []), ...waveIds].filter(Boolean))];
    if (!ids.length) return fail(res, 'Select at least one employee');
    let anchor_override = null;
    if (p.anchor === 'today') anchor_override = todayIST();
    else if (p.anchor === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.start_date || ''))) return fail(res, 'Pick a start date'); anchor_override = p.start_date; }
    const pausedNow = !!ctx.cfg.paused;
    const results = [];
    for (const uid of ids) {
      try {
        const d = await createInduction(uid, { actorId: ctx.id, buddy_user_id: p.buddy_user_id || null, trainer_user_id: p.trainer_user_id || null, anchor_override, pause_exempt: pausedNow });
        let note = 'started';
        // already has a running induction that is frozen by the pause → let it run
        if (pausedNow && d.status === 'IN_PROGRESS' && !d.pause_exempt) {
          await withLock('ind:' + d.id, async () => {
            const fresh = await loadInduction(d.id); fresh.pause_exempt = true; await save('LdInduction', fresh);
            await audit('LdInduction', d.id, 'induction_unfrozen_by_hr', ctx.id, {}, uid);
          });
          d.pause_exempt = true; note = 'already had an induction — now running';
        } else if (d.started_at && Date.now() - new Date(d.started_at).getTime() > 60000) note = 'already had an induction';
        results.push({ user_id: uid, ok: true, note, induction_id: d.id });
      } catch (e) { results.push({ user_id: uid, ok: false, error: e.message }); }
    }
    // a manual start also clears the employees from the held-while-paused queue
    const cur = await get('LdConfig', 'ld-config');
    if (cur && (cur.queued_user_ids || []).some(x => ids.includes(x))) { cur.queued_user_ids = cur.queued_user_ids.filter(x => !ids.includes(x)); await save('LdConfig', cur); }
    const okCount = results.filter(r => r.ok).length;
    if (!okCount) return fail(res, results[0]?.error || 'Could not start induction');
    return ok(res, { results, started: okCount, failed: results.length - okCount, paused: pausedInfo(ctx.cfg) });
  },

  async ld_cancelInduction(p, ctx, res) {
    return mutate(p.induction_id, ctx, res, async (ind) => {
      if (!ctx.isLdAdmin) { forbid(res); return false; }
      if (ind.status !== 'IN_PROGRESS') { fail(res, 'Only an ongoing induction can be cancelled'); return false; }
      if (clean(p.reason, 500).length < 3) { fail(res, 'Please give a reason for cancelling'); return false; }
      ind.status = 'CANCELLED'; ind.cancelled_at = nowIso(); ind.cancel_reason = clean(p.reason, 500);
      ind.gates.forEach(g => { if (!TERMINAL.has(g.status)) setStatus(g, 'CANCELLED', ctx.id, 'induction cancelled'); });
      await audit('LdInduction', ind.id, 'induction_cancelled', ctx.id, { reason: p.reason }, ind.user_id);
      await notify(ind.user_id, { title: 'Induction cancelled', message: `HR cancelled your induction: ${ind.cancel_reason}`, type: 'warning', link: '/MyLearning' });
    });
  },

  // Cancel the ongoing induction (history is kept) and start a fresh one for the same employee.
  async ld_restartInduction(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const old = await loadInduction(p.induction_id);
    if (!old) return fail(res, 'Induction not found', 404);
    if (old.status === 'COMPLETED') return fail(res, 'This induction is already completed');
    if (clean(p.reason, 500).length < 3 && old.status === 'IN_PROGRESS') return fail(res, 'Please give a reason for restarting');
    let anchor_override = null;
    if (p.anchor === 'today') anchor_override = todayIST();
    else if (p.anchor === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.start_date || ''))) return fail(res, 'Pick a start date'); anchor_override = p.start_date; }
    try {
      if (old.status === 'IN_PROGRESS') {
        await withLock('ind:' + old.id, async () => {
          const ind = await loadInduction(old.id);
          ind.status = 'CANCELLED'; ind.cancelled_at = nowIso(); ind.cancel_reason = 'Restarted: ' + clean(p.reason, 480);
          ind.gates.forEach(g => { if (!TERMINAL.has(g.status)) setStatus(g, 'CANCELLED', ctx.id, 'induction restarted'); });
          await save('LdInduction', ind);
          await audit('LdInduction', ind.id, 'induction_restarted', ctx.id, { reason: p.reason }, ind.user_id);
        });
      }
      const d = await createInduction(old.user_id, { actorId: ctx.id, buddy_user_id: old.buddy_user_id || null, trainer_user_id: old.trainer_user_id || null, anchor_override, pause_exempt: !!ctx.cfg.paused });
      return ok(res, { induction_id: d.id, induction: publicInduction(d, ctx) });
    } catch (e) { return fail(res, e.message); }
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
    let ind = null, gate = null, assessment = null, assignment = null, max = ctx.cfg.max_attempts, passNeed = ctx.cfg.induction_pass_score;
    if (p.induction_id) {
      if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
      ind = await loadInduction(p.induction_id);
      gate = ind?.gates.find(g => g.gate_id === p.gate_id);
      if (!ind || !gate || gate.completion !== 'assessment') return fail(res, 'Assessment step not found', 404);
      if (ind.user_id !== ctx.id) return forbid(res, 'Only the employee can take their own assessment');
      // one active attempt at a time: resume an open one, or close it (counts as used) if its time ran out
      const open = (await list('LdAttempt', 'AND user_id=$2', [ctx.id])).find(a => a.status === 'IN_PROGRESS' && a.induction_id === ind.id && a.gate_id === gate.gate_id);
      if (open) {
        if (!open.expires_at || Date.now() <= Date.parse(open.expires_at)) {
          const oa = await get('LdAssessment', open.assessment_id);
          if (oa) return ok(res, { attempt_id: open.id, resumed: true, title: oa.title, time_limit_min: oa.time_limit_min || null, pass_score: open.pass_score, questions: publicQuestions(oa.questions, open.order, open.opt_order), expires_at: open.expires_at, attempt_no: open.attempt_no, max_attempts: open.max_attempts, critical_rule: ctx.cfg.critical_rule !== false });
        }
        await forfeitAttempt(open, ctx.id);
        ind = await loadInduction(p.induction_id); gate = ind.gates.find(g => g.gate_id === p.gate_id);
      }
      if (!['READY', 'IN_PROGRESS', 'OVERDUE'].includes(gate.status)) return fail(res, `This assessment is ${gate.status.replace('_', ' ').toLowerCase()}`);
      if (!requiredTasksDone(gate)) return fail(res, 'Complete the preparation items first');
      assessment = (await list('LdAssessment')).filter(a => a.key === gate.assessment_key && a.status !== 'archived').sort((a, b) => b.version - a.version)[0];
      max = gate.max_attempts || assessment?.max_attempts || ctx.cfg.max_attempts;
      passNeed = gate.pass_score || assessment?.pass_score || ctx.cfg.induction_pass_score;
      if ((gate.attempts || []).length - (gate.attempt_base || 0) >= max) return fail(res, 'Maximum attempts used — ask HR / L&D to approve retraining');
      if (gate.needs_relearn && ctx.cfg.require_relearn !== false) return fail(res, 'Review the topics you missed before the next attempt — open the induction step and confirm you have revisited them.');
    } else if (p.assignment_id) {
      assignment = await get('LdAssignment', p.assignment_id);
      if (!assignment || assignment.user_id !== ctx.id) return fail(res, 'Assignment not found', 404);
      const course = await get('LdCourse', assignment.course_id);
      assessment = await get('LdAssessment', course?.assessment_id);
      if (!assessment) return fail(res, 'This course has no assessment');
      const mine = (await list('LdAttempt', 'AND user_id=$2', [ctx.id])).filter(a => a.assignment_id === assignment.id);
      const open = mine.find(a => a.status === 'IN_PROGRESS');
      if (open) {
        if (!open.expires_at || Date.now() <= Date.parse(open.expires_at)) return ok(res, { attempt_id: open.id, resumed: true, title: assessment.title, time_limit_min: assessment.time_limit_min || null, pass_score: open.pass_score, questions: publicQuestions(assessment.questions, open.order, open.opt_order), expires_at: open.expires_at, attempt_no: open.attempt_no, max_attempts: open.max_attempts, critical_rule: ctx.cfg.critical_rule !== false });
        await forfeitAttempt(open, ctx.id);
      }
      max = assessment.max_attempts || ctx.cfg.max_attempts;
      passNeed = assessment.pass_score || ctx.cfg.induction_pass_score;
      if (mine.length >= max) return fail(res, 'Maximum attempts used');
    } else return fail(res, 'induction_id + gate_id or assignment_id required');
    if (!assessment) return fail(res, 'Assessment not configured', 404);
    const prior = ind ? gate.attempts.length : (await list('LdAttempt', 'AND user_id=$2', [ctx.id])).filter(a => a.assignment_id === assignment.id).length;
    const order = (assessment.randomize === false ? assessment.questions.map(q => q.id) : drawQuestions(assessment.questions, assessment.questions_per_attempt, await seenCounts(ctx.id, assessment.key || assessment.id)));
    const optOrders = makeOptionOrders(assessment.questions, order, assessment.shuffle_options !== false);
    const secs = (Number(assessment.time_limit_min) || 0) * 60;
    const attempt = await create('LdAttempt', {
      user_id: ctx.id, assessment_id: assessment.id, assessment_key: assessment.key || assessment.id, assessment_version: assessment.version, assessment_title: assessment.title,
      induction_id: ind?.id || null, gate_id: gate?.gate_id || null, assignment_id: assignment?.id || null, order, opt_order: optOrders,
      attempt_no: prior - (gate?.attempt_base || 0) + 1, max_attempts: max, pass_score: passNeed, device: deviceOf(res),
      started_at: nowIso(), expires_at: secs ? new Date(Date.now() + secs * 1000 + 60000).toISOString() : null, status: 'IN_PROGRESS',
    }, ctx.id);
    if (ind) await withLock('ind:' + ind.id, async () => { const f = await loadInduction(ind.id); const g = f.gates.find(x => x.gate_id === gate.gate_id); if (g.status === 'READY') setStatus(g, 'IN_PROGRESS', ctx.id, 'assessment started'); await save('LdInduction', f); });
    return ok(res, { attempt_id: attempt.id, title: assessment.title, time_limit_min: assessment.time_limit_min || null, pass_score: passNeed, questions: publicQuestions(assessment.questions, order, optOrders), expires_at: attempt.expires_at, attempt_no: attempt.attempt_no, max_attempts: max, critical_rule: ctx.cfg.critical_rule !== false });
  },

  async ld_submitAttempt(p, ctx, res) {
    const att = await get('LdAttempt', p.attempt_id);
    if (!att || att.user_id !== ctx.id) return fail(res, 'Attempt not found', 404);
    if (att.induction_id && await frozenFor(ctx, att.induction_id)) return fail(res, PAUSED_MSG);
    if (att.status !== 'IN_PROGRESS') return fail(res, 'This attempt was already submitted');
    const assessment = await get('LdAssessment', att.assessment_id);
    if (!assessment) return fail(res, 'Assessment not found', 404);
    if (att.expires_at && Date.now() > Date.parse(att.expires_at)) { await forfeitAttempt(att, ctx.id); return fail(res, 'Time limit exceeded — this attempt was closed as not passed'); }
    const answers = unmapAnswers(p.answers || {}, att.opt_order || {});   // back to the original option numbers
    const criticalRule = ctx.cfg.critical_rule !== false;
    const finish = (gr, need) => {
      Object.assign(att, { answers, score: gr.score, passed: gr.passed, pass_score: need, submitted_at: nowIso(), status: 'SUBMITTED', results: gr.results, gaps: gr.gaps, weak_topics: gr.weakTopics, critical_failed: gr.criticalFailed, time_taken_sec: Math.round((Date.now() - Date.parse(att.started_at)) / 1000), device: att.device || deviceOf(res) });
    };
    const view = (gr, need, extra = {}) => ({ score: gr.score, passed: gr.passed, pass_score: need, results: gr.results.map(r => ({ id: r.id, correct: r.correct })), gaps: gr.gaps, weak_topics: gr.weakTopics, critical_failed: gr.criticalFailed, critical_rule: criticalRule, ...extra });
    if (att.induction_id) {
      return mutate(att.induction_id, ctx, res, async (ind) => {
        const g = ind.gates.find(x => x.gate_id === att.gate_id);
        const need = g.pass_score || assessment.pass_score || ctx.cfg.induction_pass_score;
        const gr = gradeAttempt(assessment.questions, att.order, answers, { passScore: need, criticalRule });
        finish(gr, need);
        await save('LdAttempt', att);
        const st = await applyGateResult(ind, g, att, gr, need, ctx.cfg, ctx.id);
        return { result: view(gr, need, { attempt_no: g.attempts.length - (g.attempt_base || 0), ...st }) };
      });
    }
    // course assessment
    const need = assessment.pass_score || ctx.cfg.induction_pass_score;
    const gr = gradeAttempt(assessment.questions, att.order, answers, { passScore: need, criticalRule });
    finish(gr, need);
    await save('LdAttempt', att);
    if (gr.passed && att.assignment_id) await completeAssignment(att.assignment_id, ctx.id, gr.score);
    const used = (await list('LdAttempt', 'AND user_id=$2', [ctx.id])).filter(a => a.assignment_id === att.assignment_id).length;
    return ok(res, { result: view(gr, need, { attempt_no: used, attempts_left: Math.max(0, (assessment.max_attempts || ctx.cfg.max_attempts) - used) }) });
  },

  // After a failed attempt the employee confirms they have revisited the weak topics (after a short cooling-off).
  async ld_ackRelearn(p, ctx, res) {
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
    return mutate(p.induction_id, ctx, res, async (ind) => {
      if (ind.user_id !== ctx.id) { forbid(res, 'Only the employee can confirm this'); return false; }
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      if (!g || !g.needs_relearn) { fail(res, 'There is nothing to review right now'); return false; }
      const wait = ctx.cfg.relearn_min_seconds ?? 60;
      const since = (Date.now() - Date.parse(g.relearn_from || nowIso())) / 1000;
      if (since < wait) { fail(res, `Please spend a little more time on the content — ${Math.ceil(wait - since)}s left before the next attempt unlocks`); return false; }
      g.needs_relearn = false; g.relearn_ack_at = nowIso();
      await audit('LdInduction', ind.id, 'relearn_confirmed', ctx.id, { gate: g.gate_id, topics: g.relearn_topics }, ind.user_id);
    });
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
    return ok(res, { assessments: await list('LdAssessment'), topics: ctx.cfg.topics });
  },
  async ld_saveAssessment(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const a = p.assessment || {};
    if (!clean(a.title) || !Array.isArray(a.questions) || !a.questions.length) return fail(res, 'Title and at least one question are required');
    const taken = new Set(a.questions.map(q => q.id).filter(Boolean));
    const fresh = () => { let n = 1; while (taken.has('Q' + n)) n++; taken.add('Q' + n); return 'Q' + n; };
    const seen = new Set();
    const normQ = (q, id) => ({ id, type: ['mcq', 'multi', 'truefalse', 'short'].includes(q.type) ? q.type : 'mcq', text: clean(q.text, 800), options: (q.options || []).map(o => clean(o, 300)), correct: (q.correct || []).map(Number), accepted: (q.accepted || []).map(x => clean(x, 200)), points: Number(q.points) || 1, scenario: !!q.scenario, critical: !!q.critical, topic: clean(q.topic, 40) });
    const qs = a.questions.map((q) => {
      let id = q.id; if (!id || seen.has(id)) id = fresh(); seen.add(id);
      return normQ(q, id);
    });
    for (const q of qs) { if (!q.text) return fail(res, 'Every question needs text'); if (q.type !== 'short' && (q.options.length < 2 || !q.correct.length || q.correct.some(c => !(c >= 0 && c < q.options.length)))) return fail(res, `Question "${q.text.slice(0, 40)}" needs options and a valid correct answer`); if (q.type === 'short' && !q.accepted.length) return fail(res, `Short-answer question "${q.text.slice(0, 40)}" needs at least one accepted keyword`); }
    const perAttempt = Math.max(0, Math.min(Number(a.questions_per_attempt) || 0, qs.length));
    const base = { title: clean(a.title, 200), description: clean(a.description, 1000), pass_score: Math.min(100, Number(a.pass_score) || ctx.cfg.induction_pass_score || 90), max_attempts: Number(a.max_attempts) || ctx.cfg.max_attempts || 3, time_limit_min: Number(a.time_limit_min) || 0, questions_per_attempt: perAttempt, randomize: a.randomize !== false, shuffle_options: a.shuffle_options !== false, status: a.status === 'archived' ? 'archived' : 'active', questions: qs };
    if (a.id) {
      const cur = await get('LdAssessment', a.id); if (!cur) return fail(res, 'Assessment not found', 404);
      // keep history intact: editing questions creates a new version (old attempts reference the old content)
      const changed = JSON.stringify(cur.questions.map(q => normQ(q, q.id))) !== JSON.stringify(qs);   // compare like with like, so a settings-only save keeps the version
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
      paused: pausedInfo(ctx.cfg), queued_count: (ctx.cfg.queued_user_ids || []).length, feedback_avg: await feedbackAvg(), policy: { pass_score: ctx.cfg.induction_pass_score, max_attempts: ctx.cfg.max_attempts, critical_rule: ctx.cfg.critical_rule !== false },
      kpis: {
        total: sums.length, not_started: sums.filter(s => s.status_label === 'Not started').length, in_progress: sums.filter(s => s.status_label === 'In progress').length,
        completed: sums.filter(s => s.status_label === 'Completed').length, overdue: sums.filter(s => s.overdue_gates > 0).length, blocked: sums.filter(s => s.blocked_gates > 0).length,
        assessment_failures: sums.reduce((s, x) => s + x.failed_gates, 0), pending_approvals: pendingApprovals,
        avg_completion_days: completed.length ? Math.round(completed.reduce((s, i) => s + (Date.parse(i.completed_at) - Date.parse(i.started_at)) / 86400000, 0) / completed.length * 10) / 10 : null,
        assessment_pass_rate: attempts.length ? Math.round(attempts.filter(a => a.passed).length / attempts.length * 100) : null,
        practical_signoff_rate: pct(inds.filter(i => OKAY(i.gates.find(g => g.gate_id === 'G08')?.status)).length, inds.length),
        review_completion: pct(reviews.filter(g => OKAY(g.status)).length, reviews.filter(g => g.due_date <= today || OKAY(g.status)).length),
        missing_inductions: eligible.filter(e => !withInd.has(e.user_id)).length,
        ...policyKpis(inds, emps, today),
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
    const doc = { ...(cur || { id: 'ld-config' }), induction_pass_score: Math.min(100, Number(c.induction_pass_score) || 90), max_attempts: Number(c.max_attempts) || 3, critical_rule: c.critical_rule !== false, require_relearn: c.require_relearn !== false, relearn_min_seconds: Math.max(0, Number(c.relearn_min_seconds ?? cur?.relearn_min_seconds ?? 60)), seconds_per_question: Math.max(10, Number(c.seconds_per_question) || cur?.seconds_per_question || 60), topics: Array.isArray(c.topics) && c.topics.length ? c.topics.map(t => ({ key: clean(t.key, 10), label: clean(t.label, 120), min: Math.max(0, Number(t.min) || 0) })).filter(t => t.key) : (cur?.topics || DEFAULT_CONFIG.topics), due_soon_days: Number(c.due_soon_days) || 2, expiring_cert_days: Number(c.expiring_cert_days) || 30, auto_start_induction: c.auto_start_induction !== false, escalation_days: { ...DEFAULT_CONFIG.escalation_days, ...(c.escalation_days || {}) }, ld_admin_user_ids: Array.isArray(c.ld_admin_user_ids) ? c.ld_admin_user_ids : (cur?.ld_admin_user_ids || []) };
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

  // Global pause / resume of all induction training.
  //   pause  → nothing can be completed / signed off, no steps unlock, no reminders / overdue / escalation;
  //            new joiners approved meanwhile are held in a queue.
  //   resume → every open due date (and not-yet-open review date) moves forward by the days paused, escalation
  //            is reset, queued new joiners are started (due dates counted from today).
  async ld_setPause(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res, 'Only HR / L&D administrators can pause or resume induction training');
    const cur = await get('LdConfig', 'ld-config');
    if (!cur) return fail(res, 'L&D is not initialised yet');
    const want = !!p.paused;
    if (want === !!cur.paused) return ok(res, { paused: pausedInfo(await getConfig()), unchanged: true });
    const today = todayIST();
    if (want) {
      cur.paused = true; cur.paused_at = nowIso(); cur.paused_by = ctx.id; cur.pause_reason = clean(p.reason, 500);
      await save('LdConfig', cur);
      await audit('LdConfig', 'ld-config', 'induction_paused', ctx.id, { reason: cur.pause_reason });
      const active = (await list('LdInduction')).filter(i => i.status === 'IN_PROGRESS');
      await notify([...new Set([...active.map(i => i.user_id), ...active.map(i => i.employee.reporting_manager_id)])], { title: 'Induction training paused', message: `HR has paused induction training${cur.pause_reason ? ': ' + cur.pause_reason : ''}. Due dates will move forward when it resumes.`, type: 'info', link: '/MyLearning' });
      return ok(res, { paused: pausedInfo(await getConfig()) });
    }
    const days = Math.max(0, daysBetween(String(cur.paused_at).slice(0, 10), today));
    let shifted = 0;
    const queued = [...(cur.queued_user_ids || [])];
    cur.paused = false; cur.paused_at = null; cur.paused_by = null; cur.pause_reason = ''; cur.queued_user_ids = [];
    cur.last_resumed_at = nowIso(); cur.last_pause_days = days;
    await save('LdConfig', cur);
    // move the clock for everyone who was mid-induction
    for (const row of (await list('LdInduction')).filter(i => i.status === 'IN_PROGRESS')) {
      await withLock('ind:' + row.id, async () => {
        const ind = await loadInduction(row.id);
        if (!ind || ind.status !== 'IN_PROGRESS') return;
        if (ind.pause_exempt) { ind.pause_exempt = false; await save('LdInduction', ind); return; } // kept running during the pause — no shift
        for (const g of ind.gates) {
          if (TERMINAL.has(g.status)) continue;
          if (days > 0) {
            g.due_date = addDays(g.due_date, days);
            if (g.status === 'LOCKED' && g.available_from > '2000-01-01') g.available_from = addDays(g.available_from, days);
          }
          g.escalation_level = 0; g.reminded = {};
          if (g.status === 'OVERDUE' && g.due_date >= today) setStatus(g, g.status_before_overdue || 'READY', ctx.id, 'resumed — due date moved');
        }
        ind.paused_days_total = (ind.paused_days_total || 0) + days;
        await afterChange(ind, ctx.id);
        await save('LdInduction', ind);
        await audit('LdInduction', ind.id, 'induction_resumed_shift', ctx.id, { days }, ind.user_id);
        await notify(ind.user_id, { title: 'Induction training resumed', message: days > 0 ? `Your induction due dates have moved forward by ${days} day(s).` : 'Your induction can continue.', type: 'info', link: '/MyLearning' });
        shifted++;
      });
    }
    // start the inductions that were held back
    let started = 0;
    for (const uid of queued) {
      try { await createInduction(uid, { actorId: ctx.id, anchor_override: today }); started++; } catch (e) { console.warn('[ld] queued start failed:', e.message); }
    }
    await audit('LdConfig', 'ld-config', 'induction_resumed', ctx.id, { days, shifted, started });
    return ok(res, { paused: null, days, shifted, started });
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

  async ld_previewWave(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const { user_ids, ...rest } = await resolveWave(p.wave || {});
    void user_ids;
    return ok(res, rest);
  },

  // Which questions are too hard / too easy, and which topic blocks are weak in which department.
  async ld_getQuestionAnalytics(p, ctx, res) {
    if (!ctx.isLdAdmin && !ctx.isTrainer) return forbid(res);
    const emps = Object.fromEntries((await list('Employee')).map(e => [e.user_id, e]));
    const assessments = await list('LdAssessment');
    const keyOf = (id) => assessments.find(a => a.id === id)?.key || id;
    const stats = {}, deptTopic = {};
    let n = 0, sum = 0;
    for (const att of (await list('LdAttempt')).filter(a => a.status === 'SUBMITTED' && Array.isArray(a.results))) {
      const key = att.assessment_key || keyOf(att.assessment_id);
      if (p.key && key !== p.key) continue;
      n++; sum += att.score || 0;
      const dept = emps[att.user_id]?.department || 'Unassigned';
      for (const r of att.results) {
        const s = (stats[key + '|' + r.id] ||= { key, id: r.id, served: 0, correct: 0 });
        s.served++; if (r.correct) s.correct++;
        const t = (deptTopic[dept + '|' + (r.topic || 'General')] ||= { department: dept, topic: r.topic || 'General', served: 0, correct: 0 });
        t.served++; if (r.correct) t.correct++;
      }
    }
    const latest = (key) => assessments.filter(a => a.key === key).sort((a, b) => b.version - a.version)[0];
    const questions = Object.values(stats).map(s => {
      const q = latest(s.key)?.questions.find(x => x.id === s.id);
      const pctRight = pct(s.correct, s.served);
      return { ...s, assessment_id: latest(s.key)?.id, title: latest(s.key)?.title || s.key, text: q?.text || '(question removed)', topic: q?.topic || '', critical: !!q?.critical, correct_pct: pctRight, flag: s.served >= 5 && pctRight < 40 ? 'hard' : s.served >= 10 && pctRight > 95 ? 'easy' : '' };
    }).sort((a, b) => a.correct_pct - b.correct_pct);
    const weak = Object.values(deptTopic).filter(t => t.served >= 5).map(t => ({ ...t, correct_pct: pct(t.correct, t.served) })).sort((a, b) => a.correct_pct - b.correct_pct);
    return ok(res, { attempts: n, avg_score: n ? Math.round(sum / n * 10) / 10 : null, questions: questions.slice(0, 300), weak_topics: weak.slice(0, 60) });
  },

  // Correction workflow for a wrong answer key: fix the key, then re-score every submitted attempt that served it.
  // People who now pass are promoted; nobody is demoted automatically (those are only counted and logged).
  async ld_fixAnswerKey(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const a = await get('LdAssessment', p.assessment_id);
    const q = a?.questions.find(x => x.id === p.question_id);
    if (!a || !q) return fail(res, 'Question not found', 404);
    if (clean(p.reason).length < 5) return fail(res, 'Please give the reason for the correction');
    const before = { correct: q.correct, accepted: q.accepted };
    if (Array.isArray(p.correct)) q.correct = p.correct.map(Number).filter(n => n >= 0 && n < (q.options || []).length);
    if (Array.isArray(p.accepted)) q.accepted = p.accepted.map(x => clean(x, 200)).filter(Boolean);
    if (q.type === 'short' ? !(q.accepted || []).length : !q.correct.length) return fail(res, 'A correct answer is required');
    await save('LdAssessment', a);
    await audit('LdAssessment', a.id, 'answer_key_corrected', ctx.id, { question: q.id, before, after: { correct: q.correct, accepted: q.accepted }, reason: clean(p.reason, 500) });
    let rescored = 0, promoted = 0, demoted = 0;
    for (const att of (await list('LdAttempt')).filter(x => x.assessment_id === a.id && x.status === 'SUBMITTED' && (x.order || []).includes(q.id))) {
      const need = att.pass_score ?? a.pass_score;
      const gr = gradeAttempt(a.questions, att.order, att.answers || {}, { passScore: need, criticalRule: ctx.cfg.critical_rule !== false });
      if (gr.score === att.score && gr.passed === att.passed) continue;
      if (att.passed && !gr.passed) { demoted++; continue; }
      Object.assign(att, { score: gr.score, passed: gr.passed, results: gr.results, gaps: gr.gaps, weak_topics: gr.weakTopics, critical_failed: gr.criticalFailed, rescored_at: nowIso(), rescored_reason: clean(p.reason, 300) });
      await save('LdAttempt', att); rescored++;
      if (att.induction_id) {
        await withLock('ind:' + att.induction_id, async () => {
          const ind = await loadInduction(att.induction_id); const g = ind?.gates.find(x => x.gate_id === att.gate_id);
          const e = g?.attempts.find(x => x.attempt_id === att.id);
          if (e) { e.score = gr.score; e.passed = gr.passed; e.gaps = gr.gaps; }
          if (g && gr.passed && ['FAILED', 'IN_PROGRESS', 'READY', 'OVERDUE'].includes(g.status)) {
            setStatus(g, 'PASSED', ctx.id, 're-scored after answer-key correction'); g.completed_at = nowIso(); g.last_score = gr.score; g.needs_relearn = false; promoted++;
            await notify(ind.user_id, { title: 'Assessment re-scored — passed', message: `"${g.name}" was re-scored after an answer-key correction: ${gr.score}%. You can continue.`, type: 'success', link: '/MyLearning' });
          }
          if (ind) { await afterChange(ind, ctx.id); await save('LdInduction', ind); }
        });
      } else if (gr.passed && att.assignment_id) { await completeAssignment(att.assignment_id, ctx.id, gr.score); promoted++; }
    }
    return ok(res, { rescored, promoted, demoted });
  },

  // One-click application of the pass-mark policy (default 90%): configuration, every induction assessment,
  // the workflow template and the not-yet-passed assessment steps of running inductions. `dry_run` only reports.
  async ld_applyPolicy(p, ctx, res) {
    if (!ctx.isAdmin && !ctx.isHR) return forbid(res, 'Only HR / admin can apply the pass-mark policy');
    const target = Math.min(100, Math.max(1, Number(p.pass_score) || 90));
    const maxA = Math.max(1, Number(p.max_attempts) || 3);
    const spq = Math.max(10, Number(p.seconds_per_question) || 60);
    const tpl = (await list('LdTemplate')).filter(t => t.status === 'active').sort((a, b) => b.version - a.version)[0];
    if (!tpl) return fail(res, 'No active induction template');
    const keys = new Set(tpl.gates.filter(g => g.completion === 'assessment').map(g => g.assessment_key));
    const plan = { pass_score: target, max_attempts: maxA, assessments: [], template: false, open_gates: 0, config: false };
    const assessments = (await list('LdAssessment')).filter(a => a.status !== 'archived' && keys.has(a.key));
    for (const a of assessments) {
      const tl = p.apply_time_limit === false ? a.time_limit_min : Math.ceil((a.questions_per_attempt || a.questions.length) * spq / 60);
      const ch = []; if (a.pass_score !== target) ch.push(`pass ${a.pass_score}% → ${target}%`); if (a.max_attempts !== maxA) ch.push(`attempts ${a.max_attempts} → ${maxA}`); if (a.time_limit_min !== tl) ch.push(`time limit ${a.time_limit_min || 'none'} → ${tl} min`);
      if (ch.length) plan.assessments.push({ id: a.id, title: a.title, changes: ch, tl });
    }
    plan.template = tpl.gates.some(g => g.completion === 'assessment' && (g.pass_score !== target || g.max_attempts !== maxA));
    const open = (await list('LdInduction')).filter(i => i.status === 'IN_PROGRESS');
    const openGates = open.filter(i => i.gates.some(g => g.completion === 'assessment' && !TERMINAL.has(g.status) && (g.pass_score !== target || g.max_attempts !== maxA)));
    plan.open_gates = openGates.length;
    const curCfg = await get('LdConfig', 'ld-config');
    plan.config = !curCfg || curCfg.induction_pass_score !== target || curCfg.max_attempts !== maxA || curCfg.critical_rule !== (p.critical_rule !== false) || curCfg.require_relearn !== (p.require_relearn !== false) || (curCfg.seconds_per_question || 60) !== spq;
    if (p.dry_run) return ok(res, { dry_run: true, plan });
    if (curCfg) { Object.assign(curCfg, { induction_pass_score: target, max_attempts: maxA, critical_rule: p.critical_rule !== false, require_relearn: p.require_relearn !== false, seconds_per_question: spq }); await save('LdConfig', curCfg); }
    for (const x of plan.assessments) {
      const a = await get('LdAssessment', x.id);
      Object.assign(a, { pass_score: target, max_attempts: maxA, time_limit_min: x.tl, description: String(a.description || '').replace(/Pass mark \d+%/, `Pass mark ${target}%`) });
      await save('LdAssessment', a);
      await audit('LdAssessment', a.id, 'policy_applied', ctx.id, { changes: x.changes });
    }
    if (plan.template) {
      const t = clone(tpl); delete t.id; delete t.created_at; delete t.updated_at;
      for (const g of t.gates) if (g.completion === 'assessment') { g.pass_score = target; g.max_attempts = maxA; g.description = String(g.description || '').replace(/Pass mark \d+%/, `Pass mark ${target}%`); }
      tpl.status = 'superseded'; await save('LdTemplate', tpl);
      const nt = await create('LdTemplate', { ...t, version: (tpl.version || 0) + 1, status: 'active', previous_version: tpl.version || null, changed_by: ctx.id });
      await audit('LdTemplate', nt.id, 'template_new_version', ctx.id, { version: nt.version, reason: `pass mark ${target}%, ${maxA} attempts` });
    }
    for (const row of openGates) {
      await withLock('ind:' + row.id, async () => {
        const ind = await loadInduction(row.id); if (!ind) return;
        for (const g of ind.gates) if (g.completion === 'assessment' && !TERMINAL.has(g.status)) { g.pass_score = target; g.max_attempts = maxA; g.description = String(g.description || '').replace(/Pass mark \d+%/, `Pass mark ${target}%`); }
        await save('LdInduction', ind);
        await audit('LdInduction', ind.id, 'policy_applied', ctx.id, { pass_score: target, max_attempts: maxA }, ind.user_id);
      });
    }
    await audit('LdConfig', 'ld-config', 'policy_applied', ctx.id, { pass_score: target, max_attempts: maxA, assessments: plan.assessments.length, template: plan.template, open_inductions: plan.open_gates });
    return ok(res, { plan });
  },

  // Live "are we ready to run the induction?" checklist: what is blocking people, what is missing, what is fine.
  async ld_getReadiness(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const cfg = ctx.cfg;
    const today = todayIST();
    const inds = await list('LdInduction');
    const open = inds.filter(i => i.status === 'IN_PROGRESS');
    const emps = await list('Employee');
    const active = emps.filter(e => e.user_id && e.status === 'active');
    const trainers = (await list('LdTrainer')).filter(t => t.active !== false);
    const depts = await list('Department');
    const tpl = (await list('LdTemplate')).filter(t => t.status === 'active').sort((a, b) => (b.version || 0) - (a.version || 0))[0];
    const keys = new Set((tpl?.gates || []).filter(g => g.completion === 'assessment').map(g => g.assessment_key));
    const assessments = (await list('LdAssessment')).filter(a => a.status !== 'archived' && keys.has(a.key));
    const checks = [];
    const add = (key, status, title, detail, action = null) => checks.push({ key, status, title, detail, action });

    if (cfg.paused) {
      const days = Math.max(0, daysBetween(String(cfg.paused_at).slice(0, 10), today));
      add('paused', 'fail', 'Induction training is paused', `Paused ${days} day(s) ago${cfg.pause_reason ? ` (${cfg.pause_reason})` : ''}. ${open.filter(i => !i.pause_exempt).length} running induction(s) are frozen and ${(cfg.queued_user_ids || []).length} new joiner(s) are waiting. Resume from the bar at the top when you are ready — due dates move forward by the days paused.`);
    } else add('paused', 'ok', 'Induction training is running', 'Nothing is paused.');

    const policyOk = cfg.induction_pass_score >= 90 && cfg.critical_rule !== false && cfg.require_relearn !== false && assessments.every(a => a.pass_score >= 90) && (tpl?.gates || []).filter(g => g.completion === 'assessment').every(g => g.pass_score >= 90);
    add('policy', policyOk ? 'ok' : 'warn', 'Knowledge gate policy', policyOk ? `${cfg.induction_pass_score}% pass mark, ${cfg.max_attempts} attempts, critical-question rule and re-learn rule are on, in settings, assessments and the workflow.` : 'The pass mark, critical-question rule or re-learn rule is not at the recommended policy everywhere. Preview and apply it in Settings.', policyOk ? null : { type: 'tab', tab: 'settings', label: 'Open Settings' });

    add('trainers', trainers.length ? 'ok' : 'fail', 'Trainers', trainers.length ? `${trainers.length} active trainer(s) registered.` : 'No trainer is registered. Sign-offs for the learning, policy, practical and capability steps need a trainer (or HR). Register trainers, then assign them to the running inductions.', trainers.length ? null : { type: 'tab', tab: 'trainers', label: 'Add trainers' });
    add('ld_admins', cfg.ld_admin_user_ids.length ? 'ok' : 'warn', 'L&D administrators', cfg.ld_admin_user_ids.length ? `${cfg.ld_admin_user_ids.length} named L&D administrator(s).` : 'No L&D administrator is named, so the last escalation level goes to HR. Name one or more in Settings if someone besides HR should own this.', cfg.ld_admin_user_ids.length ? null : { type: 'tab', tab: 'settings', label: 'Open Settings' });

    const hasOpening = !!tpl?.gates?.some(g => g.gate_id === 'W1');
    add('opening', hasOpening ? 'ok' : 'warn', 'Website, policy and org-chart steps', hasOpening ? 'Every induction starts with the 10-minute website tour, the HR policies (read and sign one by one) and the department org chart.' : 'Not part of the induction yet. Publish them so every new joiner starts with the website tour, policy acknowledgements and the department org chart.', hasOpening ? null : { type: 'publish_opening', label: 'Publish these steps' });
    if (hasOpening) {
      const allPols = await list('CompanyPolicy');
      const pols = inductionPolicies(allPols);
      const nonPdf = allPols.filter(x => x.is_active !== false && x.induction_required !== false && x.file_url && !isPdfUrl(x.file_url));
      add('policies', pols.length ? (nonPdf.length ? 'warn' : 'ok') : 'fail', 'HR policies for the induction', pols.length ? `${pols.length} policies, in this order: ${pols.map(x => x.title).join(' → ')}.${nonPdf.length ? ` Not included because they are not PDF files (save them as PDF and upload again): ${nonPdf.map(x => x.title).join(', ')}.` : ''}` : 'No active PDF policy is set for the induction, so new joiners cannot pass the policy step. Upload the policies (PDF) in Company Policies.', pols.length ? null : { type: 'link', page: 'CompanyPolicies', label: 'Open Company Policies' });
    }
    const noHod = open.filter(i => !i.hod_user_id);
    const deptsNoHead = depts.filter(d => !d.head_user_id).map(d => d.name);
    const fillableHod = noHod.filter(i => depts.some(d => d.head_user_id && String(d.name).toLowerCase() === String(i.employee.department || '').toLowerCase())).length;
    add('hods', noHod.length ? 'warn' : 'ok', 'Department heads (HOD)', noHod.length ? `${noHod.length} running induction(s) have no HOD, so the department-induction step (G06) can only be signed by HR / L&D.${fillableHod ? ` ${fillableHod} can be filled from the department heads already set.` : ''}${deptsNoHead.length ? ` Departments without a head: ${deptsNoHead.slice(0, 8).join(', ')}${deptsNoHead.length > 8 ? '…' : ''}.` : ''}` : 'Every running induction has a HOD.', noHod.length ? (fillableHod ? { type: 'auto_hod', label: `Fill ${fillableHod} HOD(s) from departments` } : { type: 'suggest', label: 'Suggest HODs' }) : null);

    const noBuddy = open.filter(i => !i.buddy_user_id);
    const g0Blocked = noBuddy.filter(i => !OKAY(i.gates.find(g => g.gate_id === 'G00')?.status)).length;
    add('buddies', noBuddy.length ? 'fail' : 'ok', 'Buddies', noBuddy.length ? `${noBuddy.length} running induction(s) have no buddy.${g0Blocked ? ` ${g0Blocked} of them are stuck at step G00 “Pre-joining readiness” because “Buddy assigned” cannot complete.` : ''} A buddy is a peer — not the new joiner or the Reporting Manager.` : 'Every running induction has a buddy.', noBuddy.length ? { type: 'suggest', label: 'Suggest buddies' } : null);
    const noTrainer = open.filter(i => !i.trainer_user_id).length;
    if (noTrainer) add('trainer_assign', trainers.length ? 'warn' : 'fail', 'Trainer on running inductions', `${noTrainer} running induction(s) have no trainer assigned.`, trainers.length ? { type: 'bulk', label: 'Assign people' } : null);

    const topics = cfg.topics || [];
    for (const a of assessments) {
      const counts = Object.fromEntries(topics.map(t => [t.key, a.questions.filter(q => (q.topic || '') === t.key).length]));
      const short = topics.filter(t => counts[t.key] < t.min);
      const per = a.questions_per_attempt || a.questions.length;
      const poolOk = a.questions.length >= per * 3;
      add('bank_' + a.key, short.length || !poolOk ? 'warn' : 'ok', `Question bank — ${a.title}`, `${a.questions.length} questions (${a.questions.filter(q => q.critical).length} critical), ${per} per attempt.${!poolOk ? ` Aim for a pool of at least ${per * 3} so a retake is a different test.` : ''}${short.length ? ` Below the minimum: ${short.map(t => `${t.key} ${counts[t.key]}/${t.min}`).join(', ')}.` : ' Every block meets its minimum.'}`, short.length || !poolOk ? { type: 'tab', tab: 'assessments', label: 'Open question banks' } : null);
    }
    if (!assessments.length) add('bank', 'fail', 'Question bank', 'No assessment is linked to the induction workflow.', { type: 'tab', tab: 'assessments', label: 'Open question banks' });

    const rec = DEFAULT_CONFIG.escalation_days, cur = cfg.escalation_days;
    const escOk = ['employee', 'manager', 'hod', 'hr', 'ld'].every(k => Number(cur[k]) === Number(rec[k]));
    add('escalation', escOk ? 'ok' : 'warn', 'Escalation days', escOk ? 'Employee 0 → Manager 2 → HOD 4 → HR 6 → L&D 8 days overdue (as in the plan).' : `Currently employee ${cur.employee}, manager ${cur.manager}, HOD ${cur.hod}, HR ${cur.hr}, L&D ${cur.ld} days; the plan recommends 0 / 2 / 4 / 6 / 8.`, escOk ? null : { type: 'tab', tab: 'settings', label: 'Open Settings' });

    const withInd = new Set(inds.filter(i => i.status !== 'CANCELLED').map(i => i.user_id));
    const missing = active.filter(e => !withInd.has(e.user_id)).length;
    add('coverage', 'info', 'Coverage', `${withInd.size} of ${active.length} active employees have an induction; ${missing} do not. Start the rest in waves from New joiners → Start induction → “A wave”.`, { type: 'tab', tab: 'joiners', label: 'Open New joiners' });
    const overdue = open.filter(i => i.gates.some(g => g.status === 'OVERDUE')).length;
    if (overdue) add('overdue', 'info', 'Overdue inductions', `${overdue} running induction(s) have overdue steps${cfg.paused ? ' (they are frozen while paused; due dates shift forward on resume)' : ''}.`);

    const blockers = checks.filter(c => c.status === 'fail').length, warnings = checks.filter(c => c.status === 'warn').length;
    return ok(res, { ready: blockers === 0, blockers, warnings, checks, running: open.length });
  },

  // Set trainer / HOD / HR SPOC / buddy on many running inductions at once.
  async ld_bulkAssignPeople(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const all_ = (await list('LdInduction')).filter(i => i.status === 'IN_PROGRESS');
    const want = p.scope === 'all_open' ? all_ : all_.filter(i => (p.induction_ids || []).includes(i.id));
    if (!want.length) return fail(res, 'No running inductions selected');
    if (!['trainer_user_id', 'hr_spoc_user_id', 'buddy_user_id', 'hod_user_id'].some(k => p[k]) && !p.hod_from_department) return fail(res, 'Choose at least one person to assign');
    const onlyMissing = p.only_missing !== false;
    const depts = await list('Department');
    const frozen = !!ctx.cfg.paused;
    let updated = 0; const skipped = [];
    for (const row of want) {
      await withLock('ind:' + row.id, async () => {
        const ind = await loadInduction(row.id);
        if (!ind || ind.status !== 'IN_PROGRESS') return;
        const set = {};
        if (p.trainer_user_id && (!onlyMissing || !ind.trainer_user_id)) { ind.trainer_user_id = p.trainer_user_id; ind.trainer_name = await nameOf(p.trainer_user_id); set.trainer = ind.trainer_name; }
        if (p.hr_spoc_user_id && (!onlyMissing || !ind.hr_spoc_user_id)) { ind.hr_spoc_user_id = p.hr_spoc_user_id; set.hr_spoc = await nameOf(p.hr_spoc_user_id); }
        if (p.hod_user_id && (!onlyMissing || !ind.hod_user_id) && p.hod_user_id !== ind.user_id) { ind.hod_user_id = p.hod_user_id; ind.hod_name = await nameOf(p.hod_user_id); set.hod = ind.hod_name; }
        if (p.hod_from_department && (!onlyMissing || !ind.hod_user_id)) {
          const d = depts.find(x => x.head_user_id && String(x.name).toLowerCase() === String(ind.employee.department || '').toLowerCase());
          if (d && d.head_user_id !== ind.user_id) { ind.hod_user_id = d.head_user_id; ind.hod_name = await nameOf(d.head_user_id); set.hod = ind.hod_name; }
        }
        if (p.buddy_user_id && (!onlyMissing || !ind.buddy_user_id)) {
          if (p.buddy_user_id === ind.user_id || p.buddy_user_id === ind.employee.reporting_manager_id) skipped.push(`${ind.employee.name}: the buddy must be a peer — not the new joiner or the Reporting Manager`);
          else { ind.buddy_user_id = p.buddy_user_id; ind.buddy_name = await nameOf(p.buddy_user_id); set.buddy = ind.buddy_name; await notify(p.buddy_user_id, { title: "You're a buddy", message: `You are ${ind.employee.name}'s buddy. Help them settle in — check in regularly.`, link: '/MyLearning' }); }
        }
        if (!Object.keys(set).length) return;
        if (!frozen || ind.pause_exempt) { await runAutoChecks(ind); await afterChange(ind, ctx.id); }   // while paused nothing unlocks
        await save('LdInduction', ind);
        await audit('LdInduction', ind.id, 'people_assigned', ctx.id, { ...set, bulk: true }, ind.user_id);
        updated++;
      });
    }
    return ok(res, { updated, selected: want.length, skipped: skipped.slice(0, 20) });
  },

  // Proposal only (writes nothing): who could be buddy / HOD for the running inductions that have none, and who could be trainer.
  // Buddy = a settled colleague (>= 6 months) in the joiner's department, never the joiner or their Reporting Manager, not
  // someone who is themselves in an induction, at most 3 buddies each, closest in level, same location preferred.
  async ld_suggestAssignments(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const today = todayIST();
    const allInds = await list('LdInduction');
    const inds = allInds.filter(i => i.status === 'IN_PROGRESS').sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
    const emps = (await list('Employee')).filter(e => e.user_id && e.status === 'active' && !(e.last_working_date && String(e.last_working_date).slice(0, 10) < today) && !(e.exit_date && String(e.exit_date).slice(0, 10) < today));
    const byUid = Object.fromEntries(emps.map(e => [e.user_id, e]));
    const inInduction = new Set(inds.map(i => i.user_id));
    const depts = await list('Department');
    const tenure = (e) => (e.date_of_joining ? daysBetween(String(e.date_of_joining).slice(0, 10), today) : 0);
    const tierOf = (e) => Number(e.designation_tier) || 0;
    const load = {}; for (const i of inds) if (i.buddy_user_id) load[i.buddy_user_id] = (load[i.buddy_user_id] || 0) + 1;
    const CAP = 3;
    const mgrWord = /head|hod|general manager|\bgm\b|director|vice president|\bvp\b|manager|lead/i;
    const brief = (e) => ({ user_id: e.user_id, name: e.display_name || e.full_name || '', code: e.employee_code || '', designation: e.designation || '', department: e.department || '' });
    const rows = [];
    for (const ind of inds) {
      const needBuddy = !ind.buddy_user_id, needHod = !ind.hod_user_id;
      if (!needBuddy && !needHod) continue;
      const emp = ind.employee || {}, dept = String(emp.department || '').toLowerCase(), joiner = byUid[ind.user_id];
      const row = { induction_id: ind.id, joiner: emp.name || '', department: emp.department || 'Unassigned', current: { buddy: ind.buddy_name || '', hod: ind.hod_name || '', trainer: ind.trainer_name || '' }, buddy: null, hod: null };
      if (needBuddy) {
        const ok_ = (c, sameDept) => c.user_id !== ind.user_id && c.user_id !== emp.reporting_manager_id && !inInduction.has(c.user_id) && tenure(c) >= 180 && (load[c.user_id] || 0) < CAP && (sameDept ? String(c.department || '').toLowerCase() === dept : String(c.department || '').toLowerCase() !== dept);
        let pool = emps.filter(c => ok_(c, true)), cross = false;
        if (!pool.length) { pool = emps.filter(c => ok_(c, false) && joiner && c.work_location && c.work_location === joiner.work_location); cross = true; }
        pool.sort((a, b) => ((load[a.user_id] || 0) * 10 + Math.abs(tierOf(a) - tierOf(joiner || {})) * 2 + (joiner && a.work_location === joiner.work_location ? 0 : 1) - Math.min(tenure(a), 1500) / 1500) - ((load[b.user_id] || 0) * 10 + Math.abs(tierOf(b) - tierOf(joiner || {})) * 2 + (joiner && b.work_location === joiner.work_location ? 0 : 1) - Math.min(tenure(b), 1500) / 1500));
        const c = pool[0];
        if (c) { load[c.user_id] = (load[c.user_id] || 0) + 1; row.buddy = { ...brief(c), reason: `${cross ? 'No eligible colleague in the department — same-location colleague from another department' : 'Same department'}, ${Math.floor(tenure(c) / 30)} months in the company, buddy to ${load[c.user_id]} joiner(s)` }; }
      }
      if (needHod) {
        const d = depts.find(x => x.head_user_id && String(x.name).toLowerCase() === dept);
        if (d && byUid[d.head_user_id] && d.head_user_id !== ind.user_id) row.hod = { ...brief(byUid[d.head_user_id]), reason: 'Department head set in Departments', inferred: false };
        else {
          const c = emps.filter(x => x.user_id !== ind.user_id && String(x.department || '').toLowerCase() === dept && mgrWord.test(x.designation || '')).sort((a, b) => tierOf(b) - tierOf(a) || tenure(b) - tenure(a))[0];
          if (c) row.hod = { ...brief(c), reason: `Most senior in the department by designation (“${c.designation}”) — no department head is set; please confirm`, inferred: true };
        }
      }
      rows.push(row);
    }
    const trainers = (await list('LdTrainer')).filter(t => t.active !== false);
    const hodIds = new Set(rows.map(r => r.hod?.user_id).filter(Boolean));
    const cand = new Map();
    for (const e of emps) if (/^hr$/i.test(String(e.department || '').trim()) || (ctx.cfg.ld_admin_user_ids || []).includes(e.user_id)) cand.set(e.user_id, { ...brief(e), reason: /^hr$/i.test(String(e.department || '').trim()) ? 'HR team' : 'L&D administrator' });
    for (const id of hodIds) if (byUid[id] && !cand.has(id)) cand.set(id, { ...brief(byUid[id]), reason: 'Suggested department head' });
    return ok(res, { rows, summary: { inductions: inds.length, needBuddy: inds.filter(i => !i.buddy_user_id).length, needHod: inds.filter(i => !i.hod_user_id).length, needTrainer: inds.filter(i => !i.trainer_user_id).length, buddiesProposed: rows.filter(r => r.buddy).length, hodsProposed: rows.filter(r => r.hod).length }, trainers: { registered: trainers.length, candidates: [...cand.values()].slice(0, 20) } });
  },

  // Apply a reviewed proposal: rows = [{ induction_id, buddy_user_id?, hod_user_id? }] (+ optional trainer for every induction without one).
  // Goes through the same checks as the bulk assignment (buddy is never the joiner or the Reporting Manager).
  async ld_applyAssignments(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, 300);
    if (!rows.length && !p.trainer_user_id) return fail(res, 'Nothing to apply');
    const cap = () => { const o = { body: null, status() { return o; }, json(b) { o.body = b; return o; } }; return o; };
    if (p.trainer_user_id) {
      const t = (await list('LdTrainer')).find(x => x.user_id === p.trainer_user_id);
      if (!t || t.active === false) { const r = cap(); await HANDLERS.ld_saveTrainer({ user_id: p.trainer_user_id, active: true }, ctx, r); if (!r.body?.success) return fail(res, r.body?.error || 'Could not register the trainer'); }
    }
    let updated = 0; const skipped = [];
    for (const r of rows) {
      if (!r.induction_id || (!r.buddy_user_id && !r.hod_user_id)) continue;
      const c = cap();
      await HANDLERS.ld_bulkAssignPeople({ induction_ids: [r.induction_id], buddy_user_id: r.buddy_user_id || undefined, hod_user_id: r.hod_user_id || undefined, only_missing: true }, ctx, c);
      if (c.body?.success) { updated += c.body.updated || 0; skipped.push(...(c.body.skipped || [])); } else skipped.push(c.body?.error || 'Could not update one induction');
    }
    let trainerSet = 0;
    if (p.trainer_user_id) { const c = cap(); await HANDLERS.ld_bulkAssignPeople({ scope: 'all_open', trainer_user_id: p.trainer_user_id, only_missing: true }, ctx, c); trainerSet = c.body?.updated || 0; }
    return ok(res, { updated, trainerSet, skipped: skipped.slice(0, 20) });
  },

  // ───────────────────────── opening steps ─────────────────────────
  // Heartbeat from the website tour / org chart / policy reader. Adds the REAL visible time since the last beat.
  async ld_trackTime(p, ctx, res) {
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
    return withLock('ind:' + p.induction_id, async () => {
      const ind = await loadInduction(p.induction_id);
      if (!ind) return fail(res, 'Induction not found', 404);
      if (ctx.id !== ind.user_id) return forbid(res, 'Only the employee can do this step');
      const g = ind.gates.find(x => x.gate_id === p.gate_id);
      const t = g?.tasks.find(x => x.id === p.task_id);
      if (!g || !t || !['timed', 'org_view', 'policy_ack'].includes(t.type)) return fail(res, 'Step not found', 404);
      const info = (extra = {}) => ({ seconds: Math.round(t.watch?.sec || 0), target: t.target_seconds || t.min_read_seconds || 0, done: !!t.done, ...extra });
      if (t.done) return ok(res, info());
      if (!gateActive(g)) return fail(res, 'This step is not open yet');
      if (t.type === 'policy_ack') { t.target_seconds = t.min_read_seconds; if (policyStates(g.tasks).find(x => x.id === t.id)?.state !== 'open') return fail(res, 'Sign the previous policy first'); }
      const r = addWatchTime(t, Date.now(), !!p.visible);
      if (g.status === 'READY' && r.seconds > 0) setStatus(g, 'IN_PROGRESS', 'system');
      if (t.type !== 'policy_ack' && r.done) {
        t.done = true; t.done_at = nowIso(); t.done_by = ctx.id;
        await audit('LdInduction', ind.id, 'task_completed', ctx.id, { gate: g.gate_id, task: t.id, title: t.title, seconds: Math.round(r.seconds) }, ind.user_id);
        evaluateGate(ind, g);
        await afterChange(ind, ctx.id);
      }
      await save('LdInduction', ind);
      return ok(res, info({ gate_status: g.status }));
    });
  },

  // The policy step as the employee sees it: ordered policies, only the next one open.
  async ld_getPolicyGate(p, ctx, res) {
    let ind = await loadInduction(p.induction_id);
    if (!ind) return fail(res, 'Induction not found', 404);
    if (!canView(ctx, ind)) return forbid(res);
    const frozen = !!ctx.cfg.paused && !ind.pause_exempt;
    if (ctx.id === ind.user_id && !frozen) await withLock('ind:' + ind.id, async () => { const fresh = await loadInduction(ind.id); if (await syncPolicyGate(fresh)) await save('LdInduction', fresh); ind = fresh; });
    const g = ind.gates.find(x => x.gate_id === 'P1');
    if (!g) return fail(res, 'This induction has no policy step');
    const tasks = policyStates(g.tasks).map(x => ({ id: x.id, title: x.title, category: x.category, file_url: x.file_url, min_read_seconds: x.min_read_seconds, state: x.state, seconds: Math.round(x.watch?.sec || 0), done_at: x.done_at, ack_id: x.ack_id || null }));
    return ok(res, { paused: frozen ? pausedInfo(ctx.cfg) : null, gate: { gate_id: g.gate_id, name: g.name, status: g.status, due_date: g.due_date, description: g.description }, tasks, statement: ACK_STATEMENT, employee_name: ind.employee.name, is_self: ctx.id === ind.user_id, locked: !gateActive(g) && !TERMINAL.has(g.status) });
  },

  // Sign one policy: after the minimum reading time, with the employee's own name typed as the signature. Stored permanently.
  async ld_acknowledgePolicy(p, ctx, res) {
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
    return withLock('ind:' + p.induction_id, async () => {
      const ind = await loadInduction(p.induction_id);
      if (!ind) return fail(res, 'Induction not found', 404);
      if (ctx.id !== ind.user_id) return forbid(res, 'Only the employee can sign');
      const g = ind.gates.find(x => x.gate_id === 'P1');
      const t = g?.tasks.find(x => x.id === p.task_id && x.type === 'policy_ack');
      if (!g || !t) return fail(res, 'Policy not found', 404);
      if (t.done) return fail(res, 'You have already signed this policy');
      if (!gateActive(g)) return fail(res, 'This step is not open yet');
      if (policyStates(g.tasks).find(x => x.id === t.id)?.state !== 'open') return fail(res, 'Sign the previous policy first');
      if (p.accept !== true) return fail(res, 'Please tick the acknowledgement');
      const need = t.min_read_seconds || 0;
      if ((t.watch?.sec || 0) < need) return fail(res, `Please keep the policy open and read it — ${Math.max(1, Math.ceil(need - (t.watch?.sec || 0)))} more second(s) needed before you can sign`);
      const emp = await getEmployee(ctx.id);
      if (!namesMatch(p.typed_name, emp?.display_name) && !namesMatch(p.typed_name, emp?.full_name)) return fail(res, 'Type your own full name exactly as it appears in Maxvolt One to sign');
      const policy = await get('CompanyPolicy', t.policy_id);
      const rec = {
        employee_user_id: ctx.id, employee_name: emp.display_name || emp.full_name || ind.employee.name, employee_code: emp.employee_code || ind.employee.code, department: emp.department || ind.employee.department, designation: emp.designation || ind.employee.designation,
        induction_id: ind.id, task_id: t.id, policy_id: t.policy_id, policy_title: policy?.title || t.title, policy_category: policy?.category || t.category || '', policy_version: t.version || policy?.updated_at || '', policy_file_url: t.file_url,
        policy_file_sha256: await fileHash(t.file_url), statement: ACK_STATEMENT, typed_name: clean(p.typed_name, 120), signed_at: nowIso(), read_seconds: Math.round(t.watch?.sec || 0), ip: ipOf(res), user_agent: clean(res.req?.headers?.['user-agent'], 200), status: 'SIGNED',
      };
      rec.record_sha256 = sha256(JSON.stringify(rec));
      // stored WITHOUT the user link (and under employee_user_id) so deleting or purging a user account never removes the signed record
      const doc = await create('LdPolicyAck', rec, null);
      t.done = true; t.done_at = rec.signed_at; t.done_by = ctx.id; t.ack_id = doc.id;
      await audit('LdInduction', ind.id, 'policy_acknowledged', ctx.id, { policy: rec.policy_title, ack: doc.id }, ind.user_id);
      evaluateGate(ind, g);
      await afterChange(ind, ctx.id);
      await save('LdInduction', ind);
      const left = g.tasks.filter(x => !x.done).length;
      return ok(res, { ack_id: doc.id, signed_at: rec.signed_at, remaining: left, gate_status: g.status });
    });
  },

  async ld_getMyPolicyAcks(p, ctx, res) {
    const mine = (await list('LdPolicyAck')).filter(a => a.employee_user_id === ctx.id).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
    return ok(res, { acks: mine.map(a => ({ id: a.id, policy_title: a.policy_title, policy_category: a.policy_category, signed_at: a.signed_at, typed_name: a.typed_name })) });
  },

  // Register for HR / L&D: who signed what and when. Never editable or deletable from the application.
  async ld_listPolicyAcks(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const q = String(p.q || '').toLowerCase();
    let rows = await list('LdPolicyAck');
    if (p.policy_id) rows = rows.filter(a => a.policy_id === p.policy_id);
    if (p.department) rows = rows.filter(a => String(a.department || '').toLowerCase() === String(p.department).toLowerCase());
    if (p.from) rows = rows.filter(a => String(a.signed_at).slice(0, 10) >= p.from);
    if (p.to) rows = rows.filter(a => String(a.signed_at).slice(0, 10) <= p.to);
    if (q) rows = rows.filter(a => `${a.employee_name} ${a.employee_code} ${a.policy_title} ${a.department}`.toLowerCase().includes(q));
    rows.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
    const ps = Math.min(Math.max(Number(p.page_size) || 25, 1), 200), pg = Math.max(Number(p.page) || 1, 1);
    return ok(res, { total: rows.length, page: pg, page_size: ps, rows: rows.slice((pg - 1) * ps, pg * ps).map(a => ({ id: a.id, employee_name: a.employee_name, employee_code: a.employee_code, department: a.department, designation: a.designation, policy_id: a.policy_id, policy_title: a.policy_title, signed_at: a.signed_at, typed_name: a.typed_name, read_seconds: a.read_seconds, ip: a.ip })) });
  },
  async ld_policyCoverage(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const pols = inductionPolicies(await list('CompanyPolicy'));
    const acks = await list('LdPolicyAck');
    const emps = await activeEmployees();
    const activeIds = new Set(emps.map(e => e.user_id));
    return ok(res, { employees: emps.length, policies: pols.map(pl => { const who = new Set(acks.filter(a => a.policy_id === pl.id && activeIds.has(a.employee_user_id)).map(a => a.employee_user_id)); return { id: pl.id, title: pl.title, category: pl.category || '', signed: who.size, pending: Math.max(0, emps.length - who.size), pct: emps.length ? Math.round((who.size / emps.length) * 1000) / 10 : 0 }; }), total_acks: acks.length });
  },
  async ld_exportPolicyAcks(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const rows = (await list('LdPolicyAck')).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Policy acknowledgements');
    ws.addRow(['Maxvolt Energy — Policy acknowledgements (permanent record)']); ws.mergeCells(1, 1, 1, 12);
    Object.assign(ws.getCell(1, 1), { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3C5E' } } });
    ws.addRow([`Generated ${todayIST()} (IST) · ${rows.length} acknowledgement(s)`]); ws.addRow([]);
    const h = ws.addRow(['Employee code', 'Employee', 'Department', 'Designation', 'Policy', 'Category', 'Signed on (IST)', 'Typed signature', 'Statement', 'Read time (s)', 'Document SHA-256', 'Record SHA-256', 'Signed from', 'Receipt ID']);
    h.eachCell(c => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5986' } } }));
    for (const a of rows) ws.addRow([a.employee_code, a.employee_name, a.department, a.designation, a.policy_title, a.policy_category, new Date(Date.parse(a.signed_at) + IST_MS).toISOString().replace('T', ' ').slice(0, 19), a.typed_name, a.statement, a.read_seconds, a.policy_file_sha256 || '', a.record_sha256, a.ip, a.id]);
    [14, 24, 20, 22, 34, 14, 20, 24, 60, 12, 66, 66, 16, 38].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 4 }]; ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 14 } };
    return ok(res, { base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'), filename: `Policy_Acknowledgements_${todayIST()}.xlsx` });
  },
  async ld_policyAckReceipt(p, ctx, res) {
    const a = await get('LdPolicyAck', p.id);
    if (!a || (a.employee_user_id !== ctx.id && !ctx.isLdAdmin)) return fail(res, 'Receipt not found', 404);
    const { renderPdf } = await import('../utils/pdfRender.js');
    const buf = await renderPdf(ackReceiptDoc(a));
    return ok(res, { base64: buf.toString('base64'), filename: `Policy_Acknowledgement_${String(a.employee_code || 'employee').replace(/\W+/g, '_')}_${String(a.policy_title).replace(/\W+/g, '_').slice(0, 40)}.pdf` });
  },

  // Department introduction: the org chart of the employee's department, with the study timer and quiz status.
  async ld_getOrgIntro(p, ctx, res) {
    let ind = null, department;
    if (p.induction_id) {
      ind = await loadInduction(p.induction_id);
      if (!ind) return fail(res, 'Induction not found', 404);
      if (!canView(ctx, ind)) return forbid(res);
      department = ind.employee.department;
    } else { if (!ctx.isLdAdmin) return forbid(res); department = p.department; }
    const org = buildDeptOrg(department, await activeEmployees(), { viewerUid: ind?.user_id, today: todayIST() });
    const g = ind?.gates.find(x => x.gate_id === 'D1') || null;
    const view = g?.tasks.find(x => x.type === 'org_view'), quiz = g?.tasks.find(x => x.type === 'org_quiz');
    return ok(res, {
      org, department: department || '', pass_score: ctx.cfg.induction_pass_score, questions: ORG_QUIZ_QUESTIONS, is_self: !!ind && ctx.id === ind.user_id, paused: !!ind && !!ctx.cfg.paused && !ind.pause_exempt,
      gate: g ? { gate_id: g.gate_id, name: g.name, status: g.status, due_date: g.due_date, description: g.description } : null,
      view: view ? { task_id: view.id, done: !!view.done, seconds: Math.round(view.watch?.sec || 0), target: view.target_seconds } : null,
      quiz: quiz ? { task_id: quiz.id, done: !!quiz.done, attempts: (quiz.attempts || []).length, last_score: quiz.attempts?.length ? quiz.attempts[quiz.attempts.length - 1].score : null } : null,
    });
  },
  async ld_startOrgQuiz(p, ctx, res) {
    if (await frozenFor(ctx, p.induction_id)) return fail(res, PAUSED_MSG);
    const ind = await loadInduction(p.induction_id);
    if (!ind) return fail(res, 'Induction not found', 404);
    if (ctx.id !== ind.user_id) return forbid(res, 'Only the employee can take the quiz');
    const g = ind.gates.find(x => x.gate_id === 'D1');
    const view = g?.tasks.find(x => x.type === 'org_view'), qt = g?.tasks.find(x => x.type === 'org_quiz');
    if (!g || !qt) return fail(res, 'Quiz step not found', 404);
    if (qt.done) return fail(res, 'You have already passed this quiz');
    if (!gateActive(g)) return fail(res, 'This step is not open yet');
    if (!view?.done) return fail(res, 'Study the org chart for the required time first');
    let quiz = (await list('LdOrgQuiz', 'AND user_id=$2', [ctx.id])).find(x => x.induction_id === ind.id && x.status === 'IN_PROGRESS');
    if (!quiz) {
      const org = buildDeptOrg(ind.employee.department, await activeEmployees(), { viewerUid: ind.user_id, today: todayIST() });
      const seed = Math.floor(Math.random() * 2 ** 31);
      const questions = makeOrgQuiz(org, { n: ORG_QUIZ_QUESTIONS, seed });
      if (questions.length < 4) return fail(res, 'Your department chart is too small for a quiz yet — HR will sign this step off manually');
      quiz = await create('LdOrgQuiz', { user_id: ctx.id, induction_id: ind.id, department: ind.employee.department, seed, questions, status: 'IN_PROGRESS', started_at: nowIso() }, ctx.id);
    }
    return ok(res, { quiz_id: quiz.id, pass_score: ctx.cfg.induction_pass_score, attempt_no: (qt.attempts || []).length + 1, questions: quiz.questions.map(q => ({ id: q.id, level: q.level, text: q.text, options: q.options })) });
  },
  async ld_submitOrgQuiz(p, ctx, res) {
    const quiz = await get('LdOrgQuiz', p.quiz_id);
    if (!quiz || quiz.user_id !== ctx.id) return fail(res, 'Quiz not found', 404);
    if (quiz.status !== 'IN_PROGRESS') return fail(res, 'This quiz was already submitted');
    if (await frozenFor(ctx, quiz.induction_id)) return fail(res, PAUSED_MSG);
    return mutate(quiz.induction_id, ctx, res, async (ind) => {
      const g = ind.gates.find(x => x.gate_id === 'D1');
      const qt = g?.tasks.find(x => x.type === 'org_quiz');
      if (!g || !qt) { fail(res, 'Quiz step not found', 404); return false; }
      const need = ctx.cfg.induction_pass_score;
      const gr = gradeOrgQuiz(quiz.questions, p.answers || {}, need);
      Object.assign(quiz, { status: 'SUBMITTED', submitted_at: nowIso(), answers: p.answers || {}, score: gr.score, passed: gr.passed });
      await save('LdOrgQuiz', quiz);
      qt.attempts = [...(qt.attempts || []), { quiz_id: quiz.id, at: quiz.submitted_at, score: gr.score, passed: gr.passed }];
      if (gr.passed) { qt.done = true; qt.done_at = nowIso(); qt.done_by = ctx.id; }
      await audit('LdInduction', ind.id, gr.passed ? 'org_quiz_passed' : 'org_quiz_failed', ctx.id, { score: gr.score }, ind.user_id);
      evaluateGate(ind, g);
      return { result: { score: gr.score, passed: gr.passed, pass_score: need, right: gr.right, total: gr.total, results: gr.results.map(r => ({ id: r.id, level: r.level, ok: r.ok, picked: r.picked, correct_index: r.correct_index, correct_text: r.correct_text })) } };
    });
  },

  // HR: add the website / policy / org-chart steps to the induction template (new version) and, optionally, to running inductions
  // that have not started the corporate induction yet. Safe to run again.
  async ld_publishOpeningSteps(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const cur = await activeTemplate();
    if (!cur) return fail(res, 'No active induction template');
    const has = ['W1', 'P1', 'D1'].every(id => cur.gates.some(g => g.gate_id === id));
    let version = cur.version;
    if (!has) {
      cur.status = 'superseded'; await save('LdTemplate', cur);
      const doc = await create('LdTemplate', { ...clone(cur), id: undefined, gates: withOpeningGates(cur.gates), version: (cur.version || 0) + 1, status: 'active', previous_version: cur.version || null, changed_by: ctx.id, created_at: undefined });
      version = doc.version;
      await audit('LdTemplate', doc.id, 'opening_steps_published', ctx.id, { version });
    }
    const migrated = [], skipped = [];
    if (p.apply_to_running) {
      for (const row of (await list('LdInduction')).filter(i => i.status === 'IN_PROGRESS' && !i.gates.some(g => g.gate_id === 'W1'))) {
        await withLock('ind:' + row.id, async () => {
          const ind = await loadInduction(row.id);
          if (!ind || ind.status !== 'IN_PROGRESS') return;
          const started = ind.gates.some(g => g.seq >= 1 && (g.tasks.some(t => t.done) || (g.attempts || []).length || !['LOCKED', 'READY'].includes(g.status)));
          if (started) { skipped.push(ind.employee.name); return; }
          const newGates = openingGates().map(g => buildGate(g, ind.anchor_date));
          const g00 = ind.gates.findIndex(g => g.gate_id === 'G00');
          ind.gates.splice(g00 + 1, 0, ...newGates);
          const g01 = ind.gates.find(g => g.gate_id === 'G01');
          if (g01) { g01.depends_on = ['D1']; if (g01.status === 'READY') setStatus(g01, 'LOCKED', ctx.id, 'opening steps added before this step'); }
          recompute(ind);
          await syncPolicyGate(ind);
          ind.progress = progressOf(ind);
          await save('LdInduction', ind);
          await audit('LdInduction', ind.id, 'opening_steps_added', ctx.id, {}, ind.user_id);
          migrated.push(ind.employee.name);
        });
      }
    }
    return ok(res, { version, already: has, migrated: migrated.length, skipped });
  },

  async ld_runDailyTick(p, ctx, res) {
    if (!ctx.isLdAdmin) return forbid(res);
    const { ldDailyTick } = await import('../cron/ldAutomation.js');
    return ok(res, { result: await ldDailyTick() });
  },
};

// KPIs from the scope document (section 9.1): coverage, completion in 30 days, first-attempt pass rate,
// pass after remediation, average score, long-overdue steps, learner satisfaction.
async function feedbackAvg() { const r = (await list('LdFeedback')).map(f => f.rating).filter(Boolean); return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10 : null; }
function policyKpis(inds, emps, today) {
  const active = emps.filter(e => e.user_id && e.status === 'active');
  const covered = new Set(inds.map(i => i.user_id));
  const gates = inds.flatMap(i => i.gates.filter(g => g.completion === 'assessment'));
  const firsts = gates.filter(g => (g.attempts || []).length);
  const everFailed = gates.filter(g => (g.attempts || []).some(a => !a.passed));
  const scores = gates.flatMap(g => (g.attempts || []).filter(a => !a.expired).map(a => a.score));
  const due30 = inds.filter(i => i.status === 'COMPLETED' || daysBetween(String(i.started_at).slice(0, 10), today) >= 30);
  return {
    coverage_pct: pct(active.filter(e => covered.has(e.user_id)).length, active.length), eligible_total: active.length,
    completion_30d_pct: due30.length ? pct(due30.filter(i => i.status === 'COMPLETED' && daysBetween(String(i.started_at).slice(0, 10), String(i.completed_at).slice(0, 10)) <= 30).length, due30.length) : null,
    first_attempt_pass_pct: firsts.length ? pct(firsts.filter(g => g.attempts[0].passed).length, firsts.length) : null,
    pass_after_remediation_pct: everFailed.length ? pct(everFailed.filter(g => OKAY(g.status)).length, everFailed.length) : null,
    avg_assessment_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
    overdue_over_7d: inds.reduce((n, i) => n + i.gates.filter(g => g.status === 'OVERDUE' && daysBetween(g.due_date, today) > 7).length, 0),
  };
}

// A "wave": every active employee without an induction in the chosen departments / locations (batches of ≤ limit).
async function resolveWave(w = {}) {
  const have = new Set((await list('LdInduction')).filter(i => i.status !== 'CANCELLED').map(i => i.user_id));
  const dset = new Set((w.departments || []).map(norm)), lset = new Set((w.locations || []).map(norm));
  const emps = (await list('Employee')).filter(e => e.user_id && e.status === 'active');
  const rows = emps.filter(e => !have.has(e.user_id) && (!dset.size || dset.has(norm(e.department))) && (!lset.size || lset.has(norm(e.work_location)))).sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code)));
  const limit = Math.min(Math.max(Number(w.limit) || 100, 1), 500);
  const chosen = rows.slice(0, limit);
  return { total: rows.length, will_start: chosen.length, user_ids: chosen.map(e => e.user_id), sample: chosen.slice(0, 8).map(e => ({ name: e.display_name, code: e.employee_code, department: e.department || '', location: e.work_location || '' })),
    departments: [...new Set(emps.map(e => e.department).filter(Boolean))].sort(), locations: [...new Set(emps.map(e => e.work_location).filter(Boolean))].sort() };
}

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
