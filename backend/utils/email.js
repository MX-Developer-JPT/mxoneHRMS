import { randomUUID } from 'crypto';
import { loadHrDirectory, planDistribution } from './hrMail.js';

// ── Email delivery ───────────────────────────────────────────
// Mail goes out through Max Mail (our own gateway: Gmail API as no-reply@maxvoltenergy.com) and falls back to Brevo when the
// gateway cannot take or deliver a message. Configure with environment variables:
//   MAIL_GATEWAY_URL   https://max-mail-production.up.railway.app
//   MAIL_GATEWAY_KEY   the "hrms" app key from Max Mail
//   BREVO_API_KEY      kept as the fallback (and as the only provider until the gateway is configured)
//   EMAIL_PROVIDER     auto (default: gateway first, Brevo as fallback) | maxmail (gateway only) | brevo (Brevo only)
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_BASE = 'https://api.brevo.com/v3';
const GATEWAY_URL = (process.env.MAIL_GATEWAY_URL || '').replace(/\/+$/, '');
const GATEWAY_KEY = process.env.MAIL_GATEWAY_KEY || '';
const MODE = (process.env.EMAIL_PROVIDER || 'auto').toLowerCase();
const GATEWAY_MAX_BYTES = (Number(process.env.MAIL_GATEWAY_MAX_MB) || 15) * 1024 * 1024;
const GATEWAY_MAX_ATTACHMENTS = 10;
const GATEWAY_MAX_RECIPIENTS = Number(process.env.MAIL_GATEWAY_MAX_RECIPIENTS) || 45;     // the gateway allows 50 per message
const gatewayOn = () => !!(GATEWAY_URL && GATEWAY_KEY) && MODE !== 'brevo';
const brevoOn = () => !!BREVO_API_KEY && MODE !== 'maxmail';

const stats = { gateway_sent: 0, brevo_sent: 0, fallbacks: 0, last_fallback_at: null, last_fallback_reason: '' };
export const getEmailStats = () => ({ ...stats, mode: MODE, gateway_configured: !!(GATEWAY_URL && GATEWAY_KEY), brevo_configured: !!BREVO_API_KEY });

async function getSetting(key, fallback = '') {
  if (process.env.EMAIL_SETTINGS_FROM_ENV && process.env[key]) return process.env[key];   // tests: no database
  try {
    const { one } = await import('../db.js');           // loaded on demand: the sender itself needs no database
    const row = await one('SELECT value FROM settings WHERE key=$1', [key]);
    if (row?.value) return row.value;
  } catch {}
  return process.env[key] || fallback;
}

async function getFromAddress() {
  const from = await getSetting('SMTP_FROM', '');
  return from.includes('@') ? from : 'Maxvolt HR <no-reply@maxvoltenergy.com>';
}

// Parses "Display Name <email@domain>" or a bare "email@domain" into { name, email }.
function parseAddress(addr) {
  const m = String(addr || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2].trim() };
  return { email: String(addr || '').trim() };
}

// One clean, de-duplicated list of valid addresses: a string holding several addresses ("a@x.com, b@x.com") is split, anything that is
// not an address (or belongs to a disabled account) is dropped, so one bad entry cannot stop the mail for everybody else.
const ADDR_OK = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
function cleanList(v) {
  const out = []; const seen = new Set();
  for (const raw of [].concat(v || [])) {
    if (!raw) continue;
    const s = String(raw);
    const parts = !s.includes('<') && /[;,]/.test(s) ? s.split(/[;,]/) : [s];
    for (const part of parts) {
      const a = parseAddress(part); const e = String(a.email || '').trim().toLowerCase();
      if (!ADDR_OK.test(e) || e.includes('.disabled-') || seen.has(e)) continue;
      seen.add(e); out.push(a.name ? `${a.name} <${e}>` : e);
    }
  }
  return out;
}

