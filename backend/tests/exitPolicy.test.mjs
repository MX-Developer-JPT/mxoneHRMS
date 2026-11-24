import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeDaysFor, evaluateResignation, recoverableShortfall, gratuityYears, draftFnF, segregationProblem, closeBlockers, leftStatusFor, exitPatchProblem, addDaysYmd, mergeCfg, EXIT_DEFAULTS } from '../utils/exitPolicy.js';

test('notice days: contract, grade, type, default', () => {
  assert.equal(noticeDaysFor({ notice_period_days: 60 }).days, 60);
  assert.equal(noticeDaysFor({ employee_grade: 'Senior Manager' }).days, 90);
  assert.equal(noticeDaysFor({ employment_type: 'Intern' }).days, 15);
  assert.equal(noticeDaysFor({}).days, 30);
  assert.equal(noticeDaysFor({}, mergeCfg({ notice_default_days: 45 })).days, 45);
});

test('resignation: standard last day, shortfall, buy-out, bad dates', () => {
  const ok = evaluateResignation({ today: '2026-11-24', proposedLastDay: '2026-12-24', noticeDays: 30 });
  assert.equal(ok.ok, true); assert.equal(ok.standardLwd, '2026-12-24'); assert.equal(ok.shortfallDays, 0);
  const short = evaluateResignation({ today: '2026-11-24', proposedLastDay: '2026-12-04', noticeDays: 30, buyoutRequested: true });
  assert.equal(short.shortfallDays, 20); assert.equal(short.buyoutDays, 20);
  assert.equal(evaluateResignation({ today: '2026-11-24', proposedLastDay: '2026-12-24', noticeDays: 30, buyoutRequested: true }).ok, false, 'buy-out without shortfall');
  assert.equal(evaluateResignation({ today: '2026-11-24', proposedLastDay: '2026-11-01', noticeDays: 30 }).ok, false, 'past date');
  assert.equal(evaluateResignation({ today: '2026-11-24', proposedLastDay: '2027-08-01', noticeDays: 30 }).ok, false, 'too far');
  assert.equal(evaluateResignation({ today: '2026-11-24', proposedLastDay: '', noticeDays: 30 }).ok, false);
});

test('shortfall recovery honours waiver', () => {
  const r = recoverableShortfall({ noticeDays: 30, lwd: '2026-12-04', resignationDate: '2026-11-24', waivedDays: 5 });
  assert.deepEqual([r.shortfall, r.waived, r.recoverable], [20, 5, 15]);
  assert.equal(recoverableShortfall({ noticeDays: 30, lwd: '2027-01-30', resignationDate: '2026-11-24' }).recoverable, 0);
});

test('gratuity years round a part-year over six months up', () => {
  assert.equal(gratuityYears('2020-01-01', '2024-12-31').years, 5);
  assert.equal(gratuityYears('2020-01-01', '2024-03-01').years, 4);
  assert.equal(gratuityYears('2020-01-01', '2024-09-01').years, 5);
});

test('F&F draft: pro-rata days, PF on the 25,000 ceiling, notice, loan, leave, gratuity', () => {
  const d = draftFnF({ lwd: '2026-12-10', doj: '2018-06-01', salary: { basic: 40000, hra: 16000, special: 10000, conveyance: 4000 }, earnedLeaveDays: 10, loanOutstanding: 12000, noticeRecoveryDays: 6, pfCeiling: 25000 });
  assert.equal(d.total_days_in_month, 31); assert.equal(d.paid_days, 10);
  assert.equal(d.deductions.epf, Math.round(25000 * 0.12 * 10 / 31));
  assert.equal(d.deductions.esi, 0);
  assert.equal(d.deductions.advance, 12000);
  assert.equal(d.deductions.notice_period, Math.round(6 * 70000 / 30));
  assert.equal(d.other_earnings.leave_encashment.amount, Math.round(10 * 70000 / 26));
  assert.equal(d.gratuity_eligible, true);
  assert.equal(d.other_earnings.gratuity.amount, Math.round(40000 * 15 / 26 * 9));
  const young = draftFnF({ lwd: '2026-12-10', doj: '2025-01-01', salary: { basic: 20000 } });
  assert.equal(young.gratuity_eligible, false); assert.equal(young.other_earnings.gratuity.amount, 0);
});

test('settlement: preparer cannot verify, preparer / verifier cannot approve', () => {
  const fnf = { prepared_by_id: 'a', verified_by_id: 'b' };
  assert.match(segregationProblem(fnf, 'a', 'verify'), /cannot also verify/);
  assert.equal(segregationProblem(fnf, 'b', 'verify'), '');
  assert.match(segregationProblem(fnf, 'a', 'approve'), /cannot also approve/);
  assert.match(segregationProblem(fnf, 'b', 'approve'), /cannot also approve/);
  assert.equal(segregationProblem(fnf, 'c', 'approve'), '');
  assert.equal(segregationProblem(fnf, 'a', 'approve', { ...EXIT_DEFAULTS, enforce_fnf_segregation: false }), '');
});

test('closing the case: every blocker is reported', () => {
  const base = { last_working_date: '2026-12-10', no_dues_generated: true, exit_interview_completed: true, declaration_signed_at: 'x', fnf_data: { employee_accepted: true, finance_processed_by_id: 'f', deductions: { advance: 5000 } } };
  assert.deepEqual(closeBlockers({ exit: base, wf: { require_employee_declaration: true }, today: '2026-12-11', allCleared: true, loanOutstanding: 5000 }), []);
  const bad = closeBlockers({ exit: { ...base, exit_interview_completed: false, last_working_date: '2026-12-20' }, wf: { require_employee_declaration: true }, today: '2026-12-11', allCleared: false, loanOutstanding: 9000 });
  assert.equal(bad.length, 4);
  assert.ok(bad.some(b => /last working day/.test(b)) && bad.some(b => /loan/.test(b)) && bad.some(b => /clearances/.test(b)) && bad.some(b => /interview/.test(b)));
});

