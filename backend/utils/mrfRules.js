// MRF validation / anomaly engine — pure rules, no database. Three classes:
//   critical    — must be corrected, or overridden by an authorised person with a written justification, before submission
//   warning     — HR should review it; never blocks
//   information — advice
// Every threshold is configuration (HR / admin edit it on the screen). A flag carries a fingerprint of the values that raised it,
// so an override stops counting the moment those values change.

export const SEVERITY = { critical: { label: 'Critical', rank: 3 }, warning: { label: 'Warning', rank: 2 }, information: { label: 'Information', rank: 1 } };

export const RULES = {
  ctc_band:           { label: 'CTC outside the configured range for the position tier' },
  ctc_unit:           { label: 'CTC looks like it was typed in lakhs, not rupees' },
  ctc_missing:        { label: 'No CTC entered, so it cannot be checked' },
  ctc_tier_mismatch:  { label: 'CTC / tier does not match the designation' },
  exp_low:            { label: 'Experience too low for the position tier' },
  exp_high:           { label: 'Experience too high for the position tier' },
  exp_designation:    { label: 'Experience inconsistent with the designation' },
  pay_history:        { label: 'CTC far from existing pay for similar positions', sensitive: true },
  duplicate:          { label: 'Duplicate or overlapping requisition' },
  replacement_dup:    { label: 'The same employee is already being replaced on another requisition' },
  replacement_dept:   { label: 'Replacement of someone from a different department' },
};

// Experience expectations ship as editable starting points; they only warn until HR sets exp_critical_gap above 0. CTC ranges are
// company-specific, so none are invented here: HR enters them on the Validation rules screen.
const exp = (exp_min, exp_max) => ({ ctc_min: null, ctc_max: null, exp_min, exp_max });
export const DEFAULT_TIERS = {
  executive: exp(null, 6), senior_executive: exp(1, 10), assistant_manager: exp(2, 12), deputy_manager: exp(3, 15), team_leader: exp(2, null),
  manager: exp(4, null), senior_manager: exp(7, null), territory_manager: exp(3, null), area_manager: exp(4, null), regional_manager: exp(7, null),
  assistant_general_manager: exp(9, null), deputy_general_manager: exp(10, null), general_manager: exp(12, null),
  vice_president: exp(12, null), senior_vice_president: exp(15, null), director: exp(12, null), managing_director: exp(15, null),
  chief_executive_officer: exp(15, null), chief_financial_officer: exp(12, null), chief_operating_officer: exp(12, null),
};

export const DEFAULT_SLA = {
  approval_days: 3, publication_days: 2, first_cv_days: 7, screening_days: 3, send_review_days: 2, review_days: 3,
  scheduling_days: 3, feedback_days: 2, offer_days: 3, offer_response_days: 5, joining_grace_days: 0, approaching_days: 7,
};
export const SLA_LABELS = {
  approval_days: 'Hiring Manager approval pending', publication_days: 'Approved, waiting for HR to publish', first_cv_days: 'Published with no applications',
  screening_days: 'Applications not screened', send_review_days: 'Shortlisted but CV not sent / no interview', review_days: 'CVs with the Hiring Manager / HOD',
  scheduling_days: 'Approved by manager but no interview', feedback_days: 'Interview feedback past SLA', offer_days: 'Selected, offer pending',
  offer_response_days: 'Offer not answered', joining_grace_days: 'Joining date overdue', approaching_days: 'Target date approaching (days before)',
};

export const DEFAULT_CONFIG = {
  tiers: DEFAULT_TIERS,
  ctc_critical_pct: 30,           // this far outside the tier range (percent of the limit) is critical, otherwise a warning
  exp_critical_gap: 0,            // this many years outside the tier's experience expectation is critical; 0 = only ever a warning
  history_deviation_pct: 40,
  history_min_samples: 3,
  disabled_rules: [],
  override_roles: ['hr', 'admin'],
  dept_head_approval: 'never',    // never | always | non_budgeted | critical_override  — an extra approval before HR publishes
  sla: DEFAULT_SLA,
};
export const DH_APPROVAL_MODES = ['never', 'always', 'non_budgeted', 'critical_override'];
const OVERRIDE_ROLE_CHOICES = ['hr', 'admin', 'management'];

