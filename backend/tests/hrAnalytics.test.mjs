// HR lifecycle analytics (probation, letters, attrition, loans, lifecycle, recruitment extras, findings) — pure tests with
// hand-built records, no database. Run: node backend/tests/hrAnalytics.test.mjs
import assert from 'node:assert/strict';
import { computeProbation, computeLetters, computeAttrition, computeLoans, computeLifecycle, computeRecruitmentPlus, hrInsights, withFiveFields } from '../utils/mis/hr.js';
import { forecastCost } from '../utils/payrollAnalytics.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const TODAY = '2026-10-30';
const E = (uid, name, dept, doj, o = {}) => ({ uid, code: uid.toUpperCase(), name, dept, designation: o.designation || 'Executive', empStatus: o.empStatus || 'confirmation', doj, lwd: o.lwd || '', separated: !!o.separated, raw: { status: o.separated ? (o.status || 'resigned') : 'active', employee_status: o.empStatus || 'confirmation', ...o.raw } });
const emps = [
  E('a', 'Asha', 'Sales', '2025-01-10'), E('b', 'Bala', 'Sales', '2026-08-01', { empStatus: 'probation', raw: { probation_end_date: '2026-10-20' } }),   // probation overdue by 10 days
  E('c', 'Chitra', 'Purchase', '2026-07-15', { empStatus: 'probation', raw: { probation_end_date: '2026-11-10' } }),                              // ends in 11 days
  E('d', 'Dev', 'Purchase', '2026-05-01', { empStatus: 'probation', raw: { probation_end_date: '2026-12-31' } }),
  E('e', 'Esha', 'HR', '2024-03-01', { raw: { employee_confirmation_date: '2024-09-01' } }), E('f', 'Farid', 'Sales', '2026-09-20', { raw: { employee_confirmation_date: '2026-10-15' } }),
  E('g', 'Gita', 'Sales', '2023-01-01', { separated: true, lwd: '2026-10-10', status: 'resigned' }), E('h', 'Hari', 'Sales', '2026-02-01', { separated: true, lwd: '2026-10-20', status: 'terminated' }),
  E('i', 'Indu', 'Purchase', '2025-06-01', { separated: true, lwd: '2026-09-05', status: 'resigned' }),
];
const byUid = Object.fromEntries(emps.map(e => [e.uid, e]));
const model = { byUid, activeOn: (e, d) => !!e.doj && e.doj <= d && (!e.lwd || e.lwd >= d) };
const scope = { scopeEmps: emps, filters: {} };
const FROM = '2026-10-01', TO = '2026-10-30';
const X = (o = {}) => ({ docs: [], probation: [], loans: [], bonuses: [], tickets: [], invites: [], perf: [], pips: [], enroll: [], bank: [], loanPaid: {}, payMonths: [], ...o });
const ctx = { exits: [{ user_id: 'g', exit_type: 'resignation', reason_category: 'better_opportunity', status: 'completed', access_deactivated: true }], transfers: [], reqs: [], cands: [], interviews: [] };

t('probation: overdue, ending soon, no-end-date and confirmed-in-period are told apart; time to confirm uses recorded dates only', () => {
  const p = computeProbation(ctx, model, scope, FROM, TO, TODAY, X());
  assert.equal(p.counts.onProbation, 3); assert.equal(p.counts.overdue, 1); assert.equal(p.overdue[0].name, 'Bala'); assert.equal(p.overdue[0].overdueBy, 10);
  assert.equal(p.counts.endingSoon, 1); assert.equal(p.endingSoon[0].name, 'Chitra'); assert.equal(p.endingSoon[0].daysLeft, 11);
  assert.equal(p.counts.confirmedInPeriod, 1); assert.equal(p.confirmedList[0].name, 'Farid'); assert.equal(p.confirmedList[0].days, 25);
  assert.equal(p.avgDaysToConfirm.n, 2); assert.equal(p.confirmedDateMissing, 1, 'Asha has no recorded confirmation date');
  assert.equal(p.byDept.find(d => d.dept === 'Sales').overdue, 1);
});
t('probation: an extension moves the end date and is counted; a review decides nothing by itself', () => {
  const p = computeProbation(ctx, model, scope, FROM, TO, TODAY, X({ probation: [{ id: 'r1', user_id: 'b', status: 'hr_approved', extended_until: '2026-12-01', final_action: 'extend' }] }));
  assert.equal(p.counts.overdue, 0); assert.equal(p.counts.extended, 1); assert.equal(p.rows.find(r => r.name === 'Bala').end, '2026-12-01');
});

