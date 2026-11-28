// Employee confirmation (cf_*). HR initiates and records observations → the Reporting Manager assesses and decides
// (Confirm / Hold / Reject) → the system updates the record and sends the mail. Every step is appended to the case history.
// Only an administrator can correct a decision, and must say why.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run, withTransaction } from '../db.js';
import { listSignatories } from '../utils/signatoryStore.js';
import { STATUS, DECISIONS, OBSERVATION_FIELDS, onProbation, dueDate, daysBetween, trackerStatus, cleanObservations, decisionProblems, employeeAfterDecision, CRITERIA } from '../utils/confirmationRules.js';
import { mails, deliver, confirmationLetterHtml } from '../utils/confirmationMail.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const fail = (res, error, code = 200) => res.status(code).json({ success: false, error });
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const clean = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const entry = (cx, action, detail = '') => ({ at: now(), actor_id: cx?.id || null, actor_name: cx?.name || 'System', action, detail });

async function context(cu) {
  const u = (await one('SELECT role, custom_role, full_name FROM users WHERE id=$1', [cu.id])) || {};
  const has = (...r) => [u.role, u.custom_role].some((x) => r.includes(x));
  return { id: cu.id, name: u.full_name || '', admin: has('admin'), hr: has('hr', 'admin'), view: has('hr', 'admin', 'management') };
}
async function people() {
  const users = Object.fromEntries((await all('SELECT id, full_name, email, former_email FROM users')).map((u) => [u.id, u]));
  const employees = (await all("SELECT id, user_id, data FROM entities WHERE type='Employee'")).map((r) => { const d = parse(r.data); return { ...d, _row: r.id, user_id: d.user_id || r.user_id }; });
  return { users, employees, byUser: Object.fromEntries(employees.map((e) => [e.user_id, e])) };
}
const cases = async () => (await all("SELECT id, data FROM entities WHERE type='ConfirmationCase'")).map((r) => ({ ...parse(r.data), id: r.id }));
export const caseFor = async (userId) => (await cases()).filter((c) => c.user_id === userId && c.status !== 'cancelled').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;

const save = (c, client) => {
  const sql = 'UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3';
  const args = [JSON.stringify({ ...c, updated_at: now() }), c.status, c.id];
  return client ? client.query(sql, args) : run(sql, args);
};
// Changes a case under a row lock, so two clicks (or two people) can never both act on the same state.
async function locked(id, change) {
  return withTransaction(async (client) => {
    const row = (await client.query("SELECT data FROM entities WHERE type='ConfirmationCase' AND id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) return { error: 'Confirmation request not found' };
    const c = { ...parse(row.data), id };
    const out = await change(c, client);
    if (!out?.error) await save(c, client);
    return out?.error ? out : { case: c, ...out };
  });
}

async function notify(userIds, title, message, type = 'info') {
  const { sendPushToUser } = await import('../utils/push.js');
  for (const uid of new Set([].concat(userIds).filter(Boolean))) {
    try {
      await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), uid, title, message, type, '/ConfirmationManagement']);
      sendPushToUser(uid, { title, message, type, link: '/ConfirmationManagement' });
    } catch (e) { console.warn('[confirmation] notify failed:', e.message); }
  }
}
const hrIds = async () => (await all("SELECT id FROM users WHERE disabled_at IS NULL AND COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')")).map((r) => r.id);

const mailInfo = (c, e, users) => ({
  name: e.display_name || users[c.user_id]?.full_name || c.employee_name, code: e.employee_code || '', department: e.department || '', designation: e.designation || '',
  joined: e.date_of_joining, due: c.due_date, managerName: users[c.manager_id]?.full_name || c.manager_name,
});
const emailOf = (u) => u?.former_email || u?.email || '';

