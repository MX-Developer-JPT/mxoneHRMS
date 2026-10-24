// Intelligent MIS — one calculation engine used by the dashboard, the registers and the Excel/PDF exports,
// so a number can never differ between screen and file. Every metric is derived from live records; where the
// application does not store what a metric needs (department transfers, sanctioned positions, historical
// vacancy states ...) the metric is returned as unavailable with the reason — never as a silent zero.
// db.js connects on import, so it is loaded on first query — the calculation functions stay testable without a database.
const all = async (sql, params) => (await import('../../db.js')).all(sql, params);
import { istDate, addDays, diffDays, dow, DAY_NAMES, eachDay, fmtD, resolvePeriod, resolveCompare, applyElapsed, change } from './calendar.js';

export const DEFAULT_CFG = {
  absentRepeat: 3,            // unexplained absences in a 30-day equivalent
  lateRepeat: 5,              // late arrivals in a 30-day equivalent
  regularisationRepeat: 3,    // regularisation requests in a 30-day equivalent
  regLateDays: 7,             // request counted "late" when raised more than N days after the attendance date
  regApprovalSlaDays: 3,      // pending longer than this breaches the approval SLA
  noLeaveWindows: [30, 60, 90, 180],
  shortLeaveRepeat: 3,        // single-day leaves in a 30-day equivalent
  adjacentLeaveRepeat: 3,     // leaves hugging a weekly off / holiday within 90 days
  leavePendingDays: 7,
  shortNoticeDays: 1,
  leaveSpikePct: 50,
  vacancyAgeDays: 45,
  reqStaleDays: 30,
  gpFrequent: 8,              // gate passes per employee in a 30-day equivalent
  gpAutoClosedRepeat: 3,
  gpUnofficialMaxHours: 4,
  hoursLow: 3, hoursHigh: 14, // implausible recorded working hours (per day)
  complianceDropPp: 5,        // department compliance fall (percentage points) worth flagging
  missingDateShare: 0.05,     // share of scheduled employees with no record on one date
  minSample: 30,              // minimum employee-days before comparing rates
  outlierSigma: 2.5,
  visitorOpenHours: 12,
  reimbPendingDays: 14,
};

const PHYS = new Set(['present', 'late', 'short_attendance', 'half_day']);
const ACTIVE_ROLE_FULL = ['hr', 'admin', 'management'];

// ── tiny helpers ──────────────────────────────────────────────────────────
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const pctOf = (a, b) => (b > 0 ? r1((a / b) * 100) : null);
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');
const scaled = (base, days) => Math.max(2, Math.ceil(base * Math.max(days, 1) / 30)); // threshold for periods shorter/longer than 30 days
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
// Threshold = the policy rule, raised to mean+kσ of the population when there are enough people for that to mean something.
const outlierLimit = (values, rule, cfg) => (values.length >= cfg.minSample ? Math.max(rule, mean(values) + cfg.outlierSigma * sd(values)) : rule);
const sevFor = (ratio) => (ratio >= 3 ? 'Critical' : ratio >= 2 ? 'High' : ratio >= 1.5 ? 'Medium' : 'Low');
const SEV_RANK = { Critical: 5, High: 4, Medium: 3, Low: 2, Informational: 1 };
const ts = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };

function parseRows(rows) {
  const out = [];
  for (const r of rows) {
    try { const d = JSON.parse(r.data); if (!d.id) d.id = r.id; d._createdAt = r.created_at ? new Date(r.created_at).toISOString() : ''; d._created = d._createdAt.slice(0, 10); out.push(d); } catch { /* skip corrupt row */ }
  }
  return out;
}
export const loadType = async (type) => parseRows(await all('SELECT id, data, created_at FROM entities WHERE type=$1', [type]));
export const normDept = (d) => { const t = String(d || '').trim(); return !t || t.toLowerCase() === 'unassigned' ? 'Unassigned' : t; };

// ── data loading ──────────────────────────────────────────────────────────
async function loadAttendance(from, to) {
  // Only the columns the MIS needs; the inner OFFSET 0 keeps Postgres from re-parsing each JSON document per column.
  const rows = await all(`SELECT d->>'user_id' u, d->>'date' d, d->>'status' s, d->>'check_in_time' ci, d->>'check_out_time' co,
      d->>'total_working_minutes' tm, d->>'working_hours' wh, d->>'late_arrival' la, d->>'leave_id' lid, d->>'leave_half_day' lhd,
      d->>'punch_count' pc, d->>'check_in_source' cis, d->>'is_in_progress' ip
    FROM (SELECT data::jsonb AS d FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2 OFFSET 0) t`, [from, to]);
  const map = new Map();
  const dupes = [];
  for (const r of rows) {
    if (!r.u || !r.d) continue;
    const k = `${r.u}|${r.d}`;
    if (map.has(k)) dupes.push(k);
    map.set(k, { s: r.s || '', ci: r.ci, co: r.co, mins: num(r.tm) || Math.round(num(r.wh) * 60), la: r.la === 'true', lid: r.lid, lhd: r.lhd === 'true', pc: num(r.pc), src: r.cis, ip: r.ip === 'true' });
  }
  return { map, dupes };
}

export async function loadContext({ cfg, rangeFrom, rangeTo, attFrom }) {
  const [employees, depts, shifts, holidays, leaves, policies, balances, regs, gps, visitors, reqs, cands, interviews, reimbs, exits, insightState, att] = await Promise.all([
    loadType('Employee'), loadType('Department'), loadType('Shift'), loadType('Holiday'), loadType('Leave'), loadType('LeavePolicy'), loadType('LeaveBalance'),
    loadType('AttendanceRegularisation'), loadType('GatePass'), loadType('Visitor'), loadType('JobRequisition'), loadType('Candidate'), loadType('Interview'),
    loadType('Reimbursement'), loadType('Exit'), loadType('MisInsightState'), loadAttendance(attFrom, rangeTo),
  ]);
  const [transfers, snapshots] = await Promise.all([loadType('DeptTransfer'), loadType('HeadcountSnapshot')]);
  return { cfg, rangeFrom, rangeTo, attFrom, employees, depts, shifts, holidays, leaves, policies, balances, regs, gps, visitors, reqs, cands, interviews, reimbs, exits, insightState, att, transfers, snapshots };
}

// ── employee model ────────────────────────────────────────────────────────
function buildModel(ctx) {
  const shiftsById = {}; let defaultShift = null;
  for (const s of ctx.shifts) { shiftsById[s.id] = s; if (s.is_default) defaultShift = s; }
  const exitByUser = {};
  for (const x of ctx.exits) if (x.user_id && !['rejected', 'cancelled', 'withdrawn'].includes(x.status)) exitByUser[x.user_id] = x;
  const emps = [], byUid = {};
  const tfBy = {};
  for (const t of ctx.transfers || []) if (t.user_id && t.effective_date) (tfBy[t.user_id] ||= []).push({ at: dayOf(t.effective_date), from: normDept(t.from_department), to: normDept(t.to_department) });
  for (const k of Object.keys(tfBy)) tfBy[k].sort((a, b) => a.at.localeCompare(b.at));
  for (const e of ctx.employees) {
    const uid = e.user_id || e.id;
    const x = exitByUser[e.user_id];
    const separated = ['resigned', 'retired', 'terminated', 'inactive', 'absconded'].includes(String(e.status || '').toLowerCase()) || e.is_active === false;
    // last working day: the explicit exit date, else the approved exit record, else the day the exit was marked.
    let lwd = dayOf(e.last_working_date || e.exit_date) || (separated && x ? dayOf(x.last_working_date) : '') || (separated ? dayOf(e.exit_marked_at) : '');
    if (!separated && x && x.status === 'completed') lwd = dayOf(x.last_working_date);
    const shift = (e.shift_id && shiftsById[e.shift_id]) || defaultShift;
    const deptRaw = String(e.department || '').trim();
    const hasDept = !!deptRaw && deptRaw.toLowerCase() !== 'unassigned';
    const emp = {
      uid, id: e.id, code: e.employee_code || '', name: e.display_name || e.full_name || '', dept: hasDept ? deptRaw : 'Unassigned',
      designation: e.designation || '', loc: e.work_location || '', mgr: e.reporting_manager_id || '', empType: e.employment_type || '', empStatus: e.employee_status || '',
      doj: dayOf(e.date_of_joining), lwd: lwd || '', separated, exempt: !!e.is_attendance_exempt,
      transfers: tfBy[uid] || (e.user_id ? tfBy[e.user_id] : null) || [], workDays: new Set(Array.isArray(shift?.days) && shift.days.length ? shift.days : DAY_NAMES.filter(n => n !== 'Sunday')),
      shiftName: shift?.name || 'Default', hasDept, noStatus: !e.status && !e.employee_status, raw: e,
    };
    emps.push(emp); byUid[uid] = emp;
  }
  const holidayList = ctx.holidays.filter(h => h.date).map(h => ({ date: dayOf(h.date), depts: Array.isArray(h.applicable_departments) ? h.applicable_departments : [], name: h.name, half: !!h.is_half_day, off: h.is_working_day !== true }));
  const holByDate = {}; for (const h of holidayList) (holByDate[h.date] ||= []).push(h);
  const isHoliday = (dept, d) => (holByDate[d] || []).some(h => h.off && !h.half && (!h.depts.length || h.depts.includes(dept)));
  // "separated" without any usable date cannot be placed in time — flagged in data quality, kept out of headcount.
  const activeOn = (e, d) => !!e.doj && e.doj <= d && (e.separated ? !!e.lwd && e.lwd >= d : (!e.lwd || e.lwd >= d));
  // department on a given date: walk the transfer history back from the current department
  const deptAt = (e, d) => { const t = (e.transfers || []).find(x => x.at > d); return t ? t.from : e.dept; };
  const scheduled = (e, d) => !e.exempt && !!e.doj && e.doj <= d && (!e.lwd || e.lwd >= d) && e.workDays.has(DAY_NAMES[dow(d)]) && !isHoliday(e.dept, d);
  return { emps, byUid, isHoliday, activeOn, scheduled, deptAt, holidayList, defaultShift, shiftsById };
}

function makeScope(model, filters, restrictUids) {
  const f = filters || {};
  const ok = (e) => {
    if (!e) return false;
    if (restrictUids && !restrictUids.has(e.uid)) return false;
    if (f.department && f.department !== 'all' && e.dept !== f.department) return false;
    if (f.location && f.location !== 'all' && e.loc !== f.location) return false;
    if (f.manager && f.manager !== 'all' && e.mgr !== f.manager) return false;
    if (f.employment_status && f.employment_status !== 'all' && e.empStatus !== f.employment_status) return false;
    if (f.category && f.category !== 'all' && e.empType !== f.category) return false;
    if (f.designation && f.designation !== 'all' && e.designation !== f.designation) return false;
    return true;
  };
  const anyFilter = !!restrictUids || ['department', 'location', 'manager', 'employment_status', 'category', 'designation'].some(k => f[k] && f[k] !== 'all');
  return { ok, anyFilter, scopeEmps: model.emps.filter(ok) };
}

// ── attendance engine ─────────────────────────────────────────────────────
const newAcc = () => ({ sched: 0, present: 0, late: 0, short: 0, half: 0, wfh: 0, od: 0, leave: 0, absent: 0, missing: 0, pending: 0, incomplete: 0, lateArrivals: 0, offdayWork: 0, hoursMins: 0, hoursDays: 0, lowHours: 0, highHours: 0, biometricGap: 0 });

function approvedLeaveCover(ctx) {
  const cover = new Map(); // uid -> Map(date -> 1 | 0.5)
  for (const l of ctx.leaves) {
    if (l.status !== 'approved' || !l.user_id || !l.start_date) continue;
    const m = cover.get(l.user_id) || new Map(); cover.set(l.user_id, m);
    const from = dayOf(l.start_date), to = dayOf(l.end_date || l.start_date);
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) m.set(d, l.half_day ? 0.5 : 1);
  }
  return cover;
}

function classifyDay(model, e, d, rec, today) {
  if (!model.scheduled(e, d)) return { cat: rec && PHYS.has(rec.s) ? 'offday_work' : 'offday' };
  if (d > today) return { cat: 'future' };
  if (!rec) return { cat: d === today ? 'pending' : 'missing' };
  let s = rec.s;
  if (s === 'week_off' || s === 'holiday') return { cat: 'offday', calendarMismatch: true };
  let incomplete = false;
  if (s === 'in_progress' || rec.ip) {
    if (d === today) return { cat: 'pending' };
    incomplete = true; s = rec.mins > 0 ? 'present' : 'absent'; // a past day left open — same rule the attendance screen uses
  }
  if (PHYS.has(s) && rec.ci && !rec.co && d < today && s !== 'half_day') incomplete = true;
  const cat = s === 'present' ? 'present' : s === 'late' ? 'late' : s === 'short_attendance' ? 'short' : s === 'half_day' ? 'half'
    : s === 'work_from_home' ? 'wfh' : s === 'on_duty' ? 'od' : s === 'leave' ? 'leave' : s === 'absent' ? 'absent' : 'other';
  return { cat, incomplete, lateFlag: s === 'late' || (rec.la && PHYS.has(s)) };
}

function addToAcc(a, c, rec) {
  const cat = c.cat;
  if (cat === 'offday' || cat === 'future') return;
  if (cat === 'offday_work') { a.offdayWork++; return; }
  if (cat === 'pending') { a.pending++; return; }
  a.sched++;
  a[cat] = (a[cat] || 0) + 1;
  if (c.incomplete) a.incomplete++;
  if (c.lateFlag) a.lateArrivals++;
}
const physicalDays = (a) => a.present + a.late + a.short + 0.5 * a.half;
const rates = (a) => ({
  physical: pctOf(physicalDays(a), a.sched),
  compliance: pctOf(a.sched - a.absent - a.missing, a.sched),
});

