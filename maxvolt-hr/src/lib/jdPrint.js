import { buildLetterheadHtml } from '@/utils/letterhead';
import { toast } from 'sonner';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEAD = /^[A-Z0-9 /&()'’.,-]{3,60}$/;
const META_KEYS = ['JOB TITLE', 'DEPARTMENT', 'POSITION TIER', 'JOB LOCATION', 'EMPLOYMENT TYPE', 'EXPERIENCE REQUIRED', 'COMPENSATION RANGE'];

/** Splits the plain-text JD into { head, lines[] } sections. */
export function parseJd(text) {
  return String(text || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const [first, ...rest] = b.split('\n');
    if (HEAD.test(first.trim()) && first.trim() === first.trim().toUpperCase()) return { head: first.trim(), lines: rest.map((l) => l.trim()).filter(Boolean) };
    return { head: '', lines: b.split('\n').map((l) => l.trim()).filter(Boolean) };
  });
}

/** The printable JD body: title, a details strip, then the sections — same look as the company's earlier printed JDs. */
export function jdBodyHtml(rec, text) {
  const sections = parseJd(text);
  const meta = {}; const body = [];
  for (const s of sections) { if (META_KEYS.includes(s.head)) meta[s.head] = s.lines.join(' '); else body.push(s); }
  const title = meta['JOB TITLE'] || rec?.designation || 'Job Description';
  const strip = [['Department', meta['DEPARTMENT']], ['Position tier', meta['POSITION TIER']], ['Employment', meta['EMPLOYMENT TYPE']], ['Experience', meta['EXPERIENCE REQUIRED']], ['Location', meta['JOB LOCATION']], ['Vacancies', rec?.number_of_positions], ['Compensation', meta['COMPENSATION RANGE']]]
    .filter(([, v]) => v);
  const sec = (s) => {
    const bullets = s.lines.filter((l) => l.startsWith('•')); const prose = s.lines.filter((l) => !l.startsWith('•'));
    return `<div style="margin:0 0 11px;break-inside:avoid;">
      ${s.head ? `<h3 style="font-size:11.5px;letter-spacing:.6px;margin:0 0 4px;padding:3px 0 3px 8px;border-left:3px solid #fcd116;background:#fafafa;color:#111;">${esc(s.head)}</h3>` : ''}
      ${prose.map((l) => `<p style="font-size:11px;line-height:1.55;margin:0 0 4px;">${esc(l)}</p>`).join('')}
      ${bullets.length ? `<ul style="font-size:11px;line-height:1.55;margin:2px 0 0;padding-left:18px;">${bullets.map((l) => `<li style="margin-bottom:2px;">${esc(l.replace(/^•\s*/, ''))}</li>`).join('')}</ul>` : ''}
    </div>`;
  };
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  return `
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;margin-bottom:6px;"><span>${esc(rec?.requisition_id || '')}</span><span>${date} · Human Resources</span></div>
    <h1 style="font-size:21px;margin:0 0 8px;color:#111;">${esc(title)}</h1>
    <div style="display:flex;flex-wrap:wrap;gap:6px 18px;padding:8px 11px;background:#fffbe6;border-left:3px solid #fcd116;margin-bottom:14px;">
      ${strip.map(([k, v]) => `<span style="font-size:10.5px;color:#333;"><strong>${esc(k)}:</strong> ${esc(v)}</span>`).join('')}
    </div>
    ${body.map(sec).join('')}
    <div style="margin-top:16px;font-size:9.5px;color:#777;border-top:1px solid #e5e5e5;padding-top:6px;">This job description is issued for recruitment purposes by Maxvolt Energy Industries Limited.</div>`;
}

/** Opens the JD on the company letterhead (or without it, for pre-printed paper) ready to print / save as PDF. */
export function printJd(rec, text, { letterhead = true } = {}) {
  const t = String(text || '').trim();
  if (!t) { toast.error('There is no Job Description to print yet.'); return; }
  const win = window.open('', '_blank', 'width=900,height=720');
  if (!win) { toast.error('The browser blocked the print window — allow pop-ups for this site and try again.'); return; }
  win.document.write(buildLetterheadHtml(`Job Description - ${rec?.designation || ''}`, jdBodyHtml(rec, t), '', { letterhead }));
  win.document.close();
}
