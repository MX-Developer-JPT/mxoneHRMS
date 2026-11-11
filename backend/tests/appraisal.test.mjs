// Appraisal business rules. Run: node backend/tests/appraisal.test.mjs
import assert from 'node:assert/strict';
import { DEFAULT_SCALE, DEFAULT_BANDS, DEFAULT_COMPETENCIES, DEFAULT_SETTINGS, validateScale, validateBands, validateSettings, bandFor, validateKpiWeights, scoreKpis, scoreCompetencies, combineScores, ratingGaps, deriveStatus, isPastDeadline, daysUntil, eligibleEmployees, downstreamIds, reviewAccess, maxRating } from '../utils/appraisal.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

// The example from the brief: Business Analyst template
const items = [
  { id: 'k1', title: 'Business Research', kpis: [{ id: 'p1', title: 'Research reports completed', weight: 20 }] },
  { id: 'k2', title: 'Project Management', kpis: [{ id: 'p2', title: 'Projects delivered on time', weight: 25 }] },
  { id: 'k3', title: 'Financial Planning', kpis: [{ id: 'p3', title: 'Accuracy of financial models', weight: 20 }] },
  { id: 'k4', title: 'Process Automation', kpis: [{ id: 'p4', title: 'Successful automation initiatives', weight: 20 }] },
  { id: 'k5', title: 'Reporting & Coordination', kpis: [{ id: 'p5', title: 'Timely MIS reporting', weight: 15 }] },
];

