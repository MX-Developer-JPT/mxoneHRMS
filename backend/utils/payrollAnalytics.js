// Payslip-based payroll analytics — pure functions (no database). The numbers come ONLY from the Payroll records created
// from uploaded payslips (routes/payslipUpload.js); nothing here calculates or processes salary.
//
// Definitions (shown on the dashboard too, so nobody has to guess):
//   Gross salary          = the payslip's total earnings
//   Net salary            = what the employee takes home (disbursed)
//   Employee deductions   = PF, ESI, PT, TDS, loan, LOP… taken OUT of the gross. They are NOT an extra cost to the company.
//   Employer contributions= employer PF / ESI etc. where the payslip prints them (an extra cost on top of gross)
//   Total payroll cost    = Gross salary + Employer contributions
// One record per employee per month (a second upload replaces the first); the department is the one printed on the payslip
// for that month, so history is not rewritten when someone later changes department.
export const GROSS_BANDS = [[0, 15000, 'Below ₹15k'], [15000, 25000, '₹15k – 25k'], [25000, 40000, '₹25k – 40k'], [40000, 60000, '₹40k – 60k'], [60000, 100000, '₹60k – 1L'], [100000, Infinity, '₹1L and above']];
export const SIGNIFICANT_PCT = 10;        // an individual's gross moving by this much (and at least SIGNIFICANT_MIN) is called out
export const SIGNIFICANT_MIN = 2000;
const RECONCILE_TOLERANCE = 5;

