// L&D induction course (step C1): lesson content integrity and quiz generation — pure logic tests.
// Run: node backend/tests/ldCourse.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COURSE_MODULES, COURSE_QUESTION_BANK, makeCourseQuiz, courseContent, COURSE_QUIZ_QUESTIONS, COURSE_STUDY_SECONDS } from '../utils/ldCourse.js';
import { gradeOrgQuiz, openingGates } from '../utils/ldOpening.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const KINDS = new Set(['p', 'list', 'stats', 'cards', 'table', 'timeline', 'steps', 'people', 'callout', 'images', 'chips']);
const pubDir = new URL('../../maxvolt-hr/public/', import.meta.url);
const assetDir = new URL('../assets/ld-course/', import.meta.url);

t('13 modules, numbered 1..13, with unique ids and only known block kinds', () => {
  assert.equal(COURSE_MODULES.length, 13);
  assert.deepEqual(COURSE_MODULES.map(m => m.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(new Set(COURSE_MODULES.map(m => m.id)).size, 13);
  for (const m of COURSE_MODULES) { assert.ok(m.title && m.subtitle && m.blocks.length >= 3, m.id); for (const b of m.blocks) assert.ok(KINDS.has(b.t), `${m.id}: ${b.t}`); }
});

t('every block carries its content (no empty lists / tables / cards)', () => {
  for (const m of COURSE_MODULES) for (const b of m.blocks) {
    if (b.t === 'p') assert.ok(b.text.length > 20, m.id);
    if (['list', 'stats', 'cards', 'timeline', 'steps', 'people', 'chips'].includes(b.t)) assert.ok(b.items.length >= 2, `${m.id}/${b.t}`);
    if (b.t === 'images') assert.ok(b.items.length >= 1, m.id);
    if (b.t === 'table') { assert.ok(b.rows.length >= 3 && b.head.length === 2, m.id); for (const r of b.rows) assert.equal(r.length, 2); }
    if (b.t === 'people') for (const x of b.items) assert.ok(x.name && x.role && x.focus && x.photo);
  }
});

t('the deck facts are all in the lessons (spot checks across all 13 topics)', () => {
  const all = JSON.stringify(COURSE_MODULES);
  for (const s of ['Energizing Future', '15 batteries per day', 'Integrity', '25,000+', '950+', '107+', 'MAXVOLT', '₹54 Cr', '2.3 GWh', 'Aligarh', 'IIT Roorkee', 'Collect', 'Reintegrate', '99%+', '15,000 MT', '8,500 MT',
    'Scopus-indexed', 'Jalandhar', 'ISO 9001:2015', 'AIS 156', 'Bhuvneshwar Pal Singh', 'Payal Jain', 'Pawan Jha', 'Legal & Compliance', 'PPC', 'Zero tolerance', 'retaliation',
    '12 working hours', '26 weeks', '15 calendar days', 'Gratuity', 'AskMax', 'Gate Pass', 'My Insurance', 'Own & Contribute', 'first-week checklist', 'Buddy', 'Know the difference']) assert.ok(all.includes(s), s);
  assert.equal(COURSE_MODULES.find(m => m.id === 'fit').blocks.find(b => b.t === 'chips').items.length, 18, 'all 18 departments');
  assert.equal(COURSE_MODULES.find(m => m.id === 'one').blocks.find(b => b.t === 'cards').items.length, 13, 'all 13 Maxvolt One modules');
  assert.equal(COURSE_MODULES.find(m => m.id === 'research').blocks.find(b => b.t === 'cards').items.length, 5, 'all 5 papers');
});

t('every referenced image exists: deck photos in backend/assets, catalogue photos in the public folder', () => {
  let count = 0;
  for (const m of COURSE_MODULES) for (const b of m.blocks) {
    if (b.t === 'images') for (const i of b.items) { count++; assert.ok(fs.existsSync(i.src.startsWith('/ld-course/') ? new URL(i.src.slice('/ld-course/'.length), assetDir) : new URL(i.src.slice(1), pubDir)), i.src); }
    if (b.t === 'people') for (const x of b.items) assert.ok(fs.existsSync(new URL(`${x.photo}.webp`, assetDir)), x.photo);
  }
  assert.ok(count >= 10);
});

t('internal deck photos are NOT in the public folder and reach the learner only as inline data in the content', () => {
  assert.ok(!fs.existsSync(new URL('ld-course/', pubDir)), 'no public ld-course folder');
  const c = courseContent(); const raw = JSON.stringify(c);
  assert.ok(!raw.includes('/ld-course/'), 'no public URL to a deck photo is sent');
  const fit = c.modules.find(m => m.id === 'fit').blocks.find(b => b.t === 'people');
  assert.equal(fit.items.length, 8); for (const x of fit.items) assert.ok(x.photo_src.startsWith('data:image/webp;base64,') && x.photo_src.length > 2000, x.photo);
  const j = c.modules.find(m => m.id === 'journey').blocks.find(b => b.t === 'images');
  for (const i of j.items) assert.ok(i.src.startsWith('data:image/webp;base64,'), i.caption);
  assert.ok(raw.length < 900 * 1024, `content payload ${Math.round(raw.length / 1024)} KB`);
});

t('question bank: 4 distinct options, unique questions, every module is covered', () => {
  const ids = new Set(COURSE_MODULES.map(m => m.id));
  assert.ok(COURSE_QUESTION_BANK.length >= 60);
  for (const q of COURSE_QUESTION_BANK) { assert.equal(q.wrong.length, 3, q.text); assert.equal(new Set([q.right, ...q.wrong]).size, 4, q.text); assert.ok(ids.has(q.module), q.module); }
  assert.equal(new Set(COURSE_QUESTION_BANK.map(q => q.text)).size, COURSE_QUESTION_BANK.length);
  for (const id of ids) assert.ok(COURSE_QUESTION_BANK.filter(q => q.module === id).length >= 3, `module ${id} has too few questions`);
});

t('quiz: 15 distinct questions touching all 13 modules; deterministic per seed; differs between seeds', () => {
  const a = makeCourseQuiz({ seed: 21 }), b = makeCourseQuiz({ seed: 21 }), c = makeCourseQuiz({ seed: 22 });
  assert.equal(a.length, COURSE_QUIZ_QUESTIONS); assert.deepEqual(a, b); assert.notDeepEqual(a.map(q => q.text), c.map(q => q.text));
  assert.equal(new Set(a.map(q => q.text)).size, a.length); assert.equal(new Set(a.map(q => q.module)).size, 13);
  for (const q of a) { assert.equal(q.options.length, 4); assert.ok(q.correct >= 0 && q.correct < 4); }
});

t('quiz stays away from facts the deck and the live app disagree on (leave quotas, account creation)', () => {
  const txt = COURSE_QUESTION_BANK.map(q => `${q.text} ${q.right}`).join(' ').toLowerCase();
  for (const bad of ['casual leave', 'earned leave', 'sick leave', 'carry forward', 'create your account', 'registration link', 'click register']) assert.ok(!txt.includes(bad), bad);
});

t('grading with the shared grader at the 90% pass mark: 14/15 passes, 13/15 fails', () => {
  const quiz = makeCourseQuiz({ seed: 5 });
  const ans = Object.fromEntries(quiz.map(q => [q.id, q.correct]));
  assert.equal(gradeOrgQuiz(quiz, ans, 90).score, 100);
  const one = { ...ans, q1: (quiz[0].correct + 1) % 4 }; assert.equal(gradeOrgQuiz(quiz, one, 90).passed, true);
  const two = { ...one, q2: (quiz[1].correct + 1) % 4 }; assert.equal(gradeOrgQuiz(quiz, two, 90).passed, false);
});

t('learner content has no answer key; C1 gate: study then quiz, server-only, between the website tour and product step', () => {
  const c = JSON.stringify(courseContent());
  assert.ok(!c.includes('"wrong"') && !c.includes('"right"') && !c.includes('"correct"'));
  assert.equal(courseContent().study_seconds, COURSE_STUDY_SECONDS);
  const g = openingGates();
  const c1 = g.find(x => x.gate_id === 'C1');
  assert.deepEqual(c1.depends_on, ['W1']); assert.deepEqual(c1.tasks.map(x => x.type), ['course_study', 'course_quiz']); assert.ok(c1.tasks.every(x => x.server_only && x.required));
  assert.equal(c1.tasks[0].target_seconds, COURSE_STUDY_SECONDS);
  assert.deepEqual(g.map(x => x.gate_id), ['W1', 'C1', 'W2', 'P1', 'D1']);
});

console.log(`\n${n} L&D course tests passed`);
