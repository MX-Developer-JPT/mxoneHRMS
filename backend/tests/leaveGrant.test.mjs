// Automatic CL / SL / EL rules. Run: node backend/tests/leaveGrant.test.mjs
import assert from 'node:assert/strict';
import { planGrants, isIntern, RULES_VERSION } from '../utils/leaveGrantRules.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const policies = { CL: { total_days: 7 }, SL: { total_days: 7 }, EL: { total_days: 15 } };
const emp = (x = {}) => ({ user_id: 'u', designation: 'Engineer', designation_tier: 'executive', employee_status: 'confirmation', confirmation_date: '2025-01-01', date_of_joining: '2024-06-01', ...x });
const fresh = (x = {}) => ({ last_processed: '2026-09-30', counters: { CL: 0, SL: 0, EL: 0 }, grants_by_year: {}, log: [], rules_version: RULES_VERSION, ...x });
const run = (e, state, upTo, byDate = {}) => planGrants({ emp: e, byDate, state, upTo, today: upTo, policies });
const total = (due, code) => due.filter((d) => d.code === code).reduce((s, d) => s + d.days, 0);

t('a confirmed employee earns CL and EL every 20 working days, but no SL below manager', () => {
  const due = run(emp(), fresh(), '2026-11-09');   // 40 days
  assert.equal(total(due, 'CL'), 2); assert.equal(total(due, 'EL'), 2); assert.equal(total(due, 'SL'), 0);
});
t('absent days do not count', () => {
  const byDate = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`2026-10-0${i + 1}`, [{ status: 'absent' }]]));
  assert.equal(total(run(emp(), fresh(), '2026-10-20', byDate), 'CL'), 0);
});
t('manager and above, Territory Managers included, earn SL', () => {
  for (const tier of ['manager', 'territory_manager', 'general_manager', 'director']) assert.equal(total(run(emp({ designation_tier: tier }), fresh(), '2026-10-20'), 'SL'), 1, tier);
});
t('probation earns neither CL nor EL; counting starts at confirmation', () => {
  assert.deepEqual(run(emp({ employee_status: 'probation', confirmation_date: '' }), fresh(), '2026-11-30'), []);
  assert.equal(total(run(emp({ confirmation_date: '2026-11-01' }), fresh(), '2026-11-20'), 'CL'), 1);
});
t('CL and SL stop at 7 in a year', () => {
  const state = fresh();
  run(emp({ designation_tier: 'manager' }), state, '2026-12-31', {});
  run(emp({ designation_tier: 'manager' }), state, '2027-12-31', {});
  assert.equal(state.grants_by_year[2027].CL, 7); assert.equal(state.grants_by_year[2027].SL, 7);
});
t('interns get one CL a month, once, whatever their attendance or probation', () => {
  const intern = emp({ designation: 'Intern', employee_status: 'probation', confirmation_date: '' });
  assert.ok(isIntern(intern) && isIntern({ employment_type: 'intern' }) && !isIntern({ designation: 'Internal Auditor' }));
  const state = fresh();
  assert.equal(total(run(intern, state, '2026-11-27'), 'CL'), 2);
  assert.equal(total(run(intern, state, '2026-11-28'), 'CL'), 0);
  assert.equal(total(run(intern, state, '2026-12-01'), 'CL'), 1);
  assert.equal(total(run({ ...intern, date_of_joining: '2026-11-15' }, fresh(), '2026-11-27'), 'CL'), 1);
});
t('a confirmed intern gets the monthly CL only, not the working-day CL', () => {
  assert.equal(total(run(emp({ designation: 'Intern' }), fresh(), '2026-11-27'), 'CL'), 2);
});
t('moving to the new rules tops up the shortfall once and never takes days back', () => {
  const old = fresh({ rules_version: undefined, last_processed: '2026-11-26', counters: { CL: 17, EL: 17, SL: 17 }, grants_by_year: { 2026: { CL: 1, EL: 2 } } });
  const due = run(emp({ designation_tier: 'manager' }), old, '2026-11-26');   // 57 days: CL 2 and SL 2 due
  assert.equal(total(due, 'CL'), 1); assert.equal(total(due, 'SL'), 2); assert.equal(total(due, 'EL'), 0, 'EL is unchanged');
  assert.equal(old.counters.CL, 17); assert.equal(old.counters.EL, 17);
  assert.deepEqual(run(emp({ designation_tier: 'manager' }), old, '2026-11-26'), []);
  const generous = fresh({ rules_version: undefined, last_processed: '2026-11-26', grants_by_year: { 2026: { CL: 1 } } });
  assert.deepEqual(run(emp({ employee_status: 'probation', confirmation_date: '' }), generous, '2026-11-26'), []);
  assert.equal(generous.grants_by_year[2026].CL, 1);
});
t('an intern already credited under the old rule is not credited twice', () => {
  const old = fresh({ rules_version: undefined, last_processed: '2026-11-26', grants_by_year: { 2026: { CL: 1 } } });
  const due = run(emp({ designation: 'Intern' }), old, '2026-11-26');
  assert.equal(total(due, 'CL'), 1); assert.deepEqual(old.intern_months, ['2026-10', '2026-11']);
});
console.log(`\n${n} passed`);
