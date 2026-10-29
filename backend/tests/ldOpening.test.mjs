// L&D opening steps (website tour, policy acknowledgements, department org chart + quiz) — pure logic tests.
// Run: node backend/tests/ldOpening.test.mjs
import assert from 'node:assert/strict';
import { buildDeptOrg, makeOrgQuiz, gradeOrgQuiz, namesMatch, addWatchTime, syncPolicyTasks, policyStates, withOpeningGates, inductionPolicies, tenureText, openingGates, ACK_STATEMENT } from '../utils/ldOpening.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const E = (id, name, dept, desig, mgr, doj, tier = 'executive') => ({ user_id: id, display_name: name, department: dept, designation: desig, reporting_manager_id: mgr, date_of_joining: doj, designation_tier: tier, employee_code: id.toUpperCase(), status: 'active' });
const emps = [
  E('cto', 'Vishal Gupta', 'MANAGEMENT', 'CHIEF TECHNICAL OFFICER', 'cto', '2019-05-09', 'director'),
  E('ceo', 'Satendra Shukla', 'MANAGEMENT', 'CHIEF EXECUTIVE OFFICER', 'ceo', '2019-01-01', 'director'),
  E('cmo', 'Mukesh Gupta', 'MANAGEMENT', 'CMO', 'cmo', '2025-10-01', 'director'),
  E('coo', 'Sachin Gupta', 'MANAGEMENT', 'CHIEF OPERATING OFFICER', 'coo', '2019-02-01', 'director'),
  E('md', 'Bhuvneshwar Pal Singh', 'MANAGEMENT', 'MANAGING DIRECTOR & CHIEF FINANCIAL OFFICER', 'md', '2019-01-01', 'director'),
  E('am', 'Ashish Chaturvedi', 'PURCHASE', 'SENIOR MANAGER', 'cto', '2025-10-27', 'manager'),
  E('dg', 'Dhruv Gupta', 'PURCHASE', 'SENIOR EXECUTIVE', 'cto', '2026-02-02', 'senior_executive'),
  E('rk', 'Rakesh Kumar', 'PURCHASE', 'ASSISTANT MANAGER - IMPORT', 'am', '2024-09-02', 'senior_executive'),
  E('st', 'Shivam Tyagi', 'PURCHASE', 'ASSISTANT MANAGER - LOCAL', 'am', '2025-06-16', 'senior_executive'),
  E('ad', 'Anubhav Dixit', 'PURCHASE', 'SENIOR EXECUTIVE', 'am', '2026-04-06', 'senior_executive'),
  E('nk', 'Nikhil Kumar', 'PURCHASE', 'EXECUTIVE- DOMESTIC PURCHASE', 'am', '2025-06-03'),
  E('bk', 'Balsharan Kumar', 'PURCHASE', 'EXECUTIVE', 'am', '2025-12-01'),
  E('hr1', 'Sanjay Sharma', 'HR', 'ASSISTANT GENERAL MANAGER', 'cmo', '2025-08-13', 'general_manager'),
  E('hr2', 'Atul Dwivedi', 'HR', 'MANAGER', 'hr1', '2026-04-08', 'manager'),
  E('hr3', 'Gourav Panchal', 'HR', 'Executive', 'hr2', '2026-08-24'),
];