const n0 = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v) => Math.round(n0(v) * 100) / 100;
export const pad = (m) => String(m).padStart(2, '0');
export const ym = (year, month) => `${year}-${pad(month)}`;
export const shiftYm = (s, delta) => { const [y, m] = s.split('-').map(Number); const t = y * 12 + (m - 1) + delta; return ym(Math.floor(t / 12), (t % 12) + 1); };
export const monthsBetween = (a, b) => { const out = []; for (let c = a; c <= b; c = shiftYm(c, 1)) { out.push(c); if (out.length > 120) break; } return out; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (s) => { const [y, m] = s.split('-').map(Number); return `${MON[m - 1]} ${y}`; };
// Indian financial year: April → March. fyStart 2026 = FY 2026-27
export const fyStartOf = (s) => { const [y, m] = s.split('-').map(Number); return m >= 4 ? y : y - 1; };
export const fyLabel = (start) => `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
export const fyMonths = (start) => monthsBetween(`${start}-04`, `${start + 1}-03`);

const pct = (cur, prev) => (prev ? r2(((cur - prev) / prev) * 100) : null);

// ── one Payroll record → a flat, safe row ───────────────────────────────────────────────────────────────────────────────
export function normalizeRow(p, emp) {
  const d = p.deductions || {};
  const gross = n0(p.gross_salary), net = n0(p.net_salary);
  const dedItems = { pf: n0(d.pf), esi: n0(d.esi), professional_tax: n0(d.professional_tax), tds: n0(d.tds), loan: n0(d.loan), lop: n0(d.lop) + n0(p.loss_of_pay_amount), other: n0(d.other) };
  const dedSum = Object.values(dedItems).reduce((a, b) => a + b, 0);
  const totalDed = n0(p.total_deductions) || dedSum;
  const empContribs = p.employer_contributions || {};
  const employer = Object.values(empContribs).reduce((a, b) => a + n0(b), 0);
  const basic = n0(p.basic_salary), hra = n0(p.hra);
  const issues = [];
  if (!(gross > 0)) issues.push('Gross salary is missing');
  if (!(net > 0)) issues.push('Net salary is missing');
  if (gross > 0 && net > 0 && totalDed >= 0 && Math.abs(gross - totalDed - net) > RECONCILE_TOLERANCE) issues.push(`Gross − deductions (${r2(gross - totalDed)}) does not equal net (${net})`);
  if (net > gross && gross > 0) issues.push('Net salary is higher than gross');
  if (!(p.department || emp?.department)) issues.push('Department is missing');
  if (!emp) issues.push('Employee not found in employee records');
  const warns = Array.isArray(p.payslip_extraction_warnings) ? p.payslip_extraction_warnings : [];
  return {
    id: p.id, user_id: p.user_id, ym: ym(p.year, p.month), year: p.year, month: p.month,
    name: emp?.display_name || emp?.full_name || p.employee_name || '', code: p.employee_code || emp?.employee_code || '',
    department: (p.department || emp?.department || 'Unassigned').trim() || 'Unassigned', designation: p.designation || emp?.designation || '',
    basic, hra, other_allowances: Math.max(0, r2(gross - basic - hra)), gross, net, total_deductions: r2(totalDed), deductions: dedItems,
    employer: r2(employer), has_employer: employer > 0, cost: r2(gross + employer),
    lop_days: n0(p.loss_of_pay_days), source: p.payslip_source || 'engine', corrected: !!p.payslip_corrections?.length,
    issues, warnings: warns, status: p.status,
    stamp: String(p.payslip_uploaded_at || p.processed_at || p.updated_at || ''),
  };
}

// One record per employee-month: if the data holds several, the latest upload wins (and the duplicate count is reported).
export function dedupe(rows) {
  const map = new Map(); let duplicates = 0;
  for (const r of rows) {
    const k = `${r.user_id}|${r.ym}`;
    const cur = map.get(k);
    if (!cur) { map.set(k, r); continue; }
    duplicates++;
    if (r.stamp > cur.stamp) map.set(k, r);
  }
  return { rows: [...map.values()], duplicates };
}

const emptyAgg = () => ({ employees: new Set(), gross: 0, net: 0, deductions: 0, employer: 0, basic: 0, hra: 0, other: 0, records: 0, employerRecords: 0 });
function addTo(a, r) {
  a.employees.add(r.user_id); a.records++;
  a.gross += r.gross; a.net += r.net; a.deductions += r.total_deductions; a.employer += r.employer; a.basic += r.basic; a.hra += r.hra; a.other += r.other_allowances;
  if (r.has_employer) a.employerRecords++;
}
export function totalsOf(rows) {
  const a = emptyAgg(); for (const r of rows) addTo(a, r);
  const headcount = a.employees.size;
  const cost = a.gross + a.employer;
  return {
    headcount, records: a.records, gross: r2(a.gross), net: r2(a.net), deductions: r2(a.deductions), employer: r2(a.employer), cost: r2(cost),
    basic: r2(a.basic), hra: r2(a.hra), other_allowances: r2(a.other),
    avg_gross: a.records ? r2(a.gross / a.records) : 0, avg_net: a.records ? r2(a.net / a.records) : 0, avg_cost: a.records ? r2(cost / a.records) : 0,
    employer_coverage: { with: a.employerRecords, of: a.records },
  };
}
const byMonth = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.ym)) m.set(r.ym, []); m.get(r.ym).push(r); } return m; };

// ── what period was asked for ──────────────────────────────────────────────────────────────────────────────────────────
export function resolvePeriod(params, availableYms) {
  const latest = [...availableYms].sort().at(-1) || ym(new Date().getFullYear(), new Date().getMonth() + 1);
  const mode = ['month', 'fy', 'custom'].includes(params?.mode) ? params.mode : 'month';
  if (mode === 'fy') {
    const start = Number(params.fy) || fyStartOf(latest);
    let months = fyMonths(start), label = fyLabel(start), prevLabel = fyLabel(start - 1);
    // A year still in progress is compared like for like: its months so far against the SAME months of the previous year
    // (comparing seven months with a full year would always read as a fall).
    const withData = months.filter(m => availableYms.includes(m));
    const last = withData.at(-1);
    if (last && last < months.at(-1)) {
      months = months.filter(m => m <= last);
      label = `${fyLabel(start)} · year to date (${monthLabel(months[0]).slice(0, 3)}–${monthLabel(last).slice(0, 3)})`;
      prevLabel = `${fyLabel(start - 1)} · same months`;
    }
    const prev = months.map(m => shiftYm(m, -12));
    return { mode, label, months, prev, prevLabel, yoy: prev, yoyLabel: prevLabel, fy: start };
  }
  if (mode === 'custom') {
    let from = /^\d{4}-\d{2}$/.test(params.from || '') ? params.from : shiftYm(latest, -2), to = /^\d{4}-\d{2}$/.test(params.to || '') ? params.to : latest;
    if (from > to) [from, to] = [to, from];
    const months = monthsBetween(from, to), n = months.length;
    return { mode, label: `${monthLabel(from)} – ${monthLabel(to)}`, months, prev: months.map(m => shiftYm(m, -n)), prevLabel: `${monthLabel(shiftYm(from, -n))} – ${monthLabel(shiftYm(to, -n))}`, yoy: months.map(m => shiftYm(m, -12)), yoyLabel: `${monthLabel(shiftYm(from, -12))} – ${monthLabel(shiftYm(to, -12))}` };
  }
  const m = /^\d{4}-\d{2}$/.test(params?.month || '') ? params.month : latest;
  return { mode, label: monthLabel(m), months: [m], prev: [shiftYm(m, -1)], prevLabel: monthLabel(shiftYm(m, -1)), yoy: [shiftYm(m, -12)], yoyLabel: monthLabel(shiftYm(m, -12)) };
}

const compare = (cur, prev) => ({
  cost: { cur: cur.cost, prev: prev.cost, abs: r2(cur.cost - prev.cost), pct: pct(cur.cost, prev.cost) },
  gross: { cur: cur.gross, prev: prev.gross, abs: r2(cur.gross - prev.gross), pct: pct(cur.gross, prev.gross) },
  net: { cur: cur.net, prev: prev.net, abs: r2(cur.net - prev.net), pct: pct(cur.net, prev.net) },
  headcount: { cur: cur.headcount, prev: prev.headcount, abs: cur.headcount - prev.headcount, pct: pct(cur.headcount, prev.headcount) },
  avg_gross: { cur: cur.avg_gross, prev: prev.avg_gross, abs: r2(cur.avg_gross - prev.avg_gross), pct: pct(cur.avg_gross, prev.avg_gross) },
});

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ── movement between two months: joiners, exits, increments, decreases, structure changes ─────────────────────────────
export function movements(curRows, baseRows, everBefore) {
  const base = new Map(baseRows.map(r => [r.user_id, r])), cur = new Map(curRows.map(r => [r.user_id, r]));
  const joiners = [], exits = [], increments = [], decreases = [], significant = [], structure = [];
  let existingChange = 0;
  for (const r of curRows) {
    const b = base.get(r.user_id);
    if (!b) { joiners.push({ user_id: r.user_id, name: r.name, code: r.code, department: r.department, gross: r.gross, cost: r.cost, returning: everBefore?.has(r.user_id) || false }); continue; }
    const delta = r2(r.gross - b.gross);
    existingChange += r.cost - b.cost;
    const row = { user_id: r.user_id, name: r.name, code: r.code, department: r.department, prev_gross: b.gross, gross: r.gross, delta, pct: pct(r.gross, b.gross), lop_days: r.lop_days, prev_lop_days: b.lop_days };
    if (delta > 0.5) increments.push(row); else if (delta < -0.5) decreases.push(row);
    if (Math.abs(delta) >= SIGNIFICANT_MIN && Math.abs(row.pct || 0) >= SIGNIFICANT_PCT) significant.push(row);
    const sb = b.gross ? b.basic / b.gross : 0, sc = r.gross ? r.basic / r.gross : 0;
    if (b.gross && r.gross && Math.abs(sb - sc) > 0.05) structure.push({ user_id: r.user_id, name: r.name, code: r.code, department: r.department, prev_basic_share: r2(sb * 100), basic_share: r2(sc * 100) });
  }
  for (const b of baseRows) if (!cur.has(b.user_id)) exits.push({ user_id: b.user_id, name: b.name, code: b.code, department: b.department, gross: b.gross, cost: b.cost });
  const byAbs = (x, y) => Math.abs(y.delta) - Math.abs(x.delta);
  const cap = (a, f) => [...a].sort(f).slice(0, 100);
  return {
    joiners: cap(joiners, (a, b) => b.cost - a.cost), exits: cap(exits, (a, b) => b.cost - a.cost),
    increments: cap(increments, byAbs), decreases: cap(decreases, byAbs), significant: cap(significant, byAbs), structure_changes: structure.slice(0, 100),
    counts: { joiners: joiners.length, exits: exits.length, increments: increments.length, decreases: decreases.length, significant: significant.length, structure_changes: structure.length },
    // why total cost moved: people who joined, people who left, and everyone who stayed (increments, LOP, bonus, allowance changes)
    drivers: { joiners_cost: r2(joiners.reduce((a, r) => a + r.cost, 0)), exits_cost: r2(-exits.reduce((a, r) => a + r.cost, 0)), existing_change: r2(existingChange) },
  };
}

// ── the whole dashboard payload ─────────────────────────────────────────────────────────────────────────────────────────
export function buildPayrollAnalytics(payrollRows, employees, params = {}, { batches = [], today = new Date() } = {}) {
  const empByUser = new Map((employees || []).map(e => [e.user_id, e]));
  const usable = (payrollRows || []).filter(p => p && p.year && p.month && !['cancelled', 'rejected'].includes(p.status)).map(p => normalizeRow(p, empByUser.get(p.user_id)));
  const { rows: all, duplicates } = dedupe(usable);
  const deptFilter = params.department && params.department !== 'all' ? params.department : null;
  const rowsAll = deptFilter ? all.filter(r => r.department === deptFilter) : all;
  const months = byMonth(rowsAll);
  const available = [...months.keys()].sort();
  const period = resolvePeriod(params, available);
  const pick = (ms) => ms.flatMap(m => months.get(m) || []);
  const curRows = pick(period.months), prevRows = pick(period.prev), yoyRows = pick(period.yoy);
  const cur = totalsOf(curRows), prev = totalsOf(prevRows), yoy = totalsOf(yoyRows);
  const lastMonth = [...period.months].reverse().find(m => months.has(m)) || period.months.at(-1);
  const monthsWithData = period.months.filter(m => months.has(m));

  // headline: totals for the period; headcount = the last month's strength (and the average across months)
  const lastRows = months.get(lastMonth) || [];
  const perMonthHead = monthsWithData.map(m => new Set((months.get(m) || []).map(r => r.user_id)).size);
  const summary = {
    ...cur,
    headcount: period.months.length === 1 ? cur.headcount : lastRows.length ? new Set(lastRows.map(r => r.user_id)).size : cur.headcount,
    avg_headcount: perMonthHead.length ? r2(perMonthHead.reduce((a, b) => a + b, 0) / perMonthHead.length) : 0,
    months_with_data: monthsWithData.length, months_in_period: period.months.length,
    mom_growth_pct: null, mom_growth_abs: null,
  };
  // month-on-month growth is about the last month vs the month before it (whatever period is chosen)
  const lastTot = totalsOf(lastRows), beforeTot = totalsOf(months.get(shiftYm(lastMonth, -1)) || []);
  summary.mom_growth_pct = beforeTot.cost ? pct(lastTot.cost, beforeTot.cost) : null;
  summary.mom_growth_abs = beforeTot.cost ? r2(lastTot.cost - beforeTot.cost) : null;
  summary.last_month = { ym: lastMonth, label: monthLabel(lastMonth), ...lastTot, prev_label: monthLabel(shiftYm(lastMonth, -1)), prev_cost: beforeTot.cost };

  // trend: the months of the period (FY / custom) or the 12 months up to the chosen month; plus a 24-month tail for the line chart
  const trendMonths = period.mode === 'month' ? monthsBetween(shiftYm(period.months[0], -11), period.months[0]) : period.months;
  const trend = trendMonths.map(m => { const t = totalsOf(months.get(m) || []); return { ym: m, label: monthLabel(m), has_data: months.has(m), headcount: t.headcount, gross: t.gross, net: t.net, deductions: t.deductions, employer: t.employer, cost: t.cost, avg_gross: t.avg_gross }; });
  trend.forEach((t, i) => { const p = i ? trend[i - 1] : null; t.mom_pct = p && p.has_data && t.has_data ? pct(t.cost, p.cost) : null; });

  // departments (for the period) with share, previous-period variance and year-ago variance
  const deptNames = [...new Set([...curRows, ...prevRows, ...yoyRows].map(r => r.department))];
  const group = (rows) => { const g = new Map(); for (const r of rows) { if (!g.has(r.department)) g.set(r.department, []); g.get(r.department).push(r); } return g; };
  const gCur = group(curRows), gPrev = group(prevRows), gYoy = group(yoyRows);
  const departments = deptNames.map(name => {
    const t = totalsOf(gCur.get(name) || []), p = totalsOf(gPrev.get(name) || []), y = totalsOf(gYoy.get(name) || []);
    const lastDept = (months.get(lastMonth) || []).filter(r => r.department === name);
    return {
      department: name, headcount: period.months.length === 1 ? t.headcount : new Set(lastDept.map(r => r.user_id)).size, gross: t.gross, net: t.net, employer: t.employer, cost: t.cost, deductions: t.deductions,
      avg_gross: t.avg_gross, share_pct: cur.cost ? r2((t.cost / cur.cost) * 100) : 0,
      prev_cost: p.cost, variance: r2(t.cost - p.cost), variance_pct: pct(t.cost, p.cost), prev_share_pct: prev.cost ? r2((p.cost / prev.cost) * 100) : 0,
      yoy_cost: y.cost, yoy_variance_pct: pct(t.cost, y.cost),
    };
  }).filter(d => d.cost > 0 || d.prev_cost > 0).sort((a, b) => b.cost - a.cost);
  departments.forEach(d => { d.share_change_pts = r2(d.share_pct - d.prev_share_pct); });

  // department share over time (top departments of the period)
  const topDepts = departments.slice(0, 6).map(d => d.department);
  const deptTrend = trend.map(t => { const rows = months.get(t.ym) || [], tot = rows.reduce((a, r) => a + r.cost, 0); const o = { ym: t.ym, label: t.label }; for (const dn of topDepts) o[dn] = tot ? r2((rows.filter(r => r.department === dn).reduce((a, r) => a + r.cost, 0) / tot) * 100) : 0; return o; });

  // year-on-year table: the same month (or the whole FY) in every year that has data
  const yoyTable = [];
  if (period.mode === 'month') {
    const mm = period.months[0].slice(5);
    for (const y of [...new Set(available.map(a => a.slice(0, 4)))].sort()) { const k = `${y}-${mm}`; if (months.has(k)) { const t = totalsOf(months.get(k)); yoyTable.push({ label: monthLabel(k), ym: k, ...t }); } }
  } else {
    const fys = [...new Set(available.map(fyStartOf))].sort();
    for (const f of fys) { const t = totalsOf(pick(fyMonths(f))); yoyTable.push({ label: fyLabel(f), fy: f, ...t, avg_headcount: r2(fyMonths(f).filter(m => months.has(m)).reduce((a, m) => a + new Set(months.get(m).map(r => r.user_id)).size, 0) / Math.max(1, fyMonths(f).filter(m => months.has(m)).length)) }); }
  }
  yoyTable.forEach((r, i) => { const p = i ? yoyTable[i - 1] : null; r.growth_pct = p ? pct(r.cost, p.cost) : null; r.headcount_growth_pct = p ? pct(r.headcount, p.headcount) : null; r.avg_growth_pct = p ? pct(r.avg_gross, p.avg_gross) : null; });

  // average salary analysis (gross per employee-month in the period)
  const grosses = curRows.map(r => r.gross).filter(g => g > 0);
  const salary = {
    average: cur.avg_gross, median: r2(median(grosses)), min: grosses.length ? Math.min(...grosses) : 0, max: grosses.length ? Math.max(...grosses) : 0,
    bands: GROSS_BANDS.map(([lo, hi, label]) => ({ label, count: grosses.filter(g => g >= lo && g < hi).length })),
    by_department: departments.map(d => ({ department: d.department, avg_gross: d.avg_gross, headcount: d.headcount })).sort((a, b) => b.avg_gross - a.avg_gross),
    components: { basic: cur.basic, hra: cur.hra, other_allowances: cur.other_allowances },
  };

  // movement between the last month with data and the month before
  const everBefore = new Set(rowsAll.filter(r => r.ym < lastMonth).map(r => r.user_id));
  const mv = movements(lastRows, months.get(shiftYm(lastMonth, -1)) || [], everBefore);
  mv.base_label = monthLabel(shiftYm(lastMonth, -1)); mv.label = monthLabel(lastMonth); mv.has_base = months.has(shiftYm(lastMonth, -1));

  // data quality & review queue (the selected period)
  const flagged = curRows.filter(r => r.issues.length || r.warnings.length).map(r => ({ id: r.id, user_id: r.user_id, name: r.name, code: r.code, department: r.department, ym: r.ym, label: monthLabel(r.ym), gross: r.gross, net: r.net, issues: r.issues, warnings: r.warnings, corrected: r.corrected }));
  const activeEmps = (employees || []).filter(e => e.user_id && e.status === 'active' && (!deptFilter || e.department === deptFilter));
  const lastIds = new Set(lastRows.map(r => r.user_id));
  const missingPayslip = months.has(lastMonth) ? activeEmps.filter(e => !lastIds.has(e.user_id) && (!e.date_of_joining || String(e.date_of_joining).slice(0, 7) <= lastMonth)).map(e => ({ user_id: e.user_id, name: e.display_name || e.full_name || '', code: e.employee_code || '', department: e.department || '' })) : [];
  const inRange = (b) => period.months.includes(ym(b.year, b.month));
  const periodBatches = (batches || []).filter(inRange).sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  const batchTotals = periodBatches.reduce((a, b) => { for (const k of ['total', 'mapped', 'unmapped', 'duplicate', 'invalid', 'password_failed', 'extraction_failed']) a[k] += n0(b.counts?.[k]); return a; }, { total: 0, mapped: 0, unmapped: 0, duplicate: 0, invalid: 0, password_failed: 0, extraction_failed: 0 });
  const dataQuality = {
    records: curRows.length, flagged_count: flagged.length, flagged: flagged.slice(0, 200), duplicates_removed: duplicates,
    missing_payslips: { month: monthLabel(lastMonth), count: missingPayslip.length, list: missingPayslip.slice(0, 100) },
    corrected: curRows.filter(r => r.corrected).length,
    upload_history: periodBatches.slice(0, 30).map(b => ({ id: b.id, month: b.month, year: b.year, label: monthLabel(ym(b.year, b.month)), uploaded_at: b.uploaded_at, counts: b.counts })),
    upload_totals: batchTotals,
    employer_coverage: cur.employer_coverage,
  };

  // plain-language readout for management
  const insights = [];
  const dir = (v) => (v > 0 ? 'up' : 'down');
  if (period.mode !== 'month' || prev.cost) {
    if (prev.cost) insights.push({ level: Math.abs(pct(cur.cost, prev.cost)) >= 10 ? 'warn' : 'info', text: `Total payroll cost for ${period.label} is ₹${cur.cost.toLocaleString('en-IN')}, ${dir(cur.cost - prev.cost)} ${Math.abs(pct(cur.cost, prev.cost))}% (₹${Math.abs(r2(cur.cost - prev.cost)).toLocaleString('en-IN')}) from ${period.prevLabel}.` });
  }
  if (mv.has_base && beforeTot.cost) {
    const d = mv.drivers, total = r2(lastTot.cost - beforeTot.cost);
    insights.push({ level: 'info', text: `${monthLabel(lastMonth)} versus ${mv.base_label}: ${total >= 0 ? '+' : '−'}₹${Math.abs(total).toLocaleString('en-IN')} — ${mv.counts.joiners} joiner(s) added ₹${d.joiners_cost.toLocaleString('en-IN')}, ${mv.counts.exits} exit(s) removed ₹${Math.abs(d.exits_cost).toLocaleString('en-IN')}, and employees who stayed moved ${d.existing_change >= 0 ? '+' : '−'}₹${Math.abs(d.existing_change).toLocaleString('en-IN')} (increments, LOP, bonus or allowance changes).` });
  }
  const top = departments[0];
  if (top) insights.push({ level: 'info', text: `${top.department} is the largest payroll cost: ${top.share_pct}% of the total (₹${top.cost.toLocaleString('en-IN')}) for ${top.headcount} employee(s).` });
  const grew = [...departments].filter(d => d.prev_cost > 0 && d.variance_pct != null).sort((a, b) => b.variance - a.variance)[0];
  if (grew && grew.variance > 0) insights.push({ level: Math.abs(grew.variance_pct) >= 15 ? 'warn' : 'info', text: `${grew.department} rose the most: +₹${grew.variance.toLocaleString('en-IN')} (${grew.variance_pct}%) against ${period.prevLabel}.` });
  const fell = [...departments].filter(d => d.prev_cost > 0 && d.variance_pct != null).sort((a, b) => a.variance - b.variance)[0];
  if (fell && fell.variance < 0) insights.push({ level: 'info', text: `${fell.department} fell the most: −₹${Math.abs(fell.variance).toLocaleString('en-IN')} (${fell.variance_pct}%).` });
  if (mv.counts.significant) insights.push({ level: 'warn', text: `${mv.counts.significant} employee(s) had a gross change of ${SIGNIFICANT_PCT}% or more (and ₹${SIGNIFICANT_MIN.toLocaleString('en-IN')}+) in ${monthLabel(lastMonth)} — see Employee cost movements.` });
  if (dataQuality.flagged_count) insights.push({ level: 'warn', text: `${dataQuality.flagged_count} payslip record(s) in this period need review (missing or inconsistent figures) — figures above include them as extracted.` });
  if (missingPayslip.length) insights.push({ level: 'warn', text: `${missingPayslip.length} active employee(s) have no payslip for ${monthLabel(lastMonth)}.` });
  if (cur.employer_coverage.of && cur.employer_coverage.with < cur.employer_coverage.of) insights.push({ level: 'info', text: `Employer contributions are printed on ${cur.employer_coverage.with} of ${cur.employer_coverage.of} payslips; where they are not printed, total payroll cost equals gross salary.` });

  return {
    period: { mode: period.mode, label: period.label, months: period.months, prev_label: period.prevLabel, yoy_label: period.yoyLabel, fy: period.fy ?? null },
    available_months: available.map(m => ({ ym: m, label: monthLabel(m) })),
    available_fys: [...new Set(available.map(fyStartOf))].sort((a, b) => b - a).map(f => ({ value: f, label: fyLabel(f) })),
    departments_all: [...new Set(all.map(r => r.department))].sort(),
    summary, previous: { ...prev, label: period.prevLabel }, year_ago: { ...yoy, label: period.yoyLabel },
    comparison: { previous: compare(cur, prev), year_ago: compare(cur, yoy), has_previous: prev.records > 0, has_year_ago: yoy.records > 0 },
    trend, departments, department_trend: { depts: topDepts, points: deptTrend }, yoy_table: yoyTable, salary, movements: mv, data_quality: dataQuality, insights,
    definitions: { gross: 'Total earnings printed on the payslip', net: 'Take-home pay disbursed to the employee', deductions: 'Employee deductions (PF, ESI, PT, TDS, loan, LOP…) — taken out of gross, not an extra cost', employer: 'Employer PF / ESI etc. where the payslip prints them', cost: 'Total payroll cost = gross salary + employer contributions' },
  };
}
