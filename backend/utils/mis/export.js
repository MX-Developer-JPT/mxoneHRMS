// Excel + PDF exports for the Intelligent MIS. Both are built from the SAME result object the dashboard shows
// (utils/mis/analytics.js), so totals can never differ between screen and file.
import { fmtD } from './calendar.js';

const NAVY = 'FF1A3C5E', BLUE = 'FF2D5986', LIGHT = 'FFEEF2F7', GREY = 'FF6B7280';
const SEV_FILL = { Critical: 'FFFECACA', High: 'FFFED7AA', Medium: 'FFFEF08A', Low: 'FFE5E7EB', Informational: 'FFDBEAFE' };
const font = (b = false, color = 'FF1F2937', size = 10) => ({ name: 'Calibri', bold: b, size, color: { argb: color } });
const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
const bd = () => ({ top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } } });
const fmtPct = (v) => (v == null ? 'n/a' : `${v}%`);
const chgText = (k) => (k.pct != null ? `${k.pct > 0 ? '+' : ''}${k.pct}%` : (k.note || '—'));

export const METRIC_DEFINITIONS = [
  ['Active headcount', 'Employees with a joining date on/before the last day of the period and not past their last working day. Counts people, not attendance days.'],
  ['Joinings / Exits', 'Joining = date of joining in the period. Exit = last working day in the period; the separation takes effect the next day, so closing headcount = opening + joinings − exits.'],
  ['Scheduled employee-day (ED)', 'One employee on one day on which they were expected to work: within employment dates, a shift working day, not a holiday for their department, and not attendance-exempt. Weekly offs and holidays are excluded from every denominator.'],
  ['Physical presence', 'Present + Late + Short attendance (+ ½ per half-day in the rates). Approved leave, WFH and OD are NEVER counted as physical presence; they are separate categories.'],
  ['Physical presence rate', '(Present + Late + Short + ½ × Half-day) ÷ scheduled employee-days.'],
  ['Attendance compliance rate', '(Scheduled employee-days − Absent − Missing) ÷ scheduled employee-days. Leave, WFH, OD and half-days are accounted-for days.'],
  ['Missing attendance', 'A scheduled day (before today) with no attendance record. A confirmed absence is a record with status Absent — the two are reported separately.'],
  ['Incomplete punch session', 'A past day with a check-in but no check-out, or left "in progress".'],
  ['Late arrival', 'Status Late, or a present day flagged late beyond the shift grace period.'],
  ['Unexplained absence', 'Absent on a scheduled day with no approved leave covering it (a regularisation already changes the attendance status).'],
  ['Regularisation counts', 'Requests SUBMITTED in the period by their original submission time. Pending = waiting for the manager; Awaiting HR = manager approved; Approved = completed. "Pending backlog" is a snapshot of today.'],
  ['Late regularisation', 'Raised more than the configured number of days after the attendance date.'],
  ['Leave requests vs leave days', 'Requests are counted by application date. Approved leave days are counted by the days that fall inside the period on scheduled workdays (a half-day counts ½).'],
  ['Employees with no leave application', 'No leave request (any status) submitted in the window. Each case is classified from attendance evidence; absence of a request is not treated as good or bad.'],
  ['Open vacancies', 'On published requisitions: approved positions − candidates joined. NOT "requisitions − joinings". Snapshot of today.'],
  ['Gate pass open / overdue', 'Open = approved or departed with no return. Overdue = past the expected return time, or from an earlier day.'],
  ['Gate pass duration', 'Return − departure, only where both are recorded and the pass was not auto-closed (auto-closed returns are system times, not real ones).'],
  ['Reimbursement amounts', 'Claimed = all submitted; Approved = approved or paid; Paid = confirmed paid; Outstanding = claimed but not yet paid and not rejected. An approved claim is not treated as paid.'],
  ['Comparison period', 'Previous working day / week / month / quarter, same period last year, or custom. For a period still running, the comparison is cut to the same number of elapsed days. Percentage change is not shown when the comparison value is 0.'],
  ['Exceptions & insights', 'Indicators for verification, never findings about conduct. Each rule combines a configured threshold with population outlier detection when ≥30 people are available.'],
];

function sheet(wb, name, title, sub) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ showGridLines: false }] });
  ws.getCell('A1').value = title; ws.getCell('A1').font = font(true, 'FFFFFFFF', 14); ws.getCell('A1').fill = fill(NAVY);
  ws.getCell('A2').value = sub; ws.getCell('A2').font = font(false, 'FFFFFFFF', 9); ws.getCell('A2').fill = fill(BLUE);
  ws.getRow(1).height = 24;
  ws._cols = 8;
  return ws;
}
function banner(ws, cols) { for (let c = 1; c <= cols; c++) { ws.getRow(1).getCell(c).fill = fill(NAVY); ws.getRow(2).getCell(c).fill = fill(BLUE); } }
function heading(ws, text) { ws.addRow([]); const r = ws.addRow([text]); r.getCell(1).font = font(true, NAVY, 12); r.height = 20; }
function note(ws, text) { const r = ws.addRow([text]); r.getCell(1).font = font(false, GREY, 9); }
function table(ws, heads, rows, widths = [], opts = {}) {
  const h = ws.addRow(heads);
  h.eachCell(c => { c.font = font(true, 'FFFFFFFF'); c.fill = fill(BLUE); c.border = bd(); c.alignment = { vertical: 'middle', wrapText: true }; });
  h.height = 22;
  let i = 0;
  for (const row of rows) {
    const r = ws.addRow(row);
    r.eachCell({ includeEmpty: true }, (c, n) => {
      c.font = font(); c.border = bd(); c.alignment = { vertical: 'top', wrapText: typeof c.value === 'string' && String(c.value).length > 40 };
      if (i % 2) c.fill = fill(LIGHT);
      if (typeof c.value === 'number' && opts.pct?.includes(n - 1)) c.numFmt = '0.0"%"';
      else if (typeof c.value === 'number' && opts.money?.includes(n - 1)) c.numFmt = '#,##0.00';
      else if (typeof c.value === 'number' && !Number.isInteger(c.value)) c.numFmt = '0.0';
      if (opts.sevCol != null && n - 1 === opts.sevCol && SEV_FILL[c.value]) c.fill = fill(SEV_FILL[c.value]);
    });
    i++;
  }
  if (opts.total) { const t = ws.addRow(opts.total(rows)); t.eachCell(c => { c.font = font(true); c.fill = fill('FFDDE6F0'); c.border = bd(); }); }
  widths.forEach((w, idx) => { const col = ws.getColumn(idx + 1); if (!col.width || col.width < w) col.width = w; });
  return h;
}
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);

