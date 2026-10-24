// Salary revision (PF rules change) — pure helpers: read the HR sheet, do the
// CTC maths, and build the per-employee letter / email. No DB or HTTP here so
// it can be unit-tested; routes/salaryRevision.js does the I/O.
import XLSX from 'xlsx';
import officeCrypto from 'officecrypto-tool';

// One entry per CTC column in the sheet (all MONTHLY ₹). `head` is the sheet header.
export const COMPONENTS = [
  { key: 'basic',     head: 'BASIC SALARY',      label: 'Basic Salary' },
  { key: 'hra',       head: 'HRA',               label: 'House Rent Allowance (HRA)' },
  { key: 'conveyance',head: 'CONVEYANCE',        label: 'Conveyance Allowance' },
  { key: 'pf',        head: 'PROVIDENT FUND',    label: 'Provident Fund (PF) contribution' },
  { key: 'medical',   head: 'MEDICAL INSURANCE', label: 'Medical Insurance' },
  { key: 'admin',     head: 'ADMIN_CHARGE',      label: 'PF Administration Charges' },
  { key: 'vpp',       head: 'VPP',               label: 'Variable Pay (VPP)' },
  { key: 'ctc_bonus', head: 'CTC_BONUS',         label: 'CTC Bonus' },
  { key: 'esi',       head: 'ESI_EMPLOYER',      label: 'ESI (Employer)' },
  { key: 'car_lease', head: 'CAR_LEASE',         label: 'Car Lease' },
  { key: 'car_maint', head: 'CAR_MAINT',         label: 'Car Fuel & Maintenance' },
  { key: 'gym',       head: 'GYM',               label: 'Health & Wellness' },
  { key: 'hard_fur',  head: 'HARD_FUR',          label: 'Hard Furnishing' },
];
const TOTAL_HEAD = 'TOTAL_CTC';

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? r2(n) : 0; };
const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export function fmtInr(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Sum of the component columns (what the sheet's Total_CTC should equal). */
export function sumComponents(vals) {
  return r2(COMPONENTS.reduce((s, c) => s + (vals[c.key] || 0), 0));
}

/**
 * Read the HR workbook. `password` is optional (the sheet HR shares is
 * password-protected). Returns { sheet, rows } where each row is
 * { code, name, department, designation, previous:{…,total}, revised:{…,total} }.
 * Never logs or keeps the password.
 */
export async function parseRevisionWorkbook(buffer, password) {
  let buf = buffer;
  if (officeCrypto.isEncrypted(buf)) {
    if (!password) { const e = new Error('This file is password protected — enter its password.'); e.code = 'PASSWORD_REQUIRED'; throw e; }
    try { buf = await officeCrypto.decrypt(buf, { password }); }
    catch { const e = new Error('Wrong password for this file.'); e.code = 'PASSWORD_WRONG'; throw e; }
  }
  const wb = XLSX.read(buf, { type: 'buffer' });
  for (const sheet of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
    const hi = grid.findIndex(r => r.some(c => norm(c) === 'CODE') && r.some(c => norm(c) === 'NAME'));
    if (hi < 0) continue;
    const head = grid[hi].map(norm);
    const starts = head.map((h, i) => (h === 'BASIC SALARY' ? i : -1)).filter(i => i >= 0);
    if (starts.length < 2) continue; // need the "current" block and the "revised" block
    const col = (n) => head.indexOf(n);
    const readBlock = (r, start, end) => {
      const out = {};
      for (const c of COMPONENTS) {
        let idx = -1;
        for (let i = start; i < end; i++) if (head[i] === c.head) { idx = i; break; }
        out[c.key] = idx < 0 ? 0 : num(r[idx]);
      }
      let ti = -1;
      for (let i = start; i < end; i++) if (head[i] === TOTAL_HEAD) { ti = i; break; }
      out.total = ti < 0 ? sumComponents(out) : num(r[ti]);
      return out;
    };
    const rows = [];
    for (let i = hi + 1; i < grid.length; i++) {
      const r = grid[i];
      const code = String(r[col('CODE')] ?? '').trim();
      if (!code) continue;
      rows.push({
        sheet_row: i + 1,
        code,
        name: String(r[col('NAME')] ?? '').trim().replace(/\s+/g, ' '),
        department: String(r[col('DEPARTMENT')] ?? '').trim(),
        designation: String(r[col('DESIGNATION')] ?? '').trim(),
        previous: readBlock(r, starts[0], starts[1]),
        revised: readBlock(r, starts[1], head.length),
      });
    }
    if (rows.length) return { sheet, rows };
  }
  throw new Error('Could not find the "current" and "revised" CTC columns (two BASIC SALARY blocks with Code/Name) in this file.');
}

/** Per-component differences + status flags for one row. */
export function computeDiff(previous, revised) {
  const diff = {};
  for (const c of COMPONENTS) diff[c.key] = r2((revised[c.key] || 0) - (previous[c.key] || 0));
  diff.total = r2((revised.total || 0) - (previous.total || 0));
  const changed = COMPONENTS.filter(c => Math.abs(diff[c.key]) >= 0.005).map(c => c.key);
  return { diff, changed, unchanged: changed.length === 0 && Math.abs(diff.total) < 0.005 };
}

/** Warnings about the sheet row itself (not the employee match). */
export function rowWarnings(row) {
  const w = [];
  for (const [k, v] of [['previous', row.previous], ['revised', row.revised]]) {
    const s = sumComponents(v);
    if (Math.abs(s - v.total) > 1) w.push(`${k === 'previous' ? 'Current' : 'Revised'} components add up to ${fmtInr(s)} but the sheet total says ${fmtInr(v.total)}`);
  }
  return w;
}

function nameTokens(s) { return norm(s).replace(/\(.*?\)/g, '').split(' ').filter(t => t.length > 1); }
/** Loose check that the sheet name and the employee record are the same person. */
export function namesAgree(a, b) {
  const A = nameTokens(a), B = new Set(nameTokens(b));
  if (!A.length || !B.size) return true;
  return A.some(t => B.has(t));
}

/** Pick the Employee record for a code. `cands` = [{status, email, hasStructure, …}] */
export function pickEmployee(cands) {
  if (!cands.length) return { pick: null, duplicate: false };
  const score = (c) => (c.status === 'active' ? 4 : 0) + (/@maxvoltenergy\.com$/i.test(c.email || '') ? 2 : 0) + (c.hasStructure ? 1 : 0);
  const sorted = [...cands].sort((a, b) => score(b) - score(a));
  return { pick: sorted[0], duplicate: cands.length > 1, ambiguous: cands.length > 1 && score(sorted[0]) === score(sorted[1]) };
}

/* ───────────────────────── letter + email text ───────────────────────── */

export const DEFAULT_REASON =
  'Following the change in the Provident Fund (PF) rules, the PF wage basis on which contributions are calculated has been revised, ' +
  'and your CTC has been updated accordingly.';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso || '');
}