const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const within = (v, lo, hi, fallback) => { const n = num(v); return n === null ? fallback : Math.min(hi, Math.max(lo, n)); };

/** Stored configuration merged over the defaults, every value forced into a sane range. */
export function normalizeConfig(raw) {
  const r = raw || {};
  const tiers = {};
  const source = r.tiers && typeof r.tiers === 'object' ? { ...DEFAULT_TIERS, ...r.tiers } : DEFAULT_TIERS;
  for (const [k, t] of Object.entries(source)) {
    if (!t || typeof t !== 'object') continue;
    const pos = (v) => { const n = num(v); return n === null || n < 0 ? null : n; };
    tiers[String(k).slice(0, 80)] = { ctc_min: pos(t.ctc_min), ctc_max: pos(t.ctc_max), exp_min: pos(t.exp_min), exp_max: pos(t.exp_max) };
  }
  const sla = {};
  for (const [k, d] of Object.entries(DEFAULT_SLA)) sla[k] = Math.round(within(r.sla?.[k], 0, 365, d));
  const roles = Array.isArray(r.override_roles) ? r.override_roles.filter((x) => OVERRIDE_ROLE_CHOICES.includes(x)) : DEFAULT_CONFIG.override_roles;
  return {
    tiers,
    ctc_critical_pct: within(r.ctc_critical_pct, 1, 500, DEFAULT_CONFIG.ctc_critical_pct),
    exp_critical_gap: within(r.exp_critical_gap, 0, 40, DEFAULT_CONFIG.exp_critical_gap),
    history_deviation_pct: within(r.history_deviation_pct, 5, 500, DEFAULT_CONFIG.history_deviation_pct),
    history_min_samples: Math.round(within(r.history_min_samples, 3, 100, DEFAULT_CONFIG.history_min_samples)),   // never below 3: fewer would expose one person's pay
    disabled_rules: Array.isArray(r.disabled_rules) ? r.disabled_rules.filter((x) => RULES[x]) : [],
    override_roles: roles.length ? roles : DEFAULT_CONFIG.override_roles,
    dept_head_approval: DH_APPROVAL_MODES.includes(r.dept_head_approval) ? r.dept_head_approval : 'never',
    sla,
  };
}

/** Configuration mistakes HR should hear about before saving. */
export function configProblems(raw) {
  const out = [];
  for (const [k, t] of Object.entries(raw?.tiers || {})) {
    const name = k.replace(/_/g, ' ');
    for (const [lo, hi, what] of [['ctc_min', 'ctc_max', 'CTC'], ['exp_min', 'exp_max', 'experience']]) {
      const a = num(t?.[lo]), b = num(t?.[hi]);
      if ((a !== null && a < 0) || (b !== null && b < 0)) out.push(`${name}: ${what} cannot be negative`);
      if (a !== null && b !== null && a > b) out.push(`${name}: minimum ${what} is higher than the maximum`);
    }
    for (const key of ['ctc_min', 'ctc_max']) { const v = num(t?.[key]); if (v !== null && v > 0 && v < 1000) out.push(`${name}: enter CTC in rupees per annum (${v} looks like lakhs)`); }
  }
  return out;
}

// ── experience ──
const masterMeta = (masters, value) => (masters?.experience_range || []).find((m) => m.value === value)?.meta || null;
/**
 * The experience asked for, in years: the numeric fields, or (older requisitions) the ranges picked from the master list.
 * `entered` tells whether anything was given at all.
 */
