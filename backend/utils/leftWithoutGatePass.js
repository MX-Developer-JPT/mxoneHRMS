// "Left without a gate pass": a day that ended SHORT (short attendance / half day because the working hours were not
// completed) with the last check-out at least LEFT_EARLY_MIN minutes before the shift's end and no gate pass for that day.
// Computed from each record's own check-out and the employee's shift, so it covers every past day too. Leave-driven half
// days, regularised days (HR corrected them), On Duty / Work From Home days (the employee was not at the gate) and anyone
// who had a gate pass are never flagged; leaving 40 minutes early (still a full day) is below the threshold.
// Used by All Attendance, its export and the daily email.
import { all } from '../db.js';
import { shiftEndDateTime } from '../routes/attendancelog.js';

export const LEFT_EARLY_MIN = 60;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** Sets left_without_gate_pass, left_early_minutes and shift_end_time on the flagged records (in place). */
export async function flagLeftWithoutGatePass(records) {
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return records;
  const gpDays = new Set();
  for (const r of await all("SELECT data FROM entities WHERE type='GatePass' AND data::jsonb->>'request_date' >= $1 AND data::jsonb->>'request_date' <= $2", [dates[0], dates[dates.length - 1]])) {
    const g = parse(r.data);
    if (g?.employee_user_id && ['approved', 'departed', 'returned', 'auto_closed', 'completed'].includes(g.status)) gpDays.add(`${g.employee_user_id}__${g.request_date}`);
  }
  const shifts = {}; let dflt = { start_time: '09:00', end_time: '18:00' };
  for (const r of await all("SELECT data FROM entities WHERE type='Shift'")) { const sh = parse(r.data); if (!sh) continue; shifts[sh.id] = sh; if (sh.is_default) dflt = sh; }
  const empShift = {}; for (const r of await all("SELECT user_id, data FROM entities WHERE type='Employee'")) empShift[r.user_id] = parse(r.data)?.shift_id;
  for (const rec of records) {
    if (!['half_day', 'short_attendance'].includes(rec.status)) continue;
    if (rec.leave_id || rec.regularised || rec.is_in_progress || !rec.check_out_time || !rec.date) continue;
    if (['od', 'wfh'].includes(rec.selfie_reason)) continue;
    if (gpDays.has(`${rec.user_id}__${rec.date}`)) continue;
    const shift = (empShift[rec.user_id] && shifts[empShift[rec.user_id]]) || dflt;
    const out = Date.parse(String(rec.check_out_time).endsWith('Z') ? rec.check_out_time : rec.check_out_time + 'Z');
    if (Number.isNaN(out)) continue;
    const early = Math.round((shiftEndDateTime(rec.date, shift).getTime() - out) / 60000);
    if (early >= LEFT_EARLY_MIN) { rec.left_without_gate_pass = true; rec.left_early_minutes = early; rec.shift_end_time = shift.end_time || '18:00'; rec.shift_start_time = shift.start_time || '09:00'; }
  }
  return records;
}

/** The flagged days between two dates (optionally only for a set of user ids), one row per employee per day. */
export async function leftWithoutGatePass(from, to, team = null) {
  const byUser = Object.fromEntries((await all("SELECT user_id, data FROM entities WHERE type='Employee'")).map((r) => { const e = parse(r.data) || {}; return [e.user_id || r.user_id, e]; }));
  let recs = (await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [from, to])).map((r) => parse(r.data)).filter((r) => r?.user_id && byUser[r.user_id]);
  if (team) recs = recs.filter((r) => team.has(r.user_id));
  // one row per employee per day, keeping the record that has the most real data
  const best = {};
  const score = (x) => (x.check_out_time ? 4 : 0) + (x.check_in_time ? 2 : 0) + (x.regularised ? 1 : 0);
  for (const r of recs) { const k = `${r.user_id}__${r.date}`; if (!best[k] || score(r) > score(best[k])) best[k] = r; }
  const flagged = (await flagLeftWithoutGatePass(Object.values(best))).filter((r) => r.left_without_gate_pass)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(byUser[a.user_id].display_name || '').localeCompare(String(byUser[b.user_id].display_name || '')));
  return { flagged, byUser };
}

const clock = (iso) => { if (!iso) return ''; const d = new Date(String(iso).endsWith('Z') ? iso : iso + 'Z'); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: true }); };
const hm = (t) => { const [h, m] = String(t || '18:00').split(':').map(Number); return `${String(h % 12 || 12).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
export const earlyText = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

export const COLUMNS = [['S.No', 6], ['Emp Code', 12], ['Employee', 24], ['Department', 18], ['Designation', 20], ['Reporting manager', 22], ['Date', 12], ['Status', 16], ['Shift start', 11], ['Shift end', 11], ['First check-in', 12], ['Last check-out', 12], ['Left before shift end', 14], ['Working hours', 10]];

/** One printable row per flagged record, in COLUMNS order. */
export function leftRows(flagged, byUser) {
  return flagged.map((r, i) => {
    const e = byUser[r.user_id] || {}; const mgr = byUser[e.reporting_manager_id];
    return [i + 1, e.employee_code || '', e.display_name || '', e.department || '', e.designation || '', mgr?.display_name || '', r.date, String(r.status).replace(/_/g, ' '), hm(r.shift_start_time), hm(r.shift_end_time), clock(r.check_in_time), clock(r.check_out_time), earlyText(r.left_early_minutes), r.working_hours != null ? Number(Number(r.working_hours).toFixed(2)) : ''];
  });
}

export async function buildLeftWorkbook({ flagged, byUser, from, to, generatedBy }, ExcelJS) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Left without gate pass');
  const range = `${from}${to !== from ? ` to ${to}` : ''}`;
  ws.addRow([`Maxvolt Energy — Left without gate pass, ${range}`]); ws.mergeCells(1, 1, 1, COLUMNS.length);
  Object.assign(ws.getCell(1, 1), { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF991B1B' } } });
  ws.addRow([`${flagged.length} case(s) · short attendance / half day, checked out ${LEFT_EARLY_MIN}+ minutes before shift end, no gate pass · generated by ${generatedBy}`]); ws.addRow([]);
  ws.addRow(COLUMNS.map((c) => c[0])).eachCell((c) => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F1D1D' } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } }));
  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; });
  for (const values of leftRows(flagged, byUser)) { const row = ws.addRow(values); row.getCell(13).font = { bold: true, color: { argb: 'FFB91C1C' } }; row.alignment = { vertical: 'middle' }; }
  // per-employee totals on a second sheet
  const totals = wb.addWorksheet('By employee');
  totals.addRow(['Emp Code', 'Employee', 'Department', 'Times left without gate pass']).eachCell((c) => Object.assign(c, { font: { bold: true } }));
  const tally = {}; for (const r of flagged) tally[r.user_id] = (tally[r.user_id] || 0) + 1;
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([uid, n]) => totals.addRow([byUser[uid].employee_code || '', byUser[uid].display_name || '', byUser[uid].department || '', n]));
  [12, 26, 20, 16].forEach((w, i) => { totals.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 3 }]; ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLUMNS.length } };
  return { buffer: await wb.xlsx.writeBuffer(), filename: `Left_Without_Gate_Pass_${from}${to !== from ? `_to_${to}` : ''}.xlsx` };
}
