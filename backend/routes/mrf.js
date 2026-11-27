// Manpower Requisition Form (MRF) — server side (every `mrf_*` function; dispatched from functions.js).
//
// Ownership (enforced HERE, never only in the screen):
//   • The designated Hiring Manager owns and alone approves the Job Description. HR / admin / management cannot approve it,
//     and AI can only draft text — it never moves a requisition forward.
//   • The creator may start the form (and let the AI draft a JD); they edit the JD themselves only when they ARE the Hiring Manager.
//   • HR owns publication: it can publish, hold, return or close, but can never change the approved JD — a change goes back to the
//     Hiring Manager, and any material change to an approved JD voids the approval and unpublishes until it is approved again.
//   • Approved JD versions are immutable (a snapshot with a content hash); every action lands in an append-only audit trail.
//   • Validation flags (utils/mrfRules.js): a critical one blocks submission unless an authorised person overrides it with a reason.
//   • Optional extra step (off by default): the Department Head approves before HR may publish.
// Requisitions are stored on the existing JobRequisition entity (mrf_version: 2) with the legacy fields kept in step, so the
// older recruitment pages, the careers page, the cron reminders and the MIS keep working; older requisitions are untouched.
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { one, all, run } from '../db.js';
import { callAI } from '../utils/ai.js';
import { sendEmail } from '../utils/email.js';
import { sendPushToUser } from '../utils/push.js';
import * as M from '../utils/mrf.js';
import * as VR from '../utils/mrfRules.js';
import { keyedLock } from '../utils/keyedLock.js';
import { hasFullCandidateAccess, maskAudit } from '../utils/candidateAccess.js';
import { loadHiringData } from '../utils/hiringMetrics.js';
import { computeMrfMis } from '../utils/mrfMis.js';
import { buildMrfMisWorkbook } from '../utils/mrfMisExport.js';
import { buildRequisitionWorkbook, buildMonthWorkbook, monthRange, monthLabel } from '../utils/mrfFunnelReport.js';

const T = 'JobRequisition', MT = 'MrfMaster';
const HR = ['hr', 'admin'];
const CREATE_ROLES = ['hr', 'admin', 'management', 'manager', 'recruiter'];
const PUBLISH_ROLES = ['hr', 'admin', 'recruiter'];
const CFG_TYPE = 'MrfRulesConfig', CFG_ID = 'mrf-rules-config';
const GONE = ['resigned', 'terminated', 'retired', 'inactive', 'absconded'];
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const nowIso = () => new Date().toISOString();
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
const hasAny = (cx, list) => cx.roles.some((r) => list.includes(r));
const appUrl = () => process.env.APP_URL || 'https://maxone.maxvoltenergy.com';

// ── storage ──
async function load(id) { if (!id) return null; const r = await one("SELECT data FROM entities WHERE type=$1 AND id=$2", [T, id]); const d = r ? jparse(r.data) : null; return d && d.mrf_version === 2 ? d : null; }
// MIS, the recruitment analytics and the older screens read these fields; keep them true to the new workflow:
//   manager approval = the Hiring Manager approved the JD, HR approval = it was published, closed_date for time-to-fill.
function syncLegacyFields(rec) {
  rec.manager_approval_status = rec.approved_jd || rec.hm_approved_at ? 'approved' : rec.status === 'rejected' ? 'rejected' : 'pending';
  if (rec.approved_jd) { rec.manager_approved_by = rec.approved_jd.approved_by; rec.manager_approved_date = rec.approved_jd.approved_at; }
  rec.hr_approval_status = rec.published_date ? 'approved' : 'pending';
  if (rec.published_date) { rec.hr_approved_by = rec.published_by || ''; rec.hr_approved_date = rec.published_date; rec.approved_date = rec.published_date; rec.approved_by = rec.published_by || ''; }
  if (rec.status === 'closed' && rec.closed_at && !rec.closed_date) { rec.closed_date = rec.closed_at; rec.closed_date_source = 'recorded'; }
  if (rec.status !== 'closed' && rec.closed_date && rec.closed_date_source === 'recorded') { delete rec.closed_date; delete rec.closed_date_source; }
  return rec;
}
async function save(rec, userId = null) {
  syncLegacyFields(rec);
  rec.updated_at = nowIso();
  const json = JSON.stringify(rec);
  const u = await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE type=$3 AND id=$4", [json, rec.status, T, rec.id]);
  if (!u.rowCount) await run("INSERT INTO entities(id,type,user_id,status,is_active,data) VALUES($1,$2,$3,$4,1,$5)", [rec.id, T, userId, rec.status, json]);
  return rec;
}
async function allV2() { return (await all("SELECT data FROM entities WHERE type=$1", [T])).map((r) => jparse(r.data)).filter((d) => d && d.mrf_version === 2); }

async function people() {
  const emps = (await all("SELECT user_id, data FROM entities WHERE type='Employee'")).map((r) => ({ ...(jparse(r.data) || {}), user_id: r.user_id })).filter((e) => e.user_id);
  const users = await all("SELECT id, email, full_name, role, custom_role FROM users");
  const byUser = {}; for (const u of users) byUser[u.id] = u;
  const empBy = {}; for (const e of emps) empBy[e.user_id] = e;
  const name = (id) => empBy[id]?.display_name || byUser[id]?.full_name || byUser[id]?.email || '';
  const reports = {}; for (const e of emps) if (e.reporting_manager_id && e.status !== 'resigned' && e.status !== 'terminated') reports[e.reporting_manager_id] = (reports[e.reporting_manager_id] || 0) + 1;
  return { emps, empBy, byUser, name, reports };
}
const roleList = (u) => [u?.role, u?.custom_role].filter(Boolean);

// ── masters ──
async function ensureMasters() {
  const have = new Set((await all("SELECT data FROM entities WHERE type=$1", [MT])).map((r) => jparse(r.data)?.kind));
  for (const [kind, rows] of Object.entries(M.DEFAULT_MASTERS)) {
    if (have.has(kind)) continue;
    let order = 0;
    for (const r of rows) { const id = uuidv4(); await run("INSERT INTO entities(id,type,status,is_active,data) VALUES($1,$2,'active',1,$3)", [id, MT, JSON.stringify({ id, kind, value: r.value, label: r.label, meta: r.meta || null, order: ++order, is_active: true, seeded: true })]); }
  }
  if (have.has('requisition_type')) await upgradeRequisitionTypes();
}
// Lists seeded before "Backfill / Expansion" existed: add it once and retire the two types it replaces (HR can reactivate them).
async function upgradeRequisitionTypes() {
  const unlock = await keyedLock('mrf:masters');
  try {
    const rows = (await all("SELECT id, data FROM entities WHERE type=$1", [MT])).map((r) => ({ id: r.id, d: jparse(r.data) })).filter((x) => x.d?.kind === 'requisition_type');
    if (rows.some((x) => x.d.value === 'backfill_expansion')) return;
    for (const x of rows.filter((y) => y.d.seeded && ['temporary', 'contractual'].includes(y.d.value))) await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify({ ...x.d, is_active: false }), x.id]);
    const id = uuidv4();
    await run("INSERT INTO entities(id,type,status,is_active,data) VALUES($1,$2,'active',1,$3)", [id, MT, JSON.stringify({ id, kind: 'requisition_type', value: 'backfill_expansion', label: 'Backfill / Expansion', meta: null, order: Math.max(0, ...rows.map((x) => x.d.order || 0)) + 1, is_active: true, seeded: true })]);
  } finally { unlock(); }
}
async function loadMasters(includeInactive = false) {
  await ensureMasters();
  const out = {};
  for (const r of await all("SELECT data FROM entities WHERE type=$1", [MT])) { const d = jparse(r.data); if (!d || (!includeInactive && d.is_active === false)) continue; (out[d.kind] ||= []).push(d); }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.order || 0) - (b.order || 0));
  return out;
}

// ── validation rules ──
async function loadRulesConfig() {
  const r = await one("SELECT data FROM entities WHERE type=$1 AND id=$2", [CFG_TYPE, CFG_ID]);
  return VR.normalizeConfig(r ? jparse(r.data) : null);
}
const departments = async () => (await all("SELECT data FROM entities WHERE type='Department'")).map((r) => jparse(r.data)).filter(Boolean);
/** Existing annual pay per designation, from active salary structures of people still employed. Used only for comparison. */
async function paySamples(P) {
  const seen = new Set(); const out = [];
  for (const r of await all("SELECT user_id, data FROM entities WHERE type='SalaryStructure' AND status='active' ORDER BY created_at DESC")) {
    const e = P.empBy[r.user_id]; const s = jparse(r.data);
    if (!e || !s || seen.has(r.user_id) || GONE.includes(e.status)) continue;
    seen.add(r.user_id);
    const annual = Math.max(Number(s.ctc) || 0, (Number(s.total_ctc) || 0) * 12);
    if (annual > 0 && e.designation) out.push({ designation: e.designation, annual_ctc: annual });
  }
  return out;
}
/** The flags for a form as it stands now, with any overrides already granted on the requisition. */
async function flagsFor(form, rec, P, masters) {
  const config = await loadRulesConfig();
  const replaced = form.replaced_employee_user_id ? P.empBy[form.replaced_employee_user_id] : null;
  const flags = VR.evaluate(form, { id: rec?.id, config, masters, others: await allV2(), pay: await paySamples(P), replaced: replaced ? { name: replaced.display_name, department: replaced.department } : null });
  return { config, flags: VR.applyOverrides(flags, rec?.flag_overrides || {}) };
}
const forViewer = (flags, cx) => VR.visibleFlags(flags || [], hasAny(cx, HR));
/** Records an override on the requisition and in its audit trail. Returns an error message, or null. */
function grantOverride(rec, cx, flag, justification) {
  const text = String(justification || '').trim().slice(0, 1000);
  if (text.length < VR.MIN_JUSTIFICATION) return `Give a justification of at least ${VR.MIN_JUSTIFICATION} characters to override “${flag.title}”.`;
  const entry = { code: flag.code, severity: flag.severity, fingerprint: flag.fingerprint, justification: text, by: cx.cu.id, by_name: cx.name, role: cx.roles[0] || '', at: nowIso() };
  rec.flag_overrides = { ...(rec.flag_overrides || {}), [flag.key]: entry };
  addAudit(rec, cx, 'validation_override', `${VR.SEVERITY[flag.severity].label} “${flag.title}”${flag.sensitive ? '' : `: ${flag.message}`} — ${text}`, { flag: flag.key, severity: flag.severity });
  return null;
}
async function overrideAudience(config) {
  return (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) = ANY($1::text[])", [config.override_roles])).map((r) => r.id);
}

