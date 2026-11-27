// MRF recruitment MIS: funnel, stages, SLA, bottlenecks, filters, KPIs and export. Run: node backend/tests/mrfMis.test.mjs
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { computeMrfMis, candidateJourney, financialYear, CANDIDATE_STAGES } from '../utils/mrfMis.js';
import { buildMrfMisWorkbook } from '../utils/mrfMisExport.js';
import { samePersonOnRequisition } from '../utils/hiringLifecycle.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const at = (d) => `2026-11-${String(d).padStart(2, '0')}T06:00:00.000Z`;
const move = (to, d) => ({ type: 'status', to, at: at(d) });
const reqs = [
  { id: 'r1', mrf_version: 2, requisition_id: 'MRF-2026-0001', status: 'published', department: 'Sales', designation: 'Executive', position_tier: 'executive', number_of_positions: 2, positions_filled: 1, hiring_manager_id: 'hm', requested_by: 'maker', budget_status: 'budgeted', requisition_type: 'new_position', exp_min_years: 1, exp_max_years: 3, ctc_min: 400000, ctc_max: 600000, submitted_at: at(1), hm_approved_at: at(2), published_date: at(3), target_hire_date: '2026-12-10', audit: [{ at: at(1), action: 'created' }] },
  { id: 'r2', mrf_version: 2, requisition_id: 'MRF-2026-0002', status: 'pending_hm_approval', department: 'Quality', designation: 'Engineer', number_of_positions: 1, hiring_manager_id: 'hm2', submitted_at: at(20), target_hire_date: '2026-11-25', audit: [] },
  { id: 'r3', mrf_version: 2, requisition_id: 'MRF-2026-0003', status: 'draft', department: 'Sales', designation: 'Manager', number_of_positions: 1, requisition_date: '2026-11-26', audit: [] },
  { id: 'old', position_title: 'Older role', department: 'Sales', status: 'closed', number_of_positions: 1, created_at: '2025-02-10T00:00:00.000Z', closed_date: '2025-03-01' },
];
const cands = [
  { id: 'c1', requisition_id: 'r1', full_name: 'Joined Person', email: 'a@x.in', status: 'joined', applied_date: at(4), offer_letter_date: at(12), offer_status: 'accepted', offer_accepted_at: at(13),
    timeline: [move('applied', 4), move('shortlisted', 5), move('cv_sent', 6), move('interview_recommended', 7), move('interview_scheduled', 8), move('interviewed', 9), move('selected', 10), move('offered', 12), move('offer_accepted', 13), move('joined', 20)] },
  { id: 'c2', requisition_id: 'r1', full_name: 'Waiting Review', email: 'b@x.in', status: 'cv_sent', applied_date: at(4), timeline: [move('applied', 4), move('shortlisted', 5), move('cv_sent', 6)] },
  { id: 'c3', job_id: 'r1', full_name: 'Rejected After Interview', email: 'c@x.in', status: 'rejected', applied_date: at(5), timeline: [move('shortlisted', 6), move('cv_sent', 6), move('interview_scheduled', 8), move('interviewed', 9), move('rejected', 10)] },
  { id: 'c4', requisition_id: 'r1', full_name: 'Fresh', email: 'd@x.in', status: 'applied', applied_date: at(25) },
  { id: 'c4b', requisition_id: 'r1', full_name: 'Fresh again', email: 'D@x.in', status: 'applied', applied_date: at(26) },
  { id: 'c5', full_name: 'Nobody', status: 'applied', applied_date: at(2) },
];
const batches = [{ id: 'b1', requisition_id: 'r1', created_by: 'rec', sent_at: at(6), candidates: [{ candidate_id: 'c1', decisions: { hiring_manager: { decision: 'shortlist', at: at(7) } } }, { candidate_id: 'c2', decisions: {} }, { candidate_id: 'c3', decisions: { hiring_manager: { decision: 'shortlist', at: at(7) } } }] }];
const interviews = [
  { id: 'i1', candidate_id: 'c1', status: 'completed', created_at_iso: at(8), completed_at: at(9), scheduled_date: '2026-11-09T11:00' },
  { id: 'i2', candidate_id: 'c3', status: 'completed', created_at_iso: at(8), completed_at: at(9), scheduled_date: '2026-11-09T12:00' },
];
const D = { reqs, cands, batches, interviews, emps: [{ user_id: 'hm', display_name: 'Hari' }, { user_id: 'rec', display_name: 'Ritu' }] };
const now = Date.parse(at(27));
const run = (filters = {}, extra = {}) => computeMrfMis(D, { filters, now, masters: { budget_status: [{ value: 'budgeted', label: 'Budgeted' }] }, ...extra });
const kpi = (m, key) => m.kpis.find((k) => k.key === key);

