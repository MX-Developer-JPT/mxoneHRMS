// Performance Management & Appraisal — pure business rules (no DB, no Express) so they can be tested in isolation.
// Everything configurable lives in ApSettings / the cycle; the defaults below are only what a fresh install starts with.

export const DEFAULT_SCALE = [
  { value: 5, label: 'Outstanding' }, { value: 4, label: 'Exceeds Expectations' }, { value: 3, label: 'Meets Expectations' },
  { value: 2, label: 'Needs Improvement' }, { value: 1, label: 'Unsatisfactory' },
];
// A band starts at `min` and runs up to the next band's min (sample values — HR edits them).
export const DEFAULT_BANDS = [
  { min: 90, label: 'Outstanding' }, { min: 80, label: 'Exceeds Expectations' }, { min: 60, label: 'Meets Expectations' },
  { min: 40, label: 'Needs Improvement' }, { min: 0, label: 'Unsatisfactory' },
];
export const DEFAULT_COMPETENCIES = ['Communication', 'Teamwork', 'Problem Solving', 'Accountability', 'Initiative', 'Time Management', 'Adaptability', 'Leadership', 'Technical Competence', 'Professional Conduct']
  .map((name, i) => ({ id: `c${i + 1}`, name, enabled: true, weight: 10 }));
export const DEFAULT_SETTINGS = {
  scale: DEFAULT_SCALE, bands: DEFAULT_BANDS, competencies: DEFAULT_COMPETENCIES,
  split: { kpi: 100, competency: 0 },          // how much of the final score each part contributes (must total 100)
  decimals: 2, require_meeting: true, allow_late_submission: true, reminder_days: [7, 3, 1], large_gap: 2,
};

export const CYCLE_TYPES = ['mid_year', 'annual', 'probation', 'confirmation', 'project', 'special'];
export const CYCLE_STATUSES = ['draft', 'configured', 'published', 'in_progress', 'under_hr_review', 'finalised', 'closed', 'archived'];
export const KPI_TYPES = ['numeric', 'percentage', 'currency', 'quantity', 'binary', 'milestone', 'qualitative', 'formula'];
export const GOAL_STATUSES = ['not_started', 'in_progress', 'at_risk', 'completed', 'delayed', 'cancelled'];

const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
export { round };

// ── configuration validation ────────────────────────────────
export function validateScale(scale) {
  const errors = [];
  if (!Array.isArray(scale) || scale.length < 2) return { ok: false, errors: ['A rating scale needs at least 2 levels'] };
  const vals = scale.map(s => Number(s.value));
  if (vals.some(v => !Number.isFinite(v) || v <= 0)) errors.push('Every rating value must be a positive number');
  if (new Set(vals).size !== vals.length) errors.push('Rating values must be unique');
  if (scale.some(s => !String(s.label || '').trim())) errors.push('Every rating needs a label');
  return { ok: !errors.length, errors };
}
export const maxRating = (scale) => Math.max(...scale.map(s => Number(s.value)));

export function validateBands(bands) {
  const errors = [];
  if (!Array.isArray(bands) || !bands.length) return { ok: false, errors: ['At least one rating band is required'] };
  const mins = bands.map(b => Number(b.min));
  if (mins.some(m => !Number.isFinite(m) || m < 0 || m > 100)) errors.push('Band minimums must be between 0 and 100');
  if (new Set(mins).size !== mins.length) errors.push('Two bands start at the same score');
  if (!mins.includes(0)) errors.push('One band must start at 0 so every score has a rating');
  if (bands.some(b => !String(b.label || '').trim())) errors.push('Every band needs a label');
  return { ok: !errors.length, errors };
}
export function bandFor(score, bands) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  const sorted = [...bands].sort((a, b) => Number(b.min) - Number(a.min));
  return (sorted.find(b => Number(score) >= Number(b.min)) || sorted[sorted.length - 1]).label;
}