export function experienceBounds(f, masters = {}) {
  const a = num(f?.exp_min_years), b = num(f?.exp_max_years);
  if (a !== null || b !== null) return { min: a, max: b, entered: true };
  const lo = masterMeta(masters, f?.exp_min), hi = masterMeta(masters, f?.exp_max) || (f?.exp_mode === 'single' ? lo : null);
  if (!lo && !hi) return { min: null, max: null, entered: false };
  return { min: num(lo?.min), max: num((hi || lo)?.max), entered: true, from_master: true, order_bad: !!(lo && hi && num(hi.min) < num(lo.min)) };
}
/** Why this experience range cannot be submitted (null = fine). 0–1, 1–2, 2–3 are valid; 2–0 and 3–1 are not. */
export function experienceProblem(f, masters = {}) {
  const e = experienceBounds(f, masters);
  if (!e.entered) return 'Experience range is required';
  if (e.min === null || e.max === null) return 'Enter both the minimum and the maximum experience';
  if (e.min < 0 || e.max < 0) return 'Experience cannot be negative';
  if (e.min > 60 || (e.max > 60 && e.max !== 99)) return 'Experience cannot be more than 60 years';
  if (e.min > e.max || e.order_bad) return 'Maximum experience cannot be lower than the minimum';
  return null;
}
export const experienceText = (f, masters = {}) => {
  const { min, max, entered } = experienceBounds(f, masters);
  if (!entered || (min === null && max === null)) return '';
  if (min === 0 && max === 0) return 'Fresher';
  if (max === null) return `${min}+ years`;
  if (max >= 99) return `${min}+ years`;
  return min === max ? `${min} year${min === 1 ? '' : 's'}` : `${min ?? 0}–${max} years`;
};

