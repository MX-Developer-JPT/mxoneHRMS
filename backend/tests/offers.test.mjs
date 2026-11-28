// Offer letters: mandatory fields, source, prefill and employee matching. Run: node backend/tests/offers.test.mjs
import assert from 'node:assert/strict';
import * as R from '../utils/offerRules.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const masters = { departments: ['Sales', 'Production'], offices: ['Head Office'], managerIds: ['m1'] };
const full = { full_name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', department: 'Sales', designation: 'Executive', employment_type: 'Permanent', location: 'Head Office', reporting_manager_id: 'm1', joining_date: '2026-12-15', issue_date: '2026-12-01', annual_ctc: 600000, probation_months: 6, notice_period_days: 30, offer_valid_days: 7 };
const problems = (o) => R.offerProblems({ ...full, ...o }, masters, '2026-12-01');

t('a complete offer has no problems; every mandatory field is checked', () => {
  assert.deepEqual(problems({}), []);
  for (const k of ['full_name', 'email', 'phone', 'department', 'designation', 'employment_type', 'location', 'reporting_manager_id', 'joining_date', 'annual_ctc']) assert.ok(problems({ [k]: '' }).length, k);
});
t('department, office and manager must come from the master records', () => {
  assert.match(problems({ department: 'Old' })[0], /not an active department/);
  assert.match(problems({ location: 'Elsewhere' })[0], /not a company office/);
  assert.match(problems({ reporting_manager_id: 'left1' })[0], /not an active employee/);
  assert.deepEqual(problems({ reporting_manager_id: R.NO_MANAGER }), []);
  assert.deepEqual(R.offerProblems({ ...full, department: 'Anything' }, {}, '2026-12-01'), []);
});
t('dates: joining not before issue, offer not already expired', () => {
  assert.match(problems({ joining_date: '2026-11-30' })[0], /before the offer issue date/);
  assert.match(problems({ issue_date: '2026-11-01' })[0], /already have expired/);
});
t('source: requisition means MRF, direct stays direct', () => {
  assert.equal(R.offerSource({ requisition_id: 'r' }), 'mrf');
  assert.equal(R.offerSource({ source: 'direct_offer' }), 'direct');
  assert.equal(R.offerSource({ source: 'naukri' }), 'recruitment');
});
t('prefill takes the candidate and requisition, and a saved form wins', () => {
  const cand = { full_name: 'Asha Rao', email: 'a@x.com', phone: '98', position_applied: 'Executive', expected_ctc: 500000 };
  const mrf = { department: 'Sales', employment_type: 'full_time', work_location: 'head office', reports_to_user_id: 'm1' };
  const { form } = R.offerPrefill(cand, mrf, { offices: masters.offices, today: '2026-12-01' });
  assert.deepEqual([form.department, form.employment_type, form.location, form.reporting_manager_id, form.annual_ctc, form.issue_date], ['Sales', 'Permanent', 'Head Office', 'm1', 500000, '2026-12-01']);
  const saved = R.offerPrefill({ ...cand, offer_draft: { designation: 'Senior Executive', issue_date: '2026-10-01' } }, mrf, { today: '2026-12-01' }).form;
  assert.deepEqual([saved.designation, saved.issue_date], ['Senior Executive', '2026-12-01']);
});
t('employment types map to onboarding and attachments are limited to app files', () => {
  assert.deepEqual(['Permanent', 'Contractual', 'Intern', 'Trainee', 'Full time'].map(R.onboardingType), ['full_time', 'contract', 'intern', 'trainee', 'full_time']);
  const ok = 'https://x/api/upload/file/0f8fad5b-d9cb-469f-a165-70867728950e.pdf';
  assert.deepEqual(R.cleanAttachments([{ url: ok, name: 'a' }, { url: 'http://evil/x.pdf' }, { url: '/etc/passwd' }]).map((a) => a.url), [ok]);
});
t('existing employees are matched by email or phone; a name alone is weak', () => {
  const m = R.matchEmployees({ full_name: 'Asha Rao', email: 'a@x.com', phone: '+91 98765 43210' }, [
    { user_id: '1', display_name: 'Asha  Rao' }, { user_id: '2', display_name: 'Other', phone: '9876543210' }, { user_id: '3', display_name: 'Z', personal_email: 'A@X.com' }, { user_id: '4', display_name: 'No', phone: '' }]);
  assert.deepEqual(m.map((x) => [x.employee.user_id, x.strong]), [['2', true], ['3', true], ['1', false]]);
});
console.log(`\n${n} passed`);
