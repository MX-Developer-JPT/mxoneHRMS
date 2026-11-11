// Appraisal reports → xlsx / csv / pdf. Every report is built from the same row set so the three formats always agree.
// Confidential manager notes are never included; HR-only columns appear only when `hrView` is true.
import * as A from './appraisal.js';

const statusLabel = (r) => A.STATUS_LABEL[A.deriveStatus(r)] || A.deriveStatus(r);
const kpiTitle = (r, id) => A.flattenKpis(r.assignment?.items).find(k => k.id === id)?.title || id;

function build({ report, reviews, meetings, plans, cycle, hrView }) {
  const sc = (r) => r.scores || {};
  const base = (r) => ({ Employee: r.emp.name, Code: r.emp.code, Department: r.emp.department, Designation: r.emp.designation, Manager: r.emp.manager_name || '' });
  switch (report) {
    case 'individual': {
      const r = reviews[0]; const rows = [];
      for (const row of sc(r).manager_rows || sc(r).self_rows || []) {
        const s = (sc(r).self_rows || []).find(x => x.id === row.id);
        rows.push({ KPI: row.title || kpiTitle(r, row.id), 'Weight %': row.weight, 'Self rating': s?.rating ?? '', 'Manager rating': row.rating ?? '', 'Weighted score': row.weighted ?? '' });
      }
      rows.push({ KPI: 'TOTAL (manager)', 'Manager rating': '', 'Weighted score': sc(r).manager ?? 'incomplete' });
      if (hrView) rows.push({ KPI: 'FINAL (after HR)', 'Weighted score': sc(r).final ?? '', 'Self rating': sc(r).band || '' });
      return { title: `Appraisal — ${r.emp.name}`, rows };
    }
    case 'department': {
      const m = {}; for (const r of reviews) { const x = (m[r.emp.department || '—'] ||= { n: 0, done: 0, scores: [] }); x.n++; if (['approved', 'published', 'closed'].includes(A.deriveStatus(r))) x.done++; const f = sc(r).final ?? sc(r).manager; if (f != null) x.scores.push(f); }
      return { title: 'Department performance', rows: Object.entries(m).map(([d, x]) => ({ Department: d, Employees: x.n, Finalised: x.done, 'Completion %': Math.round(x.done / x.n * 100), 'Average score': x.scores.length ? A.round(x.scores.reduce((a, b) => a + b, 0) / x.scores.length, 2) : '' })) };
    }
    case 'kpi_achievement': {
      const rows = []; for (const r of reviews) for (const k of A.flattenKpis(r.assignment?.items)) { const m = r.mgr?.kpis?.[k.id]; const t = Number(k.target); const a = Number(m?.verified_actual); rows.push({ ...base(r), KPI: k.title, Target: k.target ?? '', Unit: k.unit || '', 'Employee-reported': r.self?.kpis?.[k.id]?.actual ?? '', 'Manager-verified': m?.verified_actual ?? '', 'Achievement %': t > 0 && Number.isFinite(a) && m?.verified_actual !== '' ? A.round(a / t * 100, 1) : '', 'Manager rating': m?.rating ?? '' }); }
      return { title: 'KPI achievement', rows };
    }
    case 'pending': return { title: 'Pending actions', rows: reviews.filter(r => !['published', 'closed'].includes(A.deriveStatus(r))).map(r => ({ ...base(r), Status: statusLabel(r), 'Self-assessment': r.self_status || 'pending', 'Manager evaluation': r.mgr_status || 'pending', Meeting: r.meeting_status || 'not_scheduled', 'Late self': r.flags?.late_self ? 'Yes' : '' })) };
    case 'meetings': { const ids = new Set(reviews.map(r => r.id)); const by = Object.fromEntries(reviews.map(r => [r.id, r])); return { title: 'Review meetings', rows: meetings.filter(m => ids.has(m.review_id)).map(m => ({ ...base(by[m.review_id]), Date: m.date, Time: m.start_time || '', Mode: m.mode, Status: m.status, 'Employee acknowledged': m.employee_ack ? (m.employee_ack.agrees ? 'Yes' : 'With comments') : '', 'Action items': (m.action_items || []).map(a => a.text).join('; ') })) }; }
    case 'calibration': return { title: 'Calibration', rows: reviews.filter(r => sc(r).manager != null).map(r => ({ ...base(r), 'Self score': sc(r).self ?? '', 'Manager score': sc(r).original_manager ?? sc(r).manager, 'HR adjusted': sc(r).hr_adjusted ?? '', Final: sc(r).final ?? '', Band: sc(r).band || '', 'Large gaps': (sc(r).gaps || []).map(g => `${kpiTitle(r, g.kpi_id)} (${g.self} vs ${g.manager})`).join('; '), 'Adjustment reason': (r.adjustments || []).slice(-1)[0]?.reason || '' })) };
    case 'training': { const ids = new Set(reviews.map(r => r.id)); const by = Object.fromEntries(reviews.map(r => [r.id, r])); return { title: 'Training & development needs', rows: plans.filter(x => ids.has(x.review_id)).map(x => ({ ...base(by[x.review_id]), 'Skill gap': x.skill_gap, Training: x.recommended_training, Category: x.category, Priority: x.priority, 'Target date': x.target_date, Status: x.status, 'Linked programme': x.training_program_name || '' })) }; }
    case 'self_assessments': return { title: 'Self-assessments', rows: reviews.map(r => ({ ...base(r), Status: r.self_status || 'pending', 'Submitted at': r.self?.submitted_at || '', Late: r.flags?.late_self ? 'Yes' : '', 'Self score': sc(r).self ?? '' })) };
    case 'manager_evaluations': return { title: 'Manager evaluations', rows: reviews.map(r => ({ ...base(r), Status: r.mgr_status || 'pending', 'Submitted at': r.mgr?.submitted_at || '', 'Manager score': sc(r).manager ?? '', Band: sc(r).band || '' })) };
    case 'final_summary': return { title: `Final summary — ${cycle?.name || ''}`, rows: reviews.map(r => ({ ...base(r), Status: statusLabel(r), 'Self score': sc(r).self ?? '', 'Manager score': sc(r).original_manager ?? sc(r).manager ?? '', 'HR adjusted': sc(r).hr_adjusted ?? '', 'Final score': sc(r).final ?? '', Rating: sc(r).band || '', 'Meeting': r.meeting_status || '' })) };
    default: return { error: 'Unknown report' };
  }
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : (/^[=+\-@]/.test(s) ? `'${s}` : s); };   // formula-injection safe