export function letterRef(code, letterDate) {
  return `MEIL/HR/PFREV/${String(letterDate || '').slice(0, 4) || new Date().getFullYear()}/${code}`;
}

/** Plain facts used by both the letter and the email. */
export function impactFacts(previous, revised, opts = {}) {
  const { diff, changed } = computeDiff(previous, revised);
  // PF wage = the basic when PF is exactly 12% of it (within rounding), else back-solved from the PF amount
  const pfWage = (v) => (v.pf > 0 ? (Math.abs(v.basic * 0.12 - v.pf) < 1 ? Math.round(v.basic) : Math.round(v.pf / 0.12)) : 0);
  const lines = [];
  if (Math.abs(diff.pf) >= 0.005) {
    const pw0 = pfWage(previous), pw1 = pfWage(revised);
    lines.push(
      `Your PF contribution changes from ${fmtInr(previous.pf)} to ${fmtInr(revised.pf)} per month (${diff.pf > 0 ? '+' : '−'}${fmtInr(Math.abs(diff.pf))})` +
      (pw1 > 0 ? `, calculated at 12% of a PF wage of ${fmtInr(pw1)}${pw0 > 0 ? ` (earlier ${fmtInr(pw0)})` : ' (earlier no PF contribution was included in your CTC)'}.` : '.'));
  }
  if (Math.abs(diff.admin) >= 0.005) lines.push(`PF administration charges, borne by the Company, change from ${fmtInr(previous.admin)} to ${fmtInr(revised.admin)} per month.`);
  const others = changed.filter(k => k !== 'pf' && k !== 'admin').map(k => COMPONENTS.find(c => c.key === k));
  for (const c of others) lines.push(`${c.label} changes from ${fmtInr(previous[c.key])} to ${fmtInr(revised[c.key])} per month.`);
  lines.push(
    `Your total monthly CTC changes from ${fmtInr(previous.total)} to ${fmtInr(revised.total)} (${diff.total >= 0 ? '+' : '−'}${fmtInr(Math.abs(diff.total))}); ` +
    `annually, from ${fmtInr(r2(previous.total * 12))} to ${fmtInr(r2(revised.total * 12))}.`);
  if (opts.includeTakeHome !== false && diff.pf > 0.005) {
    lines.push(
      `Your own PF contribution (12%) deducted from salary rises accordingly, so your monthly take-home pay will reduce by approximately ${fmtInr(diff.pf)} ` +
      `(before other statutory deductions). The additional amount is credited to your PF account and adds to your retirement savings.`);
  }
  const same = COMPONENTS.filter(c => !changed.includes(c.key) && (revised[c.key] || 0) > 0).map(c => c.label);
  return { diff, changed, lines, same };
}

