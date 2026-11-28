// Offer letters: the master lists of the offer form, saving offers (direct, or against a recruitment record), the register
// of everything generated and sent, the audit trail, and joining a candidate to one employee profile (of_* functions).
// The letter itself is built and emailed by previewOfferLetterPdf / sendOfferLetter in functions.js, which use
// prepareOffer() below so both routes are validated the same way.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { computeOfferSalary } from '../utils/offerSalary.js';
import { listSignatories } from '../utils/signatoryStore.js';
import { isLeaver } from '../utils/leavers.js';
import { requisitionOf, appendTimeline } from '../utils/hiringLifecycle.js';
import * as R from '../utils/offerRules.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const clean = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const nowIso = () => new Date().toISOString();
export const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fail = (res, error, code = 400, extra = {}) => res.status(code).json({ success: false, error, ...extra });

export async function offerActor(cu) {
  const u = (cu && await one('SELECT role, custom_role, full_name, email FROM users WHERE id=$1', [cu.id])) || {};
  const has = (...roles) => [u.role, u.custom_role].some((r) => roles.includes(r));
  return { id: cu?.id, name: u.full_name || u.email || '', isHr: has('hr', 'admin'), canOffer: has('hr', 'admin', 'recruiter') };
}
// offers made outside recruitment are HR / admin work; recruiters handle the ones that come through recruitment
export const accessProblem = (actor, candidate) => (!actor.canOffer ? 'HR / Recruiter access required' : candidate && R.offerSource(candidate) === 'direct' && !actor.isHr ? 'Direct offers are handled by HR or admin only' : '');

export async function offerAudit(candidate_id, action, actor, detail = {}) {
  try {
    const id = uuidv4();
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'OfferAudit',NULL,'active',$2)",
      [id, JSON.stringify({ id, candidate_id, action, by: actor?.id || '', by_name: actor?.name || '', at: nowIso(), ...detail })]);
  } catch (e) { console.warn('[offer] audit failed:', e.message); }
}

async function loadCandidate(id) {
  const row = id ? await one("SELECT id, data FROM entities WHERE type='Candidate' AND id=$1", [id]) : null;
  return row ? { ...parse(row.data), id: row.id } : null;
}
async function saveCandidate(c) { await run("UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE type='Candidate' AND id=$3", [c.status || null, JSON.stringify(c), c.id]); }

async function employeeDirectory() {
  const users = Object.fromEntries((await all('SELECT * FROM users')).map((u) => [u.id, u]));
  return (await all("SELECT id, user_id, data FROM entities WHERE type='Employee'")).map((r) => {
    const e = parse(r.data), u = users[r.user_id || e.user_id] || {};
    return { ...e, id: r.id, user_id: r.user_id || e.user_id, display_name: e.display_name || u.full_name || '', login_email: u.former_email || u.email || '', role: u.custom_role || u.role || '' };
  });
}
const isActiveEmployee = (e) => !isLeaver(e) && e.status === 'active';

