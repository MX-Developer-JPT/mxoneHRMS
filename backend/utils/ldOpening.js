// L&D opening steps — pure logic (no database): the three steps a new joiner starts with.
//   W1  Explore the Maxvolt website for 10 minutes (time is tracked while the page is open and in focus)
//   W2  Know our products, services and segments: study the product material, then a quiz (pass mark as set in L&D settings)
//   P1  HR policies, one by one: read, then sign "I have read and acknowledged the said policy and promise to adhere to it"
//   D1  Department introduction: the department's org chart (Management = top level, their direct reports = middle level)
//       and a quiz generated from it
// Everything here is deterministic and unit-tested (backend/tests/ldOpening.test.mjs).

export const WEBSITE_URL = 'https://www.maxvoltenergy.com';
export const WEBSITE_SECONDS = 600;
export const ACK_STATEMENT = 'I have read and acknowledged the said policy and promise to adhere to it.';
export const DEFAULT_MIN_READ_SECONDS = 60;
export const ORG_VIEW_SECONDS = 120;
export const ORG_QUIZ_QUESTIONS = 10;
export const PRODUCT_STUDY_SECONDS = 480;
export const PRODUCT_QUIZ_QUESTIONS = 10;

const t = (id, title, o = {}) => ({ id, title, actor: 'employee', required: true, type: 'task', server_only: true, ...o });

// The four gates, inserted right after Pre-Joining Readiness.
export function openingGates() {
  return [
    {
      gate_id: 'W1', seq: 0.2, name: 'Explore the Maxvolt Website', owner_roles: ['hr'], required: true, depends_on: ['G00'],
      due_offset_days: 1, completion: 'auto',
      description: 'Spend 10 minutes on www.maxvoltenergy.com — products, business, story and people. The timer runs only while this page is open and in front.',
      tasks: [t('W1-1', 'Browse www.maxvoltenergy.com for 10 minutes', { type: 'timed', target_seconds: WEBSITE_SECONDS, url: WEBSITE_URL })],
    },
    {
      gate_id: 'W2', seq: 0.3, name: 'Know Our Products, Services and Segments', owner_roles: ['hr'], required: true, depends_on: ['W1'],
      due_offset_days: 1, completion: 'auto',
      description: 'What Maxvolt makes and who it serves: e-mobility batteries, inverter batteries and smart inverters, solar and rack-type storage, custom packs, services, ReEarth recycling. Study the material, then pass a short quiz.',
      tasks: [
        t('W2-1', 'Study our products, services and segments', { type: 'product_study', target_seconds: PRODUCT_STUDY_SECONDS }),
        t('W2-2', 'Product knowledge quiz — pass mark as set in L&D settings', { type: 'product_quiz' }),
      ],
    },
    {
      gate_id: 'P1', seq: 0.4, name: 'HR Policies — Read and Acknowledge', owner_roles: ['hr'], required: true, depends_on: ['W2'],
      due_offset_days: 2, completion: 'auto', dynamic: 'policies',
      description: 'Each policy opens one at a time. Read it, then sign the acknowledgement. Your signed acknowledgement is stored permanently.',
      tasks: [],
    },
    {
      gate_id: 'D1', seq: 0.6, name: 'Department Introduction — Org Chart', owner_roles: ['hod'], required: true, depends_on: ['P1'],
      due_offset_days: 3, completion: 'auto',
      description: 'Meet your department: the people, their designations and who reports to whom — especially the top-level (Management) and middle-level leaders. Then answer a short quiz on the org chart.',
      tasks: [
        t('D1-1', 'Study your department org chart', { type: 'org_view', target_seconds: ORG_VIEW_SECONDS }),
        t('D1-2', 'Org chart quiz — pass mark as set in L&D settings', { type: 'org_quiz' }),
      ],
    },
  ];
}

