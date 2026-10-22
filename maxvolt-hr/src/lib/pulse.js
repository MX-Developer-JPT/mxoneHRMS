import { base44 } from '@/api/base44Client';

/** Calls a survey (ps_*) back-end function; throws with the server's message when it refuses. */
export async function ps(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) { const e = new Error(d.error || 'Request failed'); e.errors = d.errors; throw e; }
  return d;
}

export const Q_TYPES = [
  { value: 'rating', label: 'Rating 1–5', hint: 'Employees pick 1–5 · gives an average' },
  { value: 'nps', label: 'NPS 0–10', hint: 'Likelihood to recommend · gives the eNPS' },
  { value: 'single', label: 'Single choice', hint: 'Pick one of your options' },
  { value: 'multi', label: 'Multiple choice', hint: 'Pick any of your options' },
  { value: 'yesno', label: 'Yes / No', hint: 'A simple yes or no' },
  { value: 'text', label: 'Comment', hint: 'Free-text answer' },
];
export const typeLabel = (t) => Q_TYPES.find(x => x.value === t)?.label || t;

/** File → base64 (no data: prefix) for the import endpoint. */
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(file);
});

export function saveBase64File(base64, filename, mime) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fmtDate = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d).slice(0, 10) : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
export const fmtDateTime = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
