// Excel export of the MRF-wise MIS. Takes the same result the screen shows, so the workbook always matches it.
import { sheetWithTitle, table, section } from './xlsxSheet.js';

const fmtD = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}`; };

const v = (x) => (x === null || x === undefined ? '' : x);

export async function buildMrfMisWorkbook(m, ExcelJS, { subtitle = '' } = {}) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
  const sub = `Generated ${fmtD(m.today)}${subtitle ? ` · ${subtitle}` : ''}`;

  let ws = sheetWithTitle(wb, 'Summary', 'Recruitment MIS — manpower requisitions', sub, 6);
  table(ws, ['Measure', 'Value', 'Unit'], m.kpis.map((k) => [k.label, v(k.value), k.unit || '']), [44, 14, 10]);
  section(ws, 'Overall funnel');
  table(ws, ['Stage', 'Candidates', 'Conversion from previous %', 'Drop-off %', 'Avg days from previous', 'Waiting here now'], m.funnel.map((s) => [s.label, s.count, v(s.conversion_pct), v(s.dropoff_pct), v(s.avg_days), s.waiting]), [44, 14, 24, 14, 22, 18]);

  const heads = ['MRF ID', 'Department', 'Designation', 'Position tier', 'Hiring Manager', 'Recruiter', 'Budget status', 'Requisition type', 'Experience', 'Proposed CTC', 'Submission date', 'Target date', 'Current stage',
    'Total CVs', 'Shortlisted', 'Sent for review', 'Approved', 'Rejected by manager', 'Interviews scheduled', 'Interviews completed', 'Selected', 'Offers released', 'Offers accepted', 'Offers declined', 'Joined',
    'Positions', 'Positions filled', 'Positions remaining', 'Overall progress %', 'Fulfilment %', 'Days elapsed', 'Days remaining', 'SLA status', 'Current bottleneck', 'Reopened', 'Positions withdrawn', 'Days on hold'];
  ws = sheetWithTitle(wb, 'MRF Matrix', 'MRF-wise recruitment matrix', sub, heads.length);
  table(ws, heads, m.mrfs.map((r) => [r.mrf_no || 'Older', r.department, r.designation, r.tier_label, r.hiring_manager, r.recruiter, r.budget_label, r.type_label, r.experience, r.ctc_label, fmtD(r.submission_date), fmtD(r.target_date), r.stage_label,
    r.total_cvs, r.shortlisted, r.sent_for_review, r.hm_approved, r.hm_rejected, r.interviews_scheduled, r.interviews_completed, r.selected, r.offers_released, r.offers_accepted, r.offers_declined, r.joined,
    r.positions, r.filled, r.remaining, r.progress_pct, r.fulfilment_pct, v(r.days_elapsed), v(r.days_remaining), r.sla_label, r.bottleneck ? `${r.bottleneck.label} (${r.bottleneck.count})` : '', r.reopened ? 'Yes' : '', r.positions_withdrawn || '', r.on_hold_days || '']),
  [16, 20, 24, 18, 20, 20, 16, 20, 12, 18, 14, 14, 26, ...Array(19).fill(11), 14, 18, 34, 10, 12, 10]);

  ws = sheetWithTitle(wb, 'MRF Funnels', 'Funnel and stage time per requisition', sub, 8);
  table(ws, ['MRF ID', 'Designation', 'Stage', 'Candidates', 'Conversion %', 'Drop-off %', 'Avg days from previous', 'Waiting here'],
    m.mrfs.flatMap((r) => r.funnel.map((s) => [r.mrf_no || 'Older', r.designation, s.label, s.count, v(s.conversion_pct), v(s.dropoff_pct), v(s.avg_days), s.waiting])), [16, 26, 36, 12, 14, 12, 22, 12]);

  ws = sheetWithTitle(wb, 'Bottlenecks', 'Items past their configured time', sub, 7);
  table(ws, ['Bottleneck', 'MRF ID', 'Designation', 'Candidate', 'Waiting since', 'Days', 'Allowed days'], m.bottlenecks.flatMap((b) => b.items.map((i) => [b.label, i.mrf_no || 'Older', i.designation, i.name || '', fmtD(i.since), i.days, i.limit])), [40, 16, 26, 26, 14, 8, 12]);

  const gh = ['MRFs', 'Open', 'Positions', 'Filled', 'Remaining', 'Fill %', 'Overdue', 'CVs', 'Shortlisted', 'Interviews', 'Offers', 'Accepted', 'Joined', 'Avg time to fill', 'Proposed annual CTC (₹)'];
  const gr = (x) => [x.mrfs, x.open, x.positions, x.filled, x.remaining, x.fill_pct, x.overdue, x.cvs, x.shortlisted, x.interviews, x.offers, x.accepted, x.joined, v(x.avg_time_to_fill), x.proposed_annual_ctc];
  for (const [name, title, first, list] of [['Departments', 'Department-wise progress', 'Department', m.departments], ['Recruiters', 'Recruiter-wise performance', 'Recruiter', m.recruiters], ['Budget', 'Budget analysis', 'Budget status', m.budget], ['Financial years', 'Financial year comparison', 'Financial year', m.comparisons.by_fy]]) {
    ws = sheetWithTitle(wb, name, title, sub, gh.length + 1); table(ws, [first, ...gh], list.map((x) => [x.name, ...gr(x)]), [28, ...Array(13).fill(11), 16, 24]);
  }
  ws = sheetWithTitle(wb, 'Monthly trend', 'Month-wise comparison', sub, 5); table(ws, ['Month', 'MRFs submitted', 'CVs received', 'Offers released', 'Joined'], m.comparisons.by_month.map((x) => [x.month, x.submitted, x.cvs, x.offers, x.joined]), [14, 16, 14, 16, 10]);
  if (m.comparisons.periods) {
    const p = m.comparisons.periods;
    ws = sheetWithTitle(wb, 'Period comparison', 'Selected period against the one before it', sub, 4);
    table(ws, ['Measure', `${fmtD(p.current.from)} to ${fmtD(p.current.to)}`, `${fmtD(p.previous.from)} to ${fmtD(p.previous.to)}`, 'Unit'], p.rows.map((x) => [x.label, v(x.current), v(x.previous), x.unit]), [44, 26, 26, 10]);
  }
  const labels = Object.fromEntries(m.stage_labels.map((s, i) => [i, s.label]));
  ws = sheetWithTitle(wb, 'Candidates', 'Candidates behind the numbers', sub, 7);
  table(ws, ['MRF ID', 'Designation', 'Candidate', 'Current status', 'Furthest stage', 'Applied', 'In this status since'], m.candidates.map((c) => [c.mrf_no || 'Older', c.designation, c.name, c.status_label, labels[c.reached] || '', fmtD(c.applied), fmtD(c.since)]), [16, 26, 28, 24, 34, 12, 18]);
  ws = sheetWithTitle(wb, 'Audit trail', 'Status changes, approvals, comments and overrides', sub, 5);
  table(ws, ['MRF ID', 'When (UTC)', 'By', 'Action', 'Detail'], m.mrfs.flatMap((r) => r.history.map((h) => [r.mrf_no || 'Older', String(h.at).replace('T', ' ').slice(0, 16), h.by, String(h.action).replace(/_/g, ' '), h.detail])), [16, 18, 24, 28, 80]);
  return wb;
}
