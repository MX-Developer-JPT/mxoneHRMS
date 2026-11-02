// Payslip-based payroll analytics — pure tests. Run: node backend/tests/payrollAnalytics.test.mjs
import assert from 'node:assert/strict';
import { buildPayrollAnalytics, normalizeRow, dedupe, resolvePeriod, fyStartOf, fyLabel, shiftYm, movements, totalsOf } from '../utils/payrollAnalytics.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const emp = (id, name, dept, extra = {}) => ({ user_id: id, display_name: name, employee_code: id.toUpperCase(), department: dept, status: 'active', ...extra });
const EMPS = [emp('a', 'Asha', 'Sales'), emp('b', 'Bala', 'Sales'), emp('c', 'Chitra', 'Purchase'), emp('d', 'Dev', 'HR'), emp('e', 'Esha', 'Purchase')];
// one Payroll record: gross, employer contributions optional; net = gross - ded
const P = (uid, year, month, gross, o = {}) => {
  const ded = o.ded ?? Math.round(gross * 0.12);
  return { id: `${uid}-${year}-${month}`, user_id: uid, year, month, status: 'processed', gross_salary: gross, basic_salary: Math.round(gross * 0.5), hra: Math.round(gross * 0.2),
    deductions: { pf: ded }, total_deductions: ded, net_salary: o.net ?? gross - ded, employer_contributions: o.employer === undefined ? { pf: Math.round(gross * 0.06) } : o.employer,
    department: o.department, payslip_uploaded_at: o.at || '2026-10-01T00:00:00Z', payslip_extraction_warnings: o.warn || [], ...o.extra };
};
const rows = [
  // September 2026: a, b (Sales), c (Purchase), d (HR)
  P('a', 2026, 9, 50000), P('b', 2026, 9, 30000), P('c', 2026, 9, 40000), P('d', 2026, 9, 60000),
  // October 2026: a got an increment, b left, e joined (Purchase), c unchanged, d unchanged
  P('a', 2026, 10, 55000), P('c', 2026, 10, 40000), P('d', 2026, 10, 60000), P('e', 2026, 10, 35000),
  // October 2025 (year ago): a, c, d
  P('a', 2025, 10, 45000), P('c', 2025, 10, 38000), P('d', 2025, 10, 55000),
];
const run = (params, extra) => buildPayrollAnalytics(rows, EMPS, params, extra);

t('cost definitions: total cost = gross + employer contributions; deductions are NOT a cost; net is separate', () => {
  const r = run({ mode: 'month', month: '2026-10' }); const s = r.summary;
  assert.equal(s.gross, 55000 + 40000 + 60000 + 35000);
  assert.equal(s.employer, Math.round(55000 * 0.06) + Math.round(40000 * 0.06) + Math.round(60000 * 0.06) + Math.round(35000 * 0.06));
  assert.equal(s.cost, s.gross + s.employer, 'cost = gross + employer');
  assert.equal(s.net, s.gross - s.deductions, 'net = gross - deductions');
  assert.ok(s.cost !== s.gross + s.deductions, 'deductions never added to cost');
  assert.equal(s.headcount, 4); assert.equal(s.avg_gross, Math.round(190000 / 4 * 100) / 100);
});

t('month-on-month: October vs September, absolute and percent, with employer contributions counted', () => {
  const r = run({ mode: 'month', month: '2026-10' }); const c = r.comparison.previous;
  const sepCost = 50000 + 30000 + 40000 + 60000 + [50000, 30000, 40000, 60000].reduce((a, g) => a + Math.round(g * 0.06), 0);
  assert.equal(c.cost.prev, sepCost); assert.equal(c.cost.abs, c.cost.cur - sepCost);
  assert.equal(c.cost.pct, Math.round(((c.cost.cur - sepCost) / sepCost) * 10000) / 100);
  assert.equal(c.headcount.prev, 4); assert.equal(c.headcount.cur, 4); assert.equal(r.period.prev_label, 'Sep 2026');
  assert.equal(r.summary.mom_growth_pct, c.cost.pct);
});

t('year-on-year: the same month a year earlier, plus a table of that month in every year', () => {
  const r = run({ mode: 'month', month: '2026-10' });
  assert.equal(r.period.yoy_label, 'Oct 2025'); assert.equal(r.comparison.year_ago.headcount.prev, 3); assert.equal(r.comparison.has_year_ago, true);
  assert.deepEqual(r.yoy_table.map(x => x.label), ['Oct 2025', 'Oct 2026']); assert.ok(r.yoy_table[1].growth_pct > 0);
});

