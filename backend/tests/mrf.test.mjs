// MRF pure rules. Run: node backend/tests/mrf.test.mjs
import assert from 'node:assert/strict';
import { cleanForm, submitProblems, timelineHint, isMaterialJdChange, templateJd, fallbackKeywords, canTransition, nextReqId, legacyMirror, DEFAULT_MASTERS } from '../utils/mrf.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const masters = { experience_range: DEFAULT_MASTERS.experience_range };
t('tags are de-duplicated case-insensitively and numbers/dates sanitised', () => {
  const f = cleanForm({ required_skills: ['React', 'react', ' Node '], number_of_positions: '3', ctc_min: '', target_hire_date: 'bad', hack: 'x' });
  assert.deepEqual(f.required_skills, ['React', 'Node']); assert.equal(f.number_of_positions, 3); assert.equal(f.ctc_min, null); assert.equal(f.target_hire_date, ''); assert.ok(!('hack' in f));
});
t('submission checks the essentials, replacement fields and experience / CTC order', () => {
  const ok = { requisition_type: 'new_position', department: 'Sales', designation: 'BDE', position_tier: 'executive', number_of_positions: 1, hiring_manager_id: 'u', employment_type: 'full_time', priority: 'high', work_arrangement: 'on_site', work_location: 'Noida', position_overview: 'x' };
  assert.deepEqual(submitProblems(ok, masters), []);
  assert.ok(submitProblems({ ...ok, requisition_type: 'replacement' }, masters).some(e => /replaced/i.test(e)));
  assert.ok(submitProblems({ ...ok, exp_min: '5_7', exp_max: '3_5' }, masters).some(e => /experience/i.test(e)));
  assert.ok(submitProblems({ ...ok, ctc_min: 9, ctc_max: 5 }, masters).some(e => /CTC/.test(e)));
  assert.equal(submitProblems({ ...ok, exp_min: '3_5', exp_max: '5_7', is_remote: true, work_location: '', remote_region: 'pan_india' }, masters).length, 0, 'custom / remote locations are accepted');
});
t('hiring window is advice, never a block', () => {
  assert.equal(timelineHint('2026-11-01', '2026-11-10').state, 'aggressive'); assert.equal(timelineHint('2026-11-01', '2026-11-20').state, 'ideal');
  assert.equal(timelineHint('2026-11-01', '2027-02-01').state, 'extended'); assert.equal(timelineHint('2026-11-01', '').from, '2026-11-16');
});
t('formatting edits are not material, wording edits are', () => {
  assert.equal(isMaterialJdChange('• Lead  the team.', '- lead the TEAM'), false); assert.equal(isMaterialJdChange('Lead the team', 'Lead the sales team'), true);
});
t('the fallback JD follows the structure and only shows CTC when disclosed', () => {
  const f = { designation: 'BDE', department: 'Sales', position_tier: 'executive', employment_type: 'full_time', ctc_min: 300000, ctc_max: 500000, work_city: 'Noida', key_responsibilities: ['Sell'] };
  const jd = templateJd(f, { masters: { position_tier: DEFAULT_MASTERS.position_tier } });
  assert.ok(/ABOUT MAXVOLT ENERGY/.test(jd) && /KEY RESPONSIBILITIES/.test(jd) && !/COMPENSATION/.test(jd));
  assert.ok(/COMPENSATION RANGE\n₹3,00,000/.test(templateJd({ ...f, disclose_ctc: true }, {})));
});
t('keyword fallback is department specific', () => {
  assert.ok(fallbackKeywords({ department: 'Software Development', designation: 'Software Developer' }).skills.includes('React.js'));
  assert.ok(fallbackKeywords({ department: 'Sales', designation: 'Business Development Executive' }).skills.includes('Dealer Management'));
});
t('workflow, ids and the legacy mirror', () => {
  assert.equal(canTransition('draft', 'published'), false); assert.equal(canTransition('pending_hr_publication', 'published'), true);
  assert.equal(nextReqId(['MRF-2026-0007', 'MRF-2025-0099'], 2026), 'MRF-2026-0008');
  assert.equal(legacyMirror({ designation: 'X', ctc_min: 100, ctc_max: 200 }).salary_range_max, 0); assert.equal(legacyMirror({ designation: 'X', ctc_min: 10, ctc_max: 20, ctc_frequency: 'monthly', disclose_ctc: true }).salary_range_max, 240);
});
console.log(`\n${n} tests passed`);
