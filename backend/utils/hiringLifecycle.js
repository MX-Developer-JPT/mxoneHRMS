// Candidate lifecycle — one set of statuses and one set of transition rules for the Candidates page, Interview Management,
// Job Requisitions and Recruitment MIS. Statuses the older pipeline already used keep their names so old records stay valid.
//
//   Applied → Screening → Shortlisted by HR → CV Sent for Review (awaiting Manager/HOD, by email) → Interview Recommended
//   → Interview Scheduled → Interview Completed → Selected | Rejected | On Hold | Next Round → Offer → Joined
//
// Moving a candidate past a stage that is mandatory needs an authorised override (HR / admin, with a reason).

export const STATUSES = {
  applied:               { label: 'Applied', rank: 0, group: 'applied' },
  screening:             { label: 'Under Screening', rank: 1, group: 'screening' },
  shortlisted:           { label: 'Shortlisted by HR', rank: 2, group: 'shortlisted' },
  cv_sent:               { label: 'CV Sent for Review', rank: 3, group: 'cv_sent', hint: 'Awaiting Manager / HOD response' },
  interview_recommended: { label: 'Interview Recommended', rank: 4, group: 'recommended' },
  interview_scheduled:   { label: 'Interview Scheduled', rank: 5, group: 'interview' },
  interviewed:           { label: 'Interview Completed', rank: 6, group: 'interviewed' },
  interview_done:        { label: 'Interview Completed', rank: 6, group: 'interviewed' },   // older name for the same stage
  next_round_recommended:{ label: 'Next Round Recommended', rank: 6, group: 'recommended' },
  selected:              { label: 'Selected', rank: 7, group: 'selected' },
  offer_in_progress:     { label: 'Offer In Progress', rank: 8, group: 'offer' },
  offered:               { label: 'Offer Released', rank: 9, group: 'offer' },
  offer_accepted:        { label: 'Offer Accepted', rank: 10, group: 'offer' },
  joined:                { label: 'Joined', rank: 11, group: 'joined' },
  on_hold:               { label: 'On Hold', rank: -1, group: 'hold' },
  rejected:              { label: 'Rejected', rank: -1, group: 'closed' },
  offer_declined:        { label: 'Offer Declined', rank: -1, group: 'closed' },
  withdrawn:             { label: 'Candidate Withdrawn', rank: -1, group: 'closed' },
};
export const STATUS_KEYS = Object.keys(STATUSES);
export const statusLabel = (s) => STATUSES[s]?.label || String(s || 'applied').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// What a candidate may move to by hand. Moves marked "system" (CV sent, interview scheduled, selected from a scorecard, offers)
// are made by the workflow itself — the screens call those functions, they do not set the status directly.
const NEXT = {
  applied:               ['screening', 'shortlisted', 'rejected', 'on_hold', 'withdrawn'],
  screening:             ['applied', 'shortlisted', 'rejected', 'on_hold', 'withdrawn'],
  shortlisted:           ['screening', 'rejected', 'on_hold', 'withdrawn'],
  cv_sent:               ['shortlisted', 'interview_recommended', 'rejected', 'on_hold', 'withdrawn'],
  interview_recommended: ['shortlisted', 'rejected', 'on_hold', 'withdrawn'],
  interview_scheduled:   ['interview_recommended', 'rejected', 'on_hold', 'withdrawn'],
  interviewed:           ['selected', 'next_round_recommended', 'rejected', 'on_hold', 'withdrawn'],
  interview_done:        ['selected', 'next_round_recommended', 'rejected', 'on_hold', 'withdrawn'],
  next_round_recommended:['interview_scheduled', 'rejected', 'on_hold', 'withdrawn'],
  selected:              ['offer_in_progress', 'offered', 'rejected', 'on_hold', 'withdrawn'],
  offer_in_progress:     ['offered', 'rejected', 'withdrawn'],
  offered:               ['offer_accepted', 'offer_declined', 'withdrawn'],
  offer_accepted:        ['joined', 'offer_declined', 'withdrawn'],
  offer_declined:        ['offered', 'withdrawn'],
  on_hold:               ['screening', 'shortlisted', 'interview_recommended', 'rejected', 'withdrawn'],
  rejected:              [],
  withdrawn:             [],
  joined:                [],
};
// Moves only the workflow makes (HR cannot set them from the status dropdown).
const SYSTEM_ONLY = new Set(['cv_sent', 'interview_scheduled', 'interviewed', 'interview_recommended', 'next_round_recommended']);
// The older pipeline moved candidates straight to interview / selection: still allowed for a candidate with no requisition.
const LEGACY_EXTRA = { applied: ['interview_scheduled', 'selected', 'offered'], screening: ['interview_scheduled', 'selected', 'offered'], interview_scheduled: ['interviewed', 'selected'], interviewed: ['interview_scheduled'] };

const OVERRIDE_ROLES = ['hr', 'admin'];
const ACTIVE_ROLES = ['hr', 'admin', 'recruiter'];

