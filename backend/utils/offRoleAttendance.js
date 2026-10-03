// "Off role" attendance: biometric punches whose code is NOT mapped to any
// employee (contract / temporary / not-yet-onboarded workers). The raw punches
// are already stored as AttendanceLog rows with no user_id by
// routes/attendancelog.js; this module turns them into per-person, per-day
// first/last-punch records with working hours and automatic overtime, and
// builds the muster-style Excel export.
import { all } from '../db.js';

export const OT_AFTER_HOURS = 9;                 // overtime starts after 9 completed hours in a day
const OT_AFTER_MIN = OT_AFTER_HOURS * 60;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const norm = (v) => String(v ?? '').trim().toUpperCase();
const hhmm = (mins) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
const r2 = (n) => Math.round(n * 100) / 100;
// Punch times are stored as IST digits with a 'Z' — format without any tz shift.
const timeOf = (iso) => {
  const d = new Date(String(iso).replace(/Z$/, '') + 'Z');
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const dateLabel = (ds) => { const [y, m, d] = ds.split('-').map(Number); return `${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`; };
const dowOf = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/**
 * @param {{from:string,to:string,device?:string,search?:string}} f  yyyy-MM-dd bounds, inclusive
 * @returns {Promise<{days:Array, people:Array, devices:Array, summary:object}>}
 */
export async function loadOffRole({ from, to, device, search } = {}) {
  // Codes that DO belong to someone right now — a code mapped after its punches
  // arrived stops being "off role" automatically.
  const [mapRows, empRows, locRows, logRows] = await Promise.all([
    all("SELECT data FROM entities WHERE type='BiometricCodeMapping'"),
    all("SELECT data FROM entities WHERE type='Employee'"),
    all("SELECT data FROM entities WHERE type='AppLocation'"),
    all(
      "SELECT data FROM entities WHERE type='AttendanceLog' AND COALESCE(data::jsonb->>'user_id','')='' AND data::jsonb->>'LogDate' >= $1 AND data::jsonb->>'LogDate' <= $2",
      [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`]
    ),
  ]);
  const mapped = new Set();
  for (const r of mapRows) { const m = JSON.parse(r.data); if (m.biometric_code) mapped.add(norm(m.biometric_code)); }
  for (const r of empRows) { const e = JSON.parse(r.data); if (e.employee_code) mapped.add(norm(e.employee_code)); if (e.biometric_id) mapped.add(norm(e.biometric_id)); }
  const deviceLocation = new Map();
  for (const r of locRows) {
    const l = JSON.parse(r.data);
    for (const d of (l.biometric_devices || [])) if (norm(d)) deviceLocation.set(norm(d), l.name);
  }

  const q = norm(search);
  const groups = new Map(); // `${code}|${date}` -> punches[]
  for (const r of logRows) {
    const log = JSON.parse(r.data);
    const code = String(log.EmployeeCode || '').trim();
    if (!code || mapped.has(norm(code)) || !log.LogDate) continue;
    if (q && !norm(code).includes(q)) continue;
    const dev = String(log.DeviceName || log.SerialNumber || 'Unknown device').trim();
    if (device && device !== 'all' && norm(dev) !== norm(device)) continue;
    const key = `${norm(code)}|${String(log.LogDate).slice(0, 10)}`;
    if (!groups.has(key)) groups.set(key, { code, date: String(log.LogDate).slice(0, 10), punches: [] });
    groups.get(key).punches.push({ t: String(log.LogDate), ms: Date.parse(String(log.LogDate)), dev, serial: log.SerialNumber || '' });
  }

  const days = [];
  for (const g of groups.values()) {
    g.punches.sort((a, b) => a.ms - b.ms);
    const first = g.punches[0], last = g.punches[g.punches.length - 1];
    const single = g.punches.length < 2 || last.ms === first.ms;
    const mins = single ? 0 : Math.max(0, Math.floor((last.ms - first.ms) / 60000));
    const otMin = Math.max(0, mins - OT_AFTER_MIN);
    const devices = [...new Set(g.punches.map(p => p.dev))];
    days.push({
      code: g.code, date: g.date, dow: DOW[dowOf(g.date)],
      first_punch: first.t, last_punch: single ? null : last.t,
      first_device: first.dev, last_device: single ? null : last.dev,
      devices, location: deviceLocation.get(norm(first.dev)) || deviceLocation.get(norm(first.serial)) || null,
      punch_count: g.punches.length, single_punch: single,
      total_minutes: mins, regular_minutes: Math.min(mins, OT_AFTER_MIN), ot_minutes: otMin,
    });
  }
  days.sort((a, b) => (b.date.localeCompare(a.date)) || a.code.localeCompare(b.code, undefined, { numeric: true }));

  const people = new Map();
  for (const d of days) {
    if (!people.has(norm(d.code))) people.set(norm(d.code), { code: d.code, days: 0, total_minutes: 0, regular_minutes: 0, ot_minutes: 0, devices: new Set(), single_days: 0 });
    const p = people.get(norm(d.code));
    p.days++; p.total_minutes += d.total_minutes; p.regular_minutes += d.regular_minutes; p.ot_minutes += d.ot_minutes;
    if (d.single_punch) p.single_days++;
    d.devices.forEach(x => p.devices.add(x));
  }
  const peopleArr = [...people.values()].map(p => ({ ...p, devices: [...p.devices] }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const devCount = new Map();
  for (const r of logRows) {
    const log = JSON.parse(r.data);
    const code = String(log.EmployeeCode || '').trim();
    if (!code || mapped.has(norm(code))) continue;
    const dev = String(log.DeviceName || log.SerialNumber || 'Unknown device').trim();
    devCount.set(dev, (devCount.get(dev) || 0) + 1);
  }
  const devices = [...devCount.entries()].map(([name, punches]) => ({ name, punches, location: deviceLocation.get(norm(name)) || null })).sort((a, b) => b.punches - a.punches);

  return {
    days, people: peopleArr, devices,
    summary: {
      people: peopleArr.length, person_days: days.length,
      total_minutes: days.reduce((s, d) => s + d.total_minutes, 0),
      ot_minutes: days.reduce((s, d) => s + d.ot_minutes, 0),
      single_punch_days: days.filter(d => d.single_punch).length,
      ot_after_hours: OT_AFTER_HOURS,
    },
  };
}

/** Month muster workbook (grid of P marks, hours grid, daily punches, summary). */
export async function buildOffRoleWorkbook({ year, month, device, search }, ExcelJS) {
  const dim = new Date(year, month, 0).getDate();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
  const data = await loadOffRole({ from, to, device, search });
  const monthLabel = `${MON[month - 1]} ${year}`;

  const BLACK = 'FF111111', GOLD = 'FFFCD116', LINE = 'FFD1D5DB';
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const thin = { style: 'thin', color: { argb: LINE } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Maxvolt One';

  const banner = (ws, cols, title, sub) => {
    ws.mergeCells(1, 1, 1, cols);
    const t = ws.getCell(1, 1);
    t.value = title; t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: GOLD } };
    t.fill = fill(BLACK); t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, cols);
    const s = ws.getCell(2, 1);
    s.value = sub; s.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF374151' } };
    s.fill = fill('FFFEF9C3'); s.alignment = { vertical: 'middle', wrapText: true, indent: 1 }; ws.getRow(2).height = 28;
  };
  const headRow = (ws, rowNo, labels, startCol = 1) => {
    labels.forEach((l, i) => {
      const c = ws.getCell(rowNo, startCol + i);
      c.value = l; c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: GOLD } };
      c.fill = fill(BLACK); c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(rowNo).height = 30;
  };
  const sub = `Off-role (unmapped) biometric punches · ${monthLabel} · First punch → last punch of the day · Overtime = hours beyond ${OT_AFTER_HOURS} h/day · Generated ${new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} IST`;

  // Per-person day lookup
  const byPerson = new Map();
  for (const d of data.days) {
    if (!byPerson.has(d.code)) byPerson.set(d.code, new Map());
    byPerson.get(d.code).set(Number(d.date.slice(8, 10)), d);
  }
  const people = data.people;

  // ── Sheet 1: Muster (P / P* marks) ──
  const INFO = 3, SUMM = 5;
  const ws = wb.addWorksheet('Off Role Muster', { views: [{ state: 'frozen', xSplit: INFO, ySplit: 5 }], properties: { tabColor: { argb: GOLD } } });
  const total1 = INFO + dim + SUMM;
  banner(ws, total1, `OFF ROLE ATTENDANCE MUSTER — ${monthLabel.toUpperCase()}`, sub + '   |   P = present (in & out punched) · P* = single punch only · blank = no punch');
  ws.getColumn(1).width = 6; ws.getColumn(2).width = 16; ws.getColumn(3).width = 34;
  for (let d = 1; d <= dim; d++) ws.getColumn(INFO + d).width = 4.6;
  for (let i = 1; i <= SUMM; i++) ws.getColumn(INFO + dim + i).width = 10;
  // row 3 legend spacer, row 4 weekday names, row 5 headers
  const dayLabels = Array.from({ length: dim }, (_, i) => String(i + 1));
  headRow(ws, 5, ['S.No', 'Biometric Code', 'Biometric Machine(s)', ...dayLabels, 'Days Present', 'Total Hrs', 'Regular Hrs', 'OT Hrs', 'Punch Gaps'], 1);
  for (let d = 1; d <= dim; d++) {
    const dw = dowOf(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    const c = ws.getCell(4, INFO + d);
    c.value = DOW[dw].slice(0, 2); c.font = { name: 'Calibri', size: 8, bold: true, color: { argb: dw === 0 ? 'FFB91C1C' : 'FF374151' } };
    c.alignment = { horizontal: 'center' }; c.fill = fill(dw === 0 ? 'FFFEE2E2' : 'FFF3F4F6'); c.border = box;
    if (dw === 0) ws.getCell(5, INFO + d).fill = fill('FF7F1D1D');
  }
  let rowNo = 6;
  people.forEach((p, idx) => {
    const m = byPerson.get(p.code) || new Map();
    const row = ws.getRow(rowNo);
    row.getCell(1).value = idx + 1; row.getCell(2).value = p.code; row.getCell(3).value = p.devices.join(', ');
    for (let d = 1; d <= dim; d++) {
      const rec = m.get(d); const c = row.getCell(INFO + d);
      if (rec) { c.value = rec.single_punch ? 'P*' : 'P'; c.fill = fill(rec.ot_minutes > 0 ? 'FFFDBA74' : (rec.single_punch ? 'FFFEF08A' : 'FFBBF7D0')); }
      c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF111111' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = box;
    }
    const a = ws.getCell(rowNo, INFO + 1).address, z = ws.getCell(rowNo, INFO + dim).address;
    const vals = [p.days, r2(p.total_minutes / 60), r2(p.regular_minutes / 60), r2(p.ot_minutes / 60), p.single_days];
    vals.forEach((v, i) => { const c = row.getCell(INFO + dim + 1 + i); c.value = v; c.numFmt = i === 0 || i === 4 ? '0' : '0.00'; c.font = { name: 'Calibri', size: 10, bold: true }; c.alignment = { horizontal: 'center' }; c.border = box; c.fill = fill('FFF9FAFB'); });
    [1, 2, 3].forEach(ci => { const c = row.getCell(ci); c.font = { name: 'Calibri', size: 10, bold: ci === 2 }; c.border = box; c.alignment = { vertical: 'middle', wrapText: ci === 3, horizontal: ci === 3 ? 'left' : 'center' }; });
    row.height = 18;
    rowNo++;
  });
  if (!people.length) { ws.mergeCells(6, 1, 6, total1); ws.getCell(6, 1).value = 'No off-role punches in this period.'; ws.getCell(6, 1).alignment = { horizontal: 'center' }; ws.getCell(6, 1).font = { italic: true, color: { argb: 'FF6B7280' } }; rowNo = 7; }
  else {
    const t = ws.getRow(rowNo);
    t.getCell(1).value = 'TOTAL'; ws.mergeCells(rowNo, 1, rowNo, INFO);
    for (let d = 1; d <= dim; d++) { const col = ws.getColumn(INFO + d).letter; const c = t.getCell(INFO + d); c.value = { formula: `COUNTA(${col}6:${col}${rowNo - 1})` }; c.alignment = { horizontal: 'center' }; }
    for (let i = 1; i <= SUMM; i++) { const col = ws.getColumn(INFO + dim + i).letter; const c = t.getCell(INFO + dim + i); c.value = { formula: `SUM(${col}6:${col}${rowNo - 1})` }; c.numFmt = i === 1 || i === 5 ? '0' : '0.00'; c.alignment = { horizontal: 'center' }; }
    t.eachCell({ includeEmpty: true }, (c) => { c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill('FF1F2937'); c.border = box; });
    t.height = 20;
  }
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: total1 } };

  // ── Sheet 2: Hours grid ──
  const w2 = wb.addWorksheet('Hours by Day', { views: [{ state: 'frozen', xSplit: INFO, ySplit: 5 }] });
  banner(w2, total1, `OFF ROLE — DAILY WORKING HOURS — ${monthLabel.toUpperCase()}`, sub + '   |   Each cell = hours between first and last punch. Orange = day with overtime.');
  w2.getColumn(1).width = 6; w2.getColumn(2).width = 16; w2.getColumn(3).width = 34;
  for (let d = 1; d <= dim; d++) w2.getColumn(INFO + d).width = 5.4;
  for (let i = 1; i <= SUMM; i++) w2.getColumn(INFO + dim + i).width = 10;
  headRow(w2, 5, ['S.No', 'Biometric Code', 'Biometric Machine(s)', ...dayLabels, 'Days Present', 'Total Hrs', 'Regular Hrs', 'OT Hrs', 'Punch Gaps'], 1);
  for (let d = 1; d <= dim; d++) {
    const dw = dowOf(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    const c = w2.getCell(4, INFO + d); c.value = DOW[dw].slice(0, 2);
    c.font = { name: 'Calibri', size: 8, bold: true, color: { argb: dw === 0 ? 'FFB91C1C' : 'FF374151' } }; c.alignment = { horizontal: 'center' }; c.fill = fill(dw === 0 ? 'FFFEE2E2' : 'FFF3F4F6'); c.border = box;
  }
  let r2no = 6;
  people.forEach((p, idx) => {
    const m = byPerson.get(p.code) || new Map(); const row = w2.getRow(r2no);
    row.getCell(1).value = idx + 1; row.getCell(2).value = p.code; row.getCell(3).value = p.devices.join(', ');
    for (let d = 1; d <= dim; d++) {
      const rec = m.get(d); const c = row.getCell(INFO + d);
      if (rec) { c.value = rec.single_punch ? 'P*' : r2(rec.total_minutes / 60); c.numFmt = '0.0'; c.fill = fill(rec.ot_minutes > 0 ? 'FFFDBA74' : (rec.single_punch ? 'FFFEF08A' : 'FFBBF7D0')); }
      c.font = { name: 'Calibri', size: 9 }; c.alignment = { horizontal: 'center' }; c.border = box;
    }
    [p.days, r2(p.total_minutes / 60), r2(p.regular_minutes / 60), r2(p.ot_minutes / 60), p.single_days].forEach((v, i) => { const c = row.getCell(INFO + dim + 1 + i); c.value = v; c.numFmt = i === 0 || i === 4 ? '0' : '0.00'; c.font = { name: 'Calibri', size: 10, bold: true }; c.alignment = { horizontal: 'center' }; c.border = box; c.fill = fill('FFF9FAFB'); });
    [1, 2, 3].forEach(ci => { const c = row.getCell(ci); c.font = { name: 'Calibri', size: 10, bold: ci === 2 }; c.border = box; });
    r2no++;
  });

  // ── Sheet 3: daily punch details ──
  const w3 = wb.addWorksheet('Daily Punch Details', { views: [{ state: 'frozen', ySplit: 4 }] });
  const cols3 = [['S.No', 6], ['Biometric Code', 16], ['Date', 14], ['Day', 7], ['First Punch', 12], ['First Punch Machine', 24], ['Last Punch', 12], ['Last Punch Machine', 24], ['Location', 18], ['Total Punches', 10], ['Gross Hours (h:mm)', 14], ['Gross Hours (dec)', 12], [`Regular Hrs (≤${OT_AFTER_HOURS}h)`, 14], [`OT Hrs (>${OT_AFTER_HOURS}h)`, 12], ['Remarks', 30]];
  w3.columns = cols3.map(([, w]) => ({ width: w }));
  banner(w3, cols3.length, `OFF ROLE — FIRST & LAST PUNCH PER DAY — ${monthLabel.toUpperCase()}`, sub);
  headRow(w3, 4, cols3.map(c => c[0]));
  const chrono = [...data.days].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.date.localeCompare(b.date));
  chrono.forEach((d, i) => {
    const remarks = d.single_punch ? 'Single punch — no out punch received' : (d.ot_minutes > 0 ? `Overtime ${hhmm(d.ot_minutes)} after ${OT_AFTER_HOURS}h` : '');
    const row = w3.addRow([i + 1, d.code, dateLabel(d.date), d.dow, timeOf(d.first_punch), d.first_device, d.last_punch ? timeOf(d.last_punch) : '—', d.last_device || '—', d.location || '', d.punch_count, d.single_punch ? '—' : hhmm(d.total_minutes), d.single_punch ? 0 : r2(d.total_minutes / 60), r2(d.regular_minutes / 60), r2(d.ot_minutes / 60), remarks]);
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (c, ci) => {
      c.font = { name: 'Calibri', size: 10, color: { argb: d.ot_minutes > 0 && ci >= 12 ? 'FFB45309' : 'FF111111' }, bold: ci === 2 || (ci === 14 && d.ot_minutes > 0) };
      c.border = box; c.alignment = { vertical: 'middle', horizontal: [6, 8, 9, 15].includes(ci) ? 'left' : 'center' };
      c.fill = fill(d.single_punch ? 'FFFEFCE8' : (i % 2 ? 'FFFAFAFA' : 'FFFFFFFF'));
      if (ci >= 12 && ci <= 14) c.numFmt = '0.00';
    });
  });
  if (chrono.length) {
    const last = 4 + chrono.length, tr = w3.addRow([]);
    tr.getCell(1).value = 'TOTAL'; w3.mergeCells(tr.number, 1, tr.number, 11);
    ['L', 'M', 'N'].forEach(col => { const c = tr.getCell(col); c.value = { formula: `SUM(${col}5:${col}${last})` }; c.numFmt = '0.00'; });
    tr.eachCell({ includeEmpty: true }, c => { c.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill('FF1F2937'); c.border = box; c.alignment = { horizontal: 'center' }; });
  }
  w3.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols3.length } };

  // ── Sheet 4: summary by machine ──
  const w4 = wb.addWorksheet('Machines & Summary');
  w4.columns = [{ width: 34 }, { width: 22 }, { width: 16 }, { width: 16 }];
  banner(w4, 4, `OFF ROLE — SUMMARY — ${monthLabel.toUpperCase()}`, sub);
  const kv = [['Unmapped biometric codes', data.summary.people], ['Person-days with punches', data.summary.person_days], ['Total hours (first→last punch)', r2(data.summary.total_minutes / 60)], [`Overtime hours (beyond ${OT_AFTER_HOURS} h/day)`, r2(data.summary.ot_minutes / 60)], ['Days with a single punch only', data.summary.single_punch_days]];
  kv.forEach(([k, v], i) => { const r = w4.getRow(4 + i); r.getCell(1).value = k; r.getCell(2).value = v; r.getCell(1).font = { bold: true }; r.getCell(2).alignment = { horizontal: 'left' }; });
  headRow(w4, 11, ['Biometric Machine', 'Location', 'Punches Received', '']);
  data.devices.forEach((d, i) => { const r = w4.getRow(12 + i); r.getCell(1).value = d.name; r.getCell(2).value = d.location || '—'; r.getCell(3).value = d.punches; [1, 2, 3].forEach(ci => { r.getCell(ci).border = box; r.getCell(ci).font = { name: 'Calibri', size: 10 }; }); r.getCell(3).alignment = { horizontal: 'center' }; });

  return { buffer: await wb.xlsx.writeBuffer(), counts: { people: people.length, days: data.days.length }, monthLabel };
}