// ── Brevo ────────────────────────────────────────────────────
async function brevoRequest(path, options = {}) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set');
  const res = await fetch(`${BREVO_BASE}${path}`, {
    ...options,
    headers: {
      'api-key':      BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Brevo error ${res.status}`);
  return data;
}

async function brevoSend({ from, recipients, ccList, subject, html, text, attachments, meta, scheduledAt, replyTo }) {
  const mappedAttachments = (attachments || [])
    .filter(a => a && a.content)
    .map(a => ({ name: a.filename, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : String(a.content) }));
  const result = await brevoRequest('/smtp/email', {
    method: 'POST',
    body: JSON.stringify({
      sender:      parseAddress(from),
      to:          recipients.map(parseAddress),
      cc:          ccList.length ? ccList : undefined,
      replyTo:     replyTo ? parseAddress(replyTo) : undefined,
      subject,
      htmlContent: html || undefined,
      textContent: text || undefined,
      attachment:  mappedAttachments.length ? mappedAttachments : undefined,
      tags:        meta?.source ? [meta.source] : ['hrms'],
      scheduledAt,
    }),
  });
  return { success: true, messageId: String(result?.messageId ?? ''), provider: 'brevo' };
}

// ── Max Mail gateway ─────────────────────────────────────────
class GatewayError extends Error {
  constructor(message, status, code, fallbackOk) { super(message); this.status = status; this.code = code; this.fallbackOk = fallbackOk; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gatewayFetch(path, { method = 'GET', body, idem, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(`${GATEWAY_URL}${path}`, {
      method, signal: ctl.signal,
      headers: { Authorization: `Bearer ${GATEWAY_KEY}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally { clearTimeout(t); }
}

async function gatewaySend({ from, recipients, ccList, subject, html, text, attachments, meta, replyTo }) {
  if (!html && !text) throw new GatewayError('Message body is empty', 400, 'validation_error', false);
  const atts = (attachments || []).filter((a) => a && a.content).map((a) => ({
    filename: String(a.filename || 'file').slice(0, 255),
    contentBase64: Buffer.isBuffer(a.content) ? a.content.toString('base64') : String(a.content),
    ...(a.contentType ? { contentType: a.contentType } : {}),
  }));
  const bytes = atts.reduce((s, a) => s + Math.floor((a.contentBase64.length * 3) / 4), 0);
  if (atts.length > GATEWAY_MAX_ATTACHMENTS || bytes > GATEWAY_MAX_BYTES) throw new GatewayError('Attachments are too large for the gateway', 413, 'attachments_too_large', true);
  const toGw = (a) => { const p = parseAddress(a); return p.name ? { email: p.email.toLowerCase(), name: p.name.slice(0, 100) } : p.email.toLowerCase(); };
  const fromName = (parseAddress(from).name || '').slice(0, 100);
  const body = {
    to: recipients.map(toGw), ...(ccList.length ? { cc: ccList.map((c) => toGw(c.name ? `${c.name} <${c.email}>` : c.email)) } : {}),
    subject: String(subject || '').slice(0, 998), ...(html ? { html } : {}), ...(text ? { text } : {}),
    ...(replyTo ? { replyTo: parseAddress(replyTo).email.toLowerCase() } : {}), ...(fromName ? { fromName } : {}),
    tags: [String(meta?.source || 'hrms').slice(0, 50)], ...(atts.length ? { attachments: atts } : {}),
  };
  const idem = randomUUID();                                   // one key for every attempt of this send, so a retry can never mail twice
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await gatewayFetch('/v1/send', { method: 'POST', body, idem });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 && data.id) return data.id;
      const code = data?.error?.code || '';
      const msg = data?.error?.message || `Mail gateway error ${res.status}`;
      const retryable = res.status >= 500 || (res.status === 429 && code === 'rate_limited');
      last = new GatewayError(msg, res.status, code, res.status !== 400 && res.status !== 422);
      if (!retryable || attempt === 3) throw last;
      await sleep(Math.min(5000, Number(res.headers.get('retry-after')) * 1000 || 600 * attempt));
    } catch (e) {
      if (e instanceof GatewayError) { if (!e.fallbackOk || attempt === 3 || (e.status < 500 && e.code !== 'rate_limited')) throw e; last = e; continue; }
      last = new GatewayError(`Mail gateway unreachable: ${e.name === 'AbortError' ? 'timed out' : e.message}`, 0, 'network', true);
      if (attempt === 3) throw last;
      await sleep(600 * attempt);
    }
  }
  throw last;
}

