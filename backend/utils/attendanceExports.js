// Excel exports: attendance regularisation requests, and work-from-home tracking (requests + days worked from home).
import { all } from '../db.js';
import { sheetWithTitle, table, section, label, fmtD } from './misReport.js';

const d10 = (v) => (v ? String(v).slice(0, 10) : '');
const pj = (rows) => rows.map(r => { try { return { ...JSON.parse(r.data), id: r.id, _created: r.created_at ? String(r.created_at).slice(0, 10) : '' }; } catch { return null; } }).filter(Boolean);
const t12 = (v) => { if (!v) return ''; const s = String(v); const m = s.match(/(\d{1,2}):(\d{2})/); if (!m) return s; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
const gapDays = (a, b) => { const x = Date.parse(d10(a)), y = Date.parse(d10(b)); return Number.isFinite(x) && Number.isFinite(y) ? Math.max(0, Math.round((y - x) / 86400000)) + 1 : 1; };

async function people() {
  const emps = pj(await all("SELECT id, data, created_at FROM entities WHERE type='Employee'"));
  const byUser = {}; for (const e of emps) if (e.user_id) byUser[e.user_id] = e;
  return byUser;
}
const ok = (v, f) => !f || f === 'all' || v === f;
const common = (wb, title, sub) => sheetWithTitle(wb, title, title, sub, 12);

export async function buildRegularisationWorkbook({ from, to, department, status }, ExcelJS) {
  const emp = await people();
  const rows = pj(await all("SELECT id, data, created_at FROM entities WHERE type='AttendanceRegularisation'"))
    .filter(r => d10(r.attendance_date || r.date) >= from && d10(r.attendance_date || r.date) <= to)
    .map(r => ({ ...r, e: emp[r.user_id] || {} }))
    .filter(r => ok(r.e.department || 'Unassigned', department) && ok(r.status, status));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
  const sub = `Attendance dates ${fmtD(from)} to ${fmtD(to)}  |  ${department && department !== 'all' ? 'Department: ' + department : 'Entire company'}${status && status !== 'all' ? '  |  Status: ' + label(status) : ''}`;
  const ws = common(wb, 'Regularisation requests', sub);
  table(ws, ['Code', 'Employee', 'Department', 'Attendance date', 'Applied on', 'Reason category', 'Reason', 'Was (status / in / out)', 'Requested in', 'Requested out', 'Status', 'Manager decision', 'HR decision', 'Days to decide'],
    rows.sort((a, b) => d10(b.attendance_date).localeCompare(d10(a.attendance_date))).map(r => {
      const last = r.hr_approved_at || r.manager_approved_at || r.rejected_at;
      return [r.e.employee_code || '', r.e.display_name || r.employee_name || '', r.e.department || '', fmtD(r.attendance_date || r.date), fmtD(r.created_at || r._created), label(r.reason_category), r.reason || '',
        `${label(r.existing_status || 'absent')} ${t12(r.existing_check_in)}–${t12(r.existing_check_out)}`.trim(), t12(r.requested_check_in), t12(r.requested_check_out), label(r.status),
        r.manager_approved_at ? `${fmtD(r.manager_approved_at)}${r.manager_comment ? ' — ' + r.manager_comment : ''}` : '', r.hr_approved_at ? `${fmtD(r.hr_approved_at)}${r.hr_comment ? ' — ' + r.hr_comment : ''}` : (r.rejected_at ? `Rejected ${fmtD(r.rejected_at)}` : ''), last ? gapDays(r.created_at || r._created, last) - 1 : ''];
    }), [12, 24, 18, 14, 12, 18, 34, 28, 12, 12, 18, 30, 30, 10]);

  const ws2 = common(wb, 'Summary', sub);
  const by = (f) => { const m = {}; for (const r of rows) { const k = f(r); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  table(ws2, ['Status', 'Requests'], by(r => label(r.status)), [30, 12]);
  section(ws2, 'By department'); table(ws2, ['Department', 'Requests'], by(r => r.e.department || 'Unassigned'), [30, 12]);
  section(ws2, 'By reason'); table(ws2, ['Reason', 'Requests'], by(r => label(r.reason_category) || 'Not stated'), [30, 12]);
  const per = {}; for (const r of rows) { const k = r.user_id; per[k] = per[k] || { n: 0, name: r.e.display_name || '', code: r.e.employee_code || '', dept: r.e.department || '' }; per[k].n++; }
  section(ws2, 'Employees with the most requests'); table(ws2, ['Code', 'Employee', 'Department', 'Requests'], Object.values(per).sort((a, b) => b.n - a.n).slice(0, 25).map(p => [p.code, p.name, p.dept, p.n]), [30, 12, 20, 12]);
  return { buffer: await wb.xlsx.writeBuffer(), filename: `Regularisation_Requests_${from}_to_${to}.xlsx`, counts: { requests: rows.length } };
}

export async function buildWfhWorkbook({ from, to, department }, ExcelJS) {
  const emp = await people();
  const leaves = pj(await all("SELECT id, data, created_at FROM entities WHERE type='Leave'"))
    .filter(l => (l.is_wfh || l.leave_type === 'work_from_home') && d10(l.end_date || l.start_date) >= from && d10(l.start_date) <= to)
    .map(l => ({ ...l, e: emp[l.user_id] || {} })).filter(l => ok(l.e.department || 'Unassigned', department));
  const att = pj(await all("SELECT id, data, created_at FROM entities WHERE type='Attendance'"))
    .filter(a => a.status === 'work_from_home' && d10(a.date) >= from && d10(a.date) <= to)
    .map(a => ({ ...a, e: emp[a.user_id] || {} })).filter(a => ok(a.e.department || 'Unassigned', department));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
  const sub = `${fmtD(from)} to ${fmtD(to)}  |  ${department && department !== 'all' ? 'Department: ' + department : 'Entire company'}`;
  const per = {}; for (const a of att) { const k = a.user_id; per[k] = per[k] || { e: a.e, dates: [] }; per[k].dates.push(d10(a.date)); }
  const ws = common(wb, 'WFH summary', sub);
  table(ws, ['Total WFH days', 'Employees', 'Requests'], [[att.length, Object.keys(per).length, leaves.length]], [18, 14, 14]);
  section(ws, 'WFH days by employee');
  table(ws, ['Code', 'Employee', 'Department', 'WFH days', 'Dates'], Object.values(per).sort((a, b) => b.dates.length - a.dates.length).map(p => [p.e.employee_code || '', p.e.display_name || '', p.e.department || '', p.dates.length, p.dates.sort().map(fmtD).join(', ')]), [14, 26, 20, 12, 70]);
  const dm = {}; for (const a of att) { const k = a.e.department || 'Unassigned'; dm[k] = (dm[k] || 0) + 1; }
  section(ws, 'WFH days by department'); table(ws, ['Department', 'WFH days'], Object.entries(dm).sort((a, b) => b[1] - a[1]), [26, 14]);
  const ws2 = common(wb, 'WFH requests', sub);
  table(ws2, ['Code', 'Employee', 'Department', 'From', 'To', 'Days', 'Reason', 'Applied on', 'Status', 'Decided by', 'Decided on'],
    leaves.sort((a, b) => d10(b.start_date).localeCompare(d10(a.start_date))).map(l => [l.e.employee_code || '', l.e.display_name || l.employee_name || '', l.e.department || '', fmtD(l.start_date), fmtD(l.end_date || l.start_date), l.days || l.total_days || gapDays(l.start_date, l.end_date || l.start_date), l.reason || '', fmtD(l.created_at || l._created), label(l.status), l.approved_by_name || l.rejected_by_name || '', fmtD(l.approved_date || l.rejected_at)]),
    [12, 24, 18, 12, 12, 8, 34, 12, 14, 22, 12]);
  const ws3 = common(wb, 'WFH day register', sub);
  table(ws3, ['Date', 'Code', 'Employee', 'Department', 'Check-in', 'Check-out'], att.sort((a, b) => d10(b.date).localeCompare(d10(a.date))).map(a => [fmtD(a.date), a.e.employee_code || '', a.e.display_name || '', a.e.department || '', t12(a.check_in_time), t12(a.check_out_time)]), [12, 12, 26, 20, 12, 12]);
  return { buffer: await wb.xlsx.writeBuffer(), filename: `WFH_Tracking_${from}_to_${to}.xlsx`, counts: { days: att.length, requests: leaves.length } };
}
