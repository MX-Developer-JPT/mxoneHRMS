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

  otpEmail: ({ name, code, expiresMinutes = 10 }) => ({
    subject: 'Your Maxvolt HR Verification Code',
    html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px">
  <div style="background:#2563eb;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0">Email Verification</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 8px 8px">
    <p>Hi <strong>${name || 'there'}</strong>,</p>
    <p>Use the code below to verify your email address. It expires in <strong>${expiresMinutes} minutes</strong>.</p>
    <div style="text-align:center;margin:28px 0">
      <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#2563eb;background:#eff6ff;padding:16px 24px;border-radius:8px;display:inline-block">${code}</span>
    </div>
    <p style="color:#64748b;font-size:13px">If you did not request this, you can ignore this email.</p>
    <p style="color:#64748b;font-size:13px;margin-top:16px">Regards,<br><strong>Maxvolt HR Team</strong></p>
  </div>
</div>`,
    text: `Your Maxvolt HR verification code is: ${code}\nExpires in ${expiresMinutes} minutes.`,
  }),

  passwordResetEmail: ({ name, resetLink }) => ({
    subject: 'Reset your Maxvolt HR password',
    html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px">
  <div style="background:#2563eb;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0">Password Reset</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 8px 8px">
    <p>Hi <strong>${name || 'there'}</strong>,</p>
    <p>We received a request to reset your Maxvolt HR password. Click the button below to set a new password.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${resetLink}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Reset Password</a>
    </div>
    <p style="color:#64748b;font-size:13px">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, ignore this email — your password won't change.</p>
    <p style="color:#64748b;font-size:12px;word-break:break-all">Or copy this link: ${resetLink}</p>
  </div>
</div>`,
    text: `Reset your Maxvolt HR password: ${resetLink}\nThis link expires in 1 hour.`,
  }),

  onboardingApprovedEmail: ({ name, role, department }) => ({
    subject: 'Welcome to Maxvolt Energy — Onboarding Approved ✓',
    html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px">
  <div style="background:#16a34a;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0">Onboarding Approved!</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 8px 8px">
    <p>Dear <strong>${name || 'Employee'}</strong>,</p>
    <p>We are pleased to inform you that your onboarding has been <strong style="color:#16a34a">approved</strong>. You are now an official member of the Maxvolt Energy team!</p>
    ${department ? `<p><strong>Department:</strong> ${department}</p>` : ''}
    ${role ? `<p><strong>Role:</strong> ${role}</p>` : ''}
    <p>Please log in to the HR portal to complete any remaining setup and explore your employee dashboard.</p>
    <p style="color:#64748b;font-size:13px;margin-top:24px">Regards,<br><strong>HR Team</strong><br>Maxvolt Energy Industries Limited</p>
  </div>
</div>`,
    text: `Dear ${name}, your onboarding has been approved. Welcome to Maxvolt Energy!`,
  }),

  onboardingRejectedEmail: ({ name, reason }) => ({
    subject: 'Maxvolt HR — Onboarding Submission Requires Corrections',
    html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px">
  <div style="background:#dc2626;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0">Action Required</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 8px 8px">
    <p>Dear <strong>${name || 'Applicant'}</strong>,</p>
    <p>Your onboarding submission has been reviewed and requires corrections before it can be approved.</p>
    ${reason ? `<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0"><strong>Reason:</strong> ${reason}</div>` : ''}
    <p>Please log back in to the HR portal, make the necessary corrections, and re-submit your documents.</p>
    <p style="color:#64748b;font-size:13px;margin-top:24px">Regards,<br><strong>HR Team</strong><br>Maxvolt Energy Industries Limited</p>
  </div>
</div>`,
    text: `Dear ${name}, your onboarding submission requires corrections. Reason: ${reason || 'Please check the HR portal for details.'}`,
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
