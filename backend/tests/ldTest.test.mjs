// L&D test cycle — pure helper tests. Run: node backend/tests/ldTest.test.mjs
import assert from 'node:assert/strict';
import { TEST_SECONDS, applyTestTiming, isolateTestPeople, testWaitLeft, TEST_TYPES } from '../utils/ldTest.js';
import { openingGates } from '../utils/ldOpening.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const mkInd = () => ({
  anchor_date: '2020-01-01', employee: { name: 'A', reporting_manager_id: 'm1', reporting_manager_name: 'M' }, hod_user_id: 'h1', hod_name: 'H', buddy_user_id: 'b1', trainer_user_id: 't1', hr_spoc_user_id: null,
  gates: [
    ...openingGates().map(g => ({ ...JSON.parse(JSON.stringify(g)), available_from: '2030-01-01', due_date: '2030-01-05' })),
    { gate_id: 'G10', name: '30-Day Review', available_from: '2030-06-01', due_date: '2030-06-30', tasks: [{ id: 'x', title: 'a task' }] },
    { gate_id: 'P1b', name: 'policies', available_from: '2030-01-01', due_date: '2030-01-05', tasks: [{ id: 'p', type: 'policy_ack', min_read_seconds: 600 }] },
  ],
});

t('every timed task becomes 30 seconds, whatever it was', () => {
  const ind = applyTestTiming(mkInd(), '2026-11-02');
  const timed = ind.gates.flatMap(g => g.tasks).filter(x => x.target_seconds);
  assert.ok(timed.length >= 4); assert.ok(timed.every(x => x.target_seconds === TEST_SECONDS));
  assert.equal(TEST_SECONDS, 30);
  assert.equal(ind.gates.find(g => g.gate_id === 'W1').tasks[0].target_seconds, 30);
  assert.equal(ind.gates.find(g => g.gate_id === 'C1').tasks[0].target_seconds, 30);
  assert.equal(ind.gates.find(g => g.gate_id === 'W2').tasks[0].target_seconds, 30);
  assert.equal(ind.gates.find(g => g.gate_id === 'D1').tasks.find(x => x.type === 'org_view').target_seconds, 30);
  assert.equal(ind.gates.find(g => g.gate_id === 'P1b').tasks[0].min_read_seconds, 30);
});

t('every step is open from today and due a week later; the induction is flagged', () => {
  const ind = applyTestTiming(mkInd(), '2026-11-02');
  assert.equal(ind.is_test, true); assert.equal(ind.test_seconds, 30); assert.equal(ind.anchor_date, '2026-11-02');
  assert.ok(ind.gates.every(g => g.available_from === '2026-11-02' && g.due_date === '2026-11-09' && g.test_timed));
});

t('untimed tasks are left alone', () => {
  const ind = applyTestTiming(mkInd(), '2026-11-02');
  assert.deepEqual(ind.gates.find(g => g.gate_id === 'G10').tasks, [{ id: 'x', title: 'a task' }]);
});

t('the tester is the learner and every owner; no real manager / HOD / buddy / trainer stays attached', () => {
  const ind = isolateTestPeople(mkInd(), 'u9', 'Test Person');
  assert.equal(ind.employee.reporting_manager_id, null); assert.equal(ind.hod_user_id, null);
  for (const k of ['hr_spoc_user_id', 'buddy_user_id', 'trainer_user_id']) assert.equal(ind[k], 'u9', k);
  assert.equal(ind.pause_exempt, true);
});

t('test training can be completed only 30 seconds after it was started', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.equal(testWaitLeft({}, now), 30, 'not started');
  assert.equal(testWaitLeft({ started_at: '2026-11-02T10:00:00Z' }, now), 30);
  assert.equal(testWaitLeft({ started_at: '2026-11-02T10:00:00Z' }, now + 12000), 18);
  assert.equal(testWaitLeft({ started_at: '2026-11-02T10:00:00Z' }, now + 30000), 0);
  assert.equal(testWaitLeft({ started_at: '2026-11-02T10:00:00Z' }, now + 90000), 0);
});

t('the list of types a test cycle can create covers the induction, training, certificates, acknowledgements and quizzes', () => {
  for (const x of ['LdInduction', 'LdAssignment', 'LdCourse', 'LdCertificate', 'LdPolicyAck', 'LdAttempt', 'LdOrgQuiz', 'LdProductQuiz', 'LdCourseQuiz']) assert.ok(TEST_TYPES.includes(x), x);
  assert.ok(TEST_TYPES.every(x => /^Ld/.test(x)), 'only L&D types are ever removed');
});

console.log(`\n${n} L&D test-cycle tests passed`);