t('letters: counts by type, warnings with reasons, multiple warnings, pending appointment / confirmation / unsent, document completion', () => {
  const D = (user_id, letter_type, created, o = {}) => ({ id: `${user_id}${letter_type}${created}`, document_type: 'hr_letter', user_id, letter_type, created_at: created, ...o });
  const docs = [D('a', 'appointment', '2026-09-01', { sent_at: '2026-09-02' }), D('a', 'warning', '2026-10-05', { reason: 'Repeated late coming', sent_at: 'x' }), D('a', 'warning', '2026-10-12', { reason: 'Unauthorised absence' }),
    { id: 'p1', document_type: 'aadhar', user_id: 'a' }, { id: 'p2', document_type: 'pan', user_id: 'a' }, { id: 'p3', document_type: 'educational', user_id: 'a' }];
  const L = computeLetters(ctx, model, scope, FROM, TO, TODAY, X({ docs, bank: [{ user_id: 'a' }], probation: [{ user_id: 'f', status: 'confirmed', final_action: 'confirm', letter_sent: false }] }));
  assert.equal(L.trackingStart, '2026-09-01'); assert.equal(L.counts.warnings, 2); assert.equal(L.counts.warningsInPeriod, 2); assert.equal(L.warnings[0].reason, 'Unauthorised absence');
  assert.equal(L.counts.multiWarning, 1); assert.equal(L.multiWarning[0].name, 'Asha');
  assert.deepEqual(L.pendingAppointment.map(r => r.name).sort(), ['Farid'], 'joined after tracking began, >7 days ago, no letter; earlier joiners are not judged');
  assert.ok(L.pendingConfirmation.some(r => r.name === 'Farid'), 'confirmed on review, letter not sent');
  assert.equal(L.counts.pendingIssue, 1); assert.equal(L.byType.find(x => x.type === 'warning').total, 2);
  assert.equal(L.incompleteDocs.some(r => r.name === 'Asha'), false, 'Asha has all documents and bank details'); assert.ok(L.counts.docIncomplete >= 5);
  assert.ok(/before that date/.test(L.note));
});
t('letters: with no letter ever generated nothing is called pending', () => {
  const L = computeLetters(ctx, model, scope, FROM, TO, TODAY, X());
  assert.equal(L.counts.pendingAppointment, 0); assert.match(L.note, /No HR letter has been generated/);
});

t('attrition: rate from average headcount, voluntary vs involuntary, retention and monthly trend', () => {
  const A = computeAttrition(ctx, model, scope, FROM, TO, TODAY, X());
  const openN = emps.filter(e => model.activeOn(e, '2026-09-30')).length, closeN = emps.filter(e => model.activeOn(e, TO)).length;
  assert.equal(A.company.exits, 2); assert.equal(A.company.opening, openN); assert.equal(A.company.closing, closeN);
  assert.equal(A.company.rate, Math.round((2 / ((openN + closeN) / 2)) * 1000) / 10);
  assert.equal(A.kinds.Voluntary, 1); assert.equal(A.kinds.Involuntary, 1); assert.equal(A.types.Resignation, 1);
  assert.equal(A.reasons['Better Opportunity'], 1); assert.equal(A.reasons['Not Recorded'], 1);
  assert.equal(A.previous.exits, 1, 'Indu left 5 Sep (previous 30 days)');
  assert.equal(A.trend.length, 12); assert.equal(A.trend.at(-1).exits, 2);
  assert.equal(A.retention.cohort, openN); assert.equal(A.retention.stayed, openN - 2);
  assert.equal(A.byDept.find(d => d.dept === 'Sales').exits, 2); assert.equal(A.exitRecordsMissing, 1);
  assert.equal(A.tenure.reduce((s, x) => s + x.exits, 0), 2); assert.ok(A.method.length >= 4);
});

