// Assessment engine helpers for the L&D module — pure functions (no database), so they can be tested alone.
//
// Policy implemented here (see "L&D Module Scope Document", section 3):
//   • each attempt serves a different random selection from a larger question pool (unseen questions first,
//     spread across topic blocks, with a share of critical questions always included);
//   • the options of a question are shuffled per attempt;
//   • partially correct multi-select answers are wrong;
//   • pass = score >= pass mark (compared on the exact value, never on a rounded one) AND — when the critical
//     rule is on — every served critical question answered correctly.

export const DEFAULT_TOPICS = [
  { key: 'A', label: 'Company, vision, values, leadership, structure', min: 20 },
  { key: 'B', label: 'HR policies — attendance, leave, hours, code of conduct, POSH, grievance', min: 30 },
  { key: 'C', label: 'Health, safety, environment and emergency response', min: 30 },
  { key: 'D', label: 'Quality, products and processes', min: 20 },
  { key: 'E', label: 'Information security, IT usage and Maxvolt One how-to', min: 20 },
  { key: 'F', label: 'Department- and role-specific content', min: 20 },
];

const norm = (s) => String(s ?? '').trim().toLowerCase();
export const shuffle = (arr, rnd = Math.random) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function scoreQuestion(q, ans) {
  if (q.type === 'multi') {
    const a = Array.isArray(ans) ? ans.map(Number).sort((x, y) => x - y) : [];
    const c = [...q.correct].map(Number).sort((x, y) => x - y);
    return a.length === c.length && a.every((v, i) => v === c[i]); // "nearly right" is wrong
  }
  if (q.type === 'short') return norm(ans).length > 0 && (q.accepted || []).some(x => norm(x) && norm(ans).includes(norm(x)));
  const a = Array.isArray(ans) ? Number(ans[0]) : Number(ans);
  return Number.isFinite(a) && q.correct.map(Number).includes(a);
}

/**
 * Choose the questions for one attempt.
 * @param questions  the whole pool
 * @param perAttempt how many to serve (0 / >= pool size = all)
 * @param seenCounts { questionId: timesServedBefore } for this person and assessment
 */
export function drawQuestions(questions, perAttempt, seenCounts = {}, rnd = Math.random) {
  const n = Number(perAttempt) || 0;
  if (!n || n >= questions.length) return shuffle(questions.map(q => q.id), rnd);
  const byFreshness = (list) => shuffle(list, rnd).sort((a, b) => (seenCounts[a.id] || 0) - (seenCounts[b.id] || 0));
  const critical = byFreshness(questions.filter(q => q.critical));
  const normal = questions.filter(q => !q.critical);
  const picked = critical.slice(0, Math.min(critical.length, Math.ceil(n / 4)));
  // spread the rest across topic blocks (round-robin), least-seen first inside each block
  const groups = {};
  for (const q of [...normal, ...critical.slice(picked.length)]) (groups[q.topic || '_'] ||= []).push(q);
  const queues = Object.values(groups).map(byFreshness);
  const order = shuffle(queues, rnd);
  while (picked.length < n && order.some(g => g.length)) for (const g of order) { if (picked.length >= n) break; if (g.length) picked.push(g.shift()); }
  return shuffle(picked.map(q => q.id), rnd);
}

/** Per-question option order for this attempt (identity for true/false and short answers). */
export function makeOptionOrders(questions, order, doShuffle, rnd = Math.random) {
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  const out = {};
  for (const id of order) {
    const q = byId[id];
    if (!q || !q.options?.length) continue;
    const idx = q.options.map((_, i) => i);
    out[id] = doShuffle && (q.type === 'mcq' || q.type === 'multi') ? shuffle(idx, rnd) : idx;
  }
  return out;
}

/** What the learner sees (no answer key). */
export function publicQuestions(questions, order, optOrders = {}) {
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  return order.map(id => byId[id]).filter(Boolean).map(q => {
    const perm = optOrders[q.id] || (q.options || []).map((_, i) => i);
    return { id: q.id, type: q.type, text: q.text, options: perm.map(i => q.options[i]), points: q.points || 1, scenario: !!q.scenario, critical: !!q.critical, topic: q.topic || '' };
  });
}

/** Learner answers refer to the shuffled display; convert them back to the original option numbers. */
export function unmapAnswers(answers, optOrders = {}) {
  const out = {};
  for (const [id, v] of Object.entries(answers || {})) {
    const perm = optOrders[id];
    if (!perm) { out[id] = v; continue; }
    if (Array.isArray(v)) out[id] = v.map(i => perm[Number(i)]).filter(i => i !== undefined);
    else if (v === undefined || v === null || v === '') out[id] = v;
    else out[id] = perm[Number(v)];
  }
  return out;
}

/**
 * Grade an attempt on the questions that were actually served.
 * `answers` use the ORIGINAL option numbers (call unmapAnswers first).
 */
export function gradeAttempt(questions, order, answers, { passScore, criticalRule = true }) {
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  let got = 0, total = 0;
  const results = [], gaps = [], topicStats = {};
  let criticalFailed = 0;
  for (const id of order) {
    const q = byId[id];
    if (!q) continue;
    const pts = q.points || 1;
    total += pts;
    const right = scoreQuestion(q, answers?.[id]);
    if (right) got += pts; else { gaps.push(q.text); if (q.critical) criticalFailed++; }
    results.push({ id, correct: right, topic: q.topic || '', critical: !!q.critical });
    const t = (topicStats[q.topic || 'General'] ||= { topic: q.topic || 'General', total: 0, correct: 0 });
    t.total++; if (right) t.correct++;
  }
  const exact = total ? (got / total) * 100 : 0;
  const scoreOk = exact + 1e-9 >= passScore;
  const passed = scoreOk && !(criticalRule && criticalFailed > 0);
  const weakTopics = Object.values(topicStats).filter(t => t.correct < t.total).map(t => ({ ...t, pct: Math.round((t.correct / t.total) * 100) })).sort((a, b) => a.pct - b.pct);
  return {
    score: Math.floor(exact * 10) / 10, // never round UP across the pass mark (89.96 must show as 89.9, not 90)
    exact, passed, scoreOk, criticalFailed, gaps, results, weakTopics, got, total,
  };
}