export function validateSettings(s) {
  const errors = [];
  const a = validateScale(s.scale); errors.push(...a.errors);
  const b = validateBands(s.bands); errors.push(...b.errors);
  const split = s.split || {};
  if (Math.abs(Number(split.kpi) + Number(split.competency) - 100) > 0.001) errors.push('KPI and competency contributions must total 100%');
  const comps = (s.competencies || []).filter(c => c.enabled);
  if (Number(split.competency) > 0) {
    if (!comps.length) errors.push('Competency scoring is on but no competency is enabled');
    else if (Math.abs(comps.reduce((t, c) => t + Number(c.weight || 0), 0) - 100) > 0.01) errors.push('Enabled competency weightages must total 100%');
  }
  const d = Number(s.decimals); if (!Number.isInteger(d) || d < 0 || d > 4) errors.push('Rounding must be 0 to 4 decimal places');
  return { ok: !errors.length, errors };
}

// ── KPI / KRA templates ─────────────────────────────────────
export function flattenKpis(items) {
  return (items || []).flatMap(k => (k.kpis || []).map(p => ({ ...p, kra_id: k.id || k.kra_id, kra_title: k.title || k.kra_title })));
}
// Every applicable KPI weight must be positive and the total must be exactly 100.
export function validateKpiWeights(items) {
  const kpis = flattenKpis(items); const errors = [];
  if (!kpis.length) return { ok: false, total: 0, errors: ['Add at least one KPI'] };
  const total = round(kpis.reduce((t, k) => t + Number(k.weight || 0), 0), 4);
  kpis.forEach(k => { if (!(Number(k.weight) > 0)) errors.push(`KPI "${k.title || k.id}" needs a weightage above 0`); if (!String(k.title || '').trim()) errors.push('Every KPI needs a title'); });
  if (Math.abs(total - 100) > 0.01) errors.push(`KPI weightages total ${total}% — they must total 100%`);
  const ids = kpis.map(k => k.id); if (new Set(ids).size !== ids.length) errors.push('KPI ids must be unique');
  return { ok: !errors.length, total, errors };
}

// ── scoring ─────────────────────────────────────────────────
// Weighted score of one KPI = rating x weightage / max rating  (5-point scale: 4 x 25% -> 20 of 25).
export function scoreKpis(items, ratings, scale, decimals = 2) {
  const max = maxRating(scale); const kpis = flattenKpis(items); const rows = []; const missing = [];
  let total = 0;
  for (const k of kpis) {
    const r = Number(ratings?.[k.id]);
    const valid = Number.isFinite(r) && r >= 1 && scale.some(s => Number(s.value) === r);
    if (!valid) { missing.push(k.id); rows.push({ id: k.id, title: k.title, weight: Number(k.weight), rating: null, weighted: null }); continue; }
    const weighted = (r * Number(k.weight)) / max; total += weighted;
    rows.push({ id: k.id, title: k.title, weight: Number(k.weight), rating: r, weighted: round(weighted, decimals) });
  }
  return { score: missing.length ? null : round(total, decimals), complete: !missing.length && kpis.length > 0, missing, rows };
}
export function scoreCompetencies(competencies, ratings, scale, decimals = 2) {
  const max = maxRating(scale); const comps = (competencies || []).filter(c => c.enabled); const missing = [];
  const wsum = comps.reduce((t, c) => t + Number(c.weight || 0), 0) || 1; let total = 0;
  for (const c of comps) {
    const r = Number(ratings?.[c.id]);
    if (!(Number.isFinite(r) && scale.some(s => Number(s.value) === r))) { missing.push(c.id); continue; }
    total += (r * (Number(c.weight) / wsum) * 100) / max;
  }
  return { score: missing.length || !comps.length ? null : round(total, decimals), complete: !missing.length && comps.length > 0, missing };
}
// Final = KPI score x KPI share + competency score x competency share. Incomplete parts never produce a final score.
export function combineScores({ kpi, comp, split, decimals = 2 }) {
  const ks = Number(split?.kpi ?? 100), cs = Number(split?.competency ?? 0);
  if (kpi === null || kpi === undefined) return null;
  if (cs > 0) { if (comp === null || comp === undefined) return null; return round((kpi * ks + comp * cs) / 100, decimals); }
  return round(kpi, decimals);
}

// Large difference between what the employee and the manager gave, per KPI (for calibration).
export function ratingGaps(selfRatings, mgrRatings, threshold = 2) {
  const out = [];
  for (const id of Object.keys(mgrRatings || {})) {
    const a = Number(selfRatings?.[id]), b = Number(mgrRatings[id]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) >= threshold) out.push({ kpi_id: id, self: a, manager: b, gap: round(a - b, 2) });
  }
  return out;
}

