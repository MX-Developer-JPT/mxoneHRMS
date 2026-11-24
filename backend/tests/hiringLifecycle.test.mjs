// Candidate lifecycle rules. Run: node backend/tests/hiringLifecycle.test.mjs
import assert from 'node:assert/strict';
import { checkTransition, allowedNext, businessDays, calendarDays, appendTimeline, statusLabel } from '../utils/hiringLifecycle.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const c = (status, req = 'MRF-1') => ({ status, requisition_id: req });

t('mandatory stages cannot be skipped by hand', () => {
  assert.equal(checkTransition(c('applied'), 'selected', { role: 'recruiter' }).ok, false);
  assert.equal(checkTransition(c('shortlisted'), 'interview_scheduled', { role: 'hr' }).ok, false);
  assert.equal(checkTransition(c('applied'), 'cv_sent', { role: 'hr' }).ok, false, 'CV sent is set by the review request');
  assert.equal(checkTransition(c('applied'), 'screening', { role: 'recruiter' }).ok, true);
  assert.equal(checkTransition(c('screening'), 'shortlisted', { role: 'recruiter' }).ok, true);
});
t('an authorised override needs HR or admin and a reason', () => {
  assert.equal(checkTransition(c('applied'), 'selected', { role: 'recruiter', override_reason: 'MD referral' }).ok, false);
  assert.equal(checkTransition(c('applied'), 'selected', { role: 'hr', override_reason: 'ok' }).ok, false, 'reason too short');
  const r = checkTransition(c('applied'), 'selected', { role: 'hr', override_reason: 'Direct referral from the MD' }); assert.equal(r.ok, true); assert.equal(r.override, true);
});
t('the workflow itself moves candidates through its own stages', () => {
  assert.equal(checkTransition(c('shortlisted'), 'cv_sent', { system: true }).ok, true);
  assert.equal(checkTransition(c('cv_sent'), 'interview_recommended', { system: true }).ok, true);
  assert.equal(checkTransition(c('interview_recommended'), 'interview_scheduled', { system: true }).ok, true);
  assert.equal(checkTransition(c('interview_scheduled'), 'interviewed', { system: true }).ok, true);
});
t('finished candidates stay finished; offers follow the offer path', () => {
  assert.equal(checkTransition(c('joined'), 'screening', { role: 'recruiter' }).ok, false);
  assert.equal(checkTransition(c('rejected'), 'screening', { role: 'recruiter' }).ok, false);
  assert.equal(checkTransition(c('selected'), 'offered', { role: 'hr' }).ok, true);
  assert.equal(checkTransition(c('offered'), 'offer_accepted', { role: 'hr' }).ok, true);
  assert.equal(checkTransition(c('offer_accepted'), 'joined', { role: 'hr' }).ok, true);
});
t('older candidates with no requisition keep the older direct path', () => {
  assert.equal(checkTransition({ status: 'applied' }, 'interview_scheduled', { role: 'hr' }).ok, true);
  assert.deepEqual(allowedNext({ status: 'applied' }).includes('interview_scheduled'), true);
  assert.equal(allowedNext(c('applied')).includes('interview_scheduled'), false);
});
t('business days skip weekly offs and holidays; calendar days do not', () => {
  assert.equal(calendarDays('2026-11-02', '2026-11-09'), 7);
  assert.equal(businessDays('2026-11-02', '2026-11-09'), 6, 'Mon→Mon with Sunday off');
  assert.equal(businessDays('2026-11-02', '2026-11-09', { holidays: ['2026-11-04'] }), 5);
  assert.equal(businessDays('2026-11-09', '2026-11-02'), null);
});
t('the timeline only ever grows', () => {
  const a = appendTimeline({}, { text: 'one' }); const b = appendTimeline({ timeline: a }, { text: 'two' });
  assert.equal(a.length, 1); assert.equal(b.length, 2); assert.equal(b[0].text, 'one'); assert.equal(statusLabel('cv_sent'), 'CV Sent for Review');
});
console.log(`\n${n} tests passed`);