t('the brief\'s worked example scores 77/100 and lands in Meets Expectations', () => {
  const r = scoreKpis(items, { p2: 4, p1: 5, p3: 3, p4: 4, p5: 3 }, DEFAULT_SCALE);
  assert.equal(r.score, 77); assert.equal(r.complete, true);
  assert.deepEqual(r.rows.map(x => x.weighted), [20, 20, 12, 16, 9]);
  assert.equal(bandFor(77, DEFAULT_BANDS), 'Meets Expectations');
});
t('an incomplete evaluation never produces a final score', () => {
  const r = scoreKpis(items, { p1: 5, p2: 4 }, DEFAULT_SCALE); assert.equal(r.score, null); assert.equal(r.complete, false); assert.deepEqual(r.missing, ['p3', 'p4', 'p5']);
  assert.equal(scoreKpis(items, { p1: 5, p2: 4, p3: 3, p4: 9, p5: 3 }, DEFAULT_SCALE).complete, false, 'a rating outside the scale is not accepted');
});
t('KPI weightages must total exactly 100', () => {
  assert.equal(validateKpiWeights(items).ok, true);
  const bad = validateKpiWeights([{ id: 'k', kpis: [{ id: 'a', title: 'A', weight: 60 }, { id: 'b', title: 'B', weight: 30 }] }]);
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /total 90%/);
  assert.equal(validateKpiWeights([]).ok, false);
  assert.equal(validateKpiWeights([{ id: 'k', kpis: [{ id: 'a', title: 'A', weight: 100 }, { id: 'a', title: 'A2', weight: 0 }] }]).ok, false, 'duplicate ids / zero weight');
});
t('a custom rating scale (1-10) changes the maths, not the code', () => {
  const scale = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: 'L' + (i + 1) }));
  assert.equal(maxRating(scale), 10); assert.equal(scoreKpis([{ id: 'k', kpis: [{ id: 'a', title: 'A', weight: 100 }] }], { a: 8 }, scale).score, 80);
});
t('rating bands are data: boundaries, custom bands, validation', () => {
  assert.equal(bandFor(90, DEFAULT_BANDS), 'Outstanding'); assert.equal(bandFor(89.99, DEFAULT_BANDS), 'Exceeds Expectations'); assert.equal(bandFor(0, DEFAULT_BANDS), 'Unsatisfactory'); assert.equal(bandFor(39.99, DEFAULT_BANDS), 'Unsatisfactory');
  assert.equal(bandFor(70, [{ min: 0, label: 'Low' }, { min: 65, label: 'High' }]), 'High'); assert.equal(bandFor(null, DEFAULT_BANDS), null);
  assert.equal(validateBands(DEFAULT_BANDS).ok, true); assert.equal(validateBands([{ min: 50, label: 'x' }]).ok, false, 'nothing starts at 0');
  assert.equal(validateBands([{ min: 0, label: 'a' }, { min: 0, label: 'b' }]).ok, false);
});
t('competency scoring and the KPI / competency split', () => {
  const ratings = Object.fromEntries(DEFAULT_COMPETENCIES.map(c => [c.id, 4]));
  const comp = scoreCompetencies(DEFAULT_COMPETENCIES, ratings, DEFAULT_SCALE); assert.equal(comp.score, 80);
  assert.equal(combineScores({ kpi: 77, comp: 80, split: { kpi: 80, competency: 20 } }), 77.6);
  assert.equal(combineScores({ kpi: 77, comp: null, split: { kpi: 80, competency: 20 } }), null, 'competency part missing');
  assert.equal(combineScores({ kpi: 77, comp: null, split: { kpi: 100, competency: 0 } }), 77);
  const off = DEFAULT_COMPETENCIES.map((c, i) => ({ ...c, enabled: i < 2, weight: 50 })); assert.equal(scoreCompetencies(off, { c1: 5, c2: 3 }, DEFAULT_SCALE).score, 80);
  assert.equal(combineScores({ kpi: 77.123456, comp: null, split: { kpi: 100, competency: 0 }, decimals: 1 }), 77.1);
});
t('settings validation', () => {
  assert.equal(validateSettings(DEFAULT_SETTINGS).ok, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, split: { kpi: 70, competency: 20 } }).ok, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, split: { kpi: 80, competency: 20 }, competencies: DEFAULT_COMPETENCIES.map(c => ({ ...c, weight: 5 })) }).ok, false, 'competency weights must total 100');
  assert.equal(validateScale([{ value: 1, label: 'a' }]).ok, false); assert.equal(validateScale([{ value: 1, label: 'a' }, { value: 1, label: 'b' }]).ok, false);
});
t('rating gaps between self and manager are flagged for calibration', () => {
  const g = ratingGaps({ p1: 5, p2: 4, p3: 5 }, { p1: 3, p2: 4, p3: 4 }, 2); assert.deepEqual(g, [{ kpi_id: 'p1', self: 5, manager: 3, gap: 2 }]);
});
t('status is derived from the tracks, never typed in', () => {
  assert.equal(deriveStatus({}), 'not_started'); assert.equal(deriveStatus({ assigned: true }), 'self_assessment_pending'); assert.equal(deriveStatus({ assigned: true, self_status: 'draft' }), 'self_assessment_draft');
  assert.equal(deriveStatus({ assigned: true, self_status: 'submitted' }), 'manager_review_pending'); assert.equal(deriveStatus({ assigned: true, self_status: 'submitted', mgr_status: 'draft' }), 'manager_review_draft');
  assert.equal(deriveStatus({ self_status: 'submitted', mgr_status: 'submitted' }), 'meeting_pending'); assert.equal(deriveStatus({ self_status: 'submitted', mgr_status: 'submitted', meeting_status: 'scheduled' }), 'meeting_scheduled');
  assert.equal(deriveStatus({ self_status: 'submitted', mgr_status: 'submitted', meeting_status: 'completed' }), 'hr_review_pending'); assert.equal(deriveStatus({ mgr_status: 'submitted', meeting_required: false }), 'hr_review_pending');
  assert.equal(deriveStatus({ mgr_status: 'submitted', meeting_status: 'completed', hr_status: 'returned' }), 'returned_for_correction'); assert.equal(deriveStatus({ hr_status: 'approved' }), 'approved'); assert.equal(deriveStatus({ hr_status: 'published' }), 'published'); assert.equal(deriveStatus({ hr_status: 'closed' }), 'closed');
});
t('deadlines are Asia/Kolkata end-of-day', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(isPastDeadline('2026-10-31', at('2026-10-31T18:00:00Z')), false, '23:30 IST on the deadline day is still on time');   // 18:00Z = 23:30 IST
  assert.equal(isPastDeadline('2026-10-31', at('2026-10-31T19:00:00Z')), true, '00:30 IST next day is late');
  assert.equal(daysUntil('2026-11-15', at('2026-11-12T05:00:00Z')), 3); assert.equal(isPastDeadline('', Date.now()), false);
});
t('eligibility: department / designation / category lists and the joining cut-off', () => {
  const emps = [
    { user_id: 'a', department: 'Sales', designation: 'Exec', category: 'permanent', joined: '2025-01-01', status: 'active' }, { user_id: 'b', department: 'Sales', designation: 'Exec', category: 'permanent', joined: '2026-09-01', status: 'active' },
    { user_id: 'c', department: 'IT', designation: 'Dev', category: 'contract', joined: '2024-01-01', status: 'active' }, { user_id: 'd', department: 'Sales', designation: 'Exec', category: 'permanent', joined: '2024-01-01', status: 'inactive' },
  ];
  assert.deepEqual(eligibleEmployees({}, emps, '2026-09-30').map(e => e.user_id), ['a', 'b', 'c'], 'inactive excluded, empty lists mean everyone');
  assert.deepEqual(eligibleEmployees({ departments: ['sales'] }, emps, '2026-09-30').map(e => e.user_id), ['a', 'b']);
  assert.deepEqual(eligibleEmployees({ joined_on_or_before: '2026-03-31' }, emps).map(e => e.user_id), ['a', 'c']);
  assert.deepEqual(eligibleEmployees({ categories: ['contract'] }, emps).map(e => e.user_id), ['c']);
});
t('reporting hierarchy: direct and indirect reports; access rules', () => {
  const emps = [{ user_id: 'ceo' }, { user_id: 'm', manager_id: 'ceo' }, { user_id: 'e1', manager_id: 'm' }, { user_id: 'e2', manager_id: 'e1' }, { user_id: 'x', manager_id: 'ceo' }];
  const d = downstreamIds('m', emps); assert.deepEqual([...d].sort(), ['e1', 'e2']);
  const review = { user_id: 'e1', manager_id: 'm' };
  const a = (userId, role, ds) => reviewAccess({ review, userId, role, downstream: ds });
  assert.equal(a('e1', 'employee').own, true); assert.equal(a('m', 'manager', d).evaluator, true); assert.equal(a('ceo', 'manager', downstreamIds('ceo', emps)).canView, true);
  assert.equal(a('ceo', 'manager', downstreamIds('ceo', emps)).canEvaluate, false, 'only the reporting manager evaluates');
  assert.equal(a('x', 'manager', downstreamIds('x', emps)).canView, false, 'outside the hierarchy'); assert.equal(a('hr1', 'hr').canView, true);
  assert.equal(downstreamIds('e2', emps).size, 0);
});

console.log(`\n${n} appraisal rule checks passed`);
