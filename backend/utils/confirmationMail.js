// Emails and the Confirmation Letter of the confirmation workflow. Every mail copies all HR mailboxes (Admin Panel).
import { sendEmail } from './email.js';
import { withHrCopy } from './probationMail.js';
import { signatoryHtml, resolveSigner } from './signatory.js';

const appUrl = () => process.env.APP_URL || 'https://maxone.maxvoltenergy.com';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const longDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');

function frame(greeting, paragraphs, rows = [], link) {
  const table = rows.length ? `<table style="border-collapse:collapse;margin:12px 0">${rows.map(([k, v]) => `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0;font-weight:600">${esc(k)}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(v || '—').replace(/\n/g, '<br/>')}</td></tr>`).join('')}</table>` : '';
  const button = link ? `<p><a href="${appUrl()}/ConfirmationManagement">Open Confirmation Management</a></p>` : '';
  return {
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b"><p>${esc(greeting)}</p>${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${table}${button}<p style="color:#64748b;font-size:12px">This is an automated message from Maxvolt One.</p></div>`,
    text: [greeting, ...paragraphs, ...rows.map(([k, v]) => `${k}: ${v || '—'}`), link ? `${appUrl()}/ConfirmationManagement` : ''].filter(Boolean).join('\n\n'),
  };
}

const details = (p) => [['Employee name', p.name], ['Employee ID', p.code], ['Department', p.department], ['Designation', p.designation], ['Date of joining', longDate(p.joined)], ['Confirmation due date', longDate(p.due)]];

export const mails = {
  // to the reporting manager when HR starts (or restarts) the process. HR's observations stay inside the app.
  request: (p) => ({ subject: `Confirmation assessment requested — ${p.name} (${p.code})`,
    ...frame(`Dear ${p.managerName || 'Manager'},`, ['HR has started the confirmation process for your team member. Please complete the confirmation assessment and submit your final decision: Confirm, Hold or Reject.', p.hasObservations ? 'HR has recorded observations for you. They are shown with the assessment in Maxvolt One.' : ''].filter(Boolean), details(p), true) }),
  reminder: (p) => ({ subject: `Confirmation due in ${p.daysLeft} days — ${p.name} (${p.code})`,
    ...frame(`Dear ${p.managerName || 'HR Team'},`, [`The confirmation of your team member is due on ${longDate(p.due)}, ${p.daysLeft} days from today.`, p.started ? 'Please complete the confirmation assessment and submit your final decision in Maxvolt One.' : 'Please complete the confirmation assessment and submit your final decision. If the request is not yet in Maxvolt One, HR (copied here) will initiate it.'], details(p), true) }),
  confirmed: (p) => ({ subject: 'Confirmation Letter — Maxvolt Energy Industries Limited',
    ...frame(`Dear ${p.name},`, [`Congratulations! Your employment has been confirmed with effect from ${longDate(p.effective)}.`, 'Your Confirmation Letter is attached to this email. It is also available in your documents in Maxvolt One.']) }),
  on_hold: (p) => ({ subject: 'Your confirmation has been deferred — Maxvolt Energy Industries Limited',
    ...frame(`Dear ${p.name},`, ['Your confirmation has been deferred by your reporting manager. Your probation continues until the revised review date below.'], [['Reason / remarks', p.remarks], ['Revised review date', longDate(p.reviewDate)], ['Reporting manager', p.managerName]]) }),
  rejected: (p) => ({ subject: 'Decision on your confirmation — Maxvolt Energy Industries Limited',
    ...frame(`Dear ${p.name},`, ['After assessing your probation period, your reporting manager has not recommended your confirmation.', 'HR will review the decision and contact you about the next steps.'], [['Reason / remarks', p.remarks], ['Reporting manager', p.managerName]]) }),
};

/** Sends one workflow mail with HR in CC; returns what to record. Never throws. */
export async function deliver(to, content, attachments) {
  const addressed = await withHrCopy(to);
  const base = { to: [].concat(addressed.to), cc: [].concat(addressed.cc || []), subject: content.subject, at: new Date().toISOString() };
  try {
    const r = await sendEmail({ ...addressed, ...content, ...(attachments ? { attachments } : {}), meta: { source: 'probation-review', confirm: true } });
    return { ...base, status: 'sent', message_id: r?.messageId || '' };
  } catch (e) {
    console.warn(`[confirmation] "${content.subject}" not sent: ${e.message}`);
    return { ...base, status: 'failed', error: e.message };
  }
}

/** The Confirmation Letter (same wording as the Letter Generator's template) with the standard signatory block. */
export function confirmationLetterHtml({ name, gender, designation, effective, signatories = [], stamp = '' }) {
  const title = String(gender || '').toLowerCase() === 'female' ? 'Ms.' : 'Mr.';
  const P = (t) => `<p style="margin:0 0 12px;text-align:justify;">${t}</p>`;
  const eff = longDate(effective), role = esc(designation || 'Employee');
  return `<div style="font-family:Arial,sans-serif;font-size:13.5px;line-height:1.75;color:#111;">
<p style="text-align:center;font-weight:bold;font-size:17px;margin:0 0 22px;">Letter of Confirmation</p>
<p style="margin:0 0 22px;">${longDate(effective)}</p>
${P(`Dear ${title} ${esc(name)},`)}
<p style="font-weight:bold;margin:0 0 10px;">Congratulations!</p>
${P(`<strong>Subject</strong>: Service Confirmation Letter to the Designation of &ldquo;${role}&rdquo;`)}
${P('Following completion of your probation period at Maxvolt Energy Industries Limited, we have reviewed your performance and found the same to be satisfactory.')}
${P(`In view of the above, we are pleased to inform you that you have been confirmed to the position of &ldquo;<strong>${role}</strong>&rdquo; at Maxvolt Energy Industries Limited with effect from <strong>${eff}</strong>.`)}
${P('All other terms and conditions of your appointment will remain the same except the following.')}
${P('<strong>Notice Period</strong> &ndash; Either party may at any time terminate the employment, without cause by giving in writing to the other party a notice period of 30 Days. You may alternatively exercise the option of buying out your notice period per the terms and conditions of your employment letter. The payment of salary during such notice period would be on the basis of cost to Our Company.')}
${P(`<strong>Leave Credit</strong> &ndash; Starting <strong>${eff}</strong>, you are eligible to accrue and use earned leave as per the company&rsquo;s leave policy.`)}
${P('<strong>Salary Settlement (Full &amp; Final)</strong> &ndash; The full and final settlement of the employee&rsquo;s salary account is done after 45 days of the employee&rsquo;s last working day, provided the notice period has been served and clearance letters from HR, IT, Accounts and Administration have been issued.')}
${P('Please signify your acceptance of the terms and conditions mentioned above and in the company&rsquo;s policy handbook by signing this letter and returning it at the earliest convenient time.')}
${P('In case you have any queries, do not hesitate to reach your manager or the HR Department.')}
${P('Maxvolt Energy Industries Limited congratulates you on your confirmation and wishes you well in your position.')}
<p style="margin:16px 0 0;">Sincerely,</p>
${signatoryHtml(resolveSigner(signatories, { role: 'HR Head' }), { stamp })}
<p style="margin:24px 0 0;">Employee Signature: ______________________ &nbsp;&nbsp; Date: ______________</p>
</div>`;
}