// Add (or refresh) the opening gates in a template's gate list and re-point the first learning gate at them.
export function withOpeningGates(gates) {
  const ids = new Set(['W1', 'W2', 'P1', 'D1']);
  const base = gates.filter(g => !ids.has(g.gate_id)).map(g => JSON.parse(JSON.stringify(g)));
  const first = base.find(g => g.gate_id === 'G01');
  if (first) first.depends_on = ['D1'];
  const out = [];
  for (const g of base) { out.push(g); if (g.gate_id === 'G00') out.push(...openingGates()); }
  if (!out.some(g => g.gate_id === 'W1')) out.unshift(...openingGates());   // no G00 in a custom template
  return out;
}

// ── tracked time (website tour, org chart reading) ───────────────────────
// A heartbeat adds the REAL time since the previous heartbeat (capped), only while the page was visible and focused,
// so several open tabs or a scripted burst of heartbeats can never add more than the wall-clock time that passed.
export function addWatchTime(task, nowMs, visible, { maxStep = 30 } = {}) {
  const w = task.watch || { sec: 0, last_beat_ms: null };
  if (w.last_beat_ms && visible) {
    const delta = (nowMs - w.last_beat_ms) / 1000;
    if (delta > 0) w.sec = Math.round((w.sec + Math.min(delta, maxStep)) * 10) / 10;
  }
  w.last_beat_ms = nowMs;
  task.watch = w;
  return { seconds: w.sec, done: w.sec >= (task.target_seconds || 0) };
}