t('org chart: Management is the top level, their direct reports the middle level, the rest the team', () => {
  const org = buildDeptOrg('PURCHASE', emps, { today: '2026-10-26' });
  assert.deepEqual(org.counts, { top: 1, middle: 2, team: 5, total: 8 });
  assert.equal(org.top[0].name, 'Vishal Gupta');
  assert.deepEqual(org.middle.map(p => p.name).sort(), ['Ashish Chaturvedi', 'Dhruv Gupta']);
  assert.ok(org.team.every(p => p.level === 'team'));
  // tree: CTO -> middle -> team under Ashish
  assert.equal(org.tree.length, 1);
  const cto = org.tree[0]; assert.equal(cto.level, 'top'); assert.equal(cto.children.length, 2);
  const ashish = cto.children.find(c => c.name === 'Ashish Chaturvedi'); assert.equal(ashish.children.length, 5); assert.equal(ashish.direct_reports, 5);
  // every person carries what the learner needs to see
  for (const p of [...org.top, ...org.middle, ...org.team]) { assert.ok(p.name && p.designation && p.doj && p.tenure); }
  assert.equal(org.team.find(p => p.name === 'Rakesh Kumar').reports_to, 'Ashish Chaturvedi — SENIOR MANAGER');
  assert.equal(org.leadership.length, 5);
});
t('org chart: a department whose head reports to a non-management manager still gets a middle level', () => {
  const org = buildDeptOrg('HR', emps, { today: '2026-10-26' });
  assert.deepEqual(org.middle.map(p => p.name), ['Sanjay Sharma']);
  assert.equal(org.tree[0].children[0].children.find(c => c.name === 'Atul Dwivedi').children[0].name, 'Gourav Panchal');   // nested team
});
t('org chart: Management department shows leaders and the people who report to them; viewer is marked', () => {
  const org = buildDeptOrg('MANAGEMENT', emps, { today: '2026-10-26', viewerUid: 'am' });
  assert.equal(org.scope, 'management'); assert.equal(org.counts.top, 5); assert.ok(org.counts.middle >= 3);
  const mine = buildDeptOrg('PURCHASE', emps, { today: '2026-10-26', viewerUid: 'bk' });
  assert.equal([...mine.top, ...mine.middle, ...mine.team].filter(p => p.is_you).length, 1);
});
t('org chart: unknown / empty department is an empty chart, not an error', () => {
  const org = buildDeptOrg('NOPE', emps, { today: '2026-10-26' });
  assert.equal(org.counts.team, 0); assert.equal(org.counts.middle, 0);
});
t('tenure text', () => { assert.equal(tenureText('2026-10-26', '2026-10-26'), 'Joined today'); assert.equal(tenureText('2026-10-05', '2026-10-26'), '21 days'); assert.equal(tenureText('2025-10-27', '2026-10-26'), '11 months'); assert.equal(tenureText('2019-05-09', '2026-10-26'), '7 yrs 5 mo'); });

