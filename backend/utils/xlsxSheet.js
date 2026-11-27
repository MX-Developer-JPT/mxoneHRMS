// Shared styled-sheet helpers for the MIS workbooks (no database access, so exports can be tested on their own).
export const NAVY = 'FF1A3C5E', BLUE = 'FF2D5986', LIGHT = 'FFEEF2F7';
export const font = (b = false, color = 'FF1F2937', size = 10) => ({ name: 'Calibri', bold: b, size, color: { argb: color } });
export const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
export const border = () => ({ top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } } });

export function sheetWithTitle(wb, name, title, sub, cols) {
  // Excel sheet names: ≤31 chars, no \ / ? * [ ] :, and unique ignoring case ("Management" vs "management",
  // two long names sharing a prefix, or a department literally called "Summary").
  const base = String(name).replace(/[\\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet';
  const taken = new Set(wb.worksheets.map(w => w.name.toLowerCase()));
  let sheetName = base.slice(0, 31), n = 2;
  while (taken.has(sheetName.toLowerCase())) sheetName = `${base.slice(0, 28)} ${n++}`;
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([title]); ws.mergeCells(1, 1, 1, Math.max(cols, 2));
  Object.assign(ws.getCell(1, 1), { font: font(true, 'FFFFFFFF', 14), fill: fill(NAVY), alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } });
  ws.getRow(1).height = 28;
  ws.addRow([sub]); ws.mergeCells(2, 1, 2, Math.max(cols, 2));
  Object.assign(ws.getCell(2, 1), { font: font(false, 'FF374151', 9), fill: fill(LIGHT), alignment: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true } });
  ws.addRow([]); ws.getRow(3).height = 4;
  return ws;
}
export function table(ws, heads, rows, widths, opts = {}) {
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
export function section(ws, text) {
  ws.addRow([]);
  const r = ws.addRow([text]);
  r.getCell(1).font = font(true, NAVY, 12);
  r.height = 20;
}
