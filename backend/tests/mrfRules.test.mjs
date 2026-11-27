// MRF validation rules, experience check and hiring-target window. Run: node backend/tests/mrfRules.test.mjs
import assert from 'node:assert/strict';
import { evaluate, normalizeConfig, configProblems, applyOverrides, blockingFlags, canOverride, visibleFlags, experienceProblem, experienceText, targetDateProblem, targetWindow, designationTier, needsDeptHeadApproval } from '../utils/mrfRules.js';
import { DEFAULT_MASTERS } from '../utils/mrf.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const masters = { experience_range: DEFAULT_MASTERS.experience_range, position_tier: DEFAULT_MASTERS.position_tier };

t('experience: 0–1, 1–2 and 2–3 are valid; 2–0 and 3–1 are not', () => {
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [0, 0], [5, 5]]) assert.equal(experienceProblem({ exp_min_years: a, exp_max_years: b }), null, `${a}-${b}`);
  for (const [a, b] of [[2, 0], [3, 1]]) assert.match(experienceProblem({ exp_min_years: a, exp_max_years: b }), /lower than the minimum/, `${a}-${b}`);
});
t('experience is mandatory and needs both ends', () => {
  assert.match(experienceProblem({}), /required/);
  assert.match(experienceProblem({ exp_min_years: 2, exp_max_years: null }), /both/);
  assert.match(experienceProblem({ exp_min_years: -1, exp_max_years: 2 }), /negative/);
  assert.match(experienceProblem({ exp_min_years: 1, exp_max_years: 80 }), /60/);
});
t('older requisitions that picked ranges from the list still read correctly', () => {
  assert.equal(experienceProblem({ exp_min: '3_5', exp_max: '5_7' }, masters), null);
  assert.equal(experienceText({ exp_min: '3_5', exp_max: '5_7' }, masters), '3–7 years');
  assert.match(experienceProblem({ exp_min: '5_7', exp_max: '3_5' }, masters), /lower/);
  assert.equal(experienceText({ exp_min_years: 0, exp_max_years: 0 }), 'Fresher');
  assert.equal(experienceText({ exp_min: '1_2', exp_min_years: 2, exp_max_years: 4 }, masters), '2–4 years', 'numbers win over the old list');
});

t('hiring target date: only 15 to 45 days from submission, both ends included', () => {
  const sub = '2026-11-27';
  assert.deepEqual([targetWindow(sub).from, targetWindow(sub).to], ['2026-12-12', '2027-01-11']);
  assert.equal(targetDateProblem(sub, '2026-12-12'), null); assert.equal(targetDateProblem(sub, '2027-01-11'), null); assert.equal(targetDateProblem(sub, '2026-12-25'), null);
  assert.match(targetDateProblem(sub, '2026-12-11'), /too early.*12 Dec 2026.*11 Jan 2027/);
  assert.match(targetDateProblem(sub, '2027-01-12'), /too late/);
  assert.match(targetDateProblem(sub, ''), /required/);
  assert.match(targetDateProblem(sub, '2026-13-40'), /required/);
  assert.equal(targetDateProblem('2028-02-20', '2028-03-06'), null, 'across a leap February');
});

const cfg = normalizeConfig({ tiers: { senior_manager: { ctc_min: 1800000, ctc_max: 3500000, exp_min: 7, exp_max: null }, executive: { ctc_min: 250000, ctc_max: 600000, exp_min: 0, exp_max: 5 } } });
const base = { department: 'Sales', designation: 'Senior Manager', position_tier: 'senior_manager', requisition_type: 'new_position', ctc_min: 2000000, ctc_max: 3000000, ctc_frequency: 'annual', exp_min_years: 8, exp_max_years: 12 };
const run = (patch = {}, ctx = {}) => evaluate({ ...base, ...patch }, { config: cfg, masters, ...ctx });
const flag = (flags, code) => flags.find((f) => f.code === code);

