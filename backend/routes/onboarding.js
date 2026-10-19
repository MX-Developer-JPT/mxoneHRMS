// Invite-only onboarding.
//
//   1. HR / admin INITIATES onboarding for a person (ob_initiate): enters the HR-side details — identity, contact,
//      job (department, location, shift, manager, employment type), statutory (PAN / UAN / ESI) and bank details,
//      emergency contact. That creates the login (role `onboarding_pending`, unusable password) and a pending Employee
//      record, and emails the person a one-time link.
//   2. The person opens the link, sets a password (public router below) and lands on the onboarding form where they
//      confirm HR's details and add their own: address, Aadhaar, education, previous employment, documents, nominee…
//   3. ob_submit validates everything and, in one step, turns the login into a normal employee (role `employee`), so the
//      app opens immediately. HR then verifies the uploaded documents afterwards (they stay `pending_verification`).
//
// Nobody can create their own account any more (/api/auth/register is closed): accounts exist only through (1).
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { one, all, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';
import { signToken } from './auth.js';

const INVITE_DAYS = 7;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'trainee'];
const TIERS = ['executive', 'senior_executive', 'territory_manager', 'manager', 'general_manager', 'director'];
const HR_ROLES = ['hr', 'admin'];
const nowIso = () => new Date().toISOString();
const clean = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
const appUrl = () => process.env.APP_URL || 'https://maxone.maxvoltenergy.com';
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const isPhone = (s) => { const d = digits(s); return d.length >= 10 && d.length <= 13; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s).getTime());
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const safeUrl = (u) => typeof u === 'string' && u.length < 600 && (/^https?:\/\//i.test(u) || u.startsWith('/api/upload/file/') || u.startsWith('/uploads/'));

const parseRow = (r) => { try { return { ...JSON.parse(r.data), id: JSON.parse(r.data).id || r.id }; } catch { return null; } };
async function roleOf(cu) {
  if (!cu) return null;
  const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]);
  return u ? (u.custom_role || u.role) : null;
}
const isHr = async (cu) => HR_ROLES.includes(await roleOf(cu));
const normCode = (c) => String(c || '').replace(/\s+/g, '').toUpperCase();
async function codeConflict(code, excludeEntityId) {
  const norm = normCode(code);
  if (!norm) return null;
  for (const r of await all("SELECT id, data FROM entities WHERE type='Employee' AND COALESCE(data::jsonb->>'employee_code','') <> ''")) {
    if (r.id === excludeEntityId) continue;
    const d = parseRow(r);
    if (d && normCode(d.employee_code) === norm) return d.display_name || '(no name)';
  }
  return null;
}
async function notify(userIds, { title, message, type = 'info', link = '/' }) {
  for (const uid of [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))]) {
    try {
      await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), uid, title, message, type, link]);
      const { sendPushToUser } = await import('../utils/push.js');
      sendPushToUser(uid, { title, message, type, link });
    } catch (e) { console.warn('[onboarding] notify failed:', e.message); }
  }
}
const hrUserIds = async () => (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')")).map(r => r.id);
const addMonths = (d, m) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };

// ── what the employee must provide ───────────────────────────────────────────────────────────
// (documents are collected as uploaded file URLs; `type` maps to the existing Document.document_type values)
export const DOC_SLOTS = [
  { key: 'photo',        label: 'Passport-size photo',                          type: 'other',   required: true,  note: 'Used as your profile picture' },
  { key: 'aadhar_front', label: 'Aadhaar card — front',                         type: 'aadhar',  required: true },
  { key: 'aadhar_back',  label: 'Aadhaar card — back',                          type: 'aadhar',  required: true },
  { key: 'pan',          label: 'PAN card',                                     type: 'pan',     required: true },
  { key: 'bank_proof',   label: 'Cancelled cheque / bank passbook first page',  type: 'other',   required: true },
  { key: 'address_proof',label: 'Current address proof (if different from Aadhaar)', type: 'other', required: false },
];
const EDU_LEVELS = ['10th', '12th', 'Diploma / ITI', 'Graduation', 'Post graduation', 'Other'];

