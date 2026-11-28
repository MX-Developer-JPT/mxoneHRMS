// Offer letters (pure): the fields one offer needs, what is mandatory, where the offer came from, how a recruitment record
// pre-fills the form, and how a candidate is matched to an employee who already exists.
import { requisitionOf } from './hiringLifecycle.js';

export const OFFER_EMPLOYMENT_TYPES = ['Permanent', 'Probationary', 'Contractual', 'Intern', 'Trainee', 'Part time', 'Consultant'];
const ONBOARDING_TYPE = { permanent: 'full_time', probationary: 'full_time', 'full time': 'full_time', full_time: 'full_time', contractual: 'contract', contract: 'contract', 'fixed term contract': 'contract', consultant: 'contract', intern: 'intern', internship: 'intern', trainee: 'trainee', 'part time': 'part_time', part_time: 'part_time' };
const FROM_ANY = { full_time: 'Permanent', 'full time': 'Permanent', contract: 'Contractual', 'fixed term contract': 'Contractual', internship: 'Intern', intern: 'Intern', trainee: 'Trainee', part_time: 'Part time' };
export const onboardingType = (v) => ONBOARDING_TYPE[String(v || '').trim().toLowerCase()] || 'full_time';
export const offerType = (v) => { const s = String(v || '').trim(); const k = s.toLowerCase(); return OFFER_EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === k) || FROM_ANY[k] || ''; };

export const NO_MANAGER = 'none';
export const MAX_ATTACHMENTS = 5;
export const VALID_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[\d\s-]{10,15}$/;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const clean = (v, n = 160) => String(v ?? '').trim().slice(0, n);
const digits = (v) => String(v || '').replace(/\D/g, '');

/** 'direct' (made without recruitment), 'mrf' (against a manpower requisition) or 'recruitment' (older record without one). */
export const offerSource = (c) => (requisitionOf(c) ? 'mrf' : (c?.offer_source === 'direct' || c?.source === 'direct_offer') ? 'direct' : 'recruitment');
export const SOURCE_LABEL = { direct: 'Direct', mrf: 'MRF', recruitment: 'Recruitment' };

/** The attachment list of an offer: only files uploaded to this app. */
export const cleanAttachments = (list) => (Array.isArray(list) ? list : []).map((a) => ({ url: clean(a?.url, 600), name: clean(a?.name, 120) || 'Attachment' }))
  .filter((a) => /\/api\/upload\/file\/[0-9a-f-]{36}(\.[A-Za-z0-9]{1,8})?$/.test(a.url)).slice(0, MAX_ATTACHMENTS);

const TEXT_FIELDS = { full_name: 100, email: 160, phone: 20, current_address: 400, department: 100, designation: 120, employment_type: 40, location: 160, reporting_manager_id: 60, reporting_to: 120, joining_date: 10, issue_date: 10, working_schedule: 200, benefits: 2000, variable_pay: 600, other_terms: 3000, special_clauses: 3000, notes: 1000, signatory_id: 60, recipient_email: 160 };
const NUMBER_FIELDS = ['annual_ctc', 'probation_months', 'notice_period_days', 'offer_valid_days', 'medical_contribution'];

/** Only the offer fields from a request, trimmed; absent fields stay absent. */
export function cleanOffer(p = {}) {
  const out = {};
  for (const [k, n] of Object.entries(TEXT_FIELDS)) if (p[k] !== undefined && p[k] !== null) out[k] = clean(p[k], n);
  for (const k of NUMBER_FIELDS) if (p[k] !== undefined && p[k] !== null && p[k] !== '') out[k] = Number(p[k]);
  if (p.salary_overrides && typeof p.salary_overrides === 'object') out.salary_overrides = p.salary_overrides;
  if (p.attachments !== undefined) out.attachments = cleanAttachments(p.attachments);
  return out;
}

/**
 * What stops an offer from being generated. `masters` = { departments: [names], offices: [names], managerIds: [ids] };
 * an empty master list is not checked (nothing to pick from yet). `today` is YYYY-MM-DD (IST).
 */
