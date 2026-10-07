// MIS (management information system) workbook — daily / weekly / monthly, company-wide,
// for one department, or department-wise (a summary plus one sheet per department).
//
// Sections: attendance summary, new joinings, visitors (walk-in + invited), gate passes,
// recruitment, reimbursements, leave. Everything is read straight from the live data.
import { all } from '../db.js';

const IST_MS = 5.5 * 3600000;
const pj = (rows) => rows.map(r => { try { return { ...JSON.parse(r.data), _created: r.created_at ? String(r.created_at).slice(0, 10) : '' }; } catch { return null; } }).filter(Boolean);
const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const fmtD = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}`; };
const fmtT = (t) => {
  if (!t) return '';
  const d = new Date(String(t).replace(/Z$/, ''));
  if (isNaN(d.getTime())) return '';
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
};
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function resolveRange(period, anchor) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(anchor || '')) ? anchor : istDate();
  if (period === 'weekly') {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
    const from = addDays(date, -((dow + 6) % 7)); // Monday
    return { from, to: addDays(from, 6), title: `Weekly MIS — ${fmtD(from)} to ${fmtD(addDays(from, 6))}`, key: `Weekly_${from}` };
  }
  if (period === 'monthly') {
    const [y, m] = date.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { from, to, title: `Monthly MIS — ${name}`, key: `Monthly_${name.replace(' ', '_')}` };
  }
  return { from: date, to: date, title: `Daily MIS — ${fmtD(date)}`, key: `Daily_${date}` };
}

function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Mirrors the frontend effectiveStatus(): a past "in_progress" day reads as present/absent by hours;
// a half-day LEAVE counts as present.
function effStatus(a, today) {
  if (!a) return null;
  if (a.status === 'half_day' && a.leave_id && a.leave_half_day) return 'present';
  if (a.status === 'in_progress') {
    if (a.date === today) return 'in_progress';
    return (a.working_hours > 0 || a.total_working_minutes > 0) ? 'present' : 'absent';
  }
  return a.status || (a.check_in_time ? 'present' : 'absent');
}
const PRESENT = new Set(['present', 'late', 'on_duty', 'work_from_home', 'short_attendance', 'in_progress']);

export async function collectMis({ period, date, department }) {
  const range = resolveRange(period, date);
  const { from, to } = range;
  const today = istDate();
  const days = daysBetween(from, to);

  const employees = pj(await all("SELECT data, created_at FROM entities WHERE type='Employee'"));
  const active = employees.filter(e => e.status !== 'inactive' && e.is_active !== false);
  const empByUser = {};
  for (const e of employees) if (e.user_id) empByUser[e.user_id] = e;
  const deptOf = (uid) => empByUser[uid]?.department || 'Unassigned';
  const deptFilter = department && department !== 'all' ? department : null;
  const inDept = (d) => !deptFilter || d === deptFilter;

  const depts = [...new Set(active.map(e => e.department || 'Unassigned'))].filter(inDept).sort();
  const scopeEmps = active.filter(e => inDept(e.department || 'Unassigned') && !e.is_attendance_exempt);

  // ── Attendance ──
  const attRows = pj(await all("SELECT data, created_at FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [from, to]));
  const attBy = {}; // uid|date -> record
  for (const a of attRows) { if (a.user_id && a.date) attBy[`${a.user_id}|${String(a.date).slice(0, 10)}`] = a; }
  const holidays = new Set(pj(await all("SELECT data, created_at FROM entities WHERE type='Holiday'")).map(h => String(h.date || '').slice(0, 10)));

  const attendance = { perEmp: [], perDay: [], perDept: {}, totals: { present: 0, absent: 0, leave: 0, half_day: 0, wfh: 0, od: 0, late: 0, marked: 0 } };
  for (const d of depts) attendance.perDept[d] = { headcount: 0, present: 0, absent: 0, leave: 0, half_day: 0, wfh: 0, od: 0, late: 0, mins: 0 };
  for (const e of scopeEmps) attendance.perDept[e.department || 'Unassigned'].headcount++;

  const dayAgg = {};
  for (const d of days) dayAgg[d] = { date: d, present: 0, absent: 0, leave: 0, half_day: 0, wfh: 0, od: 0, late: 0, notMarked: 0, holiday: holidays.has(d) };
  for (const e of scopeEmps) {
    const dep = e.department || 'Unassigned';
    const row = { code: e.employee_code || '', name: e.display_name || '', dept: dep, designation: e.designation || '', P: 0, A: 0, L: 0, HD: 0, WFH: 0, OD: 0, late: 0, hours: 0, status: '', in: '', out: '' };
    for (const d of days) {
      const a = attBy[`${e.user_id}|${d}`];
      const s = effStatus(a, today);
      const agg = dayAgg[d], pd = attendance.perDept[dep];
      if (!a) { if (d <= today && !holidays.has(d) && new Date(d + 'T00:00:00Z').getUTCDay() !== 0) agg.notMarked++; continue; }
      if (['week_off', 'holiday'].includes(s)) continue;
      attendance.totals.marked++;
      if (PRESENT.has(s)) { row.P++; agg.present++; pd.present++; attendance.totals.present++; }
      if (s === 'work_from_home') { row.WFH++; agg.wfh++; pd.wfh++; attendance.totals.wfh++; }
      if (s === 'on_duty') { row.OD++; agg.od++; pd.od++; attendance.totals.od++; }
      if (s === 'late' || a.late_arrival) { row.late++; agg.late++; pd.late++; attendance.totals.late++; }
      if (s === 'absent') { row.A++; agg.absent++; pd.absent++; attendance.totals.absent++; }
      if (s === 'leave') { row.L++; agg.leave++; pd.leave++; attendance.totals.leave++; }
      if (s === 'half_day') { row.HD++; agg.half_day++; pd.half_day++; attendance.totals.half_day++; }
      const mins = a.total_working_minutes || Math.round((a.working_hours || 0) * 60);
      row.hours += mins / 60; pd.mins += mins;
      if (period === 'daily' || days.length === 1) { row.status = label(s); row.in = fmtT(a.check_in_time); row.out = fmtT(a.check_out_time); }
    }
    row.hours = Math.round(row.hours * 100) / 100;
    attendance.perEmp.push(row);
  }
  attendance.perDay = days.map(d => dayAgg[d]);

  // ── New joinings ──
  const joinings = employees.filter(e => e.date_of_joining && String(e.date_of_joining).slice(0, 10) >= from && String(e.date_of_joining).slice(0, 10) <= to && inDept(e.department || 'Unassigned'))
    .sort((a, b) => String(a.date_of_joining).localeCompare(String(b.date_of_joining)));

  // ── Visitors (walk-in + invited) ──
  const visitors = pj(await all("SELECT data, created_at FROM entities WHERE type='Visitor'"))
    .filter(v => { const d = String(v.expected_arrival || v.check_in_time || v._created || '').slice(0, 10); return d >= from && d <= to; })
    .map(v => {
      const hostDept = (v.host_user_id && empByUser[v.host_user_id]?.department)
        || employees.find(e => v.host_name && String(e.display_name || '').toLowerCase() === String(v.host_name).toLowerCase())?.department || 'Unassigned';
      return { ...v, hostDept, kind: v.source === 'walk_in' ? 'Walk-in' : 'Invited' };
    })
    .filter(v => inDept(v.hostDept));

  // ── Gate passes ──
  const gatePasses = pj(await all("SELECT data, created_at FROM entities WHERE type='GatePass'"))
    .filter(g => String(g.request_date || '').slice(0, 10) >= from && String(g.request_date || '').slice(0, 10) <= to)
    .map(g => ({ ...g, dept: deptOf(g.employee_user_id), empName: empByUser[g.employee_user_id]?.display_name || g.employee_name || '', empCode: empByUser[g.employee_user_id]?.employee_code || '' }))
    .filter(g => inDept(g.dept));

  // ── Recruitment ──
  const requisitions = pj(await all("SELECT data, created_at FROM entities WHERE type='JobRequisition'"));
  const reqScope = requisitions.filter(r => inDept(r.department || 'Unassigned'));
  const reqById = {}; for (const r of requisitions) if (r.id) reqById[r.id] = r;
  const candidates = pj(await all("SELECT data, created_at FROM entities WHERE type='Candidate'"));
  const candDept = (c) => c.department || reqById[c.requisition_id || c.job_requisition_id || c.job_id]?.department || 'Unassigned';
  const candNew = candidates.filter(c => c._created >= from && c._created <= to && inDept(candDept(c)));
  const stageCounts = {};
  for (const c of candidates.filter(c => inDept(candDept(c)))) { const s = c.status || 'applied'; stageCounts[s] = (stageCounts[s] || 0) + 1; }
  const recruitment = {
    newRequisitions: reqScope.filter(r => r._created >= from && r._created <= to),
    openRequisitions: reqScope.filter(r => ['open', 'approved', 'active'].includes(String(r.status || '').toLowerCase())),
    candidatesNew: candNew,
    stageCounts,
    joined: candidates.filter(c => c.status === 'joined' && inDept(candDept(c))),
    offered: candNew.filter(c => ['offered', 'offer_accepted'].includes(c.status)).length,
  };

  // ── Reimbursements ──
  const reimbursements = pj(await all("SELECT data, created_at FROM entities WHERE type='Reimbursement'"))
    .filter(r => { const d = String(r.expense_date || r._created || '').slice(0, 10); return d >= from && d <= to; })
    .map(r => ({ ...r, dept: deptOf(r.user_id), empName: empByUser[r.user_id]?.display_name || '', empCode: empByUser[r.user_id]?.employee_code || '' }))
    .filter(r => inDept(r.dept));

  // ── Leave ──
  const leaves = pj(await all("SELECT data, created_at FROM entities WHERE type='Leave'"))
    .filter(l => l.start_date && String(l.end_date || l.start_date).slice(0, 10) >= from && String(l.start_date).slice(0, 10) <= to)
    .map(l => ({ ...l, dept: deptOf(l.user_id), empName: empByUser[l.user_id]?.display_name || l.employee_name || '', empCode: empByUser[l.user_id]?.employee_code || '' }))
    .filter(l => inDept(l.dept));

  return { range, period, department: deptFilter, depts, today, days, attendance, joinings, visitors, gatePasses, recruitment, reimbursements, leaves, empByUser, scopeEmps, candDept };
}

// ── workbook ─────────────────────────────────────────────────────────────
const NAVY = 'FF1A3C5E', BLUE = 'FF2D5986', LIGHT = 'FFEEF2F7';
const font = (b = false, color = 'FF1F2937', size = 10) => ({ name: 'Calibri', bold: b, size, color: { argb: color } });
const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
const border = () => ({ top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } } });

function sheetWithTitle(wb, name, title, sub, cols) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([title]); ws.mergeCells(1, 1, 1, Math.max(cols, 2));
  Object.assign(ws.getCell(1, 1), { font: font(true, 'FFFFFFFF', 14), fill: fill(NAVY), alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } });
  ws.getRow(1).height = 28;
  ws.addRow([sub]); ws.mergeCells(2, 1, 2, Math.max(cols, 2));
  Object.assign(ws.getCell(2, 1), { font: font(false, 'FF374151', 9), fill: fill(LIGHT), alignment: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true } });
  ws.addRow([]); ws.getRow(3).height = 4;
  return ws;
}
function table(ws, heads, rows, widths, opts = {}) {
  const h = ws.addRow(heads);
  h.eachCell(c => Object.assign(c, { font: font(true, 'FFFFFFFF', 10), fill: fill(BLUE), alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: border() }));
  h.height = 24;
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell({ includeEmpty: true }, (c, n) => {
      Object.assign(c, { font: font(false), fill: fill(i % 2 ? 'FFF8FAFC' : 'FFFFFFFF'), border: border(), alignment: { vertical: 'middle', horizontal: typeof r[n - 1] === 'number' ? 'center' : 'left', wrapText: true } });
    });
  });
  if (!rows.length) { const e = ws.addRow(['No records for this period']); ws.mergeCells(e.number, 1, e.number, heads.length); e.getCell(1).font = font(false, 'FF6B7280'); e.getCell(1).alignment = { horizontal: 'center' }; }
  if (opts.total && rows.length) {
    const t = ws.addRow(opts.total(rows));
    t.eachCell({ includeEmpty: true }, c => Object.assign(c, { font: font(true, 'FFFFFFFF'), fill: fill(NAVY), border: border(), alignment: { horizontal: 'center' } }));
  }
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return h.number;
}
function section(ws, text) {
  ws.addRow([]);
  const r = ws.addRow([text]);
  r.getCell(1).font = font(true, NAVY, 12);
  r.height = 20;
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

function writeOverview(wb, D, scopeLabel) {
  const { attendance: A, joinings, visitors, gatePasses, recruitment, reimbursements, leaves, range } = D;
  const ws = sheetWithTitle(wb, 'Summary', `Maxvolt Energy Industries Limited — ${range.title}`, `Scope: ${scopeLabel}   |   Generated ${fmtD(D.today)} (IST)   |   Period ${fmtD(range.from)} to ${fmtD(range.to)}`, 4);
  const headcount = D.scopeEmps.length;
  const attendanceRate = pct(A.totals.present + A.totals.half_day * 0.5, A.totals.marked || 1);
  const walk = visitors.filter(v => v.kind === 'Walk-in').length;
  const reimbAmt = sum(reimbursements, r => r.amount);
  const kpis = [
    ['Headcount (in scope)', headcount],
    ['Present (employee-days)', A.totals.present],
    ['Absent (employee-days)', A.totals.absent],
    ['On leave (employee-days)', A.totals.leave],
    ['Half day (employee-days)', A.totals.half_day],
    ['Work from home / On duty', `${A.totals.wfh} / ${A.totals.od}`],
    ['Late arrivals', A.totals.late],
    ['Attendance rate %', attendanceRate],
    ['New joinings', joinings.length],
    ['Visitors — total', visitors.length],
    ['Visitors — walk-in', walk],
    ['Visitors — invited', visitors.length - walk],
    ['Gate passes — total', gatePasses.length],
    ['Gate passes — approved / departed / returned', gatePasses.filter(g => ['approved', 'departed', 'returned', 'auto_closed'].includes(g.status)).length],
    ['Recruitment — new requisitions', recruitment.newRequisitions.length],
    ['Recruitment — open requisitions', recruitment.openRequisitions.length],
    ['Recruitment — new candidates', recruitment.candidatesNew.length],
    ['Recruitment — offers', recruitment.offered],
    ['Reimbursement claims', reimbursements.length],
    ['Reimbursement amount (₹)', Math.round(reimbAmt)],
    ['Leave requests in period', leaves.length],
  ];
  table(ws, ['Metric', 'Value'], kpis, [46, 22]);
  ws.getColumn(2).alignment = { horizontal: 'center' };
}

function writeAttendance(wb, D, scopeLabel) {
  const { attendance: A, range, period } = D;
  const ws = sheetWithTitle(wb, 'Attendance', `Attendance Summary — ${range.title}`, `Scope: ${scopeLabel}. Employee-days counted from marked attendance; week-offs and holidays excluded.`, 12);
  if (D.days.length > 1) {
    section(ws, 'Day-wise trend');
    table(ws, ['Date', 'Present', 'Absent', 'Leave', 'Half day', 'WFH', 'On duty', 'Late', 'Not marked'],
      A.perDay.map(d => [fmtD(d.date) + (d.holiday ? ' (Holiday)' : ''), d.present, d.absent, d.leave, d.half_day, d.wfh, d.od, d.late, d.notMarked]), [22, 11, 11, 11, 11, 11, 11, 11, 12],
      { total: (rows) => ['TOTAL', ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => sum(rows, r => r[i]))] });
  }
  section(ws, period === 'daily' ? 'Employee-wise attendance' : 'Employee-wise summary');
  const heads = period === 'daily'
    ? ['Code', 'Name', 'Department', 'Designation', 'Status', 'In', 'Out', 'Hours']
    : ['Code', 'Name', 'Department', 'Designation', 'Present', 'Absent', 'Leave', 'Half day', 'WFH', 'On duty', 'Late', 'Hours'];
  const rows = A.perEmp.map(e => period === 'daily'
    ? [e.code, e.name, e.dept, e.designation, e.status || 'Not marked', e.in, e.out, e.hours]
    : [e.code, e.name, e.dept, e.designation, e.P, e.A, e.L, e.HD, e.WFH, e.OD, e.late, e.hours]);
  table(ws, heads, rows, [14, 26, 20, 22, 12, 11, 11, 11, 10, 10, 10, 11]);
}

function writeJoinings(wb, D, scopeLabel) {
  const ws = sheetWithTitle(wb, 'New Joinings', `New Joinings — ${D.range.title}`, `Scope: ${scopeLabel}`, 7);
  table(ws, ['Code', 'Name', 'Department', 'Designation', 'Date of joining', 'Location', 'Reporting manager'],
    D.joinings.map(e => [e.employee_code || '', e.display_name || '', e.department || 'Unassigned', e.designation || '', fmtD(e.date_of_joining), e.work_location || '', e.reporting_manager_name || '']),
    [14, 26, 20, 24, 16, 20, 24]);
}

function writeVisitors(wb, D, scopeLabel) {
  const V = D.visitors;
  const ws = sheetWithTitle(wb, 'Visitors', `Visitors — ${D.range.title}`, `Scope: ${scopeLabel}. Department = the host's department.`, 10);
  const walk = V.filter(v => v.kind === 'Walk-in').length;
  table(ws, ['Type', 'Count'], [['Walk-in', walk], ['Invited (pre-registered)', V.length - walk], ['Total', V.length]], [28, 14, 18, 18, 18, 18, 14, 14, 14, 14]);
  section(ws, 'Visitor log');
  table(ws, ['Type', 'Visitor', 'Company', 'Mobile', 'Host', 'Host department', 'Purpose', 'Location', 'Status', 'Visit date', 'In', 'Out'],
    V.map(v => [v.kind, v.visitor_name || '', v.company || '', v.mobile_number || '', v.host_name || '', v.hostDept, v.purpose || '', v.location_name || '', label(v.status),
      fmtD(String(v.expected_arrival || v.check_in_time || '').slice(0, 10)), fmtT(v.check_in_time), fmtT(v.check_out_time)]),
    [14, 24, 22, 15, 22, 20, 28, 20, 16, 14, 11, 11]);
}