t('loans: repayment is read from payslip loan deductions; outstanding, progress and behind-schedule follow from it', () => {
  const loans = [{ id: 'l1', user_id: 'a', loan_type: 'personal', loan_amount: 60000, outstanding_amount: 60000, monthly_deduction: 5000, start_date: '2026-07-01', status: 'active', approved_date: '2026-06-28' },
    { id: 'l2', user_id: 'c', loan_type: 'salary_advance', loan_amount: 10000, monthly_deduction: 10000, start_date: '2026-08-01', status: 'active' }, { id: 'l3', user_id: 'e', loan_amount: 5000, monthly_deduction: 1000, status: 'pending' }];
  const x = X({ loans, payMonths: ['2026-08', '2026-09'], loanPaid: { a: [{ ym: '2026-08', amount: 5000 }, { ym: '2026-09', amount: 5000 }], c: [{ ym: '2026-08', amount: 10000 }] } });
  const N = computeLoans(ctx, model, scope, FROM, TO, TODAY, x);
  const a = N.statement.find(r => r.name === 'Asha'), c = N.statement.find(r => r.name === 'Chitra');
  assert.equal(a.repaid, 10000); assert.equal(a.outstanding, 50000); assert.equal(a.repaidPct, 16.7); assert.equal(a.scheduledToDate, 15000); assert.equal(a.behind, 5000);
  assert.equal(a.overdue, false, 'one instalment behind is within the allowance'); assert.equal(c.kind, 'Salary advance'); assert.equal(c.closed, true); assert.equal(c.outstanding, 0);
  assert.equal(N.counts.pendingApproval, 1); assert.equal(N.counts.fullyRepaid, 1); assert.equal(N.amounts.outstanding, 50000); assert.equal(N.amounts.disbursed, 70000);
  assert.deepEqual(N.deductions.map(d => d.amount), [15000, 5000]); assert.equal(N.byDept.find(d => d.dept === 'Sales').outstanding, 50000);
  const two = computeLoans(ctx, model, scope, FROM, TO, TODAY, X({ loans: [loans[0]], payMonths: ['2026-08', '2026-09'], loanPaid: { a: [{ ym: '2026-08', amount: 5000 }] } }));
  assert.equal(two.statement[0].overdue, true, 'repaid 5,000 of 15,000 due = two instalments behind');
});
t('loans: nothing on record gives zeros that are explained, never invented rows', () => {
  const N = computeLoans(ctx, model, scope, FROM, TO, TODAY, X());
  assert.equal(N.counts.total, 0); assert.equal(N.amounts.outstanding, 0); assert.deepEqual(N.statement, []); assert.match(N.note, /No payslips are uploaded/);
});

t('lifecycle: helpdesk ageing, exit clearance and pending access deactivation, onboarding stages', () => {
  const c2 = { ...ctx, exits: [{ user_id: 'g', status: 'completed', access_deactivated: true }, { user_id: 'h', status: 'in_progress', access_deactivated: false }] };
  const tickets = [{ status: 'resolved', created_date: '2026-10-01', resolved_date: '2026-10-04', user_id: 'a' }, { status: 'open', subject: 'Payslip', created_date: '2026-10-10', user_id: 'b' }];
  const lc = computeLifecycle(c2, model, scope, FROM, TO, TODAY, X({ tickets }));
  assert.equal(lc.tickets.resolved, 1); assert.equal(lc.tickets.avgResolutionDays, 3); assert.equal(lc.tickets.open, 1); assert.equal(lc.tickets.openOverdue, 1);
  assert.equal(lc.exits.pendingDeactivationCount, 2, 'Hari (flag false) and Indu (no exit record)'); assert.equal(lc.exits.noExitRecord, 1);
});

