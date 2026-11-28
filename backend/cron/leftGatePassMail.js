// The daily email listing who left without a gate pass on the previous day. Recipients are set in Admin Panel → Gate Pass
// Email. A day goes out once: the send is claimed first, and the claim is released if the mail fails so it can be retried.
import { one, run } from '../db.js';
import { sendEmail } from '../utils/email.js';
import { validEmail } from '../utils/hrMail.js';
import { leftWithoutGatePass, leftRows, buildLeftWorkbook, COLUMNS, LEFT_EARLY_MIN } from '../utils/leftWithoutGatePass.js';

export const CONFIG_KEY = 'LEFT_GATE_PASS_MAIL';
export const MAX_RECIPIENTS = 50;
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);

export const cleanRecipients = (list) => [...new Set((Array.isArray(list) ? list : []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];

export async function loadConfig() {
  const row = await one('SELECT value FROM settings WHERE key=$1', [CONFIG_KEY]);
  let saved = {}; try { saved = row?.value ? JSON.parse(row.value) : {}; } catch { /* defaults */ }
  return { enabled: saved.enabled !== false, send_when_none: saved.send_when_none !== false, recipients: cleanRecipients(saved.recipients), updated_at: saved.updated_at || '', updated_by_name: saved.updated_by_name || '' };
}
export async function saveConfig(cfg) {
  await run('INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT', [CONFIG_KEY, JSON.stringify(cfg)]);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

// the columns of the table in the mail (the attached sheet has them all)
const SHOWN = [0, 1, 2, 3, 5, 9, 10, 11, 12, 13];
export function mailHtml(date, rows) {
  const cell = (tag, v, style) => `<${tag} style="border:1px solid #e5e7eb;padding:6px 8px;text-align:left;${style}">${esc(v)}</${tag}>`;
  const table = rows.length ? `<table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${SHOWN.map((i) => cell('th', COLUMNS[i][0], 'background:#7f1d1d;color:#fff')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${SHOWN.map((i) => cell('td', r[i], '')).join('')}</tr>`).join('')}</tbody></table>`
    : '<p style="font-size:14px;margin:0">No employee left without a gate pass on this day.</p>';
  return `<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#111827">
  <h2 style="margin:0 0 4px;font-size:18px">Left without gate pass — ${esc(longDate(date))}</h2>
  <p style="margin:0 0 14px;font-size:13px;color:#4b5563">${rows.length} employee(s). Counted: short attendance or half day, last check-out ${LEFT_EARLY_MIN} minutes or more before shift end, and no gate pass for the day.</p>
  ${table}
  <p style="margin:16px 0 0;font-size:11px;color:#6b7280">Sent automatically by Maxvolt One. Times are IST.</p></div>`;
}

/**
 * `date` defaults to yesterday. `manual` (an admin pressing Send) ignores the on/off switch and the once-a-day claim.
 * Returns { sent, cases, date } or { skipped, date }.
 */
export async function sendLeftGatePassMail({ date = istDate(-1), manual = false } = {}) {
  const cfg = await loadConfig();
  if (!manual && !cfg.enabled) return { skipped: 'switched off', date };
  const to = cfg.recipients.filter(validEmail);
  if (!to.length) return { skipped: 'no recipients configured', date };
  const key = `left-gp-mail-${date}`;
  if (!manual) {
    const claim = await run("INSERT INTO entities(id,type,status,data) VALUES($1,'LeftGatePassMailLog','sending',$2) ON CONFLICT (id) DO NOTHING", [key, JSON.stringify({ id: key, date })]);
    if (!claim.rowCount) return { skipped: 'already sent', date };
  }
  const release = async () => { if (!manual) await run("DELETE FROM entities WHERE id=$1 AND type='LeftGatePassMailLog'", [key]); };
  try {
    const { flagged, byUser } = await leftWithoutGatePass(date, date);
    if (!flagged.length && !cfg.send_when_none && !manual) {
      await run("UPDATE entities SET status='nothing', data=$1 WHERE id=$2", [JSON.stringify({ id: key, date, cases: 0, recipients: 0, sent_at: new Date().toISOString() }), key]);
      return { skipped: 'nobody to report', date, cases: 0 };
    }
    const attachments = [];
    if (flagged.length) {
      const book = await buildLeftWorkbook({ flagged, byUser, from: date, to: date, generatedBy: 'Maxvolt One' }, (await import('exceljs')).default);
      attachments.push({ filename: book.filename, content: Buffer.from(book.buffer) });
    }
    await sendEmail({ to, subject: `Left without gate pass — ${date} (${flagged.length})`, html: mailHtml(date, leftRows(flagged, byUser)), attachments, meta: { source: 'left-without-gatepass', confirm: true } });
    const log = { id: manual ? `${key}-manual-${Date.now()}` : key, date, cases: flagged.length, recipients: to.length, manual, sent_at: new Date().toISOString() };
    if (manual) await run("INSERT INTO entities(id,type,status,data) VALUES($1,'LeftGatePassMailLog','sent',$2)", [log.id, JSON.stringify(log)]);
    else await run("UPDATE entities SET status='sent', data=$1 WHERE id=$2", [JSON.stringify(log), key]);
    return { sent: to.length, cases: flagged.length, date };
  } catch (e) {
    await release();
    throw e;
  }
}
