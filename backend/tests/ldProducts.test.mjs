// L&D product knowledge step (W2): content integrity and quiz generation — pure logic tests.
// Run: node backend/tests/ldProducts.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PRODUCT_SECTIONS, PRODUCT_QUESTION_BANK, makeProductQuiz, productTrainingContent, PRODUCT_QUIZ_QUESTIONS, PRODUCT_STUDY_SECONDS } from '../utils/ldProducts.js';
import { gradeOrgQuiz, openingGates } from '../utils/ldOpening.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

t('every section has an id, title, intro and points; ids are unique', () => {
  assert.ok(PRODUCT_SECTIONS.length >= 12);
  assert.equal(new Set(PRODUCT_SECTIONS.map(s => s.id)).size, PRODUCT_SECTIONS.length);
  for (const s of PRODUCT_SECTIONS) assert.ok(s.id && s.title && s.intro && s.points.length >= 3, s.id);
});

t('every referenced product photo exists in the app public folder', () => {
  const dir = new URL('../../maxvolt-hr/public/ld-products/', import.meta.url);
  let imgs = 0;
  for (const s of PRODUCT_SECTIONS) for (const m of s.images) { imgs++; assert.ok(m.caption, s.id); assert.ok(fs.existsSync(new URL(m.src.replace('/ld-products/', ''), dir)), m.src); }
  assert.ok(imgs >= 15);
});

t('question bank: 4 distinct options, right answer not repeated, every question topic has a study section', () => {
  const ids = new Set(PRODUCT_SECTIONS.map(s => s.id));
  assert.ok(PRODUCT_QUESTION_BANK.length >= 40);
  for (const q of PRODUCT_QUESTION_BANK) {
    assert.equal(q.wrong.length, 3, q.text); assert.equal(new Set([q.right, ...q.wrong]).size, 4, q.text); assert.ok(ids.has(q.topic), q.topic);
  }
  assert.equal(new Set(PRODUCT_QUESTION_BANK.map(q => q.text)).size, PRODUCT_QUESTION_BANK.length, 'no duplicate questions');
});

t('quiz: 10 distinct questions, spread over topics, deterministic for a seed, different between seeds', () => {
  const a = makeProductQuiz({ seed: 11 }), b = makeProductQuiz({ seed: 11 }), c = makeProductQuiz({ seed: 12 });
  assert.equal(a.length, PRODUCT_QUIZ_QUESTIONS);
  assert.deepEqual(a, b); assert.notDeepEqual(a.map(q => q.text), c.map(q => q.text));
  assert.equal(new Set(a.map(q => q.text)).size, a.length);
  assert.ok(new Set(a.map(q => q.topic)).size >= 8, 'questions come from many topics');
  for (const q of a) { assert.equal(q.options.length, 4); assert.ok(q.correct >= 0 && q.correct < 4); }
});

t('grading with the shared grader: all right passes at 90, one wrong of ten fails at 100 but passes at 90, two wrong fails', () => {
  const quiz = makeProductQuiz({ seed: 5 });
  const ans = Object.fromEntries(quiz.map(q => [q.id, q.correct]));
  assert.equal(gradeOrgQuiz(quiz, ans, 90).score, 100);
  const one = { ...ans, q1: (quiz[0].correct + 1) % 4 };
  assert.equal(gradeOrgQuiz(quiz, one, 90).passed, true); assert.equal(gradeOrgQuiz(quiz, one, 100).passed, false);
  const two = { ...one, q2: (quiz[1].correct + 1) % 4 };
  assert.equal(gradeOrgQuiz(quiz, two, 90).passed, false);
});

t('learner content never contains the answer key', () => {
  const c = JSON.stringify(productTrainingContent());
  assert.ok(!c.includes('"wrong"') && !c.includes('"right"') && !c.includes('correct'));
  assert.equal(productTrainingContent().study_seconds, PRODUCT_STUDY_SECONDS);
});

t('W2 gate: study then quiz, both server-only, waits for the website tour', () => {
  const w2 = openingGates().find(g => g.gate_id === 'W2');
  assert.deepEqual(w2.depends_on, ['W1']);
  assert.deepEqual(w2.tasks.map(x => x.type), ['product_study', 'product_quiz']);
  assert.ok(w2.tasks.every(x => x.server_only && x.required));
  assert.equal(w2.tasks[0].target_seconds, PRODUCT_STUDY_SECONDS);
  assert.deepEqual(openingGates().find(g => g.gate_id === 'P1').depends_on, ['W2']);
});

console.log(`\n${n} L&D product tests passed`);