// ── invites ──────────────────────────────────────────────────────────────────────────────────
async function getInvite(userId) {
  const rows = (await all("SELECT id, data FROM entities WHERE type='OnboardingInvite' AND user_id=$1", [userId])).map(parseRow).filter(Boolean);
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
async function saveEntity(type, id, doc) {
  doc.updated_at = nowIso();
  await run('UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3 AND type=$4', [JSON.stringify(doc), doc.status || null, id, type]);
}
async function issueInvite(user, emp, createdBy) {
  // one live link per person: older ones are revoked
  for (const old of (await all("SELECT id, data FROM entities WHERE type='OnboardingInvite' AND user_id=$1", [user.id])).map(parseRow).filter(Boolean)) {
    if (old.status === 'sent') { old.status = 'revoked'; await saveEntity('OnboardingInvite', old.id, old); }
  }
  const token = randomBytes(32).toString('hex');
  const id = uuidv4();
  const prev = (await getInvite(user.id));
  const doc = { id, user_id: user.id, employee_entity_id: emp.id, token_hash: sha(token), status: 'sent', created_at: nowIso(), expires_at: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(), created_by: createdBy, send_count: (prev?.send_count || 0) + 1, login_email: user.email };
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'OnboardingInvite',$2,'sent',$3)", [id, user.id, JSON.stringify(doc)]);
  const link = `${appUrl()}/onboarding-invite?token=${token}`;
  return { doc, link };
}
async function emailInvite({ user, emp, link, doc, hrName }) {
  const to = emp.personal_email || user.email;
  const tpl = emailTemplates.onboardingInviteEmail({ name: emp.display_name, link, loginEmail: user.email, hrName, designation: emp.designation, department: emp.department, dateOfJoining: emp.date_of_joining, expiryDays: INVITE_DAYS });
  try { await sendEmail({ to, ...tpl, meta: { source: 'onboarding-invite', user_id: user.id } }); return { sent: true, to }; }
  catch (e) { console.error('[onboarding] invite email failed:', e.message); return { sent: false, to, error: e.message }; }
}

// ── HR details: validation ───────────────────────────────────────────────────────────────────
function validateHrDetails(d) {
  const errs = [];
  const need = (v, label) => { if (!clean(v)) errs.push(`${label} is required`); };
  need(d.first_name, 'First name'); need(d.employee_code, 'Employee code'); need(d.father_spouse_name, "Father's name");
  need(d.department, 'Department'); need(d.designation, 'Designation'); need(d.work_location, 'Work location');
  if (!TIERS.includes(d.designation_tier)) errs.push('Designation tier is required');
  if (!EMPLOYMENT_TYPES.includes(d.employment_type)) errs.push('Employment type is required (intern, trainee, contractual, part time or full time)');
  if (!isEmail(d.personal_email)) errs.push('A valid personal email is required (the onboarding link is sent there)');
  if (clean(d.official_email) && !isEmail(d.official_email)) errs.push('Official email is not valid');
  if (!isPhone(d.phone)) errs.push('A valid personal mobile number is required');
  if (clean(d.official_phone) && !isPhone(d.official_phone)) errs.push('Official number is not valid');
  if (!isDate(d.date_of_birth)) errs.push('Date of birth is required');
  else if (new Date(d.date_of_birth) > new Date(Date.now() - 14 * 365.25 * 86400000)) errs.push('Date of birth looks wrong (under 14 years)');
  if (!isDate(d.date_of_joining)) errs.push('Date of joining is required');
  if (!d.no_reporting_manager && !clean(d.reporting_manager_id)) errs.push('Reporting manager is required (tick "No reporting manager" for top management)');
  if (!clean(d.shift_id)) errs.push('Shift is required');
  const ec = d.emergency_contact || {};
  if (!clean(ec.name) || !clean(ec.relationship) || !isPhone(ec.phone)) errs.push('Emergency contact needs a name, relationship and a valid phone number');
  if (clean(d.pan_number) && !PAN_RE.test(clean(d.pan_number).toUpperCase())) errs.push('PAN must look like ABCDE1234F');
  if (clean(d.uan_number) && digits(d.uan_number).length !== 12) errs.push('UAN must be 12 digits');
  if (d.is_esi_applicable && clean(d.esi_number) && !/^\d{10,17}$/.test(digits(d.esi_number))) errs.push('ESI number must be 10–17 digits');
  const b = d.bank_account || {};
  const anyBank = clean(b.account_number) || clean(b.ifsc_code) || clean(b.bank_name);
  if (anyBank) {
    if (!/^\d{6,20}$/.test(digits(b.account_number))) errs.push('Bank account number must be 6–20 digits');
    if (!IFSC_RE.test(clean(b.ifsc_code).toUpperCase())) errs.push('IFSC code is not valid (e.g. HDFC0001234)');
    if (!clean(b.bank_name)) errs.push('Bank name is required with the account number');
  }
  return errs;
}
const buildEmployee = (d, extra = {}) => {
  const fullName = [d.first_name, d.middle_name, d.last_name].map(x => clean(x, 60)).filter(Boolean).join(' ');
  const empType = d.employment_type;
  const status = empType === 'trainee' ? 'trainee' : 'probation';
  const b = d.bank_account || {};
  const bank = clean(b.account_number) ? { account_number: digits(b.account_number), ifsc_code: clean(b.ifsc_code).toUpperCase(), bank_name: clean(b.bank_name, 80), branch: clean(b.branch, 80), account_holder_name: clean(b.account_holder_name, 80) || fullName } : null;
  return {
    display_name: fullName, first_name: clean(d.first_name, 60), middle_name: clean(d.middle_name, 60), last_name: clean(d.last_name, 60),
    employee_code: clean(d.employee_code, 40), biometric_id: clean(d.biometric_id, 40) || undefined,
    department: clean(d.department, 80), designation: clean(d.designation, 100), designation_tier: d.designation_tier,
    employment_type: empType, employee_status: status,
    date_of_joining: d.date_of_joining, employee_confirmation_date: status === 'trainee' ? null : (isDate(d.employee_confirmation_date) ? d.employee_confirmation_date : addMonths(d.date_of_joining, 6)),
    work_location: clean(d.work_location, 100), shift_id: clean(d.shift_id) || null,
    reporting_manager_id: d.no_reporting_manager ? null : (clean(d.reporting_manager_id) || null),
    overtime_eligible: !!d.overtime_eligible, wfh_eligible: !!d.wfh_eligible,
    phone: clean(d.phone, 20), official_phone: clean(d.official_phone, 20) || undefined,
    personal_email: clean(d.personal_email, 120).toLowerCase(), official_email: clean(d.official_email, 120).toLowerCase() || undefined,
    date_of_birth: d.date_of_birth, gender: clean(d.gender, 20) || undefined, father_spouse_name: clean(d.father_spouse_name, 100),
    emergency_contact: { name: clean(d.emergency_contact?.name, 100), relationship: clean(d.emergency_contact?.relationship, 50), phone: clean(d.emergency_contact?.phone, 20), address: clean(d.emergency_contact?.address, 300) },
    pan_number: clean(d.pan_number).toUpperCase() || undefined, uan_number: digits(d.uan_number) || undefined, pf_account_number: clean(d.pf_account_number, 40) || undefined,
    pf_applicable: d.pf_applicable !== false, is_esi_applicable: !!d.is_esi_applicable, esi_number: d.is_esi_applicable ? (digits(d.esi_number) || undefined) : undefined,
    aadhar_number: digits(d.aadhar_number) || undefined,
    bank_account: bank || undefined,
    hr_notes: clean(d.hr_notes, 1000) || undefined,
    ...extra,
  };
};