// Each mail of a case is identified by kind and round and is sent once: a repeat is refused unless the earlier try failed.
async function sendOnce(caseId, kind, round, send) {
  const key = `${kind}:${round}`;
  const claim = await locked(caseId, (c) => {
    const prior = (c.mails || []).find((m) => m.key === key);
    if (prior && prior.status !== 'failed') return { error: 'This email has already been sent' };
    c.mails = [...(c.mails || []).filter((m) => m.key !== key), { key, kind, round, status: 'sending', at: now(), attempts: (prior?.attempts || 0) + 1 }];
    return {};
  });
  if (claim.error) return { status: 'skipped', error: claim.error };
  let result;
  try { result = await send(claim.case); } catch (e) { result = { status: 'failed', error: e.message, at: now() }; }
  await locked(caseId, (c) => {
    c.mails = c.mails.map((m) => (m.key === key ? { ...m, ...result } : m));
    c.history.push(entry(null, result.status === 'sent' ? 'email_sent' : 'email_failed', `${kind.replace('_', ' ')} email to ${(result.to || []).join(', ') || '—'}${result.cc?.length ? ` (CC ${result.cc.join(', ')})` : ''}${result.error ? `: ${result.error}` : ''}`));
    return {};
  });
  return result;
}

async function sendRequestMail(caseId) {
  const { users, byUser } = await people();
  const c0 = (await cases()).find((c) => c.id === caseId);
  return sendOnce(caseId, 'request', c0.round, (c) => deliver(emailOf(users[c.manager_id]), mails.request({ ...mailInfo(c, byUser[c.user_id] || {}, users), hasObservations: (c.observations || []).length > 0 })));
}

// The confirmation letter: generated once, kept in the employee's documents, and attached to the mail.
async function confirmationDocument(c, e, users) {
  const fx = await import('./functions.js');
  const name = e.display_name || users[c.user_id]?.full_name || c.employee_name;
  const html = confirmationLetterHtml({ name, gender: e.gender, designation: e.designation, effective: c.decision.effective_date, signatories: await listSignatories(), stamp: fx.getStampDataUrl() || '' });
  const pdf = await fx.buildLetterPdf('Confirmation Letter', '', html);
  const docId = `cfl-${c.id}`;
  let url = '';
  try {
    const { isBucketConfigured, buildKey, putToBucket, presignGet } = await import('../utils/bucket.js');
    if (isBucketConfigured()) { const key = buildKey(`letters/${docId}`, '.pdf'); await putToBucket(key, pdf, 'application/pdf'); url = await presignGet(key, { expiresIn: 31536000, filename: 'Confirmation_Letter.pdf' }); }
  } catch (err) { console.warn('[confirmation] bucket upload failed:', err.message); }
  const doc = { id: docId, user_id: c.user_id, document_type: 'hr_letter', letter_type: 'confirmation', document_name: `Confirmation Letter — ${c.decision.effective_date}`, letter_content: html, ...(url ? { document_url: url } : {}), employee_name: name, status: 'verified', created_at: now(), updated_at: now() };
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Document',$2,'verified',$3) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()::TEXT", [docId, c.user_id, JSON.stringify(doc)]);
  return pdf;
}

async function sendDecisionMail(caseId) {
  const { users, byUser } = await people();
  const c0 = (await cases()).find((c) => c.id === caseId);
  if (!['confirmed', 'on_hold', 'rejected'].includes(c0?.status)) return { status: 'skipped', error: 'No decision has been recorded' };
  return sendOnce(caseId, c0.status, c0.round, async (c) => {
    const e = byUser[c.user_id] || {};
    const info = { ...mailInfo(c, e, users), remarks: c.decision.remarks, reviewDate: c.decision.review_date, effective: c.decision.effective_date };
    let attachments;
    if (c.status === 'confirmed') attachments = [{ filename: 'Confirmation_Letter.pdf', content: await confirmationDocument(c, e, users) }];   // no letter, no mail
    const result = await deliver(emailOf(users[c.user_id]), mails[c.status](info), attachments);
    if (!emailOf(users[c.user_id])) return { ...result, status: 'failed', error: 'The employee has no email address; HR received the copy' };
    if (c.status === 'confirmed' && result.status === 'sent') {
      const id = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LetterDispatch',$2,'sent',$3)", [id, c.user_id, JSON.stringify({ id, document_id: `cfl-${c.id}`, user_id: c.user_id, employee_name: info.name, letter_type: 'confirmation', label: 'Confirmation Letter', recipient_email: emailOf(users[c.user_id]), recipient_mode: 'registered', cc: result.cc, sent_at: result.at, status: 'sent', sent_by_name: 'Confirmation workflow', created_at: result.at })]);
    }
    return result;
  });
}