// For mail a person is waiting on (OTP, password change): wait a few seconds for the real outcome so a failed delivery can still fall back.
async function gatewayConfirm(id, waitMs = 10000) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await sleep(700);
    try {
      const res = await gatewayFetch(`/v1/messages/${id}`, { timeoutMs: 5000 });
      const d = await res.json().catch(() => ({}));
      if (d.status === 'sent') return;
      if (d.status === 'failed' || d.status === 'dead' || d.status === 'bounced') throw new GatewayError(d.error || `Message ${d.status}`, 0, d.status, true);
    } catch (e) { if (e instanceof GatewayError) throw e; /* a failed status check is not a failed send */ }
  }
}

// ── Public API (signatures unchanged) ──────────────────────

export async function verifyEmail() {
  const brevoCheck = async () => {
    try {
      if (!BREVO_API_KEY) return { ok: false, provider: 'brevo', error: 'BREVO_API_KEY is not set' };
      const res = await fetch(`${BREVO_BASE}/account`, { headers: { 'api-key': BREVO_API_KEY, Accept: 'application/json' } });
      if (res.status === 401) return { ok: false, provider: 'brevo', error: 'Invalid API key' };
      if (!res.ok) return { ok: false, provider: 'brevo', error: `Brevo error ${res.status}` };
      return { ok: true, provider: 'brevo' };
    } catch (e) { return { ok: false, provider: 'brevo', error: `Brevo: ${e.message}` }; }
  };
  if (!gatewayOn()) return brevoCheck();
  try {
    const res = await gatewayFetch('/v1/me', { timeoutMs: 8000 });
    if (res.status === 401) throw new Error('The mail gateway rejected the key');
    if (!res.ok) throw new Error(`Mail gateway error ${res.status}`);
    const me = await res.json().catch(() => ({}));
    return { ok: true, provider: 'maxmail', sender: me.sender, usage_today: me.usage_today, fallback: brevoOn() };
  } catch (e) {
    if (brevoOn()) { const b = await brevoCheck(); return { ...b, warning: `Mail gateway not reachable (${e.message}) — using Brevo` }; }
    return { ok: false, provider: 'maxmail', error: `Mail gateway: ${e.message}` };
  }
}

// attachments: [{ filename, content: Buffer | base64 string, contentType? }]
// cc: string email or array of strings
// to: string email or array of strings
// meta: { source?: tag, confirm?: wait for the real delivery outcome (OTP and similar) }
export async function sendEmail({ to, cc, subject, html, text, attachments, meta, scheduledAt, replyTo }) {
  const toList = cleanList(to);
  if (!toList.length) throw new Error('sendEmail: no valid recipient address');
  // HR mailbox mapping and the HR copy are applied here, for every mail the system sends (utils/hrMail.js).
  const { primary, copy } = planDistribution({ to: toList, cc: cleanList(cc), subject, html, text, attachments, meta, scheduledAt, replyTo }, await loadHrDirectory());
  const result = await deliver(primary);
  if (copy) await deliver(copy).catch((e) => console.warn(`[email] HR copy of "${String(subject).slice(0, 60)}" not sent: ${e.message}`));
  return result;
}

