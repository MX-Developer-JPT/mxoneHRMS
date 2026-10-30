// 360° feedback rules — pure tests. Run: node backend/tests/feedback360.test.mjs
import assert from 'node:assert/strict';
import { COMPETENCIES, SCALE, OPEN_QUESTIONS, MIN_RATERS, currentPeriod, normalizePeriod, periodLabel, validateSubmission, scoreOf, summarize, periodsOf, submissionKey } from '../utils/feedback360.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const ans = (v, extra = {}) => ({ ...Object.fromEntries(COMPETENCIES.map(c => [c.key, v])), ...extra });
const row = (rel, v, extra = {}) => ({ relationship: rel, period: '2026-H2', answers: ans(v, extra) });

t('review periods are half-years in IST', () => {
  assert.equal(currentPeriod(new Date('2026-03-10T10:00:00Z')), '2026-H1');
  assert.equal(currentPeriod(new Date('2026-06-30T20:00:00Z')), '2026-H2');     // 1 July 01:30 IST
  assert.equal(currentPeriod(new Date('2026-10-29T10:00:00Z')), '2026-H2');
  assert.equal(currentPeriod(new Date('2026-12-31T20:00:00Z')), '2027-H1');     // 1 Jan IST
  assert.equal(normalizePeriod('current', new Date('2026-10-29T10:00:00Z')), '2026-H2');
  assert.equal(normalizePeriod('', new Date('2026-02-01T00:00:00Z')), '2026-H1');
  assert.equal(normalizePeriod('2025-H1'), '2025-H1');
  assert.equal(periodLabel('2026-H2'), '2026 · Jul–Dec'); assert.equal(periodLabel('current'), 'Earlier feedback');
});

t('a valid submission is cleaned; ratings must be whole numbers 1–5 for every competency', () => {
  const ok = validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: ans(4, { comments: '  great   teammate \n ' }) });
  assert.equal(ok.ok, true); assert.equal(ok.clean.comments, 'great teammate'); assert.equal(ok.clean.communication, 4);
  for (const bad of [0, 6, 2.5, 'x', null, undefined, -1]) {
    const r = validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: ans(bad) });
    assert.equal(r.ok, false, String(bad)); assert.match(r.error, /rate/i);
  }
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: { ...ans(3), ownership: undefined } }).ok, false, 'one missing competency');
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: ans('3') }).ok, true, 'numeric strings from a form are accepted');
});

t('who can be rated as what: no self-rating as a peer, self-assessment only about yourself, relationship required', () => {
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'a', relationship: 'peer', answers: ans(3) }).ok, false);
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'a', relationship: 'self', answers: ans(3) }).ok, true);
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'self', answers: ans(3) }).ok, false);
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'boss', answers: ans(3) }).ok, false);
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: '', relationship: 'peer', answers: ans(3) }).ok, false);
  assert.equal(validateSubmission({ reviewerId: '', subjectId: 'b', relationship: 'peer', answers: ans(3) }).ok, false);
});

t('free text is trimmed and capped', () => {
  const r = validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: ans(3, { strengths: 'x'.repeat(5000) }) });
  assert.equal(r.clean.strengths.length, 1000); assert.equal(r.clean.improvements, '');
});

t('scores: per-competency averages to one decimal and an overall that is the mean of them', () => {
  const s = scoreOf([row('peer', 5), row('peer', 4), row('peer', 4)]);
  assert.equal(s.scores.communication, 4.3); assert.equal(s.overall, 4.3);
  const mixed = scoreOf([{ answers: { communication: 5, collaboration: 3, technical: 4, leadership: 2, ownership: 1 } }]);
  assert.equal(mixed.overall, 3); assert.equal(scoreOf([]).overall, null);
});

t('anonymity: fewer than 3 other raters → the person rated sees nothing but how many more are needed', () => {
  const rows = [row('peer', 5, { comments: 'secret remark' }), row('peer', 1)];
  const s = summarize(rows, { privileged: false });
  assert.equal(s.hidden, true); assert.equal(s.needed, 1); assert.equal(s.reviewers, 2);
  assert.equal(s.aggregate, null); assert.equal(s.overall, null); assert.deepEqual(s.comments, []); assert.deepEqual(s.by_relationship, {});
  assert.ok(!JSON.stringify(s).includes('secret remark'));
  assert.equal(summarize([], { privileged: false }).needed, MIN_RATERS);
});

