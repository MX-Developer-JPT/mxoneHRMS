// MRF-wise recruitment MIS — pure computation over the records the app already holds (requisitions, candidates and their
// timelines, CV review batches, interviews, offers). Nothing here is stored or typed in: every number comes from a transaction.
//
// Counting rule: a candidate counts in every stage up to the furthest one they reached (so the funnel only narrows). Time spent
// in a stage is measured only where both ends have a recorded timestamp.
import * as LC from './hiringLifecycle.js';
import { DEFAULT_SLA, SLA_LABELS, daysBetween, experienceText, annualCtc, lakhs } from './mrfRules.js';

export const CANDIDATE_STAGES = [
  ['applications', 'Applications / CVs received'], ['shortlisted', 'Shortlisted'], ['sent_for_review', 'CVs sent for review'], ['hm_approved', 'CVs approved by Hiring Manager'],
  ['interview_scheduled', 'Interview scheduled'], ['interview_completed', 'Interview completed'], ['selected', 'Selected'], ['offer_released', 'Offer released'],
  ['offer_accepted', 'Offer accepted'], ['pre_joining', 'Pre-joining documentation'], ['joined', 'Candidate joined'],
];
const IDX = Object.fromEntries(CANDIDATE_STAGES.map(([k], i) => [k, i]));
export const MRF_STAGES = [
  ['initiated', 'MRF initiated'], ['submitted', 'Submitted'], ['approval_pending', 'Approval pending'], ['approved', 'Approved'], ['published', 'Requisition published'],
  ['applications', 'Applications / CVs received'], ['shortlisted', 'Shortlisted'], ['sent_for_review', 'CVs sent for review'], ['hm_approved', 'CVs approved / rejected by Hiring Manager'],
  ['interview_scheduled', 'Interview scheduled'], ['interview_completed', 'Interview completed'], ['selected', 'Selected'], ['offer_released', 'Offer released'],
  ['offer_accepted', 'Offer accepted / rejected'], ['pre_joining', 'Pre-joining documentation'], ['joined', 'Candidate joined'], ['closed', 'MRF closed'],
  ['on_hold', 'On hold'], ['cancelled', 'Cancelled'], ['reopened', 'Reopened'], ['withdrawn', 'Position withdrawn'], ['rejected', 'Rejected'],
];
const STAGE_LABEL = Object.fromEntries(MRF_STAGES);
export const SLA_STATUS = {
  not_submitted: 'Not submitted', on_track: 'On track', approaching: 'Target approaching', delayed: 'Stage delayed', overdue: 'Overdue',
  on_hold: 'On hold', completed_on_time: 'Filled on time', completed_late: 'Filled late', closed_unfilled: 'Closed unfilled', cancelled: 'Cancelled / rejected', no_target: 'No target date',
};
const STATUS_STAGE = {
  applied: IDX.applications, screening: IDX.applications, shortlisted: IDX.shortlisted, cv_sent: IDX.sent_for_review, interview_recommended: IDX.hm_approved, interview_scheduled: IDX.interview_scheduled,
  interviewed: IDX.interview_completed, interview_done: IDX.interview_completed, next_round_recommended: IDX.interview_completed, selected: IDX.selected, offer_in_progress: IDX.selected,
  offered: IDX.offer_released, offer_declined: IDX.offer_released, offer_accepted: IDX.offer_accepted, joined: IDX.joined, hired: IDX.joined, onboarded: IDX.joined,
};
const GONE = new Set(['rejected', 'withdrawn', 'offer_declined']);
const DONE = new Set(['joined', 'hired', 'onboarded']);
export const OPEN_MRF = ['pending_hm_approval', 'changes_requested', 'pending_hr_publication', 'published', 'on_hold'];

