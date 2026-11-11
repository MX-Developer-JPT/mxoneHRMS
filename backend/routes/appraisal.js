// Performance Management & Appraisal — server side (every `ap_*` function; dispatched from functions.js).
//
// Design
//   • One ApReview row per employee per cycle (unique) carries the whole workflow: assignment, self-assessment, manager
//     evaluation, meeting state, scores and HR decision. Raw rows are NEVER served by the generic /api/entities route
//     (see PRIVATE_TYPES) — every read goes through viewReview(), which strips what the caller may not see.
//   • Status is derived from independent tracks (self / manager / meeting / HR) — nobody types a status in — and every
//     transition is checked here, so calling an API directly cannot skip a step.
//   • Scores are always recomputed on the server from the stored ratings; self, manager and HR-adjusted values are kept
//     separately and the pre-calibration manager score is never overwritten.
//   • Submitted self-assessments / manager evaluations are versioned (a reopen keeps the old version); every sensitive
//     action writes an append-only ApAudit row.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import * as A from '../utils/appraisal.js';

const HR = ['hr', 'admin'];
const T = { settings: 'ApSettings', cycle: 'ApCycle', template: 'ApTemplate', review: 'ApReview', meeting: 'ApMeeting', plan: 'ApDevPlan', goal: 'ApGoal', audit: 'ApAudit', notify: 'ApNotify' };
const now = () => new Date().toISOString();
const clean = (v, n = 2000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });

// ── storage helpers (JSON entities) ─────────────────────────
async function load(type, id) { if (!id) return null; const r = await one("SELECT data FROM entities WHERE type=$1 AND id=$2", [type, id]); return r ? jparse(r.data) : null; }
async function save(type, obj, userId = null, status = null) {
  obj.updated_at = now();
  const json = JSON.stringify(obj);
  const upd = await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE type=$3 AND id=$4", [json, status ?? obj.status ?? 'active', type, obj.id]);
  if (!upd.rowCount) await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,$2,$3,$4,$5)", [obj.id, type, userId, status ?? obj.status ?? 'active', json]);
  return obj;
}
async function list(type, where = '', params = []) { return (await all(`SELECT data FROM entities WHERE type='${type}' ${where}`, params)).map(r => jparse(r.data)).filter(Boolean); }

// one writer per review at a time (read-modify-write on a JSON row)
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release; const next = new Promise(r => { release = r; });
  locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === next || true) setTimeout(() => { if (locks.get(key) && locks.size > 500) locks.delete(key); }, 0); }
}

// ── people ─────────────────────────────────────────────────
async function people() {
  const rows = await all("SELECT user_id, status, data FROM entities WHERE type='Employee'");
  const list_ = []; const byUser = {};
  for (const r of rows) {
    const d = jparse(r.data); if (!d) continue; const uid = r.user_id || d.user_id; if (!uid) continue;
    const e = { user_id: uid, name: d.display_name || d.full_name || '', code: d.employee_code || '', department: d.department || '', designation: d.designation || '', category: d.employment_type || d.employee_category || d.category || '', joined: d.date_of_joining || '', status: d.status || r.status || 'active', manager_id: d.reporting_manager_id || '', location: d.work_location || '' };
    byUser[uid] = e; list_.push(e);
  }
  for (const e of list_) e.manager_name = byUser[e.manager_id]?.name || '';
  return { list: list_, byUser };
}
async function roleOf(cu) { if (!cu) return null; const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]); return u ? (u.custom_role || u.role) : null; }

async function ctxOf(cu) {
  const role = await roleOf(cu); const pp = await people();
  return { cu, role, hr: HR.includes(role), pp, down: A.downstreamIds(cu.id, pp.list) };
}

// ── settings, audit, notifications ──────────────────────────
async function getSettings() {
  const s = await load(T.settings, 'ap-settings');
  return { ...A.DEFAULT_SETTINGS, ...(s || {}), id: 'ap-settings' };
}
async function audit(cx, res, e) {
  const id = uuidv4();
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,$2,$3,'active',$4)", [id, T.audit, e.employee_id || null, JSON.stringify({
    id, at: now(), by: cx.cu.id, by_name: cx.pp.byUser[cx.cu.id]?.name || cx.cu.email || '', role: cx.role, ip: res?.req?.ip || '', ...e,
  })]);
}
async function notify(userIds, { title, message, link = '/Appraisal', key }) {
  const { sendPushToUser } = await import('../utils/push.js').catch(() => ({}));
  for (const uid of [...new Set(arr(userIds).filter(Boolean))]) {
    try {
      if (key) { const k = `ap-n:${key}:${uid}`; const ins = await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,$2,$3,'sent',$4) ON CONFLICT (id) DO NOTHING", [k, T.notify, uid, JSON.stringify({ id: k, at: now(), title })]); if (!ins.rowCount) continue; }
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,'info',$5)", [uuidv4(), uid, title, message, link]);
      if (sendPushToUser) sendPushToUser(uid, { title, message, type: 'info', link });
    } catch (e) { console.warn('[appraisal] notify failed:', e.message); }
  }
}

// ── views: what each caller may see ─────────────────────────
function accessFor(cx, review) {
  const a = A.reviewAccess({ review, userId: cx.cu.id, role: cx.role, downstream: cx.down });
  return { ...a, canEvaluate: a.evaluator };
}
function viewReview(cx, review, cycle) {
  const a = accessFor(cx, review);
  const v = JSON.parse(JSON.stringify(review));
  v.status = A.deriveStatus(v); v.status_label = A.STATUS_LABEL[v.status] || v.status;
  v.access = { own: a.own, evaluator: a.evaluator, hr: a.hr, can_evaluate: a.evaluator, can_view_all: a.hr || a.evaluator || a.chain };
  if (!a.hr) { delete v.hr; delete v.adjustments; v.self_versions = a.own ? v.self_versions : undefined; delete v.mgr_versions; }
  if (!a.hr && !a.evaluator) { if (v.mgr) delete v.mgr.confidential_note; }
  if (a.own && !a.hr) {
    // the employee sees the manager's evaluation only once HR has published results
    const released = v.hr_status === 'published' || v.hr_status === 'closed' || v.released;
    if (!released) { v.mgr = { status_only: true }; v.scores = { self: v.scores?.self ?? null, released: false }; v.employee_visible = false; }
    else { if (v.mgr) { delete v.mgr.confidential_note; } v.scores = { final: v.scores?.final, band: v.scores?.band, self: v.scores?.self, released: true }; v.employee_visible = true; }
    delete v.mgr_versions;
  }
  if (a.evaluator && !a.hr) delete v.hr;
  if (cycle) v.cycle = { id: cycle.id, name: cycle.name, financial_year: cycle.financial_year, type: cycle.type, status: cycle.status, review_start: cycle.review_start, review_end: cycle.review_end, deadlines: cycle.deadlines, settings: { scale: cycle.settings?.scale, bands: cycle.settings?.bands, competencies: cycle.settings?.competencies, split: cycle.settings?.split } };
  return v;
}
const summaryRow = (r) => ({
  id: r.id, cycle_id: r.cycle_id, user_id: r.user_id, name: r.emp?.name, code: r.emp?.code, department: r.emp?.department, designation: r.emp?.designation, manager_id: r.manager_id, manager_name: r.emp?.manager_name,
  status: A.deriveStatus(r), status_label: A.STATUS_LABEL[A.deriveStatus(r)], self_status: r.self_status || 'pending', mgr_status: r.mgr_status || 'pending', meeting_status: r.meeting_status || 'not_scheduled', hr_status: r.hr_status || 'pending',
  self_score: r.scores?.self ?? null, manager_score: r.scores?.manager ?? null, final_score: r.scores?.final ?? null, band: r.scores?.band ?? null, late_self: !!r.flags?.late_self, excluded: !!r.excluded,
});

// ── scoring (always recomputed from ratings) ─────────────────
function recompute(review, cycle) {
  const st = cycle.settings; const d = st.decimals;
  const items = review.assignment?.items || [];
  const selfR = Object.fromEntries(Object.entries(review.self?.kpis || {}).map(([k, v]) => [k, v.rating]));
  const mgrR = Object.fromEntries(Object.entries(review.mgr?.kpis || {}).map(([k, v]) => [k, v.rating]));
  const selfS = A.scoreKpis(items, selfR, st.scale, d);
  const kpiM = A.scoreKpis(items, mgrR, st.scale, d);
  const useComp = Number(st.split?.competency) > 0;
  const comp = useComp ? A.scoreCompetencies(st.competencies, review.mgr?.competencies || {}, st.scale, d) : { score: null, complete: true };
  const manager = A.combineScores({ kpi: kpiM.score, comp: comp.score, split: st.split, decimals: d });
  const prev = review.scores || {};
  const original = prev.original_manager ?? (manager !== null ? manager : null);
  const hrAdj = prev.hr_adjusted ?? null;
  const final = hrAdj !== null ? hrAdj : manager;
  review.scores = {
    self: selfS.score, self_rows: selfS.rows, kpi_manager: kpiM.score, manager_rows: kpiM.rows, competency: comp.score,
    manager, original_manager: manager !== null && prev.original_manager === undefined && review.mgr_status === 'submitted' ? manager : prev.original_manager ?? null,
    hr_adjusted: hrAdj, final, band: A.bandFor(final, st.bands), incomplete: manager === null, calculated_at: now(),
    gaps: A.ratingGaps(selfR, mgrR, st.large_gap),
  };
  void original;
  return review.scores;
}

// ── cycle helpers ────────────────────────────────────────────
async function loadCycle(id) { return load(T.cycle, id); }
function cycleEditable(c) { return ['draft', 'configured'].includes(c.status); }
const sanitizeCycle = (p, prev = {}) => {
  const dl = p.deadlines || {};
  return {
    ...prev,
    name: clean(p.name, 120), financial_year: clean(p.financial_year, 20), type: A.CYCLE_TYPES.includes(p.type) ? p.type : (prev.type || 'annual'),
    review_start: clean(p.review_start, 10), review_end: clean(p.review_end, 10),
    deadlines: { self: clean(dl.self, 10), manager: clean(dl.manager, 10), meeting: clean(dl.meeting, 10), hr: clean(dl.hr, 10) },
    eligibility: { departments: arr(p.eligibility?.departments).map(x => clean(x, 80)), designations: arr(p.eligibility?.designations).map(x => clean(x, 80)), categories: arr(p.eligibility?.categories).map(x => clean(x, 60)), joined_on_or_before: clean(p.eligibility?.joined_on_or_before, 10) },
    methodology: clean(p.methodology, 400) || 'KPI/KRA weighted score', template_id: clean(p.template_id, 60), include_competencies: !!p.include_competencies,
    allow_late_submission: p.allow_late_submission !== false, meeting_required: p.meeting_required !== false, notes: clean(p.notes, 1000),
  };
};
const cycleProblems = (c) => {
  const e = []; const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!c.name) e.push('Cycle name is required'); if (!c.financial_year) e.push('Financial year is required');
  for (const [k, v] of [['review_start', c.review_start], ['review_end', c.review_end], ['self deadline', c.deadlines?.self], ['manager deadline', c.deadlines?.manager], ['meeting deadline', c.deadlines?.meeting], ['HR deadline', c.deadlines?.hr]]) if (!ymd.test(v || '')) e.push(`${k} must be a date`);
  if (!e.length) { if (c.review_end < c.review_start) e.push('Review end is before review start'); if (c.deadlines.hr < c.deadlines.manager) e.push('HR deadline is before the manager deadline'); }
  return e;
};

