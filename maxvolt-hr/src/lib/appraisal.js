import { base44 } from '@/api/base44Client';
export { saveBase64File, fmtDate, fmtDateTime } from '@/lib/pulse';

/** Calls an appraisal (ap_*) back-end function; throws with the server's message when it refuses. */
export async function ap(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) { const e = new Error(d.error || 'Request failed'); e.errors = d.errors; throw e; }
  return d;
}

export const STATUS_TONE = {
  not_started: 'bg-slate-100 text-slate-700', self_assessment_pending: 'bg-amber-50 text-amber-800', self_assessment_draft: 'bg-amber-50 text-amber-800',
  manager_review_pending: 'bg-blue-50 text-blue-800', manager_review_draft: 'bg-blue-50 text-blue-800', meeting_pending: 'bg-indigo-50 text-indigo-800', meeting_scheduled: 'bg-indigo-50 text-indigo-800',
  hr_review_pending: 'bg-purple-50 text-purple-800', returned_for_correction: 'bg-red-50 text-red-700', approved: 'bg-emerald-50 text-emerald-800', published: 'bg-green-100 text-green-800', closed: 'bg-slate-200 text-slate-700',
};
export const CYCLE_TONE = { draft: 'bg-slate-100 text-slate-700', configured: 'bg-slate-100 text-slate-700', published: 'bg-blue-50 text-blue-800', in_progress: 'bg-amber-50 text-amber-800', under_hr_review: 'bg-purple-50 text-purple-800', finalised: 'bg-emerald-50 text-emerald-800', closed: 'bg-slate-200 text-slate-700', archived: 'bg-slate-100 text-slate-500' };
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
export const flat = (items) => (items || []).flatMap(k => (k.kpis || []).map(p => ({ ...p, kra: k.title, kra_id: k.id })));
export const MEETING_MODES = [['in_person', 'In person'], ['teams', 'Microsoft Teams'], ['google_meet', 'Google Meet'], ['online', 'Other online']];
export const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500';
export const confirmReason = (msg) => { const r = window.prompt(msg); return r && r.trim() ? r.trim() : null; };
