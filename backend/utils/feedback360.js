// 360° feedback — pure rules (no database). Validation of a submission, review periods, and how ratings are summarised and
// protected. Unit-tested in backend/tests/feedback360.test.mjs.
//
// Anonymity rules (the promise the screen makes to reviewers):
//   • nobody — not the person rated, not their manager, not HR / admin — ever sees WHO gave a rating;
//   • the person rated (and their manager) sees results only once at least MIN_RATERS people other than themself have rated them;
//   • HR / admin see every rating of every employee (that is their job) but flagged "low sample" when fewer than MIN_RATERS rated.

export const COMPETENCIES = [
  { key: 'communication', label: 'Communication' },
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'technical', label: 'Technical Skills' },
  { key: 'leadership', label: 'Leadership' },
  { key: 'reliability', label: 'Reliability' },
];
export const RELATIONSHIPS = ['self', 'manager', 'peer', 'direct_report'];
export const OTHERS = ['manager', 'peer', 'direct_report'];
export const MIN_RATERS = 3;
export const MAX_TEXT = 1000;
export const LEGACY_PERIOD = 'current';          // rows saved before review periods existed

const IST_MS = 5.5 * 3600000;
// Half-year review periods: 2026-H1 (Jan–Jun) and 2026-H2 (Jul–Dec), in IST.
export function currentPeriod(now = new Date()) {
  const d = new Date(now.getTime() + IST_MS);
  return `${d.getUTCFullYear()}-H${d.getUTCMonth() < 6 ? 1 : 2}`;
}
export const normalizePeriod = (p, now = new Date()) => (!p || p === LEGACY_PERIOD ? currentPeriod(now) : String(p).trim().slice(0, 12));
export const periodLabel = (p) => (p === LEGACY_PERIOD ? 'Earlier feedback' : /^(\d{4})-H([12])$/.test(p) ? `${p.slice(0, 4)} · ${p.endsWith('H1') ? 'Jan–Jun' : 'Jul–Dec'}` : p);

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (a) => (a.length ? round1(a.reduce((x, y) => x + y, 0) / a.length) : null);
const clip = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

// Checks one submission and returns the cleaned row, or the first problem in plain words.
export function validateSubmission({ reviewerId, subjectId, relationship, answers }) {
  if (!reviewerId) return { ok: false, error: 'Please sign in again.' };
  if (!subjectId) return { ok: false, error: 'Please select a colleague.' };
  if (!RELATIONSHIPS.includes(relationship)) return { ok: false, error: 'Please select your relationship to this colleague.' };
  if (relationship === 'self' && subjectId !== reviewerId) return { ok: false, error: 'A self-assessment can only be about yourself.' };
  if (relationship !== 'self' && subjectId === reviewerId) return { ok: false, error: 'You cannot rate yourself as a peer, manager or report — use "Self-assessment" instead.' };
  const a = answers || {};
  const clean = {};
  for (const c of COMPETENCIES) {
    const v = Number(a[c.key]);
    if (!Number.isInteger(v) || v < 1 || v > 5) return { ok: false, error: `Please rate ${c.label} from 1 to 5.` };
    clean[c.key] = v;
  }
  for (const k of ['strengths', 'improvements', 'comments']) clean[k] = clip(a[k]);
  return { ok: true, clean };
}

// Ratings of the 5 competencies → averages and an overall score (mean of the competency averages).
export function scoreOf(rows) {
  const scores = {};
  for (const c of COMPETENCIES) scores[c.key] = avg(rows.map(r => Number(r.answers?.[c.key])).filter(Number.isFinite));
  const vals = Object.values(scores).filter(v => v != null);
  return { scores, overall: vals.length ? avg(vals) : null };
}

// Everything the screen needs for ONE person in ONE period. `rows` are that person's Feedback360 rows for the period.
// privileged = HR / admin (see everything); otherwise results stay hidden until MIN_RATERS others have rated.
export function summarize(rows, { privileged = false, minRaters = MIN_RATERS } = {}) {
  const selfRows = rows.filter(r => r.relationship === 'self');
  const others = rows.filter(r => r.relationship !== 'self');
  const out = { reviewers: others.length, min_raters: minRaters, self: null, hidden: false, low_sample: false };
  if (selfRows.length) { const s = scoreOf(selfRows); out.self = { ...s, strengths: selfRows[0].answers?.strengths || '', improvements: selfRows[0].answers?.improvements || '', comments: selfRows[0].answers?.comments || '' }; }
  if (others.length < minRaters) {
    if (!privileged) return { ...out, hidden: true, needed: minRaters - others.length, aggregate: null, overall: null, by_relationship: {}, comments: [], gap: null };
    out.low_sample = true;
  }
  const all = scoreOf(others);
  out.aggregate = others.length ? all.scores : null;
  out.overall = others.length ? all.overall : null;
  out.by_relationship = {};
  for (const rel of OTHERS) {
    const g = others.filter(r => r.relationship === rel);
    // a group is shown when it is big enough to stay anonymous; the manager is a single, known person, so always shown
    if (g.length && (privileged || rel === 'manager' || g.length >= minRaters)) out.by_relationship[rel] = { count: g.length, ...scoreOf(g) };
  }
  // comments carry no reviewer and no time, only the relationship; sorted by text so the order tells nothing
  out.comments = others
    .map(r => ({ relationship: r.relationship, strengths: r.answers?.strengths || '', improvements: r.answers?.improvements || '', comment: r.answers?.comments || '' }))
    .filter(c => c.strengths || c.improvements || c.comment)
    .sort((a, b) => `${a.strengths}${a.improvements}${a.comment}`.localeCompare(`${b.strengths}${b.improvements}${b.comment}`));
  out.gap = out.self && out.aggregate ? Object.fromEntries(COMPETENCIES.map(c => [c.key, out.self.scores[c.key] != null && out.aggregate[c.key] != null ? round1(out.self.scores[c.key] - out.aggregate[c.key]) : null])) : null;
  return out;
}

// Distinct periods present in a person's rows, newest first (legacy rows last).
export function periodsOf(rows) {
  return [...new Set(rows.map(r => r.period || LEGACY_PERIOD))].sort((a, b) => (a === LEGACY_PERIOD) - (b === LEGACY_PERIOD) || b.localeCompare(a));
}

// Upsert key: one rating per reviewer, subject and period — a second submission edits the first.
export const submissionKey = (r) => `${r.reviewer_user_id}|${r.subject_user_id}|${r.period}`;