export async function buildMisIntelligenceWorkbook(res, registers, ExcelJS, opts = {}) {
  const { includeInsights = true, includeExceptions = true, includeDetail = true } = opts;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One'; wb.created = new Date();
  const m = res.meta, per = m.period, cmp = m.compare;
  const subtitle = `Period ${fmtD(per.from)} to ${fmtD(per.to)}   |   Comparison: ${cmp ? `${cmp.label} (${fmtD(cmp.from)} to ${fmtD(cmp.to)})` : 'none'}   |   Generated ${m.generatedAt.slice(0, 16).replace('T', ' ')} UTC   |   Scope: ${m.scoped ? 'Team (restricted)' : 'Company'}${Object.entries(m.filters || {}).filter(([, v]) => v && v !== 'all').map(([k, v]) => `   |   ${k}: ${v}`).join('')}`;
  const top = (name, title) => { const ws = sheet(wb, name, `Maxvolt Energy Industries Limited — ${title}`, subtitle); banner(ws, 12); return ws; };

  // 1. Executive summary
  let ws = top('Executive Summary', 'Intelligent MIS · Executive Summary');
  heading(ws, 'Key indicators');
  table(ws, ['Indicator', 'Current', 'Comparison', 'Change', 'Change %', 'Unit'], res.kpis.map(k => [k.label + (k.sub ? ` (${k.sub})` : ''), k.value, k.prev ?? 'n/a', k.abs ?? 'n/a', k.pct ?? chgText(k), k.unit]), [44, 14, 14, 12, 26, 14]);
  note(ws, 'ED = employee-days. Headcount is a count of people; the attendance indicators are counts of employee-days and must not be added to headcount.');
  if (includeInsights) {
    heading(ws, 'Management highlights');
    table(ws, ['Severity', 'Insight', 'Why it was raised', 'Suggested action', 'Owner'], res.insights.filter(i => i.status !== 'Dismissed').slice(0, 12).map(i => [i.severity, i.title, i.why, i.action, i.owner]), [14, 60, 60, 50, 22], { sevCol: 0 });
  }
  heading(ws, 'Population and calendar used');
  table(ws, ['Item', 'Value'], [['Active employees in scope (period end)', m.employeesInScope], ['Employees included in attendance', m.attendanceEmployees], ['Scheduled employee-days', m.workingCalendar.scheduledEmployeeDays], ['Holidays in period', m.workingCalendar.holidays.map(h => `${fmtD(h.date)} ${h.name}`).join('; ') || 'None'], ['Default shift', m.workingCalendar.defaultShift ? `${m.workingCalendar.defaultShift.name} (${(m.workingCalendar.defaultShift.days || []).join(', ')})` : 'n/a']], [44, 60]);

  // 2. KPI comparison (trend table)
  ws = top('KPI Comparison', 'KPI comparison with reasons');
  table(ws, ['Indicator', 'Current', 'Comparison', 'Absolute change', '% change', 'Direction', 'How it is calculated'], res.kpis.map(k => [k.label, k.value, k.prev ?? 'n/a', k.abs ?? 'n/a', k.pct ?? chgText(k), k.dir, k.help]), [34, 12, 12, 14, 24, 10, 90]);

  // 3. Attendance
  const A = res.attendance;
  ws = top('Attendance Analytics', 'Attendance analytics');
  heading(ws, 'Composition (employee-days)');
  const T = A.total, P = A.prevTotal;
  const cat = [['Present', 'present'], ['Late', 'late'], ['Short attendance', 'short'], ['Half-day', 'half'], ['Work from home', 'wfh'], ['On duty', 'od'], ['Approved leave', 'leave'], ['Absent', 'absent'], ['Missing record', 'missing']];
  table(ws, ['Category', 'Employee-days', 'Share of scheduled %', 'Comparison period'], cat.map(([l, k]) => [l, T[k], T.sched ? Math.round(T[k] / T.sched * 1000) / 10 : null, P ? P[k] : 'n/a']), [28, 16, 20, 18], { pct: [2], total: () => ['Scheduled employee-days', T.sched, 100, P ? P.sched : 'n/a'] });
  note(ws, `Physical presence rate ${fmtPct(T.rates.physical)} · Compliance rate ${fmtPct(T.rates.compliance)} · Late arrivals ${T.lateArrivals} · Incomplete sessions ${T.incomplete} · Average hours ${T.avgHours ?? 'n/a'}`);
  heading(ws, 'Day-wise trend');
  table(ws, ['Date', 'Present+Late', 'Half-day', 'WFH', 'OD', 'Leave', 'Absent', 'Missing', 'Late', 'Scheduled', 'Physical %', 'Compliance %'],
    A.trend.map(d => [fmtD(d.date), d.present, d.half, d.wfh, d.od, d.leave, d.absent, d.missing, d.late, d.sched, d.physical, d.compliance]), [14, 14, 10, 8, 8, 8, 9, 9, 8, 11, 12, 13], { pct: [10, 11] });
  heading(ws, 'Regularisation');
  const R = res.regularisation.counts;
  table(ws, ['Measure', 'Value'], [['Requests submitted', R.total], ['Pending (manager)', R.pending], ['Awaiting HR', R.awaitingHr], ['Approved', R.approved], ['Rejected', R.rejected], ['Cancelled', R.cancelled], ['Submitted after permitted window', R.late], ['Average approval time (hours)', R.avgApprovalHours ?? 'n/a'], ['Approved after the month closed', R.afterCutoff], ['Current backlog', res.regularisation.backlog], ['Backlog beyond SLA', res.regularisation.backlogOverSla]], [40, 16]);
  heading(ws, 'Approvers with pending requests');
  table(ws, ['Approver', 'Pending', 'Over SLA', 'Oldest (days)'], res.regularisation.managers.map(x => [x.name, x.pending, x.overSla, x.oldest]), [40, 12, 12, 14]);

  // 4. Leave
  const L = res.leave;
  ws = top('Leave Analytics', 'Leave analytics');
  table(ws, ['Measure', 'Current', 'Comparison'], [['Requests submitted', L.counts.requests, L.prev?.requests ?? 'n/a'], ['Approved', L.counts.approved, L.prev?.approved ?? 'n/a'], ['Pending', L.counts.pending, L.prev?.pending ?? 'n/a'], ['Rejected', L.counts.rejected, L.prev?.rejected ?? 'n/a'], ['Cancelled', L.counts.cancelled, L.prev?.cancelled ?? 'n/a'], ['Days requested', L.counts.daysRequested, L.prev?.daysRequested ?? 'n/a'], ['Approved leave days in period', L.counts.approvedDays, L.prev?.approvedDays ?? 'n/a'], ['Average duration of approved requests (days)', L.counts.avgDuration ?? 'n/a', L.prev?.avgDuration ?? 'n/a'], ['Short-notice requests', L.counts.shortNotice, L.prev?.shortNotice ?? 'n/a']], [46, 14, 14]);
  heading(ws, 'Approved leave days by type');
  table(ws, ['Leave type', 'Days'], Object.entries(L.byType).map(([k, v]) => [k, v]), [28, 12]);
  heading(ws, 'Approved leave days by department');
  table(ws, ['Department', 'Days'], Object.entries(L.byDept).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]), [28, 12]);
  heading(ws, 'Monthly trend (last 12 months, approved leave days)');
  table(ws, ['Month', 'Days'], Object.entries(L.trend).sort().map(([k, v]) => [k, v]), [14, 12]);
  heading(ws, 'Leave balances (as stored)');
  table(ws, ['Policy', 'Employees', 'Allocated', 'Accrued this year', 'Carried forward', 'Used', 'Used % of allocated + carried'], (L.balances || []).map(b => [b.code, b.employees, b.allocated, b.accrued, b.carried, b.used, b.utilisation]), [14, 12, 12, 16, 16, 10, 28], { pct: [6] });
  heading(ws, 'Employees with no leave applications');
  note(ws, 'Classified from attendance evidence. "Requires review" means the evidence did not support a specific explanation — it is not an adverse finding.');
  for (const w of Object.keys(L.noLeave)) {
    const x = L.noLeave[w];
    table(ws, [`Last ${w} days (${fmtD(x.from)} – ${fmtD(x.to)})`, 'Employees'], [...Object.entries(x.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]), ['Total with no application', x.total]], [46, 12]);
    ws.addRow([]);
  }
  if (includeExceptions) { heading(ws, 'Leave-pattern indicators'); table(ws, ['Indicator', 'Code', 'Employee / Dept', 'Observed', 'Baseline', 'Severity', 'Why flagged', 'Verification'], L.patterns.map(p => [p.type, p.code, p.name || p.dept, p.observed, p.baseline, p.sev, p.why, p.verify]), [34, 12, 28, 22, 30, 11, 50, 50], { sevCol: 5 }); }

  // 5. Workforce & recruitment
  const W = res.workforce;
  ws = top('Workforce and Recruitment', 'Workforce planning and recruitment');
  note(ws, 'Closing = Opening + Joinings − Exits. Transfers between departments, sanctioned positions and budgeted headcount are not recorded in MaxVolt One (shown as n/a).');
  table(ws, ['Department', 'Opening', 'Joinings', 'Exits', 'Transfers in', 'Transfers out', 'Closing', 'Net change', 'Change %', 'Reconciles'], W.departments.map(d => [d.dept, d.opening, d.joinings, d.exits, 'n/a', 'n/a', d.closing, d.net, d.netPct, d.reconciles ? 'Yes' : 'NO']), [30, 10, 10, 8, 12, 12, 10, 12, 11, 11], { pct: [8], total: () => ['COMPANY', W.company.opening, W.company.joinings, W.company.exits, 'n/a', 'n/a', W.company.closing, W.company.net, W.company.opening ? Math.round(W.company.net / W.company.opening * 1000) / 10 : null, W.company.reconciles ? 'Yes' : 'NO'] });
  heading(ws, 'Recruitment activity');
  const rc = W.recruitment;
  table(ws, ['Measure', 'Value'], [['Requisitions raised in period', rc.counts.raised], ['Requisitions approved in period', rc.counts.approved], ['Requisitions closed (all-time)', rc.counts.closed], ['Open published requisitions', rc.openReqs], ['Open vacancies (positions not yet filled)', rc.openVacancies], ['Applications received in period', rc.counts.applied], ['Interviews scheduled in period', rc.counts.interviews], ['Offers released (current pipeline)', rc.offers.released], ['Offers accepted (current)', rc.offers.accepted], ['Offers declined (current)', rc.offers.declined], ['Requisitions with no recent candidate activity', rc.stale], ['Published requisitions lacking full approval', rc.unapproved], ['Average time to fill / hire', 'Not available — closure and stage dates are not recorded']], [50, 40]);
  heading(ws, 'Recruitment funnel (current pipeline)');
  table(ws, ['Stage', 'Candidates'], rc.funnel.map(f => [f.stage, f.n]), [30, 12]);
  heading(ws, 'Open vacancies by department');
  table(ws, ['Department', 'Requisitions', 'Positions', 'Filled', 'Open', 'Open > ageing threshold'], rc.byDept.map(d => [d.dept, d.reqs, d.positions, d.filled, d.open, d.aged]), [30, 14, 12, 10, 10, 22]);
  heading(ws, 'Vacancy ageing');
  table(ws, ['Requisition ID', 'Position', 'Department', 'Raised', 'Approved positions', 'Filled', 'Remaining', 'Recruiter / owner', 'Status', 'Age (days)', 'Candidates', 'Last candidate activity'], rc.ageing.map(r => [r.id.slice(0, 8), r.title, r.dept, fmtD(r.raised), r.positions, r.filled, r.remaining, r.owner, r.status, r.age, r.candidates, fmtD(r.lastActivity)]), [14, 28, 22, 12, 12, 8, 10, 22, 12, 10, 11, 16]);

  // 6. Department summary
  ws = top('Department Summary', 'Department-wise summary');
  table(ws, ['Department', 'Head', 'Opening HC', 'Closing HC', 'Joinings', 'Exits', 'Net', 'Open vacancies', 'Present ED', 'Absent ED', 'Leave ED', 'Half-day ED', 'WFH ED', 'OD ED', 'Late', 'Regularisations', 'Missing / incomplete', 'Compliance %', 'Leave days', 'Gate passes', 'Pending approvals', 'Reimb. claims', 'Reimb. pending (Rs.)'],
    res.departments.map(d => [d.dept, d.head || 'n/a', d.opening, d.closing, d.joinings, d.exits, d.net, d.openVacancies, d.present, d.absent, d.leave, d.half, d.wfh, d.od, d.late, d.regularisations, d.missing, d.compliance, d.leaveDays, d.gatePasses, d.pendingApprovals, d.reimbClaims, d.reimbPending]), [28, 22, 10, 10, 9, 7, 7, 12, 10, 10, 9, 11, 8, 8, 7, 14, 17, 12, 10, 11, 14, 12, 16], { pct: [17] });
  note(ws, 'A blank / n/a compliance means the department had no scheduled employee-days in the period (not 100%).');

  // 7. Gate pass
  const G = res.gatepass;
  ws = top('Gate Pass Analytics', 'Gate pass and movement analytics');
  table(ws, ['Measure', 'Current', 'Comparison'], [['Gate passes created', G.counts.total, G.prev?.total ?? 'n/a'], ['Returned', G.counts.returned, G.prev?.returned ?? 'n/a'], ['Open (approved / departed)', G.counts.open, G.prev?.open ?? 'n/a'], ['Overdue', G.counts.overdue, G.prev?.overdue ?? 'n/a'], ['Auto-closed', G.counts.autoClosed, G.prev?.autoClosed ?? 'n/a'], ['Cancelled', G.counts.cancelled, G.prev?.cancelled ?? 'n/a'], ['Rejected', G.counts.rejected, G.prev?.rejected ?? 'n/a'], ['Pending approval', G.counts.pending, G.prev?.pending ?? 'n/a'], ['Average outing duration (min)', G.counts.avgDurationMin ?? 'n/a', G.prev?.avgDurationMin ?? 'n/a'], ['Passes used for duration', G.counts.durationSample, G.prev?.durationSample ?? 'n/a'], ['Employees with 2+ passes', G.counts.repeatEmployees, G.prev?.repeatEmployees ?? 'n/a']], [40, 14, 14]);
  heading(ws, 'By outing type'); table(ws, ['Type', 'Passes'], Object.entries(G.counts.byType).map(([k, v]) => [k.replace(/_/g, ' '), v]), [30, 10]);
  heading(ws, 'By status'); table(ws, ['Status', 'Passes'], Object.entries(G.counts.byStatus).map(([k, v]) => [k.replace(/_/g, ' '), v]), [30, 10]);
  heading(ws, 'By department'); table(ws, ['Department', 'Passes'], Object.entries(G.counts.byDept).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]), [30, 10]);
  if (includeExceptions) { heading(ws, 'Gate pass exceptions'); table(ws, ['Exception', 'Severity', 'Code', 'Employee', 'Department', 'Date', 'Status', 'Expected', 'Actual', 'Why', 'Recommended action'], G.exceptions.map(x => [x.kind, x.sev, x.code, x.name, x.dept, fmtD(x.date), x.status, x.expected, x.actual, x.why, x.action]), [30, 10, 12, 24, 22, 12, 14, 22, 20, 50, 50], { sevCol: 1 }); }

  // 8. Visitors
  const V = res.visitors;
  ws = top('Visitor Analytics', 'Visitor analytics');
  table(ws, ['Measure', 'Current', 'Comparison'], [['Total visitors', V.counts.total, V.prev?.total ?? 'n/a'], ['Walk-in', V.counts.walkIn, V.prev?.walkIn ?? 'n/a'], ['Pre-registered', V.counts.preRegistered, V.prev?.preRegistered ?? 'n/a'], ['Checked out', V.counts.checkedOut, V.prev?.checkedOut ?? 'n/a'], ['Pending approval', V.counts.pendingApproval, V.prev?.pendingApproval ?? 'n/a'], ['Still checked in', V.counts.stillIn, V.prev?.stillIn ?? 'n/a'], ['Missing check-out', V.counts.missingCheckout, V.prev?.missingCheckout ?? 'n/a'], ['Repeat visitors (same mobile)', V.counts.repeatVisitors, V.prev?.repeatVisitors ?? 'n/a'], ['Average actual visit (min)', V.counts.avgDurationMin ?? 'n/a', V.prev?.avgDurationMin ?? 'n/a'], ['Average expected visit (min)', V.counts.avgExpectedMin ?? 'n/a', 'n/a']], [36, 14, 14]);
  heading(ws, 'By host department'); table(ws, ['Department', 'Visitors'], Object.entries(V.counts.byDept).map(([k, v]) => [k, v]), [30, 10]);
  heading(ws, 'By day'); table(ws, ['Date', 'Visitors'], Object.entries(V.counts.byDay).sort().map(([k, v]) => [fmtD(k), v]), [16, 10]);
  heading(ws, 'Records needing attention'); table(ws, ['Issue', 'Visitor', 'Host', 'Department', 'Date', 'Why', 'Action'], V.issues.map(i => [i.kind, i.visitor, i.host, i.dept, fmtD(i.date), i.why, i.action]), [22, 24, 22, 20, 12, 40, 44]);

  // 9. Reimbursements
  const B = res.reimbursements;
  ws = top('Reimbursements', 'Reimbursement analytics');
  table(ws, ['Measure', 'Current', 'Comparison'], [['Claims submitted', B.counts.claims, B.prev?.claims ?? 'n/a'], ['Approved (incl. paid)', B.counts.approved, B.prev?.approved ?? 'n/a'], ['Rejected', B.counts.rejected, B.prev?.rejected ?? 'n/a'], ['Pending approval', B.counts.pending, B.prev?.pending ?? 'n/a'], ['Paid (confirmed)', B.counts.paid, B.prev?.paid ?? 'n/a'], ['Claimed amount (Rs.)', B.counts.claimedAmt, B.prev?.claimedAmt ?? 'n/a'], ['Approved amount (Rs.)', B.counts.approvedAmt, B.prev?.approvedAmt ?? 'n/a'], ['Paid amount (Rs.)', B.counts.paidAmt, B.prev?.paidAmt ?? 'n/a'], ['Outstanding amount (Rs.)', B.counts.outstandingAmt, B.prev?.outstandingAmt ?? 'n/a'], ['Average approval time (hours)', B.counts.avgApprovalHours ?? 'n/a', B.prev?.avgApprovalHours ?? 'n/a']], [36, 16, 16], { money: [1, 2] });
  heading(ws, 'By claim type'); table(ws, ['Type', 'Claims', 'Amount (Rs.)'], Object.entries(B.counts.byType).map(([k, v]) => [k, v.n, v.amt]), [26, 10, 16], { money: [2] });
  heading(ws, 'By department'); table(ws, ['Department', 'Claims', 'Amount (Rs.)', 'Pending (Rs.)'], Object.entries(B.counts.byDept).map(([k, v]) => [k, v.n, v.amt, v.pendingAmt]), [26, 10, 16, 16], { money: [2, 3] });
  heading(ws, 'Claims for review (potential duplicates / ageing)'); table(ws, ['Flag', 'Code', 'Employee', 'Department', 'Amount (Rs.)', 'Date', 'Why', 'Action'], B.issues.map(i => [i.kind, i.code, i.name, i.dept, i.amount, fmtD(i.date), i.why, i.action]), [28, 12, 24, 20, 14, 12, 40, 40], { money: [4] });
  note(ws, 'Flags are prompts for review, not allegations.');

  // 10. Exceptions & insights
  ws = top('Exceptions and Insights', 'Exceptions and management insights');
  if (includeInsights) {
    heading(ws, 'Insights');
    table(ws, ['Severity', 'Category', 'Title', 'Department / population', 'Current', 'Comparison', 'Change', 'Change %', 'Evidence', 'Why generated', 'Suggested action', 'Owner', 'Detected', 'Status'],
      res.insights.map(i => [i.severity, i.category, i.title, i.dept, i.current ?? 'n/a', i.comparison ?? 'n/a', i.abs ?? 'n/a', i.pct ?? i.note ?? 'n/a', i.evidence, i.why, i.action, i.owner, fmtD(i.detected), i.status]), [11, 14, 56, 22, 10, 11, 9, 12, 60, 50, 50, 20, 12, 14], { sevCol: 0 });
  }
  if (includeExceptions) {
    heading(ws, 'Attendance exceptions (indicators for verification — not findings about conduct)');
    table(ws, ['Exception', 'Severity', 'Code', 'Employee', 'Department', 'Period', 'Observed', 'Baseline', 'Variance', 'Dates', 'Why flagged', 'Recommended verification'],
      (registers.exceptions || []).map(x => [x.type, x.sev, x.code, x.name, x.dept, x.period, x.observed, x.baseline, x.variance, x.dates, x.why, x.verify]), [34, 10, 12, 24, 22, 22, 18, 30, 12, 30, 50, 50], { sevCol: 1 });
  }

  // 11. Data quality & reconciliation
  ws = top('Data Quality and Reconciliation', 'Data quality and reconciliation');
  heading(ws, 'Reconciliation checks');
  table(ws, ['Check', 'Result', 'Detail'], res.reconciliation.map(r => [r.check, r.ok ? 'Pass' : 'FAIL', r.detail]), [60, 10, 40]);
  heading(ws, 'Data quality');
  table(ws, ['Check', 'Source', 'Affected records', 'Severity', 'Likely cause', 'Recommended correction', 'Examples'], res.dataQuality.map(d => [d.title, d.source, d.count, d.sev, d.cause, d.fix, d.samples.join('; ')]), [44, 20, 14, 10, 50, 44, 60], { sevCol: 3 });
  heading(ws, 'Known limitations of this report');
  for (const l of res.limitations) { const r = ws.addRow([l]); r.getCell(1).font = font(false, 'FF1F2937', 10); r.getCell(1).alignment = { wrapText: true }; }
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width || 0, 60);

  // definitions
  ws = top('Definitions', 'Metric definitions and methodology');
  table(ws, ['Metric', 'Definition'], METRIC_DEFINITIONS, [34, 130]);
  heading(ws, 'Thresholds in use'); table(ws, ['Setting', 'Value'], Object.entries(m.config).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]), [34, 30]);

  if (includeDetail) {
    const detail = (name, title, heads, rows, widths) => { const s = top(name, title); table(s, heads, rows, widths); s.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }]; };
    detail('Reg Register', 'Regularisation register', ['Code', 'Employee', 'Department', 'Attendance date', 'Original status', 'Requested in', 'Requested out', 'Reason', 'Status', 'Approver', 'Approved at', 'Submitted', 'Days late', 'After month close'], (registers.regularisation || []).map(r => [r.code, r.name, r.dept, fmtD(r.date), r.original, r.requestedIn, r.requestedOut, r.reason, r.status, r.approver, (r.approvedAt || '').slice(0, 16).replace('T', ' '), (r.submittedAt || '').slice(0, 16).replace('T', ' '), r.lateBy, r.afterCutoff ? 'Yes' : '']), [12, 24, 20, 14, 16, 12, 12, 40, 16, 22, 18, 18, 10, 14]);
    detail('Gate Pass Register', 'Gate pass register', ['Pass ID', 'Code', 'Employee', 'Department', 'Outing type', 'Purpose', 'Created', 'Approval', 'Status', 'Exit', 'Expected return', 'Returned', 'Duration (min)', 'Closure', 'Approver'], (registers.gatepass || []).map(g => [g.id.slice(0, 8), g.code, g.name, g.dept, g.type, g.reason, (g.created || '').slice(0, 16).replace('T', ' '), g.approval, g.status, (g.exit || '').slice(0, 16).replace('T', ' '), (g.expected || '').slice(0, 16).replace('T', ' '), (g.returned || '').slice(0, 16).replace('T', ' '), g.durationMin ?? '', g.closure, g.approver]), [10, 12, 24, 20, 18, 30, 18, 14, 14, 18, 18, 18, 14, 14, 22]);
    detail('Leave Register', 'Leave requests', ['Code', 'Employee', 'Department', 'Type', 'From', 'To', 'Days', 'Half-day', 'Status', 'Applied', 'Notice (days)', 'Reason'], (registers.leave || []).map(l => [l.code, l.name, l.dept, l.type, fmtD(l.from), fmtD(l.to), l.days, l.half ? 'Yes' : '', l.status, fmtD(l.applied), l.notice, l.reason]), [12, 24, 20, 18, 12, 12, 8, 10, 12, 12, 12, 40]);
    detail('Employee Attendance', 'Employee-wise attendance (employee-days)', ['Code', 'Employee', 'Department', 'Designation', 'Scheduled', 'Present', 'Late', 'Short', 'Half-day', 'WFH', 'OD', 'Leave', 'Absent', 'Missing', 'Incomplete', 'Late arrivals', 'Hours', 'Physical %', 'Compliance %'], (registers.employees_attendance || []).map(e => [e.code, e.name, e.dept, e.designation, e.scheduled, e.present, e.late, e.short, e.half, e.wfh, e.od, e.leave, e.absent, e.missing, e.incomplete, e.lateArrivals, e.hours, e.physicalPct, e.compliancePct]), [12, 24, 20, 22, 10, 9, 7, 7, 9, 7, 7, 8, 8, 9, 11, 12, 9, 11, 13]);
    const nl = (registers['no_leave_90'] || []);
    detail('No Leave 90d', 'Employees with no leave application — last 90 days', ['Code', 'Employee', 'Department', 'Classification', 'Why', 'Scheduled days', 'Physical days', 'WFH', 'OD', 'Regularisations', 'Unexplained absences', 'Missing / incomplete'], nl.map(r => [r.code, r.name, r.dept, r.class, r.why, r.scheduled, r.physical, r.wfh, r.od, r.regularisations, r.absentUnexplained, r.missing]), [12, 24, 20, 30, 60, 12, 12, 7, 7, 15, 20, 18]);
    detail('Joiners and Exits', 'Joinings and exits in period', ['Type', 'Code', 'Employee', 'Department', 'Designation', 'Date', 'Location'], [...(registers.joiners || []).map(r => ['Joining', r.code, r.name, r.dept, r.designation, fmtD(r.date), r.location]), ...(registers.exits || []).map(r => ['Last working day', r.code, r.name, r.dept, r.designation, fmtD(r.date), ''])], [16, 12, 24, 22, 24, 14, 20]);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `MIS_Intelligence_${per.from}_to_${per.to}.xlsx` };
}