export function computeAttendance(ctx, model, scope, from, to, today, { detail = false } = {}) {
  const cfg = ctx.cfg, cover = ctx._cover || (ctx._cover = approvedLeaveCover(ctx));
  const days = eachDay(from, to);
  const total = newAcc(), perDept = {}, perDay = {};
  const perEmp = new Map(), conflicts = [], dateMissing = {}, dayRows = [];
  for (const d of days) perDay[d] = { date: d, ...newAcc() };
  for (const e of scope.scopeEmps) {
    if (e.exempt) continue;
    const acc = newAcc();
    const unexplainedAbsent = [], lateDates = [], missingDates = [], incompleteDates = [], lowHoursDates = [], highHoursDates = [];
    const dd = perDept[e.dept] ||= { ...newAcc(), headcount: 0 };
    for (const d of days) {
      const rec = ctx.att.map.get(`${e.uid}|${d}`);
      const c = classifyDay(model, e, d, rec, today);
      if (c.cat === 'offday' || c.cat === 'future') continue;
      addToAcc(acc, c, rec); addToAcc(total, c, rec); addToAcc(dd, c, rec); addToAcc(perDay[d], c, rec);
      if (detail && days.length <= 62) dayRows.push({ uid: e.uid, code: e.code, name: e.name, dept: e.dept, designation: e.designation, date: d, cat: c.cat, label: c.cat === 'offday_work' ? 'Worked on off-day' : label(c.cat === 'short' ? 'short_attendance' : c.cat === 'half' ? 'half_day' : c.cat === 'wfh' ? 'work_from_home' : c.cat === 'od' ? 'on_duty' : c.cat), in: rec?.ci || '', out: rec?.co || '', hours: rec && rec.mins ? r1(rec.mins / 60) : '', late: !!c.lateFlag });
      if (c.cat === 'offday_work' || c.cat === 'pending') continue;
      if (c.cat === 'missing') { missingDates.push(d); dateMissing[d] = (dateMissing[d] || 0) + 1; }
      if (c.incomplete) incompleteDates.push(d);
      if (c.lateFlag) lateDates.push(d);
      const lv = cover.get(e.uid)?.get(d);
      if (c.cat === 'absent' && !lv) unexplainedAbsent.push(d);
      if (rec && PHYS.has(rec.s) && rec.ci && rec.co && c.cat !== 'half') {
        const h = rec.mins / 60;
        acc.hoursMins += rec.mins; acc.hoursDays++; total.hoursMins += rec.mins; total.hoursDays++; dd.hoursMins += rec.mins; dd.hoursDays++;
        if (h > 0 && h < cfg.hoursLow) { acc.lowHours++; total.lowHours++; lowHoursDates.push(d); }
        if (h > cfg.hoursHigh) { acc.highHours++; total.highHours++; highHoursDates.push(d); }
      }
      if (c.cat === 'absent' && rec && rec.pc > 0) { acc.biometricGap++; total.biometricGap++; }
      if (detail) {
        if (c.cat === 'absent' && lv === 1) conflicts.push({ e, date: d, kind: 'Absent although leave is approved', att: 'Absent', other: 'Approved leave' });
        else if (['present', 'late', 'short'].includes(c.cat) && lv === 1) conflicts.push({ e, date: d, kind: 'Present although full-day leave is approved', att: label(rec.s), other: 'Approved leave' });
        else if (c.cat === 'leave' && !lv) conflicts.push({ e, date: d, kind: 'Marked leave without an approved leave request', att: 'Leave', other: 'No approved leave' });
      }
    }
    dd.headcount++;
    perEmp.set(e.uid, { e, acc, unexplainedAbsent, lateDates, missingDates, incompleteDates, lowHoursDates, highHoursDates });
  }
  for (const k of Object.keys(perDept)) perDept[k].rates = rates(perDept[k]);
  return { dayRows, total: { ...total, rates: rates(total) }, perDept, perDay: days.map(d => ({ ...perDay[d], rates: rates(perDay[d]), holiday: model.isHoliday('', d) })), perEmp, conflicts, dateMissing, days };
}

// ── regularisation ────────────────────────────────────────────────────────
function submittedAt(r) { return r.audit_log?.[0]?.timestamp || r._createdAt; }
function approverOf(r) {
  const a = (r.audit_log || []).filter(x => /approv/i.test(x.action || '')).pop();
  return a ? { name: a.actor_name || '', at: a.timestamp } : { name: '', at: r.hr_approved_at || r.manager_approved_at || '' };
}

export function computeRegularisation(ctx, model, scope, from, to, today, { detail = false } = {}) {
  const cfg = ctx.cfg, days = diffDays(from, to) + 1;
  const inScope = (r) => scope.ok(model.byUid[r.user_id]);
  const submitted = ctx.regs.filter(r => inScope(r) && dayOf(submittedAt(r)) >= from && dayOf(submittedAt(r)) <= to);
  const counts = { total: submitted.length, pending: 0, awaitingHr: 0, approved: 0, rejected: 0, cancelled: 0, late: 0, afterCutoff: 0 };
  const approvalHours = [];
  const rows = [];
  const perDept = {}, perEmp = {};
  for (const r of submitted) {
    const e = model.byUid[r.user_id];
    const st = r.status;
    if (st === 'pending') counts.pending++; else if (st === 'manager_approved') counts.awaitingHr++; else if (st === 'completed') counts.approved++; else if (st === 'rejected') counts.rejected++; else if (st === 'cancelled') counts.cancelled++;
    const sub = submittedAt(r), lateBy = diffDays(dayOf(r.attendance_date), dayOf(sub));
    const isLate = lateBy > cfg.regLateDays;
    if (isLate) counts.late++;
    const fin = st === 'completed' ? (r.hr_approved_at || r.manager_approved_at) : null;
    if (fin && ts(sub) != null) approvalHours.push((ts(fin) - ts(sub)) / 3600000);
    const ad = dayOf(r.attendance_date);
    const monthEnd = ad ? `${ad.slice(0, 7)}-31` : '';
    const afterCut = !!fin && !!monthEnd && dayOf(fin) > monthEnd;
    if (afterCut) counts.afterCutoff++;
    const dept = e?.dept || 'Unassigned';
    perDept[dept] = (perDept[dept] || 0) + 1;
    perEmp[r.user_id] = (perEmp[r.user_id] || 0) + 1;
    if (detail) rows.push({ id: r.id, code: e?.code || '', name: e?.name || '', dept, date: ad, original: label(r.existing_status), revised: st === 'completed' ? 'Updated as requested' : label(r.reason_category), requestedIn: r.requested_check_in || '', requestedOut: r.requested_check_out || '', reason: r.reason || '', category: label(r.reason_category), status: label(st), approver: approverOf(r).name, approvedAt: fin || '', submittedAt: sub, lateBy, afterCutoff: afterCut });
  }
  counts.avgApprovalHours = approvalHours.length ? r1(mean(approvalHours)) : null;
  // backlog: everything still waiting now (a snapshot of today, not of the period)
  const backlog = ctx.regs.filter(r => inScope(r) && (r.status === 'pending' || r.status === 'manager_approved'));
  const byMgr = {};
  for (const r of backlog) {
    const age = diffDays(dayOf(submittedAt(r)), today);
    const k = r.status === 'pending' ? (r.manager_id || 'unknown') : 'HR';
    (byMgr[k] ||= { id: k, pending: 0, overSla: 0, oldest: 0 });
    byMgr[k].pending++; if (age > cfg.regApprovalSlaDays) byMgr[k].overSla++; byMgr[k].oldest = Math.max(byMgr[k].oldest, age);
  }
  const mgrRows = Object.values(byMgr).map(m => ({ ...m, name: m.id === 'HR' ? 'HR (second-level approval)' : (model.byUid[m.id]?.name || 'Unknown manager') })).sort((a, b) => b.pending - a.pending);
  const backlogOverSla = backlog.filter(r => diffDays(dayOf(submittedAt(r)), today) > cfg.regApprovalSlaDays);
  return { counts, backlogCount: backlog.length, backlogOverSla: backlogOverSla.length, perDept, perEmp, rows, managers: mgrRows, backlog, days };
}

// ── leave ─────────────────────────────────────────────────────────────────
export function computeLeave(ctx, model, scope, from, to, today, { detail = false } = {}) {
  const cfg = ctx.cfg, days = diffDays(from, to) + 1;
  const polName = {}; for (const p of ctx.policies) polName[p.id] = p.name || p.code || 'Leave';
  const inScope = (l) => scope.ok(model.byUid[l.user_id]);
  const appliedDay = (l) => dayOf(l.applied_on || l._createdAt);
  const submitted = ctx.leaves.filter(l => inScope(l) && appliedDay(l) >= from && appliedDay(l) <= to);
  const counts = { requests: submitted.length, approved: 0, pending: 0, rejected: 0, cancelled: 0, daysRequested: 0, shortNotice: 0 };
  for (const l of submitted) {
    counts[l.status] = (counts[l.status] || 0) + 1;
    counts.daysRequested += num(l.total_days);
    if (diffDays(appliedDay(l), dayOf(l.start_date)) < cfg.shortNoticeDays) counts.shortNotice++;
  }
  // approved leave DAYS falling inside the period (a request can start before / end after it) on scheduled days
  const byType = {}, byDept = {}, perEmpDays = {};
  let approvedDays = 0;
  for (const l of ctx.leaves) {
    if (l.status !== 'approved' || !inScope(l) || !l.start_date) continue;
    const e = model.byUid[l.user_id];
    const a = dayOf(l.start_date), b = dayOf(l.end_date || l.start_date);
    if (b < from || a > to) continue;
    let dcount = 0;
    for (let d = a < from ? from : a; d <= b && d <= to; d = addDays(d, 1)) if (e && model.scheduled(e, d)) dcount += l.half_day ? 0.5 : 1;
    if (!dcount) continue;
    approvedDays += dcount;
    const t = polName[l.leave_policy_id] || 'Other';
    byType[t] = (byType[t] || 0) + dcount;
    const dp = e?.dept || 'Unassigned'; byDept[dp] = (byDept[dp] || 0) + dcount;
    perEmpDays[l.user_id] = (perEmpDays[l.user_id] || 0) + dcount;
  }
  counts.approvedDays = r1(approvedDays);
  counts.daysRequested = r1(counts.daysRequested);
  const approvedReqs = submitted.filter(l => l.status === 'approved');
  counts.avgDuration = approvedReqs.length ? r2(mean(approvedReqs.map(l => num(l.total_days)))) : null;

  // monthly trend over the 12 months ending at period end (approved leave days on scheduled days)
  const trend = {};
  const t0 = addDays(to.slice(0, 7) + '-01', -335).slice(0, 7) + '-01';
  for (const l of ctx.leaves) {
    if (l.status !== 'approved' || !inScope(l) || !l.start_date) continue;
    const e = model.byUid[l.user_id]; const a = dayOf(l.start_date), b = dayOf(l.end_date || l.start_date);
    if (b < t0 || a > to) continue;
    for (let d = a < t0 ? t0 : a; d <= b && d <= to; d = addDays(d, 1)) if (e && model.scheduled(e, d)) trend[d.slice(0, 7)] = (trend[d.slice(0, 7)] || 0) + (l.half_day ? 0.5 : 1);
  }
  const out = { counts, byType, byDept, trend, perEmpDays, days, polName, submitted };
  if (!detail) return out;

  // balances (as stored — allocation rules differ per policy, so utilisation here is indicative)
  const year = Number(to.slice(0, 4));
  const bal = {};
  for (const b of ctx.balances) {
    if (num(b.year) !== year || !scope.ok(model.byUid[b.user_id])) continue;
    const code = b.leave_policy_code || 'Other';
    const x = (bal[code] ||= { code, employees: 0, allocated: 0, accrued: 0, carried: 0, used: 0 });
    x.employees++; x.allocated += num(b.total_allocated); x.accrued += num(b.accrued_this_year); x.carried += num(b.carried_forward); x.used += num(b.used);
  }
  out.balances = Object.values(bal).map(x => ({ ...x, allocated: r1(x.allocated), accrued: r1(x.accrued), carried: r1(x.carried), used: r1(x.used), utilisation: pctOf(x.used, x.allocated + x.carried) }));
  // pending too long
  out.pendingLong = ctx.leaves.filter(l => l.status === 'pending' && inScope(l) && diffDays(appliedDay(l), today) > cfg.leavePendingDays)
    .map(l => ({ l, e: model.byUid[l.user_id], age: diffDays(appliedDay(l), today) })).sort((a, b) => b.age - a.age);
  // register of requests submitted in the period
  out.rows = submitted.map(l => { const e = model.byUid[l.user_id]; return { code: e?.code || '', name: e?.name || '', dept: e?.dept || 'Unassigned', type: polName[l.leave_policy_id] || 'Other', from: dayOf(l.start_date), to: dayOf(l.end_date || l.start_date), days: num(l.total_days), half: !!l.half_day, status: label(l.status), applied: appliedDay(l), notice: diffDays(appliedDay(l), dayOf(l.start_date)), reason: l.reason || '' }; });
  return out;
}

