// Confirmation workflow rules and mails. Run: node backend/tests/confirmation.test.mjs
import assert from 'node:assert/strict';
process.env.EMAIL_SETTINGS_FROM_ENV = '1';
const R = await import('../utils/confirmationRules.js');
const { mails, confirmationLetterHtml } = await import('../utils/confirmationMail.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const emp = (x = {}) => ({ user_id: 'u', status: 'active', employee_status: 'probation', date_of_joining: '2026-06-12', ...x });

t('the due date is the recorded probation end, else six months after joining', () => {
  assert.equal(R.dueDate(emp()), '2026-12-12');
  assert.equal(R.dueDate(emp({ employee_confirmation_date: '2027-01-05' })), '2027-01-05');
  assert.equal(R.dueDate(emp({ probation_end_date: '2027-03-01', employee_confirmation_date: '2027-01-05' })), '2027-03-01');
  assert.equal(R.dueDate(emp({ date_of_joining: '2026-08-31' })), '2027-02-28');
  assert.ok(R.onProbation(emp({ confirmation_date: '2026-12-12' })) && !R.onProbation(emp({ employee_status: 'confirmation' })) && !R.onProbation(emp({ status: 'resigned' })) && !R.onProbation(emp({ employee_status: 'trainee' })));
});
t('the reminder goes exactly 15 days before, with a two-day catch-up, and not after a decision', () => {
  assert.equal(R.reminderDue(emp(), null, '2026-11-26'), null, '16 days');
  assert.equal(R.reminderDue(emp(), null, '2026-11-27').days_left, 15);
  assert.equal(R.reminderDue(emp(), null, '2026-11-29').days_left, 13);
  assert.equal(R.reminderDue(emp(), null, '2026-11-30'), null);
  assert.equal(R.reminderDue(emp(), { status: 'confirmed' }, '2026-11-27'), null);
  assert.equal(R.reminderDue(emp({ probation_end_date: '2027-03-16' }), { status: 'on_hold' }, '2027-03-01').days_left, 15, 'revised date');
});
t('a decision needs ratings and an assessment; hold and reject need a reason; hold needs a future date', () => {
  const ok = { decision: 'confirm', comments: 'Solid performer throughout.', scores: Object.fromEntries(R.CRITERIA.map((k) => [k, 4])) };
  assert.deepEqual(R.decisionProblems(ok, '2026-11-28'), []);
  assert.ok(R.decisionProblems({ ...ok, scores: {} }, '2026-11-28').length);
  assert.ok(R.decisionProblems({ ...ok, decision: 'reject' }, '2026-11-28').length);
  assert.ok(R.decisionProblems({ ...ok, decision: 'hold', remarks: 'Needs more time on targets', review_date: '2026-11-28' }, '2026-11-28').length);
  assert.deepEqual(R.decisionProblems({ ...ok, decision: 'hold', remarks: 'Needs more time on targets', review_date: '2027-02-28' }, '2026-11-28'), []);
});
t('the employee record follows the decision', () => {
  const c = R.employeeAfterDecision(emp(), 'confirmed', { today: '2026-11-28' });
  assert.deepEqual([c.employee_status, c.confirmation_date, c.confirmation_status], ['confirmation', '2026-11-28', 'confirmed']);
  const h = R.employeeAfterDecision(emp(), 'on_hold', { today: '2026-11-28', reviewDate: '2027-02-28', remarks: 'x' });
  assert.deepEqual([h.employee_status, h.probation_end_date, h.confirmation_date], ['probation', '2027-02-28', '']);
  const r = R.employeeAfterDecision(emp(), 'rejected', { today: '2026-11-28', remarks: 'y', byName: 'M' });
  assert.equal(r.probation_outcome, 'not_confirmed');
  assert.equal(R.employeeAfterDecision(r, 'confirmed', { today: '2026-11-29' }).probation_outcome, undefined);
  assert.deepEqual(R.changedProtected({ employee_status: 'probation', designation: 'a' }, { employee_status: 'probation', designation: 'b' }), []);
  assert.deepEqual(R.changedProtected({ employee_status: 'probation' }, { employee_status: 'confirmation' }), ['employee_status']);
});
t('mails carry the required details, escape input, and keep HR observations out of the email', () => {
  const m = mails.reminder({ name: 'A <b>', code: 'MVE1', department: 'Sales', designation: 'Exec', joined: '2026-06-12', due: '2026-12-12', daysLeft: 15, managerName: 'M' });
  for (const part of ['MVE1', 'Sales', 'Exec', '12 June 2026', '12 December 2026', 'final decision']) assert.ok(m.html.includes(part), part);
  assert.ok(!m.html.includes('<b>A') && !m.html.includes('A <b>'));
  const h = mails.on_hold({ name: 'A', remarks: 'Improve targets', reviewDate: '2027-02-28', managerName: 'M' });
  assert.ok(h.html.includes('Improve targets') && h.html.includes('28 February 2027'));
  assert.ok(mails.rejected({ name: 'A', remarks: 'Not suited', managerName: 'M' }).html.includes('Not suited'));
  assert.ok(!mails.request({ name: 'A', hasObservations: true }).html.includes('absent'));
  const letter = confirmationLetterHtml({ name: 'A', designation: 'Exec', effective: '2026-11-28', signatories: [{ id: '1', name: 'Asha', designation: 'Head HR', is_default: true }] });
  assert.ok(letter.includes('Letter of Confirmation') && letter.includes('mx-signatory') && letter.includes('Asha') && letter.includes('28 November 2026'));
});
console.log(`\n${n} passed`);