async function applyToEmployee(client, userId, status, opts) {
  const row = (await client.query("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1 FOR UPDATE", [userId])).rows[0];
  if (!row) return;
  await client.query('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(employeeAfterDecision(parse(row.data), status, opts)), row.id]);
}

// What HR (and the manager) see about the person's record while assessing.
async function recordSummary(userId, emp) {
  const from = [new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10), String(emp.date_of_joining || '').slice(0, 10)].sort()[1];
  const att = (await all("SELECT data FROM entities WHERE type='Attendance' AND (user_id=$1 OR data::jsonb->>'user_id'=$1) AND data::jsonb->>'date' >= $2", [userId, from])).map((r) => parse(r.data));
  const count = (f) => att.filter(f).length;
  const leaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1", [userId])).map((r) => parse(r.data)).filter((l) => String(l.start_date) >= from && l.status === 'approved');
  const docs = (await all("SELECT data FROM entities WHERE type='Document' AND user_id=$1 AND data::jsonb->>'letter_type'='warning'", [userId])).map((r) => parse(r.data));
  const pips = (await all("SELECT data FROM entities WHERE type='PerformanceImprovementPlan' AND user_id=$1", [userId])).length;
  return {
    since: from,
    attendance: { recorded: att.length, absent: count((a) => a.status === 'absent'), late: count((a) => a.late_arrival || a.status === 'late'), half_day: count((a) => a.status === 'half_day' && !a.leave_id), short: count((a) => a.status === 'short_attendance'), regularised: count((a) => a.regularised) },
    leave_days: leaves.reduce((s, l) => s + (Number(l.total_days ?? l.days) || 0), 0),
    warning_letters: docs.map((d) => d.document_name), improvement_plans: pips,
  };
}