// ── "Employees with no leave applications" — classified from evidence, never assumed ──
export function computeNoLeave(ctx, model, scope, to, today, att) {
  const cfg = ctx.cfg, effTo = to > today ? today : to;
  const cover = ctx._cover || (ctx._cover = approvedLeaveCover(ctx));
  const appliedBy = new Map(); // uid -> list of applied dates
  for (const l of ctx.leaves) if (l.user_id) { const a = dayOf(l.applied_on || l._createdAt); (appliedBy.get(l.user_id) || appliedBy.set(l.user_id, []).get(l.user_id)).push(a); }
  const regBy = new Map();
  for (const r of ctx.regs) if (r.user_id) { const a = dayOf(submittedAt(r)); (regBy.get(r.user_id) || regBy.set(r.user_id, []).get(r.user_id)).push(a); }
  const result = {};
  for (const w of cfg.noLeaveWindows) {
    const wFrom = addDays(effTo, -(w - 1));
    const rows = [];
    for (const e of scope.scopeEmps) {
      if (!model.activeOn(e, effTo) || e.separated) continue;
      const applied = (appliedBy.get(e.uid) || []).some(a => a >= wFrom && a <= effTo);
      if (applied) continue;
      const ev = { windowDays: w, from: wFrom, to: effTo, scheduled: 0, physical: 0, wfh: 0, od: 0, leaveRecorded: 0, absentUnexplained: 0, missing: 0, regularisations: (regBy.get(e.uid) || []).filter(a => a >= wFrom && a <= effTo).length };
      let obsFrom = e.doj > wFrom ? e.doj : wFrom;
      for (const d of eachDay(obsFrom, effTo)) {
        const rec = ctx.att.map.get(`${e.uid}|${d}`);
        const c = classifyDay(model, e, d, rec, today);
        if (['offday', 'future', 'offday_work', 'pending'].includes(c.cat)) continue;
        ev.scheduled++;
        if (['present', 'late', 'short'].includes(c.cat)) ev.physical++;
        else if (c.cat === 'half') ev.physical += 0.5;
        else if (c.cat === 'wfh') ev.wfh++;
        else if (c.cat === 'od') ev.od++;
        else if (c.cat === 'leave') ev.leaveRecorded++;
        else if (c.cat === 'absent' && !cover.get(e.uid)?.get(d)) ev.absentUnexplained++;
        else if (c.cat === 'missing' || c.incomplete) ev.missing++;
      }
      let cls, why;
      if (e.exempt) { cls = 'Special work arrangement'; why = 'Attendance-exempt employee — attendance evidence is not collected, so leave patterns cannot be interpreted.'; }
      else if (e.doj > wFrom && diffDays(e.doj, effTo) + 1 < Math.min(w, 30)) { cls = 'New joiner (insufficient history)'; why = `Joined ${fmtD(e.doj)} — fewer than ${Math.min(w, 30)} days of observation.`; }
      else if (ev.scheduled === 0) { cls = 'Requires review'; why = 'No scheduled workdays could be evaluated in the window.'; }
      else if (ev.absentUnexplained > 0) { cls = 'Absences without leave applications'; why = `${ev.absentUnexplained} absent day(s) are not covered by any approved leave.`; }
      else if (ev.missing >= Math.max(3, Math.ceil(ev.scheduled * 0.05))) { cls = 'Attendance incomplete'; why = `${ev.missing} scheduled day(s) have no or an incomplete attendance record.`; }
      else if (ev.regularisations >= Math.max(3, Math.ceil(ev.scheduled / 20))) { cls = 'Attendance frequently regularised'; why = `${ev.regularisations} regularisation request(s) in ${ev.scheduled} scheduled days.`; }
      else if (ev.wfh / ev.scheduled >= 0.5) { cls = 'Regularly on approved WFH'; why = `${ev.wfh} of ${ev.scheduled} scheduled days were approved work-from-home.`; }
      else if (ev.od / ev.scheduled >= 0.5) { cls = 'Frequently on approved OD'; why = `${ev.od} of ${ev.scheduled} scheduled days were approved on-duty.`; }
      else if (ev.leaveRecorded > 0) { cls = 'Requires review'; why = `${ev.leaveRecorded} day(s) show as leave in attendance without a leave application in the window.`; }
      else if ((ev.physical + ev.wfh + ev.od) / ev.scheduled >= 0.9) { cls = 'Consistently present'; why = `Recorded presence/WFH/OD on ${r1(ev.physical + ev.wfh + ev.od)} of ${ev.scheduled} scheduled days with no unexplained absence or missing record.`; }
      else { cls = 'Requires review'; why = 'Attendance evidence does not support a specific explanation.'; }
      rows.push({ code: e.code, name: e.name, dept: e.dept, uid: e.uid, class: cls, why, ...ev, physical: r1(ev.physical) });
    }
    const byClass = {}; for (const r of rows) byClass[r.class] = (byClass[r.class] || 0) + 1;
    result[w] = { window: w, from: wFrom, to: effTo, total: rows.length, byClass, rows };
  }
  return result;
}

// ── leave-pattern abnormalities ───────────────────────────────────────────
export function leavePatterns(ctx, model, scope, from, to, today, leaveCur, leavePrev, attCur) {
  const cfg = ctx.cfg, days = diffDays(from, to) + 1, items = [];
  const mk = (type, e, observed, baseline, sev, why, verify, extra = {}) => items.push({ type, code: e?.code || '', name: e?.name || '', dept: e?.dept || '', observed, baseline, sev, why, verify, ...extra });
  const mine = ctx.leaves.filter(l => scope.ok(model.byUid[l.user_id]) && ['approved', 'pending'].includes(l.status) && l.start_date);
  // frequent single-day leave
  const single = {};
  for (const l of mine) { const a = dayOf(l.applied_on || l._createdAt); if (a >= from && a <= to && num(l.total_days) <= 1) single[l.user_id] = (single[l.user_id] || 0) + 1; }
  const lim = scaled(cfg.shortLeaveRepeat, days);
  for (const [u, n] of Object.entries(single)) if (n >= lim) mk('Frequent short-duration leave', model.byUid[u], `${n} one-day leaves`, `${lim} or more in ${days} day(s)`, sevFor(n / lim), 'Several single-day leave requests were raised in the period.', 'Check whether the pattern follows a work or personal arrangement that HR already knows about.');
  // leave next to a weekly off / holiday (last 90 days)
  const w0 = addDays(to, -89), adj = {};
  for (const l of mine) {
    const e = model.byUid[l.user_id]; if (!e || l.status !== 'approved') continue;
    const a = dayOf(l.start_date), b = dayOf(l.end_date || l.start_date);
    if (b < w0 || a > to) continue;
    const before = addDays(a, -1), after = addDays(b, 1);
    const offLike = (d) => !model.scheduled(e, d) && d >= e.doj;
    if (offLike(before) || offLike(after)) adj[l.user_id] = (adj[l.user_id] || 0) + 1;
  }
  for (const [u, n] of Object.entries(adj)) if (n >= cfg.adjacentLeaveRepeat) mk('Leave adjacent to weekly off / holiday', model.byUid[u], `${n} leaves in 90 days`, `${cfg.adjacentLeaveRepeat} or more`, sevFor(n / cfg.adjacentLeaveRepeat), 'Approved leave began right after, or ended right before, a weekly off or holiday.', 'This is common for planned travel; review only if combined with other exceptions.');
  // utilisation spike vs own history (three earlier windows of the same length)
  const hist = {};
  for (let k = 1; k <= 3; k++) {
    const f = addDays(from, -days * k), t = addDays(from, -days * (k - 1) - 1);
    const lv = computeLeave(ctx, model, scope, f, t, today);
    for (const [u, dd] of Object.entries(lv.perEmpDays)) (hist[u] ||= []).push(dd);
  }
  for (const [u, dd] of Object.entries(leaveCur.perEmpDays)) {
    const past = [0, 0, 0]; (hist[u] || []).forEach((x, i) => { past[i] = x; });
    const base = mean(past);
    if (dd >= 3 && dd >= Math.max(2 * base, base + 2)) mk('Leave much higher than own history', model.byUid[u], `${dd} days`, `${r1(base)} avg of previous ${days}-day windows`, sevFor(dd / Math.max(base * 2, 3)), 'Approved leave days exceed twice the employee\'s own recent average.', 'Compare with planned events (festival season, long trip, medical).');
  }
  // department spikes
  const headcount = {}; for (const e of scope.scopeEmps) headcount[e.dept] = (headcount[e.dept] || 0) + 1;
  if (leavePrev) for (const [dp, v] of Object.entries(leaveCur.byDept)) {
    const pv = leavePrev.byDept[dp] || 0, hc = headcount[dp] || 1;
    if (v >= 5 && pv > 0 && ((v - pv) / pv) * 100 >= cfg.leaveSpikePct) mk('Department leave spike', null, `${r1(v)} leave days`, `${r1(pv)} in comparison period`, sevFor(((v - pv) / pv) * 100 / cfg.leaveSpikePct), `Leave days in ${dp} rose ${r1(((v - pv) / pv) * 100)}% (${r1(v / hc)} days per head).`, 'Check for a seasonal pattern or one long leave by a single employee.', { dept: dp });
  }
  // absent days without leave
  for (const [u, p] of attCur.perEmp) {
    const n = p.unexplainedAbsent.length, lim2 = scaled(cfg.absentRepeat, days);
    if (n >= lim2) mk('Absences without leave application', p.e, `${n} day(s)`, `${lim2} or more`, sevFor(n / lim2), 'Marked absent while no approved leave covers those days.', 'Ask the manager whether the absence was informed; apply leave or regularisation if it was.', { dates: p.unexplainedAbsent.slice(0, 10).map(fmtD).join(', ') });
  }
  // pending leave for too long
  return items;
}

// ── workforce / headcount ─────────────────────────────────────────────────
export function computeWorkforce(ctx, model, scope, from, to) {
  const open = addDays(from, -1);
  const rows = {};
  const get = (dp) => (rows[dp] ||= { dept: dp, opening: 0, joinings: 0, exits: 0, transfersIn: 0, transfersOut: 0, closing: 0 });
  const joinList = [], exitList = [], anomalies = [], transferList = [];
  for (const e of scope.scopeEmps) {
    if (!e.doj) continue;
    if (e.lwd && e.lwd < e.doj) { anomalies.push({ e, kind: 'Last working day is before the joining date' }); continue; }
    const activeOpen = model.activeOn(e, open), activeClose = model.activeOn(e, to);
    if (activeOpen) get(model.deptAt(e, open)).opening++;
    if (activeClose) get(model.deptAt(e, to)).closing++;
    if (e.doj >= from && e.doj <= to) { get(model.deptAt(e, e.doj)).joinings++; joinList.push(e); }
    // separation takes effect the day after the last working day
    if (e.lwd && e.lwd >= open && e.lwd < to && (activeOpen || (e.doj >= from && e.doj <= to))) { get(model.deptAt(e, e.lwd)).exits++; exitList.push(e); }
    // moves between departments are not company joinings/exits
    for (const t of e.transfers || []) {
      if (t.at < from || t.at > to || t.at < e.doj || (e.lwd && t.at > e.lwd) || t.from === t.to) continue;
      get(t.from).transfersOut++; get(t.to).transfersIn++; transferList.push({ e, ...t });
    }
  }
  const snapDates = (ctx.snapshots || []).map(x => x.date).concat((ctx.transfers || []).filter(t => t.source !== 'detected').map(t => dayOf(t.recorded_at))).filter(Boolean).sort();
  const trackedSince = snapDates[0] || null;
  const transfers = { available: !!trackedSince && trackedSince <= from, partial: !!trackedSince && trackedSince > from && trackedSince <= to, trackedSince };
  const list = Object.values(rows).map(r => {
    const calc = r.opening + r.joinings - r.exits + r.transfersIn - r.transfersOut;
    return { ...r, net: r.closing - r.opening, netPct: r.opening ? r1(((r.closing - r.opening) / r.opening) * 100) : null, reconciles: calc === r.closing, transfersIn: trackedSince ? r.transfersIn : null, transfersOut: trackedSince ? r.transfersOut : null, _in: r.transfersIn, _out: r.transfersOut };
  }).sort((a, b) => b.closing - a.closing);
  const company = list.reduce((a, r) => ({ opening: a.opening + r.opening, joinings: a.joinings + r.joinings, exits: a.exits + r.exits, closing: a.closing + r.closing, transfers: a.transfers + r._in }), { opening: 0, joinings: 0, exits: 0, closing: 0, transfers: 0 });
  company.net = company.closing - company.opening;
  company.reconciles = company.opening + company.joinings - company.exits === company.closing && list.every(r => r.reconciles) && list.reduce((x, r) => x + r._in - r._out, 0) === 0;
  return { list, company, joinList, exitList, anomalies, transferList, transfers, openingDate: open };
}