// ── department head approval (only when the rules ask for it) ──
async function deptHeadOf(department) { return (await departments()).find((d) => d.name === department)?.head_user_id || ''; }
async function startDeptHeadApproval(rec, config) {
  if (!VR.needsDeptHeadApproval(rec, config)) { rec.dh_approval = null; return null; }
  const head = await deptHeadOf(rec.department);
  const own = head && head === rec.hiring_manager_id;     // the Hiring Manager who just approved is the Department Head
  rec.dh_approval = { required: true, status: own ? 'approved' : 'pending', head_user_id: head, jd_version: rec.approved_jd?.version || null, ...(own ? { by: head, at: nowIso(), comment: 'Approved as Hiring Manager (also Department Head)' } : {}) };
  return own ? null : head;
}
const deptHeadCleared = (rec) => rec.dh_approval?.status === 'approved' && rec.dh_approval.jd_version === (rec.approved_jd?.version || null);

async function rememberDesignation(name) {
  const t = String(name || '').trim(); if (!t) return;
  const rows = (await all("SELECT id, data FROM entities WHERE type=$1", [MT])).map((r) => ({ id: r.id, d: jparse(r.data) })).filter((x) => x.d?.kind === 'designation');
  if (rows.some((x) => String(x.d.label).toLowerCase() === t.toLowerCase())) return;
  const id = uuidv4(); const order = Math.max(0, ...rows.map((x) => x.d.order || 0)) + 1;
  await run("INSERT INTO entities(id,type,status,is_active,data) VALUES($1,$2,'active',1,$3)", [id, MT, JSON.stringify({ id, kind: 'designation', value: t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || id.slice(0, 8), label: t, order, is_active: true, custom: true })]);
}
async function applicationCounts() {
  const out = {};
  for (const r of await all("SELECT data FROM entities WHERE type='Candidate'")) { const c = jparse(r.data); const k = c?.requisition_id || c?.job_id; if (k) out[k] = (out[k] || 0) + 1; }
  return out;
}