export function offerProblems(o = {}, masters = {}, today = '') {
  const e = [];
  const need = (v, label) => { if (!clean(v)) e.push(`${label} is required`); };
  need(o.full_name, 'Candidate’s full name');
  if (!VALID_EMAIL.test(clean(o.email))) e.push('A valid personal email address is required');
  if (!PHONE.test(clean(o.phone))) e.push('A valid contact number is required');
  need(o.department, 'Department'); need(o.designation, 'Designation'); need(o.employment_type, 'Employment type'); need(o.location, 'Office / location');
  const listed = (list, v) => !list?.length || list.includes(v);
  if (clean(o.department) && !listed(masters.departments, o.department)) e.push(`"${o.department}" is not an active department — choose one from the list`);
  if (clean(o.location) && !listed(masters.offices, o.location)) e.push(`"${o.location}" is not a company office — choose one from the list`);
  if (clean(o.employment_type) && !offerType(o.employment_type)) e.push('Choose the employment type from the list');
  if (!clean(o.reporting_manager_id)) e.push('Reporting manager is required (or choose "No reporting manager")');
  else if (o.reporting_manager_id !== NO_MANAGER && masters.managerIds?.length && !masters.managerIds.includes(o.reporting_manager_id)) e.push('The reporting manager is not an active employee');
  if (!isDate(o.joining_date)) e.push('Date of joining is required');
  if (o.issue_date && !isDate(o.issue_date)) e.push('The offer issue date is not valid');
  const issue = isDate(o.issue_date) ? o.issue_date : today;
  if (isDate(o.joining_date) && issue && o.joining_date < issue) e.push('Date of joining cannot be before the offer issue date');
  if (!(Number(o.annual_ctc) > 0)) e.push('Annual CTC is required');
  for (const [k, label] of [['probation_months', 'Probation period'], ['notice_period_days', 'Notice period']]) if (o[k] !== undefined && !(Number(o[k]) >= 0 && Number(o[k]) <= 365)) e.push(`${label} is not valid`);
  if (o.offer_valid_days !== undefined && !(Number(o.offer_valid_days) >= 1 && Number(o.offer_valid_days) <= 180)) e.push('Offer validity must be between 1 and 180 days');
  else if (issue && today && addDays(issue, Number(o.offer_valid_days) || 7) < today) e.push('With this issue date the offer would already have expired');
  return e;
}

export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * The offer form for a candidate: what HR saved last, else what the candidate record and its requisition already hold.
 * `offices` are the company office names, used to recognise a location.
 */
export function offerPrefill(c = {}, mrf = null, { offices = [], today = '' } = {}) {
  const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== '') ?? '';
  const office = (...v) => { for (const x of v) { const hit = offices.find((o) => o.toLowerCase() === String(x || '').trim().toLowerCase()); if (hit) return hit; } return offices.length ? '' : String(pick(...v)); };
  const draft = c.offer_draft || {};
  const annualFromMrf = mrf?.ctc_max != null ? Number(mrf.ctc_max) * (mrf.ctc_frequency === 'monthly' ? 12 : 1) : '';
  const base = {
    full_name: pick(c.full_name, c.name), email: pick(c.email), phone: pick(c.phone, c.mobile),
    current_address: pick(c.current_address, c.consent_address, c.address),
    department: pick(c.department, mrf?.department), designation: pick(c.designation, c.position_applied, mrf?.designation),
    employment_type: offerType(pick(c.employment_type, mrf?.employment_type)) || 'Permanent',
    location: office(c.location, mrf?.work_location, c.work_location),
    reporting_manager_id: pick(c.reporting_manager_id, mrf?.reports_to_user_id, mrf?.hiring_manager_id),
    reporting_to: pick(c.reporting_to),
    joining_date: pick(c.joining_date, c.expected_doj, today && addDays(today, 14)),
    issue_date: today,
    probation_months: pick(c.probation_months, 6), notice_period_days: pick(c.offer_notice_period_days, 30), offer_valid_days: 7,
    annual_ctc: pick(c.offer_ctc_annual, c.offered_ctc, c.expected_ctc),
    medical_contribution: c.salary?.medical_monthly || 0,
    salary_overrides: null, working_schedule: '', benefits: '', variable_pay: '', other_terms: '', special_clauses: '', notes: '', signatory_id: '', recipient_email: '', attachments: [],
  };
  // the saved draft wins, except the issue date, which is today again whenever the saved one has passed
  const merged = { ...base, ...draft };
  if (today && (!merged.issue_date || merged.issue_date < today)) merged.issue_date = today;
  return { form: merged, ctc_suggestion: annualFromMrf };
}

/** Which offer fields changed between two saves, for the audit trail. */
export function changedFields(before = {}, after = {}) {
  return Object.keys(after).filter((k) => k !== 'issue_date' && JSON.stringify(before[k] ?? '') !== JSON.stringify(after[k] ?? ''));
}

/**
 * Employees who may be the same person as a candidate: same email or phone ("strong"), or only the same name ("name").
 * Each employee is { user_id, display_name, personal_email, official_email, login_email, phone, official_phone, ... }.
 */
export function matchEmployees(candidate = {}, employees = []) {
  const emails = [candidate.email, candidate.offer_recipient_email].map((v) => clean(v).toLowerCase()).filter(Boolean);
  const phone = digits(candidate.phone).slice(-10);
  const name = clean(candidate.full_name).toLowerCase().replace(/\s+/g, ' ');
  const out = [];
  for (const e of employees) {
    const why = [];
    if ([e.personal_email, e.official_email, e.login_email].some((v) => v && emails.includes(String(v).trim().toLowerCase()))) why.push('same email');
    if (phone.length === 10 && [e.phone, e.official_phone].some((v) => digits(v).slice(-10) === phone)) why.push('same phone');
    const sameName = name && clean(e.display_name).toLowerCase().replace(/\s+/g, ' ') === name;
    if (sameName) why.push('same name');
    if (why.length) out.push({ employee: e, reasons: why, strong: why.some((w) => w !== 'same name') });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || b.reasons.length - a.reasons.length);
}

export const LINKABLE_STATUSES = ['offer_accepted', 'joined'];
