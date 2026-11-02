// Excel workbook for the payroll analytics (Summary, Departments, Monthly trend, Comparisons, Employee movements, Data review).
// HR / admin / management only — it names individual employees in the movements and review sheets.
import ExcelJS from 'exceljs';

const NAVY = 'FF1A3C5E', BLUE = 'FF2D5986', PALE = 'FFEAF1F8', GREY = 'FFF5F7FA', LINE = 'FFD0D7DE', FONT = 'Calibri';
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: LINE } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const INR = '#,##0;[Red]-#,##0';

export async function buildPayrollWorkbook(a) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One'; wb.created = new Date();
  const title = (ws, text, sub, cols) => {
    ws.mergeCells(1, 1, 1, cols); ws.mergeCells(2, 1, 2, cols);
    Object.assign(ws.getCell(1, 1), { value: text, font: { name: FONT, bold: true, size: 15, color: { argb: 'FFFFFFFF' } }, fill: solid(NAVY), alignment: { vertical: 'middle', indent: 1 } });
    Object.assign(ws.getCell(2, 1), { value: sub, font: { name: FONT, italic: true, size: 10, color: { argb: 'FF5A6B7B' } }, fill: solid(PALE), alignment: { vertical: 'middle', indent: 1, wrapText: true } });
    ws.getRow(1).height = 30; ws.getRow(2).height = 32;
  };
  const head = (row) => { row.height = 32; row.eachCell(c => Object.assign(c, { font: { name: FONT, bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } }, fill: solid(BLUE), border: box, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } })); };
  const body = (ws, startRow, matrix, fmts = []) => matrix.forEach((vals, i) => {
    const row = ws.getRow(startRow + i); vals.forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; Object.assign(c, { font: { name: FONT, size: 10.5 }, border: box, alignment: { vertical: 'middle', horizontal: j === 0 ? 'left' : typeof v === 'number' ? 'right' : 'left' }, ...(i % 2 ? { fill: solid(GREY) } : {}) }); if (fmts[j] && typeof v === 'number') c.numFmt = fmts[j]; });
  });
  const sub = `${a.period.label}. Source: uploaded payslips only. Total payroll cost = gross salary + employer contributions; employee deductions are not an extra cost. Exported ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}.`;
  const cmpP = a.comparison.previous, cmpY = a.comparison.year_ago, s = a.summary;

  // Summary
  const ws0 = wb.addWorksheet('Summary', { views: [{ showGridLines: false }], properties: { tabColor: { argb: NAVY } } });
  ws0.columns = [{ width: 38 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 14 }];
  title(ws0, `Payroll & compensation — ${a.period.label}`, sub, 6);
  ws0.addRow([]);
  head(ws0.addRow(['Measure', a.period.label, `${a.period.prev_label} (previous)`, 'Change %', `${a.period.yoy_label} (year ago)`, 'Change %']));
  const rows = [
    ['Total payroll cost (gross + employer contributions)', s.cost, a.previous.cost, cmpP.cost.pct, a.year_ago.cost, cmpY.cost.pct],
    ['Total gross salary', s.gross, a.previous.gross, cmpP.gross.pct, a.year_ago.gross, cmpY.gross.pct],
    ['Total net salary disbursed', s.net, a.previous.net, cmpP.net.pct, a.year_ago.net, cmpY.net.pct],
    ['Total employee deductions (not a company cost)', s.deductions, a.previous.deductions, null, a.year_ago.deductions, null],
    ['Total employer contributions', s.employer, a.previous.employer, null, a.year_ago.employer, null],
    ['Employees in payroll', s.headcount, a.previous.headcount, cmpP.headcount.pct, a.year_ago.headcount, cmpY.headcount.pct],
    ['Average gross salary per employee', s.avg_gross, a.previous.avg_gross, cmpP.avg_gross.pct, a.year_ago.avg_gross, cmpY.avg_gross.pct],
  ];
  body(ws0, 4, rows, [null, INR, INR, '0.0', INR, '0.0']);
  rows.forEach((r, i) => { if (r[0].startsWith('Employees')) [2, 3, 5].forEach(c => { ws0.getCell(4 + i, c).numFmt = '0'; }); });
  let r0 = 4 + rows.length + 1;
  Object.assign(ws0.getCell(r0, 1), { value: 'Readout', font: { name: FONT, bold: true, size: 12, color: { argb: NAVY } } }); r0++;
  for (const i of a.insights) { ws0.mergeCells(r0, 1, r0, 6); Object.assign(ws0.getCell(r0, 1), { value: (i.level === 'warn' ? '⚠ ' : '• ') + i.text, font: { name: FONT, size: 10.5 }, alignment: { wrapText: true, vertical: 'top' } }); ws0.getRow(r0).height = 32; r0++; }

  // Departments
  const wd = wb.addWorksheet('Departments', { properties: { tabColor: { argb: BLUE } } });
  const dh = ['Department', 'Headcount', 'Gross salary', 'Net salary', 'Employer contributions', 'Total payroll cost', 'Avg gross / employee', 'Share of cost %', 'Previous cost', 'Variance', 'Variance %', 'Year-ago variance %'];
  title(wd, `Department-wise payroll cost — ${a.period.label}`, sub, dh.length); wd.addRow([]); head(wd.addRow(dh));
  body(wd, 5, a.departments.map(d => [d.department, d.headcount, d.gross, d.net, d.employer, d.cost, d.avg_gross, d.share_pct, d.prev_cost, d.variance, d.variance_pct, d.yoy_variance_pct]), [null, '0', INR, INR, INR, INR, INR, '0.0', INR, INR, '0.0', '0.0']);
  [28, 11, 15, 15, 15, 16, 15, 12, 15, 14, 11, 13].forEach((w, i) => { wd.getColumn(i + 1).width = w; });
  wd.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];

  // Trend
  const wt = wb.addWorksheet('Monthly trend', { properties: { tabColor: { argb: 'FF5B9BD5' } } });
  const th = ['Month', 'Headcount', 'Gross salary', 'Net salary', 'Employee deductions', 'Employer contributions', 'Total payroll cost', 'Avg gross / employee', 'Cost change vs previous month %'];
  title(wt, 'Monthly payroll trend', sub, th.length); wt.addRow([]); head(wt.addRow(th));
  body(wt, 5, a.trend.filter(t => t.has_data).map(t => [t.label, t.headcount, t.gross, t.net, t.deductions, t.employer, t.cost, t.avg_gross, t.mom_pct]), [null, '0', INR, INR, INR, INR, INR, INR, '0.0']);
  [14, 11, 16, 16, 16, 16, 17, 16, 18].forEach((w, i) => { wt.getColumn(i + 1).width = w; });
  wt.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];

  // Year on year
  const wy = wb.addWorksheet('Year on year', { properties: { tabColor: { argb: 'FF5B9BD5' } } });
  const yh = ['Period', 'Headcount', 'Total payroll cost', 'Gross salary', 'Net salary', 'Avg gross / employee', 'Cost growth %', 'Headcount growth %', 'Avg salary growth %'];
  title(wy, a.period.mode === 'month' ? 'Same month, every year' : 'Financial years', sub, yh.length); wy.addRow([]); head(wy.addRow(yh));
  body(wy, 5, a.yoy_table.map(r => [r.label, r.headcount, r.cost, r.gross, r.net, r.avg_gross, r.growth_pct, r.headcount_growth_pct, r.avg_growth_pct]), [null, '0', INR, INR, INR, INR, '0.0', '0.0', '0.0']);
  [18, 11, 17, 16, 16, 16, 13, 16, 16].forEach((w, i) => { wy.getColumn(i + 1).width = w; });

  // Movements
  const wm = wb.addWorksheet('Employee movements', { properties: { tabColor: { argb: 'FFB45309' } } });
  const mh = ['Movement', 'Code', 'Employee', 'Department', `Gross ${a.movements.base_label || 'previous'}`, `Gross ${a.movements.label || 'current'}`, 'Change', 'Change %'];
  title(wm, `Employee cost movements — ${a.movements.label} vs ${a.movements.base_label}`, `Joiners, exits, increments, decreases and significant changes (±10% and ₹2,000 or more). ${sub}`, mh.length); wm.addRow([]); head(wm.addRow(mh));
  const mv = a.movements, mrows = [];
  mv.joiners.forEach(x => mrows.push([x.returning ? 'Joined (returning)' : 'Joined', x.code, x.name, x.department, null, x.gross, x.gross, null]));
  mv.exits.forEach(x => mrows.push(['Not in this month', x.code, x.name, x.department, x.gross, null, -x.gross, null]));
  mv.significant.forEach(x => mrows.push(['Significant change', x.code, x.name, x.department, x.prev_gross, x.gross, x.delta, x.pct]));
  mv.increments.filter(x => !mv.significant.some(s2 => s2.user_id === x.user_id)).forEach(x => mrows.push(['Increase', x.code, x.name, x.department, x.prev_gross, x.gross, x.delta, x.pct]));
  mv.decreases.filter(x => !mv.significant.some(s2 => s2.user_id === x.user_id)).forEach(x => mrows.push(['Decrease', x.code, x.name, x.department, x.prev_gross, x.gross, x.delta, x.pct]));
  body(wm, 5, mrows, [null, null, null, null, INR, INR, INR, '0.0']);
  [20, 12, 26, 22, 17, 17, 14, 11].forEach((w, i) => { wm.getColumn(i + 1).width = w; });
  wm.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }]; if (mrows.length) wm.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: mh.length } };

  // Data review
  const wq = wb.addWorksheet('Data review', { properties: { tabColor: { argb: 'FFC0392B' } } });
  const qh = ['Month', 'Code', 'Employee', 'Department', 'Gross', 'Net', 'Corrected', 'Issues'];
  title(wq, 'Payslip records to review', `${a.data_quality.flagged_count} flagged of ${a.data_quality.records} records in ${a.period.label}. ${a.data_quality.missing_payslips.count} active employee(s) have no payslip for ${a.data_quality.missing_payslips.month}.`, qh.length); wq.addRow([]); head(wq.addRow(qh));
  body(wq, 5, a.data_quality.flagged.map(f => [f.label, f.code, f.name, f.department, f.gross, f.net, f.corrected ? 'Yes' : '', [...f.issues, ...f.warnings].join('; ')]), [null, null, null, null, INR, INR, null, null]);
  [12, 12, 26, 22, 14, 14, 11, 80].forEach((w, i) => { wq.getColumn(i + 1).width = w; });
  return wb;
}