/** Can this candidate move to `to`? opts: { role, override_reason, system } */
export function checkTransition(cand, to, opts = {}) {
  const from = cand.status || 'applied';
  if (!STATUSES[to]) return { ok: false, error: `Unknown status "${to}"` };
  if (to === from) return { ok: true, same: true };
  const hasReq = !!(cand.requisition_id || cand.job_id || cand.job_requisition_id);
  const allowed = new Set([...(NEXT[from] || []), ...(!hasReq ? (LEGACY_EXTRA[from] || []) : [])]);
  if (opts.system) {
    // the workflow itself: any forward step the lifecycle defines, plus the system-only ones
    if (allowed.has(to) || SYSTEM_ONLY.has(to)) return { ok: true };
  } else if (allowed.has(to) && (!SYSTEM_ONLY.has(to) || (!hasReq && LEGACY_EXTRA[from]?.includes(to)))) {
    if (!ACTIVE_ROLES.includes(opts.role) && opts.role !== 'management') return { ok: false, error: 'Only HR / recruiters can change a candidate\'s stage' };
    return { ok: true };
  }
  // an authorised override: HR or admin, with a reason on record
  if (OVERRIDE_ROLES.includes(opts.role) && String(opts.override_reason || '').trim().length >= 5) return { ok: true, override: true };
  const why = SYSTEM_ONLY.has(to) ? `"${statusLabel(to)}" is set by the workflow (${to === 'cv_sent' ? 'send a CV review request' : to === 'interview_scheduled' ? 'schedule the interview' : to === 'interviewed' ? 'record the interview feedback' : 'the Manager / HOD decision by email'}), not by hand` : `A candidate cannot go from "${statusLabel(from)}" to "${statusLabel(to)}" — the stages in between are mandatory`;
  return { ok: false, error: `${why}. ${OVERRIDE_ROLES.length ? 'HR or admin can override with a written reason.' : ''}`.trim(), needs_override: OVERRIDE_ROLES.includes(opts.role) };
}

export const allowedNext = (cand, role) => {
  const hasReq = !!(cand.requisition_id || cand.job_id || cand.job_requisition_id);
  const from = cand.status || 'applied';
  return [...new Set([...(NEXT[from] || []), ...(!hasReq ? (LEGACY_EXTRA[from] || []) : [])])].filter((s) => !SYSTEM_ONLY.has(s) || (!hasReq && LEGACY_EXTRA[from]?.includes(s)));
};

export const requisitionOf = (c) => c?.requisition_id || c?.job_requisition_id || c?.job_id || '';
const mailKey = (c) => { const e = String(c?.email || '').trim().toLowerCase(); return e.includes('@') ? e : ''; };
const phoneKey = (c) => { const d = String(c?.phone || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
/** The record (among `rows`) for the same person — same email or phone — on the same requisition, or null. */
export function samePersonOnRequisition(rows, cand) {
  const req = requisitionOf(cand), mail = mailKey(cand), phone = phoneKey(cand);
  if (!req || (!mail && !phone)) return null;
  return rows.find((c) => c.id !== cand.id && requisitionOf(c) === req && ((mail && mailKey(c) === mail) || (phone && phoneKey(c) === phone))) || null;
}

/** A new copy of the candidate's timeline with one event appended (never edited, never removed). */
export function appendTimeline(cand, evt) {
  const list = Array.isArray(cand.timeline) ? cand.timeline : [];
  const e = { at: new Date().toISOString(), type: 'note', ...evt };
  return [...list, e].slice(-500);
}

/** Business days between two dates (inclusive of the start, exclusive of the end), skipping weekly offs and holidays. */
export function businessDays(from, to, { weeklyOff = [0], holidays = [] } = {}) {
  const a = Date.parse(String(from).slice(0, 10)), b = Date.parse(String(to).slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const hol = new Set(holidays.map((h) => String(h).slice(0, 10)));
  let n = 0;
  for (let t = a; t < b; t += 86400000) { const d = new Date(t); if (!weeklyOff.includes(d.getUTCDay()) && !hol.has(d.toISOString().slice(0, 10))) n++; }
  return n;
}
export const calendarDays = (from, to) => {
  const a = Date.parse(String(from).slice(0, 10)), b = Date.parse(String(to).slice(0, 10));
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) : null;
};

export const DEFAULT_ROUNDS = [
  { key: 'hr_screening', label: 'HR Screening', active: true }, { key: 'technical', label: 'Technical Round', active: true },
  { key: 'functional', label: 'Functional Round', active: true }, { key: 'managerial', label: 'Managerial Round', active: true },
  { key: 'hod', label: 'HOD Round', active: true }, { key: 'final_management', label: 'Final Management Round', active: true },
  { key: 'hr_discussion', label: 'HR Discussion', active: true },
];
export const FEEDBACK_CRITERIA = [
  ['technical', 'Technical / Functional Competency'], ['communication', 'Communication Skills'], ['experience', 'Relevant Experience'],
  ['problem_solving', 'Problem-Solving Ability'], ['culture', 'Cultural / Role Alignment'],
];
export const DEFAULT_NOTIFY = {
  cv_review_sent: { hiring_manager: true, hod: true, recruiter: true }, cv_batch_added: { hiring_manager: true, hod: true, recruiter: false },
  review_pending: { hiring_manager: true, hod: true, recruiter: true }, review_decided: { recruiter: true, hr: false },
  interview_scheduled: { candidate: true, interviewer: true, recruiter: true }, interview_changed: { candidate: true, interviewer: true, recruiter: true },
  feedback_pending: { interviewer: true, recruiter: true }, candidate_selected: { recruiter: true, hiring_manager: true, hr: true },
  candidate_rejected: { recruiter: true }, offer_released: { recruiter: true, hiring_manager: true }, candidate_joined: { recruiter: true, hiring_manager: true, hr: true },
};