// ── template helpers ─────────────────────────────────────────
function cleanItems(items) {
  let kc = 0, pc = 0;
  return arr(items).map(k => ({
    id: clean(k.id, 40) || `kra${++kc}`, title: clean(k.title, 160), description: clean(k.description, 600), methodology: clean(k.methodology, 300),
    kpis: arr(k.kpis).map(p => ({
      id: clean(p.id, 40) || `kpi${++pc}`, title: clean(p.title, 160), description: clean(p.description, 600), unit: clean(p.unit, 30),
      type: A.KPI_TYPES.includes(p.type) ? p.type : 'numeric', frequency: clean(p.frequency, 30), target: p.target === '' || p.target == null ? null : (Number.isFinite(Number(p.target)) ? Number(p.target) : clean(p.target, 120)),
      weight: Number(p.weight) || 0, start_date: clean(p.start_date, 10), end_date: clean(p.end_date, 10), data_source: clean(p.data_source, 120), evidence_required: !!p.evidence_required,
      rating_method: clean(p.rating_method, 200), formula: clean(p.formula, 200),
    })),
  }));
}

// ═════════════════════════ handlers ═════════════════════════
export async function handleAppraisal(name, p, cu, res) {
  if (!cu) return fail(res, 'Unauthorized', 401);
  const cx = await ctxOf(cu);
  if (!cx.role) return fail(res, 'Unauthorized', 401);
  const hrOnly = () => (cx.hr ? null : fail(res, 'HR or admin access required', 403));
  const H = HANDLERS[name];
  if (!H) return fail(res, `Unknown function ${name}`, 404);
  try { return await H({ p: p || {}, cx, res, hrOnly }); }
  catch (e) { console.error(`[appraisal/${name}]`, e); if (!res.headersSent) return fail(res, e.message || 'Something went wrong', 500); }
}

async function reviewFor(cx, res, id, need) {
  const review = await load(T.review, id);
  if (!review) { fail(res, 'Appraisal record not found', 404); return {}; }
  const a = accessFor(cx, review);
  if (need === 'view' && !a.canView) { fail(res, 'You do not have access to this appraisal', 403); return {}; }
  if (need === 'own' && !a.own) { fail(res, 'This is not your appraisal', 403); return {}; }
  if (need === 'evaluate' && !a.evaluator) { fail(res, 'Only the reporting manager can evaluate this employee', 403); return {}; }
  if (need === 'hr' && !a.hr) { fail(res, 'HR or admin access required', 403); return {}; }
  const cycle = await loadCycle(review.cycle_id);
  return { review, cycle, a };
}
const frozenCycle = (res, c) => (['closed', 'archived'].includes(c.status) ? (fail(res, `This cycle is ${c.status}. Reopen it first (HR/admin, with a reason).`, 409), true) : false);