// ── hiring target date: 15 to 45 days from submission, both ends included ──
export const TARGET_MIN_DAYS = 15;
export const TARGET_MAX_DAYS = 45;
export const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`)) / 86400000);
export const targetWindow = (submissionYmd) => ({ from: addDays(submissionYmd, TARGET_MIN_DAYS), to: addDays(submissionYmd, TARGET_MAX_DAYS), min_days: TARGET_MIN_DAYS, max_days: TARGET_MAX_DAYS });
const human = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function targetDateProblem(submissionYmd, targetYmd) {
  const w = targetWindow(submissionYmd);
  const range = `Choose a date between ${human(w.from)} and ${human(w.to)} (${TARGET_MIN_DAYS}–${TARGET_MAX_DAYS} days from submission on ${human(submissionYmd)}).`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetYmd || '')) || Number.isNaN(Date.parse(`${targetYmd}T00:00:00Z`))) return `Hiring target date is required. ${range}`;
  if (targetYmd < w.from) return `The hiring target date is too early. ${range}`;
  if (targetYmd > w.to) return `The hiring target date is too late. ${range}`;
  return null;
}

// ── designation → tier (the same hints the form uses to suggest a tier) ──
const TIER_RULES = [
  [/chief executive|\bceo\b/i, 'chief_executive_officer'], [/chief financial|\bcfo\b/i, 'chief_financial_officer'], [/chief operating|\bcoo\b/i, 'chief_operating_officer'], [/managing director/i, 'managing_director'],
  [/senior vice president|\bsvp\b/i, 'senior_vice_president'], [/vice president|\bavp\b|\bvp\b/i, 'vice_president'], [/executive assistant|personal assistant/i, ''], [/\bdirector\b|chairman|\bpresident\b/i, 'director'],
  [/deputy general manager|\bdgm\b/i, 'deputy_general_manager'], [/assistant general manager|\bagm\b/i, 'assistant_general_manager'], [/general manager|\bgm\b/i, 'general_manager'],
  [/regional .*manager/i, 'regional_manager'], [/area .*manager/i, 'area_manager'], [/territory .*manager/i, 'territory_manager'],
  [/senior .*manager/i, 'senior_manager'], [/deputy .*manager/i, 'deputy_manager'], [/assistant .*manager/i, 'assistant_manager'], [/\bmanager\b/i, 'manager'],
  [/team lead|team leader/i, 'team_leader'], [/senior executive/i, 'senior_executive'], [/\bexecutive\b/i, 'executive'],
];
export function designationTier(designation) {
  for (const [re, v] of TIER_RULES) if (re.test(String(designation || ''))) return v;
  return '';
}
const JUNIOR_RE = /trainee|intern\b|apprentice|\bjunior\b|\bfresher\b/i;
const SENIOR_RE = /^(senior|sr\.?)\s|\bhead\b|\blead\b|principal|\bchief\b/i;

// ── pay ──
export const annualCtc = (f, key) => { const n = num(f?.[key]); return n === null || n <= 0 ? null : f?.ctc_frequency === 'monthly' ? n * 12 : n; };
export const lakhs = (n) => `₹${(Math.round((n / 100000) * 100) / 100).toLocaleString('en-IN')} LPA`;
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const OPEN_FOR_OVERLAP = ['pending_hm_approval', 'changes_requested', 'pending_hr_publication', 'published', 'on_hold'];

/**
 * Every anomaly on a requisition form.
 * ctx = { masters, config, others: [other requisitions], pay: [{ designation, annual_ctc }], replaced: { name, department } | null,
 *         id: this requisition's id }
 */
export function evaluate(f, ctx = {}) {
  const config = ctx.config?.sla ? ctx.config : normalizeConfig(ctx.config);
  const masters = ctx.masters || {};
  const flags = [];
  const off = new Set(config.disabled_rules);
  const tierLabel = (v) => (masters.position_tier || []).find((m) => m.value === v)?.label || String(v || '').replace(/_/g, ' ');
  const add = (code, severity, field, title, message, print, detail = '', key = code) => {
    if (off.has(code)) return;
    flags.push({ code, key, severity, field, title, message, detail, sensitive: !!RULES[code]?.sensitive, fingerprint: JSON.stringify(print) });
  };

  const tier = f.position_tier || '';
  const band = config.tiers[tier] || null;
  const lo = annualCtc(f, 'ctc_min'), hi = annualCtc(f, 'ctc_max');
  const proposedLo = lo ?? hi, proposedHi = hi ?? lo;

  // CTC
  const typedLakhs = [num(f.ctc_min), num(f.ctc_max)].some((v) => v !== null && v > 0 && v < 1000);
  if (typedLakhs) add('ctc_unit', 'critical', 'ctc', 'CTC unit', 'The CTC looks like it was typed in lakhs. Enter the full amount in rupees (for 5 LPA type 500000).', [f.ctc_min, f.ctc_max, f.ctc_frequency]);
  if (band && (band.ctc_min !== null || band.ctc_max !== null)) {
    if (proposedHi === null) add('ctc_missing', 'information', 'ctc', 'CTC not entered', `Add the proposed CTC so it can be checked against the ${tierLabel(tier)} range.`, [tier]);
    else if (!typedLakhs) {
      const print = [tier, f.ctc_min, f.ctc_max, f.ctc_frequency, band.ctc_min, band.ctc_max];
      const judge = (value, limit, below) => {
        const gap = (Math.abs(value - limit) / limit) * 100;
        const severity = gap >= config.ctc_critical_pct ? 'critical' : 'warning';
        add('ctc_band', severity, 'ctc', 'CTC Mismatch',
          `The proposed CTC of ${lakhs(value)} appears ${severity === 'critical' ? 'significantly ' : ''}${below ? 'below' : 'above'} the configured compensation range for the ${tierLabel(tier)} position tier.`,
          print, `Configured range: ${band.ctc_min !== null ? lakhs(band.ctc_min) : '—'} to ${band.ctc_max !== null ? lakhs(band.ctc_max) : '—'} (${Math.round(gap)}% outside).`);
      };
      if (band.ctc_min && proposedHi < band.ctc_min) judge(proposedHi, band.ctc_min, true);
      else if (band.ctc_max && proposedLo > band.ctc_max) judge(proposedLo, band.ctc_max, false);
      else if (band.ctc_min && proposedLo < band.ctc_min) add('ctc_band', 'information', 'ctc', 'CTC range starts low', `The lower end of the CTC (${lakhs(proposedLo)}) is below the configured range for ${tierLabel(tier)}.`, print);
      else if (band.ctc_max && proposedHi > band.ctc_max) add('ctc_band', 'warning', 'ctc', 'CTC range ends high', `The upper end of the CTC (${lakhs(proposedHi)}) is above the configured range for ${tierLabel(tier)}.`, print);
    }
  }

  // designation ↔ tier
  const implied = designationTier(f.designation);
  if (implied && tier && tier !== 'other_custom' && implied !== tier) {
    const other = config.tiers[implied];
    const outside = other && !typedLakhs && ((other.ctc_min && proposedHi !== null && proposedHi < other.ctc_min) || (other.ctc_max && proposedLo !== null && proposedLo > other.ctc_max));
    add('ctc_tier_mismatch', outside ? 'warning' : 'information', 'position_tier', 'Designation and tier differ',
      outside ? `"${f.designation}" usually sits at the ${tierLabel(implied)} tier, and the CTC is outside that tier's range. Check the tier or the CTC.` : `"${f.designation}" usually sits at the ${tierLabel(implied)} tier, but ${tierLabel(tier)} is selected.`,
      [f.designation, tier, f.ctc_min, f.ctc_max]);
  }

  // experience
  const e = experienceBounds(f, masters);
  const expOk = e.entered && !experienceProblem(f, masters);
  if (expOk && band) {
    if (band.exp_min !== null && e.max < band.exp_min) {
      const gap = band.exp_min - e.max;
      add('exp_low', config.exp_critical_gap && gap >= config.exp_critical_gap ? 'critical' : 'warning', 'experience', 'Low experience for this level', `${experienceText(f, masters)} is low for the ${tierLabel(tier)} tier, which normally expects at least ${band.exp_min} years.`, [tier, e.min, e.max, band.exp_min]);
    }
    if (band.exp_max !== null && e.min > band.exp_max) {
      const gap = e.min - band.exp_max;
      add('exp_high', config.exp_critical_gap && gap >= config.exp_critical_gap ? 'critical' : 'warning', 'experience', 'High experience for this level', `${experienceText(f, masters)} is high for the ${tierLabel(tier)} tier, which normally goes up to ${band.exp_max} years.`, [tier, e.min, e.max, band.exp_max]);
    }
  }
  if (expOk && f.designation) {
    const dBand = implied && implied !== tier ? config.tiers[implied] : null;
    if (JUNIOR_RE.test(f.designation) && e.min > 2) add('exp_designation', 'warning', 'experience', 'Experience vs designation', `"${f.designation}" is an entry-level designation, but ${experienceText(f, masters)} of experience is asked for.`, [f.designation, e.min, e.max]);
    else if (SENIOR_RE.test(f.designation) && e.max < 2) add('exp_designation', 'warning', 'experience', 'Experience vs designation', `"${f.designation}" is a senior designation, but only ${experienceText(f, masters)} of experience is asked for.`, [f.designation, e.min, e.max]);
    else if (dBand && ((dBand.exp_min !== null && e.max < dBand.exp_min) || (dBand.exp_max !== null && e.min > dBand.exp_max))) add('exp_designation', 'warning', 'experience', 'Experience vs designation', `${experienceText(f, masters)} is unusual for a "${f.designation}".`, [f.designation, e.min, e.max]);
  }

  // pay history: existing salary structures of people with the same designation, and earlier approved requisitions
  const mid = proposedHi === null ? null : (proposedLo + proposedHi) / 2;
  if (mid !== null && !typedLakhs && f.designation) {
    const want = norm(f.designation);
    const samples = (ctx.pay || []).filter((p) => norm(p.designation) === want && p.annual_ctc > 0).map((p) => p.annual_ctc);
    const past = (ctx.others || []).filter((r) => r.id !== ctx.id && norm(r.designation) === want && r.hm_approved_at).map((r) => { const a = annualCtc(r, 'ctc_min'), b = annualCtc(r, 'ctc_max'); return a === null && b === null ? null : ((a ?? b) + (b ?? a)) / 2; }).filter((v) => v !== null);
    for (const [set, what, k] of [[samples, 'the current salaries of people in this designation', 'salaries'], [past, 'earlier approved requisitions for this designation', 'requisitions']]) {
      if (set.length < config.history_min_samples) continue;
      const m = median(set); const dev = ((mid - m) / m) * 100;
      if (Math.abs(dev) >= config.history_deviation_pct) add('pay_history', 'warning', 'ctc', 'Differs from existing pay', `The proposed CTC is well ${dev < 0 ? 'below' : 'above'} ${what}.`, [f.designation, f.ctc_min, f.ctc_max, f.ctc_frequency, k], `Median ${lakhs(m)} across ${set.length} record(s); the proposal is ${Math.round(Math.abs(dev))}% ${dev < 0 ? 'lower' : 'higher'}.`, `pay_history_${k}`);
    }
  }

  // duplicates / overlaps
  const open = (ctx.others || []).filter((r) => r.id !== ctx.id && OPEN_FOR_OVERLAP.includes(r.status));
  if (f.department && f.designation) {
    const same = open.filter((r) => norm(r.department) === norm(f.department) && norm(r.designation) === norm(f.designation));
    if (same.length) {
      const place = norm(f.work_location || f.work_city);
      const exact = same.filter((r) => r.requisition_type === f.requisition_type && norm(r.work_location || r.work_city) === place);
      add('duplicate', exact.length ? 'warning' : 'information', 'designation', exact.length ? 'Possible duplicate requisition' : 'Overlapping requisition',
        `${same.length} open requisition(s) already ask for ${f.designation} in ${f.department}: ${same.slice(0, 4).map((r) => r.requisition_id).join(', ')}.`, [f.department, f.designation, f.requisition_type, place, same.map((r) => r.id).sort()]);
    }
  }
  if (f.requisition_type === 'replacement' && f.replaced_employee_user_id) {
    const taken = open.filter((r) => r.requisition_type === 'replacement' && r.replaced_employee_user_id === f.replaced_employee_user_id);
    if (taken.length) add('replacement_dup', 'critical', 'replaced_employee', 'Already being replaced', `This employee is already being replaced on ${taken.slice(0, 3).map((r) => r.requisition_id).join(', ')}.`, [f.replaced_employee_user_id, taken.map((r) => r.id).sort()]);
    const dep = ctx.replaced?.department;
    if (dep && f.department && norm(dep) !== norm(f.department)) add('replacement_dept', 'warning', 'replaced_employee', 'Different department', `${ctx.replaced.name || 'The replaced employee'} belongs to ${dep}, but this requisition is for ${f.department}.`, [f.replaced_employee_user_id, f.department, dep]);
  }

  return flags.sort((a, b) => SEVERITY[b.severity].rank - SEVERITY[a.severity].rank);
}

