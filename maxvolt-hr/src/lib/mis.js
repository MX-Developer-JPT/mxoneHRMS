import { base44 } from '@/api/base44Client';

/** Calls an Intelligent-MIS back-end function; throws with the server's message when it refuses or fails. */
export async function mis(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) { const e = new Error(d.error || 'Request failed'); e.retrievalFailed = !!d.retrievalFailed; throw e; }
  return d;
}

export function downloadBase64(b64, filename, mime = 'application/octet-stream') {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const fmtD = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return dd ? `${dd}-${m}-${y}` : String(d); };
export const fmtDT = (v) => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); };
export const num = (v) => (v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : v);
export const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

export const SEV_CLS = {
  Critical: 'bg-red-100 text-red-800 border-red-300',
  High: 'bg-orange-100 text-orange-800 border-orange-300',
  Medium: 'bg-amber-100 text-amber-800 border-amber-300',
  Low: 'bg-gray-100 text-gray-700 border-gray-300',
  Informational: 'bg-blue-100 text-blue-800 border-blue-300',
  OK: 'bg-green-100 text-green-800 border-green-300',
};

export const PERIODS = [
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' }, { id: 'ytd', label: 'Year to date' }, { id: 'custom', label: 'Custom range' },
];
export const COMPARES = [
  { id: 'previous', label: 'Previous period' }, { id: 'last_year', label: 'Same period last year' },
  { id: 'custom', label: 'Custom period' }, { id: 'none', label: 'No comparison' },
];