function writeGatePasses(wb, D, scopeLabel) {
  const G = D.gatePasses;
  const ws = sheetWithTitle(wb, 'Gate Passes', `Gate Passes — ${D.range.title}`, `Scope: ${scopeLabel}`, 9);
  const byType = {}; for (const g of G) byType[g.outing_type || 'other'] = (byType[g.outing_type || 'other'] || 0) + 1;
  const byStatus = {}; for (const g of G) byStatus[g.status || 'unknown'] = (byStatus[g.status || 'unknown'] || 0) + 1;
  table(ws, ['By outing type', 'Count', 'By status', 'Count'],
    Array.from({ length: Math.max(Object.keys(byType).length, Object.keys(byStatus).length, 1) }, (_, i) => {
      const t = Object.entries(byType)[i], s = Object.entries(byStatus)[i];
      return [t ? label(t[0]) : '', t ? t[1] : '', s ? label(s[0]) : '', s ? s[1] : ''];
    }), [26, 12, 26, 12, 20, 22, 20, 18, 16]);
  section(ws, 'Gate pass log');
  table(ws, ['Date', 'Code', 'Employee', 'Department', 'Outing type', 'Destination / reason', 'Requested time', 'Status', 'Approver'],
    G.map(g => [fmtD(g.request_date), g.empCode, g.empName, g.dept, label(g.outing_type), g.destination_location || g.reason || '', g.requested_time || g.out_time || '', label(g.status), g.approved_by_name || g.manager_name || '']),
    [14, 14, 26, 20, 22, 30, 16, 18, 22]);
}

