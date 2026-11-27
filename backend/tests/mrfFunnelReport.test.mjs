// Formatted Excel report of the matrix and funnel: one requisition, and a month. Run: node backend/tests/mrfFunnelReport.test.mjs
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { computeMrfMis } from '../utils/mrfMis.js';
import { buildRequisitionWorkbook, buildMonthWorkbook, monthRange } from '../utils/mrfFunnelReport.js';
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

const reread = async (wb) => { const out = new ExcelJS.Workbook(); await out.xlsx.load(await wb.xlsx.writeBuffer()); return out; };
const text = (ws) => { const v = []; ws.eachRow((row) => row.eachCell((c) => { if (!c.isMerged || c.master === c) v.push(typeof c.value === 'object' && c.value ? c.value.text ?? c.value.result ?? '' : c.value); })); return v.map(String); };
const rowOf = (ws, col, value) => { let found; ws.eachRow((row) => { if (!found && row.getCell(col).value === value) found = row; }); return found; };

await t('month ranges', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' }); assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(monthRange('2026-13'), null); assert.equal(monthRange(''), null);
});
await t('one requisition: details, funnel with bars, stage dates and its candidates only', async () => {
  const wb = await reread(buildRequisitionWorkbook(run({ mrf_id: 'r1' }), ExcelJS, { requisitionId: 'r1', by: 'HR' }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['MRF-2026-0001', 'Candidates']);
  const ws = wb.worksheets[0]; const all = text(ws);
  for (const x of ['Recruitment Funnel Report', 'Hari', 'Ritu', 'CVs sent for review', '75%', 'STAGE DATES']) assert.ok(all.includes(x), x);
  const first = rowOf(ws, 2, 'Applications / CVs received'), shortlisted = rowOf(ws, 2, 'Shortlisted');
  assert.equal(first.getCell(4).value, 4); assert.equal(shortlisted.getCell(4).value, 3);
  assert.ok(first.getCell(3).value.length > shortlisted.getCell(3).value.length, 'the bar narrows');
  assert.equal(buildRequisitionWorkbook(run(), ExcelJS, { requisitionId: 'nope' }), null);
});
await t('month: summary, matrix with totals, a sheet per submitted requisition, no drafts', async () => {
  const wb = await reread(buildMonthWorkbook(run(monthRange('2026-11')), ExcelJS, { month: '2026-11' }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'MRF Matrix', 'MRF-2026-0001', 'MRF-2026-0002', 'Candidates']);
  assert.ok(text(wb.getWorksheet('Summary')).includes('Total recruitment funnel'.toUpperCase()));
  const mx = wb.getWorksheet('MRF Matrix');
  assert.equal(mx.getCell('A6').value.hyperlink, "#'MRF-2026-0001'!A1"); assert.equal(mx.getCell('H6').value, 4);
  const total = rowOf(mx, 1, 'TOTAL — 2 requisition(s)');
  assert.equal(total.getCell(8).value.result, 4); assert.equal(total.getCell(8).value.formula, 'SUM(H6:H7)'); assert.equal(total.getCell(19).value.result, 3);
});
await t('a month with nothing submitted gives no workbook', () => assert.equal(buildMonthWorkbook(run(monthRange('2026-06')), ExcelJS, { month: '2026-06' }), null));
await t('viewers without candidate access get counts but no names', async () => {
  const wb = await reread(buildMonthWorkbook(run(monthRange('2026-11'), { candidatesVisible: () => false }), ExcelJS, { month: '2026-11' }));
  const all = wb.worksheets.flatMap(text).join('|');
  for (const c of cands) assert.ok(!all.includes(c.full_name), c.full_name);
  assert.ok(all.includes('not listed'));
});
console.log(`
${n} passed`);