export async function handleConfirmation(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const cx = await context(cu);
  const { users, employees, byUser } = await people();
  const isManagerOf = (userId) => userId !== cx.id && byUser[userId]?.reporting_manager_id === cx.id;

  const view = (e, c) => {
    const status = trackerStatus(e, c);
    const due = c && ['pending_manager', 'rejected', 'confirmed'].includes(c.status) ? c.due_date : dueDate(e);
    return {
      user_id: e.user_id, name: e.display_name || users[e.user_id]?.full_name || '', employee_code: e.employee_code || '', department: e.department || '', designation: e.designation || '',
      date_of_joining: String(e.date_of_joining || '').slice(0, 10), due_date: due, days_left: due ? daysBetween(today(), due) : null, status, status_label: STATUS[status] || status,
      manager_id: e.reporting_manager_id || '', manager_name: users[e.reporting_manager_id]?.full_name || '', case_id: c?.id || '', round: c?.round || 0,
      can_decide: c?.status === 'pending_manager' && isManagerOf(e.user_id), is_my_report: isManagerOf(e.user_id),
      mail_failed: (c?.mails || []).some((m) => m.status === 'failed'), exit_review: c?.status === 'rejected' ? c.exit_id ? 'started' : 'pending' : '', exit_id: c?.exit_id || '',
      review_date: c?.status === 'on_hold' ? c.decision?.review_date : '', initiated_at: c?.initiated_at || '', decided_at: c?.decision?.at || '',
    };
  };

  if (name === 'cf_tracker') {
    const all_ = await cases();
    const latest = {};
    for (const c of all_.filter((x) => x.status !== 'cancelled').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) latest[c.user_id] = c;
    const rows = employees.filter((e) => e.user_id && (onProbation(e) || latest[e.user_id]))
      .filter((e) => cx.view || isManagerOf(e.user_id)).map((e) => view(e, latest[e.user_id])).filter((r) => r.status)
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, rows.filter((r) => r.status === k).length]));
    return res.json({ success: true, rows, counts, can_view_all: cx.view, can_initiate: cx.hr, is_admin: cx.admin, today: today() });
  }

  const userId = p.user_id || (p.case_id ? (await cases()).find((c) => c.id === p.case_id)?.user_id : '');
  const emp = byUser[userId];
  if (!emp) return fail(res, 'Employee not found');
  if (!cx.view && !isManagerOf(userId)) return fail(res, 'You can only see confirmation records of your own team', 403);
  const current = await caseFor(userId);

  if (name === 'cf_detail') {
    const legacy = cx.view ? (await all("SELECT data FROM entities WHERE type='ProbationReview' AND user_id=$1", [userId])).map((r) => parse(r.data)) : [];
    return res.json({ success: true, employee: view(emp, current), case: current ? { ...current, manager_name: users[current.manager_id]?.full_name || current.manager_name } : null, records: await recordSummary(userId, emp), earlier_reviews: legacy, observation_fields: OBSERVATION_FIELDS });
  }

  if (name === 'cf_initiate') {
    if (!cx.hr) return fail(res, 'Only HR or admin can initiate a confirmation', 403);
    if (userId === cx.id) return fail(res, 'You cannot initiate your own confirmation');
    if (!onProbation(emp)) return fail(res, 'This employee is not on probation');
    const managerId = emp.reporting_manager_id;
    if (!managerId || managerId === userId || !users[managerId]) return fail(res, 'Assign a reporting manager to this employee first: the manager takes the decision');
    const observations = cleanObservations(p.observations);
    const added = Object.keys(observations).length ? [{ ...observations, by: cx.id, by_name: cx.name, at: now() }] : [];
    const out = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`confirmation:${userId}`]);
      const open = (await client.query("SELECT id, data FROM entities WHERE type='ConfirmationCase' AND user_id=$1 FOR UPDATE", [userId])).rows.map((r) => ({ ...parse(r.data), id: r.id }))
        .filter((c) => c.status !== 'cancelled').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (open?.status === 'pending_manager') return { error: 'The request is already with the reporting manager' };
      if (open?.status === 'rejected') return { error: 'The manager did not confirm this employee. Only an administrator can correct that decision.' };
      if (open?.status === 'confirmed') return { error: 'This employee has already been confirmed through the workflow' };
      const base = open || { id: uuidv4(), user_id: userId, employee_name: emp.display_name || users[userId]?.full_name || '', created_at: now(), round: 0, observations: [], history: [], mails: [], previous_decisions: [] };
      const c = {
        ...base, round: base.round + 1, status: 'pending_manager', due_date: dueDate(emp), manager_id: managerId, manager_name: users[managerId].full_name,
        previous_decisions: open?.decision ? [...(base.previous_decisions || []), open.decision] : base.previous_decisions || [], decision: null,
        initiated_by: cx.id, initiated_by_name: cx.name, initiated_at: now(), observations: [...base.observations, ...added],
      };
      c.history = [...c.history, entry(cx, open ? 'reinitiated' : 'initiated', `Sent to ${users[managerId].full_name}`), ...(added.length ? [entry(cx, 'observations_added', Object.entries(observations).map(([k, v]) => `${OBSERVATION_FIELDS[k]}: ${v}`).join(' | '))] : [])];
      if (open) await save(c, client);
      else await client.query("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ConfirmationCase',$2,$3,$4)", [c.id, userId, c.status, JSON.stringify({ ...c, updated_at: now() })]);
      return { case: c };
    });
    if (out.error) return fail(res, out.error);
    await notify(managerId, 'Confirmation assessment requested', `Please assess ${out.case.employee_name} and submit your decision.`, 'warning');
    const mail = await sendRequestMail(out.case.id);
    return res.json({ success: true, case_id: out.case.id, mail_status: mail.status, mail_error: mail.error || '' });
  }

  if (!current) return fail(res, 'The confirmation process has not been initiated for this employee');

  if (name === 'cf_add_observation') {
    if (!cx.hr) return fail(res, 'Only HR or admin can record observations', 403);
    if (userId === cx.id) return fail(res, 'You cannot record observations about yourself');
    const observations = cleanObservations(p.observations);
    if (!Object.keys(observations).length) return fail(res, 'Write at least one observation');
    const out = await locked(current.id, (c) => {
      if (c.status !== 'pending_manager') return { error: 'Observations can be added only while the manager is assessing' };
      c.observations.push({ ...observations, by: cx.id, by_name: cx.name, at: now() });
      c.history.push(entry(cx, 'observations_added', Object.entries(observations).map(([k, v]) => `${OBSERVATION_FIELDS[k]}: ${v}`).join(' | ')));
      return {};
    });
    if (out.error) return fail(res, out.error);
    await notify(current.manager_id, 'HR added an observation', `New HR observation on ${current.employee_name}'s confirmation.`);
    return res.json({ success: true });
  }

  if (name === 'cf_decide') {
    if (!isManagerOf(userId)) return fail(res, 'Only the employee’s reporting manager can take this decision', 403);
    const problems = decisionProblems(p, today());
    if (problems.length) return fail(res, problems.join(' '));
    const status = DECISIONS[p.decision];
    const decision = {
      decision: p.decision, status, by: cx.id, by_name: cx.name, at: now(), comments: clean(p.comments), remarks: clean(p.remarks),
      scores: Object.fromEntries(CRITERIA.map((k) => [k, Number(p.scores[k])])), review_date: p.decision === 'hold' ? String(p.review_date).slice(0, 10) : '', effective_date: status === 'confirmed' ? today() : '',
    };
    const out = await locked(current.id, async (c, client) => {
      if (c.status !== 'pending_manager') return { error: 'A decision has already been recorded for this request' };
      c.status = status; c.decision = decision; c.manager_id = cx.id; c.manager_name = cx.name;
      c.history.push(entry(cx, 'decision', `${STATUS[status]}${decision.review_date ? ` until ${decision.review_date}` : ''}. Assessment: ${decision.comments}${decision.remarks ? ` Remarks: ${decision.remarks}` : ''}`));
      await applyToEmployee(client, userId, status, { today: today(), reviewDate: decision.review_date, remarks: decision.remarks, byName: cx.name });
      return {};
    });
    if (out.error) return fail(res, out.error);
    const mail = await sendDecisionMail(current.id);
    const label = STATUS[status];
    await notify(userId, 'Confirmation decision', status === 'confirmed' ? 'Congratulations! Your employment has been confirmed.' : status === 'on_hold' ? `Your confirmation is on hold until ${decision.review_date}.` : 'Your confirmation was not recommended. HR will contact you.', status === 'confirmed' ? 'success' : 'info');
    await notify(await hrIds(), `Confirmation: ${label}`, `${cx.name} decided "${label}" for ${current.employee_name}.${status === 'rejected' ? ' Review it and start the exit process if applicable.' : ''}${mail.status === 'failed' ? ' The email could not be sent — resend it from the tracker.' : ''}`, status === 'rejected' ? 'warning' : 'info');
    return res.json({ success: true, status, mail_status: mail.status, mail_error: mail.error || '' });
  }

  if (name === 'cf_resend') {
    if (!cx.hr) return fail(res, 'Only HR or admin can resend an email', 403);
    if (!(current.mails || []).some((m) => m.status === 'failed')) return fail(res, 'There is no failed email to resend');
    const mail = current.status === 'pending_manager' ? await sendRequestMail(current.id) : await sendDecisionMail(current.id);
    return res.json({ success: mail.status === 'sent', error: mail.error || '', mail_status: mail.status });
  }

  if (name === 'cf_start_exit') {
    if (!cx.hr) return fail(res, 'Only HR or admin can start the exit process', 403);
    if (current.status !== 'rejected') return fail(res, 'Only a rejected confirmation leads to an exit');
    if (current.exit_id) return fail(res, 'The exit process has already been started');
    const lwd = String(p.last_working_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lwd) || lwd < today()) return fail(res, 'Choose the last working day (today or later)');
    if (clean(p.note).length < 10) return fail(res, 'Record your HR review (at least 10 characters)');
    const fx = await import('./functions.js');
    const claim = await locked(current.id, (c) => (c.exit_id || c.exit_starting ? { error: 'The exit process has already been started' } : ((c.exit_starting = true), {})));
    if (claim.error) return fail(res, claim.error);
    let exit;
    try { exit = await fx.openProbationExit(userId, { id: cx.id, full_name: cx.name }, `${current.decision.remarks} — HR review: ${clean(p.note)}`, lwd); }
    catch (e) { await locked(current.id, (c) => { delete c.exit_starting; return {}; }); throw e; }
    await locked(current.id, (c) => { delete c.exit_starting; c.exit_id = exit.exit_id; c.history.push(entry(cx, 'exit_started', `Exit process ${exit.reused ? 'already open' : 'opened'}; last working day ${exit.last_working_date}. HR review: ${clean(p.note)}`)); return {}; });
    await notify(userId, 'Exit process started', `Your exit process has started. Your last working day is ${exit.last_working_date}. Please open My Exit.`, 'warning');
    return res.json({ success: true, exit_id: exit.exit_id, last_working_date: exit.last_working_date });
  }

  if (name === 'cf_correct') {
    if (!cx.admin) return fail(res, 'Only an administrator can correct a confirmation decision', 403);
    if (userId === cx.id) return fail(res, 'You cannot correct your own confirmation');
    const to = p.status, reason = clean(p.reason);
    if (!['pending_manager', 'confirmed', 'on_hold', 'rejected'].includes(to)) return fail(res, 'Choose the corrected status');
    if (reason.length < 10) return fail(res, 'Give the reason for this correction (at least 10 characters)');
    const review = String(p.review_date || '').slice(0, 10);
    if (to === 'on_hold' && !(review > today())) return fail(res, 'Choose a revised review date in the future');
    const out = await locked(current.id, async (c, client) => {
      const from = c.status;
      if (from === to) return { error: 'The case already has this status' };
      if (c.decision) c.previous_decisions = [...(c.previous_decisions || []), c.decision];
      c.status = to; c.round += 1;
      c.decision = to === 'pending_manager' ? null : { status: to, by: cx.id, by_name: `${cx.name} (administrative correction)`, at: now(), comments: '', remarks: reason, review_date: to === 'on_hold' ? review : '', effective_date: to === 'confirmed' ? today() : '', correction: true };
      c.history.push(entry(cx, 'admin_correction', `${STATUS[from]} → ${STATUS[to]}. Reason: ${reason}`));
      if (to === 'pending_manager') {
        const row = (await client.query("SELECT id, data FROM entities WHERE type='Employee' AND user_id=$1 FOR UPDATE", [userId])).rows[0];
        if (row) await client.query('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify({ ...employeeAfterDecision(parse(row.data), 'pending_manager', { today: today() }), probation_end_date: c.due_date, confirmation_date: '', employee_confirmation_date: '' }), row.id]);
      } else await applyToEmployee(client, userId, to, { today: today(), reviewDate: review, remarks: reason, byName: cx.name });
      return {};
    });
    if (out.error) return fail(res, out.error);
    let mail = null;
    if (to === 'pending_manager') mail = await sendRequestMail(current.id);
    else if (p.email_employee) mail = await sendDecisionMail(current.id);
    await notify([current.manager_id, ...(await hrIds())], 'Confirmation corrected by admin', `${current.employee_name}: now "${STATUS[to]}". Reason: ${reason}`, 'warning');
    return res.json({ success: true, status: to, mail_status: mail?.status || '', exit_open: !!out.case.exit_id && to !== 'rejected' });
  }

  return res.status(400).json({ error: `Unknown function ${name}` });
}