function writeRecruitment(wb, D, scopeLabel) {
  const R = D.recruitment;
  const ws = sheetWithTitle(wb, 'Recruitment', `Recruitment — ${D.range.title}`, `Scope: ${scopeLabel}`, 8);
  table(ws, ['Metric', 'Value'], [
    ['New requisitions raised', R.newRequisitions.length], ['Open requisitions (now)', R.openRequisitions.length],
    ['New candidates in period', R.candidatesNew.length], ['Offers in period', R.offered], ['Candidates joined (all-time)', R.joined.length],
  ], [34, 14, 16, 16, 16, 18, 16, 16]);
  section(ws, 'Candidates by stage (current)');
  table(ws, ['Stage', 'Candidates'], Object.entries(R.stageCounts).map(([s, n]) => [label(s), n]), [34, 14]);
  section(ws, 'Requisitions raised in period');
  table(ws, ['Title', 'Department', 'Positions', 'Status', 'Raised on'],
    R.newRequisitions.map(r => [r.job_title || r.title || '', r.department || '', r.number_of_positions || '', label(r.status), fmtD(r._created)]), [34, 22, 12, 16, 14]);
  section(ws, 'New candidates in period');
  table(ws, ['Candidate', 'Position', 'Department', 'Stage', 'Source', 'Applied on'],
    R.candidatesNew.map(c => [c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || '', c.position || c.job_title || '', D.candDept(c), label(c.status), c.source || '', fmtD(c._created)]), [26, 28, 20, 18, 16, 14]);
}

