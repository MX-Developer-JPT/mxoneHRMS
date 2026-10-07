// Scheduled MIS e-mails to the Management department.
//   • Daily   — every day at 12:00 AM IST        → covers the previous day
//   • Weekly  — every Monday at 12:10 AM IST     → covers the previous Mon–Sun week
//   • Monthly — 1st of the month at 12:10 AM IST → covers the previous calendar month
// Each mail carries two Excel attachments: the full MIS and the department-wise MIS.
// Only active employees whose department is "Management" receive it.
import { one, all, run } from '../db.js';
import { sendEmail } from '../utils/email.js';
import { buildMisWorkbook } from '../utils/misReport.js';

const IST_MS = 5.5 * 3600000;
const istDate = (offsetDays = 0) => new Date(Date.now() + IST_MS + offsetDays * 86400000).toISOString().slice(0, 10);

const CONFIG_KEY = 'mis_mail_config';
export const DEFAULT_MIS_CONFIG = { include_management: true, user_ids: [], extra_emails: [], periods: { daily: true, weekly: true, monthly: true } };

export async function loadMisConfig() {
  try {
    const row = await one("SELECT value FROM settings WHERE key=$1", [CONFIG_KEY]);
    const c = row?.value ? JSON.parse(row.value) : {};
    return {
      include_management: c.include_management !== false,
      user_ids: Array.isArray(c.user_ids) ? c.user_ids : [],
      extra_emails: Array.isArray(c.extra_emails) ? c.extra_emails : [],
      periods: { ...DEFAULT_MIS_CONFIG.periods, ...(c.periods || {}) },
    };
  } catch { return { ...DEFAULT_MIS_CONFIG }; }
}

export async function saveMisConfig(input) {
  const clean = {
    include_management: input.include_management !== false,
    user_ids: [...new Set((input.user_ids || []).map(String))],
    extra_emails: [...new Set((input.extra_emails || []).map(e => String(e).trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))],
    periods: { daily: input.periods?.daily !== false, weekly: input.periods?.weekly !== false, monthly: input.periods?.monthly !== false },
  };
  await run("INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT", [CONFIG_KEY, JSON.stringify(clean)]);
  return clean;
}

/** Everyone who will get the MIS e-mail under the saved configuration: [{ email, name, source }]. */
export async function resolveRecipients(config) {
  const cfg = config || await loadMisConfig();
  const emps = (await all("SELECT data FROM entities WHERE type='Employee'")).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  const out = [];
  const add = (email, name, source) => { const e = String(email || '').trim(); if (e && !out.some(o => o.email.toLowerCase() === e.toLowerCase())) out.push({ email: e, name: name || '', source }); };
  const emailOf = async (emp) => { const u = await one("SELECT email FROM users WHERE id=$1", [emp.user_id]); return (u?.email || emp.email || emp.work_email || '').trim(); };
  if (cfg.include_management) {
    for (const e of emps.filter(e => /^management$/i.test(String(e.department || '').trim()) && e.status !== 'inactive' && e.is_active !== false && e.user_id)) add(await emailOf(e), e.display_name, 'Management department');
  }
  for (const uid of cfg.user_ids) {
    const e = emps.find(x => x.user_id === uid);
    if (e && e.status !== 'inactive') add(await emailOf(e), e.display_name, 'Selected');
  }
  for (const em of cfg.extra_emails) add(em, '', 'Extra address');
  return out;
}

