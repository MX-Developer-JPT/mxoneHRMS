// CV screening engine. Run: node backend/tests/cvScreening.test.mjs
import assert from 'node:assert/strict';
import { normSkill, matchSkills, experienceFromDates, extractContacts, highestDegree, parseExperienceText, buildCriteria, noticeToDays, ctcToRupees, scoreAgainst } from '../utils/cvScreening.js';
import { DEFAULT_MASTERS } from '../utils/mrf.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const NOW = new Date('2026-11-23T00:00:00Z');

t('skill aliases and spellings match', () => {
  assert.equal(normSkill('React.js'), 'react'); assert.equal(normSkill('ReactJS'), 'react'); assert.equal(normSkill('Node JS'), 'nodejs'); assert.equal(normSkill('MS Excel'), 'excel'); assert.equal(normSkill('Tally ERP 9'), 'tally');
  const rows = matchSkills(['React.js', 'Node.js', 'Docker', 'Lead Generation'], ['ReactJS', 'NodeJS'], 'Built dashboards. Strong in lead generation for dealers.');
  assert.deepEqual(rows.map((r) => [r.skill, r.credit]), [['React.js', 1], ['Node.js', 1], ['Docker', 0], ['Lead Generation', 0.75]]);
});
t('experience comes from the dates in the CV, overlaps counted once', () => {
  assert.equal(experienceFromDates('Acme  Jan 2018 – Mar 2021\nBeta  Apr 2021 - Present', NOW), 8.9);
  assert.equal(experienceFromDates('X 2019 - 2021 and Y Mar 2020 – Dec 2021', NOW), 3);       // 2019-2021 ∪ Mar2020-Dec2021 = Jan2019..Dec2021
  assert.equal(experienceFromDates('B.Tech 2010 - 2014', NOW), 4, 'a study range still reads as dates — the AI parse decides what is work');
  assert.equal(experienceFromDates('no dates here', NOW), null); assert.equal(experienceFromDates('Joined Jan 2030 - Present', NOW), null, 'future start is ignored');
});
t('contacts, degrees and notice / CTC units', () => {
  const c = extractContacts('Ravi Kumar ravi.k@gmail.com +91 98765 43210 linkedin.com/in/x https://github.com/ravik'); assert.equal(c.email, 'ravi.k@gmail.com'); assert.equal(c.phone, '9876543210'); assert.equal(c.github, 'https://github.com/ravik');
  assert.equal(highestDegree('B.Tech in Electronics, MBA Marketing').key, 'master'); assert.equal(highestDegree('Diploma in Mechanical').key, 'diploma');
  assert.equal(noticeToDays('Immediate'), 0); assert.equal(noticeToDays('2 months'), 60); assert.equal(noticeToDays('30 days'), 30); assert.equal(noticeToDays('3'), 90); assert.equal(noticeToDays(''), null);
  assert.equal(ctcToRupees('6'), 600000); assert.equal(ctcToRupees(850000), 850000); assert.equal(ctcToRupees('₹ 8.5'), 850000);
  assert.deepEqual(parseExperienceText('3-5 years'), { min: 3, max: 5 }); assert.deepEqual(parseExperienceText('5+ years'), { min: 5, max: null }); assert.deepEqual(parseExperienceText('Fresher'), { min: 0, max: 1 });
});
t('criteria are built from a manpower requisition and from an older one', () => {
  const c = buildCriteria({ mrf_version: 2, designation: 'BDE', department: 'Sales', required_skills: ['CRM', 'B2B Sales'], technical_skills: ['crm'], preferred_skills: ['Dealer Management'], exp_min: '3_5', exp_max: '5_7', ctc_min: 30000, ctc_max: 50000, ctc_frequency: 'monthly', work_city: 'Noida', qualification: ['MBA'] }, DEFAULT_MASTERS.experience_range);
  assert.deepEqual(c.mustSkills, ['CRM', 'B2B Sales']); assert.deepEqual(c.niceSkills, ['Dealer Management']); assert.equal(c.minYears, 3); assert.equal(c.maxYears, 7); assert.equal(c.ctcMax, 600000);
  const o = buildCriteria({ position_title: 'Accountant', required_skills: 'Tally, GST', experience_required: '2-4 years', salary_range_min: 300000, salary_range_max: 450000, location: 'Ghaziabad' });
  assert.deepEqual(o.mustSkills, ['Tally', 'GST']); assert.equal(o.minYears, 2); assert.equal(o.maxYears, 4); assert.equal(o.ctcMax, 450000);
});
const crit = buildCriteria({ mrf_version: 2, designation: 'BDE', required_skills: ['CRM', 'B2B Sales', 'Negotiation'], preferred_skills: ['Dealer Management'], exp_min: '3_5', exp_max: '5_7', ctc_max: 700000, ctc_frequency: 'annual', work_city: 'Noida', qualification: ['MBA'] }, DEFAULT_MASTERS.experience_range);
t('a strong candidate scores high, with an explanation per criterion', () => {
  const r = scoreAgainst(crit, { skills: ['CRM', 'B2B Sales', 'Negotiation', 'Dealer Management'], experienceYears: 5, expectedCtc: 650000, noticeDays: 30, education: 'MBA Marketing', degree: { rank: 5 }, city: 'Noida', resumeText: 'x' });
  assert.ok(r.overall_score >= 90, String(r.overall_score)); assert.equal(r.recommendation, 'Strongly Recommend'); assert.deepEqual(r.knockouts, []);
  assert.deepEqual(r.criteria.map((x) => x.key).sort(), ['education', 'experience', 'location', 'notice', 'salary', 'skills']); assert.equal(r.criteria.reduce((s, x) => s + x.weight, 0) >= 99, true);
});
t('knock-outs cap the score and say why', () => {
  const r = scoreAgainst(crit, { skills: ['Excel'], experienceYears: 1, expectedCtc: 1200000, noticeDays: 120, education: 'B.Com', degree: { rank: 4 }, city: 'Pune' });
  assert.ok(r.overall_score <= 49); assert.ok(r.knockouts.length >= 3); assert.equal(r.recommendation, 'Not Recommend'); assert.ok(r.gaps.some((g) => g.startsWith('Knock-out')));
  assert.deepEqual(r.missing_skills, ['CRM', 'B2B Sales', 'Negotiation']);
});
t('unknown facts are left out and the weights re-normalised — never scored as zero', () => {
  const r = scoreAgainst(crit, { skills: ['CRM', 'B2B Sales', 'Negotiation'], resumeText: '' });
  assert.deepEqual(r.criteria.map((x) => x.key), ['skills']); assert.equal(r.overall_score, 80); assert.equal(r.confidence, 'low');       // all must-haves (80% of the skills score) + the nice-to-have missing
});
t('the same input always gives the same score', () => {
  const cand = { skills: ['CRM'], experienceYears: 4, expectedCtc: 600000, noticeDays: 45, resumeText: 'crm' };
  assert.equal(scoreAgainst(crit, cand).overall_score, scoreAgainst(crit, cand).overall_score);
});
t('an over-qualified candidate is flagged but not rejected; a remote role ignores location', () => {
  const r = scoreAgainst(buildCriteria({ position_title: 'X', required_skills: ['A'], experience_required: '2-4 years', work_arrangement: 'remote' }), { skills: ['A'], experienceYears: 12, city: 'Delhi' });
  assert.equal(r.knockouts.length, 0); const e = r.criteria.find((x) => x.key === 'experience'); assert.ok(e.score < 100 && e.score >= 65); assert.equal(r.criteria.find((x) => x.key === 'location').score, 100);
});
console.log(`\n${n} tests passed`);