function writeReimbursements(wb, D, scopeLabel) {
  const Rm = D.reimbursements;
  const ws = sheetWithTitle(wb, 'Reimbursements', `Reimbursements — ${D.range.title}`, `Scope: ${scopeLabel}`, 8);
  const byStatus = {}; for (const r of Rm) { const s = r.status || 'pending'; byStatus[s] = byStatus[s] || { n: 0, amt: 0 }; byStatus[s].n++; byStatus[s].amt += Number(r.amount) || 0; }
  table(ws, ['Status', 'Claims', 'Amount (₹)'], Object.entries(byStatus).map(([s, v]) => [label(s), v.n, Math.round(v.amt)]), [24, 12, 16, 16, 24, 28, 14, 16],
    { total: (rows) => ['TOTAL', sum(rows, r => r[1]), sum(rows, r => r[2])] });
  section(ws, 'Claims');
  table(ws, ['Date', 'Code', 'Employee', 'Department', 'Expense type', 'Description', 'Amount (₹)', 'Status'],
    Rm.map(r => [fmtD(r.expense_date || r._created), r.empCode, r.empName, r.dept, label(r.expense_type), r.description || '', Number(r.amount) || 0, label(r.status)]), [14, 14, 26, 20, 22, 30, 14, 16]);
}

