import { base44 } from '@/api/base44Client';

/** Calls an L&D back-end function; throws with the server's message when it refuses. */
export async function ld(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) throw new Error(d.error || 'Request failed');
  return d;
}

export const GATE_STATUS = {
  LOCKED:       { label: 'Locked',        cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  READY:        { label: 'Ready',         cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  IN_PROGRESS:  { label: 'In progress',   cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  SUBMITTED:    { label: 'Awaiting sign-off', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  UNDER_REVIEW: { label: 'Under review',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PASSED:       { label: 'Passed',        cls: 'bg-green-50 text-green-700 border-green-200' },
  FAILED:       { label: 'Failed',        cls: 'bg-red-50 text-red-700 border-red-200' },
  BLOCKED:      { label: 'Blocked',       cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  OVERDUE:      { label: 'Overdue',       cls: 'bg-red-50 text-red-700 border-red-300' },
  WAIVED:       { label: 'Waived',        cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  CANCELLED:    { label: 'Cancelled',     cls: 'bg-gray-100 text-gray-400 border-gray-200' },
};

export const ROLE_LABEL = { hr: 'HR', trainer: 'Trainer', manager: 'Reporting Manager', hod: 'HOD', ld: 'L&D', hr_spoc: 'HR SPOC' };
export const STAGES = ['LEARN', 'OBSERVE', 'PRACTISE', 'PERFORM', 'IMPROVE'];

export const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : String(d);
};
export const fmtDateTime = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
};

export function downloadBase64(base64, filename, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(columns, rows, filename) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [columns.map(c => esc(c.label)).join(','), ...rows.map(r => columns.map(c => esc(r[c.key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** Opens a protected learning file (induction deck / guide) — fetched with the user's login. */
export async function openContent(key) {
  const token = localStorage.getItem('base44_access_token');
  const res = await fetch(`/api/ld-content/${key}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Could not open the file');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = key; a.click(); }
}

export function printHtmlTable(title, columns, rows) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  w.document.write(`<html><head><title>${esc(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;padding:24px}h1{font-size:18px;color:#1a3c5e}table{border-collapse:collapse;width:100%;font-size:11px}th{background:#2d5986;color:#fff;padding:6px;text-align:left}td{border:1px solid #ddd;padding:5px}tr:nth-child(even) td{background:#f8fafc}</style></head><body><h1>Maxvolt Energy — ${esc(title)}</h1><table><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