// ── PDF (pdfmake docDefinition) ───────────────────────────────────────────
const C = { navy: '#1A3C5E', blue: '#2D5986', grey: '#6B7280', light: '#EEF2F7', up: '#15803D', down: '#B91C1C' };
const SEV_COL = { Critical: '#FECACA', High: '#FED7AA', Medium: '#FEF08A', Low: '#E5E7EB', Informational: '#DBEAFE' };
const asciiRs = (s) => String(s ?? '').replace(/₹/g, 'Rs.');
const cell = (t, o = {}) => ({ text: asciiRs(t), fontSize: 7.5, ...o });
const hcell = (t) => ({ text: t, bold: true, color: '#FFFFFF', fillColor: C.blue, fontSize: 7.5 });
function tbl(heads, rows, widths, { sevCol = null, max = 40 } = {}) {
  const body = [heads.map(hcell), ...rows.slice(0, max).map((r, i) => r.map((v, ci) => cell(v == null ? '' : v, { fillColor: sevCol === ci && SEV_COL[v] ? SEV_COL[v] : (i % 2 ? C.light : undefined) })))];
  if (rows.length > max) body.push([{ text: `… ${rows.length - max} more row(s) — see the Excel export`, colSpan: heads.length, italics: true, fontSize: 7, color: C.grey }, ...Array(heads.length - 1).fill({})]);
  return { table: { headerRows: 1, widths, body, dontBreakRows: true }, layout: { hLineColor: () => '#D1D5DB', vLineColor: () => '#D1D5DB', hLineWidth: () => 0.4, vLineWidth: () => 0.4 }, margin: [0, 2, 0, 8] };
}
// horizontal bar chart drawn with canvas rectangles
function bars(title, items, { max = null, unit = '', width = 360 } = {}) {
  const mx = max ?? Math.max(1, ...items.map(i => i.v || 0));
  const rows = items.slice(0, 14);
  return { margin: [0, 2, 0, 8], stack: [{ text: title, bold: true, fontSize: 9, color: C.navy, margin: [0, 0, 0, 3] }, ...rows.map(i => ({ columns: [{ text: asciiRs(i.l), fontSize: 7.5, width: 120 }, { canvas: [{ type: 'rect', x: 0, y: 1, w: Math.max(1, (i.v || 0) / mx * width), h: 8, color: i.c || C.blue }], width }, { text: `${i.v ?? 'n/a'}${unit}`, fontSize: 7.5, margin: [4, 0, 0, 0] }], margin: [0, 1, 0, 1] }))] };
}
function trendBars(title, series, { height = 70 } = {}) {
  if (!series.length) return { text: '' };
  const mx = Math.max(1, ...series.map(s => s.sched || 0)), w = Math.max(2, Math.min(14, Math.floor(480 / series.length) - 1));
  const cv = [];
  series.forEach((s, i) => { const x = i * (w + 1); const hP = (s.present / mx) * height, hO = ((s.wfh + s.od + s.half + s.leave) / mx) * height, hA = ((s.absent + s.missing) / mx) * height; let y = height; y -= hP; cv.push({ type: 'rect', x, y, w, h: hP, color: '#2D5986' }); y -= hO; cv.push({ type: 'rect', x, y, w, h: hO, color: '#93C5FD' }); y -= hA; cv.push({ type: 'rect', x, y, w, h: hA, color: '#F87171' }); });
  return { margin: [0, 2, 0, 8], stack: [{ text: title, bold: true, fontSize: 9, color: C.navy, margin: [0, 0, 0, 3] }, { canvas: cv }, { text: `Dark blue = physically present · light blue = WFH/OD/half-day/leave · red = absent or missing record. ${fmtD(series[0].date)} to ${fmtD(series[series.length - 1].date)} (scheduled employee-days per day).`, fontSize: 7, color: C.grey, margin: [0, 3, 0, 0] }] };
}