const IST = 5.5 * 3600000;
export const istDay = (v) => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s.length === 16 ? `${s}:00+05:30` : /^\d{4}-\d{2}-\d{2} /.test(s) && !/[zZ+]/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? new Date(t + IST).toISOString().slice(0, 10) : s.slice(0, 10);
};
const ms = (v) => { const s = String(v || ''); const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+05:30` : s.length === 16 ? `${s}:00+05:30` : s); return Number.isFinite(t) ? t : null; };
const earliest = (xs) => xs.filter(Boolean).sort((a, b) => (ms(a) ?? 0) - (ms(b) ?? 0))[0] || '';
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x) && x >= 0); return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sum = (xs) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
const reqKey = (c) => c.requisition_id || c.job_requisition_id || c.job_id || '';
const candName = (c) => c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || 'Candidate';

/** Indian financial year of a date, e.g. 2026-11-27 → "2026-27". */
export const financialYear = (ymd) => { const y = Number(String(ymd).slice(0, 4)), m = Number(String(ymd).slice(5, 7)); if (!y || !m) return ''; const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };

/** The furthest stage one candidate reached, when each stage was first recorded, and where they are now. */
export function candidateJourney(c, batches = [], interviews = []) {
  const at = {};
  let reached = 0;
  const hit = (i, when) => { if (i === undefined) return; reached = Math.max(reached, i); if (when && (!at[i] || (ms(when) ?? Infinity) < (ms(at[i]) ?? Infinity))) at[i] = when; };
  const applied = c.applied_date || c.created_at || c._created || '';
  hit(0, applied);
  const status = c.status || 'applied';
  hit(STATUS_STAGE[status]);
  let lastMove = applied;
  for (const e of c.timeline || []) {
    if (e.type !== 'status') continue;
    hit(STATUS_STAGE[e.to], e.at);
    if (e.to === status && (ms(e.at) ?? 0) >= (ms(lastMove) ?? 0)) lastMove = e.at;
  }
  let hmRejected = false, hmDecided = '', sentAt = '';
  for (const b of batches) {
    const entry = (b.candidates || []).find((x) => x.candidate_id === c.id);
    if (!entry) continue;
    hit(IDX.sent_for_review, b.sent_at);
    if (b.sent_at && (ms(b.sent_at) ?? 0) > (ms(sentAt) ?? 0)) sentAt = b.sent_at;
    for (const d of Object.values(entry.decisions || {})) {
      if (d.decision === 'shortlist') hit(IDX.hm_approved, d.at);
      if (d.decision === 'reject') hmRejected = true;
      if (['shortlist', 'reject'].includes(d.decision)) hmDecided = earliest([hmDecided, d.at]);
    }
  }
  for (const i of interviews) {
    if (i.candidate_id !== c.id || i.status === 'cancelled') continue;
    hit(IDX.interview_scheduled, i.created_at_iso || i._created);
    if (i.status === 'completed') hit(IDX.interview_completed, i.completed_at || (i.feedbacks || [])[0]?.submitted_at || '');
  }
  if (c.offer_letter_date) hit(IDX.offer_released, c.offer_letter_date);
  if (c.offer_status === 'accepted') hit(IDX.offer_accepted, c.offer_accepted_at);
  if (reached >= IDX.offer_accepted && (c.doc_collection_sent_at || c.doc_collection_status)) hit(IDX.pre_joining, c.doc_collection_sent_at && (ms(c.doc_collection_sent_at) ?? 0) > (ms(at[IDX.offer_accepted]) ?? 0) ? c.doc_collection_sent_at : '');
  if (DONE.has(status)) hit(IDX.joined, c.joined_date || c.joining_date || '');
  return {
    id: c.id, name: candName(c), status, status_label: LC.statusLabel(status), reached, at, applied, since: status === 'offered' ? c.offer_letter_date || lastMove : status === 'cv_sent' ? sentAt || lastMove : lastMove,
    active: !GONE.has(status) && !DONE.has(status), joined: DONE.has(status), declined: status === 'offer_declined', hm_rejected: hmRejected && reached < IDX.hm_approved, hm_decided: hmDecided,
    joining_date: c.joining_date || '',
  };
}

/** One person once per requisition: the same email or phone twice counts as one (the furthest record). */
function dedupeCandidates(list) {
  const out = [], dupes = [], seen = new Map();
  const keys = (c) => [String(c.email || '').trim().toLowerCase(), String(c.phone || '').replace(/\D/g, '').slice(-10)].filter((k, i) => (i === 0 ? k.includes('@') : k.length === 10));
  for (const item of [...list].sort((a, b) => b.journey.reached - a.journey.reached)) {
    const k = keys(item.record);
    const prior = k.map((x) => seen.get(x)).find(Boolean);
    if (prior) { dupes.push({ id: item.record.id, name: candName(item.record), same_as: prior }); continue; }
    for (const x of k) seen.set(x, item.record.id);
    out.push(item);
  }
  return { out, dupes };
}

const LEGACY_STATUS = (r) => {
  const s = String(r.status || '').toLowerCase();
  if (r.mrf_version === 2) return r.status || 'draft';
  if (s === 'draft') return 'draft';
  if (/reject/.test(s)) return 'rejected';
  if (['closed', 'filled'].includes(s)) return 'closed';
  if (['cancelled', 'on_hold'].includes(s)) return s;
  if (r.is_published || ['published', 'open'].includes(s)) return 'published';
  if (s === 'approved') return 'pending_hr_publication';
  return 'pending_hm_approval';
};

export function funnelOf(journeys) {
  return CANDIDATE_STAGES.map(([key, label], i) => {
    const here = journeys.filter((j) => j.reached >= i);
    const prev = i ? journeys.filter((j) => j.reached >= i - 1).length : null;
    const durations = i ? here.filter((j) => j.at[i] && j.at[i - 1]).map((j) => (ms(j.at[i]) - ms(j.at[i - 1])) / 86400000) : [];
    const conversion = i ? pct(here.length, prev) : (here.length ? 100 : null);
    return { key, label, index: i, count: here.length, conversion_pct: conversion, dropoff_pct: i && conversion !== null ? round1(100 - conversion) : null, avg_days: avg(durations), waiting: journeys.filter((j) => j.active && j.reached === i).length };
  });
}

/** Everything that has waited longer than its configured time on one open requisition. */
function breachesFor(m, journeys, interviews, sla, today, now) {
  const out = [];
  const add = (rule, since, extra = {}) => {
    const day = istDay(since); if (!day) return;
    const days = daysBetween(day, today); const limit = sla[rule];
    if (days > limit) out.push({ rule, mrf_id: m.id, mrf_no: m.mrf_no, designation: m.designation, since: day, days, limit, ...extra });
  };
  if (m.status === 'pending_hm_approval') add('approval_days', m.times.submitted || m.times.initiated);
  if (m.status === 'pending_hr_publication') add('publication_days', m.times.approved);
  if (m.status !== 'published') return out;
  if (!journeys.length) add('first_cv_days', m.times.published);
  for (const j of journeys) {
    if (!j.active) continue;
    const who = { candidate_id: j.id, name: j.name };
    if (['applied', 'screening'].includes(j.status)) add('screening_days', j.since, who);
    else if (j.status === 'shortlisted') add('send_review_days', j.since, who);
    else if (j.status === 'cv_sent') add('review_days', j.since, who);
    else if (['interview_recommended', 'next_round_recommended'].includes(j.status)) add('scheduling_days', j.since, who);
    else if (['selected', 'offer_in_progress'].includes(j.status)) add('offer_days', j.since, who);
    else if (j.status === 'offered') add('offer_response_days', j.since, who);
    else if (j.status === 'offer_accepted' && j.joining_date) add('joining_grace_days', j.joining_date, who);
  }
  const names = new Map(journeys.map((j) => [j.id, j.name]));
  for (const i of interviews) {
    if (i.status !== 'scheduled' || !names.has(i.candidate_id)) continue;
    const end = ms(String(i.scheduled_date).slice(0, 16));
    if (end !== null && end + (Number(i.duration_minutes) || 30) * 60000 < now) add('feedback_days', String(i.scheduled_date).slice(0, 10), { candidate_id: i.candidate_id, name: names.get(i.candidate_id) });
  }
  return out;
}

function buildMrf(r, ctx) {
  const { D, masters, sla, today, now, empName, byReq, batchesBy, interviewsBy } = ctx;
  const lab = (kind, v) => (masters[kind] || []).find((x) => x.value === v)?.label || (v ? String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
  const status = LEGACY_STATUS(r);
  const batches = batchesBy.get(r.id) || [];
  const interviews = interviewsBy.get(r.id) || [];
  const { out: people, dupes } = dedupeCandidates((byReq.get(r.id) || []).map((record) => ({ record, journey: candidateJourney(record, batches, interviews) })));
  const journeys = people.map((x) => x.journey);
  const audit = r.audit || [];
  const auditAt = (action) => audit.find((a) => a.action === action)?.at || '';

  const created = auditAt('created') || r.created_at || r._created || r.requisition_date || '';
  const submitted = status === 'draft' ? '' : (r.submitted_at || auditAt('submitted') || (r.mrf_version === 2 ? r.requisition_date : created) || '');
  const approvedAt = r.hm_approved_at || r.hr_approved_date || r.manager_approved_date || r.approved_date || '';
  const closedAt = status === 'closed' ? (r.closed_at || r.closed_date || '') : '';
  const cancelledAt = status === 'cancelled' ? (r.cancelled_at || auditAt('status_cancelled') || '') : '';
  const firstAt = (i) => earliest(journeys.map((j) => j.at[i]));
  const times = { initiated: created, submitted, approval_pending: submitted, approved: approvedAt, published: r.published_date || '' };
  for (const [key] of CANDIDATE_STAGES) times[key] = firstAt(IDX[key]);
  times.hm_approved = earliest([times.hm_approved, ...journeys.map((j) => j.hm_decided)]);
  times.closed = closedAt;

  const positions = Math.max(1, Number(r.number_of_positions) || 1);
  const joined = journeys.filter((j) => j.joined).length;
  const markedFilled = status === 'closed' && (r.closed_reason === 'filled' || String(r.status).toLowerCase() === 'filled');
  const filled = Math.min(positions, Math.max(Number(r.positions_filled) || 0, joined, markedFilled && r.mrf_version !== 2 ? positions : 0));
  const finished = ['closed', 'cancelled', 'rejected'].includes(status);
  const remaining = finished ? 0 : positions - filled;
  const submissionDay = istDay(submitted);
  const target = String(r.target_hire_date || '').slice(0, 10);
  const endDay = istDay(closedAt || cancelledAt) || today;

  const funnel = funnelOf(journeys);
  const active = journeys.filter((j) => j.active);
  let stage;
  if (status === 'draft') stage = 'initiated';
  else if (['pending_hm_approval', 'changes_requested'].includes(status)) stage = 'approval_pending';
  else if (status === 'pending_hr_publication') stage = 'approved';
  else if (['on_hold', 'cancelled', 'rejected', 'closed'].includes(status)) stage = status;
  else if (active.length) stage = CANDIDATE_STAGES[Math.max(...active.map((j) => j.reached))][0];
  else stage = journeys.length ? 'applications' : 'published';

  const m = {
    id: r.id, mrf_no: r.requisition_id || '', v2: r.mrf_version === 2, status, department: r.department || '', designation: r.designation || r.position_title || '',
    tier: r.position_tier || '', tier_label: r.position_tier === 'other_custom' ? r.position_tier_custom : lab('position_tier', r.position_tier),
    hiring_manager_id: r.hiring_manager_id || '', hiring_manager: empName(r.hiring_manager_id), times,
  };
  const breaches = breachesFor(m, journeys, interviews, sla, today, now);

  const recruiterId = r.recruiter_id || batches.map((b) => b.created_by).find(Boolean) || interviews.map((i) => i.created_by).find(Boolean) || r.published_by || '';
  const overdue = OPEN_MRF.includes(status) && !!target && target < today;
  const daysRemaining = OPEN_MRF.includes(status) && target ? daysBetween(today, target) : null;
  let slaStatus;
  if (status === 'draft') slaStatus = 'not_submitted';
  else if (status === 'cancelled' || status === 'rejected') slaStatus = 'cancelled';
  else if (status === 'closed') slaStatus = filled >= positions ? (target && istDay(closedAt) > target ? 'completed_late' : 'completed_on_time') : 'closed_unfilled';
  else if (status === 'on_hold') slaStatus = 'on_hold';
  else if (overdue) slaStatus = 'overdue';
  else if (daysRemaining !== null && daysRemaining <= sla.approaching_days) slaStatus = 'approaching';
  else if (breaches.length) slaStatus = 'delayed';
  else slaStatus = target ? 'on_track' : 'no_target';

  // bottleneck: the breached rule holding the most days of waiting; otherwise the stage most live candidates sit in
  let bottleneck = null;
  if (OPEN_MRF.includes(status)) {
    const byRule = {};
    for (const b of breaches) { const g = (byRule[b.rule] ||= { rule: b.rule, label: SLA_LABELS[b.rule], count: 0, days: 0, max_days: 0 }); g.count++; g.days += b.days; g.max_days = Math.max(g.max_days, b.days); }
    const worst = Object.values(byRule).sort((a, b) => b.days - a.days)[0];
    if (worst) bottleneck = { ...worst, breached: true };
    else { const w = funnel.filter((s) => s.waiting && s.key !== 'joined').sort((a, b) => b.waiting - a.waiting || b.index - a.index)[0]; if (w) bottleneck = { rule: '', label: `Waiting after: ${w.label}`, count: w.waiting, breached: false }; }
  }

  const share = filled / positions;
  const furthest = journeys.filter((j) => j.active).reduce((x, j) => Math.max(x, j.reached), journeys.length ? 0 : -1);
  const preCandidate = status === 'draft' ? 0 : ['pending_hm_approval', 'changes_requested'].includes(status) ? 0.05 : status === 'pending_hr_publication' ? 0.1 : r.published_date || status === 'published' ? 0.15 : 0;
  const pipeline = furthest >= 0 ? 0.2 + 0.75 * (furthest / IDX.joined) : preCandidate;
  const progress = markedFilled && filled >= positions ? 100 : Math.round(100 * (share + (1 - share) * pipeline));

  const lo = annualCtc(r, 'ctc_min'), hi = annualCtc(r, 'ctc_max');
  const legacyLo = Number(r.salary_range_min) || null, legacyHi = Number(r.salary_range_max) || null;
  const ctcLo = r.mrf_version === 2 ? lo : legacyLo, ctcHi = r.mrf_version === 2 ? hi : legacyHi;
  const count = (key) => funnel[IDX[key]].count;
  const history = audit.filter((a) => !['details_updated'].includes(a.action) && !a.action.startsWith('jd_generate') && !a.action.startsWith('jd_regenerate')).map((a) => ({ at: a.at, by: a.by_name || '', action: a.action, detail: a.detail || '' }));
  const heldDays = (() => { let total = 0, from = null; for (const a of audit) { if (a.action === 'status_on_hold') from = ms(a.at); if (from !== null && ['status_resume', 'status_closed', 'status_filled', 'status_cancelled', 'published'].includes(a.action)) { total += (ms(a.at) - from) / 86400000; from = null; } } if (from !== null) total += (now - from) / 86400000; return round1(total); })();

  return {
    ...m,
    recruiter_id: recruiterId, recruiter: empName(recruiterId), budget_status: r.budget_status || '', budget_label: lab('budget_status', r.budget_status) || 'Not recorded',
    requisition_type: r.requisition_type || '', type_label: lab('requisition_type', r.requisition_type) || 'Not recorded',
    experience: experienceText(r, masters) || r.experience_required || '',
    ctc_annual_min: ctcLo, ctc_annual_max: ctcHi, ctc_label: ctcLo || ctcHi ? [ctcLo, ctcHi].filter(Boolean).map(lakhs).filter((v, i, a) => a.indexOf(v) === i).join(' – ') : '',
    created_date: istDay(created), submission_date: submissionDay, target_date: target, closed_date: istDay(closedAt),
    stage, stage_label: status === 'changes_requested' ? 'Approval pending (changes requested)' : STAGE_LABEL[stage] || stage,
    reopened: !!r.reopened_at, positions_withdrawn: Number(r.positions_withdrawn) || 0, on_hold_days: heldDays,
    total_cvs: count('applications'), shortlisted: count('shortlisted'), sent_for_review: count('sent_for_review'), hm_approved: count('hm_approved'), hm_rejected: journeys.filter((j) => j.hm_rejected).length,
    interviews_scheduled: count('interview_scheduled'), interviews_completed: count('interview_completed'), selected: count('selected'), offers_released: count('offer_released'), offers_accepted: count('offer_accepted'),
    offers_declined: journeys.filter((j) => j.declined).length, joined, positions, filled, remaining, fulfilment_pct: pct(filled, positions) || 0, progress_pct: Math.min(100, progress),
    days_elapsed: submissionDay ? Math.max(0, daysBetween(submissionDay, endDay)) : null, days_remaining: daysRemaining, sla_status: slaStatus, sla_label: SLA_STATUS[slaStatus], overdue,
    bottleneck, breaches, funnel, history,
    milestones: MRF_STAGES.slice(0, 17).map(([key, label]) => ({ key, label, at: times[key] || '', count: IDX[key] !== undefined ? funnel[IDX[key]].count : null })),
    _journeys: journeys, _dupes: dupes,
  };
}

const inList = (v, want) => !want || want === 'all' || (Array.isArray(want) ? !want.length || want.includes(v) : v === want);
export function matchesFilters(m, f = {}) {
  const day = m.submission_date || m.created_date;
  return (!f.fy || f.fy === 'all' || financialYear(day) === f.fy) && (!f.from || day >= f.from) && (!f.to || day <= f.to)
    && inList(m.department, f.department) && inList(m.designation, f.designation) && inList(m.tier, f.tier) && inList(m.recruiter_id, f.recruiter_id) && inList(m.hiring_manager_id, f.hiring_manager_id)
    && inList(m.budget_status, f.budget_status) && inList(m.requisition_type, f.requisition_type) && inList(m.sla_status, f.sla_status) && inList(m.id, f.mrf_id)
    && (!f.stage || f.stage === 'all' || (f.stage === 'reopened' ? m.reopened : f.stage === 'withdrawn' ? m.positions_withdrawn > 0 : m.stage === f.stage));
}

/** KPIs for a set of requisitions; every value carries the records behind it so the screen can open them. */
export function kpisOf(rows) {
  const J = rows.flatMap((m) => m._journeys.map((j) => ({ ...j, mrf: m })));
  const mrfKpi = (key, label, list, value = list.length) => ({ key, label, value, mrf_ids: list.map((m) => m.id), candidate_ids: null });
  const candKpi = (key, label, list, value = list.length, unit = '') => ({ key, label, value, unit, mrf_ids: [...new Set(list.map((j) => j.mrf.id))], candidate_ids: list.map((j) => j.id) });
  const open = rows.filter((m) => OPEN_MRF.includes(m.status));
  const approved = rows.filter((m) => m.times.approved && !['draft', 'cancelled', 'rejected', 'pending_hm_approval', 'changes_requested'].includes(m.status));
  const published = rows.filter((m) => m.status === 'published');
  const filledRows = rows.filter((m) => m.filled > 0);
  const reached = (k) => J.filter((j) => j.reached >= IDX[k]);
  const joined = J.filter((j) => j.joined);
  const hireDays = joined.map((j) => (j.at[IDX.joined] && j.applied ? (ms(j.at[IDX.joined]) - ms(j.applied)) / 86400000 : null));
  const fillDays = joined.map((j) => (j.at[IDX.joined] && j.mrf.submission_date ? daysBetween(j.mrf.submission_date, istDay(j.at[IDX.joined])) : null));
  const released = reached('offer_released'), accepted = reached('offer_accepted');
  return [
    mrfKpi('open', 'Open requisitions', open), mrfKpi('approved', 'Approved', approved), mrfKpi('pending_approval', 'Pending approval', rows.filter((m) => ['pending_hm_approval', 'changes_requested'].includes(m.status))),
    mrfKpi('active', 'Active (have live candidates)', published.filter((m) => m._journeys.some((j) => j.active))),
    mrfKpi('published_positions', 'Published positions', published, sum(published.map((m) => m.remaining))),
    candKpi('cvs', 'CVs received', J), candKpi('interviews', 'Candidates with interviews', reached('interview_scheduled')), candKpi('offers_released', 'Offers released', released), candKpi('offers_accepted', 'Offers accepted', accepted),
    mrfKpi('positions_filled', 'Positions filled', filledRows, sum(filledRows.map((m) => m.filled))),
    mrfKpi('overdue', 'Overdue', rows.filter((m) => m.sla_status === 'overdue')), mrfKpi('approaching', 'Approaching target date', rows.filter((m) => m.sla_status === 'approaching')),
    { ...candKpi('time_to_hire', 'Average time to hire', joined, avg(hireDays), 'days'), hint: 'Application received → joined' },
    { ...candKpi('time_to_fill', 'Average time to fill', joined, avg(fillDays), 'days'), hint: 'MRF submitted → joined' },
    { ...candKpi('offer_acceptance', 'Offer acceptance ratio', released, pct(accepted.length, released.length), '%'), hint: 'Offers accepted ÷ offers released' },
    { ...candKpi('conversion', 'CV to joining conversion', joined, pct(joined.length, J.length), '%'), hint: 'Joined ÷ CVs received' },
  ];
}

const groupRows = (rows, keyOf, nameOf) => {
  const map = new Map();
  for (const m of rows) { const k = keyOf(m) || ''; if (!map.has(k)) map.set(k, []); map.get(k).push(m); }
  return [...map.entries()].map(([key, list]) => {
    const J = list.flatMap((m) => m._journeys);
    const positions = sum(list.map((m) => (['cancelled', 'rejected'].includes(m.status) ? 0 : m.positions)));
    const filled = sum(list.map((m) => m.filled));
    return {
      key, name: nameOf(list[0]) || 'Not recorded', mrfs: list.length, open: list.filter((m) => OPEN_MRF.includes(m.status)).length, positions, filled, remaining: sum(list.map((m) => m.remaining)), fill_pct: pct(filled, positions) || 0,
      overdue: list.filter((m) => m.overdue).length, cvs: J.length, shortlisted: J.filter((j) => j.reached >= IDX.shortlisted).length, interviews: J.filter((j) => j.reached >= IDX.interview_scheduled).length,
      offers: J.filter((j) => j.reached >= IDX.offer_released).length, accepted: J.filter((j) => j.reached >= IDX.offer_accepted).length, joined: J.filter((j) => j.joined).length,
      avg_time_to_fill: avg(list.flatMap((m) => m._journeys.filter((j) => j.joined && j.at[IDX.joined] && m.submission_date).map((j) => daysBetween(m.submission_date, istDay(j.at[IDX.joined]))))),
      proposed_annual_ctc: sum(list.map((m) => (['cancelled', 'rejected'].includes(m.status) ? 0 : (((m.ctc_annual_min ?? m.ctc_annual_max) || 0) + ((m.ctc_annual_max ?? m.ctc_annual_min) || 0)) / 2 * m.positions))),
      mrf_ids: list.map((m) => m.id),
    };
  }).sort((a, b) => b.mrfs - a.mrfs || a.name.localeCompare(b.name));
};

function comparisons(rows, allRows, f) {
  const byFy = groupRows(rows.filter((m) => m.submission_date), (m) => financialYear(m.submission_date), (m) => `FY ${financialYear(m.submission_date)}`).sort((a, b) => a.key.localeCompare(b.key));
  const months = new Map();
  const bump = (day, k, id) => { const mo = String(day || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(mo)) return; const o = months.get(mo) || months.set(mo, { month: mo, submitted: 0, cvs: 0, offers: 0, joined: 0, mrf_ids: [] }).get(mo); o[k]++; if (!o.mrf_ids.includes(id)) o.mrf_ids.push(id); };
  for (const m of rows) {
    bump(m.submission_date, 'submitted', m.id);
    for (const j of m._journeys) { bump(istDay(j.applied), 'cvs', m.id); bump(istDay(j.at[IDX.offer_released]), 'offers', m.id); if (j.joined) bump(istDay(j.at[IDX.joined]), 'joined', m.id); }
  }
  let periods = null;
  if (f.from && f.to && f.to >= f.from) {
    const len = daysBetween(f.from, f.to) + 1;
    const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const prev = { ...f, from: shift(f.from, -len), to: shift(f.from, -1) };
    const cur = kpisOf(rows), old = kpisOf(allRows.filter((m) => matchesFilters(m, prev)));
    periods = { current: { from: f.from, to: f.to }, previous: { from: prev.from, to: prev.to }, rows: cur.map((k, i) => ({ key: k.key, label: k.label, unit: k.unit || '', current: k.value, previous: old[i].value })) };
  }
  return { by_fy: byFy, by_month: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-24), periods };
}

/**
 * D = { reqs, cands, batches, interviews, emps } (utils/hiringMetrics loadHiringData).
 * opts = { filters, scope: { all } | { user_id, departments: [] }, sla, masters, today, now, userNames }
 */
export function computeMrfMis(D, opts = {}) {
  const f = opts.filters || {};
  const sla = { ...DEFAULT_SLA, ...(opts.sla || {}) };
  const now = opts.now ?? Date.now();
  const today = opts.today || new Date(now + IST).toISOString().slice(0, 10);
  const names = new Map(D.emps.map((e) => [e.user_id, e.display_name || e.full_name || '']));
  const empName = (uid) => (uid ? names.get(uid) || opts.userNames?.[uid] || '' : '');
  const group = (list, keyOf) => { const map = new Map(); for (const x of list) { const k = keyOf(x); if (!k) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(x); } return map; };
  const candReq = new Map(D.cands.map((c) => [c.id, reqKey(c)]));
  const ctx = { D, masters: opts.masters || {}, sla, today, now, empName, byReq: group(D.cands, reqKey), batchesBy: group(D.batches || [], (b) => b.requisition_id), interviewsBy: group(D.interviews || [], (i) => candReq.get(i.candidate_id)) };

  const scope = opts.scope || { all: true };
  const visible = D.reqs.filter((r) => scope.all || r.requested_by === scope.user_id || r.hiring_manager_id === scope.user_id || ((scope.departments || []).includes(r.department) && r.status !== 'draft'));
  const allRows = visible.map((r) => buildMrf(r, ctx));
  const rows = allRows.filter((m) => matchesFilters(m, f)).sort((a, b) => String(b.submission_date || b.created_date).localeCompare(String(a.submission_date || a.created_date)) || String(b.mrf_no).localeCompare(String(a.mrf_no)));

  const journeys = rows.flatMap((m) => m._journeys);
  const breaches = rows.flatMap((m) => m.breaches);
  const bottlenecks = Object.keys(SLA_LABELS).filter((k) => k !== 'approaching_days').map((rule) => {
    const items = breaches.filter((b) => b.rule === rule).sort((a, b) => b.days - a.days);
    return { rule, label: SLA_LABELS[rule], limit: sla[rule], count: items.length, items };
  }).filter((x) => x.count).sort((a, b) => b.count - a.count);

  const ageing = [['0–15 days', 0, 15], ['16–30 days', 16, 30], ['31–45 days', 31, 45], ['46–60 days', 46, 60], ['Over 60 days', 61, 99999]]
    .map(([name, lo, hi]) => { const list = rows.filter((m) => OPEN_MRF.includes(m.status) && m.days_elapsed !== null && m.days_elapsed >= lo && m.days_elapsed <= hi); return { name, value: list.length, mrf_ids: list.map((m) => m.id) }; });
  const gap = (a, b) => (a && b ? (ms(b) - ms(a)) / 86400000 : null);
  const bars = (keyOf, valueOf = (m) => m.positions, list = rows) => [...group(list, (m) => keyOf(m) || 'Not recorded').entries()].map(([name, l]) => ({ name, value: sum(l.map(valueOf)), mrf_ids: l.map((m) => m.id) })).sort((a, b) => b.value - a.value);
  const distinct = (keyOf, nameOf) => [...new Map(allRows.filter((m) => keyOf(m)).map((m) => [keyOf(m), nameOf(m) || keyOf(m)])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const reqIds = new Set(D.reqs.map((r) => r.id));
  const unlinked = scope.all ? D.cands.filter((c) => !reqIds.has(reqKey(c))) : [];
  const dupes = rows.flatMap((m) => m._dupes.map((d) => ({ ...d, mrf_id: m.id, mrf_no: m.mrf_no })));

  return {
    generated_at: new Date(now).toISOString(), today, sla,
    kpis: kpisOf(rows), funnel: funnelOf(journeys), bottlenecks,
    departments: groupRows(rows, (m) => m.department, (m) => m.department), recruiters: groupRows(rows, (m) => m.recruiter_id, (m) => m.recruiter || (m.recruiter_id ? m.recruiter_id : 'Not assigned')),
    budget: groupRows(rows, (m) => m.budget_status, (m) => m.budget_label),
    analytics: {
      by_department: bars((m) => m.department), by_tier: bars((m) => m.tier_label), by_type: bars((m) => m.type_label), ageing,
      pending_by_hiring_manager: bars((m) => m.hiring_manager, () => 1, rows.filter((m) => m.status === 'pending_hm_approval')),
      avg_jd_approval_days: avg(rows.map((m) => gap(m.times.submitted, m.times.approved))), avg_publication_days: avg(rows.map((m) => gap(m.times.approved, m.times.published))),
      target_vs_actual_days: (() => { const v = rows.filter((m) => ['completed_on_time', 'completed_late'].includes(m.sla_status) && m.target_date && m.closed_date).map((m) => daysBetween(m.target_date, m.closed_date)); return v.length ? round1(sum(v) / v.length) : null; })(),
    },
    comparisons: comparisons(rows, allRows, f),
    mrfs: rows.map(({ _journeys, _dupes, times, ...m }) => m),
    candidates: rows.flatMap((m) => m._journeys.map((j) => ({ id: j.id, name: j.name, mrf_id: m.id, mrf_no: m.mrf_no, designation: m.designation, status: j.status, status_label: j.status_label, reached: j.reached, active: j.active, joined: j.joined, applied: istDay(j.applied), since: istDay(j.since) }))),
    data_quality: { unlinked_candidates: unlinked.map((c) => ({ id: c.id, name: candName(c), status: c.status || 'applied', applied: istDay(c.applied_date || c._created) })).slice(0, 500), unlinked_count: unlinked.length, duplicates: dupes },
    options: {
      financial_years: [...new Set(allRows.map((m) => financialYear(m.submission_date || m.created_date)).filter(Boolean))].sort().reverse(),
      departments: distinct((m) => m.department, (m) => m.department), designations: distinct((m) => m.designation, (m) => m.designation), tiers: distinct((m) => m.tier, (m) => m.tier_label),
      recruiters: distinct((m) => m.recruiter_id, (m) => m.recruiter), hiring_managers: distinct((m) => m.hiring_manager_id, (m) => m.hiring_manager),
      budget_statuses: distinct((m) => m.budget_status, (m) => m.budget_label), requisition_types: distinct((m) => m.requisition_type, (m) => m.type_label),
      stages: MRF_STAGES.map(([value, label]) => ({ value, label })), sla_statuses: Object.entries(SLA_STATUS).map(([value, label]) => ({ value, label })),
    },
    stage_labels: CANDIDATE_STAGES.map(([key, label]) => ({ key, label })),
  };
}