/** Marks each flag with the override that still applies to it (same flag, same values). */
export function applyOverrides(flags, overrides = {}) {
  return flags.map((fl) => {
    const o = overrides[fl.key];
    const valid = o && o.fingerprint === fl.fingerprint && SEVERITY[o.severity]?.rank >= SEVERITY[fl.severity].rank;
    return valid ? { ...fl, override: { by_name: o.by_name, role: o.role, at: o.at, justification: o.justification } } : fl;
  });
}
export const blockingFlags = (flags) => flags.filter((f) => f.severity === 'critical' && !f.override);
export const canOverride = (roles, config) => (roles || []).some((r) => (config?.override_roles || DEFAULT_CONFIG.override_roles).includes(r));
export const MIN_JUSTIFICATION = 10;

/** What a viewer may see: pay-history flags describe other people's salaries, so only HR / admin get them. */
export const visibleFlags = (flags, isHr) => (isHr ? flags : (flags || []).filter((f) => !f.sensitive).map(({ detail, ...f }) => ({ ...f, detail: '' })));

export function needsDeptHeadApproval(rec, config) {
  const mode = config?.dept_head_approval || 'never';
  if (mode === 'always') return true;
  if (mode === 'non_budgeted') return rec.budget_status === 'non_budgeted';
  if (mode === 'critical_override') return (rec.validation?.flags || []).some((f) => f.severity === 'critical' && f.override);
  return false;
}
