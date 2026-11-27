// Presentation-quality Excel report of the recruitment matrix and funnel: one requisition, or every requisition submitted in a
// month. Built from the same computeMrfMis result the screen shows, so the figures always match it.
import { NAVY, BLUE, LIGHT, font, fill } from './xlsxSheet.js';
import { CANDIDATE_STAGES, OPEN_MRF, istDay } from './mrfMis.js';
import { SLA_LABELS } from './mrfRules.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** { from, to } of a "YYYY-MM" month, or null when it is not one. */
export function monthRange(ym) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''))) return null;
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${last}` };
}

const day = (v) => { const d = istDay(v); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${d.slice(0, 4)}` : ''; };
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);
const pctText = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const sum = (list, key) => list.reduce((s, x) => s + (Number(x[key]) || 0), 0);
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

const WHITE = 'FFFFFFFF', INK = 'FF1F2937', MUTED = 'FF6B7280', LINE = 'FFD9E0EA', ZEBRA = 'FFF7F9FC', BAR = 'FF2563EB';
const TONE = {
  bad: ['FFFEE2E2', 'FF991B1B'], warn: ['FFFEF3C7', 'FF78350F'], late: ['FFFFEDD5', 'FF9A3412'], good: ['FFDCFCE7', 'FF166534'], plain: ['FFF3F4F6', 'FF374151'],
};
const SLA_TONE = { overdue: 'bad', delayed: 'warn', approaching: 'warn', completed_late: 'late', on_track: 'good', completed_on_time: 'good' };
// one blue, light to dark: how much of a requisition's CVs reached the stage
const HEAT = [['FFEFF5FF', INK], ['FFDBEAFE', INK], ['FFBFDBFE', INK], ['FF93C5FD', INK], ['FF2563EB', WHITE]];