export async function getManagementRecipients() {
  const emps = (await all("SELECT data FROM entities WHERE type='Employee'")).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  const mgmt = emps.filter(e => /^management$/i.test(String(e.department || '').trim()) && e.status !== 'inactive' && e.is_active !== false && e.user_id);
  const out = [];
  for (const e of mgmt) {
    const u = await one("SELECT email FROM users WHERE id=$1", [e.user_id]);
    const email = (u?.email || e.email || e.work_email || '').trim();
    if (email && !out.includes(email)) out.push(email);
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function buildHtml(title, kpis, deptRows) {
  const kpiRows = kpis.map(([k, v], i) => `<tr style="background:${i % 2 ? '#f8fafc' : '#fff'}"><td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(k)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center;font-weight:600">${esc(v)}</td></tr>`).join('');
  const dRows = deptRows.map((d, i) => `<tr style="background:${i % 2 ? '#f8fafc' : '#fff'}"><td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(d.dept)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${d.headcount}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${d.present}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${d.absent}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${d.leave}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${d.late}</td></tr>`).join('');
  return `<div style="font-family:Calibri,Arial,sans-serif;color:#1f2937;max-width:720px">
  <div style="background:#1a3c5e;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0"><div style="font-size:12px;opacity:.8">Maxvolt Energy Industries Limited</div><div style="font-size:18px;font-weight:700">${esc(title)}</div></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:16px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px">Please find the MIS report attached — the full report and the department-wise report (Excel). Key figures:</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr><th style="background:#2d5986;color:#fff;padding:7px 10px;text-align:left">Metric</th><th style="background:#2d5986;color:#fff;padding:7px 10px">Value</th></tr></thead><tbody>${kpiRows}</tbody></table>
    <h3 style="margin:18px 0 8px;font-size:14px;color:#1a3c5e">Department-wise attendance</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${['Department', 'Headcount', 'Present', 'Absent', 'Leave', 'Late'].map(h => `<th style="background:#2d5986;color:#fff;padding:7px 10px">${h}</th>`).join('')}</tr></thead><tbody>${dRows}</tbody></table>
    <p style="margin:16px 0 0;font-size:11px;color:#6b7280">Automatically generated by Maxvolt One. Times are IST.</p>
  </div></div>`;
}

/**
 * period: 'daily' | 'weekly' | 'monthly'. The report always covers the period that has just
 * ended (daily → yesterday, weekly → last Mon–Sun, monthly → last calendar month).
 */
export async function sendMisReport(period, { force = false, toOverride } = {}) {
  const ref = istDate(-1); // yesterday: inside the period that just closed for all three cadences
  const full = await buildMisWorkbook({ period, date: ref, department: 'all', departmentWise: false }, (await import('exceljs')).default);
  const key = `mis-mail-${period}-${full.range.from}`;
  if (!force && await one("SELECT id FROM entities WHERE id=$1", [key])) return { skipped: 'already sent', key };

  const cfg = await loadMisConfig();
  if (!toOverride && !force && cfg.periods[period] === false) return { skipped: `${period} report is switched off in the recipient settings`, key };
  const recipients = toOverride ? [toOverride] : (await resolveRecipients(cfg)).map(r => r.email);
  if (!recipients.length) { console.warn(`[mis-mail] ${period}: no recipients configured`); return { skipped: 'no recipients', key }; }

  const dw = await buildMisWorkbook({ period, date: ref, department: 'all', departmentWise: true }, (await import('exceljs')).default);
  const html = buildHtml(full.range.title, full.kpis, full.deptRows);
  await sendEmail({
    to: recipients,
    subject: `${full.range.title} — Maxvolt One`,
    html,
    attachments: [
      { filename: full.filename, content: Buffer.from(full.buffer) },
      { filename: dw.filename, content: Buffer.from(dw.buffer) },
    ],
    meta: { source: 'mis-report' },
  });
  if (!toOverride) {
    await run("INSERT INTO entities(id,type,status,data) VALUES($1,'MisMailLog','sent',$2) ON CONFLICT (id) DO NOTHING",
      [key, JSON.stringify({ id: key, period, from: full.range.from, to: full.range.to, recipients: recipients.length, sent_at: new Date().toISOString() })]);
  }
  console.log(`[mis-mail] ${period} report (${full.range.from} → ${full.range.to}) sent to ${recipients.length} recipient(s)`);
  return { sent: recipients.length, key, range: full.range };
}
