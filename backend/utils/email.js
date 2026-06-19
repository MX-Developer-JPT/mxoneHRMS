import db from '../db.js';

function getSetting(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (row?.value) return row.value;
  } catch {}
  return process.env[key] || fallback;
}

function getProvider()    { return getSetting('EMAIL_PROVIDER', 'resend'); }
function getResendKey()   { return getSetting('RESEND_API_KEY', ''); }
function getBrevoKey()    { return getSetting('BREVO_API_KEY', ''); }
function getFromAddress() {
  const from = getSetting('SMTP_FROM', '');
  return from.includes('@') ? from : null;
}

// ── Resend ─────────────────────────────────────────────────
async function resendRequest(apiKey, path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.name || `Resend error ${res.status}`);
  return data;
}

// ── Brevo ──────────────────────────────────────────────────
async function brevoRequest(apiKey, path, body) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Brevo error ${res.status}`);
  return data;
}

function parseFrom(fromStr, fallbackName = 'Maxvolt HR', fallbackEmail = 'noreply@maxvoltenergy.com') {
  if (!fromStr) return { name: fallbackName, email: fallbackEmail };
  const match = fromStr.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim() || fallbackName, email: match[2].trim() };
  if (fromStr.includes('@')) return { name: fallbackName, email: fromStr.trim() };
  return { name: fallbackName, email: fallbackEmail };
}

// ── Public API ─────────────────────────────────────────────

export async function verifyEmail() {
  const provider = getProvider();

  if (provider === 'brevo') {
    const key = getBrevoKey();
    if (!key) return { ok: false, error: 'Brevo API key not configured. Add it in Admin Panel → Email Settings.' };
    try {
      await brevoRequest(key, '/account');
      return { ok: true, provider: 'brevo' };
    } catch (e) {
      return { ok: false, provider: 'brevo', error: `Brevo: ${e.message}` };
    }
  }

  // Default: Resend
  const key = getResendKey();
  if (!key) return { ok: false, error: 'Resend API key not configured. Add it in Admin Panel → Email Settings.' };
  try {
    await resendRequest(key, '/domains');
    return { ok: true, provider: 'resend' };
  } catch (e) {
    return { ok: false, provider: 'resend', error: `Resend: ${e.message}` };
  }
}

export async function sendEmail({ to, subject, html, text }) {
  const provider = getProvider();
  const fromStr  = getFromAddress();

  if (provider === 'brevo') {
    const key = getBrevoKey();
    if (!key) { console.warn('[email] Brevo not configured — skipped:', subject); return { skipped: true }; }
    const { name, email } = parseFrom(fromStr);
    const toArr = Array.isArray(to) ? to.map(e => ({ email: e })) : [{ email: to }];
    const data = await brevoRequest(key, '/smtp/email', {
      sender: { name, email },
      to: toArr,
      subject,
      htmlContent: html,
      textContent: text,
    });
    return { success: true, messageId: data.messageId, provider: 'brevo' };
  }

  // Default: Resend
  const key = getResendKey();
  if (!key) { console.warn('[email] Resend not configured — skipped:', subject); return { skipped: true }; }
  const from = fromStr || 'Maxvolt HR <onboarding@resend.dev>';
  const data = await resendRequest(key, '/emails', { from, to, subject, html, text });
  return { success: true, messageId: data.id, provider: 'resend' };
}

export function getSmtpPublicConfig() {
  const provider = getProvider();
  return {
    provider,
    from:         getSetting('SMTP_FROM', ''),
    hasResendKey: !!getResendKey(),
    hasBrevoKey:  !!getBrevoKey(),
    activeProvider: provider === 'brevo' && getBrevoKey() ? 'brevo'
                  : provider === 'resend' && getResendKey() ? 'resend'
                  : 'none',
  };
}

export const emailTemplates = {
  interviewInvite: ({ candidateName, position, interviewDate, interviewTime, mode, location, interviewerName }) => ({
    subject: `Interview Invitation — ${position} at Maxvolt Energy`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#2563eb;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0">Interview Invitation</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>Dear <strong>${candidateName}</strong>,</p>
    <p>We are pleased to invite you for an interview for the <strong>${position}</strong> position at Maxvolt Energy Industries Limited.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;background:#f8fafc;font-weight:bold;width:40%">Date</td><td style="padding:8px">${interviewDate || 'TBD'}</td></tr>
      <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Time</td><td style="padding:8px">${interviewTime || 'TBD'}</td></tr>
      <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Mode</td><td style="padding:8px">${mode || 'In-person'}</td></tr>
      ${location ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Venue / Link</td><td style="padding:8px">${location}</td></tr>` : ''}
      ${interviewerName ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Interviewer</td><td style="padding:8px">${interviewerName}</td></tr>` : ''}
    </table>
    <p>Please confirm your availability by replying to this email.</p>
    <p style="color:#64748b;font-size:13px;margin-top:24px">Regards,<br><strong>HR Team</strong><br>Maxvolt Energy Industries Limited</p>
  </div>
</div>`,
  }),

  payslip: ({ employeeName, month, year, payslipHtml }) => ({
    subject: `Your Payslip — ${month} ${year} | Maxvolt Energy`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <p>Dear <strong>${employeeName}</strong>,</p>
  <p>Please find your payslip for <strong>${month} ${year}</strong> below.</p>
  ${payslipHtml}
  <p style="color:#64748b;font-size:12px;margin-top:16px">This is a system-generated email. Do not reply.</p>
</div>`,
  }),

  leaveUpdate: ({ employeeName, leaveType, startDate, endDate, days, status, remarks }) => ({
    subject: `Leave ${status === 'approved' ? 'Approved ✓' : 'Rejected ✗'} — ${leaveType}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <p>Dear <strong>${employeeName}</strong>,</p>
  <p>Your leave request has been <strong style="color:${status === 'approved' ? '#16a34a' : '#dc2626'}">${status.toUpperCase()}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold;width:40%">Leave Type</td><td style="padding:8px">${leaveType}</td></tr>
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">From</td><td style="padding:8px">${startDate}</td></tr>
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">To</td><td style="padding:8px">${endDate}</td></tr>
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Days</td><td style="padding:8px">${days}</td></tr>
    ${remarks ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Remarks</td><td style="padding:8px">${remarks}</td></tr>` : ''}
  </table>
  <p style="color:#64748b;font-size:13px;margin-top:24px">Regards,<br><strong>HR Team</strong><br>Maxvolt Energy Industries Limited</p>
</div>`,
  }),

  trainingNotification: ({ employeeName, trainingTitle, startDate, endDate, trainer, location }) => ({
    subject: `Training Scheduled: ${trainingTitle}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <p>Dear <strong>${employeeName}</strong>,</p>
  <p>You have been enrolled in the following training programme:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold;width:40%">Programme</td><td style="padding:8px">${trainingTitle}</td></tr>
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Start Date</td><td style="padding:8px">${startDate}</td></tr>
    <tr><td style="padding:8px;background:#f8fafc;font-weight:bold">End Date</td><td style="padding:8px">${endDate}</td></tr>
    ${trainer ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Trainer</td><td style="padding:8px">${trainer}</td></tr>` : ''}
    ${location ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:bold">Location</td><td style="padding:8px">${location}</td></tr>` : ''}
  </table>
  <p style="color:#64748b;font-size:13px;margin-top:24px">Regards,<br><strong>HR Team</strong><br>Maxvolt Energy Industries Limited</p>
</div>`,
  }),

  testEmail: ({ to }) => ({
    subject: 'Maxvolt HR — Email Test ✓',
    html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px;text-align:center">
  <div style="background:#2563eb;width:64px;height:64px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px">
    <span style="color:#fff;font-size:28px">✓</span>
  </div>
  <h2 style="color:#1e293b;margin:0 0 8px">Email is working!</h2>
  <p style="color:#64748b">Your Maxvolt HR system is correctly configured to send automated emails.</p>
  <p style="color:#94a3b8;font-size:12px;margin-top:24px">Sent from Maxvolt HR self-hosted system</p>
</div>`,
  }),
};