t('recruitment extras: sources, offer conversion, no recruiter field → said to be unavailable', () => {
  const c2 = { reqs: [{ id: 'r1', status: 'published', department: 'Sales', position_title: 'Exec', number_of_positions: 2 }, { id: 'r2', status: 'closed', department: 'HR' }],
    cands: [{ id: 'k1', job_id: 'r1', source: 'linkedin', status: 'offered' }, { id: 'k2', job_id: 'r1', source: 'linkedin', status: 'joined', offer_accepted_at: 'x' }, { id: 'k3', job_id: 'r1', source: 'careers_portal', status: 'rejected' }], interviews: [{ candidate_id: 'k1', scheduled_date: '2026-10-05', result: 'selected' }] };
  const R = computeRecruitmentPlus(c2, model, scope, FROM, TO, TODAY);
  assert.equal(R.sources.find(s => s.source === 'Linkedin').candidates, 2); assert.equal(R.offers.released, 2); assert.equal(R.offers.joined, 1); assert.equal(R.offers.offerToJoin, 50);
  assert.equal(R.requisitionStatus.Published, 1); assert.equal(R.recruiterWise.unavailable, true); assert.equal(R.interviews.inPeriod, 1);
});

t('findings carry the five required fields and are raised only from the figures', () => {
  const hr = { probation: computeProbation(ctx, model, scope, FROM, TO, TODAY, X()), letters: computeLetters(ctx, model, scope, FROM, TO, TODAY, X({ docs: [{ id: 'w', document_type: 'hr_letter', user_id: 'a', letter_type: 'appointment', created_at: '2026-09-01' }] })),
    attrition: computeAttrition(ctx, model, scope, FROM, TO, TODAY, X()), loans: computeLoans(ctx, model, scope, FROM, TO, TODAY, X()), lifecycle: computeLifecycle(ctx, model, scope, FROM, TO, TODAY, X()) };
  const ins = hrInsights({ cfg: {}, hr, wf: null, rc: { byDept: [] }, today: TODAY, period: { from: FROM } }).map(withFiveFields);
  const by = Object.fromEntries(ins.map(i => [i.rule, i]));
  assert.ok(by.probation_overdue && by.probation_soon && by.appointment_pending && by.deactivation_pending && by.replacement_gap);
  assert.equal(by.loan_overdue, undefined, 'no loans, no loan finding'); assert.equal(by.multi_warning, undefined);
  for (const i of ins) { for (const k of ['observation', 'analysis', 'supporting', 'recommendation', 'priority']) assert.ok(i[k] !== undefined, `${i.rule}.${k}`); assert.ok(['High', 'Medium', 'Low'].includes(i.priority), i.rule); }
  assert.match(by.probation_overdue.supporting, /Bala/); assert.equal(by.probation_overdue.priority, 'Medium');
});

t('payroll forecast: needs 3 months, projects a straight line with a range, and states what it cannot know', () => {
  const tr = (costs) => costs.map((c, i) => ({ ym: `2026-0${i + 1}`, label: `M${i + 1}`, has_data: true, cost: c }));
  assert.equal(forecastCost(tr([100, 110])).available, false);
  const f = forecastCost(tr([100, 110, 120, 130]));
  assert.deepEqual(f.points.map(p => p.cost), [140, 150, 160]); assert.equal(f.points[0].ym, '2026-05'); assert.match(f.caveat, /does not know about planned hires/);
  const noisy = forecastCost(tr([100, 130, 105, 140, 110]));
  assert.ok(noisy.points[0].low < noisy.points[0].cost && noisy.points[0].high > noisy.points[0].cost);
});

console.log(`\n${n} HR analytics tests passed`);