function writeLeave(wb, D, scopeLabel) {
  const L = D.leaves;
  const ws = sheetWithTitle(wb, 'Leave', `Leave — ${D.range.title}`, `Scope: ${scopeLabel}. Requests overlapping the period.`, 8);
  table(ws, ['Code', 'Employee', 'Department', 'Leave type', 'From', 'To', 'Days', 'Status'],
    L.map(l => [l.empCode, l.empName, l.dept, label(l.leave_type || l.leave_policy_name), fmtD(l.start_date), fmtD(l.end_date), l.total_days || l.adjusted_days || '', label(l.status)]), [14, 26, 20, 20, 14, 14, 10, 16]);
}

function writeDepartmentSummary(wb, D) {
  const { attendance: A } = D;
  const ws = sheetWithTitle(wb, 'Department Summary', `Department-wise MIS — ${D.range.title}`, 'One row per department; the following sheets give each department\'s detail.', 16);
  const rows = D.depts.map(dep => {
    const a = A.perDept[dep];
    const marked = a.present + a.absent + a.leave + a.half_day;
    return [dep, a.headcount, a.present, a.absent, a.leave, a.half_day, a.late, pct(a.present + a.half_day * 0.5, marked || 1),
      D.joinings.filter(e => (e.department || 'Unassigned') === dep).length,
      D.visitors.filter(v => v.hostDept === dep).length,
      D.gatePasses.filter(g => g.dept === dep).length,
      D.recruitment.candidatesNew.filter(c => D.candDept(c) === dep).length,
      D.reimbursements.filter(r => r.dept === dep).length,
      Math.round(sum(D.reimbursements.filter(r => r.dept === dep), r => r.amount)),
      D.leaves.filter(l => l.dept === dep).length];
  });
  table(ws, ['Department', 'Headcount', 'Present', 'Absent', 'Leave', 'Half day', 'Late', 'Attendance %', 'New joinings', 'Visitors (host)', 'Gate passes', 'New candidates', 'Reimb. claims', 'Reimb. ₹', 'Leave requests'],
    rows, [26, 11, 10, 10, 10, 10, 9, 13, 12, 13, 12, 13, 13, 12, 14],
    { total: (r) => ['TOTAL', ...Array.from({ length: 14 }, (_, i) => i === 6 ? Math.round(sum(r, x => x[8]) ? pct(sum(r, x => x[2]), sum(r, x => x[2] + x[3] + x[4] + x[5]) || 1) : 0) : sum(r, x => x[i + 1]))] });
}