// ── recruitment, vacancies ────────────────────────────────────────────────
const FILLED = new Set(['joined', 'hired', 'onboarded']);
const OFFER_RELEASED = new Set(['offered', 'offer_released', 'offer_sent', 'offer_accepted', 'offer_declined', 'offer_rejected', 'selected', 'joined', 'hired']);
export function computeRecruitment(ctx, model, scope, from, to, today, { detail = false } = {}) {
  const cfg = ctx.cfg;
  const reqDeptOk = (r) => {
    // department filters apply to requisitions; other employee filters do not (a requisition has no person).
    const f = scope.filters || {};
    return !f.department || f.department === 'all' || (r.department || 'Unassigned') === f.department;
  };
  const reqs = ctx.reqs.filter(reqDeptOk);
  const reqIds = new Set(reqs.map(r => r.id));
  const cands = ctx.cands.filter(c => !c.job_id || reqIds.has(c.job_id));
  const candByReq = {}; for (const c of cands) (candByReq[c.job_id || ''] ||= []).push(c);
  const reqDay = (r) => dayOf(r.created_at || r._createdAt);
  const counts = {
    raised: reqs.filter(r => reqDay(r) >= from && reqDay(r) <= to).length,
    approved: reqs.filter(r => dayOf(r.approved_date) >= from && dayOf(r.approved_date) <= to).length,
    closed: reqs.filter(r => r.status === 'closed').length,
    applied: cands.filter(c => dayOf(c.applied_date || c._created) >= from && dayOf(c.applied_date || c._created) <= to).length,
    interviews: ctx.interviews.filter(i => dayOf(i.scheduled_date) >= from && dayOf(i.scheduled_date) <= to && reqIds.has(cands.find(c => c.id === i.candidate_id)?.job_id)).length,
  };
  const live = reqs.filter(r => r.status === 'published' || r.status === 'open');
  const rowsReq = live.map(r => {
    const positions = Math.max(1, num(r.number_of_positions) || 1);
    const mine = candByReq[r.id] || [];
    const filled = mine.filter(c => FILLED.has(c.status)).length;
    const age = diffDays(reqDay(r) || today, today);
    const lastAct = mine.reduce((m, c) => { const d = dayOf(c.applied_date || c._created); return d > m ? d : m; }, '');
    return { id: r.id, title: r.position_title || '', dept: r.department || 'Unassigned', designation: r.position_title || '', location: r.location || '', raised: reqDay(r), positions, filled: Math.min(filled, positions), remaining: Math.max(positions - filled, 0), owner: model.byUid[r.requested_by]?.name || r.requested_by_role || '', status: label(r.status), age, lastActivity: lastAct, candidates: mine.length, offers: mine.filter(c => OFFER_RELEASED.has(c.status)).length, approved: r.manager_approval_status === 'approved' && r.hr_approval_status === 'approved', priority: r.priority || '' };
  }).sort((a, b) => b.age - a.age);
  const openVacancies = rowsReq.reduce((s, r) => s + r.remaining, 0);
  const byDept = {};
  for (const r of rowsReq) { const x = (byDept[r.dept] ||= { dept: r.dept, reqs: 0, positions: 0, filled: 0, open: 0, aged: 0 }); x.reqs++; x.positions += r.positions; x.filled += r.filled; x.open += r.remaining; if (r.age > cfg.vacancyAgeDays) x.aged += r.remaining; }
  // pipeline (current state — candidate records carry no stage timestamps)
  const stage = {};
  for (const c of cands) stage[c.status || 'applied'] = (stage[c.status || 'applied'] || 0) + 1;
  const offersAccepted = cands.filter(c => c.status === 'offer_accepted').length;
  const funnel = [
    { stage: 'Applied (all)', n: cands.length },
    { stage: 'Screening', n: cands.filter(c => ['screening', 'interview_scheduled', 'interviewed', 'selected', 'offered', 'offer_accepted', 'joined', 'hired'].includes(c.status)).length },
    { stage: 'Interview', n: cands.filter(c => ['interview_scheduled', 'interviewed', 'selected', 'offered', 'offer_accepted', 'joined', 'hired'].includes(c.status)).length },
    { stage: 'Selected / offer', n: cands.filter(c => OFFER_RELEASED.has(c.status)).length },
    { stage: 'Offer accepted', n: offersAccepted + cands.filter(c => FILLED.has(c.status)).length },
    { stage: 'Joined', n: cands.filter(c => FILLED.has(c.status)).length },
  ];
  // ── time-to-fill / time-to-hire and stage movements: only from dates actually recorded (closed_date, status_history)
  const days = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
  const filledReqs = reqs.filter(r => r.closed_date && r.closed_reason === 'filled' && reqDay(r));
  const fillDays = filledReqs.map(r => days(reqDay(r), r.closed_date));
  const fillIn = filledReqs.filter(r => dayOf(r.closed_date) >= from && dayOf(r.closed_date) <= to).map(r => days(reqDay(r), r.closed_date));
  const hireDays = [], offerDays = [], events = {};
  let firstTracked = '';
  for (const c of cands) {
    const h = Array.isArray(c.status_history) ? c.status_history : [];
    const start = dayOf(c.applied_date || c._created);
    for (const x of h) {
      const d = dayOf(x.at); if (!d) continue;
      if (x.source !== 'applied_date' && (!firstTracked || d < firstTracked)) firstTracked = d;
      if (x.source !== 'applied_date' && d >= from && d <= to) events[x.status] = (events[x.status] || 0) + 1;
      if (start && FILLED.has(x.status) && x.source !== 'applied_date') hireDays.push(days(start, x.at));
      if (start && ['offered', 'offer_released', 'offer_sent'].includes(x.status)) offerDays.push(days(start, x.at));
    }
  }
  const timing = {
    trackedSince: firstTracked || (filledReqs.length ? dayOf(filledReqs.map(r => r.closed_date).sort()[0]) : null),
    timeToFill: fillDays.length ? { avgDays: r1(mean(fillDays)), n: fillDays.length, inPeriodAvg: fillIn.length ? r1(mean(fillIn)) : null, inPeriodN: fillIn.length } : null,
    timeToHire: hireDays.length ? { avgDays: r1(mean(hireDays)), n: hireDays.length } : null,
    timeToOffer: offerDays.length ? { avgDays: r1(mean(offerDays)), n: offerDays.length } : null,
    stageEvents: events,
    cancelledOrClosedUnfilled: reqs.filter(r => r.status === 'closed' && r.closed_reason === 'closed' && dayOf(r.closed_date) >= from && dayOf(r.closed_date) <= to).length,
  };
  const newReqList = reqs.filter(r => reqDay(r) >= from && reqDay(r) <= to).map(r => ({ title: r.position_title || '', dept: r.department || 'Unassigned', positions: num(r.number_of_positions) || 1, status: label(r.status), raised: reqDay(r), location: r.location || '', priority: label(r.priority), approved: r.manager_approval_status === 'approved' && r.hr_approval_status === 'approved' ? 'Yes' : 'No' }));
  const reqById = {}; for (const r of reqs) reqById[r.id] = r;
  const newCandList = cands.filter(c => dayOf(c.applied_date || c._created) >= from && dayOf(c.applied_date || c._created) <= to).map(c => ({ name: c.full_name || '', position: c.position_applied || reqById[c.job_id]?.position_title || '', dept: c.department || reqById[c.job_id]?.department || 'Unassigned', stage: label(c.status), source: c.source || '', applied: dayOf(c.applied_date || c._created), experience: c.experience_years ?? '' }));
  return { newReqList, newCandList, timing, counts, openVacancies, openReqs: rowsReq.length, rowsReq, byDept: Object.values(byDept).sort((a, b) => b.open - a.open), stage, funnel, offersReleased: cands.filter(c => OFFER_RELEASED.has(c.status)).length, offersAccepted, offersDeclined: cands.filter(c => ['offer_declined', 'offer_rejected'].includes(c.status)).length, rejected: cands.filter(c => c.status === 'rejected').length, unapproved: live.filter(r => !(r.manager_approval_status === 'approved' && r.hr_approval_status === 'approved')) };
}

