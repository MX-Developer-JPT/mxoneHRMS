// Emails for the probation confirmation workflow. Every one of them copies all HR mailboxes configured in the Admin Panel
// (explicitly, so the copy does not depend on the general "HR copy" switch).
import { sendEmail } from './email.js';
import { hrRecipients } from './hrMail.js';

const FALLBACK = () => process.env.HR_EMAIL || 'hr@maxvoltenergy.com';
const appUrl = () => process.env.APP_URL || 'https://maxone.maxvoltenergy.com';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WORDS = { confirm: 'Confirm', extend: 'Extend probation', reject: 'Do not confirm', confirmed: 'Confirmed', extended: 'Probation extended', rejected: 'Not confirmed' };

// Who the mail is addressed to, with HR in CC. With nobody to address, HR becomes the recipient.
export async function withHrCopy(to) {
  const hr = await hrRecipients(FALLBACK());
  const list = [].concat(to || []).filter((a) => String(a || '').includes('@') && !String(a).includes('.disabled-'));
  return list.length ? { to: list, cc: hr } : { to: hr, cc: [] };
}

export function reviewMail({ title, intro, review, remarks }) {
  const rows = [
    ['Employee', review.employee_name],
    ['Department', review.department],
    ['Probation end date', review.probation_end_date],
    ['Recommendation', WORDS[review.action]],
    ['Final decision', WORDS[review.final_action]],
    ['Extended until', [review.action, review.final_action].some((a) => /^extend/.test(a || '')) ? review.extended_until : ''],
    ['Reviewed by', review.manager_name],
    ['Remarks', remarks],
  ].filter(([, v]) => v);
  const table = rows.map(([k, v]) => `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0;font-weight:600">${k}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(v)}</td></tr>`).join('');
  return {
    subject: `${title} — ${review.employee_name}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b"><p>${esc(intro)}</p><table style="border-collapse:collapse">${table}</table><p><a href="${appUrl()}/ConfirmationManagement">Open Confirmation Management</a></p></div>`,
    text: `${intro}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${appUrl()}/ConfirmationManagement`,
  };
}

// Never throws and is not awaited by callers: a mail problem must not undo or delay a recorded review.
export async function sendProbationReviewMail({ to, ...content }) {
  try {
    await sendEmail({ ...(await withHrCopy(to)), ...reviewMail(content), meta: { source: 'probation-review' } });
    return true;
  } catch (e) {
    console.warn('[probation-mail] not sent:', e.message);
    return false;
  }
}
