import { base44 } from '@/api/base44Client';

/** Calls a manpower-requisition (mrf_*) back-end function; throws with the server's message when it refuses. */
export async function mrf(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) { const e = new Error(d.error || 'Request failed'); e.errors = d.errors; throw e; }
  return d;
}

export const STATUS = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-700' },
  pending_hm_approval: { label: 'Pending Hiring Manager approval', cls: 'bg-yellow-100 text-yellow-800' },
  changes_requested: { label: 'Changes requested', cls: 'bg-orange-100 text-orange-800' },
  pending_hr_publication: { label: 'Pending HR publication', cls: 'bg-blue-100 text-blue-800' },
  published: { label: 'Published', cls: 'bg-green-100 text-green-800' },
  on_hold: { label: 'On hold', cls: 'bg-amber-100 text-amber-800' },
  closed: { label: 'Closed', cls: 'bg-gray-200 text-gray-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-100 text-red-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
};
export const statusOf = (r) => (r.status === 'closed' && r.closed_reason === 'filled' ? { label: 'Filled', cls: 'bg-emerald-100 text-emerald-800' } : STATUS[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-700' });
export const PRIORITY_CLS = { critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-600' };

// The five visible stages of the workflow, for the progress indicator.
export const STAGES = [['draft', 'Draft'], ['pending_hm_approval', 'JD approval'], ['pending_hr_publication', 'HR publication'], ['published', 'Published'], ['closed', 'Filled / closed']];
export const stageIndex = (status) => ({ draft: 0, changes_requested: 0, pending_hm_approval: 1, pending_hr_publication: 2, published: 3, on_hold: 3, closed: 4, cancelled: 4, rejected: 4 }[status] ?? 0);

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Recommended 15-45 day hiring window — advice only; the form never blocks on it. */
export function timelineHint(baseYmd, targetYmd, minDays = 15, maxDays = 45) {
  const win = { from: addDays(baseYmd, minDays), to: addDays(baseYmd, maxDays) };
  if (!targetYmd) return { ...win, state: 'none', message: `Recommended hiring window: ${win.from} to ${win.to} (${minDays}–${maxDays} days from approval).` };
  const days = Math.round((Date.parse(`${targetYmd}T00:00:00Z`) - Date.parse(`${baseYmd}T00:00:00Z`)) / 86400000);
  if (days < minDays) return { ...win, days, state: 'aggressive', message: `${days} day(s) away — an aggressive timeline (recommended ${minDays}–${maxDays} days). You can still submit; add a justification if it is urgent.` };
  if (days > maxDays) return { ...win, days, state: 'extended', message: `${days} days away — longer than the usual ${maxDays}-day window. Consider whether the timeline can be shortened.` };
  return { ...win, days, state: 'ideal', message: `Within the recommended ${minDays}–${maxDays}-day hiring window.` };
}
export const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const fmt = (iso, withTime = false) => {
  if (!iso) return '—';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}) });
};
export const labelOf = (masters, kind, value) => (masters?.[kind] || []).find((m) => m.value === value)?.label || value || '';