const HANDLERS = {
  // ── forms (questionnaires) so the screens are not hardcoded ──
  async ap_get_forms({ res }) { return res.json({ success: true, self: SELF_FORM, manager: MANAGER_FORM, goal_statuses: A.GOAL_STATUSES, kpi_types: A.KPI_TYPES, cycle_types: A.CYCLE_TYPES, cycle_statuses: A.CYCLE_STATUSES, declaration: DECLARATION }); },

  // ── settings ──
  async ap_get_settings({ res }) { return res.json({ success: true, settings: await getSettings() }); },
  async ap_save_settings({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const cur = await getSettings();
    const next = { ...cur, scale: arr(p.scale).map(s => ({ value: Number(s.value), label: clean(s.label, 60) })), bands: arr(p.bands).map(b => ({ min: Number(b.min), label: clean(b.label, 60) })),
      competencies: arr(p.competencies).map((c, i) => ({ id: clean(c.id, 20) || `c${i + 1}`, name: clean(c.name, 80), enabled: !!c.enabled, weight: Number(c.weight) || 0 })),
      split: { kpi: Number(p.split?.kpi), competency: Number(p.split?.competency) }, decimals: Number(p.decimals), require_meeting: p.require_meeting !== false, allow_late_submission: p.allow_late_submission !== false,
      reminder_days: arr(p.reminder_days).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 60), large_gap: Number(p.large_gap) || 2 };
    const v = A.validateSettings(next); if (!v.ok) return fail(res, v.errors.join('. '));
    await save(T.settings, next, null, 'active');
    await audit(cx, res, { action: 'settings_saved', entity: 'settings', prev: { scale: cur.scale, bands: cur.bands, split: cur.split }, next: { scale: next.scale, bands: next.bands, split: next.split }, reason: clean(p.reason, 300) });
    return res.json({ success: true, settings: next, note: 'Applies to cycles published from now on. Published cycles keep the settings they started with.' });
  },

  // ── cycles ──
  async ap_list_cycles({ cx, res }) {
    const cycles = await list(T.cycle); const reviews = await list(T.review);
    const out = cycles.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(c => {
      const rs = reviews.filter(r => r.cycle_id === c.id && !r.excluded); const fin = rs.filter(r => ['approved', 'published', 'closed'].includes(A.deriveStatus(r))).length;
      return { ...c, counts: { employees: rs.length, self_submitted: rs.filter(r => r.self_status === 'submitted').length, mgr_submitted: rs.filter(r => r.mgr_status === 'submitted').length, finalised: fin } };
    });
    // employees and managers only see cycles they take part in
    if (!cx.hr) { const mine = new Set(reviews.filter(r => r.user_id === cx.cu.id || r.manager_id === cx.cu.id || cx.down.has(r.user_id)).map(r => r.cycle_id)); return res.json({ success: true, cycles: out.filter(c => mine.has(c.id) && c.status !== 'draft' && c.status !== 'configured').map(c => ({ ...c, counts: undefined })) }); }
    return res.json({ success: true, cycles: out });
  },
  async ap_save_cycle({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const prev = p.id ? await loadCycle(p.id) : null;
    if (p.id && !prev) return fail(res, 'Cycle not found', 404);
    if (prev && !cycleEditable(prev)) {
      // after publishing only dates, notes and eligibility-independent options may change, and every change is audited
      const dl = p.deadlines || {}; const upd = { ...prev, deadlines: { ...prev.deadlines, self: clean(dl.self, 10) || prev.deadlines.self, manager: clean(dl.manager, 10) || prev.deadlines.manager, meeting: clean(dl.meeting, 10) || prev.deadlines.meeting, hr: clean(dl.hr, 10) || prev.deadlines.hr }, allow_late_submission: p.allow_late_submission !== false, notes: clean(p.notes, 1000) };
      if (['closed', 'archived'].includes(prev.status)) return fail(res, 'Closed cycles cannot be edited. Reopen the cycle first.', 409);
      await save(T.cycle, upd, null, upd.status);
      await audit(cx, res, { action: 'cycle_deadlines_changed', entity: 'cycle', cycle_id: prev.id, prev: prev.deadlines, next: upd.deadlines, reason: clean(p.reason, 300) });
      return res.json({ success: true, cycle: upd });
    }
    const c = sanitizeCycle(p, prev || {});
    if (!prev) Object.assign(c, { id: uuidv4(), status: 'draft', created_by: cx.cu.id, created_at: now(), status_history: [{ status: 'draft', at: now(), by: cx.cu.id }] });
    const errs = cycleProblems(c); if (p.status === 'configured' && errs.length) return fail(res, errs.join('. '));
    if (p.status === 'configured' && c.status === 'draft') { c.status = 'configured'; c.status_history.push({ status: 'configured', at: now(), by: cx.cu.id }); }
    if (!c.name) return fail(res, 'Cycle name is required');
    await save(T.cycle, c, null, c.status);
    await audit(cx, res, { action: prev ? 'cycle_updated' : 'cycle_created', entity: 'cycle', cycle_id: c.id, next: { name: c.name, status: c.status } });
    return res.json({ success: true, cycle: c, warnings: errs });
  },
  async ap_duplicate_cycle({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const src = await loadCycle(p.cycle_id); if (!src) return fail(res, 'Cycle not found', 404);
    const c = { ...src, id: uuidv4(), name: clean(p.name, 120) || `${src.name} (copy)`, status: 'draft', created_by: cx.cu.id, created_at: now(), settings: undefined, status_history: [{ status: 'draft', at: now(), by: cx.cu.id, note: `copied from ${src.name}` }], published_at: undefined, closed_at: undefined };
    await save(T.cycle, c, null, 'draft'); await audit(cx, res, { action: 'cycle_duplicated', entity: 'cycle', cycle_id: c.id, prev: { from: src.id } });
    return res.json({ success: true, cycle: c });
  },
  async ap_eligible_preview({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const c = sanitizeCycle(p); const list_ = A.eligibleEmployees(c.eligibility, cx.pp.list, c.review_end);
    return res.json({ success: true, count: list_.length, employees: list_.slice(0, 500).map(e => ({ user_id: e.user_id, name: e.name, code: e.code, department: e.department, designation: e.designation, manager: e.manager_name, no_manager: !e.manager_id })), without_manager: list_.filter(e => !e.manager_id).length });
  },
  // status moves: publish → in_progress → under_hr_review → finalised → closed → archived (+ reopen)
  async ap_set_cycle_status({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const c = await loadCycle(p.cycle_id); if (!c) return fail(res, 'Cycle not found', 404);
    const to = p.status; const order = A.CYCLE_STATUSES; const reason = clean(p.reason, 400);
    const fromI = order.indexOf(c.status), toI = order.indexOf(to);
    if (toI < 0) return fail(res, 'Unknown status');
    const reopening = toI < fromI;
    if (reopening) { if (!['finalised', 'closed', 'archived', 'under_hr_review'].includes(c.status)) return fail(res, 'Only a finalised or closed cycle can be reopened'); if (!reason) return fail(res, 'A reason is required to reopen a cycle'); }
    else if (toI !== fromI + 1) return fail(res, `A ${c.status.replace(/_/g, ' ')} cycle moves to ${order[fromI + 1]?.replace(/_/g, ' ') || 'nothing further'}, not ${to.replace(/_/g, ' ')}`);
    if (to === 'published') {
      const errs = cycleProblems(c); if (errs.length) return fail(res, errs.join('. '));
      const settings = await getSettings(); const v = A.validateSettings(settings); if (!v.ok) return fail(res, v.errors.join('. '));
      c.settings = { scale: settings.scale, bands: settings.bands, competencies: settings.competencies, split: c.include_competencies ? (Number(settings.split.competency) > 0 ? settings.split : { kpi: 80, competency: 20 }) : { kpi: 100, competency: 0 }, decimals: settings.decimals, large_gap: settings.large_gap };
      if (c.include_competencies && Number(settings.split.competency) === 0) { const vv = A.validateSettings({ ...settings, split: c.settings.split }); if (!vv.ok) return fail(res, vv.errors.join('. ')); }
      c.meeting_required = c.meeting_required !== false && settings.require_meeting !== false;
      const created = await syncCycleEmployees(cx, res, c, { add: null, remove: [] });
      c.published_at = now(); c.published_by = cx.cu.id;
      await notify(created.map(r => r.user_id), { title: 'Performance appraisal published', message: `${c.name} is open. Complete your self-assessment by ${c.deadlines.self}.`, key: `pub:${c.id}` });
    }
    if (to === 'closed') {
      const rs = (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id])).filter(r => !r.excluded);
      const open = rs.filter(r => !['published', 'closed'].includes(A.deriveStatus(r)));
      if (open.length && !p.force) return fail(res, `${open.length} appraisal(s) are not published yet. Publish them, or close with "force" and a reason.`, 409);
      if (open.length && !reason) return fail(res, 'A reason is required to close a cycle with pending appraisals');
      for (const r of rs) { await withLock(r.id, async () => { const x = await load(T.review, r.id); if (!['published', 'closed'].includes(A.deriveStatus(x))) x.flags = { ...x.flags, closed_incomplete: true }; x.hr_status = 'closed'; await save(T.review, x, x.user_id, A.deriveStatus(x)); }); }
      c.closed_at = now();
    }
    c.status_history = [...arr(c.status_history), { status: to, at: now(), by: cx.cu.id, reason }];
    const prevStatus = c.status; c.status = to; await save(T.cycle, c, null, to);
    if (reopening && prevStatus === 'closed') for (const r of await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id])) { if (r.hr_status === 'closed') { r.hr_status = r.released ? 'published' : 'approved'; await save(T.review, r, r.user_id, A.deriveStatus(r)); } }
    await audit(cx, res, { action: reopening ? 'cycle_reopened' : 'cycle_status', entity: 'cycle', cycle_id: c.id, prev: { status: prevStatus }, next: { status: to }, reason });
    return res.json({ success: true, cycle: c });
  },
  // add / remove people after (or at) publication
  async ap_cycle_employees({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const c = await loadCycle(p.cycle_id); if (!c) return fail(res, 'Cycle not found', 404);
    if (['closed', 'archived'].includes(c.status)) return fail(res, 'Closed cycles cannot change employees', 409);
    if (!c.settings) return fail(res, 'Publish the cycle first — employees are added automatically from its eligibility rules.', 409);
    const reason = clean(p.reason, 300); if (arr(p.remove).length && !reason) return fail(res, 'A reason is required to remove employees');
    const r = await syncCycleEmployees(cx, res, c, { add: arr(p.add), remove: arr(p.remove), reason });
    return res.json({ success: true, added: r.length });
  },
  async ap_cycle_roster({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const rs = await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [p.cycle_id]);
    const inCycle = new Set(rs.map(r => r.user_id));
    return res.json({ success: true, reviews: rs.map(summaryRow), not_in_cycle: cx.pp.list.filter(e => e.status === 'active' && !inCycle.has(e.user_id)).map(e => ({ user_id: e.user_id, name: e.name, code: e.code, department: e.department, designation: e.designation })) });
  },

  // ── KPI / KRA templates ──
  async ap_list_templates({ cx, res }) {
    const ts = await list(T.template);
    return res.json({ success: true, templates: ts.filter(t => !t.deleted).map(t => ({ ...t, history: cx.hr ? t.history : undefined })).sort((a, b) => a.name.localeCompare(b.name)) });
  },
  async ap_save_template({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const items = cleanItems(p.items); const v = A.validateKpiWeights(items); if (!clean(p.name, 120)) return fail(res, 'Template name is required');
    if (!v.ok && !p.allow_incomplete) return fail(res, v.errors.join('. '));
    const prev = p.id ? await load(T.template, p.id) : null; if (p.id && !prev) return fail(res, 'Template not found', 404);
    const t = { ...(prev || { id: uuidv4(), created_by: cx.cu.id, created_at: now(), version: 0, history: [] }), name: clean(p.name, 120), department: clean(p.department, 80), designation: clean(p.designation, 80), job_role: clean(p.job_role, 80), category: clean(p.category, 60), description: clean(p.description, 600), status: v.ok ? 'approved' : 'draft', items };
    if (prev) t.history = [...arr(prev.history), { version: prev.version, items: prev.items, at: prev.updated_at, by: prev.modified_by || prev.created_by }].slice(-30);
    t.version = (prev?.version || 0) + 1; t.modified_by = cx.cu.id; if (v.ok) { t.approved_by = cx.cu.id; }
    await save(T.template, t, null, t.status);
    await audit(cx, res, { action: prev ? 'template_updated' : 'template_created', entity: 'template', template_id: t.id, prev: prev ? { version: prev.version } : null, next: { version: t.version, weights_total: v.total } });
    return res.json({ success: true, template: t, validation: v });
  },
  async ap_delete_template({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const t = await load(T.template, p.template_id); if (!t) return fail(res, 'Template not found', 404);
    t.deleted = true; t.deleted_by = cx.cu.id; await save(T.template, t, null, 'deleted'); await audit(cx, res, { action: 'template_deleted', entity: 'template', template_id: t.id });
    return res.json({ success: true });
  },
  // assign a template to everyone in scope (department / designation / people) — a COPY is stored on each review
  async ap_assign_template({ p, cx, res }) {
    const c = await loadCycle(p.cycle_id); if (!c) return fail(res, 'Cycle not found', 404);
    const t = await load(T.template, p.template_id); if (!t || t.deleted) return fail(res, 'Template not found', 404);
    const v = A.validateKpiWeights(t.items); if (!v.ok) return fail(res, `This template cannot be assigned: ${v.errors.join('. ')}`);
    if (frozenCycle(res, c)) return;
    const rs = await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id]);
    const dept = arr(p.departments).map(x => String(x).toLowerCase()), desig = arr(p.designations).map(x => String(x).toLowerCase()), users = new Set(arr(p.user_ids));
    const targets = rs.filter(r => !r.excluded).filter(r => {
      const access = accessFor(cx, r); if (!cx.hr && !access.evaluator) return false;       // managers assign only to their own reports
      if (users.size) return users.has(r.user_id);
      if (!dept.length && !desig.length) return false;
      return (!dept.length || dept.includes(String(r.emp.department).toLowerCase())) && (!desig.length || desig.includes(String(r.emp.designation).toLowerCase()));
    });
    if (!targets.length) return fail(res, 'No employees in this cycle match the selection (or you may only assign to your own reporting employees).');
    let changed = 0, skipped = 0;
    for (const r0 of targets) await withLock(r0.id, async () => {
      const r = await load(T.review, r0.id);
      if (r.hr_status === 'approved' || r.hr_status === 'published' || r.hr_status === 'closed') { skipped++; return; }
      if (!applyAssignment(r, { template: t, items: t.items, source: 'template', by: cx.cu.id, reason: clean(p.reason, 300) || 'Template assigned', overwrite: !!p.overwrite })) { skipped++; return; }   // employee-specific KPIs are kept unless overwrite is asked for
      await save(T.review, r, r.user_id, A.deriveStatus(r)); changed++;
      await notify([r.user_id], { title: 'KPIs assigned', message: `Your KPIs/KRAs for ${c.name} are ready.`, key: `kpi:${r.id}:${t.id}:${t.version}` });
    });
    await audit(cx, res, { action: 'template_assigned', entity: 'assignment', cycle_id: c.id, template_id: t.id, next: { employees: changed, version: t.version } });
    return res.json({ success: true, assigned: changed, skipped });
  },
  // employee-specific KPIs / different targets — the template itself is untouched; the old assignment stays in the history
  async ap_set_employee_kpis({ p, cx, res }) {
    const { review, cycle, a } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return;
    if (!(a.hr || a.evaluator)) return fail(res, 'Only HR or the reporting manager can change KPIs', 403);
    if (frozenCycle(res, cycle)) return;
    if (['approved', 'published', 'closed'].includes(review.hr_status)) return fail(res, 'This appraisal is already approved — reopen it before changing KPIs', 409);
    const items = cleanItems(p.items); const v = A.validateKpiWeights(items); if (!v.ok) return fail(res, v.errors.join('. '));
    const reason = clean(p.reason, 300); if (!reason) return fail(res, 'A reason is required when changing KPIs');
    await withLock(review.id, async () => {
      const r = await load(T.review, review.id); const before = r.assignment?.items;
      applyAssignment(r, { template: r.assignment?.template_id ? { id: r.assignment.template_id, name: r.assignment.template_name, version: r.assignment.template_version } : null, items, source: 'custom', by: cx.cu.id, reason, overwrite: true });
      if (r.self_status !== 'pending') { r.flags = { ...r.flags, assignment_changed_after_self: true }; }
      recompute(r, cycle); await save(T.review, r, r.user_id, A.deriveStatus(r));
      await audit(cx, res, { action: 'kpis_changed', entity: 'assignment', review_id: r.id, cycle_id: r.cycle_id, employee_id: r.user_id, prev: { kpis: A.flattenKpis(before).length }, next: { kpis: A.flattenKpis(items).length }, reason });
      await notify([r.user_id], { title: 'Your KPIs were updated', message: `Your KPIs for ${cycle.name} changed${r.self_status !== 'pending' ? ' — please review your self-assessment' : ''}.`, key: `kpichg:${r.id}:${Date.now()}` });
    });
    return res.json({ success: true });
  },
  async ap_import_assignments({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const c = await loadCycle(p.cycle_id); if (!c) return fail(res, 'Cycle not found', 404); if (frozenCycle(res, c)) return;
    const tpls = await list(T.template); const rs = await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id]);
    const byCode = {}; for (const r of rs) byCode[String(r.emp.code).toLowerCase()] = r;
    const result = { assigned: 0, errors: [] };
    for (const [i, row] of arr(p.rows).entries()) {
      const code = String(row.employee_code || row['Employee Code'] || '').trim().toLowerCase(); const tn = String(row.template || row['Template'] || '').trim().toLowerCase();
      const r0 = byCode[code]; const t = tpls.find(x => !x.deleted && x.name.toLowerCase() === tn);
      if (!r0) { result.errors.push(`Row ${i + 1}: employee ${code || '(blank)'} is not in this cycle`); continue; } if (!t) { result.errors.push(`Row ${i + 1}: template "${row.template || row['Template'] || ''}" not found`); continue; }
      if (!A.validateKpiWeights(t.items).ok) { result.errors.push(`Row ${i + 1}: template "${t.name}" does not total 100%`); continue; }
      await withLock(r0.id, async () => { const r = await load(T.review, r0.id); applyAssignment(r, { template: t, items: t.items, source: 'template', by: cx.cu.id, reason: 'Excel import', overwrite: true }); await save(T.review, r, r.user_id, A.deriveStatus(r)); result.assigned++; });
    }
    await audit(cx, res, { action: 'assignments_imported', entity: 'assignment', cycle_id: c.id, next: { assigned: result.assigned, errors: result.errors.length } });
    return res.json({ success: true, ...result });
  },

  // ── reviews: lists and single view ──
  async ap_my_reviews({ cx, res }) {
    const rs = await list(T.review, `AND user_id=$1`, [cx.cu.id]); const cycles = {}; for (const c of await list(T.cycle)) cycles[c.id] = c;
    const mine = rs.filter(r => cycles[r.cycle_id] && !['draft', 'configured'].includes(cycles[r.cycle_id].status)).map(r => viewReview(cx, r, cycles[r.cycle_id])).sort((a, b) => String(b.cycle?.review_end).localeCompare(String(a.cycle?.review_end)));
    return res.json({ success: true, reviews: mine });
  },
  async ap_get_review({ p, cx, res }) {
    const { review, cycle } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return;
    const goals = (await list(T.goal, `AND data::jsonb->>'review_id'=$1`, [review.id]));
    const meetings = (await list(T.meeting, `AND data::jsonb->>'review_id'=$1`, [review.id])).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const plans = await list(T.plan, `AND data::jsonb->>'review_id'=$1`, [review.id]);
    const v = viewReview(cx, review, cycle); const own = v.access.own && !v.access.hr;
    // history of this employee's earlier cycles (published results only for the employee)
    const hist = (await list(T.review, `AND user_id=$1`, [review.user_id])).filter(r => r.id !== review.id && (r.scores?.final != null) && (!own || r.released)).map(r => ({ cycle_id: r.cycle_id, final: r.scores.final, band: r.scores.band }));
    return res.json({ success: true, review: v, goals, meetings: own && !review.released ? meetings.map(m => ({ ...m, manager_feedback: undefined })) : meetings, dev_plans: own && !review.released ? plans.filter(x => x.visible_to_employee !== false) : plans, history: hist });
  },
  async ap_team_reviews({ p, cx, res }) {
    const rs = (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [p.cycle_id])).filter(r => !r.excluded);
    let rows = cx.hr ? rs : rs.filter(r => r.manager_id === cx.cu.id || cx.down.has(r.user_id));
    if (!cx.hr && !rows.length && !cx.down.size) return res.json({ success: true, reviews: [], total: 0, is_manager: false });
    const f = p.filters || {};
    if (f.department) rows = rows.filter(r => r.emp.department === f.department); if (f.designation) rows = rows.filter(r => r.emp.designation === f.designation);
    if (f.manager_id) rows = rows.filter(r => r.manager_id === f.manager_id); if (f.user_id) rows = rows.filter(r => r.user_id === f.user_id);
    if (f.status) rows = rows.filter(r => A.deriveStatus(r) === f.status); if (f.meeting_status) rows = rows.filter(r => (r.meeting_status || 'not_scheduled') === f.meeting_status);
    if (f.band) rows = rows.filter(r => r.scores?.band === f.band);
    if (f.pending === 'mine') rows = rows.filter(r => r.manager_id === cx.cu.id && r.self_status === 'submitted' && r.mgr_status !== 'submitted');
    if (f.search) { const s = String(f.search).toLowerCase(); rows = rows.filter(r => `${r.emp.name} ${r.emp.code}`.toLowerCase().includes(s)); }
    rows.sort((a, b) => String(a.emp.name).localeCompare(b.emp.name));
    const page = Math.max(1, Number(p.page) || 1), size = Math.min(200, Math.max(5, Number(p.page_size) || 50));
    const out = rows.slice((page - 1) * size, page * size).map(r => { const s = summaryRow(r); if (!cx.hr) { if (r.manager_id !== cx.cu.id) { delete s.manager_score; delete s.final_score; } } return s; });
    return res.json({ success: true, reviews: out, total: rows.length, page, page_size: size, is_manager: true });
  },

  // ── self-assessment ──
  async ap_save_self({ p, cx, res }) { return saveSelf(cx, res, p, false); },
  async ap_submit_self({ p, cx, res }) { return saveSelf(cx, res, p, true); },
  async ap_reopen_self({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const reason = clean(p.reason, 400); if (!reason) return fail(res, 'A reason is required to reopen a self-assessment');
    const { review, cycle } = await reviewFor(cx, res, p.review_id, 'hr'); if (!review) return; if (frozenCycle(res, cycle)) return;
    if (review.self_status !== 'submitted') return fail(res, 'The self-assessment is not submitted');
    await withLock(review.id, async () => {
      const r = await load(T.review, review.id); r.self_versions = [...arr(r.self_versions), { ...r.self, archived_at: now(), archived_reason: reason }];
      r.self = { ...r.self, declared: false, submitted_at: null, reopened_at: now() }; r.self_status = 'draft'; r.flags = { ...r.flags, reopened: (r.flags?.reopened || 0) + 1 };
      if (r.mgr_status === 'submitted') { r.mgr_versions = [...arr(r.mgr_versions), { ...r.mgr, archived_at: now(), archived_reason: `self-assessment reopened: ${reason}` }]; r.mgr_status = 'draft'; }
      if (['approved', 'published'].includes(r.hr_status)) r.hr_status = 'pending';
      recompute(r, cycle); await save(T.review, r, r.user_id, A.deriveStatus(r));
      await audit(cx, res, { action: 'self_reopened', entity: 'self_assessment', review_id: r.id, cycle_id: r.cycle_id, employee_id: r.user_id, reason });
      await notify([r.user_id], { title: 'Self-assessment reopened', message: `HR reopened your self-assessment for ${cycle.name}: ${reason}`, key: `reopen:${r.id}:${Date.now()}` });
    });
    return res.json({ success: true });
  },
  // the employee did not take part (left, long leave, …): the manager may then evaluate without a self-assessment
  async ap_waive_self({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const reason = clean(p.reason, 400); if (!reason) return fail(res, 'A reason is required');
    const { review } = await reviewFor(cx, res, p.review_id, 'hr'); if (!review) return;
    await withLock(review.id, async () => { const r = await load(T.review, review.id); r.flags = { ...r.flags, self_waived: true, self_waived_reason: reason }; await save(T.review, r, r.user_id, A.deriveStatus(r)); await audit(cx, res, { action: 'self_waived', entity: 'review', review_id: r.id, employee_id: r.user_id, reason }); });
    return res.json({ success: true });
  },

  // ── manager evaluation ──
  async ap_save_manager_eval({ p, cx, res }) { return saveManager(cx, res, p, false); },
  async ap_submit_manager_eval({ p, cx, res }) { return saveManager(cx, res, p, true); },

  // ── meetings ──
  async ap_save_meeting({ p, cx, res }) {
    const { review, cycle, a } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return;
    if (!(a.evaluator || a.hr)) return fail(res, 'Only the reporting manager (or HR) can schedule meetings', 403); if (frozenCycle(res, cycle)) return;
    const prev = p.meeting_id ? await load(T.meeting, p.meeting_id) : null; if (p.meeting_id && (!prev || prev.review_id !== review.id)) return fail(res, 'Meeting not found', 404);
    if (prev?.status === 'completed') return fail(res, 'A completed meeting cannot be rescheduled', 409);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return fail(res, 'Meeting date is required');
    if (!['in_person', 'teams', 'google_meet', 'online'].includes(p.mode)) return fail(res, 'Choose a meeting mode');
    if (p.start_time && p.end_time && p.end_time <= p.start_time) return fail(res, 'End time must be after start time');
    const m = { ...(prev || { id: uuidv4(), review_id: review.id, cycle_id: review.cycle_id, user_id: review.user_id, manager_id: review.manager_id, created_by: cx.cu.id, created_at: now(), history: [] }),
      date: p.date, start_time: clean(p.start_time, 5), end_time: clean(p.end_time, 5), mode: p.mode, location: clean(p.location, 200), link: clean(p.link, 400), agenda: clean(p.agenda, 1500),
      status: prev ? 'rescheduled' : 'scheduled' };
    if (p.cancel) m.status = 'cancelled';
    m.history = [...arr(m.history), { at: now(), by: cx.cu.id, status: m.status, date: m.date }];
    await withLock(review.id, async () => { await save(T.meeting, m, review.user_id, m.status); const r = await load(T.review, review.id); r.meeting_status = m.status === 'cancelled' ? 'not_scheduled' : m.status; await save(T.review, r, r.user_id, A.deriveStatus(r)); });
    await notify([review.user_id, review.manager_id], { title: m.status === 'cancelled' ? 'Review meeting cancelled' : prev ? 'Review meeting rescheduled' : 'Review meeting scheduled', message: `${review.emp.name}'s ${cycle.name} review meeting${m.status === 'cancelled' ? ' was cancelled' : ` is on ${m.date}${m.start_time ? ' at ' + m.start_time : ''}`}.`, key: `mt:${m.id}:${m.status}:${m.date}:${m.start_time}` });
    await audit(cx, res, { action: `meeting_${m.status}`, entity: 'meeting', review_id: review.id, employee_id: review.user_id, next: { date: m.date, mode: m.mode } });
    return res.json({ success: true, meeting: m });
  },
  async ap_complete_meeting({ p, cx, res }) {
    const m = await load(T.meeting, p.meeting_id); if (!m) return fail(res, 'Meeting not found', 404);
    const { review, cycle, a } = await reviewFor(cx, res, m.review_id, 'view'); if (!review) return;
    if (!(a.evaluator || a.hr)) return fail(res, 'Only the reporting manager can complete the meeting', 403); if (frozenCycle(res, cycle)) return;
    if (m.status === 'cancelled') return fail(res, 'This meeting was cancelled', 409);
    const need = { discussion_summary: 'discussion summary', strengths: 'key strengths discussed', improvement_areas: 'improvement areas' };
    for (const [k, label] of Object.entries(need)) if (!clean(p[k], 3000)) return fail(res, `Record the ${label} before completing the meeting`);
    const actions = arr(p.action_items).map(x => ({ text: clean(x.text, 400), owner: clean(x.owner, 80), due: clean(x.due, 10), done: !!x.done })).filter(x => x.text);
    if (!actions.length) return fail(res, 'Record at least one agreed action item');
    Object.assign(m, { status: 'completed', discussion_summary: clean(p.discussion_summary, 3000), strengths: clean(p.strengths, 3000), improvement_areas: clean(p.improvement_areas, 3000), employee_feedback: clean(p.employee_feedback, 2000), manager_feedback: clean(p.manager_feedback, 2000), action_items: actions, follow_up_date: clean(p.follow_up_date, 10), manager_confirmed_at: now(), completed_at: now() });
    m.history = [...arr(m.history), { at: now(), by: cx.cu.id, status: 'completed' }];
    await withLock(review.id, async () => { await save(T.meeting, m, review.user_id, 'completed'); const r = await load(T.review, review.id); r.meeting_status = 'completed'; await save(T.review, r, r.user_id, A.deriveStatus(r)); });
    await notify([review.user_id], { title: 'Review meeting recorded', message: `Your ${cycle.name} review discussion was recorded — please acknowledge it.`, key: `mtdone:${m.id}` });
    await audit(cx, res, { action: 'meeting_completed', entity: 'meeting', review_id: review.id, employee_id: review.user_id });
    return res.json({ success: true, meeting: m });
  },
  // the employee confirms the discussion took place — not that they agree with the rating
  async ap_ack_meeting({ p, cx, res }) {
    const m = await load(T.meeting, p.meeting_id); if (!m) return fail(res, 'Meeting not found', 404); if (m.user_id !== cx.cu.id) return fail(res, 'This is not your meeting', 403);
    if (m.status !== 'completed') return fail(res, 'The meeting has not been completed yet', 409);
    m.employee_ack = { at: now(), agrees: p.agrees !== false, comment: clean(p.comment, 1500) }; await save(T.meeting, m, m.user_id, 'completed');
    await audit(cx, res, { action: 'meeting_acknowledged', entity: 'meeting', review_id: m.review_id, employee_id: m.user_id, next: { agrees: m.employee_ack.agrees } });
    if (m.employee_ack.agrees === false) await notify([m.manager_id, ...cx.pp.list.filter(() => false)], { title: 'Employee recorded a disagreement', message: `${cx.pp.byUser[cx.cu.id]?.name || 'An employee'} added comments to the review discussion.`, key: `disagree:${m.id}` });
    return res.json({ success: true });
  },

  // ── HR: calibration, decisions, publishing ──
  async ap_calibration({ p, cx, res, hrOnly }) {
    if (hrOnly()) return;
    const c = await loadCycle(p.cycle_id); if (!c) return fail(res, 'Cycle not found', 404);
    const rs = (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id])).filter(r => !r.excluded);
    const byDept = {}, byMgr = {};
    for (const r of rs) { const m = r.scores?.manager; if (m == null) continue; (byDept[r.emp.department || '—'] ||= []).push(m); (byMgr[r.emp.manager_name || r.manager_id || '—'] ||= []).push(m); }
    const stat = (o) => Object.entries(o).map(([k, v]) => ({ key: k, n: v.length, avg: A.round(v.reduce((a, b) => a + b, 0) / v.length, 2), min: Math.min(...v), max: Math.max(...v) }));
    const overall = rs.map(r => r.scores?.manager).filter(x => x != null); const mean = overall.length ? overall.reduce((a, b) => a + b, 0) / overall.length : 0;
    const sd = overall.length > 1 ? Math.sqrt(overall.reduce((a, b) => a + (b - mean) ** 2, 0) / overall.length) : 0;
    const mgrStats = stat(byMgr).map(m => ({ ...m, unusual: m.n >= 3 && sd > 0 && Math.abs(m.avg - mean) > 1.0 * sd }));
    return res.json({ success: true, reviews: rs.map(r => ({ ...summaryRow(r), gaps: r.scores?.gaps || [], original_manager: r.scores?.original_manager ?? null, hr_adjusted: r.scores?.hr_adjusted ?? null, missing: r.scores?.incomplete && r.mgr_status === 'submitted' })), by_department: stat(byDept), by_manager: mgrStats, overall: { n: overall.length, avg: A.round(mean, 2), sd: A.round(sd, 2) }, missing_evaluations: rs.filter(r => r.mgr_status !== 'submitted').length });
  },
  async ap_hr_adjust({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const reason = clean(p.reason, 600); if (!reason) return fail(res, 'A reason is required for every score adjustment');
    const { review, cycle } = await reviewFor(cx, res, p.review_id, 'hr'); if (!review) return; if (frozenCycle(res, cycle)) return;
    if (review.mgr_status !== 'submitted' || review.scores?.manager == null) return fail(res, 'The manager evaluation must be submitted and complete before calibrating', 409);
    if (['published', 'closed'].includes(review.hr_status)) return fail(res, 'Published results are final. Reopen the appraisal to adjust.', 409);
    const to = p.clear ? null : Number(p.score); if (!p.clear && (!Number.isFinite(to) || to < 0 || to > 100)) return fail(res, 'Score must be between 0 and 100');
    await withLock(review.id, async () => {
      const r = await load(T.review, review.id); const before = r.scores?.final;
      r.scores = { ...r.scores, hr_adjusted: to === null ? null : A.round(to, cycle.settings.decimals) };
      r.adjustments = [...arr(r.adjustments), { at: now(), by: cx.cu.id, from: before, to: r.scores.hr_adjusted, reason }];
      r.hr = { ...r.hr, remarks: clean(p.remarks, 1500) || r.hr?.remarks || '' }; recompute(r, cycle); await save(T.review, r, r.user_id, A.deriveStatus(r));
      await audit(cx, res, { action: 'score_adjusted', entity: 'score', review_id: r.id, cycle_id: r.cycle_id, employee_id: r.user_id, prev: { final: before }, next: { final: r.scores.final }, reason });
    });
    return res.json({ success: true });
  },
  async ap_hr_decide({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const action = p.action; const reason = clean(p.reason, 600);
    const { review, cycle } = await reviewFor(cx, res, p.review_id, 'hr'); if (!review) return; if (frozenCycle(res, cycle)) return;
    let out = null;
    await withLock(review.id, async () => {
      const r = await load(T.review, review.id); const st = A.deriveStatus(r); const log = (extra = {}) => { r.hr = { ...r.hr, decision_log: [...arr(r.hr?.decision_log), { action, at: now(), by: cx.cu.id, reason, ...extra }] }; };
      if (action === 'approve') {
        if (r.mgr_status !== 'submitted') return void (out = fail(res, 'The manager evaluation has not been submitted', 409));
        if (r.scores?.final == null) return void (out = fail(res, 'The score is incomplete — it cannot be approved', 409));
        if (cycle.meeting_required !== false && r.meeting_status !== 'completed' && !(p.override_meeting && reason)) return void (out = fail(res, 'The one-on-one meeting has not been completed. Complete it, or approve with "override" and a reason.', 409));
        r.hr_status = 'approved'; r.hr = { ...r.hr, approved_at: now(), approved_by: cx.cu.id }; log();
      } else if (action === 'return') {
        if (!reason) return void (out = fail(res, 'A reason is required to return an evaluation'));
        if (!['employee', 'manager'].includes(p.to)) return void (out = fail(res, 'Choose who it is returned to: employee or manager'));
        if (['published', 'closed'].includes(r.hr_status)) return void (out = fail(res, 'Published results cannot be returned. Use reopen.', 409));
        if (p.to === 'employee') { r.self_versions = [...arr(r.self_versions), { ...r.self, archived_at: now(), archived_reason: reason }]; r.self_status = 'draft'; r.self = { ...r.self, submitted_at: null, declared: false }; r.mgr_versions = [...arr(r.mgr_versions), { ...r.mgr, archived_at: now(), archived_reason: 'self-assessment returned' }]; r.mgr_status = 'draft'; }
        else { r.mgr_versions = [...arr(r.mgr_versions), { ...r.mgr, archived_at: now(), archived_reason: reason }]; r.mgr_status = 'draft'; }
        r.hr_status = 'returned'; r.hr = { ...r.hr, returned_reason: reason, returned_to: p.to }; r.flags = { ...r.flags, returned: (r.flags?.returned || 0) + 1 }; log({ to: p.to });
        await notify([p.to === 'employee' ? r.user_id : r.manager_id], { title: 'Appraisal returned for correction', message: `${r.emp.name}'s ${cycle.name} appraisal was returned: ${reason}`, key: `ret:${r.id}:${Date.now()}` });
      } else if (action === 'clarify') {
        if (!reason) return void (out = fail(res, 'Write the clarification you need')); log(); await notify([r.manager_id], { title: 'HR needs clarification', message: `${r.emp.name} (${cycle.name}): ${reason}`, key: `clar:${r.id}:${Date.now()}` });
      } else if (action === 'reopen') {
        if (!['approved', 'published', 'closed'].includes(r.hr_status)) return void (out = fail(res, 'Only approved or published appraisals can be reopened', 409)); if (!reason) return void (out = fail(res, 'A reason is required to reopen'));
        r.mgr_versions = [...arr(r.mgr_versions), { ...r.mgr, archived_at: now(), archived_reason: `reopened after ${r.hr_status}: ${reason}` }]; r.hr_status = 'pending'; r.released = false; r.mgr_status = 'draft'; r.scores = { ...r.scores, hr_adjusted: null }; log();
      } else if (action === 'publish') {
        if (r.hr_status !== 'approved') return void (out = fail(res, 'Only approved appraisals can be published', 409)); r.hr_status = 'published'; r.released = true; r.published_at = now(); log();
        await notify([r.user_id], { title: 'Your performance result is published', message: `Your ${cycle.name} result is available.`, key: `pubres:${r.id}:${r.published_at}` });
      } else return void (out = fail(res, 'Unknown action'));
      recompute(r, cycle); await save(T.review, r, r.user_id, A.deriveStatus(r));
      await audit(cx, res, { action: `hr_${action}`, entity: 'review', review_id: r.id, cycle_id: r.cycle_id, employee_id: r.user_id, prev: { status: st }, next: { status: A.deriveStatus(r) }, reason });
    });
    return out || res.json({ success: true });
  },
  async ap_publish_results({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const c = await loadCycle(p.cycle_id); if (!c) return fail(res, 'Cycle not found', 404);
    const rs = (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id])).filter(r => r.hr_status === 'approved' && (!arr(p.review_ids).length || p.review_ids.includes(r.id)));
    for (const r0 of rs) await withLock(r0.id, async () => { const r = await load(T.review, r0.id); r.hr_status = 'published'; r.released = true; r.published_at = now(); r.hr = { ...r.hr, decision_log: [...arr(r.hr?.decision_log), { action: 'publish', at: now(), by: cx.cu.id }] }; await save(T.review, r, r.user_id, A.deriveStatus(r)); await notify([r.user_id], { title: 'Your performance result is published', message: `Your ${c.name} result is available.`, key: `pubres:${r.id}:${r.published_at}` }); });
    await audit(cx, res, { action: 'results_published', entity: 'cycle', cycle_id: c.id, next: { count: rs.length } });
    return res.json({ success: true, published: rs.length });
  },
  // employee reads the published result and records any comment — this never changes the rating
  async ap_ack_result({ p, cx, res }) {
    const { review } = await reviewFor(cx, res, p.review_id, 'own'); if (!review) return; if (!review.released) return fail(res, 'Results are not published yet', 409);
    await withLock(review.id, async () => { const r = await load(T.review, review.id); r.employee_ack = { at: now(), agrees: p.agrees !== false, comment: clean(p.comment, 1500) }; await save(T.review, r, r.user_id, A.deriveStatus(r)); await audit(cx, res, { action: 'result_acknowledged', entity: 'review', review_id: r.id, employee_id: r.user_id, next: r.employee_ack }); });
    return res.json({ success: true });
  },
  async ap_reassign_manager({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const reason = clean(p.reason, 400); if (!reason) return fail(res, 'A reason is required');
    const { review } = await reviewFor(cx, res, p.review_id, 'hr'); if (!review) return; const nm = cx.pp.byUser[p.manager_id]; if (!nm) return fail(res, 'Choose a valid manager');
    if (p.manager_id === review.user_id) return fail(res, 'An employee cannot review themselves');
    await withLock(review.id, async () => { const r = await load(T.review, review.id); const old = r.manager_id; r.manager_id = nm.user_id; r.emp = { ...r.emp, manager_id: nm.user_id, manager_name: nm.name }; await save(T.review, r, r.user_id, A.deriveStatus(r)); await audit(cx, res, { action: 'manager_reassigned', entity: 'review', review_id: r.id, employee_id: r.user_id, prev: { manager_id: old }, next: { manager_id: nm.user_id }, reason }); });
    await notify([nm.user_id], { title: 'Appraisal assigned to you', message: `You are now the reviewing manager for ${review.emp.name}.`, key: `mgr:${review.id}:${nm.user_id}` });
    return res.json({ success: true });
  },
  async ap_exclude_review({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const reason = clean(p.reason, 400); if (!reason) return fail(res, 'A reason is required');
    const { review } = await reviewFor(cx, res, p.review_id, 'hr'); if (!review) return;
    await withLock(review.id, async () => { const r = await load(T.review, review.id); r.excluded = p.excluded !== false; r.exclusion_reason = reason; await save(T.review, r, r.user_id, A.deriveStatus(r)); await audit(cx, res, { action: r.excluded ? 'review_excluded' : 'review_restored', entity: 'review', review_id: r.id, employee_id: r.user_id, reason }); });
    return res.json({ success: true });
  },

  // ── goals ──
  async ap_list_goals({ p, cx, res }) {
    const { review } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return;
    return res.json({ success: true, goals: await list(T.goal, `AND data::jsonb->>'review_id'=$1`, [review.id]) });
  },
  async ap_save_goal({ p, cx, res }) {
    const { review, cycle, a } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return; if (frozenCycle(res, cycle)) return;
    if (!(a.own || a.evaluator || a.hr)) return fail(res, 'Not allowed', 403);
    const prev = p.goal_id ? await load(T.goal, p.goal_id) : null; if (p.goal_id && (!prev || prev.review_id !== review.id)) return fail(res, 'Goal not found', 404);
    if (!clean(p.title, 200)) return fail(res, 'Goal title is required');
    const g = { ...(prev || { id: uuidv4(), review_id: review.id, cycle_id: review.cycle_id, user_id: review.user_id, created_by: cx.cu.id, created_at: now(), proposed_by_manager: !a.own }), title: clean(p.title, 200), description: clean(p.description, 1500), kra_id: clean(p.kra_id, 40), kpi_id: clean(p.kpi_id, 40), target: clean(p.target, 120), start_date: clean(p.start_date, 10), due_date: clean(p.due_date, 10), priority: ['low', 'medium', 'high'].includes(p.priority) ? p.priority : 'medium' };
    g.status = A.GOAL_STATUSES.includes(p.status) ? p.status : (prev?.status || 'not_started');
    await save(T.goal, g, review.user_id, g.status); return res.json({ success: true, goal: g });
  },
  // employee-reported achievement and manager-verified achievement are kept apart
  async ap_update_goal_progress({ p, cx, res }) {
    const g = await load(T.goal, p.goal_id); if (!g) return fail(res, 'Goal not found', 404);
    const { review, a } = await reviewFor(cx, res, g.review_id, 'view'); if (!review) return;
    const pct = Math.max(0, Math.min(100, Number(p.progress)));
    if (a.own) { if (Number.isFinite(pct)) g.reported_progress = pct; g.reported_actual = clean(p.actual, 120); g.employee_comment = clean(p.comment, 1500); g.evidence = arr(p.evidence).slice(0, 10).map(x => ({ name: clean(x.name, 120), url: clean(x.url, 500) })); g.reported_at = now(); }
    else if (a.evaluator || a.hr) { if (Number.isFinite(pct)) g.verified_progress = pct; g.verified_actual = clean(p.actual, 120); g.manager_comment = clean(p.comment, 1500); g.verified_by = cx.cu.id; g.verified_at = now(); }
    else return fail(res, 'Not allowed', 403);
    if (A.GOAL_STATUSES.includes(p.status)) g.status = p.status;
    await save(T.goal, g, g.user_id, g.status); return res.json({ success: true, goal: g });
  },

  // ── development plans (linked to the existing Training programmes) ──
  async ap_save_dev_plan({ p, cx, res }) {
    const { review, a } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return; if (!(a.evaluator || a.hr)) return fail(res, 'Only the reporting manager or HR can recommend training', 403);
    const prev = p.plan_id ? await load(T.plan, p.plan_id) : null; if (p.plan_id && (!prev || prev.review_id !== review.id)) return fail(res, 'Plan not found', 404);
    if (!clean(p.skill_gap, 300) || !clean(p.recommended_training, 300)) return fail(res, 'Describe the skill gap and the recommended training');
    let program = null; if (p.training_program_id) { const row = await one("SELECT data FROM entities WHERE type='TrainingProgram' AND id=$1", [p.training_program_id]); if (!row) return fail(res, 'That training programme does not exist'); program = jparse(row.data); }
    const dup = !prev && (await list(T.plan, `AND data::jsonb->>'review_id'=$1`, [review.id])).find(x => x.recommended_training.toLowerCase() === clean(p.recommended_training, 300).toLowerCase() && x.status !== 'cancelled');
    if (dup) return fail(res, 'This training is already recommended for the employee in this cycle', 409);
    const d = { ...(prev || { id: uuidv4(), review_id: review.id, cycle_id: review.cycle_id, user_id: review.user_id, created_by: cx.cu.id, created_at: now() }), department: review.emp.department, skill_gap: clean(p.skill_gap, 300), recommended_training: clean(p.recommended_training, 300),
      category: ['technical', 'communication', 'leadership', 'management', 'process', 'compliance', 'software', 'functional'].includes(p.category) ? p.category : 'technical', priority: ['low', 'medium', 'high'].includes(p.priority) ? p.priority : 'medium', trainer: clean(p.trainer, 100),
      target_date: clean(p.target_date, 10), completed_date: clean(p.completed_date, 10), status: ['recommended', 'planned', 'in_progress', 'completed', 'cancelled'].includes(p.status) ? p.status : (prev?.status || 'recommended'),
      post_assessment: clean(p.post_assessment, 1000), manager_remarks: clean(p.manager_remarks, 1000), training_program_id: program ? p.training_program_id : '', training_program_name: program?.title || program?.name || '', visible_to_employee: p.visible_to_employee !== false };
    await save(T.plan, d, review.user_id, d.status); await audit(cx, res, { action: prev ? 'dev_plan_updated' : 'dev_plan_created', entity: 'dev_plan', review_id: review.id, employee_id: review.user_id });
    return res.json({ success: true, plan: d });
  },
  async ap_list_dev_plans({ p, cx, res }) {
    let rows = await list(T.plan, p.cycle_id ? `AND data::jsonb->>'cycle_id'=$1` : '', p.cycle_id ? [p.cycle_id] : []);
    if (!cx.hr) rows = rows.filter(x => x.user_id === cx.cu.id ? x.visible_to_employee !== false : cx.down.has(x.user_id) || x.created_by === cx.cu.id);
    const programs = (await all("SELECT id, data FROM entities WHERE type='TrainingProgram'")).map(r => ({ id: r.id, ...(jparse(r.data) || {}) })).map(x => ({ id: x.id, title: x.title || x.name || '' }));
    return res.json({ success: true, plans: rows.map(x => ({ ...x, employee: cx.pp.byUser[x.user_id]?.name || '' })), programs });
  },

  // ── dashboard / analytics ──
  async ap_dashboard({ p, cx, res }) {
    const cycles = (await list(T.cycle)).filter(c => !['draft', 'configured'].includes(c.status) || cx.hr).sort((a, b) => String(b.review_end).localeCompare(String(a.review_end)));
    const cycle = cycles.find(c => c.id === p.cycle_id) || cycles[0]; if (!cycle) return res.json({ success: true, cycle: null, is_hr: cx.hr, is_manager: cx.down.size > 0, cycles: [] });
    const all_ = (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [cycle.id])).filter(r => !r.excluded);
    const mine = all_.find(r => r.user_id === cx.cu.id); const team = cx.hr ? all_ : all_.filter(r => r.manager_id === cx.cu.id || cx.down.has(r.user_id));
    const count = (rows) => ({ total: rows.length, started: rows.filter(r => r.self_status !== 'pending').length, self_submitted: rows.filter(r => r.self_status === 'submitted').length, self_pending: rows.filter(r => r.self_status !== 'submitted').length, mgr_submitted: rows.filter(r => r.mgr_status === 'submitted').length, mgr_pending: rows.filter(r => r.self_status === 'submitted' && r.mgr_status !== 'submitted').length, meetings_scheduled: rows.filter(r => ['scheduled', 'rescheduled'].includes(r.meeting_status)).length, meetings_completed: rows.filter(r => r.meeting_status === 'completed').length, meetings_pending: rows.filter(r => r.mgr_status === 'submitted' && r.meeting_status !== 'completed').length, hr_pending: rows.filter(r => A.deriveStatus(r) === 'hr_review_pending').length, finalised: rows.filter(r => ['approved', 'published', 'closed'].includes(A.deriveStatus(r))).length, late_self: rows.filter(r => r.flags?.late_self).length });
    const out = { success: true, is_hr: cx.hr, is_manager: cx.down.size > 0, cycle: { id: cycle.id, name: cycle.name, status: cycle.status, deadlines: cycle.deadlines, review_start: cycle.review_start, review_end: cycle.review_end }, cycles: cycles.map(c => ({ id: c.id, name: c.name, status: c.status })) };
    if (mine) { const v = viewReview(cx, mine, cycle); const goals = await list(T.goal, `AND data::jsonb->>'review_id'=$1`, [mine.id]); out.me = { review_id: mine.id, status: v.status, status_label: v.status_label, kpis: A.flattenKpis(mine.assignment?.items).length, goals_total: goals.length, goals_done: goals.filter(g => g.status === 'completed').length, goal_completion: goals.length ? Math.round(goals.filter(g => g.status === 'completed').length / goals.length * 100) : 0, self_deadline: cycle.deadlines.self, days_to_self_deadline: A.daysUntil(cycle.deadlines.self), meeting_status: mine.meeting_status || 'not_scheduled', final: v.employee_visible ? v.scores?.final : null, band: v.employee_visible ? v.scores?.band : null }; }
    if (cx.hr || cx.down.size) out.team = count(team);
    if (cx.hr) { out.hr = count(all_); out.hr.completion = all_.length ? Math.round(out.hr.finalised / all_.length * 100) : 0; }
    return res.json(out);
  },
  async ap_analytics({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; const f = p.filters || {};
    let rs = (await list(T.review)).filter(r => !r.excluded); const cycles = await list(T.cycle); const cyc = Object.fromEntries(cycles.map(c => [c.id, c]));
    if (f.cycle_id) rs = rs.filter(r => r.cycle_id === f.cycle_id); if (f.financial_year) rs = rs.filter(r => cyc[r.cycle_id]?.financial_year === f.financial_year);
    if (f.department) rs = rs.filter(r => r.emp.department === f.department); if (f.designation) rs = rs.filter(r => r.emp.designation === f.designation); if (f.manager_id) rs = rs.filter(r => r.manager_id === f.manager_id); if (f.user_id) rs = rs.filter(r => r.user_id === f.user_id); if (f.band) rs = rs.filter(r => r.scores?.band === f.band);
    const scored = rs.filter(r => r.scores?.final != null && ['approved', 'published', 'closed'].includes(A.deriveStatus(r)) || (r.scores?.manager != null && f.include_unapproved));
    const group = (key) => { const m = {}; for (const r of scored) (m[key(r) || '—'] ||= []).push(r.scores.final ?? r.scores.manager); return Object.entries(m).map(([k, v]) => ({ key: k, n: v.length, avg: A.round(v.reduce((a, b) => a + b, 0) / v.length, 2) })).sort((a, b) => b.avg - a.avg); };
    const dist = {}; for (const r of scored) dist[r.scores.band || '—'] = (dist[r.scores.band || '—'] || 0) + 1;
    const mgrCompletion = {}; for (const r of rs) { const k = r.emp.manager_name || '—'; const x = (mgrCompletion[k] ||= { total: 0, done: 0 }); x.total++; if (r.mgr_status === 'submitted') x.done++; }
    const kpiAch = {}; for (const r of rs) for (const k of A.flattenKpis(r.assignment?.items)) { const m = r.mgr?.kpis?.[k.id]; if (m?.verified_actual === undefined || m.verified_actual === '' || !(Number(k.target) > 0)) continue; const a = Number(m.verified_actual); if (!Number.isFinite(a)) continue; (kpiAch[k.title] ||= []).push(Math.min(200, a / Number(k.target) * 100)); }
    const plans = await list(T.plan); const planRows = plans.filter(x => rs.some(r => r.id === x.review_id)); const cat = {}; for (const x of planRows) cat[x.category] = (cat[x.category] || 0) + 1;
    const ranked = [...scored].sort((a, b) => (b.scores.final ?? b.scores.manager) - (a.scores.final ?? a.scores.manager));
    const byCycle = {}; for (const r of rs) { const x = (byCycle[r.cycle_id] ||= { total: 0, done: 0, name: cyc[r.cycle_id]?.name }); x.total++; if (['approved', 'published', 'closed'].includes(A.deriveStatus(r))) x.done++; }
    return res.json({ success: true, totals: { reviews: rs.length, scored: scored.length }, by_department: group(r => r.emp.department), by_designation: group(r => r.emp.designation), rating_distribution: Object.entries(dist).map(([band, count]) => ({ band, count })), manager_completion: Object.entries(mgrCompletion).map(([manager, v]) => ({ manager, ...v, pct: Math.round(v.done / v.total * 100) })), kpi_achievement: Object.entries(kpiAch).map(([kpi, v]) => ({ kpi, n: v.length, avg_pct: A.round(v.reduce((a, b) => a + b, 0) / v.length, 1) })), training_by_category: Object.entries(cat).map(([category, count]) => ({ category, count })),
      top: ranked.slice(0, 10).map(r => ({ name: r.emp.name, department: r.emp.department, score: r.scores.final ?? r.scores.manager, band: r.scores.band })), needs_improvement: ranked.slice(-10).reverse().filter(r => (r.scores.final ?? r.scores.manager) < 60).map(r => ({ name: r.emp.name, department: r.emp.department, score: r.scores.final ?? r.scores.manager, band: r.scores.band })), completion_trend: Object.values(byCycle).map(x => ({ cycle: x.name, pct: Math.round(x.done / x.total * 100), total: x.total })),
      filters: { cycles: cycles.map(c => ({ id: c.id, name: c.name, financial_year: c.financial_year })), departments: [...new Set(cx.pp.list.map(e => e.department).filter(Boolean))].sort(), designations: [...new Set(cx.pp.list.map(e => e.designation).filter(Boolean))].sort() } });
  },
  async ap_audit_log({ p, cx, res, hrOnly }) {
    if (hrOnly()) return; let where = ''; const params = [];
    if (p.review_id) { where = `AND data::jsonb->>'review_id'=$1`; params.push(p.review_id); } else if (p.cycle_id) { where = `AND data::jsonb->>'cycle_id'=$1`; params.push(p.cycle_id); }
    const rows = (await list(T.audit, where, params)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 500);
    return res.json({ success: true, logs: rows });
  },
  async ap_send_reminders({ cx, res, hrOnly }) { if (hrOnly()) return; return res.json({ success: true, ...(await sendAppraisalReminders()) }); },
  async ap_export({ p, cx, res, hrOnly }) {
    const rep = String(p.report || ''); const hrReports = ['department', 'kpi_achievement', 'pending', 'meetings', 'calibration', 'training', 'final_summary', 'self_assessments', 'manager_evaluations'];
    if (hrReports.includes(rep) && hrOnly()) return;
    const { exportReport } = await import('../utils/appraisalExport.js');
    const c = await loadCycle(p.cycle_id); if (!c && rep !== 'individual') return fail(res, 'Choose a cycle', 400);
    let reviews = p.cycle_id ? (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [p.cycle_id])).filter(r => !r.excluded) : [];
    if (rep === 'individual') { const { review } = await reviewFor(cx, res, p.review_id, 'view'); if (!review) return; reviews = [review]; }
    else if (!cx.hr) reviews = reviews.filter(r => r.manager_id === cx.cu.id || cx.down.has(r.user_id));
    const meetings = await list(T.meeting); const plans = await list(T.plan);
    const out = await exportReport({ report: rep, format: p.format || 'xlsx', cycle: c || (await loadCycle(reviews[0]?.cycle_id)), reviews, meetings, plans, people: cx.pp, hrView: cx.hr, viewerId: cx.cu.id, evaluatorOf: (r) => r.manager_id === cx.cu.id });
    if (out.error) return fail(res, out.error);
    await audit(cx, res, { action: 'report_exported', entity: 'report', cycle_id: p.cycle_id, next: { report: rep, format: p.format || 'xlsx', rows: reviews.length } });
    return res.json({ success: true, ...out });
  },
};

// ── shared mutations ─────────────────────────────────────────
function applyAssignment(r, { template, items, source, by, reason, overwrite }) {
  const prev = r.assignment;
  if (prev?.items?.length && !overwrite && prev.source === 'custom') return false;   // never silently replace employee-specific KPIs
  const history = [...arr(prev?.history), ...(prev?.items ? [{ at: now(), by: prev.assigned_by, replaced_by: by, reason, template_id: prev.template_id, template_version: prev.template_version, source: prev.source, items: prev.items }] : [])].slice(-20);
  r.assignment = { template_id: template?.id || '', template_name: template?.name || (source === 'custom' ? 'Custom' : ''), template_version: template?.version || 0, source, items: JSON.parse(JSON.stringify(items)), assigned_by: by, assigned_at: now(), history };
  r.assigned = true; return true;
}

async function syncCycleEmployees(cx, res, c, { add, remove = [], reason = '' }) {
  const existing = await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id]); const have = new Set(existing.map(r => r.user_id));
  const settings = c.settings; void settings;
  const wanted = add === null ? A.eligibleEmployees(c.eligibility, cx.pp.list, c.review_end) : arr(add).map(id => cx.pp.byUser[id]).filter(Boolean);
  const created = [];
  for (const e of wanted) {
    if (have.has(e.user_id)) continue;
    const r = { id: uuidv4(), cycle_id: c.id, user_id: e.user_id, manager_id: e.manager_id || '', emp: { name: e.name, code: e.code, department: e.department, designation: e.designation, location: e.location, manager_id: e.manager_id, manager_name: e.manager_name, joined: e.joined }, assigned: false,
      self_status: 'pending', mgr_status: 'pending', meeting_status: 'not_scheduled', meeting_required: c.meeting_required !== false, hr_status: 'pending', self: { kpis: {}, questionnaire: {} }, mgr: { kpis: {}, questionnaire: {}, competencies: {} }, scores: {}, flags: { no_manager: !e.manager_id }, created_at: now(), created_by: cx.cu.id };
    // a template flagged on the cycle is applied straight away to everyone it was built for
    if (c.template_id) { const t = await load(T.template, c.template_id); if (t && !t.deleted && A.validateKpiWeights(t.items).ok) applyAssignment(r, { template: t, items: t.items, source: 'template', by: cx.cu.id, reason: 'Cycle template' }); }
    else { const tpls = (await list(T.template)).filter(t => !t.deleted && t.status === 'approved'); const t = tpls.find(t => t.designation && t.designation.toLowerCase() === String(e.designation).toLowerCase() && (!t.department || t.department.toLowerCase() === String(e.department).toLowerCase())) || tpls.find(t => t.department && !t.designation && t.department.toLowerCase() === String(e.department).toLowerCase()); if (t) applyAssignment(r, { template: t, items: t.items, source: 'template', by: cx.cu.id, reason: 'Matched by designation/department' }); }
    await save(T.review, r, r.user_id, A.deriveStatus(r)); created.push(r);
  }
  for (const uid of arr(remove)) { const r0 = existing.find(r => r.user_id === uid); if (r0) await withLock(r0.id, async () => { const r = await load(T.review, r0.id); r.excluded = true; r.exclusion_reason = reason || 'Removed from cycle'; await save(T.review, r, r.user_id, A.deriveStatus(r)); }); }
  if (created.length || arr(remove).length) await audit(cx, res, { action: 'cycle_employees_changed', entity: 'cycle', cycle_id: c.id, next: { added: created.length, removed: arr(remove).length }, reason });
  return created;
}

