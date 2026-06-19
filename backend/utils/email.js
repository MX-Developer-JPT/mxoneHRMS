import nodemailer from 'nodemailer';
import db from '../db.js';

const PLACEHOLDER = 'your_16_char_app_password_here';

// Read a setting: DB value takes priority over .env
function getSetting(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (row?.value) return row.value;
  } catch {}
  return process.env[key] || fallback;
}

function getSmtpConfig() {
  return {
    host:   getSetting('SMTP_HOST',   'smtp.gmail.com'),
    port:   parseInt(getSetting('SMTP_PORT', '587'), 10),
    secure: getSetting('SMTP_SECURE', 'false') === 'true',
    user:   getSetting('SMTP_USER',   ''),
    pass:   getSetting('SMTP_PASS',   ''),
    from:   getSetting('SMTP_FROM',   ''),
  };
}

function isConfigured(cfg) {
  return !!(cfg.user && cfg.pass && cfg.pass !== PLACEHOLDER);
}

function makeTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
}

export async function verifyEmail() {
  const cfg = getSmtpConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: 'SMTP not configured. Enter your credentials in Admin Panel → Email Settings.' };
  }
  try {
    const transporter = makeTransporter(cfg);
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after 10s. Check your internet or SMTP settings.')), 10000)),
    ]);
    return { ok: true, user: cfg.user };
  } catch (err) {
    let hint = err.message;
    if (err.message.includes('535') || err.message.includes('Username and Password not accepted')) {
      hint = 'Invalid App Password. Use the 16-character App Password from myaccount.google.com/security → App Passwords (not your regular Google password).';
    } else if (err.message.includes('534') || err.message.includes('less secure')) {
      hint = 'Google rejected the login. Enable 2-Step Verification first, then create an App Password.';
    } else if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
      hint = `Cannot reach ${cfg.host}:${cfg.port}. Check your internet connection.`;
    }
    return { ok: false, error: hint };
  }
}

export async function sendEmail({ to, subject, html, text }) {
  const cfg = getSmtpConfig();
  if (!isConfigured(cfg)) {
    console.warn('[email] SMTP not configured — skipped:', subject);
    return { skipped: true, reason: 'SMTP not configured in Admin Panel → Email Settings' };
  }
  const from = cfg.from || `Maxvolt HR <${cfg.user}>`;
  const info = await makeTransporter(cfg).sendMail({ from, to, subject, html, text });
  return { success: true, messageId: info.messageId };
}

export function getSmtpPublicConfig() {
  const cfg = getSmtpConfig();
  return {
    host:     cfg.host,
    port:     cfg.port,
    secure:   cfg.secure,
    user:     cfg.user,
    from:     cfg.from,
    hasPass:  isConfigured(cfg),
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