export async function offerMasters() {
  const on = (d) => d && d.name && String(d.is_active) !== 'false' && d.is_active !== 0 && !['inactive', 'archived', 'deleted'].includes(String(d.status || '').toLowerCase());
  const rows = async (type) => (await all('SELECT data FROM entities WHERE type=$1', [type])).map((r) => parse(r.data));
  const names = (list) => [...new Set(list.map((x) => String(x).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const departments = names((await rows('Department')).filter(on).map((d) => d.name));
  const offices = names((await rows('AppLocation')).filter(on).map((d) => d.name));
  const directory = await employeeDirectory();
  const managers = directory.filter(isActiveEmployee).map((e) => ({ id: e.user_id, name: e.display_name, code: e.employee_code || '', designation: e.designation || '' }))
    .filter((m) => m.id && m.name).sort((a, b) => a.name.localeCompare(b.name));
  const designations = names([
    ...(await rows('MrfMaster')).filter((m) => m.kind === 'designation' && m.is_active !== false).map((m) => m.label || m.value),
    ...directory.map((e) => e.designation || ''),
  ]);
  const schedules = names((await rows('Shift')).map((s) => (s.name ? `${s.name} (${s.start_time} – ${s.end_time})` : '')));
  return { departments, offices, designations, managers, schedules, managerIds: managers.map((m) => m.id) };
}

async function requisitionFor(c) {
  const rid = requisitionOf(c);
  const row = rid ? await one("SELECT id, data FROM entities WHERE type='JobRequisition' AND id=$1", [rid]) : null;
  return row ? { ...parse(row.data), id: row.id } : null;
}

/**
 * One offer, ready to print: what the candidate record already holds, overlaid with the request. A recruitment record
 * keeps its own name and email (a different recipient is given as recipient_email). Throws nothing; returns
 * { status, error, problems } when it cannot be generated.
 */
export async function prepareOffer(candidate_id, request, cu) {
  const actor = await offerActor(cu);
  if (!actor.canOffer) return { status: 403, error: 'HR / Recruiter access required' };
  const candidate = await loadCandidate(candidate_id);
  if (!candidate) return { status: 200, error: 'Candidate not found' };
  const denied = accessProblem(actor, candidate);
  if (denied) return { status: 403, error: denied };
  const source = R.offerSource(candidate);
  const masters = await offerMasters();
  const mrf = await requisitionFor(candidate);
  const today = istToday();
  const given = R.cleanOffer(request);
  if (source !== 'direct') { delete given.full_name; delete given.email; }
  const input = { ...R.offerPrefill(candidate, mrf, { offices: masters.offices, today }).form, ...given };
  if (!input.issue_date) input.issue_date = today;
  const problems = R.offerProblems(input, masters, today);
  if (input.recipient_email && !R.VALID_EMAIL.test(input.recipient_email)) problems.push('The recipient email address is not valid');
  if (problems.length) return { status: 200, error: problems.join('. ') + '.', problems };
  input.reporting_to = input.reporting_manager_id === R.NO_MANAGER ? '' : masters.managers.find((m) => m.id === input.reporting_manager_id)?.name || input.reporting_to || '';
  return { actor, candidate, source, mrf, input };
}

/** The candidate record with the offer form saved on it (the form is what "edit" and "regenerate" reopen). */
export function withDraft(candidate, input) {
  const direct = R.offerSource(candidate) === 'direct';
  return {
    ...candidate,
    offer_draft: input,
    ...(direct ? { offer_source: 'direct', full_name: input.full_name || candidate.full_name, email: String(input.email || candidate.email || '').toLowerCase(), position_applied: input.designation || candidate.position_applied, designation: input.designation || candidate.designation, department: input.department || candidate.department } : {}),
    phone: input.phone || candidate.phone, current_address: input.current_address || candidate.current_address || '',
  };
}

const MAX_BYTES = 7 * 1024 * 1024;
/** The files attached to an offer, read from app storage. */
export async function loadAttachments(list) {
  const out = []; let bytes = 0;
  for (const a of R.cleanAttachments(list)) {
    const id = a.url.split('/').pop().replace(/\.[^.]+$/, '');
    const row = await one('SELECT filename, mime, data, storage, r2_key FROM files WHERE id=$1', [id]);
    if (!row) return { error: `The attachment "${a.name}" is no longer available. Remove it and attach it again.` };
    let content = row.data;
    if (!content && row.storage === 'railway' && row.r2_key) {
      try { const { getFromBucket } = await import('../utils/bucket.js'); content = Buffer.from(await (await getFromBucket(row.r2_key)).Body.transformToByteArray()); }
      catch (e) { console.warn('[offer] attachment read failed:', e.message); }
    }
    if (!content) return { error: `The attachment "${a.name}" could not be read.` };
    bytes += content.length;
    if (bytes > MAX_BYTES) return { error: 'The attachments are larger than 7 MB together. Remove or shrink some.' };
    out.push({ filename: row.filename || a.name, content, contentType: row.mime || undefined });
  }
  return { files: out };
}

/* ── joining: one candidate, one employee profile ─────────────────────── */
const linkedCandidate = async (userId, exceptId) => (await all("SELECT id, data FROM entities WHERE type='Candidate' AND data::jsonb->>'employee_user_id'=$1", [userId])).filter((r) => r.id !== exceptId).map((r) => parse(r.data))[0] || null;

export async function matchesFor(candidate) {
  const found = R.matchEmployees(candidate, (await employeeDirectory()).filter((e) => e.role !== 'onboarding_pending'));
  return found.slice(0, 10).map(({ employee: e, reasons, strong }) => ({ user_id: e.user_id, name: e.display_name, employee_code: e.employee_code || '', department: e.department || '', designation: e.designation || '', date_of_joining: e.date_of_joining || '', left: isLeaver(e), reasons, strong, linked_candidate_id: e.candidate_id && e.candidate_id !== candidate.id ? e.candidate_id : '' }));
}

/** Why a new employee profile must not be created for this candidate ('' when it may). */
export async function onboardingProblem(candidate_id) {
  const c = await loadCandidate(candidate_id);
  if (!c) return 'The candidate record was not found.';
  if (c.employee_user_id) return `This candidate is already linked to employee ${c.employee_code || ''}. A second profile cannot be created.`.replace('  ', ' ');
  if (!R.LINKABLE_STATUSES.includes(c.status)) return 'An employee profile is created from an offer only after the candidate has accepted it.';
  const dup = (await matchesFor(c)).find((m) => m.strong && !m.left);
  if (dup) return `${dup.name} (${dup.employee_code}) already has an employee profile with the ${dup.reasons.filter((r) => r !== 'same name').join(' and ')}. Link the candidate to that profile instead (Offer Letters → Employee profile).`;
  return '';
}

export async function onboardingPrefill(c) {
  const d = c.offer_draft || {};
  const [first, ...rest] = String(c.full_name || '').trim().split(/\s+/);
  const mgr = c.reporting_manager_id || d.reporting_manager_id || '';
  return {
    candidate_id: c.id, candidate_name: c.full_name || '', first_name: first || '', last_name: rest.join(' '), personal_email: c.email || '', phone: c.phone || '',
    department: c.department || '', designation: c.designation || c.position_applied || '', date_of_joining: c.joining_date || '', work_location: c.location || '',
    employment_type: R.onboardingType(c.employment_type), reporting_manager_id: mgr === R.NO_MANAGER ? '' : mgr, no_reporting_manager: mgr === R.NO_MANAGER,
    annual_ctc: c.offer_ctc_annual || '', medical_contribution: c.salary?.medical_monthly || '',
  };
}

async function setEmployeeCandidate(userId, candidateId) {
  const row = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
  if (!row) return null;
  const e = parse(row.data);
  if (candidateId) e.candidate_id = candidateId; else delete e.candidate_id;
  await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(e), row.id]);
  return { ...e, id: row.id };
}

async function markJoined(c, actor, text) {
  if (c.status === 'joined') return c;
  const next = { ...c, status: 'joined', joined_at: nowIso(), timeline: appendTimeline(c, { type: 'status', from: c.status, to: 'joined', text, by: actor?.id, by_name: actor?.name || '' }) };
  await saveCandidate(next);
  try { const { mrfCandidateJoined } = await import('./mrf.js'); await mrfCandidateJoined(next, actor?.id); } catch (e) { console.warn('[offer] requisition update failed:', e.message); }
  return next;
}

/** Joins a candidate record to an employee profile; neither is duplicated. */
async function attach(candidate, userId, actor, method) {
  const emp = await setEmployeeCandidate(userId, candidate.id);
  const next = { ...candidate, employee_user_id: userId, employee_id: emp?.id || '', employee_code: emp?.employee_code || candidate.employee_code || '', employee_linked_at: nowIso(), employee_linked_by: actor?.id || '', employee_link_method: method };
  await saveCandidate(next);
  return next;
}
export async function onboardingStarted(candidate_id, userId, cu) {
  const c = await loadCandidate(candidate_id); if (!c) return;
  const actor = await offerActor(cu);
  await attach(c, userId, actor, 'onboarding');
  await offerAudit(candidate_id, 'onboarding_started', actor, { employee_user_id: userId });
}
export async function onboardingCompleted(candidate_id, userId) {
  const c = await loadCandidate(candidate_id); if (!c || c.employee_user_id !== userId) return;
  const system = { id: userId, name: c.full_name || 'Candidate' };
  await markJoined(c, system, 'Joined: onboarding completed');
  await offerAudit(candidate_id, 'joined', system, { employee_user_id: userId });
}
export async function onboardingCancelled(userId, cu) {
  const actor = await offerActor(cu);
  for (const r of await all("SELECT id, data FROM entities WHERE type='Candidate' AND data::jsonb->>'employee_user_id'=$1", [userId])) {
    const { employee_user_id, employee_id, employee_code, employee_linked_at, employee_linked_by, employee_link_method, ...c } = parse(r.data);
    await saveCandidate({ ...c, id: r.id });
    await offerAudit(r.id, 'onboarding_cancelled', actor, { employee_user_id: userId });
  }
}

/* ── functions ────────────────────────────────────────────────────────── */
export async function handleOffers(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const actor = await offerActor(cu);
  if (!actor.canOffer) return fail(res, 'HR / Recruiter access required', 403);

  if (name === 'of_calculate') return res.json({ success: true, salary: computeOfferSalary(p.annual_ctc, p.medical_contribution, p.salary_overrides) });

  if (name === 'of_options') {
    const m = await offerMasters();
    const signatories = (await listSignatories()).map(({ id, name: n, designation, is_default }) => ({ id, name: n, designation, is_default }));
    return res.json({ success: true, departments: m.departments, offices: m.offices, designations: m.designations, managers: m.managers, schedules: m.schedules, employment_types: R.OFFER_EMPLOYMENT_TYPES, signatories, today: istToday(), can_direct: actor.isHr });
  }

  // Create a direct offer record, or save the offer form of an existing candidate
  if (name === 'of_save') {
    const given = R.cleanOffer(p);
    if (!p.candidate_id) {
      if (!actor.isHr) return fail(res, 'Direct offers are created by HR or admin', 403);
      const email = String(given.email || '').toLowerCase();
      if (clean(given.full_name).length < 2) return fail(res, 'Enter the candidate’s full name.');
      if (!R.VALID_EMAIL.test(email)) return fail(res, 'Enter a valid personal email address.');
      if (!/^\+?[\d\s-]{10,15}$/.test(clean(given.phone, 20))) return fail(res, 'Enter a valid contact number.');
      const person = { full_name: given.full_name, email, phone: given.phone };
      const employee = (await matchesFor({ id: '', ...person })).find((m) => m.strong && !m.left);
      if (employee) return fail(res, `${employee.name} (${employee.employee_code}) is already an employee with the ${employee.reasons.filter((r) => r !== 'same name').join(' and ')}.`);
      const found = (await all("SELECT id, data FROM entities WHERE type='Candidate' AND LOWER(data::jsonb->>'email')=$1 LIMIT 1", [email]))[0];
      if (found) { const c = parse(found.data); return res.json({ success: true, existing: true, candidate: { ...c, id: found.id }, source: R.offerSource(c) }); }
      const id = uuidv4(), at = nowIso();
      const candidate = withDraft({
        id, full_name: given.full_name, email, phone: given.phone, status: 'selected', source: 'direct_offer', offer_source: 'direct', applied_date: istToday(), created_by: cu.id, created_at: at,
        timeline: [{ type: 'status', to: 'selected', text: 'Direct offer started', by: cu.id, by_name: actor.name, at }],
      }, { ...given, email });
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Candidate',NULL,'selected',$2)", [id, JSON.stringify(candidate)]);
      await offerAudit(id, 'direct_created', actor, { name: candidate.full_name });
      return res.json({ success: true, existing: false, candidate, source: 'direct' });
    }
    const candidate = await loadCandidate(p.candidate_id);
    if (!candidate) return fail(res, 'Candidate not found', 404);
    const denied = accessProblem(actor, candidate);
    if (denied) return fail(res, denied, 403);
    if (candidate.status === 'joined') return fail(res, 'This candidate has already joined, so the offer can no longer be edited.');
    if (R.offerSource(candidate) !== 'direct') { delete given.full_name; delete given.email; }
    else if (given.email !== undefined && !R.VALID_EMAIL.test(given.email)) return fail(res, 'Enter a valid personal email address.');
    const draft = { ...(candidate.offer_draft || {}), ...given };
    const changed = R.changedFields(candidate.offer_draft || {}, draft);
    const next = withDraft(candidate, draft);
    await saveCandidate(next);
    if (changed.length) await offerAudit(candidate.id, 'edited', actor, { fields: changed });
    return res.json({ success: true, candidate: next, changed });
  }

  if (name === 'of_register') {
    const candidates = new Map((await all("SELECT id, data FROM entities WHERE type='Candidate'")).map((r) => [r.id, parse(r.data)]));
    const reqs = new Map((await all("SELECT id, data FROM entities WHERE type='JobRequisition'")).map((r) => [r.id, parse(r.data).requisition_id || '']));
    const rows = (await all("SELECT data FROM entities WHERE type='OfferLetterDispatch' ORDER BY created_at DESC LIMIT 3000")).map((r) => parse(r.data)).map(({ pdf_base64, pdf_key, terms, ...d }) => {
      const c = candidates.get(d.candidate_id) || {};
      const source = R.offerSource(c);
      return { ...d, has_pdf: !!(pdf_base64 || pdf_key), source, requisition_no: reqs.get(requisitionOf(c)) || '', issue_date: d.issue_date || String(d.created_at || '').slice(0, 10), candidate_status: c.status || '', candidate_email: c.email || '', employee_user_id: c.employee_user_id || '', employee_code: c.employee_user_id ? c.employee_code || '' : '' };
    }).filter((r) => actor.isHr || r.source !== 'direct');
    return res.json({ success: true, rows });
  }

  // everything below concerns one candidate
  let candidate_id = p.candidate_id;
  let dispatch = null;
  if (name === 'of_download') {
    const row = await one("SELECT data FROM entities WHERE type='OfferLetterDispatch' AND id=$1", [p.id]);
    if (!row) return fail(res, 'Not found', 404);
    dispatch = parse(row.data); candidate_id = dispatch.candidate_id;
  }
  const candidate = await loadCandidate(candidate_id);
  if (!candidate) return fail(res, 'Candidate not found', 404);
  const denied = accessProblem(actor, candidate);
  if (denied) return fail(res, denied, 403);

  if (name === 'of_context') {
    const m = await offerMasters(), mrf = await requisitionFor(candidate);
    const { form, ctc_suggestion } = R.offerPrefill(candidate, mrf, { offices: m.offices, today: istToday() });
    const manual = mrf?.mrf_version === 2;
    const yearly = (v) => (v === null || v === undefined || v === '' ? null : Number(v) * (mrf.ctc_frequency === 'monthly' ? 12 : 1));
    return res.json({ success: true, candidate, source: R.offerSource(candidate), form, ctc_suggestion, requisition: mrf ? { id: mrf.id, requisition_id: mrf.requisition_id || '', ctc_min: manual ? yearly(mrf.ctc_min) : null, ctc_max: manual ? yearly(mrf.ctc_max) : null } : null });
  }
  if (name === 'of_history') {
    const rows = (await all("SELECT data FROM entities WHERE type='OfferLetterDispatch' AND data::jsonb->>'candidate_id'=$1 ORDER BY created_at DESC", [candidate.id])).map((r) => parse(r.data));
    return res.json({ success: true, history: rows.map(({ pdf_base64, pdf_key, ...r }) => ({ ...r, has_pdf: !!(pdf_base64 || pdf_key) })) });
  }
  if (name === 'of_audit') {
    const rows = (await all("SELECT data FROM entities WHERE type='OfferAudit' AND data::jsonb->>'candidate_id'=$1", [candidate.id])).map((r) => parse(r.data));
    return res.json({ success: true, audit: rows.sort((a, b) => String(b.at).localeCompare(String(a.at))) });
  }
  if (name === 'of_download') {
    let base64 = dispatch.pdf_base64 || '';
    if (!base64 && dispatch.pdf_key) {
      const { getFromBucket } = await import('../utils/bucket.js');
      base64 = Buffer.from(await (await getFromBucket(dispatch.pdf_key)).Body.transformToByteArray()).toString('base64');
    }
    if (!base64) return fail(res, 'The file of this version is not available.', 404);
    return res.json({ success: true, base64, filename: dispatch.filename || 'Offer_Letter.pdf' });
  }
  if (name === 'of_mark_declined') {
    if (candidate.status !== 'offered') return fail(res, 'Only an offer that is waiting for a reply can be marked declined.');
    // the acceptance link stops working with the offer
    const { offer_accept_token, ...rest } = candidate;
    await saveCandidate({ ...rest, status: 'offer_declined', offer_status: 'declined', offer_declined_at: nowIso(), timeline: appendTimeline(candidate, { type: 'status', from: candidate.status, to: 'offer_declined', text: 'Offer declined by the candidate', by: cu.id, by_name: actor.name }) });
    await offerAudit(candidate.id, 'declined', actor, {});
    return res.json({ success: true });
  }
  if (name === 'of_matches') {
    let linked = null;
    if (candidate.employee_user_id) { const e = (await employeeDirectory()).find((x) => x.user_id === candidate.employee_user_id); linked = { user_id: candidate.employee_user_id, name: e?.display_name || '', employee_code: e?.employee_code || candidate.employee_code || '', onboarding_pending: e?.role === 'onboarding_pending' }; }
    return res.json({ success: true, linked, matches: linked ? [] : await matchesFor(candidate), can_link: actor.isHr && R.LINKABLE_STATUSES.includes(candidate.status), create_problem: linked ? '' : await onboardingProblem(candidate.id), is_hr: actor.isHr });
  }
  if (name === 'of_employees') {
    const q = clean(p.search, 60).toLowerCase();
    const list = q.length < 2 ? [] : (await employeeDirectory()).filter((e) => e.role !== 'onboarding_pending' && `${e.display_name} ${e.employee_code || ''}`.toLowerCase().includes(q)).slice(0, 10);
    return res.json({ success: true, employees: list.map((e) => ({ user_id: e.user_id, name: e.display_name, employee_code: e.employee_code || '', department: e.department || '', left: isLeaver(e) })) });
  }
  if (name === 'of_link_employee') {
    if (!actor.isHr) return fail(res, 'Only HR or admin can link a candidate to an employee', 403);
    if (candidate.employee_user_id) return fail(res, 'This candidate is already linked to an employee profile.');
    if (!R.LINKABLE_STATUSES.includes(candidate.status)) return fail(res, 'Link the candidate after the offer has been accepted.');
    const emp = (await employeeDirectory()).find((e) => e.user_id === p.user_id);
    if (!emp || emp.role === 'onboarding_pending') return fail(res, 'Employee not found', 404);
    const other = await linkedCandidate(emp.user_id, candidate.id);
    if (other || (emp.candidate_id && emp.candidate_id !== candidate.id)) return fail(res, `${emp.display_name} is already linked to another candidate record${other?.full_name ? ` (${other.full_name})` : ''}.`);
    const strong = R.matchEmployees(candidate, [emp])[0]?.strong;
    const reason = clean(p.reason, 300);
    if (!strong && reason.length < 10) return fail(res, 'The email and phone number do not match this employee. Give a reason (at least 10 characters) to link them.', 400, { needs_reason: true });
    const linked = await attach(candidate, emp.user_id, actor, 'linked');
    await markJoined(linked, actor, `Linked to employee ${emp.employee_code || emp.display_name}`);
    await offerAudit(candidate.id, 'employee_linked', actor, { employee_user_id: emp.user_id, employee_code: emp.employee_code || '', reason });
    return res.json({ success: true, employee: { user_id: emp.user_id, name: emp.display_name, employee_code: emp.employee_code || '' } });
  }
  return res.status(400).json({ error: `Unknown function ${name}` });
}