// ── policies ─────────────────────────────────────────────────────────────
// Which company policies are part of the induction, in order. A policy is in when it is active and not switched off for induction.
export const isPdfUrl = (u) => /\.pdf(\?|#|$)/i.test(String(u || ''));
export function inductionPolicies(policies) {
  return policies
    .filter(p => p && p.is_active !== false && p.induction_required !== false && isPdfUrl(p.file_url))
    .sort((a, b) => (Number(a.induction_order) || 9999) - (Number(b.induction_order) || 9999) || String(a.title).localeCompare(String(b.title)));
}
export function policyTask(p, gateId = 'P1') {
  return {
    id: `${gateId}-${String(p.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`, title: p.title, actor: 'employee', required: true, type: 'policy_ack', server_only: true,
    policy_id: p.id, file_url: p.file_url, category: p.category || '', version: p.version || p.updated_at || p.created_at || '', min_read_seconds: Number(p.min_read_seconds) || DEFAULT_MIN_READ_SECONDS,
    done: false, done_at: null, done_by: null, evidence: '',
  };
}
// Bring a gate's policy tasks in line with the current policy list without touching the ones already signed.
export function syncPolicyTasks(tasks, policies) {
  const want = inductionPolicies(policies);
  const have = new Map(tasks.filter(x => x.policy_id).map(x => [x.policy_id, x]));
  const out = [];
  for (const p of want) {
    const cur = have.get(p.id);
    if (cur) { if (!cur.done) Object.assign(cur, { title: p.title, file_url: p.file_url, min_read_seconds: Number(p.min_read_seconds) || DEFAULT_MIN_READ_SECONDS }); out.push(cur); }
    else out.push(policyTask(p));
  }
  for (const x of tasks) if (x.policy_id && x.done && !want.some(p => p.id === x.policy_id)) out.push(x);   // keep signed ones even if the policy was later withdrawn
  return out.sort((a, b) => {
    const ia = want.findIndex(p => p.id === a.policy_id), ib = want.findIndex(p => p.id === b.policy_id);
    return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
  });
}
// Policies open one by one: a task is open only when every earlier policy task is signed.
export function policyStates(tasks) {
  let blocked = false;
  return tasks.map(x => {
    const state = x.done ? 'signed' : blocked ? 'locked' : 'open';
    if (!x.done) blocked = true;
    return { ...x, state };
  });
}

const norm = (s) => String(s || '').toLowerCase().replace(/[.,_'’`"-]/g, ' ').replace(/\s+/g, ' ').trim();
// The typed signature must be the employee's own name (a missing middle name is fine).
export function namesMatch(typed, full) {
  const a = norm(typed).split(' ').filter(Boolean), b = norm(full).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  if (b.length === 1) return false;
  return a.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

// ── org chart ────────────────────────────────────────────────────────────
const isMgmt = (e) => /^management$/i.test(String(e.department || '').trim());
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');
export function tenureText(doj, today) {
  if (!doj) return '';
  const days = Math.max(0, Math.round((new Date(today + 'T00:00:00Z') - new Date(doj + 'T00:00:00Z')) / 86400000));
  if (days < 31) return days <= 1 ? 'Joined today' : `${days} days`;
  const m = Math.floor(days / 30.4375);
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`;
  const y = Math.floor(m / 12), r = m % 12;
  return `${y} yr${y === 1 ? '' : 's'}${r ? ` ${r} mo` : ''}`;
}
const card = (e, level, today, extra = {}) => ({
  user_id: e.user_id, name: e.display_name || e.full_name || '', code: e.employee_code || '', designation: e.designation || '', department: e.department || '',
  doj: dayOf(e.date_of_joining), tenure: tenureText(dayOf(e.date_of_joining), today), location: e.work_location || '', email: e.official_email || '', photo: e.profile_picture_url || '',
  level, reports_to_id: e.reporting_manager_id && e.reporting_manager_id !== e.user_id ? e.reporting_manager_id : '', ...extra,
});

// emps: active employees. Top level = the Management department; middle level = the department's people who report to Management;
// team = everyone else in the department. For the Management department itself: top = Management, middle = their direct reports.
export function buildDeptOrg(department, emps, { viewerUid = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const dep = String(department || '').trim();
  const byId = Object.fromEntries(emps.map(e => [e.user_id, e]));
  const mgmt = emps.filter(isMgmt);
  const mgmtIds = new Set(mgmt.map(e => e.user_id));
  const inDept = (e) => String(e.department || '').trim().toLowerCase() === dep.toLowerCase();
  const sortPeople = (a, b) => (Number(b.tierRank) || 0) - (Number(a.tierRank) || 0) || String(a.doj).localeCompare(String(b.doj)) || a.name.localeCompare(b.name);
  const RANK = { director: 7, general_manager: 6, manager: 5, territory_manager: 4, senior_executive: 3, executive: 2, trainee: 1, intern: 0 };
  const rank = (e) => RANK[e.designation_tier] ?? 2;
  const mk = (e, level, extra) => ({ ...card(e, level, today, extra), tierRank: rank(e), is_you: e.user_id === viewerUid });

  let top = [], middle = [], team = [];
  if (isMgmt({ department: dep })) {
    top = mgmt.map(e => mk(e, 'top'));
    const reports = emps.filter(e => !isMgmt(e) && mgmtIds.has(e.reporting_manager_id));
    middle = reports.map(e => mk(e, 'middle'));
  } else {
    const members = emps.filter(e => inDept(e) && !isMgmt(e));
    const mid = members.filter(e => mgmtIds.has(e.reporting_manager_id));
    let middleSet = mid;
    if (!middleSet.length) {            // no one reports to Management directly: use the department's entry points (manager outside the department), else the most senior
      middleSet = members.filter(e => !byId[e.reporting_manager_id] || !inDept(byId[e.reporting_manager_id]));
      if (!middleSet.length && members.length) { const best = Math.max(...members.map(rank)); middleSet = members.filter(e => rank(e) === best); }
    }
    const midIds = new Set(middleSet.map(e => e.user_id));
    middle = middleSet.map(e => mk(e, 'middle'));
    team = members.filter(e => !midIds.has(e.user_id)).map(e => mk(e, 'team'));
    // top level shown = the Management leaders the middle level reports to (all of Management if none is found)
    const topIds = [...new Set(middleSet.map(e => e.reporting_manager_id).filter(id => mgmtIds.has(id)))];
    const topEmps = topIds.length ? topIds.map(id => byId[id]) : mgmt;
    top = topEmps.map(e => mk(e, 'top'));
  }
  top.sort(sortPeople); middle.sort(sortPeople); team.sort(sortPeople);

  // tree: top -> middle -> team (a team member hangs under their manager when that manager is in the department)
  const nodes = {};
  for (const n of [...top, ...middle, ...team]) nodes[n.user_id] = { ...n, children: [] };
  const roots = [], orphans = [];
  for (const n of top) roots.push(nodes[n.user_id]);
  for (const n of middle) { const p = nodes[n.reports_to_id]; (p && p.level === 'top' ? p.children : orphans).push(nodes[n.user_id]); }
  for (const n of team) { const p = nodes[n.reports_to_id]; (p && p.user_id !== n.user_id ? p.children : orphans).push(nodes[n.user_id]); }
  const attach = orphans.filter(o => o.level === 'team');
  const strayMiddle = orphans.filter(o => o.level === 'middle');
  for (const m of strayMiddle) roots.push(m);
  const loose = attach.filter(o => !roots.some(r => r.user_id === o.user_id));
  const direct = (id) => [...top, ...middle, ...team].filter(x => x.reports_to_id === id).length;
  const strip = (n) => { const { tierRank, ...rest } = n; return rest; };
  const reportsToName = (n) => (byId[n.reports_to_id] ? `${byId[n.reports_to_id].display_name} — ${byId[n.reports_to_id].designation}` : '');
  const clean = (n) => ({ ...strip(n), direct_reports: direct(n.user_id), reports_to: reportsToName(n), children: (n.children || []).sort(sortPeople).map(clean) });
  const flat = [...top, ...middle, ...team].map(n => ({ ...strip(n), direct_reports: direct(n.user_id), reports_to: reportsToName(n) }));
  return {
    department: dep, scope: isMgmt({ department: dep }) ? 'management' : 'department',
    counts: { top: top.length, middle: middle.length, team: team.length, total: top.length + middle.length + team.length },
    top: flat.filter(x => x.level === 'top'), middle: flat.filter(x => x.level === 'middle'), team: flat.filter(x => x.level === 'team'),
    tree: roots.map(clean), loose: loose.map(clean),
    leadership: mgmt.map(e => ({ user_id: e.user_id, name: e.display_name || '', designation: e.designation || '', photo: e.profile_picture_url || '' })),
  };
}

// ── org chart quiz ───────────────────────────────────────────────────────
export function seededRng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (arr, rng) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// Build up to n multiple-choice questions from a department org chart, weighted towards the top and middle levels.
// Returns [{ id, level, text, options[], correct }] — `correct` is the index of the right option (kept server-side).
export function makeOrgQuiz(org, { n = ORG_QUIZ_QUESTIONS, seed = Date.now() } = {}) {
  const rng = seededRng(seed);
  const all = [...org.top, ...org.middle, ...org.team];
  const byId = Object.fromEntries(all.map(p => [p.user_id, p]));
  const name = (p) => p.name;
  const leaders = org.leadership.length ? org.leadership : org.top;
  const dept = org.department;
  const qs = [];
  // wrong answers come from `pool` first (same kind of thing), then from `fallback` if the pool is too small
  const add = (level, text, correct, pool, k = 3, fallback = []) => {
    let wrong = shuffle(uniq(pool).filter(x => x !== correct), rng).slice(0, k);
    if (wrong.length < k) wrong = [...wrong, ...shuffle(uniq(fallback).filter(x => x !== correct && !wrong.includes(x)), rng)].slice(0, k);
    if (!correct || wrong.length < 2) return false;
    const options = shuffle([correct, ...wrong], rng);
    if (qs.some(q => q.text === text)) return false;
    qs.push({ id: `q${qs.length + 1}`, level, text, options, correct: options.indexOf(correct) });
    return true;
  };
  const pick = (a) => (a.length ? a[Math.floor(rng() * a.length)] : null);
  const leaderDesig = uniq(leaders.map(l => l.designation));
  const deptDesig = uniq(all.filter(p => p.level !== 'top').map(p => p.designation));
  const designations = uniq([...deptDesig, ...leaderDesig]);
  const people = uniq(all.map(name));

  // ── top level (Management) ──
  const tp = pick(org.top);
  if (tp && org.scope === 'department') add('top', `Which Management (top-level) leader does the ${dept} department report to?`, name(tp), leaders.map(name));
  const t2 = pick(org.top.length > 1 ? org.top.filter(x => x !== tp) : org.top) || tp;
  if (t2) add('top', `What is ${name(t2)}'s designation?`, t2.designation, leaderDesig, 3, deptDesig);
  const l3 = pick(leaders);
  if (l3) add('top', `Who is the ${l3.designation} of Maxvolt?`, l3.name, leaders.map(l => l.name));
  const nonTop = all.filter(p => p.level !== 'top');
  if (leaders.length >= 3 && nonTop.length) add('top', `Which of these is NOT part of the Management (top-level) team?`, name(pick(nonTop)), leaders.map(l => l.name), 3);
  // ── middle level ──
  const mids = shuffle(org.middle, rng);
  const m1 = mids[0];
  if (m1) add('middle', `Who among these is a middle-level leader in ${dept} (reports directly to Management)?`, name(m1), [...org.team.map(name), ...leaders.map(l => l.name)]);
  if (mids[0]) add('middle', `What is ${name(mids[0])}'s designation?`, mids[0].designation, deptDesig, 3, leaderDesig);
  if (mids[1] || mids[0]) { const m = mids[1] || mids[0]; const boss = byId[m.reports_to_id] || leaders.find(l => l.user_id === m.reports_to_id); if (boss) add('middle', `Who does ${name(m)} report to?`, boss.name, leaders.map(l => l.name)); }
  const withTeam = org.middle.map(m => ({ m, kids: all.filter(p => p.reports_to_id === m.user_id && p.level === 'team') })).filter(x => x.kids.length);
  if (withTeam.length) { const x = pick(withTeam); const kid = pick(x.kids); add('middle', `Who among these reports to ${name(x.m)}?`, name(kid), people.filter(nm => nm !== name(kid) && !x.kids.some(k => name(k) === nm))); }
  // ── team level ──
  const tm = pick(org.team);
  if (tm) { const boss = byId[tm.reports_to_id]; if (boss) add('team', `Who does ${name(tm)} report to?`, name(boss), uniq([...org.middle.map(name), ...org.team.map(name)])); }
  const sample = shuffle(all.filter(p => p.doj), rng).slice(0, 4);
  if (sample.length === 4 && uniq(sample.map(p => p.doj)).length === 4) {
    const latest = [...sample].sort((a, b) => b.doj.localeCompare(a.doj))[0];
    add('team', `Who joined most recently among these colleagues?`, name(latest), sample.map(name), 3);
  }
  if (all.length >= 4) { const p = pick(all.filter(x => x.level !== 'top')); if (p) add('team', `What is ${name(p)}'s designation?`, p.designation, deptDesig, 3, leaderDesig); }
  if (org.counts.total >= 4 && org.scope === 'department') { const c = org.counts.middle + org.counts.team; add('team', `How many people work in the ${dept} department (excluding Management)?`, String(c), [String(c + 1), String(Math.max(1, c - 1)), String(c + 2), String(Math.max(1, c - 2))]); }
  // top up to n with extra "designation of" / "reports to" questions at the weighted levels
  let guard = 0;
  while (qs.length < n && guard++ < 60) {
    const p = pick([...org.middle, ...org.middle, ...org.top, ...org.team]);
    if (!p) break;
    if (rng() < 0.5) add(p.level, `What is ${name(p)}'s designation?`, p.designation, p.level === 'top' ? leaderDesig : deptDesig, 3, p.level === 'top' ? deptDesig : leaderDesig);
    else { const boss = byId[p.reports_to_id] || leaders.find(l => l.user_id === p.reports_to_id); if (boss && p.level !== 'top') add(p.level, `Who does ${name(p)} report to?`, boss.name, uniq([...leaders.map(l => l.name), ...org.middle.map(name)])); }
  }
  return qs.slice(0, n).map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

export function gradeOrgQuiz(quiz, answers, passScore = 90) {
  const results = quiz.map(q => { const a = answers?.[q.id]; return { id: q.id, level: q.level, picked: a ?? null, correct_index: q.correct, ok: Number(a) === q.correct, correct_text: q.options[q.correct] }; });
  const right = results.filter(r => r.ok).length;
  const score = quiz.length ? Math.floor((right / quiz.length) * 1000) / 10 : 0;
  return { score, passed: quiz.length > 0 && (right / quiz.length) * 100 >= passScore, right, total: quiz.length, results };
}
