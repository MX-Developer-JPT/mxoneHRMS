// Recruitment MIS workbook: requisitions (manpower requisition workflow), applications, screening, interviews,
// offers, joinings, sources and departments for a date range — all read from live data.
import { all } from '../db.js';
import { sheetWithTitle, table, section, label, fmtD } from './misReport.js';

const IST_MS = 5.5 * 3600000;
const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const pj = (rows) => rows.map(r => { try { return { ...JSON.parse(r.data), id: r.id, _created: r.created_at ? String(r.created_at).slice(0, 10) : '' }; } catch { return null; } }).filter(Boolean);
const d10 = (v) => (v ? String(v).slice(0, 10) : '');
const gap = (a, b) => { const x = Date.parse(d10(a)), y = Date.parse(d10(b)); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 86400000) : null; };
const avg = (xs) => { const v = xs.filter(x => x != null); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const inr = (n) => (Number(n) ? Math.round(Number(n)) : '');

const ORDER = { applied: 0, screening: 1, shortlisted: 1, cv_sent: 1, interview_recommended: 1, interview_scheduled: 2, interviewed: 3, interview_done: 3, next_round_recommended: 3, selected: 4, offer_in_progress: 4, offered: 5, offer_accepted: 6, joined: 7 };
const STAGES = Object.keys(ORDER);
const reached = (c, stage) => stage === 'applied' || (ORDER[c.status] ?? -1) >= ORDER[stage] || (stage === 'offered' && !!c.offer_letter_date) || (stage === 'interviewed' && c._interviews.some(i => i.status === 'completed'));
const reqKey = (c) => c.requisition_id || c.job_requisition_id || c.job_id || '';

export async function collectRecruitmentMis({ from, to, department, requisition_id } = {}) {
  const today = istDate();
  to = d10(to) || today; from = d10(from) || addDays(to, -29);
  const reqs = pj(await all("SELECT id, data, created_at FROM entities WHERE type='JobRequisition'"));
  const reqById = Object.fromEntries(reqs.map(r => [r.id, r]));
  const interviews = pj(await all("SELECT id, data, created_at FROM entities WHERE type='Interview'"));
  const scores = pj(await all("SELECT id, data, created_at FROM entities WHERE type='CandidateScore'"));
  const empNames = {};
  for (const e of pj(await all("SELECT id, data, created_at FROM entities WHERE type='Employee'"))) if (e.user_id) empNames[e.user_id] = e.display_name || e.full_name || '';
  let cands = pj(await all("SELECT id, data, created_at FROM entities WHERE type='Candidate'"));
  const dept = (c) => c.department || reqById[reqKey(c)]?.department || 'Unassigned';
  const title = (r) => r.designation || r.position_title || r.job_title || '';
  const reqTitle = (c) => (reqById[reqKey(c)] ? title(reqById[reqKey(c)]) : '') || c.position_applied || c.position || '';
  const deptOk = (d) => !department || department === 'all' || d === department;
  cands = cands.filter(c => deptOk(dept(c)) && (!requisition_id || reqKey(c) === requisition_id));
  const intsBy = {}; for (const i of interviews) (intsBy[i.candidate_id] = intsBy[i.candidate_id] || []).push(i);
  const scoreBy = {}; for (const s of scores) { const k = s.candidate_id; if (!scoreBy[k] || String(s.created_at || s._created) > String(scoreBy[k].created_at || scoreBy[k]._created)) scoreBy[k] = s; }
  for (const c of cands) {
    c._interviews = (intsBy[c.id] || []).sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
    c._score = scoreBy[c.id]?.overall_score ?? c.ai_score ?? null;
    c._applied = d10(c.applied_date || c._created);
  }
  const period = cands.filter(c => c._applied >= from && c._applied <= to);
  const reqScope = reqs.filter(r => deptOk(r.department || 'Unassigned') && (!requisition_id || r.id === requisition_id));
  return { from, to, today, department: deptOk(department) && department && department !== 'all' ? department : null, reqs: reqScope, reqById, cands, period, interviews, dept, reqTitle, title, empNames, requisition_id };
}

export async function buildRecruitmentMisWorkbook(opts, ExcelJS) {
  const D = await collectRecruitmentMis(opts);
  const { from, to, today, cands, period, reqs } = D;
  const scope = `${D.department ? 'Department: ' + D.department : 'Entire company'}${D.requisition_id ? ' | One requisition' : ''}`;
  const sub = `Period ${fmtD(from)} to ${fmtD(to)}  |  ${scope}  |  Generated ${fmtD(today)}`;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';

  // ── numbers ──
  const inPeriodReqs = reqs.filter(r => d10(r.created_at || r._created) >= from && d10(r.created_at || r._created) <= to);
  const isOpen = (r) => ['pending_hm_approval', 'pending_hr_publication', 'published', 'on_hold', 'open', 'approved', 'active'].includes(String(r.status || '').toLowerCase());
  const openReqs = reqs.filter(isOpen);
  const positions = (r) => Number(r.number_of_positions) || 1;
  const filled = (r) => Number(r.positions_filled) || cands.filter(c => reqKey(c) === r.id && c.status === 'joined').length;
  const openVacancies = openReqs.reduce((s, r) => s + Math.max(0, positions(r) - filled(r)), 0);
  const ints = period.flatMap(c => c._interviews);
  const intAll = cands.flatMap(c => c._interviews).filter(i => d10(i.scheduled_date) >= from && d10(i.scheduled_date) <= to);
  const offered = cands.filter(c => c.offer_letter_date && d10(c.offer_letter_date) >= from && d10(c.offer_letter_date) <= to);
  const accepted = offered.filter(c => c.offer_status === 'accepted' || ['offer_accepted', 'joined'].includes(c.status));
  const declined = offered.filter(c => c.status === 'offer_declined' || c.offer_status === 'declined');
  const joinedP = cands.filter(c => c.status === 'joined' && d10(c.joining_date || c.joined_date) >= from && d10(c.joining_date || c.joined_date) <= to);
  const scored = period.filter(c => c._score != null);
  const tth = avg(cands.filter(c => c.status === 'joined' && (c.joining_date || c.joined_date)).map(c => gap(c._applied, c.joining_date || c.joined_date)));
  const t2offer = avg(cands.filter(c => c.offer_letter_date).map(c => gap(c._applied, c.offer_letter_date)));
  const t2int = avg(cands.filter(c => c._interviews[0]).map(c => gap(c._applied, c._interviews[0].scheduled_date)));
  const doneInts = intAll.filter(i => i.status === 'completed');
  const noFeedback = intAll.filter(i => d10(i.scheduled_date) < today && i.status === 'scheduled');

  // ── 1. Summary ──
  const ws = sheetWithTitle(wb, 'Summary', 'Recruitment MIS', sub, 6);
  const kpi = (name, value, note = '') => [name, value, note];
  table(ws, ['Metric', 'Value', 'Note'], [
    kpi('Requisitions raised in period', inPeriodReqs.length),
    kpi('Open requisitions (now)', openReqs.length, 'Awaiting approval, awaiting publication, published or on hold'),
    kpi('Open vacancies (now)', openVacancies, 'Positions not yet filled on open requisitions'),
    kpi('Applications received', period.length),
    kpi('CVs scored', scored.length, scored.length ? `Average score ${avg(scored.map(c => Number(c._score)))}` : 'None scored yet'),
    kpi('Interviews scheduled in period', intAll.length, `${doneInts.length} completed`),
    kpi('Interviews past date with no feedback', noFeedback.length, 'Needs follow-up with the interviewer'),
    kpi('Offers made', offered.length),
    kpi('Offers accepted', accepted.length, `${pct(accepted.length, offered.length)}% of offers made in the period`),
    kpi('Offers declined', declined.length),
    kpi('Offers awaiting response', offered.length - accepted.length - declined.length),
    kpi('Joined in period', joinedP.length),
    kpi('Average days: application to first interview', t2int ?? '—'),
    kpi('Average days: application to offer', t2offer ?? '—'),
    kpi('Average days: application to joining', tth ?? '—', 'Candidates who have joined'),
  ], [46, 16, 60]);

  section(ws, 'Hiring funnel (applications received in the period)');
  const fr = STAGES.map((s, i) => { const n = period.filter(c => reached(c, s)).length; const prev = i ? period.filter(c => reached(c, STAGES[i - 1])).length : n; return [label(s), n, i ? `${pct(n, prev)}%` : '', `${pct(n, period.length)}%`]; });
  table(ws, ['Stage reached', 'Candidates', 'From previous stage', 'Of all applicants'], fr, [46, 16, 22, 20]);
  const rejected = period.filter(c => c.status === 'rejected').length, decl = period.filter(c => c.status === 'offer_declined').length;
  ws.addRow([]); ws.addRow([`Rejected: ${rejected}   |   Offer declined: ${decl}   |   Still in the pipeline: ${period.filter(c => !['joined', 'rejected', 'offer_declined'].includes(c.status)).length}`]);

  section(ws, 'What needs attention');
  const notes = [];
  const old = openReqs.filter(r => gap(r.published_date || r.created_at || r._created, today) >= 45 && r.status === 'published');
  if (old.length) notes.push(`${old.length} published requisition(s) open for 45+ days: ${old.slice(0, 5).map(r => D.title(r)).join(', ')}`);
  const noCand = openReqs.filter(r => r.status === 'published' && !cands.some(c => reqKey(c) === r.id));
  if (noCand.length) notes.push(`${noCand.length} published requisition(s) have no candidates yet: ${noCand.slice(0, 5).map(r => D.title(r)).join(', ')}`);
  const waitHm = reqs.filter(r => r.status === 'pending_hm_approval');
  if (waitHm.length) notes.push(`${waitHm.length} requisition(s) waiting for the Hiring Manager to approve the JD`);
  const waitHr = reqs.filter(r => r.status === 'pending_hr_publication');
  if (waitHr.length) notes.push(`${waitHr.length} approved requisition(s) waiting for HR to publish`);
  if (noFeedback.length) notes.push(`${noFeedback.length} interview(s) are past their date with no feedback recorded`);
  const stale = period.filter(c => c.status === 'applied' && gap(c._applied, today) >= 7);
  if (stale.length) notes.push(`${stale.length} applicant(s) have waited 7+ days with no action`);
  const unscored = period.filter(c => c._score == null && c.status !== 'rejected');
  if (unscored.length) notes.push(`${unscored.length} applicant(s) have no CV score yet — use Score All on the requisition`);
  const lowAcc = offered.length >= 4 && pct(accepted.length, offered.length) < 50;
  if (lowAcc) notes.push(`Only ${pct(accepted.length, offered.length)}% of offers were accepted — review offer levels against expectations`);
  if (!notes.length) notes.push('Nothing needs attention for this period.');
  notes.forEach(n => { const r = ws.addRow(['• ' + n]); ws.mergeCells(r.number, 1, r.number, 3); r.getCell(1).alignment = { wrapText: true, vertical: 'top' }; r.height = 30; });

  // ── 2. Requisitions ──
  const ws2 = sheetWithTitle(wb, 'Requisitions', 'Requisitions and vacancies', sub, 17);
  const reqRows = reqs.map(r => {
    const cs = cands.filter(c => reqKey(c) === r.id);
    const openFrom = r.published_date || r.created_at || r._created;
    const f = filled(r);
    return [r.id, D.title(r), r.department || '', r.requisition_type ? label(r.requisition_type) : '', positions(r), f, Math.max(0, positions(r) - f), label(r.status),
      r.priority ? label(r.priority) : '', fmtD(r.created_at || r._created), fmtD(r.hm_approved_at), fmtD(r.published_date), isOpen(r) ? gap(openFrom, today) : (r.closed_at || r.closed_date ? gap(openFrom, r.closed_at || r.closed_date) : ''),
      cs.length, cs.reduce((s, c) => s + c._interviews.length, 0), cs.filter(c => c.offer_letter_date).length, avg(cs.filter(c => c._score != null).map(c => Number(c._score))) ?? ''];
  });
  table(ws2, ['MRF', 'Position', 'Department', 'Type', 'Positions', 'Filled', 'Vacant', 'Status', 'Priority', 'Raised', 'JD approved', 'Published', 'Days open', 'Candidates', 'Interviews', 'Offers', 'Avg CV score'], reqRows,
    [14, 30, 20, 16, 10, 8, 8, 24, 10, 12, 12, 12, 10, 11, 11, 9, 12]);

  // ── 3. Candidates ──
  const ws3 = sheetWithTitle(wb, 'Candidates', 'Applications received in the period', sub, 16);
  table(ws3, ['Candidate', 'Position', 'Department', 'MRF', 'Source', 'Applied', 'Stage', 'CV score', 'Experience (yrs)', 'Expected CTC', 'Notice', 'Interviews', 'Last interview', 'Offer date', 'Offer CTC', 'Joining / outcome'],
    period.sort((a, b) => b._applied.localeCompare(a._applied)).map(c => {
      const li = c._interviews[c._interviews.length - 1];
      const rq = D.reqById[reqKey(c)];
      return [c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || '', D.reqTitle(c), D.dept(c), rq?.id || '', label(c.source || 'walk_in'), fmtD(c._applied), label(c.status || 'applied'), c._score ?? '', c.experience_years ?? '', inr(c.expected_ctc), c.notice_period || '',
        c._interviews.length, li ? `${fmtD(li.scheduled_date)} ${label(li.status)}${li.recommendation ? ' — ' + label(li.recommendation) : ''}` : '', fmtD(c.offer_letter_date), inr(c.offer_ctc_annual || c.offer_ctc),
        c.status === 'joined' ? fmtD(c.joining_date || c.joined_date) : (c.rejection_reason || c.decline_reason || '')];
    }), [26, 28, 18, 12, 14, 12, 18, 10, 12, 14, 12, 10, 28, 12, 14, 24]);

  // ── 4. Interviews ──
  const ws4 = sheetWithTitle(wb, 'Interviews', 'Interviews in the period', sub, 11);
  const byId = Object.fromEntries(cands.map(c => [c.id, c]));
  table(ws4, ['Date', 'Candidate', 'Position', 'Round', 'Type', 'Mode', 'Interviewer', 'Status', 'Rating', 'Recommendation', 'Note'],
    intAll.sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date))).map(i => { const c = byId[i.candidate_id] || {};
      const who = (i.interviewer_ids || []).map(u => D.empNames[u] || '').filter(Boolean).join(', ');
      return [fmtD(i.scheduled_date), c.full_name || '', D.reqTitle(c), i.round_number || '', label(i.round_type), label(i.interview_mode), who, label(i.status), i.rating ?? '', i.recommendation ? label(i.recommendation) : '', i.status === 'scheduled' && d10(i.scheduled_date) < today ? 'No feedback — past date' : (i.notes || '').slice(0, 120)]; }),
    [12, 26, 28, 8, 16, 12, 24, 14, 8, 18, 36]);

  // ── 5. Offers ──
  const ws5 = sheetWithTitle(wb, 'Offers', 'Offers made in the period', sub, 11);
  table(ws5, ['Candidate', 'Position', 'Department', 'Offer date', 'Offer CTC (annual)', 'Expected CTC', 'vs expected', 'Offer status', 'Accepted on', 'Joining date', 'Days to respond'],
    offered.map(c => { const o = Number(c.offer_ctc_annual || c.offer_ctc) || 0, e = Number(c.expected_ctc) || 0;
      return [c.full_name || '', c.designation || D.reqTitle(c), D.dept(c), fmtD(c.offer_letter_date), inr(o), inr(e), o && e ? `${Math.round((o / e - 1) * 100)}%` : '', label(c.offer_status || c.status), fmtD(c.offer_accepted_at), fmtD(c.joining_date), c.offer_accepted_at ? gap(c.offer_letter_date, c.offer_accepted_at) : ''];
    }), [26, 28, 18, 12, 16, 14, 12, 16, 12, 12, 12]);

  // ── 6. Sources ──
  const ws6 = sheetWithTitle(wb, 'Sources', 'Source effectiveness', sub, 9);
  const srcs = {}; for (const c of period) (srcs[c.source || 'walk_in'] = srcs[c.source || 'walk_in'] || []).push(c);
  table(ws6, ['Source', 'Applied', 'Interviewed', 'Selected', 'Offered', 'Joined', 'Interview %', 'Offer %', 'Join %'],
    Object.entries(srcs).sort((a, b) => b[1].length - a[1].length).map(([s, l]) => { const n = (st) => l.filter(c => reached(c, st)).length; return [label(s), l.length, n('interviewed'), n('selected'), n('offered'), n('joined'), pct(n('interviewed'), l.length), pct(n('offered'), l.length), pct(n('joined'), l.length)]; }),
    [24, 10, 12, 10, 10, 10, 12, 10, 10]);

  // ── 7. Departments ──
  const ws7 = sheetWithTitle(wb, 'Departments', 'Department-wise hiring', sub, 9);
  const depts = [...new Set([...reqs.map(r => r.department || 'Unassigned'), ...period.map(c => D.dept(c))])].sort();
  table(ws7, ['Department', 'Open requisitions', 'Open vacancies', 'Applications', 'Interviews', 'Offers', 'Joined in period', 'Avg days to join', 'Avg CV score'],
    depts.map(dp => { const rs = reqs.filter(r => (r.department || 'Unassigned') === dp), cs = cands.filter(c => D.dept(c) === dp), ps = period.filter(c => D.dept(c) === dp);
      return [dp, rs.filter(isOpen).length, rs.filter(isOpen).reduce((s, r) => s + Math.max(0, positions(r) - filled(r)), 0), ps.length, cs.flatMap(c => c._interviews).filter(i => d10(i.scheduled_date) >= from && d10(i.scheduled_date) <= to).length,
        cs.filter(c => c.offer_letter_date && d10(c.offer_letter_date) >= from && d10(c.offer_letter_date) <= to).length, joinedP.filter(c => D.dept(c) === dp).length,
        avg(cs.filter(c => c.status === 'joined').map(c => gap(c._applied, c.joining_date || c.joined_date))) ?? '', avg(ps.filter(c => c._score != null).map(c => Number(c._score))) ?? ''];
    }), [26, 16, 14, 14, 12, 10, 16, 16, 14]);

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `Recruitment_MIS_${from}_to_${to}${D.department ? '_' + D.department.replace(/\W+/g, '_') : ''}.xlsx`, counts: { applications: period.length, requisitions: reqs.length, interviews: intAll.length, offers: offered.length, joined: joinedP.length } };
}