async function saveSelf(cx, res, p, submit) {
  const { review, cycle } = await reviewFor(cx, res, p.review_id, 'own'); if (!review) return; if (frozenCycle(res, cycle)) return;
  if (!review.assigned) return fail(res, 'Your KPIs have not been assigned yet. Please ask your manager or HR.', 409);
  if (review.self_status === 'submitted') return fail(res, 'You already submitted this self-assessment. Ask HR to reopen it if it needs a change.', 409);
  if (review.excluded) return fail(res, 'You are not part of this appraisal', 409);
  const kpis = A.flattenKpis(review.assignment.items); const ids = new Set(kpis.map(k => k.id));
  const cleaned = {}; for (const [id, v] of Object.entries(p.kpis || {})) { if (!ids.has(id)) continue; const rating = v.rating === '' || v.rating == null ? null : Number(v.rating); if (rating !== null && !cycle.settings.scale.some(s => Number(s.value) === rating)) return fail(res, `Rating for "${kpis.find(k => k.id === id).title}" is not on the rating scale`); cleaned[id] = { actual: clean(v.actual, 120), rating, explanation: clean(v.explanation, 2000), challenges: clean(v.challenges, 1500), comments: clean(v.comments, 1500), evidence: arr(v.evidence).slice(0, 10).map(x => ({ name: clean(x.name, 120), url: clean(x.url, 500) })) }; }
  const q = {}; for (const f of SELF_FORM.flatMap(s => s.questions)) if (p.questionnaire?.[f.id] !== undefined) q[f.id] = clean(p.questionnaire[f.id], 3000);
  let late = false;
  if (submit) {
    if (p.declaration !== true) return fail(res, 'Please accept the declaration before submitting');
    const missing = kpis.filter(k => !(cleaned[k.id]?.rating ?? review.self?.kpis?.[k.id]?.rating)); if (missing.length) return fail(res, `Rate every KPI before submitting (missing: ${missing.slice(0, 3).map(k => k.title).join(', ')}${missing.length > 3 ? '…' : ''})`);
    late = A.isPastDeadline(cycle.deadlines.self);
    if (late && cycle.allow_late_submission === false && !review.flags?.late_authorized) return fail(res, 'The self-assessment deadline has passed. HR must authorise a late submission.', 409);
  }
  let out;
  await withLock(review.id, async () => {
    const r = await load(T.review, review.id); if (r.self_status === 'submitted') { out = fail(res, 'Already submitted', 409); return; }
    r.self = { ...r.self, kpis: { ...r.self?.kpis, ...cleaned }, questionnaire: { ...r.self?.questionnaire, ...q }, saved_at: now(), version: (r.self?.version || 0) + (submit ? 1 : 0) };
    r.self_status = 'draft';
    if (submit) { r.self_status = 'submitted'; r.self.declared = true; r.self.declared_at = now(); r.self.submitted_at = now(); r.self.late = late; if (late) r.flags = { ...r.flags, late_self: true }; r.self_versions = [...arr(r.self_versions)]; r.hr_status = r.hr_status === 'returned' ? 'pending' : r.hr_status; }
    recompute(r, cycle); await save(T.review, r, r.user_id, A.deriveStatus(r));
    if (cycle.status === 'published') { cycle.status = 'in_progress'; cycle.status_history = [...arr(cycle.status_history), { status: 'in_progress', at: now(), note: 'first activity' }]; await save(T.cycle, cycle, null, 'in_progress'); }
    if (submit) {
      await audit(cx, res, { action: late ? 'self_submitted_late' : 'self_submitted', entity: 'self_assessment', review_id: r.id, cycle_id: r.cycle_id, employee_id: r.user_id, next: { version: r.self.version, score: r.scores.self, late } });
      await notify([r.manager_id], { title: 'Self-assessment submitted', message: `${r.emp.name} submitted the ${cycle.name} self-assessment${late ? ' (late)' : ''}. Your evaluation is due by ${cycle.deadlines.manager}.`, key: `selfsub:${r.id}:${r.self.version}` });
      if (late) await notify(cx.pp.list.filter(e => false).map(e => e.user_id), { title: '', message: '' });
    }
    out = res.json({ success: true, status: A.deriveStatus(r), late, self_score: r.scores.self });
  });
  return out;
}