// ── gate passes ───────────────────────────────────────────────────────────
export function computeGatePasses(ctx, model, scope, from, to, today, attCur, { detail = false } = {}) {
  const cfg = ctx.cfg, days = diffDays(from, to) + 1, now = Date.now();
  const sel = ctx.gps.filter(g => { const e = model.byUid[g.employee_user_id || g.user_id]; const d = dayOf(g.request_date || g._createdAt); return d >= from && d <= to && (e ? scope.ok(e) : !scope.anyFilter); });
  const c = { total: sel.length, returned: 0, open: 0, overdue: 0, autoClosed: 0, cancelled: 0, rejected: 0, pending: 0, durationMin: [], byType: {}, byStatus: {}, byDept: {}, byDay: {} };
  const exceptions = [], rows = [];
  const perEmp = {}, autoByEmp = {};
  for (const g of sel) {
    const uid = g.employee_user_id || g.user_id, e = model.byUid[uid], dp = e?.dept || 'Unassigned';
    const st = g.status, d = dayOf(g.request_date || g._createdAt);
    const dep = ts(g.departure_time), ret = ts(g.return_time);
    c.byType[g.outing_type || 'other'] = (c.byType[g.outing_type || 'other'] || 0) + 1;
    c.byStatus[st] = (c.byStatus[st] || 0) + 1;
    c.byDept[dp] = (c.byDept[dp] || 0) + 1; c.byDay[d] = (c.byDay[d] || 0) + 1;
    perEmp[uid] = (perEmp[uid] || 0) + 1;
    const auto = !!g.auto_closed || st === 'auto_closed';
    if (auto) { c.autoClosed++; autoByEmp[uid] = (autoByEmp[uid] || 0) + 1; }
    if (st === 'returned') c.returned++;
    else if (st === 'cancelled') c.cancelled++;
    else if (st === 'rejected') c.rejected++;
    else if (st === 'pending_approval') c.pending++;
    const isOpen = st === 'approved' || st === 'departed';
    if (isOpen) c.open++;
    const exp = ts(g.expected_return_time);
    const overdue = isOpen && ((exp != null && exp < now) || d < today);
    if (overdue) c.overdue++;
    let durMin = null;
    if (dep != null && ret != null && ret > dep && !auto) { durMin = Math.round((ret - dep) / 60000); c.durationMin.push(durMin); }
    const base = { id: g.id, code: e?.code || '', name: e?.name || g.employee_name || '', dept: dp, type: label(g.outing_type), reason: g.reason || '', created: g._createdAt, date: d, status: label(st), approval: label(g.manager_approval_status), exit: g.departure_time || '', expected: g.expected_return_time || '', returned: g.return_time || '', durationMin: durMin, closure: auto ? 'Auto-closed' : st === 'returned' ? 'Marked returned' : '', approver: model.byUid[g.manager_user_id || g.manager_id]?.name || '', location: g.current_location || '' };
    if (detail) rows.push(base);
    const flag = (kind, sev, why, action, expected = '', actual = '') => exceptions.push({ ...base, kind, sev, why, action, expected, actual });
    if (overdue) flag('Open beyond expected return', exp != null && exp < now ? 'High' : 'Medium', exp != null ? `Expected back ${new Date(exp).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Still open from an earlier day with no return recorded.', 'Gate admin to confirm whether the employee has returned and close the pass.', exp != null ? 'Returned by expected time' : 'Closed same day', 'Still open');
    if (st === 'returned' && !auto && (dep == null || ret == null)) flag('Missing exit or return timestamp', 'Medium', 'Pass is marked returned but a movement timestamp is missing.', 'Gate admin to verify the movement log.');
    if (st === 'returned' && g.manager_approval_status !== 'approved' && !auto) flag('Inconsistent status transition', 'Medium', `Returned although manager approval is "${label(g.manager_approval_status)}".`, 'Verify the approval trail.');
    if (st === 'approved' && d < today) flag('Approved without a movement event', 'Low', 'Approved on an earlier day but no departure was recorded.', 'Close the pass or confirm the outing did not take place.');
    if (durMin != null) {
      if (exp != null && ret > exp + 15 * 60000) flag('Outing longer than expected', 'Medium', `Returned ${Math.round((ret - exp) / 60000)} min after the expected time.`, 'Manager to review with the employee.', `By ${new Date(exp).toISOString().slice(11, 16)} UTC`, `${durMin} min away`);
      else if (g.outing_type === 'unofficial_outing' && durMin > cfg.gpUnofficialMaxHours * 60) flag('Outing longer than expected', 'Medium', `Unofficial outing lasted ${Math.round(durMin / 60 * 10) / 10} h.`, 'Manager to review.', `${cfg.gpUnofficialMaxHours} h`, `${r1(durMin / 60)} h`);
    }
    // personal / unofficial outing on a day the attendance says absent or leave is worth checking; official outings are legitimate work
    if (g.outing_type !== 'official_outing' && attCur) {
      const rec = ctx.att.map.get(`${uid}|${d}`);
      if (rec && ['absent', 'leave'].includes(rec.s) && ['returned', 'departed', 'auto_closed'].includes(st)) flag('Outing on a day marked absent / leave', 'Low', `Attendance for the day reads "${label(rec.s)}" although the pass shows movement.`, 'HR to reconcile attendance with the gate log.');
    }
  }
  const lim = scaled(cfg.gpFrequent, days);
  const empLimit = outlierLimit(Object.values(perEmp), lim, cfg);
  for (const [u, n] of Object.entries(perEmp)) if (n >= empLimit) { const e = model.byUid[u]; exceptions.push({ kind: 'Unusually frequent outings', sev: sevFor(n / empLimit), code: e?.code || '', name: e?.name || '', dept: e?.dept || '', why: `${n} gate passes in ${days} day(s).`, action: 'Review with the reporting manager.', expected: `Fewer than ${Math.ceil(empLimit)}`, actual: String(n), status: '', date: '' }); }
  const alim = scaled(cfg.gpAutoClosedRepeat, days);
  for (const [u, n] of Object.entries(autoByEmp)) if (n >= alim) { const e = model.byUid[u]; exceptions.push({ kind: 'Repeatedly auto-closed', sev: sevFor(n / alim), code: e?.code || '', name: e?.name || '', dept: e?.dept || '', why: `${n} passes were closed by the system because no return was recorded.`, action: 'Remind the employee to scan back in at the gate.', expected: 'Closed by gate admin', actual: `${n} auto-closed`, status: '', date: '' }); }
  const mins = c.durationMin;
  c.avgDurationMin = mins.length ? Math.round(mean(mins)) : null;
  c.durationSample = mins.length;
  // repeat frequency: employees with 2+ passes
  c.repeatEmployees = Object.values(perEmp).filter(n => n >= 2).length;
  delete c.durationMin;
  return { counts: c, exceptions, rows, perEmp };
}

// ── visitors ──────────────────────────────────────────────────────────────
export function computeVisitors(ctx, model, scope, from, to, today) {
  const cfg = ctx.cfg, now = Date.now();
  const sel = ctx.visitors.filter(v => {
    const d = dayOf(v.expected_arrival || v.check_in_time || v._createdAt);
    if (d < from || d > to) return false;
    const h = model.byUid[v.host_user_id];
    return h ? scope.ok(h) : !scope.anyFilter;
  });
  const c = { total: sel.length, walkIn: 0, preRegistered: 0, checkedOut: 0, pendingApproval: 0, stillIn: 0, missingCheckout: 0, byDept: {}, byDay: {}, byPurpose: {}, durations: [], expectedVsActual: [] };
  const rows = [], issues = [];
  const byMobile = {};
  for (const v of sel) {
    const kind = v.source === 'walk_in' ? 'Walk-in' : 'Pre-registered';
    if (kind === 'Walk-in') c.walkIn++; else c.preRegistered++;
    const host = model.byUid[v.host_user_id], dp = host?.dept || 'Unassigned';
    c.byDept[dp] = (c.byDept[dp] || 0) + 1;
    const d = dayOf(v.expected_arrival || v.check_in_time || v._createdAt); c.byDay[d] = (c.byDay[d] || 0) + 1;
    if (v.purpose) c.byPurpose[v.purpose] = (c.byPurpose[v.purpose] || 0) + 1;
    if (v.status === 'checked_out') c.checkedOut++;
    if (v.status === 'pending_approval') c.pendingApproval++;
    const ci = ts(v.check_in_time), co = ts(v.check_out_time);
    let dur = null;
    if (ci != null && co != null && co > ci) { dur = Math.round((co - ci) / 60000); c.durations.push(dur); }
    const exp = ts(v.expected_arrival) != null && ts(v.expected_departure) != null ? Math.round((ts(v.expected_departure) - ts(v.expected_arrival)) / 60000) : null;
    if (dur != null && exp != null) c.expectedVsActual.push([exp, dur]);
    if (v.status === 'checked_in') {
      c.stillIn++;
      if (d < today || (ci != null && now - ci > cfg.visitorOpenHours * 3600000)) { c.missingCheckout++; issues.push({ kind: 'Missing check-out', visitor: v.visitor_name || '', host: host?.name || v.host_name || '', dept: dp, date: d, why: 'Checked in but never checked out.', action: 'Security to confirm the visitor left and close the record.' }); }
    }
    if (v.mobile_number) byMobile[v.mobile_number] = (byMobile[v.mobile_number] || 0) + 1;
    rows.push({ type: kind, visitor: v.visitor_name || '', company: v.company || '', mobile: v.mobile_number || '', host: host?.name || v.host_name || '', dept: dp, purpose: v.purpose || '', status: label(v.status), date: d, in: v.check_in_time || '', out: v.check_out_time || '', durationMin: dur, expectedMin: exp });
  }
  c.repeatVisitors = Object.values(byMobile).filter(n => n > 1).length;
  c.avgDurationMin = c.durations.length ? Math.round(mean(c.durations)) : null;
  c.avgExpectedMin = c.expectedVsActual.length ? Math.round(mean(c.expectedVsActual.map(x => x[0]))) : null;
  delete c.durations; delete c.expectedVsActual;
  return { counts: c, rows, issues };
}

// ── reimbursements ────────────────────────────────────────────────────────
export function computeReimbursements(ctx, model, scope, from, to, today) {
  const cfg = ctx.cfg;
  const sel = ctx.reimbs.filter(r => { const d = dayOf(r.submitted_at || r._createdAt || r.expense_date); const e = model.byUid[r.user_id]; return d >= from && d <= to && (e ? scope.ok(e) : !scope.anyFilter); });
  const c = { claims: sel.length, approved: 0, rejected: 0, pending: 0, paid: 0, claimedAmt: 0, approvedAmt: 0, paidAmt: 0, outstandingAmt: 0, outstandingClaims: 0, avgApprovalHours: null, byType: {}, byDept: {} };
  const hrs = [], rows = [], issues = [], seen = {}, pendBy = {};
  for (const r of sel) {
    const e = model.byUid[r.user_id], dp = e?.dept || 'Unassigned', amt = num(r.amount), st = r.status;
    c.claimedAmt += amt;
    const approvedLike = ['approved', 'paid', 'hr_approved', 'manager_approved_final'].includes(st) || !!r.hr_approved_by;
    if (st === 'rejected') c.rejected++;
    else if (st === 'paid') { c.paid++; c.paidAmt += amt; }
    if (approvedLike) { c.approved++; c.approvedAmt += amt; }
    if (!approvedLike && st !== 'rejected') { c.pending++; c.outstandingClaims++; c.outstandingAmt += amt; pendBy[r.user_id] = (pendBy[r.user_id] || 0) + 1; }
    if (approvedLike && st !== 'paid') { c.outstandingAmt += amt; } // approved = payable, not yet paid
    const sub = r.submitted_at || r._createdAt;
    if (r.approved_date && ts(sub) != null) hrs.push((ts(r.approved_date) - ts(sub)) / 3600000);
    const t = label(r.expense_type); (c.byType[t] ||= { n: 0, amt: 0 }); c.byType[t].n++; c.byType[t].amt += amt;
    (c.byDept[dp] ||= { n: 0, amt: 0, pendingAmt: 0 }); c.byDept[dp].n++; c.byDept[dp].amt += amt; if (!approvedLike && st !== 'rejected') c.byDept[dp].pendingAmt += amt;
    const age = diffDays(dayOf(sub), today);
    const key = `${r.user_id}|${r.expense_type}|${amt}|${dayOf(r.expense_date)}`;
    if (seen[key]) issues.push({ kind: 'Possible duplicate claim', code: e?.code || '', name: e?.name || '', dept: dp, amount: amt, date: dayOf(r.expense_date), why: 'Same employee, expense type, amount and date as another claim.', action: 'Finance to compare receipts before approval.' }); else seen[key] = 1;
    if (!approvedLike && st !== 'rejected' && age > cfg.reimbPendingDays) issues.push({ kind: 'Claim pending beyond SLA', code: e?.code || '', name: e?.name || '', dept: dp, amount: amt, date: dayOf(r.expense_date), why: `Pending for ${age} days.`, action: 'Approver to action or reject.' });
    rows.push({ code: e?.code || '', name: e?.name || '', dept: dp, type: t, date: dayOf(r.expense_date), amount: amt, claimed: dayOf(sub), status: label(st), approvedOn: dayOf(r.approved_date), paidOn: dayOf(r.paid_at), ageDays: approvedLike ? null : age });
  }
  for (const [u, n] of Object.entries(pendBy)) if (n >= 2) { const e = model.byUid[u]; issues.push({ kind: 'Repeated pending claims', code: e?.code || '', name: e?.name || '', dept: e?.dept || '', amount: null, date: '', why: `${n} claims are still pending.`, action: 'Approver to clear the backlog.' }); }
  c.avgApprovalHours = hrs.length ? r1(mean(hrs)) : null;
  for (const k of ['claimedAmt', 'approvedAmt', 'paidAmt', 'outstandingAmt']) c[k] = Math.round(c[k] * 100) / 100;
  return { counts: c, rows, issues };
}

// ── data quality ──────────────────────────────────────────────────────────
export function computeDataQuality(ctx, model, scope, today, attCur, workforce) {
  const items = [];
  const add = (key, title, source, n, cause, fix, samples = [], sev = 'Medium') => { items.push({ key, title, source, count: n, cause, fix, sev: n ? sev : 'OK', samples: samples.slice(0, 8) }); };
  const emps = scope.scopeEmps;
  const nm = (e) => `${e.code || '—'} ${e.name}`.trim();
  add('no_dept', 'Employees without a department', 'Employee master', emps.filter(e => !e.hasDept).length, 'Department left blank at onboarding or import.', 'HR to assign a department in the employee profile.', emps.filter(e => !e.hasDept).map(nm));
  add('no_doj', 'Employees without a joining date', 'Employee master', emps.filter(e => !e.doj).length, 'Joining date missing — such employees are left out of headcount movement.', 'Enter the date of joining.', emps.filter(e => !e.doj).map(nm), 'High');
  add('no_exit_date', 'Separated employees without an exit date', 'Employee master', emps.filter(e => e.separated && !e.lwd).length, 'Status is resigned/retired/inactive but no last working day is recorded.', 'Record the last working day so headcount history is exact.', emps.filter(e => e.separated && !e.lwd).map(nm), 'High');
  add('exit_before_join', 'Exit date before joining date', 'Employee master', workforce.anomalies.length, 'Inconsistent employment dates.', 'Correct the dates.', workforce.anomalies.map(a => nm(a.e)), 'High');
  const dup = {}; for (const e of model.emps) if (e.code) (dup[e.code] ||= []).push(e); const dupCodes = Object.entries(dup).filter(([, v]) => v.length > 1);
  add('dup_code', 'Duplicate employee codes', 'Employee master', dupCodes.length, 'Two employee records share one code.', 'Merge or renumber.', dupCodes.map(([c, v]) => `${c} (${v.length})`), 'High');
  const noStatus = emps.filter(e => e.noStatus); add('no_status', 'Employees with no employment status (counted as active)', 'Employee master', noStatus.length, 'Usually joiners created through onboarding whose profile was never activated; they are counted in headcount and show as absent.', 'Activate the profile, or set a joining date in the future until the person starts.', noStatus.map(nm), 'High');
  const byU = {}; for (const e of model.emps) (byU[e.uid] ||= []).push(e); const dupU = Object.values(byU).filter(v => v.length > 1);
  add('dup_uid', 'Employee records sharing one user id', 'Employee master', dupU.length, 'Two employee profiles point at the same login, so history by person (transfers, snapshots) cannot tell them apart.', 'Merge the duplicate profiles.', dupU.map(v => v.map(nm).join(' / ')), 'High');
  const noMgr = emps.filter(e => !e.mgr && !e.separated); add('no_mgr', 'Active employees without a reporting manager', 'Employee master', noMgr.length, 'Approvals cannot route to a manager.', 'Assign a reporting manager.', noMgr.map(nm), 'Low');
  const badMgr = emps.filter(e => e.mgr && !model.byUid[e.mgr]); add('bad_mgr', 'Reporting manager does not exist', 'Employee master', badMgr.length, 'Manager id points to a missing employee.', 'Re-assign the manager.', badMgr.map(nm));
  const badDept = emps.filter(e => e.hasDept && ctx.depts.length && !ctx.depts.some(d => d.name === e.dept)); add('dept_unlisted', 'Employee department not in the department list', 'Employee master', badDept.length, 'Department spelled differently from the master list.', 'Align the name with the Departments master.', [...new Set(badDept.map(e => e.dept))]);
  // attendance
  const outside = []; for (const [k, r] of ctx.att.map) { const [u, d] = k.split('|'); const e = model.byUid[u]; if (e && e.doj && (d < e.doj || (e.lwd && d > e.lwd)) && PHYS.has(r.s)) outside.push(`${nm(e)} ${fmtD(d)}`); }
  add('att_outside', 'Attendance records outside employment dates', 'Attendance', outside.length, 'Punches recorded before joining or after the last working day.', 'Check joining/exit dates or remove stray punches.', outside);
  add('att_dupes', 'Duplicate attendance records for one employee-day', 'Attendance', ctx.att.dupes.length, 'Two attendance rows exist for one day; only one is used.', 'De-duplicate the attendance table.', ctx.att.dupes.map(k => k.replace('|', ' ')));
  add('att_missing', 'Scheduled days with no attendance record', 'Attendance', attCur.total.missing, 'Attendance generation did not run or the employee is not in the roster.', 'Run attendance reprocessing for the dates.', Object.entries(attCur.dateMissing).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${fmtD(d)}: ${n}`));
  add('att_incomplete', 'Incomplete punch sessions', 'Attendance', attCur.total.incomplete, 'Check-in without a check-out on a past day.', 'Employee to regularise or HR to correct.', []);
  add('att_conflicts', 'Attendance conflicting with leave records', 'Attendance / Leave', attCur.conflicts.length, 'Attendance status and approved leave disagree.', 'Reprocess the day or correct the leave.', attCur.conflicts.map(c => `${nm(c.e)} ${fmtD(c.date)} — ${c.kind}`));
  const leaveBad = ctx.leaves.filter(l => l.start_date && l.end_date && dayOf(l.end_date) < dayOf(l.start_date)); add('leave_dates', 'Leave requests ending before they start', 'Leave', leaveBad.length, 'Invalid date range.', 'Correct or cancel the request.', leaveBad.map(l => model.byUid[l.user_id]?.name || l.user_id), 'High');
  const orphanLeave = ctx.leaves.filter(l => l.user_id && !model.byUid[l.user_id]); add('leave_orphan', 'Leave requests for unknown employees', 'Leave', orphanLeave.length, 'Employee record missing.', 'Investigate and archive.', []);
  // gate pass
  const gpBad = ctx.gps.filter(g => (g.return_time && g.departure_time && ts(g.return_time) < ts(g.departure_time)) || (g.status === 'returned' && !g.return_time && !g.auto_closed)); add('gp_ts', 'Gate passes with invalid timestamps / status', 'Gate pass', gpBad.length, 'Return before departure, or returned without a return time.', 'Gate admin to correct.', gpBad.map(g => `${g.id.slice(0, 8)} ${g.request_date}`));
  // recruitment
  const reqBad = ctx.reqs.filter(r => !(num(r.number_of_positions) >= 1)); add('req_positions', 'Requisitions without a valid number of positions', 'Recruitment', reqBad.length, 'Vacancy count missing or zero.', 'Set the approved positions.', reqBad.map(r => r.position_title || r.id));
  const candOrphan = ctx.cands.filter(c => c.job_id && !ctx.reqs.some(r => r.id === c.job_id)); add('cand_orphan', 'Candidates linked to a missing requisition', 'Recruitment', candOrphan.length, 'Requisition deleted.', 'Re-link or archive.', []);
  // unassigned dept transactions
  const unTx = ctx.gps.filter(g => !model.byUid[g.employee_user_id || g.user_id]).length + ctx.reimbs.filter(r => !model.byUid[r.user_id]).length;
  add('unassigned_tx', 'Transactions without a valid employee / department mapping', 'Gate pass, reimbursement', unTx, 'The employee record was removed or the user id is wrong.', 'Re-map or archive.', []);
  return items;
}


// ── people view: the same attendance data told in people, not employee-days ──
const BANDS = (v, edges) => { for (let i = 0; i < edges.length; i++) if (v <= edges[i][0]) return edges[i][1]; return edges[edges.length - 1][1]; };
export function peopleView(att, prevAtt, departmentsHead = {}) {
  const T = att.total, days = att.perDay;
  const wd = days.filter(d => d.sched > 0);
  const n = wd.length || 0;
  const avgOf = (x) => (n ? r1(x / n) : null);
  const phys = T.present + T.late + T.short;
  const mk = (t, nn) => ({ scheduled: nn ? r1(t.sched / nn) : null, present: nn ? r1((t.present + t.late + t.short) / nn) : null, half: nn ? r1(t.half / nn) : null, wfh: nn ? r1(t.wfh / nn) : null, od: nn ? r1(t.od / nn) : null, leave: nn ? r1(t.leave / nn) : null, absent: nn ? r1(t.absent / nn) : null, missing: nn ? r1((t.missing + t.incomplete) / nn) : null, late: nn ? r1(t.lateArrivals / nn) : null });
  const avg = mk(T, n);
  const prevN = prevAtt ? prevAtt.perDay.filter(d => d.sched > 0).length : 0;
  const prevAvg = prevAtt ? mk(prevAtt.total, prevN) : null;
  // weekday pattern
  const wk = {};
  for (const d of wd) { const name = DAY_NAMES[dow(d.date)]; const x = (wk[name] ||= { day: name, days: 0, sched: 0, present: 0, absent: 0, late: 0 }); x.days++; x.sched += d.sched; x.present += d.present + d.late + d.short; x.absent += d.absent; x.late += d.lateArrivals; }
  const weekday = DAY_NAMES.filter(d => wk[d]).map(d => ({ day: d, workingDays: wk[d].days, avgScheduled: r1(wk[d].sched / wk[d].days), avgPresent: r1(wk[d].present / wk[d].days), avgAbsent: r1(wk[d].absent / wk[d].days), avgLate: r1(wk[d].late / wk[d].days), presencePct: pctOf(wk[d].present, wk[d].sched) }));
  // how attendance is spread across people
  const emps = [...att.perEmp.values()].filter(p => p.acc.sched > 0);
  const band = (vals, edges) => { const out = {}; for (const [, l] of edges) out[l] = 0; for (const v of vals) out[BANDS(v, edges)]++; return out; };
  const absentBands = band(emps.map(p => p.acc.absent), [[0, 'No absence'], [2, '1–2 days'], [5, '3–5 days'], [Infinity, '6+ days']]);
  const lateBands = band(emps.map(p => p.acc.lateArrivals), [[0, 'Never late'], [2, '1–2 times'], [5, '3–5 times'], [Infinity, '6+ times']]);
  const compBands = band(emps.map(p => rates(p.acc).compliance ?? 0), [[79.99, 'Below 80%'], [89.99, '80–90%'], [94.99, '90–95%'], [100, '95% and above']]);
  const perfect = emps.filter(p => p.acc.absent === 0 && p.acc.missing === 0 && p.acc.late === 0 && p.acc.lateArrivals === 0).length;
  const top = (f, min = 1) => emps.map(p => ({ code: p.e.code, name: p.e.name, dept: p.e.dept, n: f(p) })).filter(x => x.n >= min).sort((a, b) => b.n - a.n).slice(0, 10);
  // department: share of the department present on an average day
  const dept = Object.entries(att.perDept).map(([dp, v]) => ({ dept: dp, avgScheduled: n ? r1(v.sched / n) : null, avgPresent: n ? r1((v.present + v.late + v.short) / n) : null, avgAbsent: n ? r1(v.absent / n) : null, avgLeave: n ? r1(v.leave / n) : null, avgWfhOd: n ? r1((v.wfh + v.od) / n) : null, presencePct: pctOf(v.present + v.late + v.short, v.sched), sched: v.sched, headcount: v.headcount })).filter(x => x.sched > 0).sort((a, b) => (b.presencePct ?? 0) - (a.presencePct ?? 0));
  return { workingDays: n, employeesTracked: emps.length, avg, prevAvg, prevWorkingDays: prevN, physicalDays: phys, weekday, absentBands, lateBands, compBands, perfect, topAbsent: top(p => p.acc.absent), topLate: top(p => p.acc.lateArrivals), topMissing: top(p => p.acc.missing + p.acc.incomplete), dept };
}