// ── audit, notifications ──
function addAudit(rec, cx, action, detail = '', extra = {}) {
  rec.audit = [...(rec.audit || []), { at: nowIso(), by: cx.cu.id, by_name: cx.name, role: cx.roles[0] || '', action, detail, ...extra }].slice(-500);
}
async function notify(userIds, { title, message, link = '/JobRequisitions', type = 'info', email = true }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  for (const uid of ids) {
    try { await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [uuidv4(), uid, title, message, type, link]); } catch (e) { console.warn('[mrf] notify failed:', e.message); }
    try { sendPushToUser(uid, { title, message, type, link }); } catch { /* push is best-effort */ }
  }
  if (email && ids.length) {
    try {
      const rows = await all("SELECT email FROM users WHERE id = ANY($1::text[])", [ids]);
      const to = rows.map((r) => r.email).filter((e) => e && !e.includes('.disabled-'));
      if (to.length) sendEmail({ to, subject: title, html: `<div style="font-family:Arial,sans-serif;font-size:14px"><p>${String(message).replace(/</g, '&lt;')}</p><p><a href="${appUrl()}${link}">Open in Maxvolt One</a></p></div>` }).catch((e) => console.warn('[mrf] email failed:', e.message));
    } catch (e) { console.warn('[mrf] email lookup failed:', e.message); }
  }
}
async function hrAudience() { return (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin','recruiter') OR role IN ('hr','admin','recruiter')")).map((r) => r.id); }
const label = (rec) => `${rec.requisition_id} — ${rec.designation || 'position'} (${rec.department || ''})`;

// ── access ──
const isCreator = (rec, cx) => rec.requested_by === cx.cu.id;
const isHm = (rec, cx) => !!rec.hiring_manager_id && rec.hiring_manager_id === cx.cu.id;
const isOrgWide = (cx) => hasAny(cx, ['hr', 'admin', 'management', 'recruiter']);
const isDeptHead = (rec, cx) => cx.headOf.has(rec.department);
const canSee = (rec, cx) => isOrgWide(cx) || isCreator(rec, cx) || isHm(rec, cx) || (isDeptHead(rec, cx) && rec.status !== 'draft');

// Hiring manager must be an active employee of the department (or that department's head).
async function checkHiringManager(department, hmId, P) {
  const e = P.empBy[hmId];
  if (!e || ['resigned', 'terminated', 'retired'].includes(e.status)) return 'The selected Hiring Manager is not an active employee.';
  if (e.department === department) return null;
  const dep = (await all("SELECT data FROM entities WHERE type='Department'")).map((r) => jparse(r.data)).find((d) => d && d.name === department);
  if (dep?.head_user_id === hmId) return null;
  return `${e.display_name || 'The selected employee'} does not belong to ${department}. Choose a Hiring Manager from that department.`;
}

function hydrate(rec, P) {
  return { ...rec, requested_by_name: P.name(rec.requested_by), hiring_manager_name: P.name(rec.hiring_manager_id), reports_to_name: P.name(rec.reports_to_user_id) };
}
/** hydrate(), minus what this viewer may not see (flags that describe other people's salaries). */
function view(rec, P, cx) {
  const out = hydrate(rec, P);
  if (out.audit && !hasFullCandidateAccess(cx.roles) && !isHm(rec, cx)) out.audit = maskAudit(out.audit);
  if (hasAny(cx, HR)) return out;
  if (out.validation) out.validation = { ...out.validation, flags: forViewer(out.validation.flags, cx) };
  if (out.flag_overrides) out.flag_overrides = Object.fromEntries(Object.entries(out.flag_overrides).filter(([, o]) => !VR.RULES[o.code]?.sensitive));
  return out;
}

// ── AI ──
// The prompts carry only role details (title, department, skills, location) — never a person's data — so MRF drafting does not depend on the per-user AI consent.
const aiAllowed = async () => true;
const ctxText = (f, masters) => {
  const lab = (kind, v) => (masters[kind] || []).find((m) => m.value === v)?.label || v || '';
  return [
    `Department: ${f.department || ''}`, `Designation: ${f.designation || ''}`, `Position tier: ${f.position_tier === 'other_custom' ? f.position_tier_custom : lab('position_tier', f.position_tier)}`,
    `Requisition type: ${lab('requisition_type', f.requisition_type)}`, `Employment type: ${lab('employment_type', f.employment_type)}`, `Vacancies: ${f.number_of_positions || 1}`,
    `Experience: ${VR.experienceText(f, masters)}`,
    `CTC: ${M.ctcLabel(f) || 'not specified'}`, `Location: ${M.locationLabel(f) || 'not specified'} (${f.work_arrangement || ''})`,
    `Qualification: ${(f.qualification || []).join(', ')}`, `Industry: ${(f.industry_experience || []).join(', ')}`,
    `Required skills: ${[...(f.required_skills || []), ...(f.technical_skills || [])].join(', ')}`, `Preferred skills: ${(f.preferred_skills || []).join(', ')}`,
    `Overview: ${f.position_overview || ''}`, `Purpose: ${f.purpose_of_hiring || ''}`, `Responsibilities: ${(f.key_responsibilities || []).join('; ')}`, `Notes: ${f.additional_notes || ''}`,
  ].join('\n');
};
const JD_SYSTEM = 'Never name any individual (hiring manager, reporting manager or requester) in the job description — refer to the reporting line by designation only, and only when it is given. You are a senior HR content writer for MaxVolt Energy Industries Limited, an Indian lithium-ion battery pack and energy storage manufacturer. Write job descriptions the way a top employer would: a short engaging role summary in two or three full sentences, then specific, action-led responsibilities (each one a concrete duty starting with a verb, not a vague phrase), realistic qualifications, and skills that fit the department and level. Be professional, inclusive and concise — no filler, no buzzwords, no repetition. Output plain text only: each section title in CAPITALS on its own line, bullets using "•", a blank line between sections, no markdown symbols. Never invent salary, benefits, perks or facts that were not provided.';
const JD_SECTIONS = 'JOB TITLE, DEPARTMENT, POSITION TIER, JOB LOCATION, EMPLOYMENT TYPE, EXPERIENCE REQUIRED, COMPENSATION RANGE (only if given to disclose), ABOUT THE ROLE, KEY RESPONSIBILITIES, REQUIRED QUALIFICATIONS, TECHNICAL / FUNCTIONAL SKILLS, PREFERRED SKILLS, KEY COMPETENCIES, REPORTING STRUCTURE, ADDITIONAL REQUIREMENTS, ABOUT MAXVOLT ENERGY';
const REFINE = {
  improve: 'Improve the writing: fix grammar, tighten wording and make it more professional. Keep every fact and the same structure.',
  expand: 'Expand the KEY RESPONSIBILITIES with more specific, realistic duties for this role. Keep everything else.',
  simplify: 'Simplify the language so it is easy to read for candidates. Keep every fact and the same structure.',
  industry: 'Add relevant industry-specific skills and competencies for this department and role (battery / energy / manufacturing context where it fits) to the skills sections. Do not remove anything.',
  portal: 'Optimise this job description for job portals: a clear title, a short compelling summary at the top of ABOUT THE ROLE, scannable bullets and natural searchable keywords. Keep all facts.',
};
const cleanAiText = (t) => M.normalizeJdText(t);

// ── JD versions ──
const hashOf = (t) => createHash('sha256').update(String(t)).digest('hex').slice(0, 16);
function pushVersion(rec, cx, text, source, action, note = '') {
  const v = (rec.jd_versions || []).length + 1;
  rec.jd_versions = [...(rec.jd_versions || []), { version: v, text, source, action, note, by: cx.cu.id, by_name: cx.name, at: nowIso(), hash: hashOf(text) }];
  rec.jd_current_text = text;
  return v;
}
/** Applies new JD text to a requisition, enforcing who may change it and voiding an approval the change makes stale. */
function applyJd(rec, cx, text, source, action, note) {
  const status = rec.status;
  const hm = isHm(rec, cx);
  const creatorDrafting = isCreator(rec, cx) && M.JD_EDITABLE_BY_CREATOR.includes(status);
  const drafting = ['generate', 'regenerate'].includes(action);   // an AI first draft; anything else is editing / refining
  if (!hm && !(creatorDrafting && drafting)) return { error: creatorDrafting ? 'Only the Hiring Manager can edit the Job Description. You can ask the AI to draft it.' : 'Only the designated Hiring Manager can change the Job Description.' };
  if (['closed', 'cancelled', 'rejected'].includes(status)) return { error: 'This requisition is closed — the JD can no longer be changed.' };
  const before = rec.jd_current_text || '';
  const version = pushVersion(rec, cx, text, source, action, note);
  let invalidated = false;
  if (rec.approved_jd && M.isMaterialJdChange(rec.approved_jd.text, text)) {
    invalidated = true;
    rec.jd_approval_history = [...(rec.jd_approval_history || []), { ...rec.approved_jd, voided_at: nowIso(), voided_by: cx.cu.id, voided_by_name: cx.name, voided_reason: 'JD materially changed after approval' }];
    rec.approved_jd = null; rec.jd_status = 'draft';
    if (['pending_hr_publication', 'published', 'on_hold'].includes(status)) { rec.status = 'pending_hm_approval'; rec.is_published = false; rec.unpublished_reason = 'JD changed after approval — awaiting Hiring Manager re-approval'; }
  }
  addAudit(rec, cx, invalidated ? 'jd_changed_approval_voided' : `jd_${action}`, `Version ${version} (${source})${note ? ' — ' + note : ''}`, { version, changed: M.isMaterialJdChange(before, text) });
  return { version, invalidated };
}

// ── handlers ──
const H = {
  async mrf_options({ cx, res }) {
    const masters = await loadMasters();
    const P = await people();
    const deps = (await all("SELECT data FROM entities WHERE type='Department'")).map((r) => jparse(r.data)).filter(Boolean).map((d) => ({ name: d.name, code: d.code, head_user_id: d.head_user_id || '' })).sort((a, b) => a.name.localeCompare(b.name));
    const locations = (await all("SELECT data FROM entities WHERE type='AppLocation'")).map((r) => jparse(r.data)).filter((l) => l && l.is_active !== false).map((l) => ({ name: l.name, city: l.city || '', state: l.state || '' }));
    const desigSeen = new Map();
    for (const d of [...(masters.designation || []).map((m) => m.label), ...P.emps.map((e) => e.designation), ...(await allV2()).map((r) => r.designation)]) { const t = String(d || '').trim(); if (t && t !== 'Other / Custom' && !desigSeen.has(t.toLowerCase())) desigSeen.set(t.toLowerCase(), t); }
    const designations = [...desigSeen.values()].sort((a, b) => a.localeCompare(b));
    const me = P.empBy[cx.cu.id] || {};
    const creatorOnlyManager = hasAny(cx, ['manager']) && !hasAny(cx, ['hr', 'admin', 'management']);
    const canCreate = hasAny(cx, CREATE_ROLES);
    const config = await loadRulesConfig();
    // "Replacement Of" must find anyone who ever held a role, including people who have left
    const allEmployees = canCreate ? P.emps.map((e) => ({ user_id: e.user_id, name: e.display_name || P.name(e.user_id), code: e.employee_code || '', department: e.department || '', designation: e.designation || '', status: e.status || 'active', separated: GONE.includes(e.status) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))) : [];
    return res.json({ success: true, masters, departments: deps, locations, designations, all_employees: allEmployees,
      can_override: VR.canOverride(cx.roles, config), dept_head_approval: config.dept_head_approval, is_department_head: cx.headOf.size > 0, today: istToday(),
      employees: P.emps.filter((e) => !['resigned', 'terminated', 'retired'].includes(e.status)).map((e) => ({ user_id: e.user_id, name: e.display_name, code: e.employee_code, department: e.department, designation: e.designation })),
      timeline: VR.targetWindow(istToday()), can_create: canCreate, is_hr: hasAny(cx, HR), is_publisher: hasAny(cx, PUBLISH_ROLES), is_org_wide: isOrgWide(cx),
      me: { user_id: cx.cu.id, name: cx.name, department: me.department || '', designation: me.designation || '', reporting_manager_id: me.reporting_manager_id || '', reporting_manager_name: P.name(me.reporting_manager_id), locked_to_self: creatorOnlyManager } });
  },

  // Employees of a department, department head and reporting managers first.
  async mrf_hiring_managers({ p, cx, res }) {
    if (!hasAny(cx, CREATE_ROLES)) return fail(res, 'You cannot create requisitions', 403);
    const P = await people();
    const dep = (await all("SELECT data FROM entities WHERE type='Department'")).map((r) => jparse(r.data)).find((d) => d && d.name === p.department);
    const head = dep?.head_user_id || '';
    const rows = P.emps.filter((e) => !['resigned', 'terminated', 'retired'].includes(e.status) && (e.department === p.department || e.user_id === head))
      .map((e) => {
        const isHead = e.user_id === head; const nReports = P.reports[e.user_id] || 0;
        const roles = roleList(P.byUser[e.user_id]);
        const rank = isHead ? 0 : (nReports > 0 || roles.includes('manager') || roles.includes('management')) ? 1 : 2;
        return { user_id: e.user_id, name: e.display_name, code: e.employee_code, designation: e.designation, is_head: isHead, direct_reports: nReports, rank, reports_to: e.reporting_manager_id || '', reports_to_name: P.name(e.reporting_manager_id) };
      })
      .sort((a, b) => a.rank - b.rank || b.direct_reports - a.direct_reports || String(a.name).localeCompare(String(b.name)));
    return res.json({ success: true, managers: rows, department_head: head });
  },

  // ── masters (HR administration) ──
  async mrf_master_list({ cx, res }) {
    if (!hasAny(cx, HR)) return fail(res, 'HR or admin access required', 403);
    return res.json({ success: true, masters: await loadMasters(true), labels: M.MASTER_LABELS });
  },
  async mrf_master_save({ p, cx, res }) {
    if (!hasAny(cx, HR)) return fail(res, 'HR or admin access required', 403);
    const kind = String(p.kind || ''); if (!M.MASTER_LABELS[kind]) return fail(res, 'Unknown master');
    const lab = String(p.label || '').trim().slice(0, 120); if (!lab) return fail(res, 'Enter a name');
    await ensureMasters();
    const all_ = (await all("SELECT id, data FROM entities WHERE type=$1", [MT])).map((r) => ({ id: r.id, d: jparse(r.data) })).filter((x) => x.d?.kind === kind);
    const value = p.id ? all_.find((x) => x.id === p.id)?.d.value : (String(p.value || lab).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || uuidv4().slice(0, 8));
    if (all_.some((x) => x.id !== p.id && (x.d.value === value || String(x.d.label).toLowerCase() === lab.toLowerCase()))) return fail(res, `"${lab}" already exists in this list`);
    const meta = kind === 'experience_range' ? { min: Number(p.meta?.min) || 0, max: Number(p.meta?.max) || 0 } : (p.meta || null);
    if (p.id) {
      const cur = all_.find((x) => x.id === p.id); if (!cur) return fail(res, 'Not found', 404);
      const upd = { ...cur.d, label: lab, meta: meta ?? cur.d.meta, is_active: p.is_active === undefined ? cur.d.is_active : !!p.is_active };
      await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), p.id]);
    } else {
      const id = uuidv4(); const order = Math.max(0, ...all_.map((x) => x.d.order || 0)) + 1;
      await run("INSERT INTO entities(id,type,status,is_active,data) VALUES($1,$2,'active',1,$3)", [id, MT, JSON.stringify({ id, kind, value, label: lab, meta, order, is_active: true })]);
    }
    return res.json({ success: true, masters: await loadMasters(true) });
  },
  async mrf_master_reorder({ p, cx, res }) {
    if (!hasAny(cx, HR)) return fail(res, 'HR or admin access required', 403);
    const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
    let order = 0;
    for (const id of ids) { const r = await one("SELECT data FROM entities WHERE type=$1 AND id=$2", [MT, id]); const d = r ? jparse(r.data) : null; if (!d || d.kind !== p.kind) continue; d.order = ++order; await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), id]); }
    return res.json({ success: true, masters: await loadMasters(true) });
  },

  // ── create / edit the requisition ──
  async mrf_save({ p, cx, res }) {
    if (!hasAny(cx, CREATE_ROLES)) return fail(res, 'You are not allowed to create requisitions', 403);
    const P = await people(); const masters = await loadMasters();
    const form = M.cleanForm(p.form || {});
    const managerOnly = hasAny(cx, ['manager']) && !hasAny(cx, ['hr', 'admin', 'management']);
    let rec = p.id ? await load(p.id) : null;
    if (p.id && !rec) return fail(res, 'Requisition not found', 404);
    if (rec) {
      if (!isCreator(rec, cx)) return fail(res, 'Only the person who created this requisition can edit its details.', 403);
      if (!M.JD_EDITABLE_BY_CREATOR.includes(rec.status)) return fail(res, 'This requisition is already in the approval workflow. Ask the Hiring Manager or HR to send it back for changes.', 409);
    }
    const me = P.empBy[cx.cu.id] || {};
    if (managerOnly) { form.department = me.department || form.department; form.hiring_manager_id = cx.cu.id; }
    // the replaced person's name and ID always come from their record, never from what was typed
    if (form.replaced_employee_user_id) {
      const gone = P.empBy[form.replaced_employee_user_id];
      if (!gone) return fail(res, 'The employee selected in “Replacement Of” was not found.');
      form.replaced_employee_name = gone.display_name || P.name(gone.user_id); form.replaced_employee_code = gone.employee_code || '';
    }
    if (form.budget_status) form.budget_approved = form.budget_status !== 'non_budgeted';
    const merged = { ...(rec || {}), ...form };
    if (merged.hiring_manager_id && merged.department) {
      const bad = await checkHiringManager(merged.department, merged.hiring_manager_id, P);
      if (bad) return fail(res, bad);
    }
    if (form.hiring_manager_id && !form.reports_to_user_id && !merged.reports_to_user_id) form.reports_to_user_id = form.hiring_manager_id;
    let unlock = null;
    if (!rec) {
      unlock = await keyedLock('mrf:new-id');            // two people saving at once must never get the same MRF number
      const year = Number(istToday().slice(0, 4));
      const id = uuidv4();
      rec = { id, mrf_version: 2, requisition_id: M.nextReqId((await allV2()).map((r) => r.requisition_id), year), requisition_date: istToday(), status: 'draft', requested_by: cx.cu.id, requested_by_role: cx.roles[0] || '',
        created_by_name: cx.name, jd_versions: [], jd_status: 'not_generated', audit: [], disclose_ctc: false, number_of_positions: 1, exp_mode: 'range' };
      Object.assign(rec, form);
      addAudit(rec, cx, 'created', `Requisition created as ${rec.requested_by_role || 'user'}`);
      if (rec.hiring_manager_id) addAudit(rec, cx, 'hiring_manager_assigned', P.name(rec.hiring_manager_id));
    } else {
      const ch = M.diffForm(rec, form);
      if (ch.length) {
        Object.assign(rec, form);
        addAudit(rec, cx, 'details_updated', `${ch.length} field(s) changed`, { changes: ch.slice(0, 60) });
        if (ch.some((c) => c.field === 'hiring_manager_id')) addAudit(rec, cx, 'hiring_manager_assigned', P.name(rec.hiring_manager_id));
      }
    }
    Object.assign(rec, M.legacyMirror(rec, masters));
    rec.hiring_manager_name = P.name(rec.hiring_manager_id);
    try { await save(rec, cx.cu.id); } finally { unlock?.(); }
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  // Live checks while the form is being filled: anomalies next to each field, and the allowed target-date window.
  async mrf_validate({ p, cx, res }) {
    let rec = p.id ? await load(p.id) : null;
    if (rec && !canSee(rec, cx)) return fail(res, 'You do not have access to this requisition', 403);
    if (!rec && !hasAny(cx, CREATE_ROLES)) return fail(res, 'Not allowed', 403);
    const P = await people(); const masters = await loadMasters();
    const form = { ...(rec || {}), ...M.cleanForm(p.form || {}) };
    const { config, flags } = await flagsFor(form, rec, P, masters);
    const today = istToday();
    return res.json({ success: true, flags: forViewer(flags, cx), window: VR.targetWindow(today), can_override: VR.canOverride(cx.roles, config), override_roles: config.override_roles,
      field_problems: { experience: VR.experienceProblem(form, masters), target_hire_date: form.target_hire_date ? VR.targetDateProblem(today, form.target_hire_date) : null } });
  },

  // An authorised person accepts a flagged exception, with the reason on record.
  async mrf_override({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    const P = await people(); const masters = await loadMasters();
    const { config, flags } = await flagsFor(rec, rec, P, masters);
    if (!VR.canOverride(cx.roles, config)) return fail(res, `Only ${config.override_roles.join(' / ')} can override a validation flag.`, 403);
    if (['closed', 'cancelled', 'rejected'].includes(rec.status)) return fail(res, 'This requisition is finished.');
    const flag = flags.find((x) => x.key === p.key);
    if (!flag) return fail(res, 'That flag no longer applies — reload the requisition.', 409);
    if (flag.sensitive && !hasAny(cx, HR)) return fail(res, 'Only HR or admin can override this flag.', 403);
    if (flag.severity === 'information') return fail(res, 'Information notes do not need an override.');
    const bad = grantOverride(rec, cx, flag, p.justification); if (bad) return fail(res, bad);
    const next = VR.applyOverrides(flags, rec.flag_overrides);
    rec.validation = { ...(rec.validation || {}), at: nowIso(), flags: next };
    if (!VR.blockingFlags(next).length) rec.exception_requested = null;
    await save(rec, cx.cu.id);
    if (!isCreator(rec, cx)) await notify([rec.requested_by], { title: 'Requisition exception approved', message: `${cx.name} overrode “${flag.title}” on ${label(rec)}.${VR.blockingFlags(next).length ? '' : ' It no longer blocks submission.'}`, link: `/ManpowerRequisitions?open=${rec.id}` });
    return res.json({ success: true, requisition: view(rec, P, cx), flags: forViewer(next, cx) });
  },

  // The creator cannot override a critical flag: ask the people who can.
  async mrf_request_exception({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Save the requisition first.', 404);
    if (!isCreator(rec, cx)) return fail(res, 'Only the creator can ask for an exception.', 403);
    if (!M.JD_EDITABLE_BY_CREATOR.includes(rec.status)) return fail(res, 'This requisition has already been submitted.');
    const reason = String(p.reason || '').trim().slice(0, 1000);
    if (reason.length < VR.MIN_JUSTIFICATION) return fail(res, 'Explain why this exception is needed.');
    const P = await people(); const masters = await loadMasters();
    const { config, flags } = await flagsFor(rec, rec, P, masters);
    const blocking = VR.blockingFlags(flags);
    if (!blocking.length) return fail(res, 'Nothing is blocking submission now.');
    rec.exception_requested = { by: cx.cu.id, by_name: cx.name, at: nowIso(), reason };
    rec.validation = { at: nowIso(), flags };
    addAudit(rec, cx, 'exception_requested', `${blocking.map((x) => x.title).join(', ')} — ${reason}`);
    await save(rec, cx.cu.id);
    await notify(await overrideAudience(config), { title: 'Requisition exception needs approval', message: `${cx.name} asks for an exception on ${label(rec)}: ${blocking.map((x) => x.title).join(', ')}. Reason: ${reason}`, link: `/ManpowerRequisitions?open=${rec.id}`, type: 'warning' });
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  async mrf_submit({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!isCreator(rec, cx)) return fail(res, 'Only the creator can submit this requisition.', 403);
    if (!M.JD_EDITABLE_BY_CREATOR.includes(rec.status)) return fail(res, `This requisition is already ${rec.status.replace(/_/g, ' ')}.`);
    const masters = await loadMasters(); const P = await people();
    const problems = M.submitProblems(rec, masters, { submissionDate: istToday() });
    if (rec.requisition_type === 'replacement' && rec.replaced_employee_user_id && !P.empBy[rec.replaced_employee_user_id]) problems.push('The employee selected in “Replacement Of” was not found');
    if (!String(rec.jd_current_text || '').trim()) problems.push('Generate the Job Description before submitting');
    if (problems.length) return res.json({ success: false, error: problems[0], errors: problems });
    const bad = await checkHiringManager(rec.department, rec.hiring_manager_id, P); if (bad) return fail(res, bad);
    // anomalies: critical ones stop here unless an authorised person has accepted them, now or earlier
    let { config, flags } = await flagsFor(rec, rec, P, masters);
    for (const o of Array.isArray(p.overrides) ? p.overrides.slice(0, 30) : []) {
      const flag = flags.find((x) => x.key === o?.key && !x.override);
      if (!flag || flag.severity === 'information') continue;
      if (!VR.canOverride(cx.roles, config) || (flag.sensitive && !hasAny(cx, HR))) return fail(res, `Only ${config.override_roles.join(' / ')} can override a validation flag.`, 403);
      const err = grantOverride(rec, cx, flag, o.justification); if (err) return fail(res, err);
    }
    flags = VR.applyOverrides(flags, rec.flag_overrides || {});
    const blocking = VR.blockingFlags(flags);
    if (blocking.length) {
      const errors = blocking.map((x) => `${x.title}: ${x.message}`);
      return res.json({ success: false, blocked_by_flags: true, error: errors[0], errors: [...errors, VR.canOverride(cx.roles, config) ? 'Correct the values, or override each critical item with a justification.' : 'Correct the values, or ask HR to approve an exception.'], flags: forViewer(flags, cx), can_override: VR.canOverride(cx.roles, config) });
    }
    await rememberDesignation(rec.designation);
    rec.status = 'pending_hm_approval'; rec.submitted_at = nowIso(); rec.jd_status = 'draft'; rec.changes_request = null; rec.exception_requested = null; rec.dh_approval = null;
    rec.validation = { at: rec.submitted_at, flags };
    const warn = flags.filter((x) => x.severity !== 'information' && !x.override);
    if (warn.length) addAudit(rec, cx, 'validation_flags', `${warn.length} warning(s) for HR review: ${warn.map((x) => x.title).join(', ')}`);
    addAudit(rec, cx, 'submitted', `Submitted for Hiring Manager approval (${P.name(rec.hiring_manager_id)})`);
    await save(rec, cx.cu.id);
    if (!isHm(rec, cx)) await notify([rec.hiring_manager_id], { title: 'Job Description needs your approval', message: `${cx.name} raised ${label(rec)} and you are the Hiring Manager. Please review and approve the Job Description.`, type: 'warning' });
    if (warn.length) await notify(await hrAudience(), { title: 'Requisition submitted with warnings', message: `${label(rec)}: ${warn.map((x) => x.title).join(', ')}. Please review.`, link: `/ManpowerRequisitions?open=${rec.id}`, type: 'warning', email: false });
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  // ── AI ──
  async mrf_ai_keywords({ p, cx, res }) {
    if (!hasAny(cx, CREATE_ROLES)) return fail(res, 'Not allowed', 403);
    const f = M.cleanForm(p.form || {});
    const fb = M.fallbackKeywords(f);
    if (!f.designation && !f.department) return res.json({ success: true, ...fb, source: 'rules' });
    if (!(await aiAllowed(cx.cu))) return res.json({ success: true, ...fb, ai_consent_required: true });
    try {
      const masters = await loadMasters();
      const out = await callAI(`Suggest hiring keywords for this position. Be specific to the department and designation — not generic.\n\n${ctxText(f, masters)}\n\nReturn JSON: {"skills":[8-12 skills/keywords],"technical":[5-8 technical or functional tools/skills],"responsibilities":[5-7 key responsibilities],"qualifications":[2-4 qualifications],"deliverables":[3-5 key deliverables]}. Short phrases only.`, { json: true, system: JD_SYSTEM, maxTokens: 900 });
      const j = typeof out === 'string' ? jparse(out) : out;
      const arr = (v, n) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, n);
      if (!j) throw new Error('unreadable AI answer');
      return res.json({ success: true, skills: arr(j.skills, 14), technical: arr(j.technical, 10), responsibilities: arr(j.responsibilities, 8), qualifications: arr(j.qualifications, 5), deliverables: arr(j.deliverables, 6), source: 'ai' });
    } catch (e) { console.warn('[mrf] keyword AI failed:', e.message); return res.json({ success: true, ...fb, ai_error: true }); }
  },

  async mrf_jd_generate({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Save the requisition first, then generate the JD.', 404);
    if (!canSee(rec, cx)) return fail(res, 'Not allowed', 403);
    const action = ['generate', 'regenerate', 'improve', 'expand', 'simplify', 'industry', 'portal'].includes(p.action) ? p.action : 'generate';
    const P = await people(); const masters = await loadMasters();
    const current = String(p.text ?? rec.jd_current_text ?? '');
    const refining = !['generate', 'regenerate'].includes(action);
    if (refining && !current.trim()) return fail(res, 'There is no Job Description to refine yet — generate it first.');
    // fail early on permission so no AI call is wasted
    const hm = isHm(rec, cx);
    if (!hm && !(isCreator(rec, cx) && M.JD_EDITABLE_BY_CREATOR.includes(rec.status) && !refining)) return fail(res, refining ? 'Only the Hiring Manager can refine the Job Description.' : 'Only the Hiring Manager (or the creator, while drafting) can generate the Job Description.', 403);
    const ctx = { masters, reportsToDesignation: (P.empBy[rec.reports_to_user_id || rec.hiring_manager_id] || {}).designation || '' };
    let text = ''; let source = 'ai'; let note = '';
    if (await aiAllowed(cx.cu)) {
      try {
        const prompt = refining
          ? `${REFINE[action]}\n\nCURRENT JOB DESCRIPTION:\n${current}\n\nReturn ONLY the full updated job description as plain text.`
          : `Write a complete, polished job description with these sections in this order: ${JD_SECTIONS}.\nSection guidance: JOB TITLE, DEPARTMENT, POSITION TIER, JOB LOCATION, EMPLOYMENT TYPE and EXPERIENCE REQUIRED are one short line each. ABOUT THE ROLE is 2-3 flowing sentences. KEY RESPONSIBILITIES has 6-8 bullets (use the provided ones first, then add realistic ones for this exact role). REQUIRED QUALIFICATIONS has 3-5 bullets including the experience level. TECHNICAL / FUNCTIONAL SKILLS and PREFERRED SKILLS are short bullets. KEY COMPETENCIES has 4-5 bullets suited to the level. REPORTING STRUCTURE is one sentence. ABOUT MAXVOLT ENERGY is 2-3 sentences.\nOmit COMPENSATION RANGE unless a disclosed CTC is given. Use only the facts below.\n\nREQUISITION DETAILS:\n${ctxText(rec, masters)}\n${rec.disclose_ctc && M.ctcLabel(rec) ? `Disclosed compensation: ${M.ctcLabel(rec)}\n` : ''}Reports to: ${ctx.reportsToName || ctx.hiringManagerName}\n${action === 'regenerate' ? 'Write a fresh variation with different wording from the earlier draft.\n' : ''}\nReturn ONLY the job description as plain text.`;
        text = cleanAiText(await callAI(prompt, { system: JD_SYSTEM, maxTokens: 2600 }));
        if (!refining && !M.jdLooksComplete(text)) { console.warn('[mrf] AI JD incomplete — using the form-based draft'); text = ''; }
      } catch (e) { console.warn('[mrf] JD AI failed:', e.message); text = ''; }
    }
    if (!text) {
      if (refining) return fail(res, 'AI is not available right now (or AI Features are not enabled in your Settings), so this refinement could not be done. You can edit the text manually.');
      text = M.templateJd(rec, ctx); source = 'template'; note = 'AI unavailable — drafted from the form details';
    }
    const r = applyJd(rec, cx, text, source, action, note);
    if (r.error) return fail(res, r.error, 403);
    rec.jd_status = rec.approved_jd ? 'approved' : 'draft';
    await save(rec, cx.cu.id);
    return res.json({ success: true, text, version: r.version, source, note, invalidated: r.invalidated, requisition: view(rec, P, cx) });
  },

  async mrf_jd_save({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    const text = String(p.text || '').trim(); if (!text) return fail(res, 'The Job Description cannot be empty');
    if (text.length > 20000) return fail(res, 'The Job Description is too long');
    if (text === (rec.jd_current_text || '').trim()) return res.json({ success: true, unchanged: true, requisition: view(rec, await people(), cx) });
    const r = applyJd(rec, cx, text, 'manual', 'edit', String(p.note || '').slice(0, 300));
    if (r.error) return fail(res, r.error, 403);
    await save(rec, cx.cu.id);
    if (r.invalidated) await notify(await hrAudience(), { title: 'JD changed — approval voided', message: `The Hiring Manager changed the approved JD of ${label(rec)}. It is no longer published until they approve it again.`, type: 'warning' });
    return res.json({ success: true, version: r.version, invalidated: r.invalidated, requisition: view(rec, await people(), cx) });
  },

  // ── the Hiring Manager's decision — nobody else can make it ──
  async mrf_hm_decide({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!isHm(rec, cx)) return fail(res, 'Only the designated Hiring Manager can approve, reject or send back this requisition.', 403);
    if (rec.status !== 'pending_hm_approval') return fail(res, `This requisition is ${rec.status.replace(/_/g, ' ')} — there is nothing to decide.`);
    const action = p.action; const comment = String(p.comment || '').trim().slice(0, 1000);
    const P = await people();
    if (action === 'approve') {
      const cur = (rec.jd_versions || []).length;
      if (!cur || !String(rec.jd_current_text || '').trim()) return fail(res, 'There is no Job Description to approve.');
      if (Number(p.version) !== cur) return fail(res, 'The Job Description changed while you were reviewing. Reload and approve the latest version.', 409);
      const v = rec.jd_versions[cur - 1];
      rec.approved_jd = { version: v.version, text: v.text, hash: v.hash, approved_by: cx.cu.id, approved_by_name: cx.name, approved_at: nowIso() };
      rec.jd_status = 'approved'; rec.jd_approved_by = cx.cu.id; rec.jd_approved_date = rec.approved_jd.approved_at; rec.ai_job_description = v.text;
      rec.status = 'pending_hr_publication'; rec.hm_approved_at = rec.approved_jd.approved_at; rec.hm_comment = comment; rec.unpublished_reason = '';
      addAudit(rec, cx, 'jd_approved', `Approved version ${v.version}${comment ? ' — ' + comment : ''}`, { version: v.version, hash: v.hash });
      const head = await startDeptHeadApproval(rec, await loadRulesConfig());
      await save(rec, cx.cu.id);
      if (head) await notify([head], { title: 'Requisition needs your approval', message: `${label(rec)} was approved by the Hiring Manager and needs your approval as Department Head.`, link: `/ManpowerRequisitions?open=${rec.id}`, type: 'warning' });
      await notify(await hrAudience(), { title: rec.dh_approval?.status === 'pending' ? 'Requisition awaiting Department Head' : 'Requisition ready to publish', message: `${cx.name} approved the Job Description for ${label(rec)}. ${rec.dh_approval?.status === 'pending' ? 'The Department Head has to approve it before publication.' : 'It is waiting for HR publication.'}`, type: 'success' });
      if (!isCreator(rec, cx)) await notify([rec.requested_by], { title: 'Requisition approved', message: `${label(rec)} was approved by the Hiring Manager and is now with HR for publication.`, type: 'success' });
    } else if (action === 'request_changes') {
      if (!comment) return fail(res, 'Tell the creator what to change.');
      rec.status = 'changes_requested'; rec.changes_request = { by: cx.cu.id, by_name: cx.name, comment, at: nowIso(), from: 'hiring_manager' };
      addAudit(rec, cx, 'changes_requested', comment);
      await save(rec, cx.cu.id);
      if (!isCreator(rec, cx)) await notify([rec.requested_by], { title: 'Changes requested on your requisition', message: `${cx.name}: ${comment}`, type: 'warning' });
    } else if (action === 'reject') {
      if (!comment) return fail(res, 'Give a reason for rejecting the requisition.');
      rec.status = 'rejected'; rec.rejection_reason = comment; rec.manager_approval_status = 'rejected';
      addAudit(rec, cx, 'rejected', comment);
      await save(rec, cx.cu.id);
      await notify([rec.requested_by, ...(await hrAudience())], { title: 'Requisition rejected', message: `${label(rec)} was rejected by the Hiring Manager: ${comment}`, type: 'error' });
    } else return fail(res, 'Unknown action');
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  // ── HR: publication and logistics. Never the JD. ──
  async mrf_hr_action({ p, cx, res }) {
    if (!hasAny(cx, PUBLISH_ROLES)) return fail(res, 'Only HR can publish or return requisitions.', 403);
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    const P = await people(); const action = p.action; const comment = String(p.comment || '').trim().slice(0, 1000);
    const stakeholders = [rec.requested_by, rec.hiring_manager_id];
    if (action === 'publish') {
      if (!['pending_hr_publication', 'on_hold'].includes(rec.status)) return fail(res, 'Only an approved requisition can be published.');
      if (!rec.approved_jd) return fail(res, 'The Job Description is not approved — the Hiring Manager must approve it before publication.');
      if (rec.hm_approved_at == null) return fail(res, 'Hiring Manager approval is missing.');
      const rules = await loadRulesConfig();
      if (VR.needsDeptHeadApproval(rec, rules) && !deptHeadCleared(rec)) {
        if (rec.dh_approval?.status !== 'pending' || rec.dh_approval.jd_version !== rec.approved_jd.version) { const head = await startDeptHeadApproval(rec, rules); await save(rec, cx.cu.id); if (head) await notify([head], { title: 'Requisition needs your approval', message: `${label(rec)} needs your approval as Department Head.`, link: `/ManpowerRequisitions?open=${rec.id}`, type: 'warning' }); }
        if (!deptHeadCleared(rec)) return fail(res, rec.dh_approval.head_user_id ? `The Department Head (${P.name(rec.dh_approval.head_user_id)}) has to approve this requisition before it can be published.` : `No Department Head is set for ${rec.department}. An admin can record the approval.`);
      }
      const channels = Array.isArray(p.channels) ? p.channels.map((c) => String(c).slice(0, 60)).filter(Boolean).slice(0, 12) : ['Careers page'];
      rec.status = 'published'; rec.is_published = true; rec.published_date = nowIso(); rec.published_by = cx.cu.id; rec.publish_channels = channels.length ? channels : ['Careers page'];
      rec.application_deadline = /^\d{4}-\d{2}-\d{2}$/.test(p.application_deadline || '') ? new Date(p.application_deadline).toISOString() : null;
      rec.hr_notes = String(p.notes ?? rec.hr_notes ?? '').slice(0, 1000); rec.ai_job_description = rec.approved_jd.text; rec.unpublished_reason = '';
      addAudit(rec, cx, 'published', `Channels: ${rec.publish_channels.join(', ')}${rec.application_deadline ? ' · deadline ' + rec.application_deadline.slice(0, 10) : ''}`);
      await save(rec, cx.cu.id);
      await notify(stakeholders, { title: 'Requisition published', message: `${label(rec)} is now live on: ${rec.publish_channels.join(', ')}.`, type: 'success' });
    } else if (action === 'save_unpublished') {
      rec.hr_notes = String(p.notes || '').slice(0, 1000); rec.publish_channels = Array.isArray(p.channels) ? p.channels.map((c) => String(c).slice(0, 60)).slice(0, 12) : rec.publish_channels;
      addAudit(rec, cx, 'hr_notes_saved', 'Saved without publishing'); await save(rec, cx.cu.id);
    } else if (action === 'return') {
      if (!['pending_hr_publication', 'published', 'on_hold'].includes(rec.status)) return fail(res, 'This requisition cannot be returned now.');
      if (!comment) return fail(res, 'Explain what needs to be corrected.');
      const toHm = p.to === 'hiring_manager';
      rec.status = toHm ? 'pending_hm_approval' : 'changes_requested'; rec.is_published = false;
      if (toHm) { rec.approved_jd && (rec.jd_approval_history = [...(rec.jd_approval_history || []), { ...rec.approved_jd, voided_at: nowIso(), voided_by: cx.cu.id, voided_by_name: cx.name, voided_reason: `Returned by HR: ${comment}` }]); rec.approved_jd = null; rec.jd_status = 'draft'; }
      rec.changes_request = { by: cx.cu.id, by_name: cx.name, comment, at: nowIso(), from: 'hr', to: toHm ? 'hiring_manager' : 'creator' };
      addAudit(rec, cx, toHm ? 'returned_to_hiring_manager' : 'returned_to_creator', comment);
      await save(rec, cx.cu.id);
      await notify(toHm ? [rec.hiring_manager_id] : [rec.requested_by, ...(rec.requested_by === rec.hiring_manager_id ? [] : [rec.hiring_manager_id])], { title: 'HR returned a requisition', message: `${label(rec)}: ${comment}`, type: 'warning' });
    } else return fail(res, 'Unknown action');
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  // hold / resume / filled / close / cancel (HR; the creator may withdraw their own requisition before it is published)
  async mrf_status({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    const to = p.to; const reason = String(p.reason || '').trim().slice(0, 500);
    const hr = hasAny(cx, PUBLISH_ROLES);
    const withdraw = to === 'cancelled' && isCreator(rec, cx) && ['draft', 'pending_hm_approval', 'changes_requested'].includes(rec.status);
    if (!hr && !withdraw) return fail(res, 'Only HR can change the status of a requisition.', 403);
    const P = await people(); const before = rec.status;
    if (to === 'reopen') {
      if (!['closed', 'cancelled', 'rejected'].includes(rec.status)) return fail(res, 'Only a closed, cancelled or rejected requisition can be reopened.');
      if (reason.length < 3) return fail(res, 'Give a reason for reopening.');
      const total = Number(rec.number_of_positions) || 1, done = Number(rec.positions_filled) || 0;
      let added = Math.floor(Number(p.count) || 0);
      if (done >= total && added < 1) return fail(res, 'Every position is filled — say how many positions to add.');
      added = Math.max(0, Math.min(500, added));
      rec.reopen_history = [...(rec.reopen_history || []), { at: nowIso(), by: cx.cu.id, by_name: cx.name, from: before, closed_at: rec.closed_at || null, closed_reason: rec.closed_reason || null, cancelled_at: rec.cancelled_at || null, reason: reason || rec.cancel_reason || '', positions_added: added }];
      rec.number_of_positions = total + added; rec.reopened_at = nowIso();
      rec.status = rec.approved_jd ? 'pending_hr_publication' : 'changes_requested'; rec.is_published = false;
      if (!rec.approved_jd) rec.changes_request = { by: cx.cu.id, by_name: cx.name, comment: `Reopened: ${reason}. Check the details (the target date must be 15–45 days from resubmission) and submit again.`, at: nowIso(), from: 'hr', to: 'creator' };
      delete rec.closed_at; delete rec.closed_reason; delete rec.cancelled_at; delete rec.cancel_reason;
      if (rec.closed_date_source !== 'recorded') delete rec.closed_date;
    }
    else if (to === 'withdraw_positions') {
      if (!['published', 'on_hold', 'pending_hr_publication'].includes(rec.status)) return fail(res, 'Positions can only be withdrawn from an approved requisition.');
      if (reason.length < 3) return fail(res, 'Give a reason for withdrawing positions.');
      const total = Number(rec.number_of_positions) || 1, done = Number(rec.positions_filled) || 0, n = Math.floor(Number(p.count) || 0);
      const most = total - Math.max(1, done);
      if (n < 1 || n > most) return fail(res, most > 0 ? `You can withdraw 1 to ${most} position(s).` : 'To withdraw the last open position, cancel the requisition (or close it if the others are filled).');
      rec.number_of_positions = total - n; rec.positions_withdrawn = (Number(rec.positions_withdrawn) || 0) + n;
      if (done >= rec.number_of_positions) { rec.status = 'closed'; rec.closed_reason = 'filled'; rec.closed_at = nowIso(); rec.is_published = false; }
    }
    else if (to === 'on_hold') { if (!['published', 'pending_hr_publication'].includes(rec.status)) return fail(res, 'Only an approved or published requisition can be put on hold.'); rec.status_before_hold = rec.status; rec.status = 'on_hold'; rec.is_published = false; }
    else if (to === 'resume') { if (rec.status !== 'on_hold') return fail(res, 'This requisition is not on hold.'); rec.status = rec.status_before_hold === 'published' ? 'published' : 'pending_hr_publication'; rec.is_published = rec.status === 'published'; }
    else if (to === 'filled' && Number(rec.number_of_positions) > 1 && !p.all) {
      if (!['published', 'on_hold', 'pending_hr_publication'].includes(rec.status)) return fail(res, 'This requisition cannot be closed now.');
      const n = Math.floor(Number(p.count) || 0); const left = (Number(rec.number_of_positions) || 1) - (Number(rec.positions_filled) || 0);
      if (n < 1 || n > left) return fail(res, `Enter how many positions were filled (1 to ${left}).`);
      rec.positions_filled = (Number(rec.positions_filled) || 0) + n;
      if (rec.positions_filled >= Number(rec.number_of_positions)) { rec.status = 'closed'; rec.closed_reason = 'filled'; rec.closed_at = nowIso(); rec.is_published = false; }
    }
    else if (to === 'filled' || to === 'closed') { if (!['published', 'on_hold', 'pending_hr_publication'].includes(rec.status)) return fail(res, 'This requisition cannot be closed now.'); rec.status = 'closed'; rec.closed_reason = to; rec.closed_at = nowIso(); rec.is_published = false; if (to === 'filled') rec.positions_filled = Number(rec.number_of_positions) || 1; }
    else if (to === 'cancelled') { if (['closed', 'cancelled', 'rejected'].includes(rec.status)) return fail(res, 'This requisition is already finished.'); if (!reason) return fail(res, 'Give a reason for cancelling.'); rec.status = 'cancelled'; rec.cancelled_at = nowIso(); rec.cancel_reason = reason; rec.is_published = false; }
    else return fail(res, 'Unknown status');
    addAudit(rec, cx, `status_${to}`, `${before} → ${rec.status}${to === 'filled' ? ` (${rec.positions_filled || 0}/${rec.number_of_positions} filled)` : ''}${reason ? ' — ' + reason : ''}`);
    await save(rec, cx.cu.id);
    const word = { reopen: 'reopened', withdraw_positions: `reduced to ${rec.number_of_positions} position(s)`, on_hold: 'put on hold', resume: 'resumed', filled: rec.status === 'closed' ? 'marked as filled' : `updated — ${rec.positions_filled} of ${rec.number_of_positions} positions filled`, closed: 'closed', cancelled: 'cancelled' }[to];
    await notify([rec.requested_by, rec.hiring_manager_id, ...(to === 'cancelled' ? await hrAudience() : [])], { title: `Requisition ${word}`, message: `${label(rec)} was ${word} by ${cx.name}${reason ? ': ' + reason : '.'}`, type: to === 'filled' ? 'success' : 'info' });
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  // The named Hiring Manager left or moved: HR / admin / management can name another one while the JD is not yet approved.
  async mrf_reassign_hm({ p, cx, res }) {
    if (!hasAny(cx, ['hr', 'admin', 'management'])) return fail(res, 'Only HR, admin or management can change the Hiring Manager.', 403);
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!['draft', 'changes_requested', 'pending_hm_approval'].includes(rec.status)) return fail(res, 'The Job Description is already approved — the Hiring Manager can no longer be changed.');
    const P = await people(); const bad = await checkHiringManager(rec.department, p.hiring_manager_id, P); if (bad) return fail(res, bad);
    const reason = String(p.reason || '').trim(); if (reason.length < 3) return fail(res, 'Give a reason for the change.');
    const old = rec.hiring_manager_id; rec.hiring_manager_id = p.hiring_manager_id; if (!rec.reports_to_user_id || rec.reports_to_user_id === old) rec.reports_to_user_id = p.hiring_manager_id;
    rec.hiring_manager_name = P.name(p.hiring_manager_id);
    addAudit(rec, cx, 'hiring_manager_changed', `${P.name(old) || '—'} → ${P.name(p.hiring_manager_id)} — ${reason}`);
    await save(rec, cx.cu.id);
    await notify([p.hiring_manager_id], { title: rec.status === 'pending_hm_approval' ? 'Job Description needs your approval' : 'You are now the Hiring Manager', message: `${cx.name} named you Hiring Manager for ${label(rec)}.`, type: 'warning' });
    await notify([old, rec.requested_by], { title: 'Hiring Manager changed', message: `${label(rec)}: new Hiring Manager is ${P.name(p.hiring_manager_id)}.`, email: false });
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  // Department Head step (only when the validation rules ask for it).
  async mrf_dh_decide({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (rec.status !== 'pending_hr_publication' || rec.dh_approval?.status !== 'pending') return fail(res, 'There is no Department Head approval waiting on this requisition.');
    const head = await deptHeadOf(rec.department);
    if (!(head ? head === cx.cu.id : hasAny(cx, ['admin']))) return fail(res, head ? 'Only the Department Head can decide this.' : 'No Department Head is set — only an admin can record this approval.', 403);
    const comment = String(p.comment || '').trim().slice(0, 1000);
    if (p.action === 'approve') {
      rec.dh_approval = { ...rec.dh_approval, status: 'approved', head_user_id: head, jd_version: rec.approved_jd?.version || null, by: cx.cu.id, by_name: cx.name, at: nowIso(), comment };
      addAudit(rec, cx, 'department_head_approved', comment || 'Approved by the Department Head');
      await save(rec, cx.cu.id);
      await notify([...(await hrAudience()), rec.requested_by], { title: 'Department Head approved', message: `${cx.name} approved ${label(rec)}. HR can publish it.`, type: 'success' });
    } else if (p.action === 'send_back') {
      if (!comment) return fail(res, 'Say what needs to change.');
      rec.jd_approval_history = [...(rec.jd_approval_history || []), { ...rec.approved_jd, voided_at: nowIso(), voided_by: cx.cu.id, voided_by_name: cx.name, voided_reason: `Sent back by the Department Head: ${comment}` }];
      rec.approved_jd = null; rec.jd_status = 'draft'; rec.dh_approval = null; rec.status = 'changes_requested';
      rec.changes_request = { by: cx.cu.id, by_name: cx.name, comment, at: nowIso(), from: 'department_head', to: 'creator' };
      addAudit(rec, cx, 'department_head_sent_back', comment);
      await save(rec, cx.cu.id);
      await notify([rec.requested_by, rec.hiring_manager_id, ...(await hrAudience())], { title: 'Department Head sent a requisition back', message: `${label(rec)}: ${comment}`, type: 'warning' });
    } else return fail(res, 'Unknown action');
    return res.json({ success: true, requisition: view(rec, await people(), cx) });
  },

  async mrf_comment({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!canSee(rec, cx)) return fail(res, 'You do not have access to this requisition', 403);
    const text = String(p.text || '').trim().slice(0, 1000); if (text.length < 2) return fail(res, 'Write the comment.');
    addAudit(rec, cx, 'comment', text);
    await save(rec, cx.cu.id);
    await notify([rec.requested_by, rec.hiring_manager_id].filter((x) => x !== cx.cu.id), { title: 'Comment on a requisition', message: `${cx.name} on ${label(rec)}: ${text}`, link: `/ManpowerRequisitions?open=${rec.id}`, email: false });
    return res.json({ success: true, requisition: view(rec, await people(), cx) });
  },

  async mrf_assign_recruiter({ p, cx, res }) {
    if (!hasAny(cx, HR)) return fail(res, 'Only HR or admin can assign a recruiter.', 403);
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    const P = await people(); const id = String(p.recruiter_id || '');
    if (id && !roleList(P.byUser[id]).some((r) => PUBLISH_ROLES.includes(r))) return fail(res, 'Choose a person with an HR or recruiter role.');
    const old = rec.recruiter_id;
    rec.recruiter_id = id;
    addAudit(rec, cx, 'recruiter_assigned', `${P.name(old) || '—'} → ${P.name(id) || '—'}`);
    await save(rec, cx.cu.id);
    if (id && id !== cx.cu.id) await notify([id], { title: 'Requisition assigned to you', message: `${cx.name} assigned ${label(rec)} to you.`, link: `/ManpowerRequisitions?open=${rec.id}` });
    return res.json({ success: true, requisition: view(rec, P, cx) });
  },

  async mrf_rules_get({ cx, res }) {
    if (!hasAny(cx, HR)) return fail(res, 'HR or admin access required', 403);
    const masters = await loadMasters();
    return res.json({ success: true, config: await loadRulesConfig(), rules: VR.RULES, sla_labels: VR.SLA_LABELS, tiers: (masters.position_tier || []).map((m) => ({ value: m.value, label: m.label })), dept_head_modes: VR.DH_APPROVAL_MODES });
  },
  async mrf_rules_save({ p, cx, res }) {
    if (!hasAny(cx, HR)) return fail(res, 'HR or admin access required', 403);
    const problems = VR.configProblems(p.config); if (problems.length) return res.json({ success: false, error: problems[0], errors: problems });
    const before = await loadRulesConfig();
    const config = VR.normalizeConfig({ ...before, ...(p.config || {}) });
    const old = jparse((await one("SELECT data FROM entities WHERE type=$1 AND id=$2", [CFG_TYPE, CFG_ID]))?.data) || {};
    const changed = Object.keys(config).filter((k) => JSON.stringify(config[k]) !== JSON.stringify(before[k]));
    const data = { id: CFG_ID, ...config, history: [...(old.history || []), { at: nowIso(), by: cx.cu.id, by_name: cx.name, changed, previous: Object.fromEntries(changed.map((k) => [k, before[k]])) }].slice(-100) };
    const have = await one("SELECT id FROM entities WHERE type=$1 AND id=$2", [CFG_TYPE, CFG_ID]);
    if (have) await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(data), CFG_ID]);
    else await run("INSERT INTO entities(id,type,status,is_active,data) VALUES($1,$2,'active',1,$3)", [CFG_ID, CFG_TYPE, JSON.stringify(data)]);
    return res.json({ success: true, config: await loadRulesConfig() });
  },

  // Where the hiring stands: candidates linked to this requisition, by stage.
  async mrf_pipeline({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!canSee(rec, cx)) return fail(res, 'You do not have access to this requisition', 403);
    const STAGES = ['applied', 'screening', 'shortlisted', 'cv_sent', 'interview_recommended', 'interview_scheduled', 'interviewed', 'next_round_recommended', 'selected', 'offer_in_progress', 'offered', 'offer_accepted', 'joined', 'on_hold', 'rejected', 'offer_declined', 'withdrawn'];
    const by = {}; let total = 0;
    for (const r of await all("SELECT data FROM entities WHERE type='Candidate'")) { const c = jparse(r.data); if (!c || (c.requisition_id || c.job_requisition_id || c.job_id) !== rec.id) continue; total++; by[c.status || 'applied'] = (by[c.status || 'applied'] || 0) + 1; }
    return res.json({ success: true, total, by_stage: STAGES.filter((k) => by[k]).map((k) => ({ stage: k, count: by[k] })), positions: Number(rec.number_of_positions) || 1, filled: Number(rec.positions_filled) || 0 });
  },

  async mrf_extend_target({ p, cx, res }) {
    if (!hasAny(cx, PUBLISH_ROLES)) return fail(res, 'Only HR can change the target hiring date.', 403);
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return fail(res, 'Choose a date');
    const old = rec.target_hire_date; rec.target_hire_date = p.date; rec.target_hire_date_reminded = null;
    addAudit(rec, cx, 'target_date_changed', `${old || '—'} → ${p.date}${p.note ? ' — ' + p.note : ''}`); await save(rec, cx.cu.id);
    return res.json({ success: true, requisition: view(rec, await people(), cx) });
  },

  async mrf_get({ p, cx, res }) {
    const rec = await load(p.id); if (!rec) return fail(res, 'Requisition not found', 404);
    if (!canSee(rec, cx)) return fail(res, 'You do not have access to this requisition', 403);
    const P = await people();
    const out = view(rec, P, cx);
    const rules = await loadRulesConfig(); const head = await deptHeadOf(rec.department);
    // a draft or returned form shows the checks as they stand now; later stages keep what was recorded
    if (['draft', 'changes_requested', 'pending_hm_approval', 'pending_hr_publication'].includes(rec.status)) out.live_flags = forViewer((await flagsFor(rec, rec, P, await loadMasters())).flags, cx);
    out.department_head_name = P.name(head); out.recruiter_name = P.name(rec.recruiter_id);
    out.dh_required = VR.needsDeptHeadApproval(rec, rules);
    if (hasAny(cx, HR)) out.recruiter_options = Object.values(P.byUser).filter((u) => roleList(u).some((r) => PUBLISH_ROLES.includes(r)) && !String(u.email || '').includes('.disabled-')).map((u) => ({ user_id: u.id, name: P.name(u.id) })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    out.applications = (await applicationCounts())[rec.id] || 0;
    out.permissions = {
      creator: isCreator(rec, cx), hiring_manager: isHm(rec, cx), publisher: hasAny(cx, PUBLISH_ROLES), hr: hasAny(cx, HR),
      can_edit_details: isCreator(rec, cx) && M.JD_EDITABLE_BY_CREATOR.includes(rec.status),
      can_edit_jd: isHm(rec, cx) && !['closed', 'cancelled', 'rejected'].includes(rec.status),
      can_generate_jd: (isHm(rec, cx) || (isCreator(rec, cx) && M.JD_EDITABLE_BY_CREATOR.includes(rec.status))) && !['closed', 'cancelled', 'rejected'].includes(rec.status),
      can_decide: isHm(rec, cx) && rec.status === 'pending_hm_approval',
      can_reassign_hm: hasAny(cx, ['hr', 'admin', 'management']) && ['draft', 'changes_requested', 'pending_hm_approval'].includes(rec.status),
      can_override: VR.canOverride(cx.roles, rules),
      sees_candidates: hasFullCandidateAccess(cx.roles) || isHm(rec, cx),
      can_dh_decide: rec.status === 'pending_hr_publication' && rec.dh_approval?.status === 'pending' && (head ? head === cx.cu.id : hasAny(cx, ['admin'])),
    };
    return res.json({ success: true, requisition: out });
  },

  // ── Recruitment MIS: matrix, funnel, KPIs, bottlenecks and comparisons, all computed from the live records ──
  async mrf_mis({ p, cx, res }) {
    const out = await misFor(p, cx);
    if (!out) return fail(res, 'You do not have any requisitions to report on', 403);
    return res.json({ success: true, ...out });
  },
  async mrf_mis_export({ p, cx, res }) {
    const out = await misFor(p, cx);
    if (!out) return fail(res, 'You do not have any requisitions to report on', 403);
    const used = filtersUsed(p.filters, out.options);
    const ExcelJS = (await import('exceljs')).default;
    const wb = await buildMrfMisWorkbook(out, ExcelJS, { subtitle: [used.length ? used.join(' · ') : 'All requisitions', out.org_wide ? '' : `your requisitions only (${cx.name})`].filter(Boolean).join(' · ') });
    const buffer = await wb.xlsx.writeBuffer();
    return res.json({ success: true, base64: Buffer.from(buffer).toString('base64'), filename: `MRF_Recruitment_MIS_${out.today}.xlsx`, mime: XLSX_MIME });
  },
  // Formatted matrix and funnel report: one requisition (requisition_id), or every requisition submitted in a month (month = YYYY-MM)
  async mrf_funnel_report({ p, cx, res }) {
    const range = p.requisition_id ? null : monthRange(p.month);
    if (!p.requisition_id && !range) return fail(res, 'Choose a requisition or a month');
    // the month replaces any date filter on screen; the other filters still narrow the month
    const { fy, from, to, mrf_id, ...others } = p.filters || {};
    const filters = range ? { ...others, ...range } : { mrf_id: p.requisition_id };
    const out = await misFor({ filters }, cx);
    if (!out) return fail(res, 'You do not have any requisitions to report on', 403);
    const ExcelJS = (await import('exceljs')).default;
    const by = [cx.name, out.org_wide ? '' : '(own requisitions only)'].filter(Boolean).join(' ');
    const used = range ? filtersUsed(others, out.options) : [];
    const wb = range ? buildMonthWorkbook(out, ExcelJS, { month: p.month, by, filtersText: used.length ? `Filtered by ${used.join(', ')}` : '' }) : buildRequisitionWorkbook(out, ExcelJS, { requisitionId: p.requisition_id, by });
    if (!wb) return fail(res, range ? `No requisition was submitted in ${monthLabel(p.month)}${used.length ? ' for the chosen filters' : ''}` : 'Requisition not found', 404);
    const buffer = await wb.xlsx.writeBuffer();
    const tag = range ? monthLabel(p.month).replace(' ', '_') : String(out.mrfs[0].mrf_no || out.mrfs[0].designation || 'Requisition').replace(/[^\w-]+/g, '_');
    return res.json({ success: true, base64: Buffer.from(buffer).toString('base64'), filename: `Recruitment_Funnel_${tag}.xlsx`, mime: XLSX_MIME });
  },
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const filtersUsed = (filters, options) => Object.entries(filters || {}).filter(([, v]) => v && v !== 'all').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Object.values(options).flat().find((o) => o?.value === v)?.label || v}`);

/** HR, admin, management and recruiters see everything; others only the requisitions they raised, manage or head. */
async function misFor(p, cx) {
  const D = await loadHiringData();
  const orgWide = isOrgWide(cx);
  const scope = orgWide ? { all: true } : { user_id: cx.cu.id, departments: [...cx.headOf] };
  if (!orgWide && !cx.headOf.size && !D.reqs.some((r) => r.requested_by === cx.cu.id || r.hiring_manager_id === cx.cu.id)) return null;
  const users = await all("SELECT id, full_name, email FROM users");
  const config = await loadRulesConfig();
  const candidatesVisible = hasFullCandidateAccess(cx.roles) ? () => true : (r) => r.hiring_manager_id === cx.cu.id;
  const out = computeMrfMis(D, { filters: p.filters || {}, scope, candidatesVisible, sla: config.sla, masters: await loadMasters(true), userNames: Object.fromEntries(users.map((u) => [u.id, u.full_name || u.email])) });
  return { ...out, org_wide: orgWide };
}

export async function handleMrf(name, p, cu, res) {
  if (!cu) return fail(res, 'Unauthorized', 401);
  const u = await one('SELECT role, custom_role, full_name, email FROM users WHERE id=$1', [cu.id]);
  if (!u) return fail(res, 'Unauthorized', 401);
  const P = await people();
  const headOf = new Set((await departments()).filter((d) => d.head_user_id === cu.id).map((d) => d.name));
  const cx = { cu, roles: roleList(u), name: P.name(cu.id) || u.full_name || u.email || '', headOf };
  const fn = H[name];
  if (!fn) return fail(res, `Unknown function ${name}`, 404);
  try { return await fn({ p: p || {}, cx, res }); }
  catch (e) { console.error(`[mrf/${name}]`, e); if (!res.headersSent) return fail(res, e.message || 'Something went wrong', 500); }
}

/**
 * The public job portal never names a person. Names of the hiring manager / reporting person / requester are replaced by the
 * reporting person's designation, or the sentence is dropped when there is no designation to show.
 */
export function scrubPersonNames(text, names, designation) {
  const BS = String.fromCharCode(92); const esc = (n) => n.trim().split(/ +/).map((w) => w.split('').map((c) => ('.*+?^${}()|[]' + BS).includes(c) ? BS + c : c).join('')).join(' +');
  const list = [...new Set((names || []).map((n) => String(n || '').trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  let t = String(text || '');
  for (const n of list) {
    const hit = new RegExp(esc(n), 'i'); const all = new RegExp(esc(n), 'gi');
    if (!hit.test(t)) continue;
    t = t.split('\n').map((line) => {
      if (!hit.test(line)) return line;
      if (designation) return line.replace(all, designation);
      return line.split(/(?<=[.!?])\s+/).filter((sn) => !hit.test(sn)).join(' ').trim();
    }).join('\n');
  }
  return t.replace(/\n{3,}/g, '\n\n').replace(/^REPORTING STRUCTURE\n(?=\n|$)/m, 'REPORTING STRUCTURE\nReports within the department as directed by the Hiring Manager.\n');
}

/** What the public careers page may see of a requisition — never CTC (unless disclosed), notes, audit or internal names. */
export function publicJob(j, extra = {}) {
  const jd = extra.names ? scrubPersonNames(j.ai_job_description || j.job_description || '', extra.names, extra.designation) : (j.ai_job_description || j.job_description);
  const base = {
    id: j.id, requisition_id: j.requisition_id, status: j.status, is_published: j.is_published, published_date: j.published_date, application_deadline: j.application_deadline,
    position_title: j.position_title, department: j.department, employment_type: j.employment_type, number_of_positions: j.number_of_positions, experience_required: j.experience_required, location: j.location,
    required_skills: j.required_skills, ai_job_description: jd, jd_status: j.jd_status, work_arrangement: j.work_arrangement,
    ...(extra.designation ? { reports_to_designation: extra.designation } : {}),
  };
  if (j.mrf_version === 2) return { ...base, mrf_version: 2, ...(j.disclose_ctc ? { salary_range_min: j.salary_range_min, salary_range_max: j.salary_range_max } : { salary_range_min: 0, salary_range_max: 0 }) };
  return { ...base, job_description: j.ai_job_description ? undefined : jd, salary_range_min: j.salary_range_min, salary_range_max: j.salary_range_max };
}
/** publicJob with the people named on the requisition resolved, so no name reaches the public page. */
export async function publicJobSafe(j) {
  const ids = [j.reports_to_user_id, j.hiring_manager_id, j.requested_by, j.created_by].filter(Boolean);
  const names = [j.reports_to_name, j.hiring_manager_name, j.requested_by_name, j.hiring_manager, j.manager_name];
  let designation = '';
  for (const id of [...new Set(ids)]) {
    const row = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [id]).catch(() => null);
    const e = row ? jparse(row.data) : null; if (!e) continue;
    names.push(e.display_name, e.full_name, e.first_name && e.last_name ? `${e.first_name} ${e.last_name}` : '');
    if (!designation && id === (j.reports_to_user_id || j.hiring_manager_id) && e.designation) designation = e.designation;
  }
  return publicJob(j, { names, designation });
}
/**
 * Recruitment -> requisition: when a candidate is marked JOINED against a manpower requisition, count one filled position (once per
 * candidate). When every vacancy is filled the requisition closes as filled and comes off the job portal.
 */
export async function mrfCandidateJoined(c, byUserId) {
  const rid = c?.requisition_id || c?.job_requisition_id || c?.job_id; if (!rid) return null;
  const unlock = await keyedLock(`mrf:join:${rid}`);
  try { return await countJoined(rid, c, byUserId); } finally { unlock(); }
}
async function countJoined(rid, c, byUserId) {
  const rec = await load(rid); if (!rec) return null;
  if ((rec.counted_candidates || []).includes(c.id)) return null;
  const sys = { cu: { id: byUserId || null }, name: 'Recruitment', roles: ['system'] };
  rec.counted_candidates = [...(rec.counted_candidates || []), c.id];
  const vacancies = Number(rec.number_of_positions) || 1;
  rec.positions_filled = Math.min(vacancies, (Number(rec.positions_filled) || 0) + 1);
  addAudit(rec, sys, 'candidate_joined', `${c.full_name || 'A candidate'} joined — ${rec.positions_filled} of ${vacancies} positions filled`);
  const closing = rec.positions_filled >= vacancies && ['published', 'on_hold', 'pending_hr_publication'].includes(rec.status);
  if (closing) { rec.status = 'closed'; rec.closed_reason = 'filled'; rec.closed_at = nowIso(); rec.is_published = false; addAudit(rec, sys, 'status_filled', 'All vacancies filled — requisition closed'); }
  await save(rec, byUserId);
  // the name goes only to those who may see candidate records; a requester who is neither gets the fact without it
  const tail = ` joined for ${label(rec)} (${rec.positions_filled}/${vacancies}).${closing ? ' All vacancies are filled and the job is closed.' : ''}`;
  const named = [rec.hiring_manager_id, ...(closing ? await hrAudience() : [])];
  const others = [rec.requested_by].filter((id) => id && !named.includes(id));
  const requester = others.length ? await one('SELECT role, custom_role FROM users WHERE id=$1', [others[0]]) : null;
  if (requester && hasFullCandidateAccess(roleList(requester))) named.push(...others.splice(0));
  const title = closing ? 'Requisition filled' : 'A position was filled';
  await notify(named, { title, message: `${c.full_name || 'A candidate'}${tail}`, type: 'success', email: closing });
  await notify(others, { title, message: `A candidate${tail}`, type: 'success', email: closing });
  return { filled: rec.positions_filled, vacancies, closed: closing };
}
export const _test = { H, applyJd };