// What the employee's own copy of the record contains (it is their own data, but never HR-only notes).
const forEmployee = (e) => { const { hr_notes, ...rest } = e; void hr_notes; return rest; };

// ── status of one onboarding for the HR tracker ──────────────────────────────────────────────
function stageOf(emp, invite, role) {
  if (emp.onboarding_submitted && role !== 'onboarding_pending') return 'completed';
  if (invite?.status === 'accepted' || emp.onboarding_stage === 'in_progress') return 'in_progress';
  if (invite?.status === 'sent' && Date.parse(invite.expires_at) < Date.now()) return 'expired';
  if (invite?.status === 'revoked') return 'revoked';
  return 'invited';
}

const HANDLERS = {
  // ── HR: start onboarding for a new person ──
  async ob_initiate(p, cu, res) {
    if (!(await isHr(cu))) return res.status(403).json({ success: false, error: 'Only HR or admin can start onboarding' });
    const d = p.details || p;
    const errs = validateHrDetails(d);
    if (errs.length) return res.json({ success: false, error: errs[0], errors: errs });
    const personal = clean(d.personal_email).toLowerCase();
    const official = clean(d.official_email).toLowerCase();
    const loginEmail = (d.login_with === 'personal' || !official) ? personal : official;
    const conflict = await codeConflict(d.employee_code);
    if (conflict) return res.json({ success: false, error: `Employee code "${d.employee_code}" already belongs to ${conflict}` });

    // a person who self-registered before sign-ups were closed can be adopted instead of blocked
    let user = await one('SELECT * FROM users WHERE LOWER(email)=$1', [loginEmail]);
    if (user) {
      const hasHr = await one("SELECT id FROM entities WHERE type='Employee' AND user_id=$1 AND data::jsonb->>'hr_initiated'='true'", [user.id]);
      if ((user.custom_role || user.role) !== 'onboarding_pending' || hasHr) return res.json({ success: false, error: `${loginEmail} already has an account. Use a different email, or cancel the earlier onboarding first.` });
    }
    const fullName = [d.first_name, d.middle_name, d.last_name].map(x => clean(x, 60)).filter(Boolean).join(' ');
    if (!user) {
      const id = uuidv4();
      await run(
        `INSERT INTO users (id, email, password, full_name, first_name, middle_name, last_name, role, display_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'onboarding_pending',$8)`,
        [id, loginEmail, bcrypt.hashSync(randomBytes(24).toString('hex'), 10), fullName, clean(d.first_name, 60), clean(d.middle_name, 60) || null, clean(d.last_name, 60) || null, fullName]
      );
      user = await one('SELECT * FROM users WHERE id=$1', [id]);
    } else {
      await run("UPDATE users SET password=$1, full_name=$2, first_name=$3, middle_name=$4, last_name=$5, display_name=$2, updated_at=NOW()::TEXT WHERE id=$6",
        [bcrypt.hashSync(randomBytes(24).toString('hex'), 10), fullName, clean(d.first_name, 60), clean(d.middle_name, 60) || null, clean(d.last_name, 60) || null, user.id]);
    }

    const existingEmp = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [user.id]);
    const base = buildEmployee(d, { hr_initiated: true, onboarding_stage: 'invited', onboarding_submitted: false, onboarding_invited_at: nowIso(), onboarding_initiated_by: cu.id, employee_status: undefined });
    const data = { ...base, employee_status: buildEmployee(d).employee_status, status: 'pending', onboarding_rejected: false, onboarding_rejection_reason: null };
    let empId;
    if (existingEmp) { empId = existingEmp.id; await run("UPDATE entities SET data=$1, status='pending', updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ ...JSON.parse(existingEmp.data), ...data, id: empId, user_id: user.id }), empId]); }
    else { empId = uuidv4(); await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'pending',$3)", [empId, user.id, JSON.stringify({ id: empId, user_id: user.id, ...data })]); }
    const emp = { id: empId, ...data };

    const hrName = (await one('SELECT full_name FROM users WHERE id=$1', [cu.id]))?.full_name || 'HR';
    const { doc, link } = await issueInvite(user, emp, cu.id);
    const mail = await emailInvite({ user, emp, link, doc, hrName });
    return res.json({ success: true, user_id: user.id, login_email: user.email, invite_link: link, email_sent: mail.sent, sent_to: mail.to, email_error: mail.error, expires_at: doc.expires_at });
  },

  async ob_resendInvite(p, cu, res) {
    if (!(await isHr(cu))) return res.status(403).json({ success: false, error: 'Only HR or admin can do this' });
    const user = await one('SELECT * FROM users WHERE id=$1', [p.user_id]);
    const erow = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [p.user_id]);
    if (!user || !erow) return res.json({ success: false, error: 'Onboarding not found' });
    if ((user.custom_role || user.role) !== 'onboarding_pending') return res.json({ success: false, error: 'This person has already completed onboarding' });
    const emp = parseRow(erow);
    const hrName = (await one('SELECT full_name FROM users WHERE id=$1', [cu.id]))?.full_name || 'HR';
    const { doc, link } = await issueInvite(user, emp, cu.id);
    const mail = await emailInvite({ user, emp, link, doc, hrName });
    return res.json({ success: true, invite_link: link, email_sent: mail.sent, sent_to: mail.to, email_error: mail.error, expires_at: doc.expires_at });
  },

  // Remove an onboarding that was started by mistake (nothing submitted yet) so the code / emails can be reused.
  async ob_cancel(p, cu, res) {
    if (!(await isHr(cu))) return res.status(403).json({ success: false, error: 'Only HR or admin can do this' });
    const user = await one('SELECT * FROM users WHERE id=$1', [p.user_id]);
    if (!user) return res.json({ success: false, error: 'Not found' });
    if ((user.custom_role || user.role) !== 'onboarding_pending') return res.json({ success: false, error: 'Only an onboarding that has not been completed can be cancelled' });
    const erow = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [p.user_id]);
    const emp = erow ? parseRow(erow) : null;
    if (emp?.onboarding_submitted) return res.json({ success: false, error: 'The employee has already submitted — it cannot be cancelled' });
    if (clean(p.reason).length < 3) return res.json({ success: false, error: 'Please give a reason' });
    await run("DELETE FROM entities WHERE user_id=$1 AND type IN ('OnboardingInvite','Employee','Document','AppTourProgress')", [p.user_id]);
    await run('DELETE FROM users WHERE id=$1', [p.user_id]);
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'OnboardingLog',NULL,'cancelled',$2)", [uuidv4(), JSON.stringify({ action: 'cancelled', name: emp?.display_name, employee_code: emp?.employee_code, login_email: user.email, reason: clean(p.reason, 300), by: cu.id, at: nowIso() })]);
    return res.json({ success: true });
  },

  async ob_getTracker(p, cu, res) {
    if (!(await isHr(cu))) return res.status(403).json({ success: false, error: 'Only HR or admin can see this' });
    const emps = (await all("SELECT id, user_id, data FROM entities WHERE type='Employee' AND data::jsonb->>'hr_initiated'='true'")).map(parseRow).filter(Boolean);
    const users = Object.fromEntries((await all('SELECT id, email, role, custom_role FROM users')).map(u => [u.id, u]));
    const docs = (await all("SELECT data FROM entities WHERE type='Document'")).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    const invites = (await all("SELECT data FROM entities WHERE type='OnboardingInvite'")).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    const rows = emps.map(e => {
      const u = users[e.user_id];
      const role = u ? (u.custom_role || u.role) : null;
      const inv = invites.filter(i => i.user_id === e.user_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      const mine = docs.filter(d => d.user_id === e.user_id);
      const stage = stageOf(e, inv, role);
      return {
        user_id: e.user_id, name: e.display_name, employee_code: e.employee_code, department: e.department, designation: e.designation, employment_type: e.employment_type,
        date_of_joining: e.date_of_joining, work_location: e.work_location, login_email: u?.email, personal_email: e.personal_email, phone: e.phone,
        stage, invited_at: e.onboarding_invited_at, accepted_at: inv?.accepted_at || null, submitted_at: e.onboarding_submitted_at || null, expires_at: inv?.expires_at || null,
        send_count: inv?.send_count || 0, correction_note: e.onboarding_correction_note || '',
        docs: { total: mine.length, pending: mine.filter(d => d.status === 'pending_verification').length, verified: mine.filter(d => d.status === 'verified').length, rejected: mine.filter(d => d.status === 'rejected').length },
        draft_saved_at: e.onboarding_draft_saved_at || null,
      };
    });
    const order = { expired: 0, invited: 1, in_progress: 2, completed: 3, revoked: 4 };
    rows.sort((a, b) => (order[a.stage] - order[b.stage]) || String(b.invited_at).localeCompare(String(a.invited_at)));
    return res.json({ success: true, rows, counts: rows.reduce((m, r) => { m[r.stage] = (m[r.stage] || 0) + 1; return m; }, {}) });
  },

  // ── the new joiner ──
  async ob_getMy(p, cu, res) {
    if (!cu) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const erow = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [cu.id]);
    const emp = erow ? parseRow(erow) : null;
    const role = await roleOf(cu);
    if (!emp || !emp.hr_initiated) return res.json({ success: true, hr_initiated: false, role });
    const mgr = emp.reporting_manager_id ? await one('SELECT full_name FROM users WHERE id=$1', [emp.reporting_manager_id]) : null;
    const shift = emp.shift_id ? await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id]) : null;
    const s = shift ? JSON.parse(shift.data) : null;
    return res.json({
      success: true, hr_initiated: true, role, submitted: !!emp.onboarding_submitted, rejection_reason: emp.onboarding_rejection_reason || null,
      employee: { ...forEmployee(emp), reporting_manager_name: mgr?.full_name || '', shift_name: s ? `${s.name} (${s.start_time} – ${s.end_time})` : '' },
      draft: emp.onboarding_draft || null, doc_slots: DOC_SLOTS, education_levels: EDU_LEVELS,
    });
  },

  async ob_saveDraft(p, cu, res) {
    if (!cu) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const erow = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [cu.id]);
    const emp = erow ? parseRow(erow) : null;
    if (!emp?.hr_initiated || emp.onboarding_submitted) return res.json({ success: false, error: 'Nothing to save' });
    if ((await roleOf(cu)) !== 'onboarding_pending') return res.json({ success: false, error: 'Onboarding is already complete' });
    const draft = JSON.stringify(p.draft || {});
    if (draft.length > 400000) return res.json({ success: false, error: 'Draft too large' });
    emp.onboarding_draft = p.draft || {}; emp.onboarding_draft_saved_at = nowIso();
    await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(emp), erow.id]);
    return res.json({ success: true, saved_at: emp.onboarding_draft_saved_at });
  },

  // Final submission: validates, stores the person's details + documents, and activates the account.
  async ob_submit(p, cu, res) {
    if (!cu) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const erow = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [cu.id]);
    const emp = erow ? parseRow(erow) : null;
    if (!emp?.hr_initiated) return res.json({ success: false, error: 'No onboarding has been started for you. Please contact HR.' });
    if ((await roleOf(cu)) !== 'onboarding_pending' || emp.onboarding_submitted) return res.json({ success: false, error: 'Your onboarding is already complete.' });
    const f = p.form || {};
    const errs = [];
    const need = (ok, msg) => { if (!ok) errs.push(msg); };

    need(clean(f.gender), 'Gender is required');
    need(clean(f.blood_group), 'Blood group is required');
    need(clean(f.current_address, 500).length >= 8, 'Current address is required');
    const sameAddr = !!f.permanent_same_as_current;
    need(sameAddr || clean(f.permanent_address, 500).length >= 8, 'Permanent address is required');
    need(digits(f.aadhar_number).length === 12, 'Aadhaar number must be 12 digits');
    const pan = (emp.pan_number || clean(f.pan_number)).toUpperCase();
    need(PAN_RE.test(pan), 'PAN must look like ABCDE1234F');
    // bank: HR may have entered it; otherwise the employee must
    let bank = emp.bank_account;
    if (!bank?.account_number) {
      const b = f.bank_account || {};
      need(/^\d{6,20}$/.test(digits(b.account_number)), 'Bank account number is required (6–20 digits)');
      need(IFSC_RE.test(clean(b.ifsc_code).toUpperCase()), 'A valid IFSC code is required');
      need(!!clean(b.bank_name), 'Bank name is required');
      bank = { account_number: digits(b.account_number), ifsc_code: clean(b.ifsc_code).toUpperCase(), bank_name: clean(b.bank_name, 80), branch: clean(b.branch, 80), account_holder_name: clean(b.account_holder_name, 80) || emp.display_name };
    }
    const uan = emp.uan_number || digits(f.uan_number) || undefined;
    if (uan) need(uan.length === 12, 'UAN must be 12 digits');
    const esiNo = emp.esi_number || digits(f.esi_number) || undefined;
    if (emp.is_esi_applicable) need(!!esiNo, 'ESI number is required (ESI applies to you)');

    const urls = f.documents || {};
    for (const slot of DOC_SLOTS) {
      const u = urls[slot.key];
      if (slot.required) need(safeUrl(u), `${slot.label} is required`);
      else if (u) need(safeUrl(u), `${slot.label}: invalid file`);
    }
    const edu = (Array.isArray(f.education) ? f.education : []).filter(r => clean(r.level) || clean(r.institution));
    need(edu.length >= 1, 'Add at least one education record with its certificate');
    edu.forEach((r, i) => {
      need(clean(r.level) && clean(r.institution) && /^\d{4}$/.test(clean(r.year)), `Education ${i + 1}: level, institution and passing year are required`);
      need(safeUrl(r.certificate_url), `Education ${i + 1}: upload the certificate / marksheet`);
    });
    const fresher = !!f.is_fresher;
    const prev = fresher ? [] : (Array.isArray(f.previous_employment) ? f.previous_employment : []).filter(r => clean(r.company));
    if (!fresher) {
      need(prev.length >= 1, 'Add your previous employment, or tick "I am a fresher"');
      prev.forEach((r, i) => {
        need(clean(r.company) && clean(r.designation) && isDate(r.from) && isDate(r.to), `Previous employment ${i + 1}: company, designation and dates are required`);
        if (isDate(r.from) && isDate(r.to)) need(r.to >= r.from, `Previous employment ${i + 1}: the end date is before the start date`);
        for (const k of ['experience_letter_url', 'relieving_letter_url', 'payslips_url']) if (r[k]) need(safeUrl(r[k]), `Previous employment ${i + 1}: invalid file`);
      });
    }
    need(!!f.declaration, 'Please accept the declaration');
    need(clean(f.signature_name).length >= 3, 'Type your full name as your signature');
    if (errs.length) return res.json({ success: false, error: errs[0], errors: errs });

    // ── write everything ──
    const nominee = f.pf_nominee && clean(f.pf_nominee.name) ? { name: clean(f.pf_nominee.name, 100), relationship: clean(f.pf_nominee.relationship, 50), date_of_birth: f.pf_nominee.date_of_birth || '', share_percentage: Number(f.pf_nominee.share_percentage) || 100 } : undefined;
    const policies = (Array.isArray(f.insurance_policies) ? f.insurance_policies : []).filter(x => clean(x.insurance_type) && clean(x.insurer_name)).map(x => ({ insurance_type: clean(x.insurance_type, 60), insurer_name: clean(x.insurer_name, 100), policy_number: clean(x.policy_number, 60), sum_insured: clean(x.sum_insured, 30), validity_date: clean(x.validity_date, 20), nominee_name: clean(x.nominee_name, 100), nominee_relationship: clean(x.nominee_relationship, 50), nominee_date_of_birth: clean(x.nominee_date_of_birth, 20), card_url: safeUrl(x.card_url) ? x.card_url : undefined }));
    const updated = {
      ...emp,
      gender: clean(f.gender, 20), blood_group: clean(f.blood_group, 10), marital_status: clean(f.marital_status, 20) || undefined,
      address: clean(f.current_address, 500), current_address: clean(f.current_address, 500), permanent_address: sameAddr ? clean(f.current_address, 500) : clean(f.permanent_address, 500),
      aadhar_number: digits(f.aadhar_number), pan_number: pan, uan_number: uan, esi_number: esiNo, bank_account: bank,
      pf_account_number: emp.pf_account_number || clean(f.pf_account_number, 40) || undefined, pf_nominee: nominee,
      insurance_policies: policies.length ? policies : undefined,
      profile_picture_url: urls.photo,
      education: edu.map(r => ({ level: clean(r.level, 40), institution: clean(r.institution, 150), board_university: clean(r.board_university, 150), year: clean(r.year, 4), percentage: clean(r.percentage, 10), certificate_url: r.certificate_url })),
      is_fresher: fresher,
      previous_employment: prev.map(r => ({ company: clean(r.company, 150), designation: clean(r.designation, 100), from: r.from, to: r.to, last_salary: clean(r.last_salary, 30), reason_for_leaving: clean(r.reason_for_leaving, 200), location: clean(r.location, 100), experience_letter_url: r.experience_letter_url, relieving_letter_url: r.relieving_letter_url, payslips_url: r.payslips_url })),
      onboarding_correction_note: clean(f.correction_note, 800) || undefined,
      declaration_accepted_at: nowIso(), declaration_signature: clean(f.signature_name, 100),
      onboarding_submitted: true, onboarding_submitted_at: nowIso(), onboarding_stage: 'completed', onboarding_rejection_reason: null, onboarding_rejected: false,
      onboarding_draft: undefined, status: 'active',
    };
    await run("UPDATE entities SET data=$1, status='active', updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(updated), erow.id]);

    // Documents → HR verifies them afterwards (the account is already open)
    const mkDoc = async (type, name, url, extra = {}) => {
      const exists = await one("SELECT id FROM entities WHERE type='Document' AND user_id=$1 AND data::jsonb->>'document_url'=$2", [cu.id, url]);
      if (exists) return;
      const id = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Document',$2,'pending_verification',$3)", [id, cu.id, JSON.stringify({ id, user_id: cu.id, document_type: type, document_name: name, document_url: url, uploaded_by: cu.id, status: 'pending_verification', created_at: nowIso(), ...extra })]);
    };
    for (const slot of DOC_SLOTS) if (urls[slot.key] && slot.key !== 'photo') await mkDoc(slot.type, slot.label, urls[slot.key]);
    if (urls.photo) await mkDoc('other', 'Passport-size photo', urls.photo);
    for (const r of updated.education) await mkDoc('educational', `${r.level} — ${r.institution}`, r.certificate_url);
    for (const r of updated.previous_employment) {
      if (r.experience_letter_url) await mkDoc('experience_letter', `Experience letter — ${r.company}`, r.experience_letter_url);
      if (r.relieving_letter_url) await mkDoc('experience_letter', `Relieving letter — ${r.company}`, r.relieving_letter_url);
      if (r.payslips_url) await mkDoc('other', `Payslips — ${r.company}`, r.payslips_url);
    }
    for (const pol of policies) if (pol.card_url) await mkDoc('other', `${pol.insurance_type} policy card`, pol.card_url);

    // Activate: the login becomes a normal employee
    await run("UPDATE users SET role='employee', custom_role='employee', updated_at=NOW()::TEXT WHERE id=$1", [cu.id]);
    const user = await one('SELECT * FROM users WHERE id=$1', [cu.id]);

    // A reporting manager must be able to reach the approval screens for their new team member.
    if (updated.reporting_manager_id) {
      try {
        const m = await one('SELECT role, custom_role FROM users WHERE id=$1', [updated.reporting_manager_id]);
        if (m && !['admin', 'hr', 'manager', 'management'].includes(m.custom_role || m.role)) await run("UPDATE users SET role='management', custom_role='management', updated_at=NOW()::TEXT WHERE id=$1", [updated.reporting_manager_id]);
      } catch (e) { console.warn('[onboarding] manager promote failed:', e.message); }
    }
    try { const { startForUser } = await import('./ld.js'); await startForUser(cu.id); } catch (e) { console.warn('[onboarding] L&D start failed:', e.message); }
    try {
      const empName = updated.display_name;
      const annId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Announcement',$2,'active',$3)", [annId, cu.id, JSON.stringify({ id: annId, title: `Welcome ${empName}!`, content: `Please join us in welcoming ${empName} to the ${updated.department || 'team'} as ${updated.designation || 'a new team member'}. We look forward to working with you!`, category: 'new_joiner', status: 'published', target_audience: 'all', display_name: empName, department: updated.department, designation: updated.designation, date_of_joining: updated.date_of_joining, profile_picture_url: updated.profile_picture_url || null, created_date: nowIso() })]);
      const audience = await all("SELECT user_id FROM entities WHERE type='Employee' AND status='active' AND user_id != $1", [cu.id]);
      await notify(audience.map(r => r.user_id), { title: `Welcome ${empName}!`, message: `Please join us in welcoming ${empName} to the team as ${updated.designation || 'a new team member'}.`, link: '/AnnouncementManagement' });
    } catch (e) { console.warn('[onboarding] announcement failed:', e.message); }
    await notify(await hrUserIds(), { title: 'Onboarding submitted', message: `${updated.display_name} (${updated.employee_code}) has completed onboarding and now has app access. Please verify their documents.${updated.onboarding_correction_note ? ' They reported a correction to HR details.' : ''}`, type: 'success', link: '/OnboardingHR' });
    if (updated.reporting_manager_id) await notify(updated.reporting_manager_id, { title: 'New team member onboarded', message: `${updated.display_name} has joined your team.`, link: '/MyTeam' });
    try { const tpl = emailTemplates.onboardingApprovedEmail({ name: updated.display_name, role: 'employee', department: updated.department }); sendEmail({ to: user.email, ...tpl }).catch(() => {}); } catch { /* optional */ }
    return res.json({ success: true, access_token: signToken(user) });
  },

  // HR flags a document the employee must replace (the account stays active)
  async ob_rejectDocument(p, cu, res) {
    if (!(await isHr(cu))) return res.status(403).json({ success: false, error: 'Only HR or admin can do this' });
    const row = await one("SELECT id, data FROM entities WHERE type='Document' AND id=$1", [p.document_id]);
    if (!row) return res.json({ success: false, error: 'Document not found' });
    const d = parseRow(row);
    d.status = 'rejected'; d.notes = clean(p.reason, 300); d.rejected_by = cu.id;
    await run("UPDATE entities SET data=$1, status='rejected', updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(d), row.id]);
    await notify(d.user_id, { title: 'Document needs to be re-uploaded', message: `${d.document_name}: ${d.notes || 'please upload a clearer copy'}`, type: 'warning', link: '/Documents' });
    return res.json({ success: true });
  },
};