// ── who works here: composition and what is coming up ──
export function computeComposition(ctx, model, scope, to, today) {
  const act = scope.scopeEmps.filter(e => model.activeOn(e, to) && e.doj);
  const count = (f) => { const o = {}; for (const e of act) { const k = f(e) || 'Not recorded'; o[k] = (o[k] || 0) + 1; } return Object.entries(o).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n); };
  const ten = (e) => { const d = diffDays(e.doj, to); return d < 90 ? 'Under 3 months' : d < 365 ? '3–12 months' : d < 1095 ? '1–3 years' : d < 1825 ? '3–5 years' : '5+ years'; };
  const order = ['Under 3 months', '3–12 months', '1–3 years', '3–5 years', '5+ years'];
  const tenure = count(ten).sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
  const soon = addDays(today, 30);
  const upcoming = { notice: [], probation: [], recentJoiners: [] };
  for (const x of ctx.exits) {
    const e = model.byUid[x.user_id]; if (!e || !scope.ok(e) || ['rejected', 'cancelled', 'withdrawn'].includes(x.status)) continue;
    const l = dayOf(x.last_working_date); if (l && l >= today) upcoming.notice.push({ code: e.code, name: e.name, dept: e.dept, last: l, status: label(x.status) });
  }
  upcoming.notice.sort((a, b) => a.last.localeCompare(b.last));
  for (const e of act) {
    const pe = dayOf(e.raw.probation_end_date);
    if (pe && pe >= today && pe <= soon && !e.separated) upcoming.probation.push({ code: e.code, name: e.name, dept: e.dept, date: pe });
    if (e.doj >= addDays(today, -30) && e.doj <= today) upcoming.recentJoiners.push({ code: e.code, name: e.name, dept: e.dept, date: e.doj });
  }
  upcoming.probation.sort((a, b) => a.date.localeCompare(b.date)); upcoming.recentJoiners.sort((a, b) => b.date.localeCompare(a.date));
  return { total: act.length, byLocation: count(e => e.loc), byType: count(e => label(e.empType)), byDesignation: count(e => e.designation).slice(0, 12), byTenure: tenure, upcoming };
}

// ── KPIs ──────────────────────────────────────────────────────────────────
function coreMetrics(ctx, model, scope, from, to, today) {
  const att = computeAttendance(ctx, model, scope, from, to, today);
  const reg = computeRegularisation(ctx, model, scope, from, to, today);
  const lv = computeLeave(ctx, model, scope, from, to, today);
  const wf = computeWorkforce(ctx, model, scope, from, to);
  const rc = computeRecruitment(ctx, model, scope, from, to, today);
  const gp = computeGatePasses(ctx, model, scope, from, to, today, null);
  const vs = computeVisitors(ctx, model, scope, from, to, today);
  const rb = computeReimbursements(ctx, model, scope, from, to, today);
  return { att, reg, lv, wf, rc, gp, vs, rb };
}

// Attendance cards are shown as PEOPLE on an average working day (easy to read); the employee-day total stays in the sub-line.
const workDays = (m) => m.att.perDay.filter(d => d.sched > 0).length;
const avgDay = (m, f) => { const n = workDays(m); return n ? r1(f(m.att.total) / n) : null; };
const edSub = (m, f) => `${f(m.att.total)} employee-days over ${workDays(m)} working day(s)`;
const AVG_HELP = ' Shown as people on an average working day (total ÷ working days); the sub-line gives the employee-day total.';
const KPI_DEFS = [
  { key: 'headcount', label: 'Active headcount', unit: 'employees', help: 'Employees active on the last day of the period (joined on/before it and not past their last working day). A headcount, not an attendance count.', link: 'workforce', get: m => m.wf.company.closing, better: 'neutral' },
  { key: 'joinings', label: 'New joinings', unit: 'employees', help: 'Employees whose date of joining falls inside the period.', link: 'workforce', get: m => m.wf.company.joinings, better: 'neutral' },
  { key: 'exits', label: 'Employee exits', unit: 'employees', help: 'Employees whose last working day is inside the period (the exit takes effect the next day).', link: 'workforce', get: m => m.wf.company.exits, better: 'down' },
  { key: 'net', label: 'Net headcount change', unit: 'employees', help: 'Closing headcount − opening headcount.', link: 'workforce', get: m => m.wf.company.net, better: 'neutral' },
  { key: 'vacancies', label: 'Open vacancies', unit: 'positions', help: 'Positions on published requisitions not yet filled (positions − candidates joined), as of the period end. The comparison uses the nightly snapshot nearest the comparison period end; before snapshots began there is no comparison.', link: 'workforce', get: (m, side) => side === 'cur' ? m.rc.openVacancies : (m.snap ? m.snap.vacancies.open : null), better: 'down' },
  { key: 'reqs', label: 'Requisitions raised', unit: 'requisitions', help: 'Requisitions created in the period.', link: 'workforce', get: m => m.rc.counts.raised, better: 'neutral' },
  { key: 'offers', label: 'Offers released / accepted', unit: 'candidates', help: 'Candidates at an offer stage / with an accepted offer (current pipeline). The comparison uses the nightly snapshot nearest the comparison period end.', link: 'workforce', get: (m, side) => side === 'cur' ? m.rc.offersReleased : (m.snap ? m.snap.offers.released : null), extra: (m) => `${m.rc.offersAccepted} accepted`, better: 'neutral' },
  { key: 'present', label: 'Present (physical)', unit: 'people / day', help: 'Employee-days with physical presence: present + late + short attendance. Half-day, WFH, OD and leave are separate cards, so the cards never overlap.' + AVG_HELP, link: 'attendance', get: m => avgDay(m, t => t.present + t.late + t.short), extra: m => edSub(m, t => t.present + t.late + t.short), better: 'up' },
  { key: 'absent', label: 'Absent', unit: 'people / day', help: 'Employee-days marked absent on scheduled workdays.' + AVG_HELP, link: 'attendance', get: m => avgDay(m, t => t.absent), extra: m => edSub(m, t => t.absent), better: 'down' },
  { key: 'leave', label: 'On approved leave', unit: 'people / day', help: 'Employee-days recorded as leave on scheduled workdays.' + AVG_HELP, link: 'leave', get: m => avgDay(m, t => t.leave), extra: m => edSub(m, t => t.leave), better: 'neutral' },
  { key: 'half', label: 'Half-day', unit: 'people / day', help: 'Employee-days recorded as half-day.' + AVG_HELP, link: 'attendance', get: m => avgDay(m, t => t.half), extra: m => edSub(m, t => t.half), better: 'down' },
  { key: 'wfh', label: 'Approved WFH', unit: 'people / day', help: 'Employee-days recorded as work from home.' + AVG_HELP, link: 'attendance', get: m => avgDay(m, t => t.wfh), extra: m => edSub(m, t => t.wfh), better: 'neutral' },
  { key: 'od', label: 'Approved On Duty', unit: 'people / day', help: 'Employee-days recorded as on duty (client visits, field work).' + AVG_HELP, link: 'attendance', get: m => avgDay(m, t => t.od), extra: m => edSub(m, t => t.od), better: 'neutral' },
  { key: 'late', label: 'Late arrivals', unit: 'people / day', help: 'Employee-days with a late arrival beyond the shift grace period.' + AVG_HELP, link: 'attendance', get: m => avgDay(m, t => t.lateArrivals), extra: m => edSub(m, t => t.lateArrivals), better: 'down' },
  { key: 'missing', label: 'Missing / incomplete attendance', unit: 'people / day', help: 'Scheduled days with no record, plus past days with check-in but no check-out.' + AVG_HELP, link: 'exceptions', get: m => avgDay(m, t => t.missing + t.incomplete), extra: m => edSub(m, t => t.missing + t.incomplete), better: 'down' },
  { key: 'reg_pending', label: 'Pending regularisations', unit: 'requests', help: 'Requests submitted in the period that are still waiting for manager or HR (today\'s status).', link: 'regularisation', get: m => m.reg.counts.pending + m.reg.counts.awaitingHr, better: 'down' },
  { key: 'gp', label: 'Gate passes issued', unit: 'passes', help: 'Gate passes requested in the period (all statuses).', link: 'gatepass', get: m => m.gp.counts.total, better: 'neutral' },
  { key: 'gp_open', label: 'Gate passes open / overdue', unit: 'passes', help: 'Approved or departed passes with no return recorded; overdue = past expected return or from an earlier day.', link: 'gatepass', get: m => m.gp.counts.open, extra: (m) => `${m.gp.counts.overdue} overdue`, better: 'down' },
  { key: 'visitors', label: 'Visitors', unit: 'visitors', help: 'Visits (walk-in and pre-registered) in the period.', link: 'visitors', get: m => m.vs.counts.total, better: 'neutral' },
  { key: 'reimb', label: 'Reimbursement claims', unit: 'claims', help: 'Claims submitted in the period; the sub-line shows claims still awaiting approval.', link: 'reimbursements', get: m => m.rb.counts.claims, extra: (m) => `${m.rb.counts.outstandingClaims} awaiting approval`, better: 'neutral' },
];

function buildKpis(cur, prev) {
  return KPI_DEFS.map(d => {
    const v = d.get(cur, 'cur'), p = prev ? d.get(prev, 'prev') : null;
    return { key: d.key, label: d.label, unit: d.unit, help: d.help, link: d.link, better: d.better, value: v, prev: p, sub: d.extra ? d.extra(cur) : '', ...change(v, p) };
  });
}