export function buildMisIntelligencePdf(res, registers, opts = {}) {
  const { includeInsights = true, includeExceptions = true, includeCharts = true } = opts;
  const m = res.meta, per = m.period, cmp = m.compare, A = res.attendance, T = A.total;
  const content = [];
  content.push({ text: 'Maxvolt Energy Industries Limited', fontSize: 10, color: C.grey });
  content.push({ text: 'Intelligent MIS Report', fontSize: 22, bold: true, color: C.navy, margin: [0, 2, 0, 2] });
  content.push({ text: `${per.label}   (${fmtD(per.from)} to ${fmtD(per.to)})`, fontSize: 12, color: C.blue });
  content.push({ text: `Compared with: ${cmp ? `${cmp.label} (${fmtD(cmp.from)} to ${fmtD(cmp.to)})` : 'no comparison'}`, fontSize: 9, color: C.grey });
  content.push({ text: `Scope: ${m.scoped ? 'Reporting team' : 'Company'}${Object.entries(m.filters || {}).filter(([, v]) => v && v !== 'all').map(([k, v]) => ` · ${k}: ${v}`).join('')} · ${m.employeesInScope} active employees · generated ${m.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, fontSize: 8, color: C.grey, margin: [0, 0, 0, 10] });

  content.push({ text: 'Executive summary', style: 'h' });
  const hi = res.insights.filter(i => i.status !== 'Dismissed' && ['Critical', 'High', 'Medium'].includes(i.severity)).slice(0, 6);
  content.push({ text: `Attendance compliance ${fmtPct(T.rates.compliance)} and physical presence ${fmtPct(T.rates.physical)} across ${T.sched} scheduled employee-days. Headcount closed at ${res.workforce.company.closing} (${res.workforce.company.net >= 0 ? '+' : ''}${res.workforce.company.net}); ${res.workforce.recruitment.openVacancies} position(s) remain open.`, fontSize: 9, margin: [0, 0, 0, 6] });
  // KPI grid, 4 per row
  const kp = res.kpis, rowsK = [];
  for (let i = 0; i < kp.length; i += 4) rowsK.push(kp.slice(i, i + 4));
  content.push({ table: { widths: ['*', '*', '*', '*'], body: rowsK.map(r => [...r, ...Array(4 - r.length).fill(null)].map(k => k ? { stack: [{ text: k.label, fontSize: 7, color: C.grey }, { text: String(k.value ?? 'n/a'), fontSize: 15, bold: true, color: C.navy }, { text: k.prev == null ? 'no comparison' : `vs ${k.prev} · ${chgText(k)}`, fontSize: 7, color: k.dir === 'up' ? C.up : k.dir === 'down' ? C.down : C.grey }, k.sub ? { text: k.sub, fontSize: 6.5, color: C.grey } : { text: '' }], margin: [3, 3, 3, 3] } : { text: '' })) }, layout: { hLineColor: () => '#D1D5DB', vLineColor: () => '#D1D5DB', hLineWidth: () => 0.5, vLineWidth: () => 0.5 }, margin: [0, 0, 0, 4] });
  content.push({ text: 'ED = employee-days. Headcount counts people; attendance figures count employee-days and are not additive with headcount.', fontSize: 7, color: C.grey, margin: [0, 0, 0, 8] });

  if (includeInsights && hi.length) {
    content.push({ text: 'Major changes and exceptions', style: 'h' });
    content.push(tbl(['Severity', 'Insight', 'Evidence', 'Suggested action'], hi.map(i => [i.severity, i.title, i.evidence || i.why, i.action]), [48, 180, 150, 140], { sevCol: 0 }));
  }

  content.push({ text: 'Attendance', style: 'h', pageBreak: 'before' });
  content.push(tbl(['Category', 'Employee-days', '% of scheduled', 'Comparison'], [['Present', 'present'], ['Late', 'late'], ['Short attendance', 'short'], ['Half-day', 'half'], ['Work from home', 'wfh'], ['On duty', 'od'], ['Approved leave', 'leave'], ['Absent', 'absent'], ['Missing record', 'missing']].map(([l, k]) => [l, T[k], T.sched ? `${Math.round(T[k] / T.sched * 1000) / 10}%` : 'n/a', A.prevTotal ? A.prevTotal[k] : 'n/a']), [150, 90, 90, 90]));
  if (includeCharts) {
    content.push(trendBars('Daily attendance composition', A.trend));
    content.push(bars('Attendance compliance % by department (min 30 scheduled ED)', res.departments.filter(d => d.compliance != null && d.sched >= m.config.minSample).sort((a, b) => a.compliance - b.compliance).map(d => ({ l: d.dept, v: d.compliance, c: d.compliance < 85 ? '#F87171' : C.blue })), { max: 100, unit: '%' }));
  }
  content.push({ text: 'Regularisation', style: 'h2' });
  const R = res.regularisation.counts;
  content.push(tbl(['Submitted', 'Pending', 'Awaiting HR', 'Approved', 'Rejected', 'Late requests', 'Avg approval (h)', 'Backlog > SLA'], [[R.total, R.pending, R.awaitingHr, R.approved, R.rejected, R.late, R.avgApprovalHours ?? 'n/a', res.regularisation.backlogOverSla]], Array(8).fill('*')));

  content.push({ text: 'Department comparison', style: 'h', pageBreak: 'before' });
  content.push(tbl(['Department', 'Open HC', 'Close HC', 'Join', 'Exit', 'Vac.', 'Present', 'Absent', 'Leave', 'WFH', 'OD', 'Late', 'Missing', 'Compl.%', 'GP'], res.departments.map(d => [d.dept, d.opening, d.closing, d.joinings, d.exits, d.openVacancies, d.present, d.absent, d.leave, d.wfh, d.od, d.late, d.missing, d.compliance ?? 'n/a', d.gatePasses]), [92, 28, 28, 22, 22, 24, 34, 32, 28, 24, 28, 24, 32, 32, 22], { max: 30 }));
  content.push({ text: 'Present / Absent / Leave / WFH / OD / Late / Missing are employee-days. Transfers are not recorded in MaxVolt One.', fontSize: 7, color: C.grey });

  content.push({ text: 'Workforce and recruitment', style: 'h' });
  const W = res.workforce, rc = W.recruitment;
  content.push(tbl(['Opening', 'Joinings', 'Exits', 'Closing', 'Net', 'Open vacancies', 'Requisitions raised', 'Offers accepted'], [[W.company.opening, W.company.joinings, W.company.exits, W.company.closing, W.company.net, rc.openVacancies, rc.counts.raised, rc.offers.accepted]], Array(8).fill('*')));
  if (includeCharts) content.push(bars('Open vacancies by department', rc.byDept.filter(d => d.open > 0).map(d => ({ l: d.dept, v: d.open }))));
  content.push(tbl(['Position', 'Department', 'Positions', 'Filled', 'Remaining', 'Age (d)', 'Candidates'], rc.ageing.slice(0, 15).map(r => [r.title, r.dept, r.positions, r.filled, r.remaining, r.age, r.candidates]), [150, 110, 45, 40, 50, 40, 55], { max: 15 }));

  content.push({ text: 'Leave', style: 'h', pageBreak: 'before' });
  const L = res.leave;
  content.push(tbl(['Requests', 'Approved', 'Pending', 'Rejected', 'Cancelled', 'Approved leave days', 'Avg duration (d)', 'Short notice'], [[L.counts.requests, L.counts.approved, L.counts.pending, L.counts.rejected, L.counts.cancelled, L.counts.approvedDays, L.counts.avgDuration ?? 'n/a', L.counts.shortNotice]], Array(8).fill('*')));
  const n90 = L.noLeave[90] || L.noLeave[Object.keys(L.noLeave)[0]];
  if (n90) { content.push({ text: `Employees with no leave application (last ${n90.window} days): ${n90.total}`, style: 'h2' }); content.push(tbl(['Classification', 'Employees'], Object.entries(n90.byClass).sort((a, b) => b[1] - a[1]), [260, 80])); content.push({ text: 'Classified from attendance evidence; the absence of a request is not treated as good or bad.', fontSize: 7, color: C.grey }); }

  content.push({ text: 'Gate pass and visitors', style: 'h' });
  const G = res.gatepass.counts, V = res.visitors.counts;
  content.push(tbl(['Passes', 'Returned', 'Open', 'Overdue', 'Auto-closed', 'Avg duration (min)', 'Visitors', 'Walk-in', 'Missing check-out'], [[G.total, G.returned, G.open, G.overdue, G.autoClosed, G.avgDurationMin ?? 'n/a', V.total, V.walkIn, V.missingCheckout]], Array(9).fill('*')));
  if (includeExceptions && res.gatepass.exceptions.length) content.push(tbl(['Exception', 'Sev.', 'Employee', 'Dept', 'Why'], res.gatepass.exceptions.slice(0, 15).map(x => [x.kind, x.sev, x.name, x.dept, x.why]), [110, 40, 100, 80, 170], { sevCol: 1, max: 15 }));

  content.push({ text: 'Reimbursements', style: 'h' });
  const B = res.reimbursements.counts;
  content.push(tbl(['Claims', 'Approved', 'Pending', 'Rejected', 'Claimed (Rs.)', 'Approved (Rs.)', 'Paid (Rs.)', 'Outstanding (Rs.)'], [[B.claims, B.approved, B.pending, B.rejected, B.claimedAmt, B.approvedAmt, B.paidAmt, B.outstandingAmt]], Array(8).fill('*')));

  if (includeExceptions) {
    content.push({ text: 'Exceptions requiring action', style: 'h', pageBreak: 'before' });
    content.push({ text: 'These are indicators to verify, not findings about conduct.', fontSize: 8, color: C.grey });
    content.push(tbl(['Exception', 'Sev.', 'Employee / Dept', 'Observed', 'Baseline', 'Verification'], (registers.exceptions || []).slice(0, 30).map(x => [x.type, x.sev, `${x.name || ''} ${x.code ? `(${x.code})` : ''} ${x.dept}`.trim(), x.observed, x.baseline, x.verify]), [100, 36, 110, 55, 90, 100], { sevCol: 1, max: 30 }));
  }
  content.push({ text: 'Recommended management actions', style: 'h' });
  content.push({ ul: res.insights.filter(i => i.status !== 'Dismissed' && i.severity !== 'Informational').slice(0, 8).map(i => ({ text: `${i.action} — ${i.owner} (${i.title})`, fontSize: 8.5, margin: [0, 1, 0, 1] })) });

  content.push({ text: 'Data quality and reconciliation', style: 'h', pageBreak: 'before' });
  content.push(tbl(['Reconciliation check', 'Result', 'Detail'], res.reconciliation.map(r => [r.check, r.ok ? 'Pass' : 'FAIL', r.detail]), [260, 40, 150]));
  content.push(tbl(['Data quality check', 'Records', 'Severity', 'Recommended correction'], res.dataQuality.filter(d => d.count).map(d => [d.title, d.count, d.sev, d.fix]), [200, 45, 45, 190], { sevCol: 2 }));
  content.push({ text: 'Methodology and definitions', style: 'h' });
  content.push(tbl(['Metric', 'Definition'], METRIC_DEFINITIONS, [110, 355], { max: 40 }));
  content.push({ text: 'Data limitations', style: 'h2' });
  content.push({ ul: res.limitations.map(l => ({ text: l, fontSize: 8 })) });

  return {
    pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [40, 46, 40, 44],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#1F2937' },
    styles: { h: { fontSize: 13, bold: true, color: C.navy, margin: [0, 8, 0, 4] }, h2: { fontSize: 10, bold: true, color: C.blue, margin: [0, 6, 0, 3] } },
    header: (page) => (page === 1 ? null : { text: `Maxvolt One · Intelligent MIS · ${fmtD(per.from)} – ${fmtD(per.to)}`, fontSize: 7, color: C.grey, margin: [40, 20, 40, 0] }),
    footer: (page, pages) => ({ columns: [{ text: `Generated ${m.generatedAt.slice(0, 16).replace('T', ' ')} UTC · Confidential`, fontSize: 7, color: C.grey }, { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7, color: C.grey }], margin: [40, 12, 40, 0] }),
    content,
    filename: `MIS_Intelligence_${per.from}_to_${per.to}.pdf`,
  };
}