await t('a candidate counts in every stage up to the furthest one, with first timestamps', () => {
  const j = candidateJourney(cands[2], batches, interviews);
  assert.equal(CANDIDATE_STAGES[j.reached][0], 'interview_completed'); assert.equal(j.active, false); assert.equal(j.at[2], at(6));
});
const m = run();
const r1 = m.mrfs.find((r) => r.id === 'r1');
await t('the matrix row counts transactions, once per person', () => {
  assert.deepEqual([r1.total_cvs, r1.shortlisted, r1.sent_for_review, r1.hm_approved, r1.interviews_scheduled, r1.interviews_completed, r1.selected, r1.offers_released, r1.offers_accepted, r1.joined], [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual([r1.positions, r1.filled, r1.remaining, r1.fulfilment_pct], [2, 1, 1, 50]);
  assert.equal(r1.recruiter, 'Ritu'); assert.equal(r1.hiring_manager, 'Hari'); assert.equal(r1.ctc_label, '₹4 LPA – ₹6 LPA'); assert.equal(r1.experience, '1–3 years'); assert.equal(r1.budget_label, 'Budgeted');
  assert.equal(r1.days_elapsed, 26); assert.equal(r1.days_remaining, 13); assert.equal(r1.stage, 'sent_for_review');
  assert.equal(m.data_quality.duplicates.length, 1); assert.equal(m.data_quality.unlinked_count, 1);
});
await t('funnel conversion, drop-off, stage time and fulfilment', () => {
  const s = Object.fromEntries(r1.funnel.map((x) => [x.key, x]));
  assert.equal(s.applications.conversion_pct, 100); assert.equal(s.shortlisted.conversion_pct, 75); assert.equal(s.shortlisted.dropoff_pct, 25);
  assert.equal(s.hm_approved.conversion_pct, 66.7); assert.equal(s.joined.count, 1); assert.equal(s.shortlisted.avg_days, 1);
  assert.equal(s.sent_for_review.waiting, 1);
  for (let i = 1; i < r1.funnel.length; i++) assert.ok(r1.funnel[i].count <= r1.funnel[i - 1].count, 'the funnel only narrows');
});
await t('milestones are timestamped', () => {
  const ms = Object.fromEntries(r1.milestones.map((x) => [x.key, x.at]));
  assert.equal(r1.milestones.length, 17); assert.equal(ms.submitted, at(1)); assert.equal(ms.published, at(3)); assert.equal(ms.joined, at(20)); assert.equal(ms.closed, '');
});
await t('bottlenecks respect the configured times and drill down to people', () => {
  const review = m.bottlenecks.find((b) => b.rule === 'review_days');
  assert.equal(review.count, 1); assert.equal(review.items[0].candidate_id, 'c2'); assert.equal(review.items[0].days, 21);
  assert.equal(r1.bottleneck.rule, 'review_days'); assert.equal(r1.sla_status, 'delayed');
  assert.ok(m.bottlenecks.find((b) => b.rule === 'approval_days').items.some((i) => i.mrf_id === 'r2'));
  assert.equal(run({}, { sla: { review_days: 30 } }).bottlenecks.find((b) => b.rule === 'review_days'), undefined);
});
await t('SLA status: overdue, not submitted, older records', () => {
  const by = Object.fromEntries(m.mrfs.map((r) => [r.id, r]));
  assert.equal(by.r2.sla_status, 'overdue'); assert.equal(by.r2.days_remaining, -2); assert.equal(by.r3.sla_status, 'not_submitted'); assert.equal(by.r3.stage, 'initiated');
  assert.equal(by.old.designation, 'Older role'); assert.equal(by.old.sla_status, 'closed_unfilled'); assert.equal(by.old.mrf_no, '');
});
await t('KPIs carry the records behind them', () => {
  assert.equal(kpi(m, 'open').value, 2); assert.equal(kpi(m, 'cvs').value, 4); assert.equal(kpi(m, 'cvs').candidate_ids.length, 4); assert.equal(kpi(m, 'positions_filled').value, 1);
  assert.equal(kpi(m, 'offer_acceptance').value, 100); assert.equal(kpi(m, 'conversion').value, 25); assert.equal(kpi(m, 'time_to_hire').value, 16); assert.equal(kpi(m, 'time_to_fill').value, 19);
  assert.deepEqual(kpi(m, 'overdue').mrf_ids, ['r2']); assert.equal(kpi(m, 'published_positions').value, 1);
  assert.equal(m.budget.find((b) => b.key === 'budgeted').proposed_annual_ctc, 1000000);
});
await t('filters: financial year, department, stage, SLA, budget, dates', () => {
  assert.equal(financialYear('2026-03-31'), '2025-26'); assert.equal(financialYear('2026-04-01'), '2026-27');
  assert.deepEqual(run({ fy: '2024-25' }).mrfs.map((r) => r.id), ['old']);
  assert.deepEqual(run({ department: 'Quality' }).mrfs.map((r) => r.id), ['r2']);
  assert.deepEqual(run({ sla_status: 'overdue' }).mrfs.map((r) => r.id), ['r2']);
  assert.deepEqual(run({ stage: 'initiated' }).mrfs.map((r) => r.id), ['r3']);
  assert.deepEqual(run({ budget_status: 'budgeted', recruiter_id: 'rec' }).mrfs.map((r) => r.id), ['r1']);
  const range = run({ from: '2026-11-15', to: '2026-11-27' });
  assert.deepEqual(range.mrfs.map((r) => r.id).sort(), ['r2', 'r3']); assert.equal(range.comparisons.periods.previous.to, '2026-11-14');
  assert.deepEqual(m.comparisons.by_fy.map((x) => x.name), ['FY 2024-25', 'FY 2026-27']);
});
await t('a Hiring Manager sees only their requisitions; a Department Head sees the department, not drafts', () => {
  const hm = run({}, { scope: { user_id: 'hm', departments: [] } });
  assert.deepEqual(hm.mrfs.map((r) => r.id), ['r1']); assert.equal(hm.data_quality.unlinked_count, 0); assert.equal(hm.options.departments.length, 1);
  assert.deepEqual(run({}, { scope: { user_id: 'head', departments: ['Sales'] } }).mrfs.map((r) => r.id).sort(), ['old', 'r1']);
});
await t('reopened, on hold and withdrawn positions show up', () => {
  const D2 = { ...D, reqs: [{ ...reqs[0], status: 'on_hold', reopened_at: at(15), positions_withdrawn: 1, audit: [{ at: at(15), action: 'status_reopen', by_name: 'HR' }, { at: at(21), action: 'status_on_hold', by_name: 'HR' }] }] };
  const r = computeMrfMis(D2, { now }).mrfs[0];
  assert.equal(r.stage, 'on_hold'); assert.equal(r.reopened, true); assert.equal(r.positions_withdrawn, 1); assert.equal(r.on_hold_days, 6); assert.equal(r.history.length, 2);
  assert.equal(computeMrfMis(D2, { now, filters: { stage: 'reopened' } }).mrfs.length, 1);
});
await t('the same person twice on one requisition is detected', () => {
  assert.equal(samePersonOnRequisition(cands, { id: 'n', requisition_id: 'r1', email: ' B@X.in ' }).id, 'c2');
  assert.equal(samePersonOnRequisition(cands, { id: 'n', requisition_id: 'r2', email: 'b@x.in' }), null);
  assert.equal(samePersonOnRequisition(cands, { id: 'c2', requisition_id: 'r1', email: 'b@x.in' }), null);
});
await t('the Excel export matches the screen', async () => {
  const wb = await buildMrfMisWorkbook(run({ from: '2026-11-01', to: '2026-11-27' }), ExcelJS);
  const buf = await wb.xlsx.writeBuffer(); const back = new ExcelJS.Workbook(); await back.xlsx.load(buf);
  for (const s of ['Summary', 'MRF Matrix', 'MRF Funnels', 'Bottlenecks', 'Departments', 'Recruiters', 'Budget', 'Financial years', 'Monthly trend', 'Period comparison', 'Candidates', 'Audit trail']) assert.ok(back.getWorksheet(s), s);
  const sheet = back.getWorksheet('MRF Matrix'); assert.equal(sheet.rowCount, 4 + 3, 'title block, header row and three requisitions in the period');
});
console.log(`\n${n} tests passed`);