// ── status derivation (one place) ───────────────────────────
export function deriveStatus(r) {
  const hr = r.hr_status || 'pending', self = r.self_status || 'pending', mgr = r.mgr_status || 'pending', mt = r.meeting_status || 'not_scheduled';
  if (hr === 'closed') return 'closed';
  if (hr === 'published') return 'published';
  if (hr === 'approved') return 'approved';
  if (hr === 'returned') return 'returned_for_correction';
  if (mgr === 'submitted') {
    if (mt === 'completed') return 'hr_review_pending';
    if (r.meeting_required === false) return 'hr_review_pending';
    return mt === 'scheduled' || mt === 'rescheduled' ? 'meeting_scheduled' : 'meeting_pending';
  }
  if (self === 'submitted') return mgr === 'draft' ? 'manager_review_draft' : 'manager_review_pending';
  if (mt === 'completed') return 'meeting_completed';
  if (self === 'draft') return 'self_assessment_draft';
  return r.assigned ? 'self_assessment_pending' : 'not_started';
}
export const STATUS_LABEL = {
  not_started: 'Not Started', self_assessment_pending: 'Self-Assessment Pending', self_assessment_draft: 'Self-Assessment Draft', self_assessment_submitted: 'Self-Assessment Submitted',
  manager_review_pending: 'Manager Review Pending', manager_review_draft: 'Manager Review Draft', manager_review_submitted: 'Manager Review Submitted',
  meeting_pending: 'Meeting Pending', meeting_scheduled: 'Meeting Scheduled', meeting_completed: 'Meeting Completed',
  hr_review_pending: 'HR Review Pending', returned_for_correction: 'Returned for Correction', approved: 'Approved', published: 'Published', closed: 'Closed',
};

// ── dates (deadlines are Asia/Kolkata, end of the day) ──────
export const istDate = (ms = Date.now()) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
export function isPastDeadline(ymd, nowMs = Date.now()) { return !!ymd && istDate(nowMs) > String(ymd).slice(0, 10); }
export function daysUntil(ymd, nowMs = Date.now()) {
  if (!ymd) return null;
  return Math.round((Date.parse(String(ymd).slice(0, 10) + 'T00:00:00Z') - Date.parse(istDate(nowMs) + 'T00:00:00Z')) / 86400000);
}

// ── people: eligibility and reporting hierarchy ─────────────
// employees: [{ user_id, department, designation, category, joined, status, manager_id }]
export function eligibleEmployees(elig = {}, employees = [], periodEnd = '') {
  const inList = (list, v) => !Array.isArray(list) || !list.length || list.map(x => String(x).toLowerCase()).includes(String(v || '').toLowerCase());
  return employees.filter(e => {
    if (!e.user_id) return false;
    if (e.status && e.status !== 'active') return false;
    if (!inList(elig.departments, e.department) || !inList(elig.designations, e.designation) || !inList(elig.categories, e.category)) return false;
    const cutoff = elig.joined_on_or_before || periodEnd;
    if (cutoff && e.joined && String(e.joined).slice(0, 10) > String(cutoff).slice(0, 10)) return false;   // joined after the cut-off date
    return true;
  });
}
export function downstreamIds(userId, employees) {
  const kids = {}; for (const e of employees) if (e.manager_id) (kids[e.manager_id] ||= []).push(e.user_id);
  const out = new Set(); const stack = [...(kids[userId] || [])];
  while (stack.length) { const u = stack.pop(); if (out.has(u) || u === userId) continue; out.add(u); stack.push(...(kids[u] || [])); }
  return out;
}

// A review row is the one source for who may do what.
export function reviewAccess({ review, userId, role, downstream }) {
  const hr = role === 'hr' || role === 'admin';
  const own = review.user_id === userId;
  const evaluator = review.manager_id === userId;
  const chain = !!downstream && downstream.has(review.user_id);
  return { hr, own, evaluator, chain, canView: hr || own || evaluator || chain, canEvaluate: evaluator || (hr && false) };
}