test('left status follows the exit type; hand edits are limited and the audit log only grows', () => {
  assert.equal(leftStatusFor('resignation'), 'resigned'); assert.equal(leftStatusFor('termination'), 'terminated'); assert.equal(leftStatusFor('retirement'), 'retired');
  assert.equal(exitPatchProblem({}, { kt_items: [] }), '');
  assert.match(exitPatchProblem({}, { status: 'completed' }), /exit workflow/);
  assert.match(exitPatchProblem({}, { fnf_data: {} }), /exit workflow/);
  const cur = { audit_log: [{ a: 1 }] };
  assert.equal(exitPatchProblem(cur, { audit_log: [{ a: 1 }, { a: 2 }] }), '');
  assert.match(exitPatchProblem(cur, { audit_log: [] }), /added to/);
  assert.match(exitPatchProblem(cur, { audit_log: [{ a: 9 }] }), /added to/);
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01');
});

import { buildApprovalChain, needsManagement, displayStatus, nextExitRef, lastDayFor, exitAnalytics, fnfStatusLabel } from '../utils/exitPolicy.js';
test('approval chain: HOD and management steps are conditional', () => {
  assert.deepEqual(buildApprovalChain({ emp: {}, managerOk: true, hodOk: true }), ['manager', 'hod', 'hr']);
  assert.deepEqual(buildApprovalChain({ emp: {}, managerOk: false, hodOk: false }), ['hr']);
  const cfg = mergeCfg({ management_designations: 'head, director', management_grades: 'G7' });
  assert.equal(needsManagement({ designation: 'Plant Head' }, cfg), true);
  assert.equal(needsManagement({ employee_grade: 'g7' }, cfg), true);
  assert.equal(needsManagement({ designation: 'Operator', employee_grade: 'G2' }, cfg), false);
  assert.deepEqual(buildApprovalChain({ emp: { designation: 'Director' }, managerOk: true, hodOk: false, cfg }), ['manager', 'hr', 'management']);
  assert.deepEqual(buildApprovalChain({ emp: {}, managerOk: true, hodOk: true, cfg: mergeCfg({ approval_hod_enabled: false }) }), ['manager', 'hr']);
});
test('status labels, reference numbers and working-day notice', () => {
  const stages = [{ stage: 'manager', status: 'approved' }, { stage: 'hod', status: 'pending' }, { stage: 'hr', status: 'pending' }];
  assert.equal(displayStatus({ status: 'manager_approved', approval_stages: stages }), 'Pending with HOD');
  assert.equal(displayStatus({ status: 'submitted', approval_stages: [{ stage: 'manager', status: 'pending' }], retention: { status: 'open', discussions: [{}] } }), 'Under Retention Discussion');
  assert.equal(displayStatus({ status: 'cancelled', cancel_reason: 'retained' }), 'Retained');
  assert.equal(displayStatus({ status: 'in_notice', notice_shortfall_days: 10, notice_waived_days: 10 }), 'Notice Period Waived');
  assert.equal(displayStatus({ status: 'withdrawn' }), 'Withdrawn');
  assert.equal(nextExitRef(['EXT-2026-0007', 'EXT-2025-0099', null], 2026), 'EXT-2026-0008');
  assert.equal(nextExitRef([], 2026), 'EXT-2026-0001');
  assert.equal(lastDayFor('2026-12-01', 5), '2026-12-06');
  assert.equal(lastDayFor('2026-12-01', 5, { mode: 'working', weeklyOff: [0], holidays: ['2026-12-03'] }), '2026-12-08');
  assert.equal(fnfStatusLabel({ status: 'fnf_verified' }), 'Under Verification');
});
test('analytics: KPIs, retention and averages', () => {
  const ex = [
    { user_id: 'a', status: 'submitted', exit_type: 'resignation', resignation_date: '2026-11-10', reason_category: 'relocation', approval_stages: [] },
    { user_id: 'b', status: 'in_notice', exit_type: 'resignation', resignation_date: '2026-11-02', last_working_date: '2026-11-30', reason_category: 'relocation', kt_overall_completion: 40 },
    { user_id: 'c', status: 'completed', exit_type: 'resignation', resignation_date: '2026-09-01', last_working_date: '2026-10-01', fnf_data: { prepared_at: '2026-10-05T00:00:00Z', finance_processed_at: '2026-10-15T00:00:00Z' } },
    { user_id: 'd', status: 'cancelled', cancel_reason: 'retained', exit_type: 'resignation', resignation_date: '2026-11-03', retention: { status: 'closed', discussions: [{}] } },
  ];
  const emp = { a: { department: 'Sales' }, b: { department: 'Sales' }, c: { department: 'HR' }, d: { department: 'Sales' } };
  const r = exitAnalytics(ex, (u) => emp[u], { today: '2026-11-24' });
  assert.equal(r.kpis.total, 4); assert.equal(r.kpis.this_month, 3); assert.equal(r.kpis.pending_approvals, 1); assert.equal(r.kpis.serving_notice, 1);
  assert.equal(r.kpis.upcoming_7, 1); assert.equal(r.kpis.completed, 1); assert.equal(r.kpis.pending_kt, 1);
  assert.equal(r.avg_notice_served_days, 30); assert.equal(r.avg_fnf_days, 10);
  assert.deepEqual(r.retention, { discussions: 1, retained: 1, success_rate: 100 });
  assert.equal(exitAnalytics(ex, (u) => emp[u], { today: '2026-11-24', department: 'HR' }).kpis.total, 1);
});