async function deliver({ to, cc, subject, html, text, attachments, meta, scheduledAt, replyTo }) {
  const from = await getFromAddress();
  const recipients = cleanList(to);
  const ccList = cleanList(cc).filter((c) => !recipients.includes(c)).map(parseAddress);

  if (gatewayOn() && !scheduledAt) {                                 // scheduled sending exists only at Brevo
    try {
      if (meta?.simulateGatewayDown) throw new GatewayError('Simulated gateway outage (self-test)', 503, 'simulated', true);
      // the gateway takes at most GATEWAY_MAX_RECIPIENTS addresses per message: a longer list goes out as several messages
      const groups = []; for (let i = 0; i < recipients.length; i += GATEWAY_MAX_RECIPIENTS) groups.push(recipients.slice(i, i + GATEWAY_MAX_RECIPIENTS));
      let firstId = '';
      for (let g = 0; g < groups.length; g++) {
        const room = 50 - groups[g].length;                     // the gateway counts To + Cc together
        const id = await gatewaySend({ from, recipients: groups[g], ccList: g === 0 ? ccList.slice(0, Math.max(0, room)) : [], subject, html, text, attachments, meta, replyTo });
        if (!firstId) firstId = id;
        if (meta?.confirm && groups.length === 1) await gatewayConfirm(id);
      }
      stats.gateway_sent++;
      return { success: true, messageId: firstId, provider: 'maxmail', ...(groups.length > 1 ? { messages: groups.length } : {}) };
    } catch (e) {
      if (!(e instanceof GatewayError) || !e.fallbackOk || !brevoOn()) throw e;
      stats.fallbacks++; stats.last_fallback_at = new Date().toISOString(); stats.last_fallback_reason = String(e.message).slice(0, 200);
      console.warn(`[email] mail gateway could not send "${String(subject).slice(0, 60)}" (${e.message}) — falling back to Brevo`);
    }
  }
  if (!BREVO_API_KEY || MODE === 'maxmail') throw new Error('No email provider is available (set MAIL_GATEWAY_URL / MAIL_GATEWAY_KEY, or BREVO_API_KEY)');
  const r = await brevoSend({ from, recipients, ccList, subject, html, text, attachments, meta, scheduledAt, replyTo });
  stats.brevo_sent++;
  return r;
}

export async function getEmailConfig() {
  const from = await getSetting('SMTP_FROM', '');
  return { provider: gatewayOn() ? (brevoOn() ? 'maxmail (Brevo fallback)' : 'maxmail') : 'brevo', from, url: gatewayOn() ? GATEWAY_URL : BREVO_BASE, stats: getEmailStats() };
}

// ── Shared email chrome ────────────────────────────────────
const APP_URL  = process.env.APP_URL || 'https://maxone.maxvoltenergy.com';
// PNG, not the SVG favicon — most mail clients (Gmail, Outlook) don't render SVG images.
const LOGO_URL = `${APP_URL}/apple-touch-icon.png`;

function emailHeader(title, accentColor = '#344055') {
  return `
<div style="background:${accentColor};padding:20px 28px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:16px">
  <img src="${LOGO_URL}" alt="MaxVolt Energy" style="height:40px;width:40px;object-fit:contain;border-radius:9px" />
  <div style="flex:1">
    <div style="color:#ffffff;font-size:18px;font-weight:700">${title}</div>
    <div style="color:rgba(255,255,255,0.65);font-size:11px;margin-top:2px">Maxvolt Energy Industries Limited</div>
  </div>
</div>`;
}

function emailFooter() {
  return `
<div style="border-top:1px solid #e2e8f0;padding:16px 28px;background:#f8fafc;border-radius:0 0 12px 12px;text-align:center">
  <img src="${LOGO_URL}" alt="MaxVolt Energy" style="height:32px;width:32px;object-fit:contain;margin-bottom:8px;border-radius:7px" />
  <div style="font-size:12px;color:#94a3b8;margin-top:4px">This is an automated message. Do not reply to this email.</div>
  <div style="font-size:11px;color:#94a3b8;margin-top:6px;font-weight:600">Simplifying work. Empowering people</div>
  <div style="font-size:11px;color:#cbd5e1;margin-top:2px">© ${new Date().getFullYear()} Maxvolt Energy Industries Limited</div>
</div>`;
}