export async function handleOnboarding(name, p, cu, res) {
  if (!cu) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const fn = HANDLERS[name];
  if (!fn) return res.status(404).json({ success: false, error: `Unknown onboarding function: ${name}` });
  try { return await fn(p || {}, cu, res); }
  catch (e) { console.error('[onboarding]', name, e); return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' }); }
}

// ── public router: open the emailed link and set a password ──────────────────────────────────
export const inviteRouter = Router();
async function findByToken(token) {
  const hash = sha(token || '');
  const rows = await all("SELECT id, data FROM entities WHERE type='OnboardingInvite' AND data::jsonb->>'token_hash'=$1", [hash]);
  return rows.map(parseRow).filter(Boolean)[0] || null;
}
const dead = (inv) => !inv ? 'This link is not valid. Please ask HR to send you a new one.'
  : inv.status === 'revoked' ? 'This link has been replaced by a newer one. Please use the latest email from HR, or ask HR to resend it.'
  : inv.status === 'accepted' ? 'This link was already used. Please sign in with the password you set.'
  : Date.parse(inv.expires_at) < Date.now() ? 'This link has expired. Please ask HR to send you a new one.' : null;

inviteRouter.get('/:token', async (req, res) => {
  const inv = await findByToken(req.params.token);
  const why = dead(inv);
  if (why) return res.status(410).json({ error: why, already_used: inv?.status === 'accepted' });
  const u = await one('SELECT full_name, email FROM users WHERE id=$1', [inv.user_id]);
  const emp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [inv.user_id]);
  const e = emp ? JSON.parse(emp.data) : {};
  res.json({ name: u?.full_name || '', login_email: u?.email || '', designation: e.designation || '', department: e.department || '', date_of_joining: e.date_of_joining || '', expires_at: inv.expires_at });
});