t('departments: headcount, totals, share of the whole (sums to 100), variance against the previous month', () => {
  const r = run({ mode: 'month', month: '2026-10' });
  const by = Object.fromEntries(r.departments.map(d => [d.department, d]));
  assert.deepEqual(Object.keys(by).sort(), ['HR', 'Purchase', 'Sales']);
  assert.equal(by.Sales.headcount, 1); assert.equal(by.Purchase.headcount, 2); assert.equal(by.HR.headcount, 1);
  assert.ok(Math.abs(r.departments.reduce((a, d) => a + d.share_pct, 0) - 100) < 0.1, 'shares add up');
  assert.equal(r.departments[0].department, 'Purchase' === r.departments[0].department ? 'Purchase' : r.departments[0].department);
  assert.ok(r.departments.every((d, i, a) => i === 0 || a[i - 1].cost >= d.cost), 'highest cost first');
  assert.equal(by.Sales.prev_cost > by.Sales.cost, true, 'Sales fell: Bala left, Asha got an increment');
  assert.equal(by.Sales.variance, by.Sales.cost - by.Sales.prev_cost); assert.equal(by.Purchase.variance > 0, true, 'Purchase rose with a joiner');
});

t('movements: joiners, exits, increments, significant changes — and the drivers add up to the total change', () => {
  const r = run({ mode: 'month', month: '2026-10' }); const m = r.movements;
  assert.deepEqual(m.joiners.map(x => x.name), ['Esha']); assert.deepEqual(m.exits.map(x => x.name), ['Bala']);
  assert.deepEqual(m.increments.map(x => x.name), ['Asha']); assert.equal(m.increments[0].delta, 5000); assert.equal(m.increments[0].pct, 10);
  assert.deepEqual(m.significant.map(x => x.name), ['Asha'], '10% and ₹5,000 counts as significant');
  const total = r.summary.last_month.cost - r.summary.last_month.prev_cost;
  assert.ok(Math.abs(m.drivers.joiners_cost + m.drivers.exits_cost + m.drivers.existing_change - total) < 0.5, 'joiners + exits + stayers = total change');
});

t('financial year: April to March, with the previous FY as comparison and a trend of its months', () => {
  assert.equal(fyStartOf('2026-10'), 2026); assert.equal(fyStartOf('2027-02'), 2026); assert.equal(fyStartOf('2026-03'), 2025); assert.equal(fyLabel(2026), 'FY 2026-27');
  const r = run({ mode: 'fy', fy: 2026 });
  assert.match(r.period.label, /^FY 2026-27 · year to date \(Apr–Oct\)$/); assert.equal(r.trend.length, 7, 'only the months so far'); assert.equal(r.trend[0].ym, '2026-04');
  assert.equal(r.summary.months_with_data, 2); assert.equal(r.summary.gross, [50000, 30000, 40000, 60000, 55000, 40000, 60000, 35000].reduce((a, b) => a + b, 0));
  assert.equal(r.period.prev_label, 'FY 2025-26 · same months', 'a part-year is compared with the same months last year, not the whole year');
  assert.equal(r.comparison.has_previous, true); assert.equal(r.previous.records, 3, 'Oct 2025 only');
  const done = buildPayrollAnalytics([P('a', 2026, 3, 50000), P('a', 2025, 4, 40000)], EMPS, { mode: 'fy', fy: 2025 });
  assert.equal(done.period.label, 'FY 2025-26', 'a finished year keeps its plain label'); assert.equal(done.trend.length, 12);
});

t('custom period: inclusive months, compared with the equally long period before it', () => {
  const r = run({ mode: 'custom', from: '2026-09', to: '2026-10' });
  assert.equal(r.period.months.length, 2); assert.equal(r.period.prev_label, 'Jul 2026 – Aug 2026'); assert.equal(r.comparison.has_previous, false);
  assert.equal(run({ mode: 'custom', from: '2026-10', to: '2026-09' }).period.months.length, 2, 'reversed dates are put right');
});

