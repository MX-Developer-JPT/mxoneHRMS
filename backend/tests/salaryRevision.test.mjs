// Salary revision — CTC maths, matching, structure versioning, letter text. Synthetic data, no DB.
// Optional: SR_FILE=<path> SR_PASSWORD=<pw> also parses the real HR sheet.
// Run: node backend/tests/salaryRevision.test.mjs
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
const S = await import('../utils/salaryRevision.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const prev = { basic: 33642, hra: 13457, conveyance: 15035, pf: 1800, medical: 397, admin: 150, vpp: 0, ctc_bonus: 2802, esi: 0, car_lease: 0, car_maint: 0, gym: 0, hard_fur: 0, total: 67283 };
const rev = { ...prev, pf: 3000, admin: 250, total: 68583 };

await t('computeDiff finds only PF + admin + total', () => {
  const d = S.computeDiff(prev, rev);
  assert.deepEqual(d.changed.sort(), ['admin', 'pf']);
  assert.equal(d.diff.total, 1300); assert.equal(d.diff.pf, 1200); assert.equal(d.unchanged, false);
  assert.equal(S.computeDiff(prev, prev).unchanged, true);
});
await t('decimals are kept to 2dp', () => { assert.equal(S.computeDiff({ ...prev, total: 46657 }, { ...prev, total: 49689.29 }).diff.total, 3032.29); });
await t('sum check flags a wrong total', () => {
  assert.equal(S.rowWarnings({ previous: { ...prev, total: 67283 }, revised: { ...rev, total: 99999 } }).length, 1);
  assert.equal(S.rowWarnings({ previous: prev, revised: rev }).length, 0);
});
await t('pickEmployee prefers active, company email, then structure', () => {
  const p = S.pickEmployee([{ status: 'active', email: 'x@gmail.com' }, { status: 'active', email: 'a@maxvoltenergy.com' }]);
  assert.equal(p.pick.email, 'a@maxvoltenergy.com'); assert.equal(p.duplicate, true); assert.equal(p.ambiguous, false);
  assert.equal(S.pickEmployee([{ status: 'active', email: 'a@x.com' }, { status: 'active', email: 'b@x.com' }]).ambiguous, true);
  assert.equal(S.pickEmployee([]).pick, null);
});
await t('namesAgree is loose but catches different people', () => {
  assert.ok(S.namesAgree('ANSHUL KUMAR (M) ', 'Anshul Kumar')); assert.ok(!S.namesAgree('RAJ MEHTA', 'Sunil Verma'));
});
await t('impact lines: PF change, take-home, unchanged list', () => {
  const f = S.impactFacts(prev, rev);
  assert.match(f.lines[0], /₹1,800 to ₹3,000/); assert.match(f.lines[0], /₹25,000/); assert.match(f.lines[0], /₹15,000/);
  assert.ok(f.lines.some(l => /take-home pay will reduce by approximately ₹1,200/.test(l)));
  assert.ok(f.same.includes('Basic Salary') && !f.same.includes('Provident Fund (PF) contribution'));
  assert.ok(!S.impactFacts(prev, rev, { includeTakeHome: false }).lines.some(l => /take-home/.test(l)));
});
await t('buildStructure keeps old values in history fields and fills aliases', () => {
  const old = { id: 'old1', ctc: 807396, total_ctc: 67283, effective_from: '2025-01-01', basic_salary: 33642, pf_contribution: 1800, nps_employee: 5, source: 'excel_import' };
  const s = S.buildStructure({ id: 'new1', userId: 'u1', prevStructure: old, revised: rev, batch: { id: 'b1', effective_date: '2026-10-01' }, approvedBy: 'hr1', now: 'x' });
  assert.equal(s.ctc, 68583 * 12); assert.equal(s.total_ctc, 68583); assert.equal(s.pf_contribution, 3000); assert.equal(s.pf_employee, 3000);
  assert.equal(s.employer_pf_contribution, 3250); assert.equal(s.nps_employee, 5); // unrelated field survives
  assert.equal(s.previous_structure_id, 'old1'); assert.equal(s.previous_values.ctc, 807396); assert.equal(s.previous_values.pf_contribution, 1800);
  assert.equal(s.revision_batch_id, 'b1'); assert.equal(s.effective_from, '2026-10-01'); assert.equal(s.status, 'active');
  assert.equal(old.ctc, 807396); // input untouched
  const fresh = S.buildStructure({ id: 'n2', userId: 'u2', prevStructure: null, revised: rev, batch: { id: 'b1', effective_date: '2026-10-01' }, now: 'x' });
  assert.equal(fresh.previous_structure_id, null); assert.equal(fresh.previous_values, null);
});
await t('letter doc has reason, impact, both totals and ref', () => {
  const dd = S.buildLetterDocDef({ emp: { code: 'MVE1', name: 'Test Person', designation: 'Manager', department: 'HR' }, previous: prev, revised: rev, batch: { effective_date: '2026-10-01', letter_date: '2026-10-24', include_take_home: true }, assets: { marginTop: 140, marginBottom: 105 } });
  const txt = JSON.stringify(dd.content);
  for (const w of ['Reason for the revision', 'Impact on you', 'What stays the same', 'MEIL/HR/PFREV/2026/MVE1', '1 October 2026', 'Total annual CTC', '₹8,22,996']) assert.ok(txt.includes(w), w);
});
await t('email is addressed to one person, with the facts', () => {
  const m = S.buildEmail({ emp: { name: 'Test <b> Person' }, previous: prev, revised: rev, batch: { effective_date: '2026-10-01' } });
  assert.match(m.subject, /effective 1 October 2026/); assert.ok(!m.html.includes('<b>')); assert.match(m.html, /Dear Test/);
});
await t('workbook parser: plain xlsx with two CTC blocks', async () => {
  const head = ['S.No.', 'Code', 'Name', 'DEPARTMENT', 'DESIGNATION', ...S.COMPONENTS.map(c => c.head), 'Total_CTC', '', 'New PF', ...S.COMPONENTS.map(c => c.head), 'Total_CTC'];
  const row = (v) => [...S.COMPONENTS.map(c => v[c.key]), v.total];
  const ws = XLSX.utils.aoa_to_sheet([['CO'], [], head, [1, 'MVE9', 'A  B ', 'D', 'X', ...row(prev), '', 3000, ...row(rev)]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'pf WORKING');
  const out = await S.parseRevisionWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(out.rows.length, 1); assert.equal(out.rows[0].name, 'A B'); assert.equal(out.rows[0].previous.pf, 1800); assert.equal(out.rows[0].revised.pf, 3000); assert.equal(out.rows[0].revised.total, 68583);
  const w2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w2, XLSX.utils.aoa_to_sheet([['x']]), 'a');
  await assert.rejects(S.parseRevisionWorkbook(XLSX.write(w2, { type: 'buffer', bookType: 'xlsx' })), /Could not find/);
});
if (process.env.SR_FILE) await t('real sheet parses (counts only)', async () => {
  const { readFileSync } = await import('node:fs');
  const out = await S.parseRevisionWorkbook(readFileSync(process.env.SR_FILE), process.env.SR_PASSWORD);
  assert.ok(out.rows.length > 200); assert.equal(out.rows.filter(r => S.rowWarnings(r).length).length, 0);
  await assert.rejects(S.parseRevisionWorkbook(readFileSync(process.env.SR_FILE), 'wrong'), /Wrong password/);
});
console.log(`\n${n} passed`);
