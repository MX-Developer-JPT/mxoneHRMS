// Candidate screening → CV review (by email) → interviews → selection, with a full timeline. Every `rh_*` function lives here
// (dispatched from functions.js); the public email-decision pages are the router exported at the bottom.
//
// The Hiring Manager / HOD decide ONLY by email: each review email has one link per decision per candidate. A link opens a tiny
// confirmation page (so mail scanners that pre-open links cannot decide anything) and records the decision against the candidate
// and the MRF. Where a reply is received instead, HR records the outcome by hand (rh_review_record). Nothing is approved in-app.
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { one, all, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';
import { sendPushToUser } from '../utils/push.js';
import { cacheInvalidate } from './entities.js';
import * as LC from '../utils/hiringLifecycle.js';

const RECRUIT = ['hr', 'admin', 'recruiter'];
const READ = ['hr', 'admin', 'recruiter', 'management'];
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const nowIso = () => new Date().toISOString();
const istDate = (ms = Date.now()) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
const appUrl = () => (process.env.APP_URL || 'https://maxone.maxvoltenergy.com').replace(/\/+$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
const hasAny = (cx, list) => cx.roles.some((r) => list.includes(r));
const reqKey = (c) => c.requisition_id || c.job_requisition_id || c.job_id || '';
const candName = (c) => c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || 'Candidate';
const roleList = (u) => [u?.role, u?.custom_role].filter(Boolean);

async function people() {
  const emps = (await all("SELECT user_id, data FROM entities WHERE type='Employee'")).map((r) => ({ ...(jparse(r.data) || {}), user_id: r.user_id })).filter((e) => e.user_id);
  const users = await all('SELECT id, email, full_name, role, custom_role FROM users');
  const byUser = {}; for (const u of users) byUser[u.id] = u;
  const empBy = {}; for (const e of emps) empBy[e.user_id] = e;
  const name = (id) => empBy[id]?.display_name || byUser[id]?.full_name || byUser[id]?.email || '';
  const email = (id) => byUser[id]?.email || empBy[id]?.work_email || empBy[id]?.email || '';
  return { emps, empBy, byUser, name, email };
}

// ── candidate / requisition access ───────────────────────────────────────────────────────────────────────────────
async function loadCand(id) { const r = await one("SELECT id, data FROM entities WHERE type='Candidate' AND id=$1", [id]); return r ? { ...jparse(r.data), id: r.id } : null; }
async function saveCand(c) {
  await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3 AND type='Candidate'", [JSON.stringify(c), c.status || 'applied', c.id]);
  cacheInvalidate('Candidate');
}
async function loadReq(id) { if (!id) return null; const r = await one("SELECT id, data, created_at FROM entities WHERE type='JobRequisition' AND id=$1", [id]); return r ? { ...jparse(r.data), id: r.id, _created: r.created_at } : null; }
const reqTitle = (r) => r?.designation || r?.position_title || r?.job_title || '';

/** Move a candidate along the lifecycle (or stay put), recording the event on the candidate's timeline. Returns the saved candidate. */
export async function moveCandidate(c, to, { by = '', byName = '', text = '', system = true, role = '', overrideReason = '', ref = null, extra = {} } = {}) {
  const chk = LC.checkTransition(c, to, { system, role, override_reason: overrideReason });
  if (!chk.ok) { const e = new Error(chk.error); e.needsOverride = chk.needs_override; throw e; }
  const from = c.status || 'applied';
  const next = { ...c, ...extra };
  if (to !== from) {
    next.status = to;
    if (to === 'on_hold') next.held_from = from;
    next.timeline = LC.appendTimeline(c, { type: 'status', from, to, text: text || `${LC.statusLabel(from)} → ${LC.statusLabel(to)}`, by, by_name: byName, ref, ...(chk.override ? { override: true, reason: overrideReason } : {}) });
  } else if (text) {
    next.timeline = LC.appendTimeline(c, { type: 'note', text, by, by_name: byName, ref });
  }
  await saveCand(next);
  return next;
}
async function logEvent(c, evt) { const next = { ...c, timeline: LC.appendTimeline(c, evt) }; await saveCand(next); return next; }

// ── config (interview rounds, who is notified about what, business-day rules) ──────────────────────────────────────
const CFG_ID = 'recruitment-config';
async function loadConfig() {
  const r = await one("SELECT data FROM entities WHERE type='RecruitmentConfig' AND id=$1", [CFG_ID]);
  const d = r ? jparse(r.data) || {} : {};
  return {
    rounds: Array.isArray(d.rounds) && d.rounds.length ? d.rounds : LC.DEFAULT_ROUNDS,
    notify: { ...LC.DEFAULT_NOTIFY, ...(d.notify || {}) },
    weekly_off: Array.isArray(d.weekly_off) ? d.weekly_off : [0],
    use_holidays: d.use_holidays !== false,
    review_reminder_days: Number(d.review_reminder_days) > 0 ? Number(d.review_reminder_days) : 2,
    feedback_reminder_hours: Number(d.feedback_reminder_hours) > 0 ? Number(d.feedback_reminder_hours) : 24,
  };
}
export { loadConfig };
const wants = (cfg, event, who) => (cfg.notify?.[event]?.[who] ?? LC.DEFAULT_NOTIFY[event]?.[who]) !== false;

async function notifyUsers(userIds, { title, message, link = '/Recruitment', type = 'info', email = false }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  for (const uid of ids) {
    try { await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), uid, title, message, type, link]); } catch (e) { console.warn('[hiring] notify failed:', e.message); }
    try { sendPushToUser(uid, { title, message, type, link }); } catch { /* best effort */ }
  }
  if (email && ids.length) {
    try {
      const rows = await all('SELECT email FROM users WHERE id = ANY($1::text[])', [ids]);
      const to = rows.map((r) => r.email).filter((e) => e && !e.includes('.disabled-'));
      if (to.length) await sendEmail({ to, subject: title, html: `<div style="font-family:Arial,sans-serif;font-size:14px"><p>${esc(message)}</p><p><a href="${appUrl()}${link}">Open in Maxvolt One</a></p></div>` });
    } catch (e) { console.warn('[hiring] email failed:', e.message); }
  }
}
async function hrAudience() { return (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin') OR role IN ('hr','admin')")).map((r) => r.id); }

// ── CV review batches ────────────────────────────────────────────────────────────────────────────────────────────
const DECISIONS = {
  shortlist: { label: 'Shortlist for interview', short: 'Shortlisted', color: '#16a34a' },
  reject: { label: 'Reject', short: 'Rejected', color: '#dc2626' },
  hold: { label: 'Hold', short: 'On hold', color: '#d97706' },
  more_info: { label: 'Request more information', short: 'More information requested', color: '#2563eb' },
};
async function loadBatch(id) { const r = await one("SELECT id, data, created_at FROM entities WHERE type='CvReviewBatch' AND id=$1", [id]); return r ? { ...jparse(r.data), id: r.id, _created: r.created_at } : null; }
async function saveBatch(b) { const { _created, ...d } = b; await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3 AND type='CvReviewBatch'", [JSON.stringify(d), d.status || 'sent', d.id]); }
async function batchesFor(filter) {
  const rows = (await all("SELECT id, data, created_at FROM entities WHERE type='CvReviewBatch' ORDER BY created_at ASC")).map((r) => ({ ...jparse(r.data), id: r.id, _created: r.created_at })).filter(Boolean);
  return rows.filter(filter || (() => true));
}
const publicBatch = (b) => ({ ...b, recipients: (b.recipients || []).map(({ token, ...r }) => r) });

async function hodFor(req, P) {
  const dep = (await all("SELECT data FROM entities WHERE type='Department'")).map((r) => jparse(r.data)).find((d) => d && d.name === req?.department);
  const id = dep?.head_user_id || req?.hod_user_id || '';
  return id ? { user_id: id, name: P.name(id), email: P.email(id), role: 'hod' } : null;
}
async function recipientsFor(req, P) {
  const out = [];
  const hmId = req?.hiring_manager_id;
  if (hmId) out.push({ user_id: hmId, name: P.name(hmId), email: P.email(hmId), role: 'hiring_manager' });
  const hod = await hodFor(req, P);
  if (hod && !out.some((r) => r.user_id === hod.user_id)) out.push(hod);
  return out;
}

async function fetchCv(c) {
  if (!c.resume_url) return null;
  const url = /^https?:\/\//i.test(c.resume_url) ? c.resume_url : `${appUrl()}${c.resume_url.startsWith('/') ? '' : '/'}${c.resume_url}`;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return { tooBig: true, size: buf.length };
    const ext = (url.split('?')[0].match(/\.(pdf|docx?|rtf|txt)$/i) || [, 'pdf'])[1].toLowerCase();
    return { buf, filename: `${candName(c).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Candidate'}_CV.${ext}` };
  } catch { return null; }
}

function reviewEmailHtml({ batch, req, recipient, cands, sender, note }) {
  const link = (cid, d) => `${appUrl()}/api/hiring/decide/${recipient.token}/${cid}/${d}`;
  const th = 'padding:6px 10px;text-align:left;background:#f1f5f9;border:1px solid #e2e8f0;font-size:12px;width:34%';
  const td = 'padding:6px 10px;border:1px solid #e2e8f0;font-size:13px';
  const meta = [['MRF / Job Requisition', `${esc(req.id)}`], ['Position / Designation', esc(reqTitle(req))], ['Department', esc(req.department || '')],
    ['Hiring Manager', esc(batch.hiring_manager_name || '—')], ['HOD', esc(batch.hod_name || '—')], ['Review batch', `${esc(batch.id)} (batch ${batch.batch_no} for this MRF)`], ['Sent by', esc(sender)]]
    .map(([k, v]) => `<tr><td style="${th}">${k}</td><td style="${td}">${v}</td></tr>`).join('');
  const blocks = cands.map(({ c, remark, attachment }, i) => {
    const rows = [['Contact', [c.phone, c.email].filter(Boolean).map(esc).join(' · ') || '—'], ['Total experience', c.experience_years !== undefined && c.experience_years !== '' ? `${esc(c.experience_years)} years` : '—'],
      ['Current organisation', esc(c.current_company || '—')], ['Current CTC', c.current_ctc ? `₹${Number(c.current_ctc).toLocaleString('en-IN')}` : 'Not available'],
      ['Expected CTC', c.expected_ctc ? `₹${Number(c.expected_ctc).toLocaleString('en-IN')}` : 'Not available'], ['Notice period', esc(c.notice_period || '—')],
      ['HR / Recruiter remarks', esc(remark || '—')], ['CV', attachment ? `Attached: ${esc(attachment)}` : (c.resume_url ? `<a href="${esc(/^https?:/i.test(c.resume_url) ? c.resume_url : appUrl() + c.resume_url)}">Open CV</a>` : 'Not available')],
      ['Candidate profile', `<a href="${appUrl()}/Recruitment?candidate=${c.id}">View in Maxvolt One</a>`]].map(([k, v]) => `<tr><td style="${th}">${k}</td><td style="${td}">${v}</td></tr>`).join('');
    const btn = (d) => `<a href="${link(c.id, d)}" style="display:inline-block;margin:4px 6px 0 0;padding:8px 14px;border-radius:6px;background:${DECISIONS[d].color};color:#fff;text-decoration:none;font-size:13px;font-weight:bold">${DECISIONS[d].label}</a>`;
    return `<div style="margin:18px 0;border:1px solid #cbd5e1;border-radius:8px;padding:14px">
      <div style="font-size:15px;font-weight:bold;color:#0f172a;margin-bottom:8px">${i + 1}. ${esc(candName(c))}</div>
      <table style="border-collapse:collapse;width:100%">${rows}</table>
      <div style="margin-top:10px"><div style="font-size:12px;color:#475569;margin-bottom:2px">Your decision (one click, opens a confirmation page):</div>${btn('shortlist')}${btn('reject')}${btn('hold')}${btn('more_info')}</div></div>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:760px;margin:auto">
    <div style="background:#1e3a5f;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-size:17px;font-weight:bold">CV Review Request — ${esc(reqTitle(req))}</div>
    <div style="border:1px solid #e2e8f0;border-top:0;padding:16px 18px;border-radius:0 0 8px 8px">
      <p style="font-size:14px">Dear ${esc(recipient.name || 'Sir / Madam')},</p>
      <p style="font-size:14px">${cands.length} candidate profile${cands.length > 1 ? 's are' : ' is'} shared for your review against the requisition below. Please use the buttons under each candidate to record your decision — <b>no login is needed</b>. You may also reply to this email with your decision and remarks.</p>
      ${note ? `<p style="font-size:13px;background:#fefce8;border:1px solid #fde68a;padding:8px 10px;border-radius:6px"><b>Note from HR:</b> ${esc(note)}</p>` : ''}
      <table style="border-collapse:collapse;width:100%;margin:10px 0">${meta}</table>
      ${blocks}
      <p style="font-size:12px;color:#64748b">Each candidate remains individually accessible through the profile link. This request is tracked against ${esc(req.id)}; replies and decisions are recorded on the candidate's timeline.</p>
    </div></div>`;
}

// ── decision recording: shared by the public email links and by HR typing in an emailed reply ──────────────────────
async function applyDecision({ batch, candidateId, recipientRole, decision, comment = '', source, byName, byEmail, actorId = '' }) {
  if (!DECISIONS[decision]) throw new Error('Unknown decision');
  const entry = (batch.candidates || []).find((x) => x.candidate_id === candidateId);
  if (!entry) throw new Error('That candidate is not part of this review batch');
  const at = nowIso();
  entry.decisions = entry.decisions || {};
  entry.decisions[recipientRole] = { decision, comment: String(comment || '').slice(0, 1000), at, source, by_name: byName || '', by_email: byEmail || '', recorded_by: actorId || null };
  batch.audit = [...(batch.audit || []), { at, action: 'decision', candidate_id: candidateId, role: recipientRole, decision, source, by: byName || byEmail || '', comment: String(comment || '').slice(0, 300) }];
  const all = Object.values(entry.decisions);
  const verdicts = new Set(all.map((d) => d.decision).filter((d) => ['shortlist', 'reject', 'hold'].includes(d)));
  const open = (batch.candidates || []).some((x) => !Object.keys(x.decisions || {}).length);
  batch.status = open ? 'partially_decided' : 'decided';

  const c = await loadCand(candidateId);
  if (!c) return { batch, candidate: null };
  const label = DECISIONS[decision].short;
  let next = await logEvent(c, { type: 'review_decision', text: `${recipientRole === 'hod' ? 'HOD' : recipientRole === 'hiring_manager' ? 'Hiring Manager' : 'Reviewer'} ${byName || byEmail || ''}: ${label}${comment ? ` — “${String(comment).slice(0, 200)}”` : ''} (${source === 'email_link' ? 'by email' : 'recorded by HR from email'})`, by: actorId, by_name: byName || byEmail || '', ref: { batch_id: batch.id, decision, source } });
  const beyond = LC.STATUSES[next.status]?.rank >= 5;                                 // already interviewing — the decision is only recorded
  let outcome = null;
  if (!beyond && ['cv_sent', 'interview_recommended', 'on_hold', 'rejected', 'shortlisted'].includes(next.status)) {
    if (verdicts.size > 1) {                                                          // reviewers disagree: HR decides
      next = { ...next, review_flag: 'conflict' };
      if (next.status !== 'cv_sent') next = await moveCandidate(next, 'cv_sent', { text: 'Reviewers gave different decisions — back to review, HR to resolve', byName: 'System' });
      else await saveCand(next);
      outcome = 'conflict';
    } else if (decision === 'more_info') {
      next = { ...next, review_flag: 'more_info' }; await saveCand(next); outcome = 'more_info';
    } else {
      next = { ...next, review_flag: '' };
      const to = decision === 'shortlist' ? 'interview_recommended' : decision === 'reject' ? 'rejected' : 'on_hold';
      if (next.status !== to) next = await moveCandidate(next, to, { text: `${label} by ${byName || byEmail || 'reviewer'} (CV review ${batch.id})`, byName: byName || byEmail || '', ref: { batch_id: batch.id } });
      else await saveCand(next);
      outcome = to;
    }
  }
  return { batch, candidate: next, outcome };
}

async function notifyDecision(batch, candidate, decision, byName, outcome) {
  const cfg = await loadConfig();
  const label = DECISIONS[decision].short;
  const who = new Set();
  if (wants(cfg, 'review_decided', 'recruiter') && batch.created_by) who.add(batch.created_by);
  if (wants(cfg, 'review_decided', 'hr')) for (const id of await hrAudience()) who.add(id);
  const extra = outcome === 'conflict' ? ' Reviewers disagree — HR needs to resolve it.' : decision === 'more_info' ? ' More information was requested.' : '';
  await notifyUsers([...who], { title: `CV review: ${label}`, message: `${byName || 'A reviewer'} marked ${candName(candidate || {})} as “${label}” for ${batch.requisition_id}.${extra}`, link: `/Recruitment?candidate=${candidate?.id || ''}`, type: decision === 'shortlist' ? 'success' : 'info' });
}

// ── handlers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const H = {
  async rh_config_get({ cx, res }) {
    if (!hasAny(cx, READ)) return fail(res, 'Not allowed', 403);
    return res.json({ success: true, config: await loadConfig(), statuses: LC.STATUSES, feedback_criteria: LC.FEEDBACK_CRITERIA });
  },
  async rh_config_save({ p, cx, res }) {
    if (!hasAny(cx, ['hr', 'admin'])) return fail(res, 'Only HR or admin can change the recruitment settings', 403);
    const cur = await loadConfig();
    const rounds = Array.isArray(p.rounds) ? p.rounds.map((r, i) => ({ key: String(r.key || r.label || `round_${i}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40), label: String(r.label || '').trim().slice(0, 60), active: r.active !== false })).filter((r) => r.label) : cur.rounds;
    if (!rounds.length) return fail(res, 'Keep at least one interview round');
    const data = { id: CFG_ID, rounds, notify: { ...cur.notify, ...(p.notify || {}) }, weekly_off: Array.isArray(p.weekly_off) ? p.weekly_off.map(Number).filter((n) => n >= 0 && n <= 6) : cur.weekly_off, use_holidays: p.use_holidays !== false, review_reminder_days: Number(p.review_reminder_days) || cur.review_reminder_days, feedback_reminder_hours: Number(p.feedback_reminder_hours) || cur.feedback_reminder_hours };
    const have = await one("SELECT id FROM entities WHERE type='RecruitmentConfig' AND id=$1", [CFG_ID]);
    if (have) await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(data), CFG_ID]);
    else await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'RecruitmentConfig',$2,'active',$3)", [CFG_ID, cx.cu.id, JSON.stringify(data)]);
    return res.json({ success: true, config: await loadConfig() });
  },

  // ── candidates: stage changes (bulk-safe), timeline ──
  async rh_set_status({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can change a candidate\'s stage', 403);
    const ids = [...new Set([].concat(p.candidate_ids || p.candidate_id || []).filter(Boolean))];
    if (!ids.length) return fail(res, 'Choose at least one candidate');
    if (!LC.STATUSES[p.status]) return fail(res, 'Unknown status');
    const role = hasAny(cx, ['admin']) ? 'admin' : hasAny(cx, ['hr']) ? 'hr' : 'recruiter';
    const results = [];
    for (const id of ids) {
      const c = await loadCand(id);
      if (!c) { results.push({ id, ok: false, error: 'Candidate not found' }); continue; }
      try {
        let to = p.status;
        const system = c.status === 'on_hold' && to === 'resume';
        if (to === 'resume') to = c.held_from || 'screening';
        await moveCandidate(c, to, { by: cx.cu.id, byName: cx.name, system, role, overrideReason: p.override_reason || '', text: p.reason ? `${LC.statusLabel(c.status)} → ${LC.statusLabel(to)} — ${p.reason}` : '' });
        results.push({ id, ok: true });
      } catch (e) { results.push({ id, ok: false, error: e.message, needs_override: !!e.needsOverride }); }
    }
    return res.json({ success: true, updated: results.filter((r) => r.ok).length, results });
  },

  async rh_candidate_timeline({ p, cx, res }) {
    if (!hasAny(cx, READ)) return fail(res, 'Not allowed', 403);
    const c = await loadCand(p.candidate_id); if (!c) return fail(res, 'Candidate not found', 404);
    const P = await people();
    const batches = (await batchesFor((b) => (b.candidates || []).some((x) => x.candidate_id === c.id))).map((b) => ({ ...publicBatch(b), mine: (b.candidates || []).find((x) => x.candidate_id === c.id) }));
    const interviews = (await all("SELECT id, data FROM entities WHERE type='Interview'")).map((r) => ({ ...jparse(r.data), id: r.id })).filter((i) => i.candidate_id === c.id)
      .map((i) => ({ ...i, interviewer_names: (i.interviewer_ids || []).map(P.name) })).sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
    const req = await loadReq(reqKey(c));
    return res.json({ success: true, status: c.status || 'applied', status_label: LC.statusLabel(c.status), review_flag: c.review_flag || '', timeline: [...(c.timeline || [])].reverse(), batches, interviews, requisition: req ? { id: req.id, title: reqTitle(req), department: req.department } : null, allowed_next: LC.allowedNext(c) });
  },

  // ── CV review ──
  async rh_review_options({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const req = await loadReq(p.requisition_id); if (!req) return fail(res, 'Choose a requisition first');
    const P = await people();
    const recips = await recipientsFor(req, P);
    const batches = await batchesFor((b) => b.requisition_id === req.id);
    return res.json({ success: true, requisition: { id: req.id, title: reqTitle(req), department: req.department, hiring_manager_name: P.name(req.hiring_manager_id), status: req.status },
      recipients: recips.map(({ user_id, name, email, role }) => ({ user_id, name, email, role })), batches_sent: batches.length });
  },

  async rh_review_create({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can send CVs for review', 403);
    const req = await loadReq(p.requisition_id); if (!req) return fail(res, 'Choose the requisition these candidates are being reviewed for');
    const ids = [...new Set((p.candidate_ids || []).filter(Boolean))];
    if (!ids.length) return fail(res, 'Select at least one candidate');
    if (ids.length > 25) return fail(res, 'Send at most 25 profiles in one review request');
    const P = await people();
    // every candidate must really belong to this requisition — a bulk action must never touch someone else's record
    const cands = []; const skipped = [];
    for (const id of ids) {
      const c = await loadCand(id);
      if (!c) { skipped.push({ id, reason: 'Candidate not found' }); continue; }
      if (reqKey(c) !== req.id) { skipped.push({ id, name: candName(c), reason: `Applied for a different requisition (${reqKey(c) || 'none'})` }); continue; }
      const st = c.status || 'applied';
      if (!['applied', 'screening', 'shortlisted'].includes(st) && !(st === 'cv_sent' && p.allow_resend)) {
        skipped.push({ id, name: candName(c), reason: st === 'cv_sent' ? 'Already sent for review and awaiting a response (tick "send again" to repeat)' : `${LC.statusLabel(st)} — cannot be sent for CV review from here` }); continue;
      }
      cands.push(c);
    }
    if (!cands.length) return res.json({ success: false, error: 'None of the selected candidates can be sent for review', skipped });

    // recipients: the Hiring Manager and HOD of the requisition, plus anyone HR adds (management)
    let recips = await recipientsFor(req, P);
    for (const x of (p.extra_recipients || [])) { const uid = x.user_id; if (uid && !recips.some((r) => r.user_id === uid)) recips.push({ user_id: uid, name: P.name(uid), email: P.email(uid), role: 'management' }); }
    if (Array.isArray(p.recipient_roles) && p.recipient_roles.length) recips = recips.filter((r) => p.recipient_roles.includes(r.role) || r.role === 'management');
    recips = recips.filter((r) => r.email);
    if (!recips.length) return fail(res, 'No Hiring Manager or HOD with an email address is set for this requisition. Set one on the requisition, or add a reviewer.');

    const existing = await batchesFor((b) => b.requisition_id === req.id);
    const seq = (await all("SELECT COUNT(*)::int AS n FROM entities WHERE type='CvReviewBatch'"))[0].n + 1;
    const batch = {
      id: `CVR-${istDate().slice(0, 4)}-${String(seq).padStart(4, '0')}-${uuidv4().slice(0, 4).toUpperCase()}`, requisition_id: req.id, position: reqTitle(req), department: req.department || '', batch_no: existing.length + 1,
      hiring_manager_id: req.hiring_manager_id || '', hiring_manager_name: P.name(req.hiring_manager_id), hod_name: (recips.find((r) => r.role === 'hod') || {}).name || '',
      created_by: cx.cu.id, created_by_name: cx.name, sent_at: nowIso(), note: String(p.note || '').slice(0, 1000), status: 'sent',
      recipients: recips.map((r) => ({ user_id: r.user_id, name: r.name, email: r.email, role: r.role, token: randomBytes(24).toString('hex'), sent_at: null, reminders: [] })),
      candidates: cands.map((c) => ({ candidate_id: c.id, name: candName(c), remarks: String((p.remarks || {})[c.id] || '').slice(0, 600), decisions: {} })),
      audit: [{ at: nowIso(), action: 'created', by: cx.name, text: `${cands.length} profile(s) sent to ${recips.map((r) => r.name).join(', ')}` }],
    };

    // CV attachments — each file ≤ 8 MB and the whole email ≤ 20 MB; anything larger goes as a link
    const files = []; let total = 0;
    const entries = [];
    for (const c of cands) {
      const f = await fetchCv(c); let attachment = null;
      if (f?.buf && total + f.buf.length <= 20 * 1024 * 1024) { files.push({ filename: f.filename, content: f.buf }); total += f.buf.length; attachment = f.filename; }
      entries.push({ c, remark: batch.candidates.find((x) => x.candidate_id === c.id).remarks, attachment });
    }
    const subject = `CV Review Request — ${req.id} · ${reqTitle(req)} (${cands.length} profile${cands.length > 1 ? 's' : ''}) [${batch.id}]`;
    const senderUser = P.byUser[cx.cu.id] || {};
    const emailErrors = [];
    for (const r of batch.recipients) {
      try {
        await sendEmail({ to: r.email, subject, html: reviewEmailHtml({ batch, req, recipient: r, cands: entries, sender: `${cx.name}${senderUser.email ? ` (${senderUser.email})` : ''}`, note: batch.note }), attachments: files, replyTo: senderUser.email || undefined, meta: { source: 'cv-review' } });
        r.sent_at = nowIso();
      } catch (e) { emailErrors.push(`${r.name}: ${e.message}`); }
    }
    if (!batch.recipients.some((r) => r.sent_at)) return fail(res, `The review email could not be sent (${emailErrors.join('; ')}). Nothing was changed.`, 502);
    batch.email_errors = emailErrors;
    batch.attachments = files.length;
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'CvReviewBatch',$2,'sent',$3)", [batch.id, cx.cu.id, JSON.stringify(batch)]);

    // candidates move to "CV sent" (applied / screening ones are shortlisted by HR first — recorded on the timeline)
    for (const c0 of cands) {
      let c = c0;
      if (['applied', 'screening'].includes(c.status || 'applied')) c = await moveCandidate(c, 'shortlisted', { by: cx.cu.id, byName: cx.name, text: 'Shortlisted by HR with the CV review request', ref: { batch_id: batch.id } });
      c = await moveCandidate({ ...c, review_batch_ids: [...(c.review_batch_ids || []), batch.id], review_flag: '' }, 'cv_sent', { by: cx.cu.id, byName: cx.name, text: `CV sent for review to ${batch.recipients.filter((r) => r.sent_at).map((r) => `${r.name} (${r.role === 'hod' ? 'HOD' : r.role === 'hiring_manager' ? 'Hiring Manager' : 'Reviewer'})`).join(', ')} — batch ${batch.id}`, ref: { batch_id: batch.id } });
    }
    const cfg = await loadConfig();
    if (wants(cfg, 'cv_review_sent', 'recruiter')) await notifyUsers([cx.cu.id], { title: 'CV review request sent', message: `${cands.length} profile(s) for ${req.id} (${reqTitle(req)}) sent to ${batch.recipients.map((r) => r.name).join(', ')}.`, link: '/Recruitment' });
    await notifyUsers(batch.recipients.map((r) => r.user_id).filter(Boolean), { title: `CV review request — ${reqTitle(req)}`, message: `${cx.name} sent ${cands.length} profile(s) for ${req.id}. Check your email to record your decisions.`, link: '/Recruitment' });
    return res.json({ success: true, batch: publicBatch(batch), sent: cands.length, skipped, email_errors: emailErrors, attachments: files.length });
  },

  async rh_review_list({ p, cx, res }) {
    if (!hasAny(cx, READ)) return fail(res, 'Not allowed', 403);
    const list = await batchesFor((b) => (!p.requisition_id || b.requisition_id === p.requisition_id) && (!p.candidate_id || (b.candidates || []).some((x) => x.candidate_id === p.candidate_id)));
    return res.json({ success: true, batches: list.reverse().map(publicBatch) });
  },

  // HR records an outcome received as an emailed reply
  async rh_review_record({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can record a review outcome', 403);
    const batch = await loadBatch(p.batch_id); if (!batch) return fail(res, 'Review batch not found', 404);
    const rec = (batch.recipients || []).find((r) => r.role === p.recipient_role || r.user_id === p.recipient_user_id);
    if (!rec) return fail(res, 'Choose who sent the email reply');
    const r = await applyDecision({ batch, candidateId: p.candidate_id, recipientRole: rec.role, decision: p.decision, comment: p.comment, source: 'manual', byName: rec.name, byEmail: rec.email, actorId: cx.cu.id });
    batch.audit.push({ at: nowIso(), action: 'recorded_by_hr', by: cx.name, text: `Reply from ${rec.name} recorded by ${cx.name}` });
    await saveBatch(batch);
    await notifyDecision(batch, r.candidate, p.decision, rec.name, r.outcome);
    return res.json({ success: true, outcome: r.outcome, batch: publicBatch(batch) });
  },

  async rh_review_remind({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const batch = await loadBatch(p.batch_id); if (!batch) return fail(res, 'Review batch not found', 404);
    const req = await loadReq(batch.requisition_id); const sent = [];
    for (const r of batch.recipients) {
      const pending = (batch.candidates || []).filter((x) => !x.decisions?.[r.role]);
      if (!pending.length || !r.email) continue;
      const rows = pending.map((x) => `<li><b>${esc(x.name)}</b> — <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/shortlist">Shortlist</a> · <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/reject">Reject</a> · <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/hold">Hold</a> · <a href="${appUrl()}/api/hiring/decide/${r.token}/${x.candidate_id}/more_info">More information</a></li>`).join('');
      try {
        await sendEmail({ to: r.email, subject: `Reminder: CV review pending — ${batch.requisition_id} · ${reqTitle(req)} [${batch.id}]`, html: `<div style="font-family:Arial,sans-serif;font-size:14px"><p>Dear ${esc(r.name)},</p><p>Your decision is still pending on ${pending.length} profile(s) for ${esc(batch.requisition_id)} (${esc(reqTitle(req))}). The original email has the CVs attached.</p><ul>${rows}</ul></div>`, replyTo: (await one('SELECT email FROM users WHERE id=$1', [cx.cu.id]))?.email || undefined });
        r.reminders = [...(r.reminders || []), { at: nowIso(), by: cx.name }]; sent.push(r.name);
      } catch (e) { console.warn('[hiring] reminder failed:', e.message); }
    }
    batch.audit.push({ at: nowIso(), action: 'reminder', by: cx.name, text: sent.length ? `Reminder sent to ${sent.join(', ')}` : 'No reminder needed' });
    await saveBatch(batch);
    return res.json({ success: true, reminded: sent });
  },
};

export default H;
export { H, loadBatch, saveBatch, applyDecision, notifyDecision, notifyUsers, hrAudience, people, loadCand, saveCand, logEvent, loadReq, reqTitle, reqKey, candName, esc, appUrl, DECISIONS, istDate, nowIso, jparse, hasAny, fail, RECRUIT, READ, roleList };
