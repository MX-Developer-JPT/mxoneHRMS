import { base44 } from '@/api/base44Client';

// Candidate lifecycle on the screen — mirrors backend/utils/hiringLifecycle.js (the server enforces it; this only shapes the menus).
export const STATUS = {
  applied: { label: 'Applied', cls: 'bg-blue-100 text-blue-800' },
  screening: { label: 'Under Screening', cls: 'bg-yellow-100 text-yellow-800' },
  shortlisted: { label: 'Shortlisted by HR', cls: 'bg-indigo-100 text-indigo-800' },
  cv_sent: { label: 'CV Sent for Review', cls: 'bg-sky-100 text-sky-800' },
  interview_recommended: { label: 'Interview Recommended', cls: 'bg-violet-100 text-violet-800' },
  interview_scheduled: { label: 'Interview Scheduled', cls: 'bg-purple-100 text-purple-800' },
  interviewed: { label: 'Interview Completed', cls: 'bg-orange-100 text-orange-800' },
  interview_done: { label: 'Interview Completed', cls: 'bg-orange-100 text-orange-800' },
  next_round_recommended: { label: 'Next Round Recommended', cls: 'bg-fuchsia-100 text-fuchsia-800' },
  selected: { label: 'Selected', cls: 'bg-green-100 text-green-800' },
  offer_in_progress: { label: 'Offer In Progress', cls: 'bg-cyan-100 text-cyan-800' },
  offered: { label: 'Offer Released', cls: 'bg-teal-100 text-teal-800' },
  offer_accepted: { label: 'Offer Accepted', cls: 'bg-emerald-100 text-emerald-800' },
  joined: { label: 'Joined', cls: 'bg-green-200 text-green-900' },
  on_hold: { label: 'On Hold', cls: 'bg-amber-100 text-amber-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
  offer_declined: { label: 'Offer Declined', cls: 'bg-rose-100 text-rose-800' },
  withdrawn: { label: 'Candidate Withdrawn', cls: 'bg-gray-200 text-gray-700' },
};
export const statusLabel = (s) => STATUS[s]?.label || String(s || 'applied').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const statusCls = (s) => STATUS[s]?.cls || 'bg-gray-100 text-gray-700';

const NEXT = {
  applied: ['screening', 'shortlisted', 'rejected', 'on_hold', 'withdrawn'], screening: ['applied', 'shortlisted', 'rejected', 'on_hold', 'withdrawn'], shortlisted: ['screening', 'rejected', 'on_hold', 'withdrawn'],
  cv_sent: ['shortlisted', 'rejected', 'on_hold', 'withdrawn'], interview_recommended: ['shortlisted', 'rejected', 'on_hold', 'withdrawn'], interview_scheduled: ['rejected', 'on_hold', 'withdrawn'],
  interviewed: ['selected', 'rejected', 'on_hold', 'withdrawn'], interview_done: ['selected', 'rejected', 'on_hold', 'withdrawn'], next_round_recommended: ['rejected', 'on_hold', 'withdrawn'],
  selected: ['offer_in_progress', 'offered', 'rejected', 'on_hold', 'withdrawn'], offer_in_progress: ['offered', 'rejected', 'withdrawn'], offered: ['offer_accepted', 'offer_declined', 'withdrawn'],
  offer_accepted: ['joined', 'offer_declined', 'withdrawn'], offer_declined: ['offered', 'withdrawn'], on_hold: ['screening', 'shortlisted', 'rejected', 'withdrawn'], rejected: [], withdrawn: [], joined: [],
};
const LEGACY_EXTRA = { applied: ['interview_scheduled', 'selected', 'offered'], screening: ['interview_scheduled', 'selected', 'offered'], interview_scheduled: ['interviewed', 'selected'], interviewed: ['interview_scheduled'] };
/** Stages HR can pick by hand for this candidate (the workflow sets the others: CV sent, interview recommended / scheduled, completed). */
export const manualNext = (c) => {
  const from = c?.status || 'applied';
  const hasReq = !!(c?.requisition_id || c?.job_id || c?.job_requisition_id);
  return [...new Set([...(NEXT[from] || []), ...(!hasReq ? (LEGACY_EXTRA[from] || []) : [])])];
};

export const BOARD_STAGES = [
  { key: 'applied', label: 'Applied', color: 'border-blue-200 bg-blue-50' }, { key: 'screening', label: 'Screening', color: 'border-yellow-200 bg-yellow-50' },
  { key: 'shortlisted', label: 'Shortlisted', color: 'border-indigo-200 bg-indigo-50' }, { key: 'cv_sent', label: 'CV Sent', color: 'border-sky-200 bg-sky-50' },
  { key: 'interview_recommended', label: 'Recommended', color: 'border-violet-200 bg-violet-50' }, { key: 'interview_scheduled', label: 'Interview Sched.', color: 'border-purple-200 bg-purple-50' },
  { key: 'interviewed', label: 'Interviewed', color: 'border-orange-200 bg-orange-50' }, { key: 'selected', label: 'Selected', color: 'border-green-200 bg-green-50' },
  { key: 'offered', label: 'Offered', color: 'border-teal-200 bg-teal-50' }, { key: 'offer_accepted', label: 'Accepted', color: 'border-emerald-200 bg-emerald-50' },
  { key: 'joined', label: 'Joined', color: 'border-green-300 bg-green-100' }, { key: 'on_hold', label: 'On Hold', color: 'border-amber-200 bg-amber-50' },
];

export async function rh(name, params = {}) {
  const r = await base44.functions.invoke(name, params);
  const d = r?.data || r;
  if (d && d.success === false) { const e = new Error(d.error || 'Something went wrong'); e.data = d; throw e; }
  return d;
}
// Older requisitions are identified by a long system id — only real MRF numbers are shown to people.
export const mrfId = (id) => (/^MRF-/i.test(String(id || '')) ? id : '');
export const fmtDT = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); } catch { return iso || ''; } };
export const fmtD = (iso) => { try { return iso ? new Date(String(iso).length === 10 ? iso + 'T00:00:00+05:30' : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—'; } catch { return iso || ''; } };
export const DECISION = { shortlist: ['Shortlisted', 'text-green-700 bg-green-50'], reject: ['Rejected', 'text-red-700 bg-red-50'], hold: ['On hold', 'text-amber-700 bg-amber-50'], more_info: ['More information requested', 'text-blue-700 bg-blue-50'] };