t('with 3 or more raters the results appear: averages, groups, comments without reviewers', () => {
  const rows = [row('peer', 5, { comments: 'zzz solid' }), row('peer', 4), row('peer', 3, { strengths: 'aaa clear' }), row('manager', 4), row('direct_report', 2)];
  const s = summarize(rows, { privileged: false });
  assert.equal(s.hidden, false); assert.equal(s.reviewers, 5); assert.equal(s.overall, 3.6);
  assert.equal(s.by_relationship.peer.count, 3); assert.equal(s.by_relationship.manager.count, 1, 'the single manager is always shown');
  assert.equal(s.by_relationship.direct_report, undefined, 'one direct report would be identifiable');
  assert.equal(s.comments.length, 2); assert.deepEqual(s.comments.map(c => c.strengths || c.comment), ['aaa clear', 'zzz solid'], 'sorted by text, not by time');
  for (const c of s.comments) assert.deepEqual(Object.keys(c).sort(), ['comment', 'improvements', 'relationship', 'strengths']);
});

t('HR / admin see every rating even with a low sample (flagged), but never the reviewers', () => {
  const rows = [{ ...row('peer', 5), reviewer_user_id: 'u1' }];
  const s = summarize(rows, { privileged: true });
  assert.equal(s.hidden, false); assert.equal(s.low_sample, true); assert.equal(s.overall, 5); assert.equal(s.by_relationship.peer.count, 1);
  assert.ok(!JSON.stringify(s).includes('u1') && !JSON.stringify(s).includes('reviewer_user_id'));
  assert.equal(summarize([row('peer', 3), row('peer', 3), row('peer', 3)], { privileged: true }).low_sample, false);
});

t('self-assessment is shown alongside, with the gap to what others said; it never counts as a rater', () => {
  const rows = [row('self', 5, { strengths: 'my own' }), row('peer', 3), row('peer', 3), row('manager', 4)];
  const s = summarize(rows, { privileged: false });
  assert.equal(s.reviewers, 3, 'self is not a reviewer'); assert.equal(s.self.overall, 5); assert.equal(s.self.strengths, 'my own');
  assert.equal(s.gap.communication, 1.7); assert.equal(summarize([row('self', 5)], { privileged: false }).self.overall, 5, 'own self-rating is visible while others are hidden');
  assert.equal(s.comments.length, 0, 'the self comment is not in the others comments');
});

t('periods are listed newest first, legacy rows last; a resubmission has the same key', () => {
  assert.deepEqual(periodsOf([{ period: '2026-H1' }, { period: 'current' }, { period: '2026-H2' }, { period: '2025-H2' }, {}]), ['2026-H2', '2026-H1', '2025-H2', 'current']);
  assert.equal(submissionKey({ reviewer_user_id: 'a', subject_user_id: 'b', period: '2026-H2' }), 'a|b|2026-H2');
  assert.equal(COMPETENCIES.length, 9);
});

t('the questionnaire: every competency has a question and three behaviours; the scale is 1-5 with a meaning for each point', () => {
  for (const c of COMPETENCIES) { assert.ok(c.label && c.question.length > 20, c.key); assert.equal(c.behaviours.length, 3, c.key); }
  assert.equal(new Set(COMPETENCIES.map(c => c.key)).size, COMPETENCIES.length, 'unique keys');
  assert.deepEqual(SCALE.map(x => x.value), [1, 2, 3, 4, 5]); assert.ok(SCALE.every(x => x.label && x.hint));
  assert.deepEqual(OPEN_QUESTIONS.map(q => q.key), ['strengths', 'improvements', 'comments']);
  assert.deepEqual(COMPETENCIES.filter(c => c.optional).map(c => c.key), ['customer', 'leadership']);
});

t('optional competencies may be left "not observed" and then do not pull the overall score down; required ones may not', () => {
  const { customer, leadership, ...required } = ans(4);
  const r = validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: required });
  assert.equal(r.ok, true); assert.equal('customer' in r.clean, false); assert.equal('leadership' in r.clean, false);
  for (const skip of [0, '', null, 'na']) assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: { ...required, customer: skip } }).ok, true, String(skip));
  assert.equal(validateSubmission({ reviewerId: 'a', subjectId: 'b', relationship: 'peer', answers: { ...required, leadership: 9 } }).ok, false, 'a given optional rating must still be 1-5');
  const sc = scoreOf([{ answers: r.clean }]); assert.equal(sc.overall, 4); assert.equal(sc.scores.customer, null);
});

console.log(`\n${n} 360° feedback rule tests passed`);