// ── insights ──────────────────────────────────────────────────────────────
function buildInsights({ ctx, model, scope, period, cmp, cur, prev, noLeave, exceptions, today }) {
  const out = [];
  const add = (o) => out.push({ status: 'New', detected: today, owner: 'HR', ...o, key: `${o.rule}|${o.subject || ''}|${period.from}` });
  const chg = (c, p) => change(c, p);
  const A = cur.att.total, AP = prev?.att.total;
  if (A.missing > 0) {
    const depts = Object.entries(cur.att.perDept).filter(([, v]) => v.missing > 0).map(([k]) => k);
    add({ rule: 'missing_att', title: `${A.missing} scheduled employee-day(s) have no attendance record`, category: 'Attendance', severity: A.missing > 20 ? 'High' : 'Medium', dept: `${depts.length} department(s)`, current: A.missing, comparison: AP ? AP.missing : null, ...chg(A.missing, AP?.missing), evidence: Object.entries(cur.att.dateMissing).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${fmtD(d)}: ${n}`).join('; '), why: 'Employees were scheduled to work (shift, no holiday, no exemption) but no attendance row exists.', action: 'Reprocess attendance for the listed dates, then ask departments to regularise genuine gaps.', owner: 'HR Operations', drill: 'exceptions' });
  }
  if (cur.reg.backlogOverSla > 0) add({ rule: 'reg_sla', title: `${cur.reg.backlogOverSla} regularisation request(s) are past the ${ctx.cfg.regApprovalSlaDays}-day approval SLA`, category: 'Regularisation', severity: cur.reg.backlogOverSla > 10 ? 'High' : 'Medium', dept: 'All', current: cur.reg.backlogOverSla, comparison: null, abs: null, pct: null, evidence: cur.reg.managers.slice(0, 5).map(m => `${m.name}: ${m.pending} (${m.overSla} over SLA)`).join('; '), why: 'Requests have waited longer than the configured SLA.', action: 'Remind approvers; escalate requests older than a week.', owner: 'HR / Reporting managers', drill: 'regularisation' });
  const pendLong = cur.leaveD?.pendingLong?.length || 0;
  if (pendLong > 0) add({ rule: 'leave_pending', title: `${pendLong} leave request(s) pending for more than ${ctx.cfg.leavePendingDays} days`, category: 'Leave', severity: 'Medium', dept: 'All', current: pendLong, comparison: null, abs: null, pct: null, evidence: cur.leaveD.pendingLong.slice(0, 5).map(x => `${x.e?.name || '?'} (${x.age}d)`).join('; '), why: 'Leave applications are waiting on an approver.', action: 'Approve or reject so balances and attendance stay accurate.', owner: 'Reporting managers', drill: 'leave' });
  const gpo = cur.gp.counts.overdue;
  if (gpo > 0) add({ rule: 'gp_overdue', title: `${gpo} gate pass(es) remain open beyond the expected return`, category: 'Gate pass', severity: gpo > 5 ? 'High' : 'Medium', dept: 'All', current: gpo, comparison: prev?.gp.counts.overdue ?? null, ...chg(gpo, prev?.gp.counts.overdue), evidence: cur.gp.exceptions.filter(x => x.kind === 'Open beyond expected return').slice(0, 5).map(x => `${x.name} (${fmtD(x.date)})`).join('; '), why: 'Pass is approved/departed with no return event past the expected time or day.', action: 'Gate admin to verify and close the passes.', owner: 'Security / Gate admin', drill: 'gatepass' });
  // department compliance drops (enough sample, percentage points)
  if (prev) for (const [dp, v] of Object.entries(cur.att.perDept)) {
    const pv = prev.att.perDept[dp];
    if (!pv || v.sched < ctx.cfg.minSample || pv.sched < ctx.cfg.minSample) continue;
    const drop = (pv.rates.compliance ?? 0) - (v.rates.compliance ?? 0);
    if (drop >= ctx.cfg.complianceDropPp) add({ rule: 'compliance_drop', subject: dp, title: `${dp}: attendance compliance fell ${r1(drop)} points`, category: 'Attendance', severity: sevFor(drop / ctx.cfg.complianceDropPp), dept: dp, current: v.rates.compliance, comparison: pv.rates.compliance, abs: r1(-drop), pct: null, evidence: `Absent ${v.absent} vs ${pv.absent}; missing ${v.missing} vs ${pv.missing} employee-days.`, why: `Compliance (scheduled days not absent or missing) dropped by at least ${ctx.cfg.complianceDropPp} points on ≥${ctx.cfg.minSample} employee-days.`, action: 'Department head to review absences and missing records.', owner: 'Department head', drill: 'departments' });
  }
  // headcount vs vacancies
  for (const w of cur.wf.list) {
    const vac = cur.rc.byDept.find(x => x.dept === w.dept);
    if (vac && vac.open > 0 && w.net < 0) add({ rule: 'hc_decline', subject: w.dept, title: `${w.dept}: headcount fell by ${-w.net} while ${vac.open} position(s) remain open`, category: 'Workforce', severity: 'Medium', dept: w.dept, current: w.closing, comparison: w.opening, abs: w.net, pct: w.netPct, evidence: `Joinings ${w.joinings}, exits ${w.exits}; open requisitions ${vac.reqs}.`, why: 'Hiring has not kept pace with exits.', action: 'Prioritise offers and joining dates for this department.', owner: 'HR Recruitment', drill: 'workforce' });
  }
  const aged = cur.rc.rowsReq.filter(r => r.age > ctx.cfg.vacancyAgeDays && r.remaining > 0);
  if (aged.length) add({ rule: 'aged_vac', title: `${aged.length} requisition(s) open longer than ${ctx.cfg.vacancyAgeDays} days`, category: 'Recruitment', severity: aged.length > 10 ? 'High' : 'Medium', dept: [...new Set(aged.map(r => r.dept))].slice(0, 4).join(', '), current: aged.length, comparison: null, abs: null, pct: null, evidence: aged.slice(0, 5).map(r => `${r.title} (${r.dept}, ${r.age}d)`).join('; '), why: 'Vacancy ageing exceeds the configured threshold.', action: 'Review sourcing, interview feedback and offer turnaround.', owner: 'HR Recruitment', drill: 'workforce' });
  if (cur.rc.unapproved.length) add({ rule: 'req_unapproved', title: `${cur.rc.unapproved.length} published requisition(s) lack full approval`, category: 'Recruitment', severity: 'Medium', dept: 'All', current: cur.rc.unapproved.length, comparison: null, abs: null, pct: null, evidence: cur.rc.unapproved.slice(0, 5).map(r => r.position_title).join('; '), why: 'Manager and HR approval are not both recorded as approved.', action: 'Complete the approval workflow or unpublish.', owner: 'HR', drill: 'workforce' });
  // no-leave summary (90-day window)
  const nl = noLeave[90];
  if (nl && nl.total) {
    const consistent = nl.byClass['Consistently present'] || 0, review = nl.byClass['Requires review'] || 0, other = nl.total - consistent - review;
    add({ rule: 'no_leave', title: `${nl.total} employee(s) have no leave application in the last 90 days`, category: 'Leave', severity: 'Informational', dept: 'All', current: nl.total, comparison: null, abs: null, pct: null, evidence: `${consistent} consistently present; ${review} require review; ${other} explained by other patterns (WFH, OD, regularisation, missing records, new joiner).`, why: 'Absence of a leave request is not good or bad by itself — each case is classified from attendance evidence.', action: 'Look only at "Requires review" and "Absences without leave applications".', owner: 'HR', drill: 'leave' });
  }
  // top attendance exceptions
  const hi = exceptions.filter(x => SEV_RANK[x.sev] >= 4);
  if (hi.length) add({ rule: 'att_exc', title: `${hi.length} high-severity attendance exception(s) need verification`, category: 'Attendance', severity: 'High', dept: 'Various', current: hi.length, comparison: null, abs: null, pct: null, evidence: hi.slice(0, 4).map(x => `${x.type}: ${x.name || x.dept}`).join('; '), why: 'Observed values are at least twice the configured rule (and above the population outlier limit).', action: 'Verify with the reporting manager. These are indicators to check, not findings about conduct.', owner: 'HR', drill: 'exceptions' });
  const rb = cur.rb.counts;
  if (rb.outstandingClaims > 0) add({ rule: 'reimb_pending', title: `${rb.outstandingClaims} reimbursement claim(s) awaiting approval (₹${Math.round(rb.outstandingAmt).toLocaleString('en-IN')} outstanding)`, category: 'Reimbursement', severity: 'Low', dept: 'All', current: rb.outstandingClaims, comparison: null, abs: null, pct: null, evidence: cur.rb.issues.slice(0, 3).map(i => i.kind).join('; '), why: 'Claims submitted in the period have not been approved/paid.', action: 'Approvers and Finance to clear the queue.', owner: 'Finance', drill: 'reimbursements' });
  if (cur.vs.counts.missingCheckout > 0) add({ rule: 'visitor_open', title: `${cur.vs.counts.missingCheckout} visitor(s) never checked out`, category: 'Visitors', severity: 'Low', dept: 'All', current: cur.vs.counts.missingCheckout, comparison: null, abs: null, pct: null, evidence: cur.vs.issues.slice(0, 3).map(i => i.visitor).join('; '), why: 'Visitor record shows checked-in with no check-out.', action: 'Security to close the records.', owner: 'Security', drill: 'visitors' });
  // apply saved states
  const states = {}; for (const s of ctx.insightState) if (s.key) states[s.key] = s;
  for (const i of out) { const s = states[i.key]; if (s) { i.status = s.status || 'New'; i.note = s.note || ''; } }
  out.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
  return out;
}

// ── attendance exceptions ─────────────────────────────────────────────────
function attendanceExceptions(ctx, model, scope, attCur, attPrev, reg, from, to) {
  const cfg = ctx.cfg, days = diffDays(from, to) + 1, out = [];
  const add = (type, e, observed, baseline, ratio, why, verify, extra = {}) => out.push({ type, code: e?.code || '', name: e?.name || '', dept: e?.dept || extra.dept || '', period: `${fmtD(from)} – ${fmtD(to)}`, observed, baseline, variance: extra.variance ?? '', sev: sevFor(ratio), why, verify, dates: extra.dates || '' });
  const absentVals = [], lateVals = [], regVals = [];
  for (const [u, p] of attCur.perEmp) { absentVals.push(p.unexplainedAbsent.length); lateVals.push(p.lateDates.length); regVals.push(reg.perEmp[u] || 0); }
  const absLim = outlierLimit(absentVals, scaled(cfg.absentRepeat, days), cfg), lateLim = outlierLimit(lateVals, scaled(cfg.lateRepeat, days), cfg), regLim = outlierLimit(regVals, scaled(cfg.regularisationRepeat, days), cfg);
  const deptMedian = {}; for (const [dp] of Object.entries(attCur.perDept)) deptMedian[dp] = median([...attCur.perEmp.values()].filter(x => x.e.dept === dp).map(x => x.lateDates.length));
  for (const [u, p] of attCur.perEmp) {
    const e = p.e;
    const n = p.unexplainedAbsent.length; if (n >= absLim) add('Repeated unexplained absence', e, `${n} day(s)`, `Rule ${scaled(cfg.absentRepeat, days)}; population median ${median(absentVals)}`, n / absLim, 'Absent on scheduled days with no approved leave or regularisation.', 'Confirm with the manager; apply leave or regularise if the absence was informed.', { dates: p.unexplainedAbsent.slice(0, 8).map(fmtD).join(', ') });
    const l = p.lateDates.length; if (l >= lateLim) add('Frequent late arrival', e, `${l} late`, `Rule ${scaled(cfg.lateRepeat, days)}; dept median ${deptMedian[e.dept] ?? 0}`, l / lateLim, 'Late arrivals beyond the shift grace period.', 'Check shift timing, commute / approved flexibility, and whether grace rules apply.', { dates: p.lateDates.slice(0, 8).map(fmtD).join(', ') });
    const r = reg.perEmp[u] || 0; if (r >= regLim) add('High regularisation requests', e, `${r} request(s)`, `Rule ${scaled(cfg.regularisationRepeat, days)}`, r / regLim, 'Repeated attendance corrections.', 'Check punch device access / biometric enrolment before treating as a pattern.');
    if (p.incompleteDates.length >= 2) add('Incomplete punch sessions', e, `${p.incompleteDates.length} day(s)`, '0 expected', p.incompleteDates.length / 2, 'Check-in without a matching check-out.', 'Ask the employee to regularise; check device sync.', { dates: p.incompleteDates.slice(0, 8).map(fmtD).join(', ') });
    if (p.missingDates.length >= 2) add('Attendance missing on scheduled days', e, `${p.missingDates.length} day(s)`, '0 expected', p.missingDates.length / 2, 'No attendance row although the employee was scheduled.', 'Reprocess attendance for these dates; verify the shift assignment.', { dates: p.missingDates.slice(0, 8).map(fmtD).join(', ') });
    if (p.lowHoursDates.length >= 2) add('Implausibly low working hours', e, `${p.lowHoursDates.length} day(s) under ${cfg.hoursLow} h`, `At least ${cfg.hoursLow} h`, p.lowHoursDates.length / 2, 'Recorded hours are far below a working day although marked present.', 'Check punch gaps (device offline, forgotten punch).', { dates: p.lowHoursDates.slice(0, 8).map(fmtD).join(', ') });
    if (p.highHoursDates.length >= 2) add('Unusually high working hours', e, `${p.highHoursDates.length} day(s) over ${cfg.hoursHigh} h`, `At most ${cfg.hoursHigh} h`, p.highHoursDates.length / 2, 'Recorded hours are unusually long; often a missed check-out.', 'Check for a forgotten punch-out or an overnight shift.', { dates: p.highHoursDates.slice(0, 8).map(fmtD).join(', ') });
    if (p.acc.biometricGap >= 2) add('Biometric punches but final status absent', e, `${p.acc.biometricGap} day(s)`, '0 expected', p.acc.biometricGap / 2, 'Raw punches exist yet the final status is absent.', 'Reprocess the day; check shift/overnight handling.');
  }
  for (const cf of attCur.conflicts.slice(0, 200)) out.push({ type: 'Conflict: ' + cf.kind, code: cf.e.code, name: cf.e.name, dept: cf.e.dept, period: fmtD(cf.date), observed: cf.att, baseline: cf.other, variance: '', sev: 'Low', why: 'Attendance and the leave record disagree for the same day.', verify: 'Correct whichever record is wrong.', dates: fmtD(cf.date) });
  // concentration of missing records on one date
  const total = attCur.total.sched / Math.max(days, 1);
  for (const [d, n] of Object.entries(attCur.dateMissing)) if (n >= Math.max(5, cfg.missingDateShare * total)) out.push({ type: 'Missing attendance concentrated on one date', code: '', name: '', dept: 'Company', period: fmtD(d), observed: `${n} employees`, baseline: `Under ${Math.max(5, Math.round(cfg.missingDateShare * total))}`, variance: '', sev: sevFor(n / Math.max(5, cfg.missingDateShare * total)), why: 'Many employees lack a record on the same date — usually a processing or device issue, not individual behaviour.', verify: 'Check attendance sync for that day.', dates: fmtD(d) });
  // department compliance change
  if (attPrev) for (const [dp, v] of Object.entries(attCur.perDept)) {
    const pv = attPrev.perDept[dp];
    if (!pv || v.sched < cfg.minSample || pv.sched < cfg.minSample) continue;
    const drop = (pv.rates.compliance ?? 0) - (v.rates.compliance ?? 0);
    if (drop >= cfg.complianceDropPp) out.push({ type: 'Department compliance dropped', code: '', name: '', dept: dp, period: `${fmtD(from)} – ${fmtD(to)}`, observed: `${v.rates.compliance}%`, baseline: `${pv.rates.compliance}% previous`, variance: `-${r1(drop)} pts`, sev: sevFor(drop / cfg.complianceDropPp), why: 'Share of scheduled days that were neither absent nor missing fell noticeably.', verify: 'Department head to review.', dates: '' });
  }
  out.sort((a, b) => (SEV_RANK[b.sev] || 0) - (SEV_RANK[a.sev] || 0));
  return out;
}

// ── main entry ────────────────────────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL = 60 * 1000;

export async function loadConfig() {
  try {
    const rows = parseRows(await all("SELECT id, data, created_at FROM entities WHERE type='MisConfig' LIMIT 1"));
    return { ...DEFAULT_CFG, ...(rows[0]?.cfg || {}) };
  } catch { return { ...DEFAULT_CFG }; }
}

export async function runAnalytics(params, user, { restrictUids = null, fresh = false } = {}) {
  const cfg = await loadConfig();
  const today = istDate();
  const key = JSON.stringify([params, user?.id, restrictUids ? [...restrictUids].sort().join(',') : '']);
  const hit = CACHE.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL) return hit.result;

  let period = resolvePeriod(params);
  // working-day helper needs holidays/shifts, which are loaded below; first build a throwaway context-free guess
  // first pass: decide comparison (the "previous working day" needs the calendar)
  const calCtx = await loadCalendarOnly();
  let cmpRaw = resolveCompare(period, params, { isWorkingDay: (d) => calCtx.isWorkingDay(d) });
  const ap = applyElapsed(period, cmpRaw, today);
  period = ap.period; const cmp = ap.cmp;
  const from = period.from, to = period.to;
  const attFrom = [cmp?.from || from, from, addDays(to, -179)].reduce((a, b) => (a < b ? a : b));
  const ctx = await loadContext({ cfg, rangeFrom: from, rangeTo: to, attFrom });
  const model = buildModel(ctx);
  const scope = makeScope(model, params.filters || {}, restrictUids); scope.filters = params.filters || {};

  const cur = coreMetrics(ctx, model, scope, from, to, today);
  const prev = cmp ? coreMetrics(ctx, model, scope, cmp.from, cmp.to, today) : null;
  if (prev) prev.snap = snapshotNear(ctx.snapshots, cmp.to, 7);
  // detail passes for the current period only
  const attD = computeAttendance(ctx, model, scope, from, to, today, { detail: true });
  const regD = computeRegularisation(ctx, model, scope, from, to, today, { detail: true });
  const leaveD = computeLeave(ctx, model, scope, from, to, today, { detail: true });
  const leavePrev = prev ? prev.lv : null;
  const gpD = computeGatePasses(ctx, model, scope, from, to, today, attD, { detail: true });
  const vsD = computeVisitors(ctx, model, scope, from, to, today);
  cur.att = attD; cur.reg = regD; cur.lv = leaveD; cur.leaveD = leaveD; cur.gp = gpD; cur.vs = vsD;
  const noLeave = computeNoLeave(ctx, model, scope, to, today);
  const patterns = leavePatterns(ctx, model, scope, from, to, today, leaveD, leavePrev, attD);
  const exceptions = attendanceExceptions(ctx, model, scope, attD, prev?.att, regD, from, to);
  const kpis = buildKpis(cur, prev);
  const insights = buildInsights({ ctx, model, scope, period, cmp, cur, prev, noLeave, exceptions, today });
  const dq = computeDataQuality(ctx, model, scope, today, attD, cur.wf);

  // department summary
  const deptNames = [...new Set([...ctx.depts.map(d => d.name), ...Object.keys(attD.perDept), ...cur.wf.list.map(x => x.dept), 'Unassigned'])].filter(Boolean);
  const departments = deptNames.map(dp => {
    const a = attD.perDept[dp] || newAcc(), w = cur.wf.list.find(x => x.dept === dp), rc = cur.rc.byDept.find(x => x.dept === dp);
    const head = model.emps.find(e => e.dept === dp && /head|hod|director|general manager|vp/i.test(e.designation) && !e.separated);
    const lvDays = leaveD.byDept[dp] || 0;
    const headcount = w?.closing ?? 0;
    return {
      dept: dp, head: head?.name || '', transfersIn: w?.transfersIn ?? null, transfersOut: w?.transfersOut ?? null, opening: w?.opening ?? 0, closing: headcount, joinings: w?.joinings ?? 0, exits: w?.exits ?? 0, net: w?.net ?? 0,
      openVacancies: rc?.open ?? 0, present: a.present + a.late + a.short + a.half, absent: a.absent, leave: a.leave, half: a.half, wfh: a.wfh, od: a.od, late: a.lateArrivals,
      regularisations: regD.perDept[dp] || 0, missing: a.missing + a.incomplete, compliance: a.sched ? rates(a).compliance : null, physical: a.sched ? rates(a).physical : null,
      leaveDays: r1(lvDays), leavePerHead: headcount ? r2(lvDays / headcount) : null, gatePasses: gpD.counts.byDept[dp] || 0,
      pendingApprovals: regD.backlog.filter(r => (model.byUid[r.user_id]?.dept || 'Unassigned') === dp).length,
      reqPositions: rc?.positions ?? null, reimbClaims: cur.rb.counts.byDept[dp]?.n || 0, reimbPending: Math.round(cur.rb.counts.byDept[dp]?.pendingAmt || 0), sched: a.sched,
    };
  }).filter(d => d.closing || d.sched || d.openVacancies || d.gatePasses || d.reimbClaims).sort((a, b) => b.closing - a.closing);

  const limitations = [
    ...(cur.wf.transfers.available ? [`Department transfers are tracked since ${fmtD(cur.wf.transfers.trackedSince)}; department history before that date uses each employee's department as it was first recorded.`]
      : cur.wf.transfers.partial ? [`Department transfers are tracked only since ${fmtD(cur.wf.transfers.trackedSince)}, part-way through this period — earlier moves inside the period are not visible, so department headcount for those days may be off.`]
      : ['Department transfers were not recorded before tracking began (first nightly snapshot pending), so transfers show as unavailable and department history uses each employee\'s CURRENT department.']),
    'Sanctioned positions and budgeted headcount are not stored; "approved positions" come only from requisitions.',
    ...(ctx.snapshots?.length ? [`Open-vacancy and offer comparisons come from nightly snapshots (first snapshot ${fmtD(ctx.snapshots.map(x => x.date).sort()[0])}); periods before that have no comparison.`] : ['Vacancy and offer history is captured by a nightly snapshot that has not run yet, so those figures are snapshots of today with no period comparison.']),
    ...(cur.rc.timing.trackedSince ? [`Time-to-fill / time-to-hire use only requisitions closed and candidates moved since tracking began (${fmtD(cur.rc.timing.trackedSince)}) — small samples are shown with their size.`] : ['Time-to-fill / time-to-hire need requisition closure dates and candidate stage dates, which are only recorded from now on.']),
    'Reporting-manager history is not stored; the reporting manager is taken as it is now.',
    'Leave balances are shown as stored — allocation rules differ by policy, so utilisation against entitlement is indicative.',
    'Calendar quarters (Jan–Mar …) are used for quarterly periods.',
  ];
  if (period.elapsed) limitations.unshift(`The selected period has not finished: figures cover ${fmtD(from)} to ${fmtD(to)} (elapsed days only) and the comparison is cut to the same number of days.`);

  const registers = {
    regularisation: regD.rows, gatepass: gpD.rows, gatepass_exceptions: gpD.exceptions, leave: leaveD.rows, exceptions, leave_patterns: patterns,
    vacancies: cur.rc.rowsReq, visitors: vsD.rows, reimbursements: cur.rb.rows, reimbursement_issues: cur.rb.issues, visitor_issues: vsD.issues, data_quality: dq.flatMap(d => d.samples.map(s => ({ check: d.title, record: s, source: d.source }))),
    attendance_days: attD.dayRows, new_requisitions: cur.rc.newReqList, new_candidates: cur.rc.newCandList,
    transfers: cur.wf.transferList.map(t => ({ code: t.e.code, name: t.e.name, from: t.from, to: t.to, date: t.at })),
    joiners: cur.wf.joinList.map(e => ({ code: e.code, name: e.name, dept: e.dept, designation: e.designation, date: e.doj, location: e.loc })),
    exits: cur.wf.exitList.map(e => ({ code: e.code, name: e.name, dept: e.dept, designation: e.designation, date: e.lwd })),
    employees_attendance: [...attD.perEmp.values()].map(p => ({ code: p.e.code, name: p.e.name, dept: p.e.dept, designation: p.e.designation, scheduled: p.acc.sched, present: p.acc.present, late: p.acc.late, short: p.acc.short, half: p.acc.half, wfh: p.acc.wfh, od: p.acc.od, leave: p.acc.leave, absent: p.acc.absent, missing: p.acc.missing, incomplete: p.acc.incomplete, lateArrivals: p.acc.lateArrivals, hours: r1(p.acc.hoursMins / 60), physicalPct: rates(p.acc).physical, compliancePct: rates(p.acc).compliance })),
  };
  for (const w of cfg.noLeaveWindows) registers[`no_leave_${w}`] = noLeave[w].rows;

  const result = {
    meta: {
      generatedAt: new Date().toISOString(), today, period: { ...period }, compare: cmp, config: cfg,
      employeesInScope: scope.scopeEmps.filter(e => model.activeOn(e, to) && !e.separated).length,
      attendanceEmployees: attD.perEmp.size,
      workingCalendar: { scheduledEmployeeDays: attD.total.sched, holidays: model.holidayList.filter(h => h.date >= from && h.date <= to).map(h => ({ date: h.date, name: h.name })), defaultShift: model.defaultShift ? { name: model.defaultShift.name, days: model.defaultShift.days } : null },
      filters: params.filters || {},
      filterOptions: {
        departments: deptNames.filter(Boolean).sort(), locations: [...new Set(model.emps.map(e => e.loc).filter(Boolean))].sort(), categories: [...new Set(model.emps.map(e => e.empType).filter(Boolean))].sort(),
        employmentStatuses: [...new Set(model.emps.map(e => e.empStatus).filter(Boolean))].sort(), designations: [...new Set(model.emps.map(e => e.designation).filter(Boolean))].sort(),
        managers: [...new Set(model.emps.map(e => e.mgr).filter(Boolean))].map(id => ({ id, name: model.byUid[id]?.name || id })).sort((a, b) => a.name.localeCompare(b.name)),
      },
      scoped: !!restrictUids,
    },
    kpis,
    attendance: {
      total: { ...attD.total, physicalDays: r1(physicalDays(attD.total)), avgHours: attD.total.hoursDays ? r2(attD.total.hoursMins / 60 / attD.total.hoursDays) : null },
      prevTotal: prev ? { ...prev.att.total } : null,
      trend: attD.perDay.map(d => ({ date: d.date, present: d.present + d.late + d.short, half: d.half, wfh: d.wfh, od: d.od, leave: d.leave, absent: d.absent, missing: d.missing, late: d.lateArrivals, sched: d.sched, compliance: d.rates.compliance, physical: d.rates.physical })),
      byDept: Object.entries(attD.perDept).map(([dp, v]) => ({ dept: dp, ...v })),
      people: peopleView(attD, prev?.att),
      exceptions: exceptions.slice(0, 100), exceptionCount: exceptions.length,
      conflictCount: attD.conflicts.length, dateMissing: attD.dateMissing,
    },
    regularisation: { counts: regD.counts, prev: prev?.reg.counts || null, backlog: regD.backlogCount, backlogOverSla: regD.backlogOverSla, managers: regD.managers.slice(0, 15), byDept: regD.perDept },
    leave: { counts: leaveD.counts, prev: prev?.lv.counts || null, byType: leaveD.byType, byDept: leaveD.byDept, trend: leaveD.trend, balances: leaveD.balances, pendingLong: leaveD.pendingLong.slice(0, 20).map(x => ({ name: x.e?.name || '', dept: x.e?.dept || '', age: x.age })), patterns: patterns.slice(0, 100), patternCount: patterns.length,
      noLeave: Object.fromEntries(cfg.noLeaveWindows.map(w => [w, { window: w, from: noLeave[w].from, to: noLeave[w].to, total: noLeave[w].total, byClass: noLeave[w].byClass, sample: noLeave[w].rows.filter(r => r.class === 'Requires review' || r.class === 'Absences without leave applications').slice(0, 25) }])) },
    workforce: { composition: computeComposition(ctx, model, scope, to, today), company: cur.wf.company, prevCompany: prev?.wf.company || null, transfers: { ...cur.wf.transfers, count: cur.wf.company.transfers, rows: cur.wf.transferList.slice(0, 50).map(t => ({ code: t.e.code, name: t.e.name, from: t.from, to: t.to, date: t.at })) }, timing: cur.rc.timing, departments: cur.wf.list, openingDate: cur.wf.openingDate, recruitment: { counts: cur.rc.counts, openVacancies: cur.rc.openVacancies, openReqs: cur.rc.openReqs, byDept: cur.rc.byDept, funnel: cur.rc.funnel, stage: cur.rc.stage, offers: { released: cur.rc.offersReleased, accepted: cur.rc.offersAccepted, declined: cur.rc.offersDeclined }, ageing: cur.rc.rowsReq.slice(0, 50), unapproved: cur.rc.unapproved.length, stale: cur.rc.rowsReq.filter(r => r.remaining > 0 && (!r.lastActivity || diffDays(r.lastActivity, today) > cfg.reqStaleDays)).length }, unavailable: { transfers: !cur.wf.transfers.available && !cur.wf.transfers.partial, sanctioned: true, timeToFill: !cur.rc.timing.timeToFill } },
    gatepass: { counts: gpD.counts, prev: prev?.gp.counts || null, exceptions: gpD.exceptions.slice(0, 100), exceptionCount: gpD.exceptions.length },
    visitors: { counts: vsD.counts, prev: prev?.vs.counts || null, issues: vsD.issues.slice(0, 30) },
    reimbursements: { counts: cur.rb.counts, prev: prev?.rb.counts || null, issues: cur.rb.issues.slice(0, 50) },
    departments, insights, dataQuality: dq, limitations,
    reconciliation: reconcile(attD, cur, departments),
    _registers: registers, _cfgKeys: Object.keys(cfg),
  };
  if (CACHE.size > 40) CACHE.clear();
  CACHE.set(key, { at: Date.now(), result });
  return result;
}

// nearest nightly snapshot on/before `date` (and not older than maxAge days) — vacancy / offer history exists only from when snapshots began
function snapshotNear(snapshots, date, maxAge) {
  const ok = (snapshots || []).filter(x => x.date <= date && diffDays(x.date, date) <= maxAge).sort((a, b) => b.date.localeCompare(a.date));
  return ok[0] || null;
}

function reconcile(attD, cur, departments) {
  const t = attD.total;
  const catSum = t.present + t.late + t.short + t.half + t.wfh + t.od + t.leave + t.absent + t.missing;
  const deptSched = departments.reduce((s, d) => s + d.sched, 0);
  const dayTotal = attD.perDay.reduce((s, d) => s + d.sched, 0);
  const deptClosing = departments.reduce((s, d) => s + d.closing, 0);
  return [
    { check: 'Attendance categories add up to scheduled employee-days', ok: catSum === t.sched, detail: `${catSum} vs ${t.sched}` },
    { check: 'Daily totals add up to period total', ok: dayTotal === t.sched, detail: `${dayTotal} vs ${t.sched}` },
    { check: 'Department totals add up to period total', ok: deptSched === t.sched, detail: `${deptSched} vs ${t.sched}` },
    { check: 'Closing = opening + joinings − exits (company)', ok: cur.wf.company.reconciles, detail: `${cur.wf.company.opening} + ${cur.wf.company.joinings} − ${cur.wf.company.exits} vs ${cur.wf.company.closing}` },
    { check: 'Department closing headcount adds up to company', ok: deptClosing === cur.wf.company.closing, detail: `${deptClosing} vs ${cur.wf.company.closing}` },
    { check: 'Every department reconciles', ok: cur.wf.list.every(r => r.reconciles), detail: cur.wf.list.filter(r => !r.reconciles).map(r => r.dept).join(', ') || 'All reconcile' },
  ];
}

// Working-day calendar only (holidays + default shift) — used to find the "previous working day" before the heavy load.
async function loadCalendarOnly() {
  const [holidays, shifts] = await Promise.all([loadType('Holiday'), loadType('Shift')]);
  const def = shifts.find(s => s.is_default);
  const days = new Set(Array.isArray(def?.days) && def.days.length ? def.days : DAY_NAMES.filter(n => n !== 'Sunday'));
  const hol = new Set(holidays.filter(h => h.date && !(h.applicable_departments || []).length && !h.is_half_day && h.is_working_day !== true).map(h => dayOf(h.date)));
  return { isWorkingDay: (d) => days.has(DAY_NAMES[dow(d)]) && !hol.has(d) };
}

export async function getRegister(result, kind, { page = 1, pageSize = 50, q = '', sort = '', dir = 'asc' } = {}) {
  let rows = result._registers[kind];
  if (!rows) return null;
  if (q) { const s = String(q).toLowerCase(); rows = rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(s))); }
  if (sort && rows.length && sort in rows[0]) rows = [...rows].sort((a, b) => (a[sort] > b[sort] ? 1 : a[sort] < b[sort] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  const total = rows.length, ps = Math.min(Math.max(Number(pageSize) || 50, 1), 500), p = Math.max(Number(page) || 1, 1);
  return { kind, total, page: p, pageSize: ps, rows: rows.slice((p - 1) * ps, p * ps) };
}

export function stripPrivate(result) { const { _registers, _cfgKeys, ...rest } = result; return rest; }
export { SEV_RANK, buildModel, makeScope };