const thin = { style: 'thin', color: { argb: LINE } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

/** Writes one (possibly merged) cell with its style. */
function put(ws, r, c1, c2, value, { f = font(false, INK), bg, align = 'left', border = box, wrap = true, indent } = {}) {
  if (c2 > c1) ws.mergeCells(r, c1, r, c2);
  const cell = ws.getCell(r, c1);
  cell.value = value;
  for (let c = c1; c <= c2; c++) {
    const x = ws.getCell(r, c);
    x.font = f; if (bg) x.fill = fill(bg); if (border) x.border = border;
    x.alignment = { vertical: 'middle', horizontal: align, wrapText: wrap, indent: indent ?? (align === 'left' ? 1 : 0) };
  }
  return cell;
}

const sheetName = (wb, wanted) => {
  const base = String(wanted).replace(/[\\/?*[\]:']/g, ' ').trim().slice(0, 28) || 'Sheet';
  const taken = new Set(wb.worksheets.map((w) => w.name.toLowerCase()));
  let name = base, n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
  return name;
};

function newSheet(wb, name, { landscape = true, tab = NAVY, views } = {}) {
  const ws = wb.addWorksheet(sheetName(wb, name), {
    properties: { tabColor: { argb: tab } }, views: [views || { showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.headerFooter = { oddFooter: '&L&8Maxvolt Energy Industries Limited · Confidential&R&8&A · Page &P of &N' };
  return ws;
}

function titleBand(ws, c1, c2, title, line, note) {
  put(ws, 1, c1, c2, title, { f: font(true, WHITE, 18), bg: NAVY, border: null }); ws.getRow(1).height = 34;
  put(ws, 2, c1, c2, line, { f: font(true, WHITE, 11), bg: BLUE, border: null }); ws.getRow(2).height = 20;
  put(ws, 3, c1, c2, note, { f: font(false, 'FF374151', 9), bg: LIGHT, border: null }); ws.getRow(3).height = 18;
  return 4;
}

function heading(ws, r, c1, c2, text) {
  ws.getRow(r).height = 10;
  put(ws, r + 1, c1, c2, text.toUpperCase(), { f: font(true, NAVY, 11), border: { bottom: { style: 'medium', color: { argb: NAVY } } }, indent: 0 });
  ws.getRow(r + 1).height = 20;
  return r + 2;
}

function headRow(ws, r, cells) {
  for (const [c1, c2, text, align = 'center'] of cells) put(ws, r, c1, c2, text, { f: font(true, WHITE, 10), bg: BLUE, align });
  ws.getRow(r).height = 28;
  return r + 1;
}

/** Large figures in four boxes per line. cols = four [first, last] column pairs. */
function tiles(ws, r, cols, items) {
  for (let i = 0; i < items.length; i += 4) {
    items.slice(i, i + 4).forEach(([label, value, tone], n) => {
      const [c1, c2] = cols[n]; const [bg, ink] = tone ? TONE[tone] : [LIGHT, NAVY];
      const edge = { style: 'medium', color: { argb: WHITE } };
      put(ws, r, c1, c2, label, { f: font(false, MUTED, 9), bg, align: 'center', border: { top: edge, left: edge, right: edge } });
      put(ws, r + 1, c1, c2, value, { f: font(true, ink, 20), bg, align: 'center', border: { bottom: edge, left: edge, right: edge } });
    });
    ws.getRow(r).height = 18; ws.getRow(r + 1).height = 32; r += 2;
  }
  return r;
}

const FUNNEL_COLS = [2, 38, 48, 13, 14, 12, 12, 12];   // margin, stage, bar, candidates, conversion, drop-off, days, waiting
const TILE_COLS = [[2, 2], [3, 3], [4, 5], [6, 8]];
const BAR_CHARS = 38;

/** The funnel as a table with a centred bar per stage, so the narrowing shape can be seen. */
function funnelBlock(ws, r, stages) {
  r = headRow(ws, r, [[2, 2, 'Stage', 'left'], [3, 3, 'Funnel'], [4, 4, 'Candidates'], [5, 5, 'Conversion from previous'], [6, 6, 'Drop-off'], [7, 7, 'Average days'], [8, 8, 'Waiting here']]);
  const max = Math.max(1, ...stages.map((s) => s.count));
  stages.forEach((s, i) => {
    const bg = i % 2 ? ZEBRA : WHITE;
    put(ws, r, 2, 2, s.label, { bg });
    put(ws, r, 3, 3, s.count ? '█'.repeat(Math.max(1, Math.round((s.count / max) * BAR_CHARS))) : '', { f: { name: 'Consolas', size: 11, color: { argb: BAR } }, bg, align: 'center', wrap: false });
    put(ws, r, 4, 4, s.count, { f: font(true, INK, 12), bg, align: 'center' });
    put(ws, r, 5, 5, pctText(s.conversion_pct), { bg, align: 'center' });
    put(ws, r, 6, 6, pctText(s.dropoff_pct), { bg, align: 'center' });
    put(ws, r, 7, 7, dash(s.avg_days), { bg, align: 'center' });
    put(ws, r, 8, 8, s.waiting || '—', { f: font(!!s.waiting, s.waiting ? TONE.warn[1] : MUTED), bg: s.waiting ? TONE.warn[0] : bg, align: 'center' });
    ws.getRow(r).height = 20; r++;
  });
  put(ws, r, 2, 8, 'A candidate counts in every stage up to the furthest one reached. Average days is the time from the previous stage, where both dates are recorded.', { f: font(false, MUTED, 8), border: null, indent: 0 });
  return r + 1;
}

function simpleTable(ws, r, columns, rows, empty) {
  r = headRow(ws, r, columns.map(([c1, c2, label, align]) => [c1, c2, label, align]));
  rows.forEach((row, i) => {
    columns.forEach(([c1, c2, , align], n) => put(ws, r, c1, c2, row[n], { bg: i % 2 ? ZEBRA : WHITE, align: align || 'center' }));
    ws.getRow(r).height = 18; r++;
  });
  if (!rows.length) { put(ws, r, columns[0][0], columns.at(-1)[1], empty, { f: font(false, MUTED), align: 'center' }); r++; }
  return r;
}

/** One requisition on one sheet: details, headline figures, funnel, stage dates, delays and history. */
function requisitionSheet(wb, m, note, name) {
  const ws = newSheet(wb, name || m.mrf_no || 'Requisition', { landscape: false, tab: BLUE });
  FUNNEL_COLS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let r = titleBand(ws, 2, 8, 'Recruitment Funnel Report', [m.mrf_no || 'Older requisition', m.designation, m.department].filter(Boolean).join('  ·  '), note);

  r = heading(ws, r, 2, 8, 'Requisition details');
  const details = [
    ['Position tier', m.tier_label, 'Budget status', m.budget_label], ['Hiring Manager', m.hiring_manager, 'Requisition type', m.type_label], ['Recruiter', m.recruiter, 'Experience', m.experience],
    ['Proposed CTC', m.ctc_label, 'Current stage', m.stage_label], ['Submitted on', day(m.submission_date), 'Target hiring date', day(m.target_date)], ['Overall progress', `${m.progress_pct}%`, 'SLA status', m.sla_label],
  ];
  for (const [a, av, b, bv] of details) {
    put(ws, r, 2, 2, a, { f: font(true, 'FF4B5563'), bg: LIGHT }); put(ws, r, 3, 3, dash(av));
    const [bg, ink] = b === 'SLA status' ? TONE[SLA_TONE[m.sla_status] || 'plain'] : [WHITE, INK];
    put(ws, r, 4, 5, b, { f: font(true, 'FF4B5563'), bg: LIGHT }); put(ws, r, 6, 8, dash(bv), { f: font(b === 'SLA status', ink), bg });
    ws.getRow(r).height = 19; r++;
  }

  r = heading(ws, r, 2, 8, 'At a glance');
  r = tiles(ws, r, TILE_COLS, [
    ['Positions', m.positions], ['Positions filled', m.filled, m.filled ? 'good' : null], ['Positions remaining', m.remaining], ['Fulfilment', `${m.fulfilment_pct}%`],
    ['CVs received', m.total_cvs], ['Candidates joined', m.joined, m.joined ? 'good' : null], ['Days elapsed', dash(m.days_elapsed)], ['Days remaining', dash(m.days_remaining), m.days_remaining < 0 ? 'bad' : null],
  ]);

  r = heading(ws, r, 2, 8, 'Recruitment funnel');
  r = funnelBlock(ws, r, m.funnel);
  put(ws, r, 2, 8, `Current bottleneck: ${m.bottleneck ? `${m.bottleneck.label} — ${m.bottleneck.count}${m.bottleneck.breached ? `, longest ${m.bottleneck.max_days} days` : ''}` : 'none'}`
    + `   ·   Rejected by Hiring Manager: ${m.hm_rejected}   ·   Offers declined: ${m.offers_declined}`, { f: font(true, NAVY), bg: LIGHT });
  ws.getRow(r).height = 22; r++;

  ws.getRow(r - 1).addPageBreak();   // the funnel page prints on its own, dates and delays follow
  r = heading(ws, r, 2, 8, 'Stage dates');
  r = simpleTable(ws, r, [[2, 2, 'Milestone', 'left'], [3, 3, 'First reached on'], [4, 5, 'Candidates'], [6, 8, 'Status']],
    m.milestones.map((s) => [s.label, day(s.at) || '—', s.count ?? '—', s.at ? 'Done' : 'Not yet']));

  const delays = m.breaches || [];
  r = heading(ws, r, 2, 8, 'Delays past the allowed time');
  r = simpleTable(ws, r, [[2, 2, 'Delay', 'left'], [3, 3, 'Candidate', 'left'], [4, 5, 'Waiting since'], [6, 7, 'Days waiting'], [8, 8, 'Allowed']],
    delays.map((b) => [SLA_LABELS[b.rule] || b.rule, b.name || '—', day(b.since), b.days, b.limit]), 'Nothing is past its allowed time.');

  if (m.history?.length) {
    r = heading(ws, r, 2, 8, 'History');
    r = simpleTable(ws, r, [[2, 2, 'Action', 'left'], [3, 3, 'Detail', 'left'], [4, 5, 'Date'], [6, 8, 'By', 'left']],
      m.history.map((h) => [String(h.action).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), h.detail || '—', day(h.at), h.by || '—']));
    // long comments need the height to be seen
    m.history.forEach((h, i) => { const lines = Math.ceil(String(h.detail || '').length / 52); if (lines > 1) ws.getRow(r - m.history.length + i).height = Math.min(120, 14 * lines + 4); });
  }
  ws.pageSetup.printArea = `A1:H${r}`;
  return ws;
}

function candidatesSheet(wb, mis, rows, note) {
  const ids = new Set(rows.map((m) => m.id));
  const list = mis.candidates.filter((c) => ids.has(c.mrf_id));
  const hidden = sum(rows, 'total_cvs') - list.length;
  if (!list.length && hidden <= 0) return;
  const ws = newSheet(wb, 'Candidates', { views: { state: 'frozen', ySplit: 5, showGridLines: false } });
  [2, 18, 28, 30, 24, 36, 14, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let r = titleBand(ws, 2, 8, 'Candidates', `${list.length} candidate(s)`, hidden > 0 ? `${note}  ·  ${hidden} candidate(s) are counted in the funnel but not listed: candidate records are shown only to HR, admin, recruiters and the Hiring Manager.` : note);
  if (hidden > 0) ws.getRow(r - 1).height = 30;
  ws.getRow(r).height = 6; r++;
  const headAt = r;
  r = simpleTable(ws, r, [[2, 2, 'MRF ID', 'left'], [3, 3, 'Candidate', 'left'], [4, 4, 'Position', 'left'], [5, 5, 'Current status', 'left'], [6, 6, 'Furthest stage reached', 'left'], [7, 7, 'Applied on'], [8, 8, 'In this status since']],
    list.map((c) => [c.mrf_no || 'Older', c.name, c.designation, c.status_label, CANDIDATE_STAGES[c.reached]?.[1] || '', day(c.applied), day(c.since)]), 'No candidate records to list.');
  if (list.length) ws.autoFilter = { from: { row: headAt, column: 2 }, to: { row: r - 1, column: 8 } };
  ws.pageSetup.printTitlesRow = `${headAt}:${headAt}`;
}

export function buildRequisitionWorkbook(mis, ExcelJS, { requisitionId, by = '' } = {}) {
  const m = mis.mrfs.find((x) => x.id === requisitionId);
  if (!m) return null;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
  const note = `As on ${day(mis.today)}${by ? `  ·  Prepared by ${by}` : ''}`;
  requisitionSheet(wb, m, note);
  candidatesSheet(wb, mis, [m], note);
  return wb;
}

// ── Monthly report ──

const MATRIX_STAGES = [['total_cvs', 'CVs received'], ['shortlisted', 'Short-listed'], ['sent_for_review', 'Sent for review'], ['hm_approved', 'HM approved'], ['interviews_scheduled', 'Interview scheduled'],
  ['interviews_completed', 'Interview done'], ['selected', 'Selected'], ['offers_released', 'Offer released'], ['offers_accepted', 'Offer accepted'], ['pre_joining', 'Pre-joining'], ['joined', 'Joined']];
const stageCount = (m, i) => m.funnel[i].count;

function matrixSheet(wb, rows, label, note, links) {
  const before = [['MRF ID', 17], ['Designation', 26], ['Department', 18], ['Hiring Manager', 20], ['Recruiter', 18], ['Submitted', 13], ['Target date', 13]];
  const after = [['Positions', 10], ['Filled', 9], ['Remaining', 11], ['Fulfilment', 11], ['Current stage', 26], ['Days elapsed', 9], ['Days remaining', 11], ['SLA status', 19], ['Current bottleneck', 36]];
  const first = before.length + 1, lastStage = before.length + MATRIX_STAGES.length, cols = lastStage + after.length;
  const ws = newSheet(wb, 'MRF Matrix', { views: { state: 'frozen', xSplit: 2, ySplit: 5, showGridLines: false } });
  ws.pageSetup.paperSize = 8;   // A3: too wide to read on A4
  [...before.map((x) => x[1]), ...MATRIX_STAGES.map(() => 11), ...after.map((x) => x[1])].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  titleBand(ws, 1, cols, `Requisition Matrix — ${label}`, `${rows.length} requisition(s), one per line`, note);
  put(ws, 4, 1, before.length, 'REQUISITION', { f: font(true, WHITE, 9), bg: NAVY, align: 'center' });
  put(ws, 4, first, lastStage, 'RECRUITMENT FUNNEL — candidates reaching each stage (darker = larger share of the CVs received)', { f: font(true, WHITE, 9), bg: BAR, align: 'center' });
  put(ws, 4, lastStage + 1, cols, 'POSITIONS AND STATUS', { f: font(true, WHITE, 9), bg: NAVY, align: 'center' });
  ws.getRow(4).height = 18;
  headRow(ws, 5, [...before, ...MATRIX_STAGES.map(([, l]) => [l]), ...after].map(([l], i) => [i + 1, i + 1, l]));
  ws.getRow(5).height = 32;

  let r = 6;
  rows.forEach((m, i) => {
    const bg = i % 2 ? ZEBRA : WHITE;
    const left = [m.mrf_no || 'Older', m.designation, m.department, dash(m.hiring_manager), dash(m.recruiter), day(m.submission_date), day(m.target_date) || '—'];
    left.forEach((v, n) => put(ws, r, n + 1, n + 1, v, { bg, align: n >= 5 ? 'center' : 'left', f: font(n === 0, INK) }));
    const link = links.get(m.id);
    if (link) Object.assign(ws.getCell(r, 1), { value: { text: m.mrf_no || link, hyperlink: `#'${link}'!A1` }, font: { ...font(true, BAR), underline: true } });
    MATRIX_STAGES.forEach((_, s) => {
      const count = stageCount(m, s);
      const [heatBg, ink] = count ? HEAT[Math.min(4, Math.max(0, Math.ceil((count / Math.max(1, stageCount(m, 0))) * 5) - 1))] : [bg, 'FF9CA3AF'];
      put(ws, r, first + s, first + s, count, { f: font(!!count, ink, 11), bg: heatBg, align: 'center' });
    });
    const right = [m.positions, m.filled, m.remaining, m.fulfilment_pct / 100, m.stage_label, dash(m.days_elapsed), dash(m.days_remaining), m.sla_label, m.bottleneck ? `${m.bottleneck.label} (${m.bottleneck.count})` : '—'];
    right.forEach((v, n) => {
      const c = lastStage + 1 + n;
      const tone = n === 7 ? TONE[SLA_TONE[m.sla_status] || 'plain'] : n === 6 && m.days_remaining < 0 ? TONE.bad : null;
      put(ws, r, c, c, v, { bg: tone ? tone[0] : bg, f: font(!!tone, tone ? tone[1] : INK), align: n === 4 || n === 8 ? 'left' : 'center' });
      if (n === 3) ws.getCell(r, c).numFmt = '0%';
    });
    ws.getRow(r).height = 30; r++;
  });
  const lastData = r - 1;
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastData, column: cols } };

  // totals are live formulas, so they stay right if lines are removed or edited
  const col = (n) => ws.getColumn(n).letter;
  const totalAt = r, strong = { f: font(true, WHITE, 11), bg: NAVY, align: 'center' };
  put(ws, r, 1, before.length, `TOTAL — ${rows.length} requisition(s)`, { ...strong, align: 'left' });
  const totalCell = (c, result) => put(ws, r, c, c, { formula: `SUM(${col(c)}6:${col(c)}${lastData})`, result }, strong);
  MATRIX_STAGES.forEach((_, s) => totalCell(first + s, rows.reduce((a, m) => a + stageCount(m, s), 0)));
  const positions = sum(rows, 'positions'), filled = sum(rows, 'filled');
  totalCell(lastStage + 1, positions); totalCell(lastStage + 2, filled); totalCell(lastStage + 3, sum(rows, 'remaining'));
  put(ws, r, lastStage + 4, lastStage + 4, { formula: `IFERROR(${col(lastStage + 2)}${r}/${col(lastStage + 1)}${r},0)`, result: positions ? filled / positions : 0 }, strong);
  ws.getCell(r, lastStage + 4).numFmt = '0%';
  put(ws, r, lastStage + 5, cols, '', strong);
  ws.getRow(r).height = 24; r++;

  put(ws, r, 1, before.length, 'Conversion from the previous stage', { f: font(true, NAVY), bg: LIGHT });
  MATRIX_STAGES.forEach((_, s) => {
    const c = first + s;
    const total = (n) => rows.reduce((a, m) => a + stageCount(m, n), 0);
    const result = s ? (total(s - 1) ? total(s) / total(s - 1) : '—') : (total(0) ? 1 : '—');
    const formula = s ? `IFERROR(${col(c)}${totalAt}/${col(c - 1)}${totalAt},"—")` : `IF(${col(c)}${totalAt}>0,1,"—")`;
    put(ws, r, c, c, { formula, result }, { f: font(true, NAVY), bg: LIGHT, align: 'center' });
    ws.getCell(r, c).numFmt = '0%';
  });
  put(ws, r, lastStage + 1, cols, '', { bg: LIGHT });
  ws.getRow(r).height = 22;
  ws.pageSetup.printTitlesRow = '4:5';
}

function summarySheet(wb, mis, rows, label, note) {
  const ws = newSheet(wb, 'Summary', { landscape: false });
  FUNNEL_COLS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let r = titleBand(ws, 2, 8, 'Monthly Recruitment Report', `${label}  ·  requisitions submitted in the month`, note);
  const positions = sum(rows, 'positions'), filled = sum(rows, 'filled'), cvs = sum(rows, 'total_cvs'), joined = sum(rows, 'joined');
  const open = rows.filter((m) => OPEN_MRF.includes(m.status)).length, overdue = rows.filter((m) => m.sla_status === 'overdue').length;

  r = heading(ws, r, 2, 8, 'Month at a glance');
  r = tiles(ws, r, TILE_COLS, [
    ['Total requisitions', rows.length], ['Total positions', positions], ['Positions filled', filled, filled ? 'good' : null], ['Positions remaining', sum(rows, 'remaining')],
    ['CVs received', cvs], ['Offers released', sum(rows, 'offers_released')], ['Offers accepted', sum(rows, 'offers_accepted')], ['Candidates joined', joined, joined ? 'good' : null],
    ['Open requisitions', open], ['Overdue requisitions', overdue, overdue ? 'bad' : null], ['Fulfilment', pctText(ratio(filled, positions))], ['CV to joining', pctText(ratio(joined, cvs))],
  ]);

  r = heading(ws, r, 2, 8, 'Total recruitment funnel');
  r = funnelBlock(ws, r, mis.funnel);

  r = heading(ws, r, 2, 8, 'Department-wise');
  const departments = [...new Set(rows.map((m) => m.department || 'Not recorded'))].sort();
  r = simpleTable(ws, r, [[2, 2, 'Department', 'left'], [3, 3, 'Requisitions'], [4, 4, 'Positions'], [5, 5, 'Filled'], [6, 6, 'CVs'], [7, 7, 'Offers'], [8, 8, 'Joined']],
    departments.map((d) => { const l = rows.filter((m) => (m.department || 'Not recorded') === d); return [d, l.length, sum(l, 'positions'), sum(l, 'filled'), sum(l, 'total_cvs'), sum(l, 'offers_released'), sum(l, 'joined')]; }), 'No requisitions');
  ['Total', rows.length, positions, filled, cvs, sum(rows, 'offers_released'), joined].forEach((v, i) => put(ws, r, i + 2, i + 2, v, { f: font(true, WHITE), bg: NAVY, align: i ? 'center' : 'left' }));
  ws.getRow(r).height = 20; r++;

  r = heading(ws, r, 2, 8, 'SLA status');
  const statuses = [...new Set(rows.map((m) => m.sla_status))];
  r = headRow(ws, r, [[2, 2, 'Status', 'left'], [3, 3, 'Requisitions'], [4, 8, 'MRF IDs', 'left']]);
  for (const s of statuses) {
    const l = rows.filter((m) => m.sla_status === s); const [bg, ink] = TONE[SLA_TONE[s] || 'plain'];
    put(ws, r, 2, 2, l[0].sla_label, { f: font(true, ink), bg }); put(ws, r, 3, 3, l.length, { align: 'center' });
    const ids = l.map((m) => m.mrf_no || m.designation).join(', ');
    put(ws, r, 4, 8, ids); ws.getRow(r).height = Math.max(18, 14 * Math.ceil(ids.length / 70) + 4); r++;
  }
  ws.pageSetup.printArea = `A1:H${r}`;
}

/** mis = computeMrfMis result filtered to the month. Drafts are left out: they have not been submitted. */
export function buildMonthWorkbook(mis, ExcelJS, { month, by = '', filtersText = '', maxSheets = 150 } = {}) {
  const rows = mis.mrfs.filter((m) => m.status !== 'draft').sort((a, b) => String(a.submission_date).localeCompare(String(b.submission_date)) || String(a.mrf_no).localeCompare(String(b.mrf_no)));
  if (!rows.length) return null;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
  const label = monthLabel(month);
  const note = [`As on ${day(mis.today)}`, by && `Prepared by ${by}`, filtersText].filter(Boolean).join('  ·  ');
  summarySheet(wb, mis, rows, label, note);
  // names are fixed first so the matrix can link to each requisition's own sheet
  const names = new Map(), taken = new Set(['summary', 'mrf matrix', 'candidates']);
  rows.slice(0, maxSheets).forEach((m, i) => {
    const base = String(m.mrf_no || `Older ${i + 1}`).replace(/[\\/?*[\]:']/g, ' ').trim().slice(0, 28);
    let name = base, n = 2; while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
    taken.add(name.toLowerCase()); names.set(m.id, name);
  });
  matrixSheet(wb, rows, label, rows.length > maxSheets ? `${note}  ·  separate sheets for the first ${maxSheets} requisitions` : note, names);
  for (const m of rows.slice(0, maxSheets)) requisitionSheet(wb, m, note, names.get(m.id));
  candidatesSheet(wb, mis, rows, note);
  return wb;
}
