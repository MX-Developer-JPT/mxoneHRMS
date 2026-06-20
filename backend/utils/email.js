import { one } from '../db.js';

async function getSetting(key, fallback = '') {
  try {
    const row = await one('SELECT value FROM settings WHERE key=$1', [key]);
    if (row?.value) return row.value;
  } catch {}
  return process.env[key] || fallback;
}

async function getProvider()    { return getSetting('EMAIL_PROVIDER', 'resend'); }
async function getResendKey()   { return getSetting('RESEND_API_KEY', ''); }
async function getBrevoKey()    { return getSetting('BREVO_API_KEY', ''); }
async function getFromAddress() {
  const from = await getSetting('SMTP_FROM', '');
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
  const provider = await getProvider();

  if (provider === 'brevo') {
    const key = await getBrevoKey();
    if (!key) return { ok: false, error: 'Brevo API key not configured. Add it in Admin Panel → Email Settings.' };
    try {
      await brevoRequest(key, '/account');
      return { ok: true, provider: 'brevo' };
    } catch (e) {
      return { ok: false, provider: 'brevo', error: `Brevo: ${e.message}` };
    }
  }

  const key = await getResendKey();
  if (!key) return { ok: false, error: 'Resend API key not configured. Add it in Admin Panel → Email Settings.' };
  try {
    await resendRequest(key, '/domains');
    return { ok: true, provider: 'resend' };
  } catch (e) {
    return { ok: false, provider: 'resend', error: `Resend: ${e.message}` };
  }
}

export async function sendEmail({ to, subject, html, text }) {
  const provider = await getProvider();
  const fromStr  = await getFromAddress();

  if (provider === 'brevo') {
    const key = await getBrevoKey();
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

  const key = await getResendKey();
  if (!key) { console.warn('[email] Resend not configured — skipped:', subject); return { skipped: true }; }
  const from = fromStr || 'Maxvolt HR <onboarding@resend.dev>';
  const data = await resendRequest(key, '/emails', { from, to, subject, html, text });
  return { success: true, messageId: data.id, provider: 'resend' };
}

export async function getSmtpPublicConfig() {
  const provider    = await getProvider();
  const resendKey   = await getResendKey();
  const brevoKey    = await getBrevoKey();
  const from        = await getSetting('SMTP_FROM', '');
  return {
    provider,
    from,
    hasResendKey:   !!resendKey,
    hasBrevoKey:    !!brevoKey,
    activeProvider: provider === 'brevo' && brevoKey ? 'brevo'
                  : provider === 'resend' && resendKey ? 'resend'
                  : 'none',
  };
}

// ── Shared email chrome ────────────────────────────────────
const APP_URL  = process.env.APP_URL || 'https://your-app.railway.app';
const LOGO_URL = `${APP_URL}/maxvolt-logo.jpg`;

function emailHeader(title, accentColor = '#344055') {
  return `
<div style="background:${accentColor};padding:20px 28px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:16px">
  <img src="${LOGO_URL}" alt="MaxVolt Energy" style="height:40px;width:auto;object-fit:contain;filter:brightness(0) invert(1);border-radius:4px" />
  <div style="flex:1">
    <div style="color:#ffffff;font-size:18px;font-weight:700">${title}</div>
    <div style="color:rgba(255,255,255,0.65);font-size:11px;margin-top:2px">Maxvolt Energy Industries Limited</div>
  </div>
</div>`;
}

function emailFooter() {
  return `
<div style="border-top:1px solid #e2e8f0;padding:16px 28px;background:#f8fafc;border-radius:0 0 12px 12px;text-align:center">
  <img src="${LOGO_URL}" alt="MaxVolt Energy" style="height:32px;width:auto;object-fit:contain;margin-bottom:8px" />
  <div style="font-size:12px;color:#94a3b8;margin-top:4px">This is an automated message. Do not reply to this email.</div>
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
