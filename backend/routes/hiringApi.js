// Entry point for every `rh_*` function, the Recruitment MIS endpoints, the public email-decision pages and the reminder job.
import { Router } from 'express';
import express from 'express';
import { one, all, run } from '../db.js';
import { sendEmail } from '../utils/email.js';
import { computeHiringMis, loadHiringData, METRIC_LABELS } from '../utils/hiringMetrics.js';
import * as LC from '../utils/hiringLifecycle.js';
import { renderPdf } from '../utils/pdfRender.js';
import { sheetWithTitle, table, section, fmtD } from '../utils/misReport.js';
import HR_ from './hiring.js';
import HI_ from './hiringInterviews.js';
import { loadBatch, saveBatch, applyDecision, notifyDecision, notifyUsers, DECISIONS, esc, appUrl, jparse, hasAny, fail, candName, loadReq, reqTitle, READ, nowIso, loadConfig } from './hiring.js';

const MIS = {
  async rh_mis({ p, cx, res }) {
    if (!hasAny(cx, READ)) return fail(res, 'Not allowed', 403);
    const D = await loadHiringData();
    const out = computeHiringMis(D, p.filters || {});
    // filter lists for the screen
    const opts = {
      departments: [...new Set(D.reqs.map((r) => r.department).filter(Boolean))].sort(),
      designations: [...new Set(D.reqs.map((r) => r.designation || r.position_title).filter(Boolean))].sort(),
      managers: [...new Map(D.reqs.filter((r) => r.hiring_manager_id).map((r) => [r.hiring_manager_id, D.emps.find((e) => e.user_id === r.hiring_manager_id)?.display_name || r.hiring_manager_name || r.hiring_manager_id])).entries()].map(([id, name]) => ({ id, name })),
      hods: [...new Map(D.depts.filter((d) => d.head_user_id).map((d) => [d.head_user_id, D.emps.find((e) => e.user_id === d.head_user_id)?.display_name || d.head_user_id])).entries()].map(([id, name]) => ({ id, name })),
      recruiters: [...new Map([...D.batches.map((b) => [b.created_by, b.created_by_name]), ...D.interviews.filter((i) => i.created_by).map((i) => [i.created_by, i.created_by_name])].filter(([id]) => id)).entries()].map(([id, name]) => ({ id, name })),
      requisitions: D.reqs.map((r) => ({ id: r.id, label: `${r.id} — ${r.designation || r.position_title || ''}`, department: r.department || '' })),
      sources: [...new Set(D.cands.map((c) => c.source || 'walk_in'))].sort(), statuses: [...new Set(D.reqs.map((r) => (r.status === 'closed' && r.closed_reason === 'filled' ? 'filled' : r.status)))].filter(Boolean).sort(),
    };
    return res.json({ success: true, ...out, options: opts, metric_labels: METRIC_LABELS });
  },

  async rh_mis_export({ p, cx, res }) {
    if (!hasAny(cx, READ)) return fail(res, 'Not allowed', 403);
    const D = await loadHiringData();
    const m = computeHiringMis(D, p.filters || {});
    const sub = `Generated ${fmtD(m.generated)} · calendar days (business days shown separately; weekly off: ${D.weeklyOff.length ? D.weeklyOff.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : 'none'}${D.useHolidays ? ' + company holidays' : ''})`;
    if (p.format === 'pdf') {
      const rows = (arr, cols) => ({ table: { headerRows: 1, widths: cols.map(() => '*'), body: [cols.map((c) => ({ text: c[0], bold: true, fillColor: '#e2e8f0', fontSize: 8 })), ...arr.map((r) => cols.map((c) => ({ text: String(c[1](r) ?? ''), fontSize: 8 })))] }, layout: 'lightHorizontalLines', margin: [0, 4, 0, 10] });
      const doc = { pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 30, 28, 30], defaultStyle: { font: 'Roboto', fontSize: 9 }, content: [
        { text: 'Recruitment MIS — lifecycle & turnaround', fontSize: 16, bold: true }, { text: sub, fontSize: 8, color: '#64748b', margin: [0, 2, 0, 8] },
        { text: 'Key numbers', bold: true, fontSize: 11 }, { text: `MRFs ${m.kpis.mrfs} (${m.kpis.open_mrfs} open) · Applications ${m.kpis.applications} · CVs sent ${m.kpis.cvs_sent} in ${m.kpis.review_batches} batch(es) · Interviews ${m.kpis.interviews} · Selected ${m.kpis.selected} · Offers ${m.kpis.offers} · Joined ${m.kpis.joined} · Reviews pending ${m.kpis.pending_reviews} (${m.kpis.overdue_reviews} overdue) · Feedback pending ${m.kpis.pending_feedback}`, margin: [0, 2, 0, 8] },
        { text: 'Funnel', bold: true, fontSize: 11 }, rows(m.funnel, [['Stage', (r) => r.stage], ['Candidates', (r) => r.count], ['From previous stage', (r) => `${r.from_previous}%`], ['Of all applications', (r) => `${r.of_total}%`]]),
        { text: 'Turnaround (days)', bold: true, fontSize: 11 }, rows(Object.entries(m.metrics), [['Metric', ([k]) => METRIC_LABELS[k]?.[0] || k], ['Definition', ([k]) => METRIC_LABELS[k]?.[1] || ''], ['Average (cal)', ([, v]) => v.avg_cal ?? '—'], ['Median (cal)', ([, v]) => v.median_cal ?? '—'], ['Average (business)', ([, v]) => v.avg_biz ?? '—'], ['MRFs measured', ([, v]) => v.samples]]),
        { text: 'Requisitions', bold: true, fontSize: 11 }, rows(m.mrfs, [['MRF', (r) => r.id], ['Position', (r) => r.title], ['Dept', (r) => r.department], ['Status', (r) => r.status], ['CVs sent', (r) => r.counts.cvs_sent], ['Batches', (r) => r.counts.batches], ['Mgr response', (r) => r.metrics.manager_response_tat.cal ?? '—'], ['To first CV', (r) => r.metrics.time_to_first_cv.cal ?? '—'], ['Selection TAT', (r) => r.metrics.selection_tat.cal ?? '—'], ['Time to fill', (r) => r.metrics.time_to_fill.cal ?? '—']]),
        { text: 'Recruiters', bold: true, fontSize: 11 }, rows(m.recruiters, [['Recruiter', (r) => r.name], ['CVs screened', (r) => r.screened], ['CVs submitted', (r) => r.cvs_submitted], ['Review batches', (r) => r.batches], ['Interviews coordinated', (r) => r.interviews_coordinated], ['Hired', (r) => r.hired]]),
      ] };
      const buf = await renderPdf(doc);
      return res.json({ success: true, base64: buf.toString('base64'), filename: `Recruitment_MIS_${m.generated}.pdf`, mime: 'application/pdf' });
    }
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
    let ws = sheetWithTitle(wb, 'Summary', 'Recruitment MIS — lifecycle & turnaround', sub, 8);
    table(ws, ['Measure', 'Value'], Object.entries({ 'Requisitions': m.kpis.mrfs, 'Open requisitions': m.kpis.open_mrfs, 'Applications': m.kpis.applications, 'Unique CVs sent for review': m.kpis.cvs_sent, 'CV review batches': m.kpis.review_batches, 'Interviews': m.kpis.interviews, 'Selected': m.kpis.selected, 'Offers released': m.kpis.offers, 'Joined': m.kpis.joined, 'Reviews pending': m.kpis.pending_reviews, 'Reviews overdue': m.kpis.overdue_reviews, 'Interview feedback pending': m.kpis.pending_feedback }), [40, 14]);
    section(ws, 'Turnaround (days)'); table(ws, ['Metric', 'Definition', 'Average (calendar)', 'Median (calendar)', 'Average (business)', 'MRFs measured'], Object.entries(m.metrics).map(([k, v]) => [METRIC_LABELS[k]?.[0] || k, METRIC_LABELS[k]?.[1] || '', v.avg_cal ?? '', v.median_cal ?? '', v.avg_biz ?? '', v.samples]), [40, 44, 18, 18, 18, 14]);
    ws = sheetWithTitle(wb, 'Funnel', 'Recruitment funnel', sub, 4); table(ws, ['Stage', 'Candidates', 'From previous stage %', 'Of all applications %'], m.funnel.map((r) => [r.stage, r.count, r.from_previous, r.of_total]), [38, 14, 22, 22]);
    ws = sheetWithTitle(wb, 'MRF Timeline', 'Timeline and turnaround per requisition', sub, 30);
    const T = ['created', 'approved', 'published', 'first_application', 'first_screening', 'first_cv_sent', 'last_cv_sent', 'first_manager_response', 'first_interview_scheduled', 'first_interview_conducted', 'selection', 'offer_release', 'joining', 'closure'];
    const TL = ['MRF created', 'MRF approved', 'Job published', 'First application', 'First CV screening', 'First CV sent', 'Last CV sent', 'First manager / HOD response', 'First interview scheduled', 'First interview conducted', 'Candidate selected', 'Offer released', 'Joined', 'MRF closed'];
    const MK = Object.keys(METRIC_LABELS);
    table(ws, ['MRF', 'Position', 'Department', 'Hiring Manager', 'HOD', 'Status', 'Positions', 'Filled', 'Applications', 'CVs sent', 'Batches', 'Interviews', ...TL, ...MK.flatMap((k) => [`${METRIC_LABELS[k][0]} (cal)`, `${METRIC_LABELS[k][0]} (biz)`])],
      m.mrfs.map((r) => [r.id, r.title, r.department, r.hiring_manager, r.hod, r.status, r.positions, r.filled, r.counts.applications, r.counts.cvs_sent, r.counts.batches, r.counts.interviews, ...T.map((k) => fmtD(r.timeline[k])), ...MK.flatMap((k) => [r.metrics[k].cal ?? '', r.metrics[k].biz ?? ''])]), [14, 26, 18, 20, 20, 14, 9, 8, 11, 9, 9, 10, ...TL.map(() => 14), ...MK.flatMap(() => [12, 12])]);
    ws = sheetWithTitle(wb, 'Departments', 'Department-wise', sub, 10); table(ws, ['Department', 'MRFs', 'Open', 'Applications', 'CVs sent', 'Interviews', 'Offers', 'Joined', 'Avg time to first CV', 'Avg manager response', 'Avg time to fill'], m.departments.map((d) => [d.department, d.mrfs, d.open, d.applications, d.cvs_sent, d.interviews, d.offers, d.joined, d.avg_time_to_first_cv ?? '', d.avg_manager_response ?? '', d.avg_time_to_fill ?? '']), [24, 8, 8, 12, 10, 11, 8, 8, 18, 18, 16]);
    ws = sheetWithTitle(wb, 'Recruiters', 'Recruiter productivity', sub, 6); table(ws, ['Recruiter', 'CVs screened', 'CVs submitted', 'Review batches', 'Interviews coordinated', 'Hired'], m.recruiters.map((r) => [r.name, r.screened, r.cvs_submitted, r.batches, r.interviews_coordinated, r.hired]), [26, 14, 14, 14, 20, 10]);
    ws = sheetWithTitle(wb, 'Pending reviews', 'Waiting on Hiring Manager / HOD', sub, 8); table(ws, ['MRF', 'Position', 'Department', 'Candidate', 'Reviewer', 'Role', 'Sent', 'Days waiting', 'Overdue'], m.pending_reviews.map((r) => [r.requisition_id, r.position, r.department, r.candidate, r.reviewer, r.role, fmtD(r.sent), r.days_waiting, r.overdue ? 'Yes' : '']), [14, 24, 18, 22, 22, 14, 12, 12, 9]);
    ws = sheetWithTitle(wb, 'Pending feedback', 'Interviews with no feedback', sub, 6); table(ws, ['MRF', 'Candidate', 'Round', 'Interview date', 'Interviewers', 'Days overdue'], m.pending_feedback.map((r) => [r.requisition_id, r.candidate, r.round, fmtD(r.date), r.interviewers, r.days_overdue]), [14, 24, 20, 14, 30, 12]);
    const buffer = await wb.xlsx.writeBuffer();
    return res.json({ success: true, base64: Buffer.from(buffer).toString('base64'), filename: `Recruitment_MIS_Lifecycle_${m.generated}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  },
};

const FUNCS = { ...HR_, ...HI_, ...MIS };

export async function handleHiring(name, p, cu, res) {
  if (!cu) return fail(res, 'Unauthorized', 401);
  const u = await one('SELECT role, custom_role, full_name, email FROM users WHERE id=$1', [cu.id]);
  if (!u) return fail(res, 'Unauthorized', 401);
  const emp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [cu.id]);
  const cx = { cu, roles: [u.role, u.custom_role].filter(Boolean), name: jparse(emp?.data)?.display_name || u.full_name || u.email || '' };
  const fn = FUNCS[name];
  if (!fn) return fail(res, `Unknown function ${name}`, 404);
  try { return await fn({ p: p || {}, cx, res }); } catch (e) { console.error(`[hiring/${name}]`, e); if (!res.headersSent) return fail(res, e.message || 'Something went wrong', 500); }
}

// ── reminders: reviewers who have not answered, interviewers who have not given feedback ─────────────────────────
export async function sendHiringReminders() {
  const cfg = await loadConfig(); let sent = 0;
  const batches = (await all("SELECT id FROM entities WHERE type='CvReviewBatch'")).map((r) => r.id);
  for (const id of batches) {
    const b = await loadBatch(id); if (!b) continue;
    let changed = false;
    for (const r of b.recipients || []) {
      if (!r.sent_at || !r.email) continue;
      const pending = (b.candidates || []).filter((x) => !x.decisions?.[r.role]);
      if (!pending.length) continue;
      const lastAt = (r.reminders || []).slice(-1)[0]?.at || r.sent_at;
      if ((Date.now() - Date.parse(lastAt)) / 86400000 < cfg.review_reminder_days) continue;
      if ((r.reminders || []).length >= 3) continue;
      const rows = pending.map((x) => `<li><b>${esc(x.name)}</b> — <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/shortlist">Shortlist</a> · <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/reject">Reject</a> · <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/hold">Hold</a> · <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/more_info">More information</a></li>`).join('');
      try {
        await sendEmail({ to: r.email, subject: `Reminder: CV review pending — ${b.requisition_id} · ${b.position} [${b.id}]`, html: `<div style="font-family:Arial,sans-serif;font-size:14px"><p>Dear ${esc(r.name)},</p><p>Your decision is pending on ${pending.length} profile(s) for ${esc(b.requisition_id)} (${esc(b.position)}). The original email has the CVs attached.</p><ul>${rows}</ul></div>` });
        r.reminders = [...(r.reminders || []), { at: nowIso(), by: 'System' }]; changed = true; sent++;
        b.audit = [...(b.audit || []), { at: nowIso(), action: 'reminder', by: 'System', text: `Automatic reminder to ${r.name}` }];
        if (b.created_by && (cfg.notify?.review_pending?.recruiter ?? true)) await notifyUsers([b.created_by], { title: 'CV review still pending', message: `${r.name} has not responded on ${pending.length} profile(s) for ${b.requisition_id}. A reminder was sent.`, type: 'warning' });
      } catch (e) { console.warn('[hiring] auto reminder failed:', e.message); }
    }
    if (changed) await saveBatch(b);
  }
  return sent;
}

// ── public pages: a Hiring Manager / HOD decides from the email, nothing else is needed ───────────────────────────────
const page = (title, body, color = '#1e3a5f') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif"><div style="max-width:620px;margin:30px auto;padding:0 14px"><div style="background:${color};color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:17px;font-weight:bold">${esc(title)}</div><div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;padding:18px;font-size:14px;color:#0f172a;line-height:1.5">${body}</div><p style="text-align:center;color:#94a3b8;font-size:12px">Maxvolt Energy Industries Limited</p></div></body></html>`;
async function findByToken(token) {
  if (!/^[a-f0-9]{48}$/.test(token || '')) return null;
  const rows = await all("SELECT id, data FROM entities WHERE type='CvReviewBatch' AND data LIKE $1", [`%${token}%`]);
  for (const r of rows) { const b = { ...jparse(r.data), id: r.id }; const rcp = (b.recipients || []).find((x) => x.token === token); if (rcp) return { batch: b, rcp }; }
  return null;
}
const expired = (b) => Date.now() - Date.parse(b.sent_at) > 45 * 86400000;
const summaryList = (b, rcp) => `<table style="width:100%;border-collapse:collapse;margin-top:8px">${(b.candidates || []).map((x) => { const d = x.decisions?.[rcp.role]; return `<tr><td style="padding:6px 4px;border-top:1px solid #e2e8f0"><b>${esc(x.name)}</b></td><td style="padding:6px 4px;border-top:1px solid #e2e8f0;text-align:right">${d ? `<span style="color:${DECISIONS[d.decision].color};font-weight:bold">${DECISIONS[d.decision].short}</span>` : '<span style="color:#94a3b8">Pending</span>'}</td></tr>`; }).join('')}</table>`;

export const publicRouter = Router();
publicRouter.use(express.urlencoded({ extended: false, limit: '20kb' }));
publicRouter.get('/decide/:token/:cid/:decision', async (req, res) => {
  res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex');
  const { token, cid, decision } = req.params;
  const f = await findByToken(token);
  if (!f || !DECISIONS[decision]) return res.status(404).send(page('Link not valid', '<p>This link is not valid. Please use the buttons in the most recent email, or reply to the email with your decision.</p>', '#475569'));
  if (expired(f.batch)) return res.status(410).send(page('Link expired', '<p>This review request is too old to be answered with the link. Please reply to the email with your decision.</p>', '#475569'));
  const x = (f.batch.candidates || []).find((y) => y.candidate_id === cid);
  if (!x) return res.status(404).send(page('Not found', '<p>That candidate is not part of this review request.</p>', '#475569'));
  const prior = x.decisions?.[f.rcp.role];
  const need = decision === 'more_info' ? 'What information do you need? *' : 'Remarks (optional)';
  res.send(page('Confirm your decision', `<p>Hello ${esc(f.rcp.name)},</p><p>Candidate: <b>${esc(x.name)}</b><br>Position: ${esc(f.batch.position)} (${esc(f.batch.requisition_id)})</p>
    <p style="font-size:16px">Your decision: <b style="color:${DECISIONS[decision].color}">${DECISIONS[decision].label}</b></p>${prior ? `<p style="color:#b45309">You previously recorded “${DECISIONS[prior.decision].short}”. Confirming will replace it.</p>` : ''}
    <form method="POST"><label style="font-size:13px;color:#475569">${need}</label><br><textarea name="comment" rows="3" ${decision === 'more_info' ? 'required' : ''} style="width:100%;box-sizing:border-box;margin:6px 0 12px;padding:8px;border:1px solid #cbd5e1;border-radius:6px"></textarea>
    <button type="submit" style="background:${DECISIONS[decision].color};color:#fff;border:0;padding:10px 20px;border-radius:6px;font-size:15px;font-weight:bold;cursor:pointer">Confirm ${esc(DECISIONS[decision].short)}</button></form>`, DECISIONS[decision].color));
});
publicRouter.post('/decide/:token/:cid/:decision', async (req, res) => {
  res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex');
  const { token, cid, decision } = req.params;
  const f = await findByToken(token);
  if (!f || !DECISIONS[decision]) return res.status(404).send(page('Link not valid', '<p>This link is not valid.</p>', '#475569'));
  if (expired(f.batch)) return res.status(410).send(page('Link expired', '<p>This review request is too old. Please reply to the email with your decision.</p>', '#475569'));
  const comment = String(req.body?.comment || '').trim().slice(0, 1000);
  if (decision === 'more_info' && !comment) return res.status(400).send(page('More information', '<p>Please go back and say what information you need.</p>', '#475569'));
  try {
    const batch = await loadBatch(f.batch.id);
    const r = await applyDecision({ batch, candidateId: cid, recipientRole: f.rcp.role, decision, comment, source: 'email_link', byName: f.rcp.name, byEmail: f.rcp.email });
    await saveBatch(batch);
    await notifyDecision(batch, r.candidate, decision, f.rcp.name, r.outcome);
    const note = r.outcome === 'conflict' ? '<p style="color:#b45309">Another reviewer gave a different decision on this candidate, so HR will resolve it.</p>' : decision === 'more_info' ? '<p>HR has been told what you need and will get back to you.</p>' : '';
    res.send(page('Decision recorded', `<p>Thank you, ${esc(f.rcp.name)}. Your decision on <b>${esc((batch.candidates.find((y) => y.candidate_id === cid) || {}).name || '')}</b> — <b style="color:${DECISIONS[decision].color}">${DECISIONS[decision].short}</b> — has been recorded${r.outcome && r.outcome !== 'conflict' && decision !== 'more_info' ? '' : ''}.</p>${note}<p style="margin-top:14px"><b>All candidates in this request</b> (use the buttons in the email to decide on the others):</p>${summaryList(batch, f.rcp)}`, '#16a34a'));
  } catch (e) { console.error('[hiring/public]', e); res.status(500).send(page('Something went wrong', `<p>${esc(e.message)}</p><p>Please reply to the email with your decision instead.</p>`, '#b91c1c')); }
});
