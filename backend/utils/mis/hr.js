// Intelligent MIS — HR lifecycle analytics: probation & confirmation, letters & documentation, attrition & retention,
// loans & advances, employee lifecycle / HR operations, and recruitment extras (sources, interviews, conversions).
// Everything is derived from records that already exist in MaxVolt One; nothing is stored separately and nothing is estimated
// without saying so. Where the application does not record what a metric needs, the section says so ("unavailable" + reason)
// instead of showing a zero. Loan repayments are read from the loan deduction printed on the uploaded payslips.
import { addDays, diffDays, fmtD } from './calendar.js';

const all = async (sql, params) => (await import('../../db.js')).all(sql, params);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const pctOf = (a, b) => (b > 0 ? r1((a / b) * 100) : null);
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const cap = (a, n = 300) => a.slice(0, n);
const ym = (d) => String(d).slice(0, 7);
const addMonths = (s, n) => { const [y, m] = s.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const monthLabel = (s) => { const [y, m] = s.split('-').map(Number); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`; };
const parse = (rows) => rows.flatMap(r => { try { const d = JSON.parse(r.data); if (!d.id) d.id = r.id; d._createdAt = r.created_at ? new Date(r.created_at).toISOString() : ''; return [d]; } catch { return []; } });

export const HR_CFG = {
  probationSoonDays: 30,        // "approaching completion"
  confirmationOverdueDays: 0,   // overdue as soon as the probation end date has passed (+ this many days of grace)
  appointmentGraceDays: 7,      // an appointment letter is "pending" this many days after joining
  documentRequired: ['aadhar', 'pan', 'educational'],
  multiWarning: 2,              // employees with at least this many warning letters
  loanBehindInstalments: 1,     // behind by more than this many instalments = overdue
  attritionHighPct: 15,         // annualised department attrition worth flagging
  ticketPendingDays: 7,
  tenureBands: [[0, 183, 'Under 6 months'], [183, 365, '6–12 months'], [365, 730, '1–2 years'], [730, 1825, '2–5 years'], [1825, Infinity, '5+ years']],
};

// ── extra records (everything else is already in ctx) ───────────────────────────────────────────────────────────────────
export async function loadHrExtras() {
  const t = async (type) => parse(await all('SELECT id, data, created_at FROM entities WHERE type=$1', [type]));
  const [docs, probation, loans, bonuses, tickets, invites, perf, pips, enroll, bank] = await Promise.all([
    t('Document'), t('ProbationReview'), t('Loan'), t('Bonus'), t('Ticket'), t('OnboardingInvite'), t('PerformanceReview'), t('PerformanceImprovementPlan'), t('TrainingEnrollment'), t('BankDetails'),
  ]);
  // loan deductions printed on uploaded payslips (never the PDF bytes)
  const pay = await all("SELECT user_id, (data::jsonb->>'year') y, (data::jsonb->>'month') m, (data::jsonb->'deductions'->>'loan') loan FROM entities WHERE type='Payroll' AND status <> 'cancelled'");
  const loanPaid = {};
  for (const p of pay) { const v = num(p.loan); if (v > 0 && p.y && p.m) (loanPaid[p.user_id] ||= []).push({ ym: `${p.y}-${String(p.m).padStart(2, '0')}`, amount: v }); }
  const payMonths = [...new Set(pay.map(p => `${p.y}-${String(p.m).padStart(2, '0')}`))].sort();
  return { docs, probation, loans, bonuses, tickets, invites, perf, pips, enroll, bank, loanPaid, payMonths };
}

const row = (e, extra = {}) => ({ code: e.code, name: e.name, dept: e.dept, designation: e.designation, ...extra });

// ── probation & confirmation ────────────────────────────────────────────────────────────────────────────────────────────
export function computeProbation(ctx, model, scope, from, to, today, x, cfg = HR_CFG) {
  const live = scope.scopeEmps.filter(e => !e.separated);
  const reviewBy = {};
  for (const r of x.probation) if (r.user_id) (reviewBy[r.user_id] ||= []).push(r);
  for (const k of Object.keys(reviewBy)) reviewBy[k].sort((a, b) => String(b.updated_at || b._createdAt).localeCompare(String(a.updated_at || a._createdAt)));
  const onProb = live.filter(e => e.empStatus === 'probation');
  const rows = onProb.map(e => {
    const rv = reviewBy[e.uid]?.[0];
    const extended = !!(rv && (rv.extended_until || /extend/i.test(`${rv.final_action || ''} ${rv.action || ''}`)));
    let end = dayOf(e.raw.probation_end_date);
    if (extended && rv.extended_until && dayOf(rv.extended_until) > end) end = dayOf(rv.extended_until);
    const daysLeft = end ? diffDays(today, end) : null;
    const bucket = !end ? 'No end date' : daysLeft < -cfg.confirmationOverdueDays ? 'Overdue' : daysLeft <= cfg.probationSoonDays ? 'Ending soon' : 'In progress';
    return row(e, { doj: e.doj, end, daysLeft, bucket, extended, reviewStatus: rv ? label(rv.status) : 'No review started', reviewId: rv?.id || null, overdueBy: daysLeft != null && daysLeft < 0 ? -daysLeft : 0 });
  }).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  const overdue = rows.filter(r => r.bucket === 'Overdue'), soon = rows.filter(r => r.bucket === 'Ending soon'), noDate = rows.filter(r => r.bucket === 'No end date');
  // confirmed: an actual confirmation date is recorded
  const confirmed = live.filter(e => e.empStatus === 'confirmation').map(e => ({ e, at: dayOf(e.raw.employee_confirmation_date) }));
  const confirmedInPeriod = confirmed.filter(c => c.at && c.at >= from && c.at <= to);
  const withDates = confirmed.filter(c => c.at && c.e.doj && c.at >= c.e.doj);
  const days = withDates.map(c => diffDays(c.e.doj, c.at));
  const byDept = {};
  for (const r of rows) { const d = (byDept[r.dept] ||= { dept: r.dept, onProbation: 0, overdue: 0, endingSoon: 0, extended: 0, confirmedInPeriod: 0 }); d.onProbation++; if (r.bucket === 'Overdue') d.overdue++; if (r.bucket === 'Ending soon') d.endingSoon++; if (r.extended) d.extended++; }
  for (const c of confirmedInPeriod) { const d = (byDept[c.e.dept] ||= { dept: c.e.dept, onProbation: 0, overdue: 0, endingSoon: 0, extended: 0, confirmedInPeriod: 0 }); d.confirmedInPeriod++; }
  const pipeline = {}; for (const r of x.probation) pipeline[label(r.status)] = (pipeline[label(r.status)] || 0) + 1;
  return {
    counts: { onProbation: rows.length, overdue: overdue.length, endingSoon: soon.length, noEndDate: noDate.length, extended: rows.filter(r => r.extended).length, confirmedInPeriod: confirmedInPeriod.length, confirmedTotal: confirmed.length, trainees: live.filter(e => e.empStatus === 'trainee').length },
    avgDaysToConfirm: days.length ? { avg: r1(mean(days)), n: days.length, of: confirmed.length } : null,
    confirmedDateMissing: confirmed.length - withDates.length,
    byDept: Object.values(byDept).sort((a, b) => b.overdue - a.overdue || b.onProbation - a.onProbation),
    overdue: cap(overdue), endingSoon: cap(soon), noEndDate: cap(noDate), upcoming: cap(rows.filter(r => r.bucket !== 'No end date' && r.daysLeft >= 0).slice(0, 60)),
    confirmedList: cap(confirmedInPeriod.map(c => row(c.e, { doj: c.e.doj, confirmedOn: c.at, days: c.e.doj ? diffDays(c.e.doj, c.at) : null }))),
    pipeline, rows: cap(rows, 600),
  };
}

// ── letters & documentation ─────────────────────────────────────────────────────────────────────────────────────────────
export function computeLetters(ctx, model, scope, from, to, today, x, cfg = HR_CFG) {
  const live = scope.scopeEmps.filter(e => !e.separated);
  const liveIds = new Set(live.map(e => e.uid));
  const letters = x.docs.filter(d => d.document_type === 'hr_letter');
  const inScope = letters.filter(d => !d.user_id || scope.scopeEmps.some(e => e.uid === d.user_id));
  const dateOfLetter = (d) => dayOf(d.created_at || d.created_date || d._createdAt);
  const byType = {};
  for (const d of inScope) { const t = d.letter_type || 'other'; const o = (byType[t] ||= { type: t, label: label(t), total: 0, inPeriod: 0, sent: 0, pendingIssue: 0 }); o.total++; if (dateOfLetter(d) >= from && dateOfLetter(d) <= to) o.inPeriod++; if (d.sent_at) o.sent++; else o.pendingIssue++; }
  const trackingStart = letters.length ? letters.map(dateOfLetter).filter(Boolean).sort()[0] : null;
  const has = (uid, type) => letters.some(d => d.user_id === uid && d.letter_type === type) || (type === 'appointment' && x.docs.some(d => d.user_id === uid && d.document_type === 'offer_letter'));
  // appointment letters: pending = joined after letters began to be tracked here and still none recorded
  const noAppointment = live.filter(e => !has(e.uid, 'appointment'));
  const pendingAppointment = noAppointment.filter(e => trackingStart && e.doj >= trackingStart && diffDays(e.doj, today) >= cfg.appointmentGraceDays)
    .map(e => row(e, { doj: e.doj, daysSinceJoining: diffDays(e.doj, today) })).sort((a, b) => b.daysSinceJoining - a.daysSinceJoining);
  const legacyNoAppointment = noAppointment.length - pendingAppointment.length;
  // confirmation letters
  const reviewConfirmedNoLetter = x.probation.filter(r => (r.final_action === 'confirm' || r.status === 'confirmed' || /confirm/i.test(r.final_action || '')) && !r.letter_sent && liveIds.has(r.user_id))
    .map(r => { const e = model.byUid[r.user_id]; return row(e, { reason: `Confirmed on review (${label(r.status)}); letter not sent` }); });
  const confirmedNoLetter = live.filter(e => e.empStatus === 'confirmation' && dayOf(e.raw.employee_confirmation_date) && trackingStart && dayOf(e.raw.employee_confirmation_date) >= trackingStart && !has(e.uid, 'confirmation'))
    .map(e => row(e, { reason: `Confirmed on ${fmtD(dayOf(e.raw.employee_confirmation_date))}; no confirmation letter recorded` }));
  const seen = new Set(); const pendingConfirmation = [...reviewConfirmedNoLetter, ...confirmedNoLetter].filter(r => { const k = r.code + r.name; if (seen.has(k)) return false; seen.add(k); return true; });
  // transfers without a letter
  const tf = (ctx.transfers || []).filter(t => t.user_id && dayOf(t.effective_date) >= addDays(today, -90) && liveIds.has(t.user_id) && !letters.some(d => d.user_id === t.user_id && /transfer|promotion/i.test(d.letter_type || '') && dateOfLetter(d) >= dayOf(t.effective_date)))
    .map(t => row(model.byUid[t.user_id], { reason: `Department changed ${t.from_department || '—'} → ${t.to_department || '—'} on ${fmtD(dayOf(t.effective_date))}; no transfer/promotion letter recorded` }));
  // warnings
  const warnings = inScope.filter(d => /warning/i.test(d.letter_type || '')).map(d => { const e = model.byUid[d.user_id]; return { code: e?.code || '', name: e?.name || d.employee_name || '', dept: e?.dept || '', date: dateOfLetter(d), reason: d.reason || d.extra?.reason || d.subject || d.extra?.subject || '', ref: d.ref || '', user_id: d.user_id, sent: !!d.sent_at }; }).sort((a, b) => b.date.localeCompare(a.date));
  const warnCount = {}; for (const w of warnings) warnCount[w.user_id] = (warnCount[w.user_id] || 0) + 1;
  const multiWarn = Object.entries(warnCount).filter(([, n]) => n >= cfg.multiWarning).map(([uid, n]) => { const e = model.byUid[uid]; return row(e || { code: '', name: '', dept: '', designation: '' }, { warnings: n }); });
  // generated but not yet issued
  const pendingIssue = inScope.filter(d => !d.sent_at).map(d => { const e = model.byUid[d.user_id]; return { code: e?.code || '', name: e?.name || d.employee_name || '', dept: e?.dept || '', type: label(d.letter_type), ref: d.ref || '', generated: dateOfLetter(d), status: d.status ? label(d.status) : 'Generated, not sent' }; });
  // employee document completion
  const have = {}; for (const d of x.docs) if (d.user_id && d.document_type && d.document_type !== 'hr_letter') (have[d.user_id] ||= new Set()).add(d.document_type);
  const bankBy = new Set(x.bank.map(b => b.user_id));
  const docRows = live.map(e => { const s = have[e.uid] || new Set(); const missing = cfg.documentRequired.filter(t => !s.has(t)); if (!bankBy.has(e.uid)) missing.push('bank details'); const total = cfg.documentRequired.length + 1; return row(e, { present: total - missing.length, required: total, missing: missing.map(label).join(', '), complete: missing.length === 0 }); });
  const incomplete = docRows.filter(r => !r.complete).sort((a, b) => a.present - b.present);
  const pendingByDept = {};
  const bump = (dept, k) => { const o = (pendingByDept[dept] ||= { dept, appointment: 0, confirmation: 0, transfer: 0, issue: 0, documents: 0 }); o[k]++; };
  pendingAppointment.forEach(r => bump(r.dept, 'appointment')); pendingConfirmation.forEach(r => bump(r.dept, 'confirmation')); tf.forEach(r => bump(r.dept, 'transfer')); pendingIssue.forEach(r => bump(r.dept || 'Unassigned', 'issue')); incomplete.forEach(r => bump(r.dept, 'documents'));
  return {
    trackingStart, totalRecorded: inScope.length, byType: Object.values(byType).sort((a, b) => b.total - a.total),
    counts: { warnings: warnings.length, warningsInPeriod: warnings.filter(w => w.date >= from && w.date <= to).length, multiWarning: multiWarn.length, pendingAppointment: pendingAppointment.length, legacyNoAppointment, pendingConfirmation: pendingConfirmation.length, pendingTransfer: tf.length, pendingIssue: pendingIssue.length, docIncomplete: incomplete.length, docComplete: docRows.length - incomplete.length, activeEmployees: live.length },
    warnings: cap(warnings), multiWarning: cap(multiWarn), pendingAppointment: cap(pendingAppointment), pendingConfirmation: cap(pendingConfirmation), pendingTransfer: cap(tf), pendingIssue: cap(pendingIssue),
    incompleteDocs: cap(incomplete, 500), pendingByDept: Object.values(pendingByDept).sort((a, b) => (b.appointment + b.confirmation + b.transfer + b.issue + b.documents) - (a.appointment + a.confirmation + a.transfer + a.issue + a.documents)),
    note: trackingStart ? `Letters generated in MaxVolt One are recorded from ${fmtD(trackingStart)}. ${legacyNoAppointment} active employee(s) have no appointment letter on record, but most joined before that date — their letters may exist outside the application, so only later joiners are treated as pending.` : 'No HR letter has been generated in MaxVolt One yet, so letters cannot be tracked.',
  };
}

// ── attrition & retention ───────────────────────────────────────────────────────────────────────────────────────────────
const classifyExit = (e, xr) => {
  const t = String(xr?.exit_type || '').toLowerCase(), st = String(e.raw.status || '').toLowerCase();
  if (/resign/.test(t) || st === 'resigned') return { type: 'Resignation', kind: 'Voluntary' };
  if (/retire/.test(t) || st === 'retired') return { type: 'Retirement', kind: 'Retirement' };
  if (/terminat|dismiss|abscond|terminated/.test(t) || ['terminated', 'absconded'].includes(st)) return { type: label(t || st), kind: 'Involuntary' };
  if (/end|contract|death|mutual|layoff/.test(t)) return { type: label(t), kind: 'Other' };
  return { type: 'Not recorded', kind: 'Not recorded' };
};
export function computeAttrition(ctx, model, scope, from, to, today, x, cfg = HR_CFG) {
  const days = Math.max(1, diffDays(from, to) + 1);
  const xBy = {}; for (const r of ctx.exits) if (r.user_id && !['rejected', 'cancelled', 'withdrawn'].includes(r.status)) xBy[r.user_id] = r;
  const emps = scope.scopeEmps;
  const hcOn = (d, f = () => true) => emps.filter(e => model.activeOn(e, d) && f(e)).length;
  const exitsIn = (a, b, f = () => true) => emps.filter(e => e.separated && e.lwd && e.lwd >= a && e.lwd <= b && f(e));
  const joinsIn = (a, b, f = () => true) => emps.filter(e => e.doj && e.doj >= a && e.doj <= b && f(e));
  const rate = (exits, opening, closing, d) => { const avg = (opening + closing) / 2; return { exits, avgHeadcount: r1(avg), rate: avg > 0 ? r1((exits / avg) * 100) : null, annualised: avg > 0 ? r1((exits / avg) * 100 * (365 / d)) : null }; };
  const opening = hcOn(addDays(from, -1)), closing = hcOn(to);
  const exits = exitsIn(from, to);
  const company = { opening, closing, joiners: joinsIn(from, to).length, ...rate(exits.length, opening, closing, days) };
  const prevFrom = addDays(from, -days), prevTo = addDays(from, -1);
  const prevOpen = hcOn(addDays(prevFrom, -1)), prevClose = hcOn(prevTo), prevExits = exitsIn(prevFrom, prevTo).length;
  const previous = { from: prevFrom, to: prevTo, opening: prevOpen, closing: prevClose, joiners: joinsIn(prevFrom, prevTo).length, ...rate(prevExits, prevOpen, prevClose, days) };
  // trailing twelve months (the annual rate)
  const t12From = addDays(to, -364), t12Open = hcOn(addDays(t12From, -1)), t12Exits = exitsIn(t12From, to).length;
  const annual = { from: t12From, to, ...rate(t12Exits, t12Open, closing, 365) };
  // retention: of the people employed on the first day, how many are still here at the end
  const cohort = emps.filter(e => model.activeOn(e, addDays(from, -1)));
  const stayed = cohort.filter(e => !(e.separated && e.lwd && e.lwd <= to)).length;
  const retention = { cohort: cohort.length, stayed, rate: pctOf(stayed, cohort.length) };
  // monthly trend: 12 months to the period end
  const lastM = ym(to), trend = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(lastM, -i), a = `${m}-01`, b = addDays(`${addMonths(m, 1)}-01`, -1);
    const o = hcOn(addDays(a, -1)), c = hcOn(b), ex = exitsIn(a, b).length, jn = joinsIn(a, b).length;
    trend.push({ ym: m, label: monthLabel(m), openingHc: o, closingHc: c, joiners: jn, exits: ex, rate: (o + c) > 0 ? r1((ex / ((o + c) / 2)) * 100) : null });
  }
  const classified = exits.map(e => ({ e, ...classifyExit(e, xBy[e.uid]) }));
  const kindCount = {}, typeCount = {}, reasonCount = {};
  for (const c of classified) { kindCount[c.kind] = (kindCount[c.kind] || 0) + 1; typeCount[c.type] = (typeCount[c.type] || 0) + 1; const rs = xBy[c.e.uid]?.reason_category || c.e.raw.exit_reason || 'Not recorded'; reasonCount[label(rs)] = (reasonCount[label(rs)] || 0) + 1; }
  const group = (keyFn) => { const g = {}; for (const e of emps.filter(e => model.activeOn(e, to) || (e.separated && e.lwd >= from && e.lwd <= to))) { const k = keyFn(e); (g[k] ||= { key: k, exits: 0, open: 0, close: 0, joiners: 0 }); } for (const e of emps) { const k = keyFn(e); const o = g[k]; if (!o) continue; if (model.activeOn(e, addDays(from, -1))) o.open++; if (model.activeOn(e, to)) o.close++; if (e.separated && e.lwd >= from && e.lwd <= to) o.exits++; if (e.doj >= from && e.doj <= to) o.joiners++; } return Object.values(g).map(o => ({ ...o, avg: r1((o.open + o.close) / 2), rate: (o.open + o.close) > 0 ? r1((o.exits / ((o.open + o.close) / 2)) * 100) : null, annualised: (o.open + o.close) > 0 ? r1((o.exits / ((o.open + o.close) / 2)) * 100 * (365 / days)) : null })).sort((a, b) => b.exits - a.exits || (b.rate ?? 0) - (a.rate ?? 0)); };
  const byDept = group(e => e.dept).map(o => ({ dept: o.key, ...o }));
  const byDesignation = group(e => e.designation || 'Not recorded').map(o => ({ designation: o.key, ...o })).slice(0, 25);
  // tenure at exit
  const tenure = cfg.tenureBands.map(([lo, hi, l]) => ({ band: l, exits: exits.filter(e => { const t = e.doj && e.lwd ? diffDays(e.doj, e.lwd) : null; return t != null && t >= lo && t < hi; }).length }));
  const noTenure = exits.filter(e => !(e.doj && e.lwd)).length;
  const tenures = emps.filter(e => model.activeOn(e, today) && e.doj).map(e => diffDays(e.doj, today) / 365.25);
  const exitTenures = exits.filter(e => e.doj && e.lwd).map(e => diffDays(e.doj, e.lwd) / 365.25);
  const stability = byDept.filter(d => d.close > 0).map(d => ({ dept: d.dept, headcount: d.close, avgTenureYears: r1(mean(emps.filter(e => e.dept === d.dept && model.activeOn(e, today) && e.doj).map(e => diffDays(e.doj, today) / 365.25))), exits: d.exits, stabilityPct: d.annualised == null ? null : r1(Math.max(0, 100 - d.annualised)) })).sort((a, b) => (a.stabilityPct ?? 101) - (b.stabilityPct ?? 101));
  const list = classified.map(c => row(c.e, { doj: c.e.doj, lwd: c.e.lwd, tenureDays: c.e.doj && c.e.lwd ? diffDays(c.e.doj, c.e.lwd) : null, kind: c.kind, type: c.type, reason: label(xBy[c.e.uid]?.reason_category || c.e.raw.exit_reason || 'Not recorded'), exitRecord: !!xBy[c.e.uid] }));
  const separatedNoDate = emps.filter(e => e.separated && !e.lwd).length;
  const history = emps.filter(e => e.separated && e.lwd).length;
  const firstExit = emps.filter(e => e.separated && e.lwd).map(e => e.lwd).sort()[0] || null;
  return {
    company, previous, annual, retention, trend, kinds: kindCount, types: typeCount, reasons: reasonCount, byDept, byDesignation, tenure, tenureNotKnown: noTenure, stability,
    historyLimited: !!firstExit && firstExit > addDays(to, -364), avgTenureYears: tenures.length ? r1(mean(tenures)) : null, avgTenureAtExitYears: exitTenures.length ? r1(mean(exitTenures)) : null, exits: cap(list),
    exitRecordsMissing: list.filter(l => !l.exitRecord).length, separatedNoDate, historyExits: history, firstExit,
    method: [
      'Attrition rate = employees who left in the period ÷ average headcount × 100, where average headcount = (headcount on the day before the period + headcount on its last day) ÷ 2.',
      'Annualised rate scales the period rate to 365 days. The annual rate uses the trailing twelve months.',
      'Retention rate = of the people employed on the day before the period began, the share still employed at its end (joiners during the period are not counted).',
      'Voluntary = resignations; Involuntary = terminations / absconding; Retirement is shown separately. A leaver without an exit record is classified from the employee status.',
      'Dates used: actual joining date and last working day recorded on the employee / exit record. Leavers without a last working day cannot be placed in time and are reported as a data gap.',
    ],
  };
}

// ── loans & advances ────────────────────────────────────────────────────────────────────────────────────────────────────
export function computeLoans(ctx, model, scope, from, to, today, x, cfg = HR_CFG) {
  const inScope = (uid) => !!model.byUid[uid] && scope.scopeEmps.includes(model.byUid[uid]);
  const todayM = ym(today);
  const loans = x.loans.filter(l => inScope(l.user_id) && !['rejected', 'cancelled'].includes(String(l.status || '').toLowerCase()));
  const isAdvance = (l) => /advance/i.test(l.loan_type || '');
  const payMonths = x.payMonths;
  const rows = loans.map(l => {
    const e = model.byUid[l.user_id], amount = num(l.loan_amount), monthly = num(l.monthly_deduction);
    const start = dayOf(l.start_date), startM = start ? ym(start) : null;
    const paid = (x.loanPaid[l.user_id] || []).filter(p => !startM || p.ym >= startM);
    const repaid = r2(paid.reduce((s, p) => s + p.amount, 0));
    const hasPayslipData = payMonths.some(m => !startM || m >= startM);
    const stored = l.outstanding_amount != null ? num(l.outstanding_amount) : null;
    const status = String(l.status || '').toLowerCase();
    const active = ['active', 'approved'].includes(status);
    const closed = ['closed', 'completed', 'repaid', 'paid'].includes(status) || (hasPayslipData && repaid >= amount && amount > 0);
    // months due so far (instalments scheduled from the start month up to the last month a payslip exists, or this month)
    const lastM = payMonths.length ? payMonths[payMonths.length - 1] : todayM;
    const monthsDue = startM && monthly > 0 ? Math.max(0, (Number(lastM.slice(0, 4)) * 12 + Number(lastM.slice(5)) - (Number(startM.slice(0, 4)) * 12 + Number(startM.slice(5)))) + 1) : null;
    const scheduled = monthsDue != null ? Math.min(amount, monthsDue * monthly) : null;
    const behind = hasPayslipData && scheduled != null && active ? r2(scheduled - repaid) : null;
    const overdue = behind != null && monthly > 0 && behind > monthly * cfg.loanBehindInstalments;
    const outstanding = hasPayslipData ? r2(Math.max(0, amount - repaid)) : stored;
    return {
      code: e.code, name: e.name, dept: e.dept, kind: isAdvance(l) ? 'Salary advance' : 'Loan', type: label(l.loan_type), status: label(status), amount, monthly, start, end: dayOf(l.end_date), interest: num(l.interest_rate),
      repaid, repaidPct: amount ? r1((repaid / amount) * 100) : null, outstanding, storedOutstanding: stored, scheduledToDate: scheduled, behind, overdue, closed, active, basis: hasPayslipData ? 'Payslip loan deductions' : 'Stored balance (no payslips since the loan began)', approved: dayOf(l.approved_date), requested: dayOf(l._createdAt),
    };
  }).sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0));
  const live = rows.filter(r => r.active && !r.closed);
  const sum = (a, f) => r2(a.reduce((s, r) => s + (f(r) || 0), 0));
  const byDept = {};
  for (const r of live) { const d = (byDept[r.dept] ||= { dept: r.dept, loans: 0, outstanding: 0, monthly: 0, overdue: 0 }); d.loans++; d.outstanding = r2(d.outstanding + (r.outstanding || 0)); d.monthly = r2(d.monthly + r.monthly); if (r.overdue) d.overdue++; }
  const sanctionedIn = rows.filter(r => r.approved >= from && r.approved <= to);
  const newIn = rows.filter(r => r.requested >= from && r.requested <= to);
  const pending = x.loans.filter(l => inScope(l.user_id) && String(l.status || '').toLowerCase() === 'pending');
  const offCycle = x.bonuses.filter(b => inScope(b.user_id));
  const offBy = {}; for (const b of offCycle) { const k = `${label(b.bonus_type || b.payment_type || 'payment')}|${label(b.status || 'pending')}`; const o = (offBy[k] ||= { type: label(b.bonus_type || b.payment_type || 'payment'), status: label(b.status || 'pending'), count: 0, amount: 0 }); o.count++; o.amount = r2(o.amount + num(b.amount)); }
  // payslip loan deductions per month (the repayments actually collected)
  const monthly = {}; for (const [uid, list] of Object.entries(x.loanPaid)) if (inScope(uid)) for (const p of list) monthly[p.ym] = r2((monthly[p.ym] || 0) + p.amount);
  const deductions = Object.entries(monthly).sort().map(([m, amount]) => ({ ym: m, label: monthLabel(m), amount }));
  return {
    counts: { total: rows.length, active: live.length, fullyRepaid: rows.filter(r => r.closed).length, pendingApproval: pending.length, sanctionedInPeriod: sanctionedIn.length, requestedInPeriod: newIn.length, overdue: live.filter(r => r.overdue).length, advances: rows.filter(r => r.kind === 'Salary advance').length, activeAdvances: live.filter(r => r.kind === 'Salary advance').length },
    amounts: { disbursed: sum(rows.filter(r => r.active || r.closed), r => r.amount), outstanding: sum(live, r => r.outstanding), outstandingLoans: sum(live.filter(r => r.kind === 'Loan'), r => r.outstanding), outstandingAdvances: sum(live.filter(r => r.kind === 'Salary advance'), r => r.outstanding), monthlyDeduction: sum(live, r => r.monthly), sanctionedInPeriod: sum(sanctionedIn, r => r.amount), behind: sum(live.filter(r => r.overdue), r => r.behind), offCyclePending: sum(offCycle.filter(b => ['pending', 'approved'].includes(String(b.status || '').toLowerCase())), b => num(b.amount)) },
    byDept: Object.values(byDept).sort((a, b) => b.outstanding - a.outstanding), deductions, offCycle: Object.values(offBy), statement: cap(rows, 500), overdue: cap(live.filter(r => r.overdue)),
    note: x.payMonths.length ? `Repayments are the loan deductions printed on the uploaded payslips (${x.payMonths.length} month(s) uploaded: ${x.payMonths.map(monthLabel).join(', ')}). Where no payslip exists since a loan began, the stored balance is shown instead.` : 'No payslips are uploaded yet, so repayments cannot be confirmed; balances are as stored on each loan.',
  };
}

// ── lifecycle & HR operations ───────────────────────────────────────────────────────────────────────────────────────────
export function computeLifecycle(ctx, model, scope, from, to, today, x, cfg = HR_CFG) {
  const inScope = (uid) => !uid || (!!model.byUid[uid] && scope.scopeEmps.includes(model.byUid[uid]));
  const emps = scope.scopeEmps;
  const stages = {}; for (const e of emps.filter(e => !e.separated)) { const s = e.raw.onboarding_stage || (e.raw.onboarding_submitted === false ? 'not submitted' : 'completed'); stages[label(s)] = (stages[label(s)] || 0) + 1; }
  const onboardingPending = emps.filter(e => !e.separated && ['invited', 'in_progress', 'submitted', 'pending_approval', 'pending'].includes(String(e.raw.onboarding_stage || '').toLowerCase())).map(e => row(e, { stage: label(e.raw.onboarding_stage), doj: e.doj, invited: dayOf(e.raw.onboarding_invited_at) }));
  const invites = {}; for (const i of x.invites) invites[label(i.status)] = (invites[label(i.status)] || 0) + 1;
  const tickets = x.tickets.filter(t => inScope(t.user_id));
  const tStat = {}; for (const t of tickets) tStat[label(t.status || 'open')] = (tStat[label(t.status || 'open')] || 0) + 1;
  const raisedIn = tickets.filter(t => dayOf(t.created_date || t._createdAt) >= from && dayOf(t.created_date || t._createdAt) <= to).length;
  const resolved = tickets.filter(t => /resolved|closed/i.test(t.status || ''));
  const resDays = resolved.filter(t => t.resolved_date && (t.created_date || t._createdAt)).map(t => diffDays(dayOf(t.created_date || t._createdAt), dayOf(t.resolved_date)));
  const openTickets = tickets.filter(t => !/resolved|closed/i.test(t.status || '')).map(t => ({ subject: t.subject || '', category: label(t.category), priority: label(t.priority), status: label(t.status || 'open'), ageDays: diffDays(dayOf(t.created_date || t._createdAt) || today, today), who: model.byUid[t.user_id]?.name || '' })).sort((a, b) => b.ageDays - a.ageDays);
  // exits & account deactivation
  const xBy = {}; for (const r of ctx.exits) if (r.user_id) xBy[r.user_id] = r;
  const exitStatus = {}; for (const r of ctx.exits.filter(r => inScope(r.user_id))) exitStatus[label(r.status)] = (exitStatus[label(r.status)] || 0) + 1;
  const leavers = emps.filter(e => e.separated).map(e => { const r = xBy[e.uid]; return row(e, { lwd: e.lwd, exitRecord: !!r, exitStatus: r ? label(r.status) : 'No exit record', accessDeactivated: r ? r.access_deactivated === true : null, clearance: r?.clearance_checklist ? `${(Array.isArray(r.clearance_checklist) ? r.clearance_checklist : Object.values(r.clearance_checklist)).filter(c => c?.cleared || c?.status === 'cleared' || c === true).length} cleared` : '—' }); });
  const pendingDeactivation = leavers.filter(l => l.accessDeactivated !== true);
  const perf = x.perf.filter(p => inScope(p.user_id)), pStat = {}; for (const p of perf) pStat[label(p.status || 'draft')] = (pStat[label(p.status || 'draft')] || 0) + 1;
  const pips = x.pips.filter(p => inScope(p.user_id)), pipStat = {}; for (const p of pips) pipStat[label(p.status || 'active')] = (pipStat[label(p.status || 'active')] || 0) + 1;
  const enr = x.enroll.filter(t => inScope(t.user_id)), enrStat = {}; for (const t of enr) enrStat[label(t.status || 'enrolled')] = (enrStat[label(t.status || 'enrolled')] || 0) + 1;
  const transfers = (ctx.transfers || []).filter(t => inScope(t.user_id) && dayOf(t.effective_date) >= from && dayOf(t.effective_date) <= to).length;
  return {
    onboarding: { stages, invites, pending: cap(onboardingPending), pendingCount: onboardingPending.length },
    tickets: { total: tickets.length, byStatus: tStat, raisedInPeriod: raisedIn, resolved: resolved.length, open: openTickets.length, openOverdue: openTickets.filter(t => t.ageDays > cfg.ticketPendingDays).length, avgResolutionDays: resDays.length ? r1(mean(resDays)) : null, resolutionN: resDays.length, openList: cap(openTickets, 50) },
    exits: { byStatus: exitStatus, leavers: cap(leavers, 200), noExitRecord: leavers.filter(l => !l.exitRecord).length, pendingDeactivation: cap(pendingDeactivation, 100), pendingDeactivationCount: pendingDeactivation.length },
    performance: { reviews: perf.length, byStatus: pStat, pips: pips.length, pipStatus: pipStat },
    training: { enrolments: enr.length, byStatus: enrStat, ldAssignments: ctx.ld?.assignments ?? null },
    transfersInPeriod: transfers,
  };
}

// ── recruitment extras: sources, interview results, offer conversion, vacancy status ─────────────────────────────────
export function computeRecruitmentPlus(ctx, model, scope, from, to, today) {
  const f = scope.filters || {};
  const reqs = ctx.reqs.filter(r => !f.department || f.department === 'all' || (r.department || 'Unassigned') === f.department);
  const reqIds = new Set(reqs.map(r => r.id));
  const cands = ctx.cands.filter(c => !c.job_id || reqIds.has(c.job_id));
  const src = {}; for (const c of cands) { const k = label(c.source || 'Not recorded'); const o = (src[k] ||= { source: k, candidates: 0, interviewed: 0, offered: 0, joined: 0 }); o.candidates++; if (['interview_scheduled', 'interviewed', 'selected', 'offered', 'offer_released', 'offer_sent', 'offer_accepted', 'joined', 'hired'].includes(c.status)) o.interviewed++; if (['offered', 'offer_released', 'offer_sent', 'offer_accepted', 'joined', 'hired'].includes(c.status) || c.offer_status) o.offered++; if (['joined', 'hired', 'onboarded'].includes(c.status)) o.joined++; }
  const reqStatus = {}; for (const r of reqs) reqStatus[label(r.status)] = (reqStatus[label(r.status)] || 0) + 1;
  const ints = ctx.interviews.filter(i => cands.some(c => c.id === i.candidate_id));
  const intStat = {}; for (const i of ints) { const k = label(i.result || i.recommendation || i.status || 'scheduled'); intStat[k] = (intStat[k] || 0) + 1; }
  const intIn = ints.filter(i => dayOf(i.scheduled_date) >= from && dayOf(i.scheduled_date) <= to);
  const released = cands.filter(c => c.offer_letter_date || c.offer_status || ['offered', 'offer_released', 'offer_sent', 'offer_accepted', 'joined', 'hired'].includes(c.status));
  const accepted = cands.filter(c => c.offer_accepted_at || ['offer_accepted', 'joined', 'hired'].includes(c.status));
  const joined = cands.filter(c => ['joined', 'hired', 'onboarded'].includes(c.status));
  const rec = cands.filter(c => c.recruiter_id || c.assigned_to || c.owner_id);
  const byPos = {}; for (const r of reqs.filter(r => ['published', 'open'].includes(r.status))) { const mine = cands.filter(c => c.job_id === r.id); byPos[r.id] = { position: r.position_title || '', dept: r.department || 'Unassigned', positions: num(r.number_of_positions) || 1, candidates: mine.length, interviewing: mine.filter(c => ['interview_scheduled', 'interviewed'].includes(c.status)).length, offers: mine.filter(c => ['offered', 'offer_released', 'offer_sent', 'offer_accepted'].includes(c.status)).length, joined: mine.filter(c => ['joined', 'hired', 'onboarded'].includes(c.status)).length }; }
  return {
    requisitionStatus: reqStatus, sources: Object.values(src).sort((a, b) => b.candidates - a.candidates), interviews: { total: ints.length, inPeriod: intIn.length, byResult: intStat },
    offers: { released: released.length, accepted: accepted.length, joined: joined.length, acceptanceRate: pctOf(accepted.length, released.length), offerToJoin: pctOf(joined.length, released.length) },
    positions: Object.values(byPos).sort((a, b) => b.candidates - a.candidates), recruiterWise: rec.length ? null : { unavailable: true, reason: 'Candidate records do not store which recruiter owns them, so recruiter-wise performance cannot be calculated.' },
    onHoldKnown: Object.keys(reqStatus).some(k => /hold/i.test(k)),
  };
}

// ── findings: observation → analysis → supporting data → recommendation → priority ──────────────────────────────────────
// Every finding is raised by a rule over the figures above; nothing is inferred beyond them.
export function hrInsights({ cfg, hr, wf, rc, today, period }) {
  const out = [];
  const add = (o) => out.push({ status: 'New', detected: today, owner: 'HR', ...o, key: `${o.rule}|${o.subject || ''}|${period.from}` });
  const P = hr.probation, L = hr.letters, A = hr.attrition, N = hr.loans, C = hr.lifecycle;
  const names = (list, n = 6) => list.slice(0, n).map(r => `${r.name} (${r.code || r.dept})`).join('; ') + (list.length > n ? ` and ${list.length - n} more` : '');
  if (P.counts.overdue) add({ rule: 'probation_overdue', title: `${P.counts.overdue} employee(s) are past their probation end date and not confirmed`, category: 'Probation', severity: P.counts.overdue > 10 ? 'High' : 'Medium', dept: [...new Set(P.overdue.map(r => r.dept))].slice(0, 4).join(', '), current: P.counts.overdue, comparison: null, abs: null, pct: null, evidence: names(P.overdue) + `. Longest overdue: ${P.overdue.reduce((m, r) => Math.max(m, r.overdueBy), 0)} day(s).`, why: 'An employee whose probation has ended but who has not been confirmed (or extended) is in an undefined employment position — benefits, notice period and increments depend on the decision.', action: 'Start or complete the probation review for each; record the decision (confirm / extend / terminate) and issue the letter.', owner: 'HR / Reporting managers', drill: 'probation' });
  if (P.counts.endingSoon) add({ rule: 'probation_soon', title: `${P.counts.endingSoon} probation(s) end within ${HR_CFG.probationSoonDays} days`, category: 'Probation', severity: 'Medium', dept: [...new Set(P.endingSoon.map(r => r.dept))].slice(0, 4).join(', '), current: P.counts.endingSoon, comparison: null, abs: null, pct: null, evidence: P.endingSoon.slice(0, 6).map(r => `${r.name}: ${fmtD(r.end)} (${r.daysLeft}d, ${r.reviewStatus})`).join('; '), why: 'Reviews take time; probations that reach their end date without a decision become overdue.', action: 'Ask managers to submit probation reviews now so decisions are ready before the end date.', owner: 'Reporting managers / HR', drill: 'probation' });
  if (L.counts.pendingAppointment) add({ rule: 'appointment_pending', title: `${L.counts.pendingAppointment} recent joiner(s) have no appointment letter on record`, category: 'Documentation', severity: L.counts.pendingAppointment > 5 ? 'High' : 'Medium', dept: [...new Set(L.pendingAppointment.map(r => r.dept))].slice(0, 4).join(', '), current: L.counts.pendingAppointment, comparison: null, abs: null, pct: null, evidence: L.pendingAppointment.slice(0, 6).map(r => `${r.name}: joined ${fmtD(r.doj)} (${r.daysSinceJoining}d)`).join('; '), why: 'An appointment letter is the employee\'s written terms of employment and a statutory/compliance expectation.', action: 'Generate and issue the appointment letters from Letter Generator.', owner: 'HR', drill: 'letters' });
  if (L.counts.pendingConfirmation) add({ rule: 'confirm_letter_pending', title: `${L.counts.pendingConfirmation} confirmed employee(s) have not received a confirmation letter`, category: 'Documentation', severity: 'Medium', dept: [...new Set(L.pendingConfirmation.map(r => r.dept))].slice(0, 4).join(', '), current: L.counts.pendingConfirmation, comparison: null, abs: null, pct: null, evidence: names(L.pendingConfirmation), why: 'Confirmation has been decided but is not documented for the employee.', action: 'Issue the confirmation letters.', owner: 'HR', drill: 'letters' });
  if (L.counts.pendingIssue) add({ rule: 'letters_unsent', title: `${L.counts.pendingIssue} generated letter(s) were never sent to the employee`, category: 'Documentation', severity: 'Low', dept: 'All', current: L.counts.pendingIssue, comparison: null, abs: null, pct: null, evidence: L.pendingIssue.slice(0, 6).map(r => `${r.type} – ${r.name}`).join('; '), why: 'A letter that exists only as a draft has no effect for the employee.', action: 'Review and send, or delete drafts that are no longer needed.', owner: 'HR', drill: 'letters' });
  if (L.counts.multiWarning) add({ rule: 'multi_warning', title: `${L.counts.multiWarning} employee(s) have ${HR_CFG.multiWarning}+ warning letters`, category: 'Documentation', severity: 'High', dept: [...new Set(L.multiWarning.map(r => r.dept))].join(', '), current: L.counts.multiWarning, comparison: null, abs: null, pct: null, evidence: L.multiWarning.map(r => `${r.name}: ${r.warnings}`).join('; '), why: 'Repeated warnings usually mean the underlying issue is unresolved and the next step (PIP / disciplinary process) should be decided.', action: 'Review each case with the reporting manager and decide the next formal step.', owner: 'HR', drill: 'letters' });
  if (L.counts.docIncomplete) add({ rule: 'docs_incomplete', title: `${L.counts.docIncomplete} of ${L.counts.activeEmployees} active employees have incomplete documents`, category: 'Documentation', severity: L.counts.docIncomplete / Math.max(1, L.counts.activeEmployees) > 0.3 ? 'Medium' : 'Low', dept: L.pendingByDept.filter(d => d.documents).slice(0, 3).map(d => d.dept).join(', '), current: L.counts.docIncomplete, comparison: null, abs: null, pct: null, evidence: `Required: ${HR_CFG.documentRequired.map(label).join(', ')} and bank details. Most incomplete: ${L.incompleteDocs.slice(0, 5).map(r => `${r.name} (missing ${r.missing})`).join('; ')}.`, why: 'Missing identity, education or bank records block statutory filings, payroll payment and background verification.', action: 'Send the department-wise list to employees and managers; follow up until complete.', owner: 'HR', drill: 'letters' });
  // attrition
  // a department needs a real base before a rate means anything: at least 2 exits and an average of 5+ people
  const high = A.byDept.filter(d => d.annualised != null && d.annualised >= HR_CFG.attritionHighPct && d.exits >= 2 && d.avg >= 5);
  for (const d of high.slice(0, 5)) add({ rule: 'attrition_high', subject: d.dept, title: `${d.dept}: attrition is ${d.annualised}% annualised (${d.exits} exit(s))`, category: 'Attrition', severity: d.annualised >= 30 ? 'High' : 'Medium', dept: d.dept, current: d.annualised, comparison: A.company.annualised, abs: null, pct: null, evidence: `${d.exits} leaver(s) against an average of ${d.avg} employees; company annualised rate ${A.company.annualised ?? 'n/a'}%.`, why: 'A department losing people faster than the company average carries hiring cost, knowledge loss and delivery risk.', action: 'Hold stay/exit interviews for the department, review manager, workload and pay, and plan replacement hiring.', owner: 'HR / Department head', drill: 'attrition' });
  if (A.company.exits >= 3 && A.previous.exits >= 0 && A.company.exits > A.previous.exits * 1.5) add({ rule: 'attrition_up', title: `Exits rose to ${A.company.exits} from ${A.previous.exits} in the previous period`, category: 'Attrition', severity: 'Medium', dept: 'All', current: A.company.exits, comparison: A.previous.exits, abs: A.company.exits - A.previous.exits, pct: A.previous.exits ? r1(((A.company.exits - A.previous.exits) / A.previous.exits) * 100) : null, evidence: `Annualised attrition ${A.company.annualised ?? 'n/a'}% (previous ${A.previous.annualised ?? 'n/a'}%).`, why: 'A sharp rise in exits is an early warning that something changed.', action: 'Review the reasons recorded for the leavers and talk to the affected managers.', owner: 'HR', drill: 'attrition' });
  if (A.exitRecordsMissing) add({ rule: 'exit_no_record', title: `${A.exitRecordsMissing} leaver(s) in this period have no exit record`, category: 'Attrition', severity: 'Low', dept: 'All', current: A.exitRecordsMissing, comparison: null, abs: null, pct: null, evidence: A.exits.filter(e => !e.exitRecord).slice(0, 6).map(e => `${e.name} (${e.type})`).join('; '), why: 'Without an exit record the reason, notice and clearance are not captured, so attrition analysis is incomplete.', action: 'Complete exit records (reason, interview, clearance) for these employees.', owner: 'HR', drill: 'attrition' });
  if (C.exits.pendingDeactivationCount) add({ rule: 'deactivation_pending', title: `${C.exits.pendingDeactivationCount} leaver(s) have no confirmed access deactivation`, category: 'Lifecycle', severity: C.exits.pendingDeactivation.some(r => r.accessDeactivated === false) ? 'High' : 'Medium', dept: 'All', current: C.exits.pendingDeactivationCount, comparison: null, abs: null, pct: null, evidence: C.exits.pendingDeactivation.slice(0, 6).map(r => `${r.name} (left ${fmtD(r.lwd)}, ${r.exitStatus})`).join('; '), why: 'Accounts that stay active after separation are a security and data-protection risk.', action: 'Confirm the access removal and mark it on the exit record.', owner: 'HR / IT', drill: 'lifecycle' });
  // loans
  if (N.counts.overdue) add({ rule: 'loan_overdue', title: `${N.counts.overdue} loan(s) are behind on repayment (₹${Math.round(N.amounts.behind).toLocaleString('en-IN')} behind schedule)`, category: 'Loans', severity: 'High', dept: [...new Set(N.overdue.map(r => r.dept))].join(', '), current: N.counts.overdue, comparison: null, abs: null, pct: null, evidence: N.overdue.slice(0, 6).map(r => `${r.name}: repaid ₹${Math.round(r.repaid).toLocaleString('en-IN')} of ₹${Math.round(r.scheduledToDate).toLocaleString('en-IN')} due`).join('; '), why: 'The loan deduction printed on the payslips is lower than the instalments due.', action: 'Check the deduction set-up for these employees with the payroll service.', owner: 'HR / Finance', drill: 'loans' });
  if (N.counts.pendingApproval) add({ rule: 'loan_pending', title: `${N.counts.pendingApproval} loan/advance request(s) await approval`, category: 'Loans', severity: 'Low', dept: 'All', current: N.counts.pendingApproval, comparison: null, abs: null, pct: null, evidence: '', why: 'Requests waiting too long frustrate employees.', action: 'Approve or reject the pending requests.', owner: 'HR', drill: 'loans' });
  // recruitment bottlenecks from exits + vacancies
  if (rc) {
    const needed = A.byDept.filter(d => d.exits > 0).map(d => { const open = rc.byDept.find(x => x.dept === d.dept)?.open || 0; return { dept: d.dept, exits: d.exits, open }; }).filter(d => d.open < d.exits);
    if (needed.length) add({ rule: 'replacement_gap', title: `${needed.length} department(s) have lost more people than they have open vacancies`, category: 'Recruitment', severity: 'Medium', dept: needed.slice(0, 4).map(d => d.dept).join(', '), current: needed.reduce((s, d) => s + (d.exits - d.open), 0), comparison: null, abs: null, pct: null, evidence: needed.slice(0, 6).map(d => `${d.dept}: ${d.exits} left, ${d.open} open`).join('; '), why: 'Positions vacated by leavers that are not on an open requisition will stay unfilled.', action: 'Raise requisitions for the vacated positions that need replacing.', owner: 'HR / Department heads', drill: 'recruitment' });
  }
  if (C.tickets.openOverdue) add({ rule: 'tickets_overdue', title: `${C.tickets.openOverdue} helpdesk ticket(s) open longer than ${HR_CFG.ticketPendingDays} days`, category: 'HR operations', severity: 'Medium', dept: 'All', current: C.tickets.openOverdue, comparison: null, abs: null, pct: null, evidence: C.tickets.openList.slice(0, 5).map(t => `${t.subject} (${t.ageDays}d)`).join('; '), why: 'Slow resolution of employee queries is a recurring HR operations bottleneck.', action: 'Assign owners and close out the oldest tickets.', owner: 'HR', drill: 'lifecycle' });
  if (C.onboarding.pendingCount) add({ rule: 'onboarding_pending', title: `${C.onboarding.pendingCount} onboarding(s) are not complete`, category: 'Lifecycle', severity: 'Medium', dept: 'All', current: C.onboarding.pendingCount, comparison: null, abs: null, pct: null, evidence: C.onboarding.pending.slice(0, 6).map(r => `${r.name}: ${r.stage}`).join('; '), why: 'Incomplete onboarding delays documents, payroll set-up and access.', action: 'Chase the employees (or approve submitted forms) to finish onboarding.', owner: 'HR', drill: 'lifecycle' });
  return out;
}

// ── payroll findings (from the payslip analytics: utils/payrollAnalytics.js) ───────────────────────────────────────────
const money = (v) => `₹${Math.round(Math.abs(v)).toLocaleString('en-IN')}`;
export function payrollInsights(pa, today, period) {
  const out = [];
  if (!pa || !pa.available_months?.length) return out;
  const add = (o) => out.push({ status: 'New', detected: today, owner: 'HR / Finance', category: 'Payroll', drill: 'payroll', ...o, key: `${o.rule}|${o.subject || ''}|${pa.summary.last_month.ym}` });
  const s = pa.summary, lm = s.last_month, mv = pa.movements;
  if (lm.prev_cost && s.mom_growth_pct != null && Math.abs(s.mom_growth_pct) >= 8) {
    const d = mv.drivers;
    add({ rule: 'payroll_change', title: `Payroll cost for ${lm.label} ${s.mom_growth_pct > 0 ? 'rose' : 'fell'} ${Math.abs(s.mom_growth_pct)}% (${money(s.mom_growth_abs)}) from ${lm.prev_label}`, severity: Math.abs(s.mom_growth_pct) >= 15 ? 'High' : 'Medium', dept: 'All', current: lm.cost, comparison: lm.prev_cost, abs: s.mom_growth_abs, pct: s.mom_growth_pct,
      evidence: `${mv.counts.joiners} joiner(s) ${money(d.joiners_cost)}, ${mv.counts.exits} exit(s) ${money(d.exits_cost)}, employees who stayed ${d.existing_change >= 0 ? '+' : '−'}${money(d.existing_change)}; ${mv.counts.significant} individual change(s) of 10%+.`,
      why: 'A swing of this size is either a real change (hiring, increments, bonuses, LOP) or a payslip that was misread — it should be explained before it is reported.', action: 'Open Payroll & compensation → Employee cost movements, confirm the largest movements and correct any misread payslips.' });
  }
  const dept = pa.departments.filter(d => d.prev_cost > 0 && d.variance_pct != null && Math.abs(d.variance_pct) >= 15 && Math.abs(d.variance) >= 50000)[0];
  if (dept) add({ rule: 'payroll_dept', subject: dept.department, title: `${dept.department}: payroll cost ${dept.variance > 0 ? 'up' : 'down'} ${Math.abs(dept.variance_pct)}% (${money(dept.variance)}) against ${pa.period.prev_label}`, severity: 'Medium', dept: dept.department, current: dept.cost, comparison: dept.prev_cost, abs: dept.variance, pct: dept.variance_pct, evidence: `${dept.headcount} employee(s), ${dept.share_pct}% of total payroll cost.`, why: 'A single department driving a large part of the payroll movement deserves a look at headcount and salary changes there.', action: 'Review the joiners, exits and increments in that department.' });
  if (pa.data_quality.flagged_count) add({ rule: 'payroll_quality', title: `${pa.data_quality.flagged_count} payslip record(s) have missing or inconsistent figures`, severity: pa.data_quality.flagged_count > 20 ? 'Medium' : 'Low', dept: 'All', current: pa.data_quality.flagged_count, comparison: null, abs: null, pct: null, evidence: pa.data_quality.flagged.slice(0, 5).map(f => `${f.name} (${f.label}): ${f.issues[0] || f.warnings[0]}`).join('; '), why: 'Payroll analytics read these records as extracted, so totals can be slightly off until they are corrected.', action: 'Correct them under Payroll & compensation → Payslip data review.' });
  if (pa.data_quality.missing_payslips.count) add({ rule: 'payroll_missing', title: `${pa.data_quality.missing_payslips.count} active employee(s) have no payslip for ${pa.data_quality.missing_payslips.month}`, severity: 'Medium', dept: 'All', current: pa.data_quality.missing_payslips.count, comparison: null, abs: null, pct: null, evidence: pa.data_quality.missing_payslips.list.slice(0, 6).map(x => `${x.name} (${x.code})`).join('; '), why: 'Either the payslip was not uploaded or the employee was not paid — payroll cost may be understated.', action: 'Confirm with the payroll service whether these employees were paid and upload their payslips.' });
  const f = pa.forecast;
  if (f?.available && lm.cost && f.points[0] && (f.points[0].cost - lm.cost) / lm.cost >= 0.05) add({ rule: 'payroll_forecast', title: `Payroll cost is trending to ${money(f.points[0].cost)} next month (${Math.round(((f.points[0].cost - lm.cost) / lm.cost) * 1000) / 10}% above ${lm.label})`, severity: 'Low', dept: 'All', current: f.points[0].cost, comparison: lm.cost, abs: f.points[0].cost - lm.cost, pct: null, evidence: `Straight-line trend over ${f.basis}; range ${money(f.points[0].low)} – ${money(f.points[0].high)}.`, why: 'If the recent trend continues, payroll cost will exceed the latest month — a projection of past payslips only, not a budget.', action: 'Check planned hires and increments against this trend when budgeting.' });
  return out;
}

// plain-language mapping of the five fields management asked for, applied to every insight (old and new)
export const PRIORITY = { Critical: 'High', High: 'High', Medium: 'Medium', Low: 'Low', Informational: 'Low' };
export function withFiveFields(i) {
  return { ...i, observation: i.title, analysis: i.why, supporting: i.evidence, recommendation: i.action, priority: PRIORITY[i.severity] || 'Low' };
}
