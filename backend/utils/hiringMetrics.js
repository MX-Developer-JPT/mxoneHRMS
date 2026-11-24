// Recruitment lifecycle analytics — timestamp driven. For every requisition: the 14 milestone dates, the turnaround metrics
// (calendar days, and business days as a second figure), the funnel, recruiter productivity and manager / interview delays.
import { all } from '../db.js';
import * as LC from './hiringLifecycle.js';

const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const IST = 5.5 * 3600000;
export const istDay = (v) => { if (!v) return ''; const t = Date.parse(String(v).length === 16 ? `${v}:00+05:30` : String(v)); if (!Number.isFinite(t)) return String(v).slice(0, 10); return new Date(t + IST).toISOString().slice(0, 10); };
const first = (arr) => arr.filter(Boolean).sort()[0] || '';
const last = (arr) => arr.filter(Boolean).sort().slice(-1)[0] || '';
const avg = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };
const median = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const reqKey = (c) => c.requisition_id || c.job_requisition_id || c.job_id || '';

const tlTo = (c, to) => (c.timeline || []).find((e) => e.type === 'status' && e.to === to)?.at || '';
const maxRank = (c) => {
  let m = LC.STATUSES[c.status || 'applied']?.rank ?? 0;
  for (const e of c.timeline || []) if (e.type === 'status') m = Math.max(m, LC.STATUSES[e.to]?.rank ?? -1);
  return m;
};

export async function loadHiringData() {
  const ld = async (type) => (await all("SELECT id, data, created_at FROM entities WHERE type=$1", [type])).map((r) => ({ ...jparse(r.data), id: r.id, _created: r.created_at })).filter((x) => x && x.id);
  const [reqs, cands, batches, interviews, emps, depts, holidays, cfgRows] = await Promise.all([ld('JobRequisition'), ld('Candidate'), ld('CvReviewBatch'), ld('Interview'), ld('Employee'), ld('Department'), ld('Holiday'), ld('RecruitmentConfig')]);
  const cfg = cfgRows[0] || {};
  return { reqs, cands, batches, interviews, emps, depts, holidays: holidays.map((h) => String(h.date || '').slice(0, 10)).filter(Boolean), weeklyOff: Array.isArray(cfg.weekly_off) ? cfg.weekly_off : [0], useHolidays: cfg.use_holidays !== false, reminderDays: Number(cfg.review_reminder_days) || 2 };
}