export async function buildMisWorkbook({ period = 'daily', date, department = 'all', departmentWise = false }, ExcelJS) {
  const D = await collectMis({ period, date, department });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Maxvolt One';
  const scopeLabel = departmentWise ? 'All departments (department-wise)' : (D.department ? `Department: ${D.department}` : 'Entire company');

  if (departmentWise) {
    writeDepartmentSummary(wb, D);
    for (const dep of D.depts) {
      // Re-use the same writers on a slice of the data for this department.
      const slice = {
        ...D, depts: [dep],
        scopeEmps: D.scopeEmps.filter(e => (e.department || 'Unassigned') === dep),
        attendance: {
          ...D.attendance,
          perEmp: D.attendance.perEmp.filter(e => e.dept === dep),
          perDept: { [dep]: D.attendance.perDept[dep] },
          totals: Object.fromEntries(['present', 'absent', 'leave', 'half_day', 'wfh', 'od', 'late', 'marked'].map(k => [k, 0])),
          perDay: D.days.map(d => ({ date: d, present: 0, absent: 0, leave: 0, half_day: 0, wfh: 0, od: 0, late: 0, notMarked: 0, holiday: false })),
        },
        joinings: D.joinings.filter(e => (e.department || 'Unassigned') === dep),
        visitors: D.visitors.filter(v => v.hostDept === dep),
        gatePasses: D.gatePasses.filter(g => g.dept === dep),
        reimbursements: D.reimbursements.filter(r => r.dept === dep),
        leaves: D.leaves.filter(l => l.dept === dep),
        recruitment: { ...D.recruitment, candidatesNew: D.recruitment.candidatesNew.filter(c => D.candDept(c) === dep), newRequisitions: D.recruitment.newRequisitions.filter(r => (r.department || 'Unassigned') === dep), openRequisitions: D.recruitment.openRequisitions.filter(r => (r.department || 'Unassigned') === dep) },
      };
      const pd = D.attendance.perDept[dep];
      slice.attendance.totals = { present: pd.present, absent: pd.absent, leave: pd.leave, half_day: pd.half_day, wfh: pd.wfh, od: pd.od, late: pd.late, marked: pd.present + pd.absent + pd.leave + pd.half_day };
      // per-day figures for just this department
      for (const e of slice.scopeEmps) { /* per-day split is derived from the employee rows below */ }
      const ws = sheetWithTitle(wb, dep.replace(/[\\/?*[\]:]/g, ' '), `${dep} — ${D.range.title}`, `Headcount ${pd.headcount}  |  Present ${pd.present}  Absent ${pd.absent}  Leave ${pd.leave}  Half day ${pd.half_day}  Late ${pd.late}  |  Joinings ${slice.joinings.length}  Visitors ${slice.visitors.length}  Gate passes ${slice.gatePasses.length}  Reimb. ₹${Math.round(sum(slice.reimbursements, r => r.amount))}`, 12);
      section(ws, 'Employee attendance');
      table(ws, period === 'daily' ? ['Code', 'Name', 'Designation', 'Status', 'In', 'Out', 'Hours'] : ['Code', 'Name', 'Designation', 'Present', 'Absent', 'Leave', 'Half day', 'WFH', 'On duty', 'Late', 'Hours'],
        slice.attendance.perEmp.map(e => period === 'daily' ? [e.code, e.name, e.designation, e.status || 'Not marked', e.in, e.out, e.hours] : [e.code, e.name, e.designation, e.P, e.A, e.L, e.HD, e.WFH, e.OD, e.late, e.hours]),
        [14, 26, 24, 12, 11, 11, 11, 10, 10, 10, 11]);
      section(ws, 'New joinings');
      table(ws, ['Code', 'Name', 'Designation', 'Date of joining'], slice.joinings.map(e => [e.employee_code || '', e.display_name || '', e.designation || '', fmtD(e.date_of_joining)]), []);
      section(ws, 'Gate passes');
      table(ws, ['Date', 'Employee', 'Type', 'Status'], slice.gatePasses.map(g => [fmtD(g.request_date), g.empName, label(g.outing_type), label(g.status)]), []);
      section(ws, 'Visitors (hosted by this department)');
      table(ws, ['Type', 'Visitor', 'Host', 'Status'], slice.visitors.map(v => [v.kind, v.visitor_name || '', v.host_name || '', label(v.status)]), []);
      section(ws, 'Reimbursements');
      table(ws, ['Date', 'Employee', 'Expense type', 'Amount (₹)', 'Status'], slice.reimbursements.map(r => [fmtD(r.expense_date || r._created), r.empName, label(r.expense_type), Number(r.amount) || 0, label(r.status)]), []);
    }
  } else {
    writeOverview(wb, D, scopeLabel);
    writeAttendance(wb, D, scopeLabel);
    writeJoinings(wb, D, scopeLabel);
    writeVisitors(wb, D, scopeLabel);
    writeGatePasses(wb, D, scopeLabel);
    writeRecruitment(wb, D, scopeLabel);
    writeReimbursements(wb, D, scopeLabel);
    writeLeave(wb, D, scopeLabel);
    if (!D.department) writeDepartmentSummary(wb, D);
  }
  const buffer = await wb.xlsx.writeBuffer();
  const filename = `MIS_${D.range.key}${departmentWise ? '_DepartmentWise' : (D.department ? '_' + D.department.replace(/\W+/g, '_') : '')}.xlsx`;
  return { buffer, filename, range: D.range, counts: { employees: D.scopeEmps.length, joinings: D.joinings.length, visitors: D.visitors.length, gatePasses: D.gatePasses.length, reimbursements: D.reimbursements.length } };
}