function emailBody(content) {
  return `<div style="padding:28px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;background:#ffffff;font-size:15px;line-height:1.6;color:#1e293b">${content}</div>`;
}

function infoTable(rows) {
  const cells = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#475569;width:38%;border-bottom:1px solid #e2e8f0">${label}</td>
      <td style="padding:10px 12px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0">${value}</td>
    </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:20px 0">${cells}</table>`;
}

function wrap(header, body, footer) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f1f5f9">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  ${header}${body}${footer}
</div></body></html>`;
}

export const emailTemplates = {
  interviewInvite: ({ candidateName, position, interviewDate, interviewTime, mode, location, interviewerName }) => ({
    subject: `Interview Invitation — ${position} at Maxvolt Energy`,
    html: wrap(
      emailHeader('Interview Invitation', '#1e40af'),
      emailBody(`
        <p>Dear <strong>${candidateName}</strong>,</p>
        <p>We are pleased to invite you for an interview for the <strong>${position}</strong> position at Maxvolt Energy Industries Limited.</p>
        ${infoTable([
          ['Date', interviewDate || 'TBD'],
          ['Time', interviewTime || 'TBD'],
          ['Mode', mode || 'In-person'],
          ...(location ? [['Venue / Link', location]] : []),
          ...(interviewerName ? [['Interviewer', interviewerName]] : []),
        ])}
        <p>Please confirm your availability by replying to this email. We look forward to speaking with you.</p>
      `),
      emailFooter()
    ),
  }),

  candidateRejection: ({ candidateName, position }) => ({
    subject: `Update on your application — ${position} at Maxvolt Energy`,
    html: wrap(
      emailHeader('Application Update', '#475569'),
      emailBody(`
        <p>Dear <strong>${candidateName}</strong>,</p>
        <p>Thank you for your interest in the <strong>${position}</strong> position at Maxvolt Energy Industries Limited, and for the time you invested in your application.</p>
        <p>After careful consideration, we have decided to move forward with other candidates whose profile more closely matches our current requirements for this role. This decision is not a reflection of your overall qualifications.</p>
        <p>We will keep your profile on file and encourage you to apply for future openings that match your skills and experience.</p>
        <p>We wish you the very best in your career search.</p>
      `),
      emailFooter()
    ),
  }),

  payslip: ({ employeeName, month, year, payslipHtml }) => ({
    subject: `Your Payslip — ${month} ${year} | Maxvolt Energy`,
    html: wrap(
      emailHeader(`Payslip — ${month} ${year}`),
      emailBody(`
        <p>Dear <strong>${employeeName}</strong>,</p>
        <p>Please find your payslip for <strong>${month} ${year}</strong> below.</p>
        ${payslipHtml}
        <p style="font-size:12px;color:#94a3b8;margin-top:16px">This is a system-generated document.</p>
      `),
      emailFooter()
    ),
  }),

  leaveUpdate: ({ employeeName, leaveType, startDate, endDate, days, status, remarks }) => ({
    subject: `Leave ${status === 'approved' ? 'Approved ✓' : 'Rejected ✗'} — ${leaveType}`,
    html: wrap(
      emailHeader(`Leave ${status === 'approved' ? 'Approved' : 'Rejected'}`, status === 'approved' ? '#166534' : '#991b1b'),
      emailBody(`
        <p>Dear <strong>${employeeName}</strong>,</p>
        <p>Your leave request has been <strong style="color:${status === 'approved' ? '#16a34a' : '#dc2626'}">${status.toUpperCase()}</strong>.</p>
        ${infoTable([
          ['Leave Type', leaveType],
          ['From', startDate],
          ['To', endDate],
          ['Days', String(days)],
          ...(remarks ? [['Remarks', remarks]] : []),
        ])}
      `),
      emailFooter()
    ),
  }),

  trainingNotification: ({ employeeName, trainingTitle, startDate, endDate, trainer, location }) => ({
    subject: `Training Scheduled: ${trainingTitle}`,
    html: wrap(
      emailHeader('Training Enrolled', '#1e40af'),
      emailBody(`
        <p>Dear <strong>${employeeName}</strong>,</p>
        <p>You have been enrolled in the following training programme:</p>
        ${infoTable([
          ['Programme', trainingTitle],
          ['Start Date', startDate],
          ['End Date', endDate],
          ...(trainer ? [['Trainer', trainer]] : []),
          ...(location ? [['Location', location]] : []),
        ])}
      `),
      emailFooter()
    ),
  }),

  confirmationDueReminder: ({ managerName, employeeName, department, designation, probationEndDate, daysLeft }) => ({
    subject: `Confirmation Due Soon — ${employeeName} (${daysLeft < 0 ? 'overdue' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`})`,
    html: wrap(
      emailHeader('Employee Confirmation Reminder', daysLeft < 0 ? '#991b1b' : '#b45309'),
      emailBody(`
        <p>Dear <strong>${managerName || 'Manager'}</strong>,</p>
        <p>
          ${daysLeft < 0
            ? `<strong>${employeeName}</strong>'s probation period ended on <strong>${probationEndDate}</strong> and is now overdue for a confirmation decision.`
            : `<strong>${employeeName}</strong>'s probation period is ending on <strong>${probationEndDate}</strong> — ${daysLeft} day${daysLeft === 1 ? '' : 's'} from now.`}
        </p>
        ${infoTable([
          ['Employee', employeeName],
          ...(designation ? [['Designation', designation]] : []),
          ...(department ? [['Department', department]] : []),
          ['Probation End Date', probationEndDate],
        ])}
        <p>Please review their performance and record a confirmation decision (confirm or extend probation) in Maxvolt One under Confirmation Management.</p>
      `),
      emailFooter()
    ),
  }),

  exitClearanceReminder: ({ ownerName, employeeName, deptLabel, lastWorkingDate, daysOverdue }) => ({
    subject: `Exit Clearance ${daysOverdue > 0 ? 'Overdue' : 'Pending'} — ${employeeName} (${deptLabel})`,
    html: wrap(
      emailHeader('Exit Clearance Reminder', daysOverdue > 0 ? '#991b1b' : '#b45309'),
      emailBody(`
        <p>Dear <strong>${ownerName || 'Team'}</strong>,</p>
        <p>
          <strong>${employeeName}</strong>'s exit clearance for <strong>${deptLabel}</strong> is
          ${daysOverdue > 0 ? `<strong style="color:#dc2626">overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}</strong>` : 'still pending'}.
        </p>
        ${infoTable([
          ['Employee', employeeName],
          ['Department Clearance', deptLabel],
          ...(lastWorkingDate ? [['Last Working Day', lastWorkingDate]] : []),
        ])}
        <p>Please complete this department's clearance checklist in Maxvolt One under Exit Management.</p>
      `),
      emailFooter()
    ),
  }),

  otpEmail: ({ name, code, expiresMinutes = 10 }) => ({
    subject: 'Your Maxvolt HR Verification Code',
    html: wrap(
      emailHeader('Email Verification'),
      emailBody(`
        <p>Hi <strong>${name || 'there'}</strong>,</p>
        <p>Use the code below to verify your email address. It expires in <strong>${expiresMinutes} minutes</strong>.</p>
        <div style="text-align:center;margin:32px 0">
          <div style="display:inline-block;background:#fff7ed;border:2px solid #f97316;border-radius:12px;padding:20px 32px">
            <div style="font-size:42px;font-weight:800;letter-spacing:14px;color:#ea580c;font-family:monospace">${code}</div>
          </div>
        </div>
        <p style="font-size:13px;color:#64748b">If you did not request this code, you can safely ignore this email.</p>
      `),
      emailFooter()
    ),
    text: `Your Maxvolt HR verification code is: ${code}\nExpires in ${expiresMinutes} minutes.`,
  }),

  passwordResetEmail: ({ name, resetLink }) => ({
    subject: 'Reset your Maxvolt HR password',
    html: wrap(
      emailHeader('Password Reset'),
      emailBody(`
        <p>Hi <strong>${name || 'there'}</strong>,</p>
        <p>We received a request to reset your Maxvolt HR password. Click the button below to set a new password.</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${resetLink}" style="background:#1a1f36;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;letter-spacing:0.3px">Reset Password</a>
        </div>
        <p style="font-size:13px;color:#64748b">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, ignore this email — your password won't change.</p>
        <p style="font-size:11px;color:#94a3b8;word-break:break-all">Or copy this link: ${resetLink}</p>
      `),
      emailFooter()
    ),
    text: `Reset your Maxvolt HR password: ${resetLink}\nThis link expires in 1 hour.`,
  }),

  onboardingInviteEmail: ({ name, link, loginEmail, hrName, designation, department, dateOfJoining, expiryDays = 7 }) => ({
    subject: 'Welcome to Maxvolt Energy — complete your onboarding',
    html: wrap(
      emailHeader('Welcome to Maxvolt Energy', '#ea580c'),
      emailBody(`
        <p>Dear <strong>${name || 'there'}</strong>,</p>
        <p>${hrName || 'Our HR team'} has set up your profile on <strong>Maxvolt One</strong>, our HR portal. To finish joining, please open the link below, set a password, and submit your details and documents.</p>
        ${infoTable([
          ...(designation ? [['Designation', designation]] : []),
          ...(department ? [['Department', department]] : []),
          ...(dateOfJoining ? [['Date of joining', dateOfJoining]] : []),
          ['Your login ID', loginEmail],
        ])}
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="background:#ea580c;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Complete my onboarding</a>
        </div>
        <p><strong>Keep these ready:</strong> Aadhaar card (front and back), PAN card, a passport-size photo, a cancelled cheque or bank passbook page, education certificates / marksheets, and — if you have worked before — your experience / relieving letters.</p>
        <p style="font-size:13px;color:#64748b">This link works once and expires in <strong>${expiryDays} days</strong>. You will get access to the app as soon as you submit everything. If it expires, ask HR to send a new one.</p>
        <p style="font-size:11px;color:#94a3b8;word-break:break-all">Or copy this link: ${link}</p>
      `),
      emailFooter()
    ),
    text: `Welcome to Maxvolt Energy! Complete your onboarding here: ${link}\nLogin ID: ${loginEmail}\nThe link works once and expires in ${expiryDays} days.`,
  }),

  documentReuploadEmail: ({ name, documentName, reason, link }) => ({
    subject: 'Maxvolt HR — please re-upload a document',
    html: wrap(
      emailHeader('Document needs to be re-uploaded', '#b45309'),
      emailBody(`
        <p>Dear <strong>${name || 'Employee'}</strong>,</p>
        <p>HR could not accept the document below and needs you to upload it again.</p>
        ${infoTable([['Document', documentName], ['What is wrong', reason]])}
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="background:#ea580c;color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Open My Documents</a>
        </div>
        <p style="font-size:13px;color:#64748b">Sign in, open <strong>My Documents</strong>, and use the <strong>Re-upload</strong> button on that document. A clear, complete photo or PDF is best.</p>
      `),
      emailFooter()
    ),
    text: `Please re-upload "${documentName}": ${reason}. Open ${link} and use Re-upload.`,
  }),

  onboardingApprovedEmail: ({ name, role, department }) => ({
    subject: 'Welcome to Maxvolt Energy — Onboarding Approved',
    html: wrap(
      emailHeader('Onboarding Approved!', '#166534'),
      emailBody(`
        <p>Dear <strong>${name || 'Employee'}</strong>,</p>
        <p>We are delighted to inform you that your onboarding has been <strong style="color:#16a34a">approved</strong>. You are now an official member of the Maxvolt Energy team!</p>
        ${(department || role) ? infoTable([
          ...(department ? [['Department', department]] : []),
          ...(role ? [['Role', role]] : []),
        ]) : ''}
        <p>Please log in to the HR portal to complete any remaining setup and explore your employee dashboard.</p>
        <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 18px;border-radius:0 8px 8px 0;margin:20px 0;font-size:14px;color:#166534">
          <strong>Welcome to the family!</strong> We're excited to have you on board.
        </div>
      `),
      emailFooter()
    ),
    text: `Dear ${name}, your onboarding has been approved. Welcome to Maxvolt Energy!`,
  }),

  onboardingRejectedEmail: ({ name, reason }) => ({
    subject: 'Maxvolt HR — Onboarding Submission Requires Corrections',
    html: wrap(
      emailHeader('Action Required', '#991b1b'),
      emailBody(`
        <p>Dear <strong>${name || 'Applicant'}</strong>,</p>
        <p>Your onboarding submission has been reviewed and requires corrections before it can be approved.</p>
        ${reason ? `<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px 18px;border-radius:0 8px 8px 0;margin:20px 0"><strong style="color:#991b1b">Reason:</strong><br><span style="color:#1e293b;font-size:14px">${reason}</span></div>` : ''}
        <p>Please log back in to the HR portal, make the necessary corrections, and re-submit your documents.</p>
      `),
      emailFooter()
    ),
    text: `Dear ${name}, your onboarding submission requires corrections. Reason: ${reason || 'Please check the HR portal for details.'}`,
  }),

  testEmail: ({ to }) => ({
    subject: 'Maxvolt HR — Email Test ✓',
    html: wrap(
      emailHeader('Email is Working!', '#166534'),
      emailBody(`
        <div style="text-align:center;padding:12px 0">
          <div style="background:#f0fdf4;border-radius:50%;width:72px;height:72px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px">
            <span style="font-size:36px">✓</span>
          </div>
          <h2 style="color:#1e293b;margin:0 0 8px;font-size:22px">Email delivery confirmed</h2>
          <p style="color:#64748b;font-size:15px">Your Maxvolt HR system is correctly configured to send automated emails.</p>
        </div>
      `),
      emailFooter()
    ),
  }),
};

// Birthday / work-anniversary heads-up + same-day reminder for the HR-
// configured recipient list (Admin Panel → Email → Celebration Alerts).
export function celebrationEmail({ kind, name, department, designation, dateLabel, years, isToday }) {
  const isBday = kind === 'birthday';
  const what = isBday ? 'birthday' : `${years}-year work anniversary`;
  const subject = isToday
    ? `${isBday ? '🎂' : '🎉'} Today: ${name}'s ${what}`
    : `${isBday ? '🎂' : '🎉'} Upcoming: ${name}'s ${what} on ${dateLabel}`;
  const intro = isToday
    ? `Today is <strong>${name}</strong>'s ${what}.`
    : `<strong>${name}</strong>'s ${what} is coming up on <strong>${dateLabel}</strong>.`;
  return {
    subject,
    html: wrap(
      emailHeader(isBday ? 'Birthday Reminder' : 'Work Anniversary Reminder', isBday ? '#be185d' : '#1e40af'),
      emailBody(`
        <p>${intro}</p>
        ${infoTable([
          ['Employee', name],
          ...(department ? [['Department', department]] : []),
          ...(designation ? [['Designation', designation]] : []),
          ['Date', dateLabel],
          ...(!isBday && years ? [['Years with company', String(years)]] : []),
        ])}
      `),
      emailFooter()
    ),
  };
}