t('a sensible requisition raises nothing', () => assert.deepEqual(run(), []));
t('Senior Manager at 5 LPA is a critical CTC mismatch with the explanation', () => {
  const f = flag(run({ ctc_min: 500000, ctc_max: 500000 }), 'ctc_band');
  assert.equal(f.severity, 'critical'); assert.equal(f.field, 'ctc'); assert.equal(f.title, 'CTC Mismatch');
  assert.equal(f.message, 'The proposed CTC of ₹5 LPA appears significantly below the configured compensation range for the Senior Manager position tier.');
});
t('Executive at 10 LPA is too high; a small excursion is only a warning', () => {
  const exec = { designation: 'Executive', position_tier: 'executive', exp_min_years: 1, exp_max_years: 3 };
  assert.equal(flag(run({ ...exec, ctc_min: 1000000, ctc_max: 1000000 }), 'ctc_band').severity, 'critical');
  assert.equal(flag(run({ ...exec, ctc_min: 650000, ctc_max: 700000 }), 'ctc_band').severity, 'warning');
});
t('monthly CTC is annualised, and lakhs typed as rupees are caught', () => {
  assert.equal(flag(run({ ctc_min: 180000, ctc_max: 250000, ctc_frequency: 'monthly' }), 'ctc_band'), undefined);
  assert.equal(flag(run({ ctc_min: 5, ctc_max: 8 }), 'ctc_unit').severity, 'critical');
});
t('no CTC rule fires for a tier nobody configured', () => assert.equal(flag(run({ designation: 'Manager', position_tier: 'manager', ctc_min: 100000, ctc_max: 100000 }), 'ctc_band'), undefined));
t('a senior role with little experience and a junior role with a lot are flagged', () => {
  assert.equal(flag(run({ exp_min_years: 0, exp_max_years: 1 }), 'exp_low').severity, 'warning', 'warns until HR asks for blocking');
  assert.equal(flag(run({ exp_min_years: 0, exp_max_years: 1 }, { config: normalizeConfig({ ...cfg, exp_critical_gap: 4 }) }), 'exp_low').severity, 'critical');
  assert.equal(flag(run({ exp_min_years: 4, exp_max_years: 6 }), 'exp_low').severity, 'warning');
  assert.ok(flag(run({ designation: 'Executive', position_tier: 'executive', exp_min_years: 12, exp_max_years: 15, ctc_min: 400000, ctc_max: 500000 }), 'exp_high'));
  assert.ok(flag(run({ designation: 'Management Trainee', position_tier: 'executive', exp_min_years: 4, exp_max_years: 5, ctc_min: 300000, ctc_max: 400000 }), 'exp_designation'));
});
t('designation and tier that disagree are pointed out', () => {
  assert.equal(designationTier('Area Sales Manager'), 'area_manager'); assert.equal(designationTier('Senior Executive'), 'senior_executive'); assert.equal(designationTier('Welder'), '');
  const f = flag(run({ designation: 'Executive' }), 'ctc_tier_mismatch');
  assert.equal(f.severity, 'warning', 'CTC is outside the Executive range');
});
t('pay far from existing salaries is a warning, only for HR, and needs enough records', () => {
  const pay = [2400000, 2500000, 2600000].map((annual_ctc) => ({ designation: 'senior manager', annual_ctc }));
  const flags = run({ ctc_min: 4000000, ctc_max: 4200000 }, { pay });
  assert.equal(flag(flags, 'pay_history').severity, 'warning');
  assert.equal(flag(run({ ctc_min: 4000000, ctc_max: 4200000 }, { pay: pay.slice(0, 2) }), 'pay_history'), undefined);
  assert.ok(!/25|₹/.test(flag(flags, 'pay_history').message), 'the message never quotes a salary');
  assert.equal(flag(visibleFlags(flags, false), 'pay_history'), undefined); assert.ok(flag(visibleFlags(flags, true), 'pay_history'));
  assert.equal(normalizeConfig({ history_min_samples: 1 }).history_min_samples, 3);
});
const other = { id: 'r2', requisition_id: 'MRF-2026-0002', status: 'published', department: 'Sales', designation: 'Senior Manager', requisition_type: 'replacement', replaced_employee_user_id: 'u9' };
t('duplicate and overlapping requisitions, and replacing the same person twice', () => {
  assert.equal(flag(run({}, { others: [other] }), 'duplicate').severity, 'information');
  assert.equal(flag(run({ requisition_type: 'replacement' }, { others: [other] }), 'duplicate').severity, 'warning');
  assert.equal(flag(run({}, { others: [{ ...other, status: 'closed' }] }), 'duplicate'), undefined);
  assert.equal(flag(run({}, { others: [other], id: 'r2' }), 'duplicate'), undefined, 'never a duplicate of itself');
  assert.equal(flag(run({ requisition_type: 'replacement', replaced_employee_user_id: 'u9' }, { others: [other] }), 'replacement_dup').severity, 'critical');
});
t('replacing someone from another department warns', () => {
  const f = flag(run({ requisition_type: 'replacement', replaced_employee_user_id: 'u1' }, { replaced: { name: 'A', department: 'Quality' } }), 'replacement_dept');
  assert.equal(f.severity, 'warning'); assert.match(f.message, /Quality.*Sales/);
});
t('an override counts only for the same values, and unblocks submission', () => {
  const flags = run({ ctc_min: 500000, ctc_max: 500000 });
  assert.equal(blockingFlags(flags).length, 1);
  const f = flags.find((x) => x.severity === 'critical');
  const overrides = { [f.key]: { fingerprint: f.fingerprint, severity: 'critical', justification: 'Approved by the director', by_name: 'HR' } };
  assert.equal(blockingFlags(applyOverrides(flags, overrides)).length, 0);
  assert.equal(blockingFlags(applyOverrides(run({ ctc_min: 400000, ctc_max: 400000 }), overrides)).length, 1, 'the CTC changed');
});
t('who may override, switching rules off, and configuration checks', () => {
  assert.ok(canOverride(['hr'], cfg)); assert.ok(!canOverride(['manager'], cfg)); assert.ok(!canOverride(['management'], cfg));
  assert.ok(canOverride(['management'], normalizeConfig({ override_roles: ['management'] })));
  assert.deepEqual(normalizeConfig({ override_roles: ['employee'] }).override_roles, ['hr', 'admin']);
  assert.equal(evaluate({ ...base, ctc_min: 500000, ctc_max: 500000 }, { config: normalizeConfig({ ...cfg, disabled_rules: ['ctc_band'] }), masters }).length, 0);
  assert.ok(configProblems({ tiers: { manager: { ctc_min: 900000, ctc_max: 500000 } } }).length);
  assert.ok(configProblems({ tiers: { manager: { ctc_min: 5, ctc_max: 9 } } }).some((x) => /lakhs/.test(x)));
});
t('Department Head step follows its setting', () => {
  assert.ok(!needsDeptHeadApproval({}, normalizeConfig({})));
  assert.ok(needsDeptHeadApproval({ budget_status: 'non_budgeted' }, normalizeConfig({ dept_head_approval: 'non_budgeted' })));
  assert.ok(!needsDeptHeadApproval({ budget_status: 'budgeted' }, normalizeConfig({ dept_head_approval: 'non_budgeted' })));
  assert.ok(needsDeptHeadApproval({ validation: { flags: [{ severity: 'critical', override: {} }] } }, normalizeConfig({ dept_head_approval: 'critical_override' })));
});
console.log(`\n${n} tests passed`);