async function saveManager(cx, res, p, submit) {
  const { review, cycle } = await reviewFor(cx, res, p.review_id, 'evaluate'); if (!review) return; if (frozenCycle(res, cycle)) return;
  if (review.mgr_status === 'submitted') return fail(res, 'You already submitted this evaluation. HR can return it for correction.', 409);
  if (!review.assigned) return fail(res, 'This employee has no KPIs assigned', 409);
  if (review.self_status !== 'submitted' && !review.flags?.self_waived) return fail(res, 'The employee has not submitted a self-assessment yet. HR can waive it if the employee cannot take part.', 409);
  const kpis = A.flattenKpis(review.assignment.items); const ids = new Set(kpis.map(k => k.id)); const scale = cycle.settings.scale;
  const cleaned = {}; for (const [id, v] of Object.entries(p.kpis || {})) { if (!ids.has(id)) continue; const rating = v.rating === '' || v.rating == null ? null : Number(v.rating); if (rating !== null && !scale.some(s => Number(s.value) === rating)) return fail(res, 'A rating is not on the rating scale'); cleaned[id] = { rating, remarks: clean(v.remarks, 2000), verified_actual: clean(v.verified_actual, 120), gap: clean(v.gap, 1000), improvement: clean(v.improvement, 1000), evidence_note: clean(v.evidence_note, 500) }; }
  const comps = {}; for (const [id, v] of Object.entries(p.competencies || {})) { const n = v === '' || v == null ? null : Number(v); if (n !== null) { if (!scale.some(s => Number(s.value) === n)) return fail(res, 'A competency rating is not on the rating scale'); comps[id] = n; } }
  const q = {}; for (const f of MANAGER_FORM.flatMap(s => s.questions)) if (p.questionnaire?.[f.id] !== undefined) q[f.id] = clean(p.questionnaire[f.id], 3000);
  if (submit) {
    const merged = { ...review.mgr?.kpis, ...cleaned }; const missing = kpis.filter(k => !merged[k.id]?.rating); if (missing.length) return fail(res, `Rate every KPI before submitting (missing: ${missing.slice(0, 3).map(k => k.title).join(', ')})`);
    if (Number(cycle.settings.split?.competency) > 0) { const cm = { ...review.mgr?.competencies, ...comps }; const mc = cycle.settings.competencies.filter(c => c.enabled && !cm[c.id]); if (mc.length) return fail(res, `Rate every competency before submitting (missing: ${mc.slice(0, 3).map(c => c.name).join(', ')})`); }
    const qq = { ...review.mgr?.questionnaire, ...q }; if (!qq.m_contrib || !qq.m_improve) return fail(res, 'Answer the evaluation questions on major contributions and areas that need improvement');
  }
  let out;
  await withLock(review.id, async () => {
    const r = await load(T.review, review.id); if (r.mgr_status === 'submitted') { out = fail(res, 'Already submitted', 409); return; }
    r.mgr = { ...r.mgr, kpis: { ...r.mgr?.kpis, ...cleaned }, competencies: { ...r.mgr?.competencies, ...comps }, questionnaire: { ...r.mgr?.questionnaire, ...q },
      employee_feedback: p.employee_feedback !== undefined ? clean(p.employee_feedback, 3000) : r.mgr?.employee_feedback || '', confidential_note: p.confidential_note !== undefined ? clean(p.confidential_note, 3000) : r.mgr?.confidential_note || '',
      recommend_responsibility: p.recommend_responsibility !== undefined ? clean(p.recommend_responsibility, 1000) : r.mgr?.recommend_responsibility || '', recommend_training: p.recommend_training !== undefined ? clean(p.recommend_training, 1000) : r.mgr?.recommend_training || '', saved_at: now() };
    r.mgr_status = 'draft';
    if (submit) { r.mgr_status = 'submitted'; r.mgr.submitted_at = now(); r.mgr.submitted_by = cx.cu.id; r.mgr.version = (r.mgr.version || 0) + 1; r.hr_status = r.hr_status === 'returned' ? 'pending' : r.hr_status; r.scores = { ...r.scores, original_manager: undefined }; }
    recompute(r, cycle);
    if (submit && r.scores.manager !== null) r.scores.original_manager = r.scores.original_manager ?? r.scores.manager;
    await save(T.review, r, r.user_id, A.deriveStatus(r));
    if (submit) {
      await audit(cx, res, { action: 'manager_submitted', entity: 'manager_evaluation', review_id: r.id, cycle_id: r.cycle_id, employee_id: r.user_id, next: { score: r.scores.manager, band: r.scores.band, gaps: (r.scores.gaps || []).length } });
      const hrs = (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')")).map(x => x.id);
      await notify(hrs, { title: 'Manager evaluation submitted', message: `${r.emp.name} (${cycle.name}) is ready for HR review.`, key: `mgrsub:${r.id}:${r.mgr.version}` });
    }
    out = res.json({ success: true, status: A.deriveStatus(r), manager_score: r.scores.manager, band: r.scores.band, incomplete: r.scores.incomplete });
  });
  return out;
}

// reminders: deadline approaching → the people who still owe something (once per person per deadline per day-offset)
export async function sendAppraisalReminders() {
  const st = await getSettings(); const days = arr(st.reminder_days); const cycles = (await list(T.cycle)).filter(c => ['published', 'in_progress', 'under_hr_review'].includes(c.status)); let sent = 0;
  for (const c of cycles) {
    const rs = (await list(T.review, `AND data::jsonb->>'cycle_id'=$1`, [c.id])).filter(r => !r.excluded);
    for (const [kind, deadline] of [['self', c.deadlines.self], ['manager', c.deadlines.manager], ['meeting', c.deadlines.meeting], ['hr', c.deadlines.hr]]) {
      const left = A.daysUntil(deadline); if (left === null || !days.includes(left)) continue;
      let who = [];
      if (kind === 'self') who = rs.filter(r => r.assigned && r.self_status !== 'submitted').map(r => r.user_id);
      else if (kind === 'manager') who = [...new Set(rs.filter(r => r.self_status === 'submitted' && r.mgr_status !== 'submitted').map(r => r.manager_id))];
      else if (kind === 'meeting') who = [...new Set(rs.filter(r => r.mgr_status === 'submitted' && r.meeting_status !== 'completed').map(r => r.manager_id))];
      else who = (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')")).map(x => x.id);
      const label = { self: 'self-assessment', manager: 'manager evaluation', meeting: 'review meetings', hr: 'HR finalisation' }[kind];
      await notify(who, { title: `Appraisal deadline in ${left} day${left === 1 ? '' : 's'}`, message: `${c.name}: ${label} is due on ${deadline}.`, key: `rem:${c.id}:${kind}:${left}` }); sent += who.length;
    }
  }
  return { reminders: sent };
}

// ── forms ──
const DECLARATION = 'I confirm that the information and achievements submitted in this self-assessment are accurate to the best of my knowledge.';
export const SELF_FORM = [
  { id: 'A', title: 'Key Achievements', questions: [
    { id: 's_a1', text: 'What were your most significant achievements during this review period?', required: true }, { id: 's_a2', text: 'Which projects or initiatives did you successfully complete?' },
    { id: 's_a3', text: 'What measurable value did you contribute to the organisation?' }, { id: 's_a4', text: 'Did you exceed any assigned targets?' } ] },
  { id: 'B', title: 'Performance Challenges', questions: [
    { id: 's_b1', text: 'What challenges affected your performance?' }, { id: 's_b2', text: 'Which targets were not achieved?' }, { id: 's_b3', text: 'What factors contributed to the shortfall?' }, { id: 's_b4', text: 'What support would have helped you perform better?' } ] },
  { id: 'C', title: 'Skills and Development', questions: [
    { id: 's_c1', text: 'What new skills did you acquire?' }, { id: 's_c2', text: 'What technical or professional skills improved?' }, { id: 's_c3', text: 'Which areas require additional training?' }, { id: 's_c4', text: 'What training programmes would you like to attend?' } ] },
  { id: 'D', title: 'Professional Growth', questions: [
    { id: 's_d1', text: 'What responsibilities would you like to take on?' }, { id: 's_d2', text: 'What are your professional development goals?' }, { id: 's_d3', text: 'Do you require any support from your manager or HR?' } ] },
  { id: 'E', title: 'Employee Feedback', questions: [
    { id: 's_e1', text: 'Additional comments' }, { id: 's_e2', text: 'Suggestions for process improvement' }, { id: 's_e3', text: 'Feedback about team coordination' }, { id: 's_e4', text: 'Feedback about management support' } ] },
];
export const MANAGER_FORM = [
  { id: 'M', title: 'Evaluation', questions: [
    { id: 'm_targets', text: 'How effectively did the employee achieve assigned targets?' }, { id: 'm_contrib', text: 'What were the employee\'s major contributions?', required: true },
    { id: 'm_resp', text: 'How effectively did the employee manage responsibilities?' }, { id: 'm_collab', text: 'How well did the employee collaborate with other teams?' },
    { id: 'm_solve', text: 'How effectively did the employee solve problems?' }, { id: 'm_improve', text: 'What areas require improvement?', required: true },
    { id: 'm_more', text: 'What additional responsibilities can the employee handle?' }, { id: 'm_train', text: 'What training or development is recommended?' } ] },
];