inviteRouter.post('/:token/accept', async (req, res) => {
  const inv = await findByToken(req.params.token);
  const why = dead(inv);
  if (why) return res.status(410).json({ error: why });
  const pwd = String(req.body?.password || '');
  if (pwd.length < 8 || !/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return res.status(400).json({ error: 'Password must be at least 8 characters and include a letter and a number' });
  const user = await one('SELECT * FROM users WHERE id=$1', [inv.user_id]);
  if (!user) return res.status(410).json({ error: 'This onboarding was cancelled. Please contact HR.' });
  await run('UPDATE users SET password=$1, must_change_password=FALSE, updated_at=NOW()::TEXT WHERE id=$2', [bcrypt.hashSync(pwd, 10), user.id]);
  inv.status = 'accepted'; inv.accepted_at = nowIso();
  await saveEntity('OnboardingInvite', inv.id, inv);
  const erow = await one("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1", [user.id]);
  if (erow) { const e = JSON.parse(erow.data); e.onboarding_stage = 'in_progress'; await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(e), erow.id]); }
  await notify(await hrUserIds(), { title: 'Onboarding link opened', message: `${user.full_name} has set a password and started onboarding.`, link: '/OnboardingHR' });
  res.json({ access_token: signToken(user), user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, custom_role: user.custom_role } });
});