export function computeHiringMis(D, f = {}) {
  const empName = (uid) => { const e = D.emps.find((x) => x.user_id === uid); return e?.display_name || e?.full_name || ''; };
  const deptHead = (name) => D.depts.find((d) => d.name === name)?.head_user_id || '';
  const bd = (a, b) => (a && b ? LC.businessDays(a, b, { weeklyOff: D.weeklyOff, holidays: D.useHolidays ? D.holidays : [] }) : null);
  const cd = (a, b) => (a && b ? LC.calendarDays(a, b) : null);
  const both = (a, b) => ({ cal: cd(a, b), biz: bd(a, b) });

  // ── scope ──
  const from = f.from || '', to = f.to || '';
  let reqs = D.reqs.filter((r) => r.status !== 'draft' || r.mrf_version !== 2);
  const mrfStatus = (r) => (r.status === 'closed' && r.closed_reason === 'filled' ? 'filled' : r.status);
  if (f.department && f.department !== 'all') reqs = reqs.filter((r) => r.department === f.department);
  if (f.designation && f.designation !== 'all') reqs = reqs.filter((r) => (r.designation || r.position_title) === f.designation);
  if (f.hiring_manager_id) reqs = reqs.filter((r) => r.hiring_manager_id === f.hiring_manager_id);
  if (f.hod_id) reqs = reqs.filter((r) => deptHead(r.department) === f.hod_id);
  if (f.requisition_id) reqs = reqs.filter((r) => r.id === f.requisition_id);
  if (f.mrf_status && f.mrf_status !== 'all') reqs = reqs.filter((r) => mrfStatus(r) === f.mrf_status);
  if (from) reqs = reqs.filter((r) => istDay(r.created_at || r._created) >= from);
  if (to) reqs = reqs.filter((r) => istDay(r.created_at || r._created) <= to);
  const reqIds = new Set(reqs.map((r) => r.id));
  const inReq = (c) => reqIds.has(reqKey(c));
  let cands = D.cands.filter(inReq);
  if (f.source && f.source !== 'all') cands = cands.filter((c) => (c.source || 'walk_in') === f.source);
  const candById = new Map(cands.map((c) => [c.id, c]));
  let batches = D.batches.filter((b) => reqIds.has(b.requisition_id));
  if (f.recruiter_id) batches = batches.filter((b) => b.created_by === f.recruiter_id);
  const ivs = D.interviews.filter((i) => candById.has(i.candidate_id) && (!f.recruiter_id || i.created_by === f.recruiter_id));
  if (f.recruiter_id) { const ok = new Set([...batches.flatMap((b) => (b.candidates || []).map((x) => x.candidate_id)), ...ivs.map((i) => i.candidate_id)]); cands = cands.filter((c) => ok.has(c.id)); }

  // ── per-MRF timeline & metrics ──
  const mrfs = reqs.map((r) => {
    const cs = cands.filter((c) => reqKey(c) === r.id);
    const bs = batches.filter((b) => b.requisition_id === r.id);
    const is = ivs.filter((i) => cs.some((c) => c.id === i.candidate_id));
    const decisions = bs.flatMap((b) => (b.candidates || []).flatMap((x) => Object.values(x.decisions || {}).map((d) => d.at)));
    const sentAts = bs.map((b) => b.sent_at);
    const T = {
      created: istDay(r.created_at || r._created),
      approved: istDay(r.hm_approved_at || r.hr_approved_date || r.manager_approved_date || r.approved_date || ''),
      published: istDay(r.published_date),
      first_application: first(cs.map((c) => istDay(c.applied_date || c.created_at || c._created))),
      first_screening: first(cs.map((c) => istDay(tlTo(c, 'screening') || tlTo(c, 'shortlisted')))),
      first_cv_sent: first(sentAts.map(istDay)),
      last_cv_sent: last(sentAts.map(istDay)),
      first_manager_response: first(decisions.map(istDay)),
      first_interview_scheduled: first(is.map((i) => istDay(i.created_at_iso || i._created))),
      first_interview_conducted: first(is.map((i) => istDay((i.feedbacks || [])[0]?.submitted_at || i.completed_at || ''))),
      selection: first(cs.map((c) => istDay(tlTo(c, 'selected') || c.selected_at || ''))),
      offer_release: first(cs.map((c) => istDay(c.offer_letter_date || tlTo(c, 'offered') || ''))),
      joining: first(cs.filter((c) => c.status === 'joined').map((c) => istDay(tlTo(c, 'joined') || c.joining_date || c.joined_date || ''))),
      closure: istDay(r.closed_at || r.closed_date || ''),
    };
    const m = {
      mrf_approval_tat: both(T.created, T.approved), time_to_first_cv: both(T.created, T.first_cv_sent), time_to_first_shortlist: both(T.approved, T.first_cv_sent),
      manager_response_tat: both(T.first_cv_sent, T.first_manager_response), interview_scheduling_tat: both(T.first_cv_sent, T.first_interview_scheduled),
      interview_completion_tat: both(T.first_cv_sent, T.first_interview_conducted), selection_tat: both(T.created, T.selection), offer_tat: both(T.selection, T.offer_release), time_to_fill: both(T.created, T.joining),
    };
    const unique = new Set(bs.flatMap((b) => (b.candidates || []).map((x) => x.candidate_id)));
    return {
      id: r.id, title: r.designation || r.position_title || '', department: r.department || '', hiring_manager_id: r.hiring_manager_id || '', hiring_manager: empName(r.hiring_manager_id), hod: empName(deptHead(r.department)),
      status: mrfStatus(r), positions: Number(r.number_of_positions) || 1, filled: Number(r.positions_filled) || cs.filter((c) => c.status === 'joined').length, timeline: T, metrics: m,
      counts: { applications: cs.length, cvs_sent: unique.size, batches: bs.length, interviews: is.length, offers: cs.filter((c) => c.offer_letter_date || maxRank(c) >= 9).length, joined: cs.filter((c) => c.status === 'joined').length },
    };
  }).sort((a, b) => b.timeline.created.localeCompare(a.timeline.created));

  // ── funnel (candidates in scope) ──
  const hasIv = (c) => ivs.some((i) => i.candidate_id === c.id);
  const done = (c) => ivs.some((i) => i.candidate_id === c.id && i.status === 'completed');
  const stages = [
    ['Applications received', () => true], ['CVs screened', (c) => maxRank(c) >= 1], ['Shortlisted by HR', (c) => maxRank(c) >= 2],
    ['Sent to Hiring Manager / HOD', (c) => maxRank(c) >= 3 || batches.some((b) => (b.candidates || []).some((x) => x.candidate_id === c.id))], ['Approved for interview', (c) => maxRank(c) >= 4 || hasIv(c)],
    ['Interviews scheduled', (c) => maxRank(c) >= 5 || hasIv(c)], ['Interviews completed', (c) => maxRank(c) >= 6 || done(c)], ['Selected', (c) => maxRank(c) >= 7],
    ['Offers released', (c) => maxRank(c) >= 9 || !!c.offer_letter_date], ['Joined', (c) => maxRank(c) >= 11 || c.status === 'joined'],
  ];
  let prev = null;
  const funnel = stages.map(([label, fn]) => { const n = cands.filter(fn).length; const row = { stage: label, count: n, of_total: pct(n, cands.length), from_previous: prev === null ? 100 : pct(n, prev) }; prev = n; return row; });

  // ── people & departments ──
  const recruiters = {};
  const rec = (uid, name) => (recruiters[uid] ||= { user_id: uid, name: name || empName(uid), screened: 0, cvs_submitted: 0, batches: 0, interviews_coordinated: 0, hired: 0 });
  for (const c of cands) {
    const firstAct = (c.timeline || []).find((e) => e.type === 'status' && e.by && ['applied', 'screening'].includes(e.from || 'applied'));
    if (firstAct?.by) rec(firstAct.by, firstAct.by_name).screened++;
  }
  for (const b of batches) { const r = rec(b.created_by, b.created_by_name); r.batches++; r.cvs_submitted += new Set((b.candidates || []).map((x) => x.candidate_id)).size; }
  for (const i of ivs) rec(i.created_by, i.created_by_name).interviews_coordinated++;
  for (const c of cands.filter((x) => x.status === 'joined')) { const b = batches.find((x) => (x.candidates || []).some((y) => y.candidate_id === c.id)); if (b) rec(b.created_by, b.created_by_name).hired++; }

  const deptMap = {};
  for (const m of mrfs) {
    const d = (deptMap[m.department || 'Unassigned'] ||= { department: m.department || 'Unassigned', mrfs: 0, open: 0, applications: 0, cvs_sent: 0, interviews: 0, offers: 0, joined: 0, ttf: [], mgr: [], first_cv: [] });
    d.mrfs++; if (!['closed', 'filled', 'cancelled', 'rejected'].includes(m.status)) d.open++;
    d.applications += m.counts.applications; d.cvs_sent += m.counts.cvs_sent; d.interviews += m.counts.interviews; d.offers += m.counts.offers; d.joined += m.counts.joined;
    d.ttf.push(m.metrics.time_to_fill.cal); d.mgr.push(m.metrics.manager_response_tat.cal); d.first_cv.push(m.metrics.time_to_first_cv.cal);
  }
  const departments = Object.values(deptMap).map(({ ttf, mgr, first_cv, ...d }) => ({ ...d, avg_time_to_fill: avg(ttf), avg_manager_response: avg(mgr), avg_time_to_first_cv: avg(first_cv) })).sort((a, b) => b.mrfs - a.mrfs);

  // ── delays: waiting on managers, waiting on interview feedback ──
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const pendingReviews = [];
  for (const b of batches) for (const x of b.candidates || []) {
    const c = candById.get(x.candidate_id); if (!c || c.status !== 'cv_sent') continue;
    for (const rcp of b.recipients || []) if (!x.decisions?.[rcp.role] && rcp.sent_at) pendingReviews.push({ batch_id: b.id, requisition_id: b.requisition_id, position: b.position, department: b.department, candidate: x.name, reviewer: rcp.name, role: rcp.role, sent: istDay(rcp.sent_at), days_waiting: cd(istDay(rcp.sent_at), today), overdue: (cd(istDay(rcp.sent_at), today) || 0) >= D.reminderDays });
  }
  const nowT = Date.now();
  const pendingFeedback = ivs.filter((i) => i.status === 'scheduled' && Date.parse(`${String(i.scheduled_date).slice(0, 16)}:00+05:30`) + (Number(i.duration_minutes) || 30) * 60000 < nowT)
    .map((i) => ({ interview_id: i.id, candidate: candById.get(i.candidate_id) ? (candById.get(i.candidate_id).full_name || '') : '', requisition_id: i.requisition_id, round: i.round_name, date: String(i.scheduled_date).slice(0, 10), interviewers: (i.interviewer_ids || []).map(empName).join(', '), days_overdue: cd(String(i.scheduled_date).slice(0, 10), today) }));

  const kpis = {
    mrfs: mrfs.length, open_mrfs: mrfs.filter((m) => !['closed', 'filled', 'cancelled', 'rejected'].includes(m.status)).length, applications: cands.length, cvs_sent: new Set(batches.flatMap((b) => (b.candidates || []).map((x) => x.candidate_id))).size, review_batches: batches.length,
    interviews: ivs.length, selected: cands.filter((c) => maxRank(c) >= 7).length, offers: funnel[8].count, joined: funnel[9].count,
    pending_reviews: pendingReviews.length, overdue_reviews: pendingReviews.filter((p) => p.overdue).length, pending_feedback: pendingFeedback.length,
  };
  const keys = Object.keys(mrfs[0]?.metrics || { mrf_approval_tat: 1, time_to_first_cv: 1, time_to_first_shortlist: 1, manager_response_tat: 1, interview_scheduling_tat: 1, interview_completion_tat: 1, selection_tat: 1, offer_tat: 1, time_to_fill: 1 });
  const metrics = {}; for (const k of keys) metrics[k] = { avg_cal: avg(mrfs.map((m) => m.metrics[k].cal)), median_cal: median(mrfs.map((m) => m.metrics[k].cal)), avg_biz: avg(mrfs.map((m) => m.metrics[k].biz)), samples: mrfs.filter((m) => m.metrics[k].cal != null).length };
  const sources = {}; for (const c of cands) { const s = c.source || 'walk_in'; (sources[s] ||= { source: s, applied: 0, shortlisted: 0, interviewed: 0, offered: 0, joined: 0 }); const o = sources[s]; o.applied++; if (maxRank(c) >= 2) o.shortlisted++; if (maxRank(c) >= 6) o.interviewed++; if (maxRank(c) >= 9) o.offered++; if (c.status === 'joined') o.joined++; }
  return { kpis, metrics, funnel, mrfs, departments, recruiters: Object.values(recruiters).sort((a, b) => b.cvs_submitted - a.cvs_submitted), sources: Object.values(sources).sort((a, b) => b.applied - a.applied), pending_reviews: pendingReviews.sort((a, b) => (b.days_waiting || 0) - (a.days_waiting || 0)), pending_feedback: pendingFeedback, generated: today };
}

export const METRIC_LABELS = {
  mrf_approval_tat: ['MRF Approval TAT', 'Approval date − MRF creation date'], time_to_first_cv: ['Time to First CV', 'First CV sent − MRF creation'], time_to_first_shortlist: ['Time to First Shortlist', 'First CV sent − MRF approval'],
  manager_response_tat: ['Manager Response TAT', 'First manager response − first CV sent'], interview_scheduling_tat: ['Interview Scheduling TAT', 'First interview scheduled − first CV sent'],
  interview_completion_tat: ['Interview Completion TAT', 'First interview conducted − first CV sent'], selection_tat: ['Selection TAT', 'Selection date − MRF creation'], offer_tat: ['Offer TAT', 'Offer release − selection date'], time_to_fill: ['Time to Fill', 'Joining date − MRF creation'],
};