t('the department comes from the payslip month: later department changes do not rewrite history', () => {
  const moved = [{ ...EMPS[0], department: 'Marketing' }, ...EMPS.slice(1)];
  const r = buildPayrollAnalytics([P('a', 2026, 9, 50000, { department: 'Sales' }), P('a', 2026, 10, 50000, { department: 'Marketing' })], moved, { mode: 'month', month: '2026-09' });
  assert.deepEqual(r.departments.map(d => d.department), ['Sales']);
});

t('one record per employee-month: a re-upload replaces the first and is counted', () => {
  const dup = [P('a', 2026, 10, 50000, { at: '2026-10-01T00:00:00Z' }), { ...P('a', 2026, 10, 52000, { at: '2026-10-05T00:00:00Z' }), id: 'second' }];
  const r = buildPayrollAnalytics(dup, EMPS, { mode: 'month', month: '2026-10' });
  assert.equal(r.summary.gross, 52000); assert.equal(r.summary.headcount, 1); assert.equal(r.data_quality.duplicates_removed, 1);
});

t('cancelled records are ignored; employer contributions that are not printed are reported, not invented', () => {
  const r = buildPayrollAnalytics([P('a', 2026, 10, 50000, { employer: {} }), { ...P('b', 2026, 10, 30000), status: 'cancelled' }], EMPS, { mode: 'month', month: '2026-10' });
  assert.equal(r.summary.headcount, 1); assert.equal(r.summary.employer, 0); assert.equal(r.summary.cost, 50000);
  assert.deepEqual(r.summary.employer_coverage, { with: 0, of: 1 }); assert.ok(r.insights.some(i => /not printed/.test(i.text)));
});

t('data quality: missing / inconsistent figures are flagged for review; active employees with no payslip are listed', () => {
  const bad = [P('a', 2026, 10, 50000), { ...P('b', 2026, 10, 30000), net_salary: 0 }, P('c', 2026, 10, 40000, { net: 20000 }), P('d', 2026, 10, 0, { ded: 0, net: 0 })];
  const r = buildPayrollAnalytics(bad, EMPS, { mode: 'month', month: '2026-10' });
  const f = Object.fromEntries(r.data_quality.flagged.map(x => [x.name, x.issues.join('|')]));
  assert.match(f.Bala, /Net salary is missing/); assert.match(f.Chitra, /does not equal net/); assert.match(f.Dev, /Gross salary is missing/); assert.equal(f.Asha, undefined);
  assert.deepEqual(r.data_quality.missing_payslips.list.map(x => x.name), ['Esha']);
});

t('upload history and processing results are carried through for the period', () => {
  const batches = [{ id: 'b1', month: 10, year: 2026, uploaded_at: '2026-10-31T10:00:00Z', counts: { total: 5, mapped: 4, unmapped: 1, duplicate: 0, invalid: 0, password_failed: 0, extraction_failed: 0 } }, { id: 'b0', month: 5, year: 2026, uploaded_at: '2026-05-31T10:00:00Z', counts: { total: 9, mapped: 9 } }];
  const r = run({ mode: 'month', month: '2026-10' }, { batches });
  assert.equal(r.data_quality.upload_history.length, 1); assert.equal(r.data_quality.upload_totals.unmapped, 1);
});

t('average salary analysis: median, bands and by department', () => {
  const r = run({ mode: 'month', month: '2026-10' });
  assert.equal(r.salary.median, 47500); assert.equal(r.salary.min, 35000); assert.equal(r.salary.max, 60000);
  assert.equal(r.salary.bands.reduce((a, b) => a + b.count, 0), 4); assert.equal(r.salary.by_department[0].department, 'HR');
});

t('department filter narrows everything; empty data does not crash', () => {
  const r = run({ mode: 'month', month: '2026-10', department: 'Sales' }); assert.equal(r.summary.headcount, 1); assert.deepEqual(r.departments.map(d => d.department), ['Sales']);
  const e = buildPayrollAnalytics([], [], {}); assert.equal(e.summary.cost, 0); assert.deepEqual(e.departments, []); assert.equal(e.comparison.has_previous, false);
});

t('resolvePeriod and month arithmetic', () => {
  assert.equal(shiftYm('2026-01', -1), '2025-12'); assert.equal(shiftYm('2026-12', 1), '2027-01');
  assert.equal(resolvePeriod({}, ['2026-08', '2026-10']).label, 'Oct 2026', 'defaults to the latest month with data');
});

console.log(`\n${n} payroll analytics tests passed`);