export async function exportReport({ report, format, cycle, reviews, meetings, plans, hrView }) {
  if (!reviews.length) return { error: 'There is nothing to export for this selection' };
  const b = build({ report, reviews, meetings, plans, cycle, hrView });
  if (b.error) return b;
  const cols = b.rows.length ? Object.keys(b.rows.reduce((a, r) => ({ ...a, ...r }), {})) : [];
  const slug = `${b.title.replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
  if (format === 'csv') return { base64: Buffer.from('﻿' + [cols.join(','), ...b.rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n'), 'utf8').toString('base64'), filename: `${slug}.csv` };
  if (format === 'pdf') {
    const { renderPdf } = await import('./pdfRender.js');
    const buf = await renderPdf({ pageOrientation: 'landscape', pageSize: 'A4', pageMargins: [24, 28, 24, 28], defaultStyle: { fontSize: 8 },
      content: [{ text: `Maxvolt Energy — ${b.title}`, fontSize: 14, bold: true, margin: [0, 0, 0, 2] }, { text: `${cycle?.name || ''} · generated ${new Date().toISOString().slice(0, 10)}`, color: '#555', margin: [0, 0, 0, 8] },
        { table: { headerRows: 1, widths: cols.map(() => '*'), body: [cols.map(c => ({ text: c, bold: true, fillColor: '#1A3C5E', color: '#fff' })), ...b.rows.map(r => cols.map(c => String(r[c] ?? '')))] }, layout: 'lightHorizontalLines' }] });
    return { base64: buf.toString('base64'), filename: `${slug}.pdf` };
  }
  const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(b.title.slice(0, 28).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow([`Maxvolt Energy — ${b.title}`]); ws.mergeCells(1, 1, 1, Math.max(cols.length, 2)); Object.assign(ws.getCell(1, 1), { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3C5E' } } });
  ws.addRow([`${cycle?.name || ''} · generated ${new Date().toISOString().slice(0, 10)}`]); ws.addRow([]);
  ws.addRow(cols).eachCell(c => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5986' } }, alignment: { horizontal: 'center', wrapText: true } }));
  for (const r of b.rows) ws.addRow(cols.map(c => r[c] ?? ''));
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(46, Math.max(12, c.length + 4)); }); ws.views = [{ state: 'frozen', ySplit: 4 }];
  return { base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'), filename: `${slug}.xlsx` };
}
