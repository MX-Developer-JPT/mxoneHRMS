// Interview scheduling, rescheduling, cancellation and structured feedback — every `rh_interview_*` function.
// Only candidates the Hiring Manager / HOD recommended (by email) enter the scheduling pipeline.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { sendEmail } from '../utils/email.js';
import * as LC from '../utils/hiringLifecycle.js';
import { moveCandidate, loadCand, saveCand, logEvent, loadReq, reqTitle, reqKey, candName, esc, appUrl, nowIso, jparse, hasAny, fail, RECRUIT, READ, people, notifyUsers, loadConfig } from './hiring.js';
import { cacheInvalidate } from './entities.js';

const ELIGIBLE = ['interview_recommended', 'next_round_recommended'];
const LEGACY_ELIGIBLE = ['applied', 'screening', 'shortlisted'];           // a candidate with no requisition (older records)
const wants = (cfg, event, who) => (cfg.notify?.[event]?.[who] ?? LC.DEFAULT_NOTIFY[event]?.[who]) !== false;
const MODE = { online: 'video', video: 'video', offline: 'in_person', in_person: 'in_person', phone: 'phone' };
const modeLabel = (m) => ({ video: 'Online', in_person: 'Offline (in person)', phone: 'Phone' }[m] || m || '');

const istMs = (s) => { const t = Date.parse(`${String(s).slice(0, 16)}:00+05:30`); return Number.isFinite(t) ? t : NaN; };
const endMs = (i) => istMs(i.scheduled_date) + (Number(i.duration_minutes) || 30) * 60000;
const fmtDate = (s) => new Date(istMs(s)).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });
const fmtTime = (s) => new Date(istMs(s)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

async function loadInterview(id) { const r = await one("SELECT id, data, created_at FROM entities WHERE type='Interview' AND id=$1", [id]); return r ? { ...jparse(r.data), id: r.id } : null; }
async function saveInterview(i) { const { _created, ...d } = i; await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3 AND type='Interview'", [JSON.stringify(d), d.status || 'scheduled', d.id]); cacheInvalidate('Interview'); }
async function allInterviews() { return (await all("SELECT id, data, created_at FROM entities WHERE type='Interview'")).map((r) => ({ ...jparse(r.data), id: r.id, _created: r.created_at })).filter((i) => i.candidate_id); }

function ics({ id, title, start, minutes, location, description }) {
  const f = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const t = istMs(start);
  const clean = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maxvolt One//Interview//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT', `UID:${id}@maxone`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(t)}`, `DTEND:${f(t + minutes * 60000)}`, `SUMMARY:${clean(title)}`, `LOCATION:${clean(location)}`, `DESCRIPTION:${clean(description)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

async function enrich(list) {
  const P = await people();
  const cands = new Map((await all("SELECT id, data FROM entities WHERE type='Candidate'")).map((r) => [r.id, { ...jparse(r.data), id: r.id }]));
  const reqs = new Map((await all("SELECT id, data FROM entities WHERE type='JobRequisition'")).map((r) => [r.id, { ...jparse(r.data), id: r.id }]));
  const nowT = Date.now();
  return list.map((i) => {
    const c = cands.get(i.candidate_id) || {}; const rq = reqs.get(i.requisition_id || reqKey(c)) || {};
    const have = new Set((i.feedbacks || []).map((f) => f.interviewer_id));
    const missing = (i.interviewer_ids || []).filter((u) => !have.has(u));
    const isPast = i.status === 'scheduled' && endMs(i) < nowT;
    return { ...i, mrf_no: rq.requisition_id || '', candidate_name: candName(c), candidate_status: c.status || 'applied', candidate_email: c.email || '', candidate_phone: c.phone || '', position: rq.designation || rq.position_title || c.position_applied || '', department: rq.department || c.department || '', requisition_id: i.requisition_id || reqKey(c),
      interviewer_names: (i.interviewer_ids || []).map(P.name), feedback_pending: isPast || (i.status === 'scheduled' && (i.feedbacks || []).length > 0 && missing.length > 0), pending_interviewers: isPast || i.status === 'scheduled' ? missing.map(P.name) : [], is_past: isPast };
  });
}

async function emailCandidate(c, i, req, kind, cfg, why = '') {
  if (!c.email || !wants(cfg, kind === 'scheduled' ? 'interview_scheduled' : 'interview_changed', 'candidate')) return false;
  const rows = [['Position', reqTitle(req) || c.position_applied || ''], ['Round', i.round_name], ['Date', fmtDate(i.scheduled_date)], ['Time', `${fmtTime(i.scheduled_date)} (${i.duration_minutes} minutes)`], ['Mode', modeLabel(i.interview_mode)], [i.interview_mode === 'video' ? 'Meeting link' : 'Venue', i.meeting_link || i.location || 'To be shared'], ...(i.instructions ? [['Instructions', i.instructions]] : [])];
  const head = { scheduled: 'Interview Invitation', rescheduled: 'Interview Rescheduled', cancelled: 'Interview Cancelled' }[kind];
  const lead = { scheduled: 'We are pleased to invite you for an interview at Maxvolt Energy Industries Limited.', rescheduled: `Your interview has been rescheduled${why ? ` (${esc(why)})` : ''}. The new schedule is below.`, cancelled: `Your interview has been cancelled${why ? ` (${esc(why)})` : ''}. We will contact you with a new schedule if required.` }[kind];
  const table = kind === 'cancelled' ? '' : `<table style="border-collapse:collapse;width:100%;margin:10px 0">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px;background:#f1f5f9;border:1px solid #e2e8f0;width:30%;font-size:13px">${k}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:13px">${esc(v)}</td></tr>`).join('')}</table>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><div style="background:#1e40af;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-size:17px;font-weight:bold">${head}</div><div style="border:1px solid #e2e8f0;border-top:0;padding:16px 18px;font-size:14px"><p>Dear ${esc(candName(c))},</p><p>${lead}</p>${table}<p>Please confirm by replying to this email.</p></div></div>`;
  try {
    await sendEmail({ to: c.email, subject: `${head} — ${reqTitle(req) || c.position_applied || 'Maxvolt Energy'}`, html, attachments: kind === 'cancelled' ? [] : [{ filename: 'interview.ics', content: Buffer.from(ics({ id: i.id, title: `Interview — ${reqTitle(req) || c.position_applied}`, start: i.scheduled_date, minutes: i.duration_minutes, location: i.meeting_link || i.location, description: i.instructions })) }], meta: { source: 'interview' } });
    return true;
  } catch (e) { console.warn('[interview] candidate email failed:', e.message); return false; }
}
async function notifyPanel(P, i, c, req, kind, cfg, by) {
  const verb = { scheduled: 'scheduled', rescheduled: 'rescheduled', cancelled: 'cancelled' }[kind];
  if (wants(cfg, kind === 'scheduled' ? 'interview_scheduled' : 'interview_changed', 'interviewer')) {
    await notifyUsers(i.interviewer_ids, { title: `Interview ${verb}`, message: `${candName(c)} — ${i.round_name} for ${reqTitle(req)} on ${fmtDate(i.scheduled_date)} at ${fmtTime(i.scheduled_date)} (${modeLabel(i.interview_mode)}).${kind === 'scheduled' ? ' Please submit your feedback after the interview.' : ''}`, link: '/InterviewManagement', type: kind === 'cancelled' ? 'warning' : 'info', email: true });
  }
  if (wants(cfg, kind === 'scheduled' ? 'interview_scheduled' : 'interview_changed', 'recruiter') && i.created_by && i.created_by !== by) await notifyUsers([i.created_by], { title: `Interview ${verb}`, message: `${candName(c)} — ${i.round_name} ${verb}.`, link: '/InterviewManagement' });
}

const H = {
  async rh_interview_options({ cx, res }) {
    if (!hasAny(cx, READ)) return fail(res, 'Not allowed', 403);
    const cfg = await loadConfig();
    const cands = (await all("SELECT id, data FROM entities WHERE type='Candidate'")).map((r) => ({ ...jparse(r.data), id: r.id }));
    const awaiting = cands.filter((c) => ELIGIBLE.includes(c.status) || (!reqKey(c) && LEGACY_ELIGIBLE.includes(c.status || 'applied')));
    const ivs = await allInterviews();
    const reqNo = Object.fromEntries((await all("SELECT id, data FROM entities WHERE type='JobRequisition'")).map((r) => [r.id, jparse(r.data)?.requisition_id || '']));
    const rows = awaiting.map((c) => ({ id: c.id, mrf_no: reqNo[reqKey(c)] || '', name: candName(c), status: c.status || 'applied', status_label: LC.statusLabel(c.status), position: c.position_applied || '', requisition_id: reqKey(c), department: c.department || '', email: c.email || '', rounds_done: ivs.filter((i) => i.candidate_id === c.id && i.status === 'completed').length }));
    return res.json({ success: true, rounds: cfg.rounds.filter((r) => r.active !== false), awaiting: rows, criteria: LC.FEEDBACK_CRITERIA });
  },

  async rh_interview_list({ p, cx, res }) {
    if (!hasAny(cx, READ) && !hasAny(cx, ['manager', 'employee'])) return fail(res, 'Not allowed', 403);
    const mineOnly = !hasAny(cx, READ);                                           // an interviewer who is not HR sees only their own interviews
    let list = await enrich(await allInterviews());
    if (mineOnly) list = list.filter((i) => (i.interviewer_ids || []).includes(cx.cu.id));
    const stats = (arr, cands) => ({
      awaiting: cands, scheduled: arr.filter((i) => i.status === 'scheduled').length, completed: arr.filter((i) => i.status === 'completed').length,
      rescheduled: arr.filter((i) => (i.reschedule_count || 0) > 0).length, cancelled: arr.filter((i) => i.status === 'cancelled').length,
      selected: new Set(arr.filter((i) => i.candidate_status === 'selected' || ['offer_in_progress', 'offered', 'offer_accepted', 'joined'].includes(i.candidate_status)).map((i) => i.candidate_id)).size,
      rejected: new Set(arr.filter((i) => i.candidate_status === 'rejected').map((i) => i.candidate_id)).size, feedback_pending: arr.filter((i) => i.feedback_pending).length,
    });
    const f = (i) => (!p.requisition_id || i.requisition_id === p.requisition_id) && (!p.department || p.department === 'all' || i.department === p.department) && (!p.interviewer_id || (i.interviewer_ids || []).includes(p.interviewer_id))
      && (!p.candidate_id || i.candidate_id === p.candidate_id) && (!p.round_key || i.round_key === p.round_key) && (!p.from || String(i.scheduled_date).slice(0, 10) >= p.from) && (!p.to || String(i.scheduled_date).slice(0, 10) <= p.to);
    const filtered = list.filter(f);
    const cands = (await all("SELECT data FROM entities WHERE type='Candidate'")).map((r) => jparse(r.data)).filter(Boolean);
    const awaitingN = cands.filter((c) => (ELIGIBLE.includes(c.status) || (!reqKey(c) && LEGACY_ELIGIBLE.includes(c.status || 'applied'))) && (!p.requisition_id || reqKey(c) === p.requisition_id) && (!p.department || p.department === 'all' || c.department === p.department)).length;
    const shown = p.status && p.status !== 'all' ? filtered.filter((i) => (p.status === 'pending_feedback' ? i.feedback_pending : p.status === 'rescheduled' ? (i.reschedule_count || 0) > 0 : i.status === p.status)) : filtered;
    return res.json({ success: true, stats: stats(filtered, awaitingN), interviews: shown.sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date))) });
  },

  async rh_interview_schedule({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can schedule interviews', 403);
    const ids = [...new Set([].concat(p.candidate_ids || p.candidate_id || []).filter(Boolean))];
    if (!ids.length) return fail(res, 'Choose at least one candidate');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || !/^\d{2}:\d{2}$/.test(p.time || '')) return fail(res, 'Choose the interview date and time');
    const duration = Math.min(480, Math.max(10, Number(p.duration_minutes) || 30));
    const mode = MODE[p.mode || p.interview_mode] || 'video';
    const interviewers = [...new Set((p.interviewer_ids || []).filter(Boolean))];
    if (!interviewers.length) return fail(res, 'Assign at least one interviewer');
    const cfg = await loadConfig();
    const round = cfg.rounds.find((r) => r.key === p.round_key || r.label === p.round_name);
    if (!round) return fail(res, 'Choose the interview round');
    const base = istMs(`${p.date}T${p.time}`);
    if (!(base > Date.now() - 5 * 60000)) return fail(res, 'The interview time is in the past');
    if (mode === 'video' && !p.meeting_link && !p.location) return fail(res, 'Enter the meeting link for an online interview');
    if (mode === 'in_person' && !p.location) return fail(res, 'Enter the interview venue');
    const role = hasAny(cx, ['admin']) ? 'admin' : hasAny(cx, ['hr']) ? 'hr' : 'recruiter';
    const P = await people();
    const existing = await allInterviews();
    const results = []; const created = [];
    for (let k = 0; k < ids.length; k++) {
      const c = await loadCand(ids[k]);
      if (!c) { results.push({ candidate_id: ids[k], ok: false, error: 'Candidate not found' }); continue; }
      const st = c.status || 'applied';
      const eligible = ELIGIBLE.includes(st) || (!reqKey(c) && LEGACY_ELIGIBLE.includes(st));
      let override = false;
      if (!eligible) {
        if (['hr', 'admin'].includes(role) && String(p.override_reason || '').trim().length >= 5) override = true;
        else { results.push({ candidate_id: c.id, name: candName(c), ok: false, error: st === 'interview_scheduled' ? 'An interview is already scheduled — reschedule it instead' : `${LC.statusLabel(st)} — the Hiring Manager / HOD has not recommended this candidate for interview yet`, needs_override: ['hr', 'admin'].includes(role) }); continue; }
      }
      const startMs = p.stagger ? base + k * duration * 60000 : base;
      const dt = new Date(startMs + 5.5 * 3600000).toISOString().slice(0, 16);
      // an interviewer cannot be in two interviews at once
      const clash = existing.filter((x) => x.status === 'scheduled' && x.candidate_id !== c.id && (x.interviewer_ids || []).some((u) => interviewers.includes(u)) && istMs(x.scheduled_date) < startMs + duration * 60000 && endMs(x) > startMs);
      if (clash.length && !p.ignore_conflicts) { results.push({ candidate_id: c.id, name: candName(c), ok: false, conflict: true, error: `Interviewer already booked: ${[...new Set(clash.flatMap((x) => (x.interviewer_ids || []).filter((u) => interviewers.includes(u))).map((u) => P.name(u)))].join(', ')} at ${fmtTime(x0(clash))}` }); continue; }
      const roundNo = existing.filter((x) => x.candidate_id === c.id && x.status !== 'cancelled').length + 1;
      const req = await loadReq(reqKey(c));
      const id = uuidv4();
      const iv = { id, candidate_id: c.id, requisition_id: reqKey(c), department: req?.department || c.department || '', position: reqTitle(req) || c.position_applied || '', round_number: roundNo, round_key: round.key, round_name: round.label, round_type: round.key,
        scheduled_date: dt, duration_minutes: duration, interview_mode: mode, meeting_link: p.meeting_link || '', location: p.location || '', interviewer_ids: interviewers, instructions: String(p.instructions || '').slice(0, 1000), remarks: String(p.remarks || '').slice(0, 1000),
        status: 'scheduled', reschedule_count: 0, history: [{ at: nowIso(), action: 'scheduled', by: cx.name }], feedbacks: [], created_by: cx.cu.id, created_by_name: cx.name, created_at_iso: nowIso() };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Interview',$2,'scheduled',$3)", [id, c.id, JSON.stringify(iv)]);
      existing.push(iv);
      let cc;
      try {
        cc = await moveCandidate(c, 'interview_scheduled', { by: cx.cu.id, byName: cx.name, role, overrideReason: override ? p.override_reason : '', system: !override, text: `${round.label} scheduled for ${fmtDate(dt)} at ${fmtTime(dt)} (${modeLabel(mode)}) with ${interviewers.map(P.name).join(', ')}`, ref: { interview_id: id }, extra: { interview_date: dt, interviewer_id: interviewers[0] } });
      } catch (e) { await run("DELETE FROM entities WHERE id=$1 AND type='Interview'", [id]); results.push({ candidate_id: c.id, name: candName(c), ok: false, error: e.message }); continue; }
      let mailed = false;
      if (p.notify !== false) { mailed = await emailCandidate(cc, iv, req || {}, 'scheduled', cfg); await notifyPanel(P, iv, cc, req || {}, 'scheduled', cfg, cx.cu.id); }
      created.push(iv); results.push({ candidate_id: c.id, name: candName(c), ok: true, interview_id: id, emailed: mailed });
    }
    cacheInvalidate('Interview');
    return res.json({ success: results.some((r) => r.ok), scheduled: created.length, results });
  },

  async rh_interview_reschedule({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can reschedule interviews', 403);
    const i = await loadInterview(p.interview_id); if (!i) return fail(res, 'Interview not found', 404);
    if (i.status !== 'scheduled') return fail(res, 'Only a scheduled interview can be rescheduled');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || !/^\d{2}:\d{2}$/.test(p.time || '')) return fail(res, 'Choose the new date and time');
    if (!(istMs(`${p.date}T${p.time}`) > Date.now() - 5 * 60000)) return fail(res, 'The new time is in the past');
    const P = await people(); const cfg = await loadConfig();
    const interviewers = Array.isArray(p.interviewer_ids) && p.interviewer_ids.length ? [...new Set(p.interviewer_ids)] : i.interviewer_ids;
    const dt = `${p.date}T${p.time}`; const dur = Number(p.duration_minutes) || i.duration_minutes;
    const startMs = istMs(dt);
    const clash = (await allInterviews()).filter((x) => x.id !== i.id && x.status === 'scheduled' && (x.interviewer_ids || []).some((u) => interviewers.includes(u)) && istMs(x.scheduled_date) < startMs + dur * 60000 && endMs(x) > startMs);
    if (clash.length && !p.ignore_conflicts) return res.json({ success: false, conflict: true, error: 'An interviewer is already booked at that time' });
    const before = `${i.scheduled_date}`;
    const next = { ...i, scheduled_date: dt, duration_minutes: dur, interviewer_ids: interviewers, meeting_link: p.meeting_link ?? i.meeting_link, location: p.location ?? i.location, interview_mode: MODE[p.mode] || i.interview_mode, reschedule_count: (i.reschedule_count || 0) + 1,
      history: [...(i.history || []), { at: nowIso(), action: 'rescheduled', by: cx.name, from: before, to: dt, reason: String(p.reason || '').slice(0, 300) }], feedbacks: [] };
    await saveInterview(next);
    const c = await loadCand(i.candidate_id); const req = await loadReq(reqKey(c || {}));
    if (c) await logEvent(c, { type: 'interview', text: `${i.round_name} rescheduled from ${fmtDate(before)} ${fmtTime(before)} to ${fmtDate(dt)} ${fmtTime(dt)}${p.reason ? ` — ${p.reason}` : ''}`, by: cx.cu.id, by_name: cx.name, ref: { interview_id: i.id } });
    if (c && p.notify !== false) { await emailCandidate(c, next, req || {}, 'rescheduled', cfg, p.reason); await notifyPanel(P, next, c, req || {}, 'rescheduled', cfg, cx.cu.id); }
    return res.json({ success: true });
  },

  async rh_interview_cancel({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can cancel interviews', 403);
    const i = await loadInterview(p.interview_id); if (!i) return fail(res, 'Interview not found', 404);
    if (i.status !== 'scheduled') return fail(res, 'Only a scheduled interview can be cancelled');
    if (String(p.reason || '').trim().length < 3) return fail(res, 'Enter the reason for cancelling');
    const P = await people(); const cfg = await loadConfig();
    const next = { ...i, status: 'cancelled', cancelled_at: nowIso(), cancel_reason: String(p.reason).slice(0, 300), history: [...(i.history || []), { at: nowIso(), action: 'cancelled', by: cx.name, reason: String(p.reason).slice(0, 300) }] };
    await saveInterview(next);
    const c = await loadCand(i.candidate_id); const req = await loadReq(reqKey(c || {}));
    if (c) {
      const another = (await allInterviews()).some((x) => x.candidate_id === c.id && x.id !== i.id && x.status === 'scheduled');
      const hadRound = (await allInterviews()).some((x) => x.candidate_id === c.id && x.id !== i.id && x.status === 'completed');
      if (!another && c.status === 'interview_scheduled') await moveCandidate(c, hadRound ? 'next_round_recommended' : 'interview_recommended', { by: cx.cu.id, byName: cx.name, text: `${i.round_name} cancelled — ${p.reason}`, ref: { interview_id: i.id } });
      else await logEvent(c, { type: 'interview', text: `${i.round_name} cancelled — ${p.reason}`, by: cx.cu.id, by_name: cx.name, ref: { interview_id: i.id } });
      if (p.notify !== false) { await emailCandidate(c, next, req || {}, 'cancelled', cfg, p.reason); await notifyPanel(P, next, c, req || {}, 'cancelled', cfg, cx.cu.id); }
    }
    return res.json({ success: true });
  },

  async rh_interview_feedback({ p, cx, res }) {
    const i = await loadInterview(p.interview_id); if (!i) return fail(res, 'Interview not found', 404);
    const isPanel = (i.interviewer_ids || []).includes(cx.cu.id);
    if (!isPanel && !hasAny(cx, RECRUIT)) return fail(res, 'Only the assigned interviewers (or HR) can submit feedback', 403);
    if (i.status === 'cancelled') return fail(res, 'This interview was cancelled');
    const recs = { select: 'Select', reject: 'Reject', hold: 'On Hold', next_round: 'Next Round' };
    if (!recs[p.recommendation]) return fail(res, 'Choose the final recommendation');
    const overall = Number(p.overall);
    if (!(overall >= 1 && overall <= 5)) return fail(res, 'Give an overall rating from 1 to 5');
    const scores = {}; for (const [k] of LC.FEEDBACK_CRITERIA) { const v = Number((p.scores || {})[k]); if (!(v >= 1 && v <= 5)) return fail(res, `Rate every criterion from 1 to 5 (missing: ${LC.FEEDBACK_CRITERIA.find((x) => x[0] === k)[1]})`); scores[k] = v; }
    const P = await people();
    const who = isPanel ? cx.cu.id : (p.on_behalf_of && (i.interviewer_ids || []).includes(p.on_behalf_of) ? p.on_behalf_of : cx.cu.id);
    const fb = { interviewer_id: who, interviewer_name: P.name(who), scores, overall, remarks: String(p.remarks || '').slice(0, 2000), recommendation: p.recommendation, submitted_at: nowIso(), submitted_by: cx.cu.id, on_behalf: who !== cx.cu.id || (!isPanel && true) };
    const feedbacks = [...(i.feedbacks || []).filter((f) => f.interviewer_id !== who), fb];
    const panel = i.interviewer_ids || [];
    const allIn = panel.length === 0 || panel.every((u) => feedbacks.some((f) => f.interviewer_id === u));
    const next = { ...i, feedbacks, status: allIn ? 'completed' : 'scheduled', completed_at: allIn ? nowIso() : i.completed_at, history: [...(i.history || []), { at: nowIso(), action: 'feedback', by: cx.name, text: `${P.name(who)}: ${recs[p.recommendation]} (${overall}/5)` }] };
    await saveInterview(next);
    const c = await loadCand(i.candidate_id);
    let outcome = null;
    if (c) {
      let cc = await logEvent(c, { type: 'interview', text: `${i.round_name}: feedback from ${P.name(who)} — ${recs[p.recommendation]} (${overall}/5)${fb.remarks ? ` — “${fb.remarks.slice(0, 160)}”` : ''}`, by: cx.cu.id, by_name: cx.name, ref: { interview_id: i.id } });
      // legacy readers (the older scorecard list)
      const sc = { interviewer: P.name(who), rating: overall, recommendation: p.recommendation === 'next_round' ? 'hold' : p.recommendation, notes: fb.remarks, round: i.round_name, recorded_at: fb.submitted_at };
      cc = { ...cc, interview_scorecards: [...(cc.interview_scorecards || []), sc], interview_scorecard: sc, interviewed_at: fb.submitted_at };
      await saveCand(cc);
      if (allIn && ['interview_scheduled', 'interviewed'].includes(cc.status)) {
        if (cc.status === 'interview_scheduled') cc = await moveCandidate(cc, 'interviewed', { by: cx.cu.id, byName: cx.name, text: `${i.round_name} completed`, ref: { interview_id: i.id } });
        const verdicts = new Set(feedbacks.map((f) => f.recommendation));
        if (verdicts.size === 1) {
          const v = [...verdicts][0]; const to = { select: 'selected', reject: 'rejected', hold: 'on_hold', next_round: 'next_round_recommended' }[v];
          cc = await moveCandidate(cc, to, { by: cx.cu.id, byName: cx.name, text: `${i.round_name}: ${recs[v]}${feedbacks.length > 1 ? ' (panel unanimous)' : ''}`, ref: { interview_id: i.id } });
          outcome = to;
          const cfg = await loadConfig();
          const req = await loadReq(reqKey(cc));
          if (to === 'selected' && wants(cfg, 'candidate_selected', 'recruiter')) await notifyUsers([i.created_by, req?.hiring_manager_id].filter(Boolean), { title: 'Candidate selected', message: `${candName(cc)} was selected for ${reqTitle(req) || cc.position_applied}.`, type: 'success' });
          if (to === 'rejected' && wants(cfg, 'candidate_rejected', 'recruiter')) await notifyUsers([i.created_by], { title: 'Candidate rejected after interview', message: `${candName(cc)} — ${i.round_name}.` });
        } else { cc = await logEvent(cc, { type: 'note', text: 'Panel gave different recommendations — HR to take the decision', by_name: 'System' }); outcome = 'panel_split'; }
      }
    }
    return res.json({ success: true, completed: allIn, outcome });
  },

  async rh_interview_remind_feedback({ cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const list = (await enrich(await allInterviews())).filter((i) => i.is_past || (i.feedback_pending && i.status === 'scheduled'));
    let n = 0;
    for (const i of list) {
      const have = new Set((i.feedbacks || []).map((f) => f.interviewer_id));
      const todo = (i.interviewer_ids || []).filter((u) => !have.has(u));
      if (!todo.length) continue;
      await notifyUsers(todo, { title: 'Interview feedback pending', message: `Please submit your feedback for ${i.candidate_name} — ${i.round_name} (${fmtDate(i.scheduled_date)}).`, link: '/InterviewManagement', type: 'warning', email: true }); n += todo.length;
    }
    return res.json({ success: true, reminded: n });
  },
};
function x0(a) { return a[0]?.scheduled_date || ''; }
export default H;
export { allInterviews, enrich, endMs, istMs };