/** pdfmake document definition for one employee's letter. */
export function buildLetterDocDef({ emp, previous, revised, batch, assets }) {
  const facts = impactFacts(previous, revised, { includeTakeHome: batch.include_take_home });
  const reason = (batch.reason_text || DEFAULT_REASON).trim();
  const eff = longDate(batch.effective_date);
  const sym = (d) => (d > 0 ? '+' : d < 0 ? '−' : '');
  const cell = (t, o = {}) => ({ text: t, fontSize: 9, ...o });
  const rows = COMPONENTS.filter(c => (previous[c.key] || 0) > 0 || (revised[c.key] || 0) > 0).map(c => {
    const d = facts.diff[c.key];
    const hl = Math.abs(d) >= 0.005;
    return [
      cell(c.label, hl ? { bold: true } : {}),
      cell(fmtInr(previous[c.key]), { alignment: 'right' }),
      cell(fmtInr(revised[c.key]), { alignment: 'right', bold: hl }),
      cell(hl ? `${sym(d)}${fmtInr(Math.abs(d))}` : '—', { alignment: 'right', bold: hl }),
    ];
  });
  const tot = (label, a, b, mult) => [
    cell(label, { bold: true, fillColor: '#f1f5f9' }),
    cell(fmtInr(r2(a * mult)), { alignment: 'right', bold: true, fillColor: '#f1f5f9' }),
    cell(fmtInr(r2(b * mult)), { alignment: 'right', bold: true, fillColor: '#f1f5f9' }),
    cell(`${sym(r2((b - a) * mult))}${fmtInr(Math.abs(r2((b - a) * mult)))}`, { alignment: 'right', bold: true, fillColor: '#f1f5f9' }),
  ];
  const head = ['Component (per month)', 'Previous', 'Revised', 'Change'].map((t, i) => cell(t, { bold: true, color: '#ffffff', fillColor: '#334155', alignment: i ? 'right' : 'left' }));

  const P = (text, extra = {}) => ({ text, margin: [0, 0, 0, 5], alignment: 'justify', ...extra });
  const signoff = [
    { text: 'For Maxvolt Energy Industries Limited', bold: true, margin: [0, 8, 0, 0] },
    { text: batch.signatory || 'Human Resources', margin: [0, 0, 0, 0] },
  ];
  if (assets.stamp) signoff.push({ image: 'stamp', width: 100, margin: [0, -55, 0, -60], opacity: 0.85 });

  const content = [
    { columns: [{ text: `Ref: ${letterRef(emp.code, batch.letter_date)}`, fontSize: 9.5 }, { text: `Date: ${longDate(batch.letter_date)}`, fontSize: 9.5, alignment: 'right' }], margin: [0, 0, 0, 10] },
    { text: 'To,', margin: [0, 0, 0, 2] },
    { text: [{ text: emp.name, bold: true }, `  (Employee Code: ${emp.code})`] },
    { text: `${emp.designation || ''}${emp.department ? ` — ${emp.department}` : ''}`, margin: [0, 0, 0, 8] },
    { text: `Subject: Revision of your CTC structure due to change in PF rules — effective ${eff}`, bold: true, margin: [0, 0, 0, 6] },
    P(`Dear ${emp.name},`),
    { text: 'Reason for the revision', bold: true, margin: [0, 0, 0, 2] },
    P(reason),
    { text: 'Impact on you', bold: true, margin: [0, 0, 0, 2] },
    { ul: facts.lines.map(t => ({ text: t, alignment: 'justify' })), margin: [8, 0, 0, 5] },
    { text: 'Previous vs revised CTC', bold: true, margin: [0, 0, 0, 3] },
    {
      table: { headerRows: 1, widths: ['*', 78, 78, 72], body: [head, ...rows, tot('Total monthly CTC', previous.total, revised.total, 1), tot('Total annual CTC', previous.total, revised.total, 12)] },
      layout: { hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1', paddingTop: () => 1.5, paddingBottom: () => 1.5 },
      margin: [0, 0, 0, 6],
    },
  ];
  if (facts.same.length) content.push({ text: 'What stays the same', bold: true, margin: [0, 0, 0, 2] }, P(`${facts.same.length > 3 ? 'All other components of your CTC (shown above)' : facts.same.join(', ')} ${facts.same.length === 1 ? 'remains' : 'remain'} unchanged, as do your designation, role and all other terms of employment.`));
  else content.push({ text: 'What stays the same', bold: true, margin: [0, 0, 0, 2] }, P('Your designation, role and all other terms of your employment are not affected by this revision.'));
  content.push(
    { unbreakable: true, stack: [
      P(`For any query on this revision, please write to ${batch.contact_email || 'hr@maxvoltenergy.com'}.`),
      ...signoff,
    ] },
  );
  return {
    pageSize: 'A4',
    pageMargins: [50, assets.marginTop, 50, assets.marginBottom],
    background: () => (assets.letterhead
      ? { image: assets.letterhead, absolutePosition: { x: 0, y: 0 }, width: 595.28, height: 841.89 }
      : { text: 'Maxvolt Energy Industries Limited', fontSize: 14, bold: true, margin: [36, 24, 0, 0] }),
    images: assets.stamp ? { stamp: assets.stamp } : {},
    content,
    defaultStyle: { font: 'Roboto', fontSize: rows.length >= 9 ? 9.4 : 10, lineHeight: 1.12 },
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Individual email (subject + html + text) for one employee. */
export function buildEmail({ emp, previous, revised, batch }) {
  const facts = impactFacts(previous, revised, { includeTakeHome: batch.include_take_home });
  const eff = longDate(batch.effective_date);
  const first = esc(emp.name.split(' ')[0] || emp.name);
  const subject = `Revision of your CTC structure — change in PF rules (effective ${eff})`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:620px">
<p>Dear ${first},</p>
<p>Following the change in the Provident Fund (PF) rules, your salary (CTC) structure has been revised with effect from <strong>${esc(eff)}</strong>. Your detailed salary revision letter, showing your previous and revised CTC breakdown, is attached to this email.</p>
<p><strong>In brief:</strong></p>
<ul>${facts.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
<p>Please read the attached letter carefully. For any query, write to <a href="mailto:${esc(batch.contact_email || 'hr@maxvoltenergy.com')}">${esc(batch.contact_email || 'hr@maxvoltenergy.com')}</a>.</p>
<p>Regards,<br/>Human Resources<br/>Maxvolt Energy Industries Limited</p>
<p style="font-size:12px;color:#64748b">This email and its attachment are confidential and meant only for ${first}.</p></div>`;
  const text = `Dear ${emp.name.split(' ')[0] || emp.name},\n\nYour CTC structure has been revised with effect from ${eff} following the change in PF rules. Your letter is attached.\n\n${facts.lines.map(l => '- ' + l).join('\n')}\n\nRegards,\nHuman Resources, Maxvolt Energy Industries Limited`;
  return { subject, html, text };
}

/* ───────────────────────── salary structure record ───────────────────────── */

/**
 * New SalaryStructure data for the revised CTC. Starts from the previous active
 * structure (so unrelated fields survive) and overwrites the CTC fields. The
 * old row is NOT modified here — the caller deactivates it, keeping it as history.
 */
export function buildStructure({ id, userId, prevStructure, revised, batch, approvedBy, now }) {
  const p = prevStructure ? { ...prevStructure } : {};
  const monthlyTotal = revised.total;
  const basic = revised.basic;
  const s = {
    ...p,
    id,
    user_id: userId,
    effective_from: batch.effective_date,
    ctc: r2(monthlyTotal * 12),
    is_manual_override: true,
    basic_salary: basic, basic_monthly: basic,
    hra: revised.hra, hra_monthly: revised.hra,
    conveyance: revised.conveyance, conveyance_monthly: revised.conveyance,
    car_fuel_maintenance: revised.car_maint,
    health_and_wellness: revised.gym,
    hard_furnishing: revised.hard_fur,
    pf_contribution: revised.pf, pf_employee: revised.pf,
    employer_pf_contribution: r2(revised.pf * 13 / 12),
    medical_contribution: revised.medical, medical_insurance: revised.medical,
    admin_charge: revised.admin,
    vpp_deduction: revised.vpp,
    ctc_bonus: revised.ctc_bonus,
    performance_bonus: revised.ctc_bonus || revised.vpp,
    employer_esi_contribution: revised.esi, esi_employer: revised.esi,
    car_lease: revised.car_lease,
    total_ctc: monthlyTotal,
    status: 'active',
    approved_by: approvedBy || null,
    revision_reason: `Revision due to change in PF rules (batch ${batch.id})`,
    source: 'pf_revision',
    revision_batch_id: batch.id,
    previous_structure_id: prevStructure?.id || null,
    previous_values: prevStructure ? {
      ctc: prevStructure.ctc ?? null,
      total_ctc: prevStructure.total_ctc ?? null,
      effective_from: prevStructure.effective_from ?? null,
      basic_salary: prevStructure.basic_salary ?? null,
      hra: prevStructure.hra ?? null,
      conveyance: prevStructure.conveyance ?? null,
      pf_contribution: prevStructure.pf_contribution ?? null,
      admin_charge: prevStructure.admin_charge ?? null,
      medical_contribution: prevStructure.medical_contribution ?? null,
    } : null,
    created_at_iso: now,
  };
  if (!prevStructure || r2(p.basic_salary ?? -1) !== basic) {
    s.esi_contribution = basic <= 21000 ? Math.round(basic * 0.0075) : 0;
  }
  return s;
}