t('quiz: 10 valid questions, 4 distinct options, correct answer inside, top and middle level weighted', () => {
  const org = buildDeptOrg('PURCHASE', emps, { today: '2026-10-26' });
  for (const seed of [1, 2, 3, 42, 99, 2026]) {
    const q = makeOrgQuiz(org, { seed });
    assert.equal(q.length, 10, `seed ${seed}`);
    for (const x of q) { assert.equal(x.options.length, 4); assert.equal(new Set(x.options).size, 4); assert.ok(x.correct >= 0 && x.correct < 4); }
    assert.equal(new Set(q.map(x => x.text)).size, q.length, 'no repeated question');
    const top = q.filter(x => x.level === 'top').length, mid = q.filter(x => x.level === 'middle').length;
    assert.ok(top + mid >= 6, `top+middle >= 6, got ${top}+${mid}`);
  }
  assert.deepEqual(makeOrgQuiz(org, { seed: 7 }), makeOrgQuiz(org, { seed: 7 }), 'deterministic per seed');
  assert.notDeepEqual(makeOrgQuiz(org, { seed: 7 }).map(x => x.text), makeOrgQuiz(org, { seed: 8 }).map(x => x.text), 'a retake is a different quiz');
});
t('quiz: answers match the org chart', () => {
  const org = buildDeptOrg('PURCHASE', emps, { today: '2026-10-26' });
  for (const seed of [1, 5, 9, 13]) for (const x of makeOrgQuiz(org, { seed })) {
    const right = x.options[x.correct];
    if (/Which Management \(top-level\) leader does the PURCHASE/.test(x.text)) assert.equal(right, 'Vishal Gupta');
    if (/Who does Ashish Chaturvedi report to/.test(x.text)) assert.equal(right, 'Vishal Gupta');
    if (/What is Ashish Chaturvedi's designation/.test(x.text)) assert.equal(right, 'SENIOR MANAGER');
    if (/Who among these reports to Ashish/.test(x.text)) assert.ok(['Rakesh Kumar', 'Shivam Tyagi', 'Anubhav Dixit', 'Nikhil Kumar', 'Balsharan Kumar'].includes(right));
    if (/Who joined most recently/.test(x.text)) { const named = x.options.map(o => emps.find(e => e.display_name === o)); assert.equal(right, named.sort((a, b) => b.date_of_joining.localeCompare(a.date_of_joining))[0].display_name); }
    if (/NOT part of the Management/.test(x.text)) assert.ok(!emps.filter(e => e.department === 'MANAGEMENT').some(e => e.display_name === right));
    if (/How many people work in the PURCHASE/.test(x.text)) assert.equal(right, '7');
    if (/Who is the CHIEF TECHNICAL OFFICER/.test(x.text)) assert.equal(right, 'Vishal Gupta');
  }
});
t('quiz: tiny department still produces a sensible quiz; empty one produces none', () => {
  const tiny = [...emps.filter(e => e.department === 'MANAGEMENT'), E('x1', 'A One', 'IT', 'MANAGER', 'cto', '2025-01-01', 'manager'), E('x2', 'B Two', 'IT', 'EXECUTIVE', 'x1', '2025-02-01')];
  const q = makeOrgQuiz(buildDeptOrg('IT', tiny, { today: '2026-10-26' }), { seed: 3 });
  assert.ok(q.length >= 5 && q.length <= 10); for (const x of q) assert.equal(new Set(x.options).size, x.options.length);
  assert.equal(makeOrgQuiz(buildDeptOrg('NOPE', [], { today: '2026-10-26' }), { seed: 3 }).length, 0);
});
t('quiz grading: pass mark applies to the whole quiz', () => {
  const quiz = Array.from({ length: 10 }, (_, i) => ({ id: `q${i + 1}`, level: 'top', text: 'x', options: ['a', 'b', 'c', 'd'], correct: 1 }));
  const ans = (right) => Object.fromEntries(quiz.map((q, i) => [q.id, i < right ? 1 : 0]));
  assert.equal(gradeOrgQuiz(quiz, ans(9), 90).passed, true); assert.equal(gradeOrgQuiz(quiz, ans(9), 90).score, 90);
  assert.equal(gradeOrgQuiz(quiz, ans(8), 90).passed, false); assert.equal(gradeOrgQuiz(quiz, ans(10), 90).score, 100);
  assert.equal(gradeOrgQuiz(quiz, {}, 90).passed, false); assert.equal(gradeOrgQuiz([], {}, 90).passed, false);
  assert.equal(gradeOrgQuiz(quiz, ans(9), 90).results[9].correct_text, 'b');
});

t('signature name must be the employee\'s own', () => {
  assert.ok(namesMatch('Ashish Chaturvedi', 'Ashish Chaturvedi')); assert.ok(namesMatch('  ashish   chaturvedi ', 'ASHISH CHATURVEDI'));
  assert.ok(namesMatch('Ashish Kumar Sahoo', 'Ashish Sahoo')); assert.ok(namesMatch('Ashish Sahoo', 'Ashish Kumar Sahoo'));   // middle name optional
  assert.ok(namesMatch('Sandeep', 'Sandeep .'));                                                                            // single-word names with stray punctuation
  assert.ok(!namesMatch('Ashish', 'Ashish Chaturvedi')); assert.ok(!namesMatch('Rakesh Kumar', 'Ashish Chaturvedi')); assert.ok(!namesMatch('', 'Ashish')); assert.ok(!namesMatch('Ashish Verma', 'Ashish Chaturvedi'));
  assert.ok(!namesMatch('Sandeep Kumar', 'Sandeep'));
});

t('tracked time: only real, visible time counts; bursts and extra tabs cannot inflate it', () => {
  const task = { target_seconds: 600 };
  const T0 = 1_000_000_000;
  assert.equal(addWatchTime(task, T0, true).seconds, 0);                                   // first beat only starts the clock
  assert.equal(addWatchTime(task, T0 + 15000, true).seconds, 15);
  assert.equal(addWatchTime(task, T0 + 30000, false).seconds, 15);                         // hidden tab: nothing added
  assert.equal(addWatchTime(task, T0 + 45000, true).seconds, 30);
  assert.equal(addWatchTime(task, T0 + 45500, true).seconds, 30.5);                        // a second tab's beat 0.5 s later adds only 0.5 s
  assert.equal(addWatchTime(task, T0 + 3_600_000, true).seconds, 60.5);                    // laptop slept for an hour: capped at 30 s
  let r; for (let i = 1; i <= 25; i++) r = addWatchTime(task, T0 + 3_600_000 + i * 30000, true);
  assert.equal(r.done, true); assert.ok(r.seconds >= 600);
  const burst = { target_seconds: 600 }; let b; for (let i = 0; i < 500; i++) b = addWatchTime(burst, T0 + i * 10, true);   // 500 beats in 5 s
  assert.ok(b.seconds <= 5.1, `got ${b.seconds}`); assert.equal(b.done, false);
});

t('policies: induction list, order, one-by-one unlocking, signed ones are kept', () => {
  const pol = [
    { id: 'p2', title: 'Travel', file_url: '/f/2.pdf', is_active: true, induction_order: 2 },
    { id: 'p1', title: 'Zero Tolerance', file_url: '/f/1.pdf', is_active: true, induction_order: 1, min_read_seconds: 45 },
    { id: 'p3', title: 'Hidden', file_url: '/f/3.pdf', is_active: false },
    { id: 'p4', title: 'No file', is_active: true },
    { id: 'p5', title: 'Opted out', file_url: '/f/5.pdf', is_active: true, induction_required: false },
    { id: 'p6', title: 'Loan', file_url: '/f/6.pdf', is_active: true },
    { id: 'p8', title: 'Word file', file_url: '/f/8.docx', is_active: true },
  ];
  assert.deepEqual(inductionPolicies(pol).map(p => p.id), ['p1', 'p2', 'p6']);
  let tasks = syncPolicyTasks([], pol);
  assert.deepEqual(tasks.map(x => x.policy_id), ['p1', 'p2', 'p6']); assert.equal(tasks[0].min_read_seconds, 45); assert.equal(tasks[1].min_read_seconds, 60); assert.ok(tasks.every(x => x.type === 'policy_ack' && x.server_only));
  assert.deepEqual(policyStates(tasks).map(x => x.state), ['open', 'locked', 'locked']);
  tasks[0].done = true;
  assert.deepEqual(policyStates(tasks).map(x => x.state), ['signed', 'open', 'locked']);
  // HR adds a policy and withdraws two others: signed work is never lost, unsigned follows the list
  const next = syncPolicyTasks(tasks, [{ id: 'p7', title: 'New', file_url: '/f/7.pdf', is_active: true, induction_order: 1 }, pol[5]]);
  assert.deepEqual(next.map(x => x.policy_id), ['p7', 'p6', 'p1']);
  assert.ok(next.find(x => x.policy_id === 'p1').done, 'signed policy kept although withdrawn');
  assert.ok(!next.some(x => x.policy_id === 'p2'), 'withdrawn unsigned policy removed');
  assert.ok(ACK_STATEMENT.includes('I have read and acknowledged the said policy') && ACK_STATEMENT.includes('promise to adhere to it'));
});

t('template: opening gates go after Pre-Joining Readiness and the first learning gate waits for them; idempotent', () => {
  const base = [{ gate_id: 'G00', seq: 0, depends_on: [] }, { gate_id: 'G01', seq: 1, depends_on: ['G00'] }, { gate_id: 'G02', seq: 2, depends_on: ['G01'] }];
  const out = withOpeningGates(base);
  assert.deepEqual(out.map(g => g.gate_id), ['G00', 'W1', 'W2', 'P1', 'D1', 'G01', 'G02']);
  assert.deepEqual(out.find(g => g.gate_id === 'G01').depends_on, ['D1']);
  assert.deepEqual(out.find(g => g.gate_id === 'W1').depends_on, ['G00']); assert.deepEqual(out.find(g => g.gate_id === 'W2').depends_on, ['W1']); assert.deepEqual(out.find(g => g.gate_id === 'P1').depends_on, ['W2']); assert.deepEqual(out.find(g => g.gate_id === 'D1').depends_on, ['P1']);
  assert.deepEqual(withOpeningGates(out).map(g => g.gate_id), out.map(g => g.gate_id));
  assert.deepEqual(base[1].depends_on, ['G00'], 'input untouched');
  assert.ok(openingGates().every(g => g.completion === 'auto' && g.tasks.every(x => x.server_only) || g.gate_id === 'P1'));
  assert.equal(openingGates()[0].tasks[0].target_seconds, 600);
});

console.log(`\n${n} L&D opening tests passed`);
