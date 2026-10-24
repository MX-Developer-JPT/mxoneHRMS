// Intelligent MIS — formula, boundary, duplicate, status-transition and comparison tests.
// Pure synthetic data: no database is touched.
// Run: node backend/tests/misAnalytics.test.mjs
import assert from 'node:assert/strict';
const cal = await import('../utils/mis/calendar.js');
const A = await import('../utils/mis/analytics.js');
const { resolvePeriod, resolveCompare, applyElapsed, change, minusYear } = cal;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

// ── periods & comparison ──
t('weekly period is Monday-Sunday', () => { const p = resolvePeriod({ preset: 'weekly', anchor: '2026-10-21' }); assert.equal(p.from, '2026-10-19'); assert.equal(p.to, '2026-10-25'); });
t('monthly period handles leap February', () => { const p = resolvePeriod({ preset: 'monthly', anchor: '2028-02-10' }); assert.equal(p.to, '2028-02-29'); });
t('quarter boundaries', () => { const p = resolvePeriod({ preset: 'quarterly', anchor: '2026-08-05' }); assert.deepEqual([p.from, p.to], ['2026-07-01', '2026-09-30']); const c = resolveCompare(p, { compare: 'previous' }); assert.deepEqual([c.from, c.to], ['2026-04-01', '2026-06-30']); });
t('previous month crosses the year', () => { const c = resolveCompare(resolvePeriod({ preset: 'monthly', anchor: '2026-01-20' }), { compare: 'previous' }); assert.deepEqual([c.from, c.to], ['2025-12-01', '2025-12-31']); });
t('previous working day skips Sunday and holidays', () => {
  const off = new Set(['2026-10-18', '2026-10-20']); // Sunday + holiday
  const c = resolveCompare(resolvePeriod({ preset: 'daily', anchor: '2026-10-21' }), { compare: 'previous' }, { isWorkingDay: (d) => !off.has(d) });
  assert.equal(c.from, '2026-10-19');
});
t('same period last year, 29 Feb', () => { assert.equal(minusYear('2028-02-29'), '2027-02-28'); const c = resolveCompare(resolvePeriod({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' }), { compare: 'last_year' }); assert.deepEqual([c.from, c.to], ['2025-03-01', '2025-03-31']); });
t('custom comparison and none', () => { const p = resolvePeriod({ preset: 'weekly', anchor: '2026-10-21' }); assert.equal(resolveCompare(p, { compare: 'none' }), null); const c = resolveCompare(p, { compare: 'custom', compareFrom: '2026-01-01', compareTo: '2026-01-07' }); assert.equal(c.to, '2026-01-07'); });
t('partial period compares equal elapsed days', () => {
  const p = resolvePeriod({ preset: 'monthly', anchor: '2026-10-10' }); const c = resolveCompare(p, { compare: 'previous' });
  const r = applyElapsed(p, c, '2026-10-10');
  assert.equal(r.period.to, '2026-10-10'); assert.equal(r.period.elapsed, true); assert.equal(r.cmp.to, '2026-09-10');
});
t('change(): zero base, tiny base, normal, missing', () => {
  assert.equal(change(5, 0).pct, null); assert.match(change(5, 0).note, /New/); assert.equal(change(0, 0).note, 'No change');
  assert.equal(change(423, 1).pct, null); assert.match(change(423, 1).note, /not meaningful/);
  assert.equal(change(110, 100).pct, 10); assert.equal(change(90, 100).dir, 'down'); assert.equal(change(5, null).dir, 'na');
});

// ── synthetic company ──
const emp = (o) => ({ id: o.uid, user_id: o.uid, employee_code: o.uid.toUpperCase(), display_name: o.uid, department: 'Ops', designation: 'Exec', date_of_joining: '2025-01-01', status: 'active', employee_status: 'confirmation', ...o });
const att = (rows) => { const map = new Map(); const dupes = []; for (const r of rows) { const k = `${r.u}|${r.d}`; if (map.has(k)) dupes.push(k); map.set(k, { s: r.s, ci: r.ci || null, co: r.co || null, mins: r.mins || 0, la: !!r.la, lid: null, lhd: false, pc: r.pc || 0, src: '', ip: !!r.ip }); } return { map, dupes }; };
const shift = { id: 's1', name: 'First', is_default: true, days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const mkCtx = (o = {}) => ({
  cfg: { ...A.DEFAULT_CFG }, employees: [], depts: [{ name: 'Ops' }], shifts: [shift], holidays: [], leaves: [], policies: [{ id: 'p1', name: 'Casual Leave' }], balances: [], regs: [], gps: [], visitors: [], reqs: [], cands: [], interviews: [], reimbs: [], exits: [], insightState: [],
  att: att([]), transfers: [], snapshots: [], ...o,
});
const prep = (ctx, filters = {}) => { const model = A.buildModel(ctx); const scope = A.makeScope(model, filters, null); scope.filters = filters; return { model, scope }; };
const TODAY = '2026-10-31';
// week 19–24 Oct 2026 (Mon–Sat) + Sunday 25
const W = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];

t('attendance categories are counted once per scheduled day and reconcile', () => {
  const ctx = mkCtx({
    employees: [emp({ uid: 'a' }), emp({ uid: 'x', is_attendance_exempt: true }), emp({ uid: 'n', date_of_joining: '2026-10-22' })],
    holidays: [{ id: 'h1', date: '2026-10-20', name: 'Dussehra', applicable_departments: [] }],
    leaves: [{ id: 'l1', user_id: 'a', status: 'approved', start_date: '2026-10-21', end_date: '2026-10-21', total_days: 1, applied_on: '2026-10-15T00:00:00Z', leave_policy_id: 'p1' }],
    att: att([
      { u: 'a', d: '2026-10-19', s: 'present', ci: 'x', co: 'y', mins: 540 }, { u: 'a', d: '2026-10-20', s: 'present' }, // holiday → ignored
      { u: 'a', d: '2026-10-21', s: 'leave' }, { u: 'a', d: '2026-10-22', s: 'absent' }, /* 23 missing */ { u: 'a', d: '2026-10-24', s: 'work_from_home' },
      { u: 'a', d: '2026-10-25', s: 'present' },                       // Sunday work → off-day work, not counted
      { u: 'x', d: '2026-10-19', s: 'present' },                       // exempt → ignored
      { u: 'n', d: '2026-10-20', s: 'absent' },                        // before joining + holiday → ignored
      { u: 'n', d: '2026-10-23', s: 'late', la: true, ci: 'x', co: 'y', mins: 480 }, { u: 'n', d: '2026-10-24', s: 'half_day' },
    ]),
  });
  const { model, scope } = prep(ctx);
  const r = A.computeAttendance(ctx, model, scope, '2026-10-19', '2026-10-25', TODAY);
  const T = r.total;
  assert.equal(T.present, 1); assert.equal(T.late, 1); assert.equal(T.half, 1); assert.equal(T.wfh, 1); assert.equal(T.leave, 1); assert.equal(T.absent, 1); assert.equal(T.missing, 1 + 1 /* n: 22 missing */);
  assert.equal(T.offdayWork, 2); // work on the holiday (20 Oct) and on the Sunday
  // a: Mon Wed Thu Fri Sat = 5 scheduled ; n: Thu Fri Sat = 3  → 8
  assert.equal(T.sched, 8);
  assert.equal(T.present + T.late + T.short + T.half + T.wfh + T.od + T.leave + T.absent + T.missing, T.sched);
  assert.equal(T.rates.physical, Math.round(((1 + 1 + 0.5) / 8) * 1000) / 10);
  assert.equal(T.rates.compliance, Math.round(((8 - 1 - 2) / 8) * 1000) / 10);
  assert.equal(T.lateArrivals, 1);
  // per-day totals add up
  assert.equal(r.perDay.reduce((s, d) => s + d.sched, 0), T.sched);
});
t('leave counts as leave, never as physical presence', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], att: att(W.map(d => ({ u: 'a', d, s: 'leave' }))) });
  const { model, scope } = prep(ctx); const r = A.computeAttendance(ctx, model, scope, W[0], W[5], TODAY);
  assert.equal(r.total.rates.physical, 0); assert.equal(r.total.rates.compliance, 100); assert.equal(r.total.leave, 6);
});
t('future days and today without a record are not missing', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })] });
  const { model, scope } = prep(ctx);
  const r = A.computeAttendance(ctx, model, scope, '2026-10-30', '2026-11-02', '2026-10-31');
  assert.equal(r.total.missing, 1); // Fri 30 Oct only; Sat 31 = today (pending), Mon 2 Nov = future
  assert.equal(r.total.pending, 1);
});
t('a past day left in-progress is incomplete, not silently present', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], att: att([{ u: 'a', d: '2026-10-19', s: 'in_progress', ip: true, mins: 0 }, { u: 'a', d: '2026-10-21', s: 'in_progress', ip: true, mins: 300 }]) });
  const { model, scope } = prep(ctx); const r = A.computeAttendance(ctx, model, scope, '2026-10-19', '2026-10-21', TODAY);
  assert.equal(r.total.incomplete, 2); assert.equal(r.total.absent, 1); assert.equal(r.total.present, 1);
});
t('duplicate attendance rows count once and are reported', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], att: att([{ u: 'a', d: '2026-10-19', s: 'absent' }, { u: 'a', d: '2026-10-19', s: 'present' }]) });
  assert.equal(ctx.att.dupes.length, 1);
  const { model, scope } = prep(ctx); const r = A.computeAttendance(ctx, model, scope, '2026-10-19', '2026-10-19', TODAY);
  assert.equal(r.total.sched, 1); assert.equal(r.total.present, 1);
});
t('overnight shift employee: working days follow the shift, not the clock', () => {
  const night = { id: 's2', name: 'Night', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };
  const ctx = mkCtx({ shifts: [shift, night], employees: [emp({ uid: 'a', shift_id: 's2' })], att: att([{ u: 'a', d: '2026-10-24', s: 'present' }]) });
  const { model, scope } = prep(ctx); const r = A.computeAttendance(ctx, model, scope, '2026-10-19', '2026-10-25', TODAY);
  assert.equal(r.total.sched, 5); assert.equal(r.total.offdayWork, 1); // Saturday is this shift's weekly off
});
t('cancelled / rejected leave does not explain an absence; approved does', () => {
  const lv = (id, st, d) => ({ id, user_id: 'a', status: st, start_date: d, end_date: d, total_days: 1, applied_on: '2026-10-10T00:00:00Z', leave_policy_id: 'p1' });
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], leaves: [lv('1', 'cancelled', '2026-10-19'), lv('2', 'rejected', '2026-10-20'), lv('3', 'approved', '2026-10-21')], att: att([{ u: 'a', d: '2026-10-19', s: 'absent' }, { u: 'a', d: '2026-10-21', s: 'absent' }, { u: 'a', d: '2026-10-22', s: 'absent' }]) });
  const { model, scope } = prep(ctx); const r = A.computeAttendance(ctx, model, scope, '2026-10-19', '2026-10-22', TODAY, { detail: true });
  assert.deepEqual(r.perEmp.get('a').unexplainedAbsent, ['2026-10-19', '2026-10-22']);
  assert.ok(r.conflicts.some(c => c.date === '2026-10-21' && /Absent although leave is approved/.test(c.kind)));
});
t('leave days are counted by days inside the period, half-day = 0.5, weekly offs skipped', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], leaves: [
    { id: '1', user_id: 'a', status: 'approved', start_date: '2026-10-23', end_date: '2026-10-27', total_days: 4, applied_on: '2026-10-19T04:00:00Z', leave_policy_id: 'p1' }, // Fri Sat Sun Mon Tue
    { id: '2', user_id: 'a', status: 'approved', half_day: true, start_date: '2026-10-21', end_date: '2026-10-21', total_days: 0.5, applied_on: '2026-10-19T04:00:00Z', leave_policy_id: 'p1' },
    { id: '3', user_id: 'a', status: 'pending', start_date: '2026-10-22', end_date: '2026-10-22', total_days: 1, applied_on: '2026-10-19T04:00:00Z', leave_policy_id: 'p1' },
  ] });
  const { model, scope } = prep(ctx); const lv = A.computeLeave(ctx, model, scope, '2026-10-19', '2026-10-25', TODAY);
  assert.equal(lv.counts.approvedDays, 2.5); // Fri + Sat + ½ ; Sunday is a weekly off
  assert.equal(lv.counts.requests, 3); assert.equal(lv.counts.pending, 1); assert.equal(lv.byType['Casual Leave'], 2.5);
});
t('short-notice leave is detected', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], leaves: [{ id: '1', user_id: 'a', status: 'approved', start_date: '2026-10-21', end_date: '2026-10-21', total_days: 1, applied_on: '2026-10-21T04:00:00Z', leave_policy_id: 'p1' }] });
  const { model, scope } = prep(ctx); const lv = A.computeLeave(ctx, model, scope, '2026-10-19', '2026-10-25', TODAY);
  assert.equal(lv.counts.shortNotice, 1);
});

// ── no-leave classification ──
t('employees with no leave application are classified from evidence', () => {
  const days = []; for (let d = new Date('2026-09-02T00:00:00Z'); d <= new Date('2026-10-31T00:00:00Z'); d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10));
  const rows = (u, fn) => days.map(d => fn(d)).filter(Boolean).map(s => ({ u, d: s.d, s: s.s, ...s.x }));
  const sat = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const mk = (u, status) => rows(u, (d) => (sat(d) === 0 ? null : { d, s: typeof status === 'function' ? status(d) : status, x: { ci: 'x', co: 'y', mins: 540 } }));
  const ctx = mkCtx({
    employees: [emp({ uid: 'good' }), emp({ uid: 'wfh' }), emp({ uid: 'od' }), emp({ uid: 'abs' }), emp({ uid: 'newj', date_of_joining: '2026-10-25' }), emp({ uid: 'exm', is_attendance_exempt: true }), emp({ uid: 'reg' })],
    regs: Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, user_id: 'reg', status: 'completed', attendance_date: '2026-10-0' + (i + 1), audit_log: [{ timestamp: '2026-10-1' + i + 'T05:00:00Z' }], _createdAt: '2026-10-10T00:00:00Z' })),
    att: { map: new Map(), dupes: [] },
  });
  for (const r of [...mk('good', 'present'), ...mk('wfh', 'work_from_home'), ...mk('od', 'on_duty'), ...mk('abs', (d) => (d === '2026-10-14' ? 'absent' : 'present')), ...mk('reg', 'present')]) ctx.att.map.set(`${r.u}|${r.d}`, { s: r.s, ci: 'x', co: 'y', mins: 540, la: false, lid: null, lhd: false, pc: 0, src: '', ip: false });
  const { model, scope } = prep(ctx);
  const res = A.computeNoLeave(ctx, model, scope, TODAY, TODAY);
  const by = Object.fromEntries(res[30].rows.map(r => [r.uid, r.class]));
  assert.equal(by.good, 'Consistently present'); assert.equal(by.wfh, 'Regularly on approved WFH'); assert.equal(by.od, 'Frequently on approved OD');
  assert.equal(by.abs, 'Absences without leave applications'); assert.equal(by.newj, 'New joiner (insufficient history)'); assert.equal(by.exm, 'Special work arrangement'); assert.equal(by.reg, 'Attendance frequently regularised');
  // an employee who DID apply is not listed
  ctx.leaves.push({ id: 'z', user_id: 'good', status: 'rejected', start_date: '2026-10-05', end_date: '2026-10-05', total_days: 1, applied_on: '2026-10-04T00:00:00Z' });
  const res2 = A.computeNoLeave(ctx, model, scope, TODAY, TODAY);
  assert.ok(!res2[30].rows.some(r => r.uid === 'good'));
});

// ── workforce reconciliation ──
t('headcount reconciles: joiners, leavers, join-and-leave inside the period, boundary days', () => {
  const ctx = mkCtx({ employees: [
    emp({ uid: 'stay' }),
    emp({ uid: 'join', date_of_joining: '2026-10-10' }),
    emp({ uid: 'left', status: 'resigned', exit_date: '2026-10-14' }),                                  // exits in period
    emp({ uid: 'lastday', status: 'resigned', exit_date: '2026-10-31' }),                               // last working day = period end → still counted at close, exit next period
    emp({ uid: 'before', status: 'resigned', exit_date: '2026-09-29' }),                                // gone before the period
    emp({ uid: 'joinleave', date_of_joining: '2026-10-05', status: 'resigned', exit_date: '2026-10-20' }),
    emp({ uid: 'firstday', status: 'resigned', exit_date: '2026-09-30' }),                              // lwd = day before period start → exits in this period
    emp({ uid: 'nodate', status: 'resigned' }),                                                         // no usable date → excluded, flagged
  ] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  assert.equal(w.company.joinings, 2);
  assert.equal(w.company.exits, 3);                                                                       // left, joinleave, firstday
  assert.equal(w.company.opening + w.company.joinings - w.company.exits, w.company.closing);
  assert.equal(w.company.reconciles, true);
  assert.equal(w.company.closing, 3);                                                                     // stay, join, lastday
  const dq = A.computeDataQuality(ctx, model, scope, TODAY, A.computeAttendance(ctx, model, scope, '2026-10-01', '2026-10-31', TODAY), w);
  assert.equal(dq.find(d => d.key === 'no_exit_date').count, 1);
});
t('department moves are not company joinings/exits: totals equal the sum of departments', () => {
  const ctx = mkCtx({ depts: [{ name: 'Ops' }, { name: 'HR' }], employees: [emp({ uid: 'a' }), emp({ uid: 'b', department: 'HR' }), emp({ uid: 'c', department: 'HR', date_of_joining: '2026-10-03' })] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  assert.equal(w.list.reduce((s, r) => s + r.closing, 0), w.company.closing); assert.ok(w.list.every(r => r.transfersIn === null));
});

// ── transfers (department history) ──
const tfr = (uid, from, to, at, source = 'recorded') => ({ id: uid + at, user_id: uid, from_department: from, to_department: to, effective_date: at, source, recorded_at: at + 'T05:00:00Z' });
t('transfer inside the period: department opening/closing follow the history and reconcile', () => {
  const ctx = mkCtx({ depts: [{ name: 'Ops' }, { name: 'HR' }], snapshots: [{ date: '2026-09-01' }], employees: [emp({ uid: 'a', department: 'HR' }), emp({ uid: 'b' })], transfers: [tfr('a', 'Ops', 'HR', '2026-10-15')] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  const ops = w.list.find(r => r.dept === 'Ops'), hr = w.list.find(r => r.dept === 'HR');
  assert.deepEqual([ops.opening, ops.closing, ops.transfersOut, ops.transfersIn], [2, 1, 1, 0]);
  assert.deepEqual([hr.opening, hr.closing, hr.transfersOut, hr.transfersIn], [0, 1, 0, 1]);
  assert.ok(ops.reconciles && hr.reconciles && w.company.reconciles);
  assert.equal(w.company.joinings, 0); assert.equal(w.company.exits, 0);          // a move is not a joining or an exit
  assert.equal(w.transfers.available, true);
});
t('transfer before the period is history, not a movement in it', () => {
  const ctx = mkCtx({ depts: [{ name: 'Ops' }, { name: 'HR' }], snapshots: [{ date: '2026-08-01' }], employees: [emp({ uid: 'a', department: 'HR' })], transfers: [tfr('a', 'Ops', 'HR', '2026-09-10')] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  assert.equal(w.list.find(r => r.dept === 'HR').opening, 1); assert.equal(w.company.transfers, 0);
  const past = A.computeWorkforce(ctx, model, scope, '2026-08-01', '2026-08-31');       // back then the employee was in Ops
  assert.equal(past.list.find(r => r.dept === 'Ops').closing, 1); assert.equal(past.list.find(r => r.dept === 'HR'), undefined);
});
t('joined in one department, moved later in the same period', () => {
  const ctx = mkCtx({ depts: [{ name: 'Ops' }, { name: 'HR' }], snapshots: [{ date: '2026-09-01' }], employees: [emp({ uid: 'a', department: 'HR', date_of_joining: '2026-10-05' })], transfers: [tfr('a', 'Ops', 'HR', '2026-10-20')] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  assert.equal(w.list.find(r => r.dept === 'Ops').joinings, 1); assert.equal(w.list.find(r => r.dept === 'HR').closing, 1);
  assert.ok(w.list.every(r => r.reconciles) && w.company.reconciles);
});
t('without any tracking, transfers are unavailable (null), not zero', () => {
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  assert.equal(w.transfers.available, false); assert.equal(w.transfers.trackedSince, null); assert.equal(w.list[0].transfersIn, null);
});
t('tracking that starts part-way through the period is flagged partial', () => {
  const ctx = mkCtx({ snapshots: [{ date: '2026-10-12' }], employees: [emp({ uid: 'a' })] });
  const { model, scope } = prep(ctx);
  const w = A.computeWorkforce(ctx, model, scope, '2026-10-01', '2026-10-31');
  assert.equal(w.transfers.partial, true); assert.equal(w.transfers.available, false);
});

// ── time to fill / hire from recorded dates ──
t('time-to-fill and time-to-hire use only recorded closure / stage dates', () => {
  const ctx = mkCtx({
    reqs: [
      { id: 'r1', position_title: 'A', department: 'Ops', number_of_positions: 1, status: 'closed', created_at: '2026-09-01T00:00:00Z', closed_date: '2026-09-21T00:00:00Z', closed_reason: 'filled' },
      { id: 'r2', position_title: 'B', department: 'Ops', number_of_positions: 1, status: 'closed', created_at: '2026-09-01T00:00:00Z', closed_date: '2026-10-11T00:00:00Z', closed_reason: 'filled' },
      { id: 'r3', position_title: 'C', department: 'Ops', number_of_positions: 1, status: 'closed', created_at: '2026-09-01T00:00:00Z', closed_date: '2026-10-05T00:00:00Z', closed_reason: 'closed' },
      { id: 'r4', position_title: 'D', department: 'Ops', number_of_positions: 1, status: 'closed', created_at: '2026-01-01T00:00:00Z' },                                     // closed before tracking: no date → excluded
    ],
    cands: [{ id: 'c1', job_id: 'r1', status: 'joined', applied_date: '2026-09-01', status_history: [{ status: 'applied', at: '2026-09-01T00:00:00Z', source: 'applied_date' }, { status: 'offered', at: '2026-09-11T00:00:00Z', source: 'edit' }, { status: 'joined', at: '2026-09-21T00:00:00Z', source: 'edit' }] }],
  });
  const { model, scope } = prep(ctx);
  const rc = A.computeRecruitment(ctx, model, scope, '2026-10-01', '2026-10-31', TODAY);
  assert.equal(rc.timing.timeToFill.n, 2); assert.equal(rc.timing.timeToFill.avgDays, 30);   // (20 + 40) / 2
  assert.equal(rc.timing.timeToFill.inPeriodN, 1); assert.equal(rc.timing.timeToFill.inPeriodAvg, 40);
  assert.equal(rc.timing.timeToHire.avgDays, 20); assert.equal(rc.timing.timeToOffer.avgDays, 10);
  assert.equal(rc.timing.cancelledOrClosedUnfilled, 1);
  assert.deepEqual(rc.timing.stageEvents, {});                                                  // the September stage moves are outside October
  const empty = A.computeRecruitment(mkCtx({ reqs: [{ id: 'x', status: 'closed', number_of_positions: 1 }] }), model, scope, '2026-10-01', '2026-10-31', TODAY);
  assert.equal(empty.timing.timeToFill, null);                                                   // nothing recorded → unavailable, never 0
});

// ── recruitment / vacancies ──
t('open vacancies come from positions and joined candidates, not requisitions minus joinings', () => {
  const ctx = mkCtx({
    reqs: [{ id: 'r1', position_title: 'Eng', department: 'Ops', number_of_positions: 3, status: 'published', created_at: '2026-08-01T00:00:00Z', manager_approval_status: 'approved', hr_approval_status: 'approved' }, { id: 'r2', position_title: 'Old', department: 'Ops', number_of_positions: 2, status: 'closed', created_at: '2026-07-01T00:00:00Z' }],
    cands: [{ id: 'c1', job_id: 'r1', status: 'joined', applied_date: '2026-09-01' }, { id: 'c2', job_id: 'r1', status: 'offer_accepted', applied_date: '2026-09-02' }, { id: 'c3', job_id: 'r1', status: 'rejected', applied_date: '2026-09-02' }, { id: 'c4', job_id: 'r2', status: 'joined', applied_date: '2026-08-02' }],
    employees: [emp({ uid: 'a', date_of_joining: '2026-10-01' }), emp({ uid: 'b', date_of_joining: '2026-10-02' }), emp({ uid: 'c', date_of_joining: '2026-10-03' })],
  });
  const { model, scope } = prep(ctx);
  const rc = A.computeRecruitment(ctx, model, scope, '2026-10-01', '2026-10-31', TODAY);
  assert.equal(rc.openVacancies, 2);          // 3 positions − 1 joined (3 employees joined in the month is irrelevant)
  assert.equal(rc.openReqs, 1); assert.equal(rc.offersAccepted, 1); assert.equal(rc.rowsReq[0].remaining, 2); assert.equal(rc.rowsReq[0].approved, true);
});

// ── gate passes ──
t('gate pass overdue, auto-closed duration and invalid transitions', () => {
  const g = (o) => ({ id: o.id + '-00000000', user_id: 'a', employee_user_id: 'a', outing_type: 'official_outing', request_date: '2026-10-30', manager_approval_status: 'approved', _createdAt: '2026-10-30T05:00:00Z', ...o });
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], gps: [
    g({ id: 'open', status: 'departed', departure_time: '2026-10-30T05:00:00Z' }),                                                    // still out from yesterday → overdue
    g({ id: 'ok', status: 'returned', departure_time: '2026-10-30T05:00:00Z', return_time: '2026-10-30T06:30:00Z' }),                  // 90 min
    g({ id: 'auto', status: 'auto_closed', auto_closed: true, departure_time: '2026-10-30T05:00:00Z', return_time: '2026-10-30T12:30:00Z' }),
    g({ id: 'bad', status: 'returned', manager_approval_status: 'pending' }),                                                         // returned w/o approval & timestamps
    g({ id: 'noMove', status: 'approved' }),                                                                                          // approved, no movement, earlier day
  ] });
  const { model, scope } = prep(ctx);
  const r = A.computeGatePasses(ctx, model, scope, '2026-10-30', '2026-10-31', '2026-10-31', null, { detail: true });
  const c = r.counts;
  assert.equal(c.total, 5); assert.equal(c.returned, 2); assert.equal(c.autoClosed, 1); assert.equal(c.open, 2); assert.equal(c.overdue, 2);
  assert.equal(c.avgDurationMin, 90); assert.equal(c.durationSample, 1);                                                              // the auto-closed pass is not a real duration
  const kinds = r.exceptions.map(e => e.kind);
  assert.ok(kinds.includes('Open beyond expected return')); assert.ok(kinds.includes('Inconsistent status transition')); assert.ok(kinds.includes('Missing exit or return timestamp')); assert.ok(kinds.includes('Approved without a movement event'));
});

// ── reimbursements ──
t('approved is not paid; duplicates are flagged for review', () => {
  const rb = (o) => ({ user_id: 'a', expense_type: 'travel', expense_date: '2026-10-10', submitted_at: '2026-10-11T00:00:00Z', _createdAt: '2026-10-11T00:00:00Z', ...o });
  const ctx = mkCtx({ employees: [emp({ uid: 'a' })], reimbs: [rb({ id: '1', amount: 100, status: 'paid', approved_date: '2026-10-12T00:00:00Z', hr_approved_by: 'h' }), rb({ id: '2', amount: 200, status: 'approved', hr_approved_by: 'h', approved_date: '2026-10-12T00:00:00Z', expense_date: '2026-10-09' }), rb({ id: '3', amount: 300, status: 'pending', expense_date: '2026-10-08' }), rb({ id: '4', amount: 300, status: 'pending', expense_date: '2026-10-08' }), rb({ id: '5', amount: 50, status: 'rejected', expense_date: '2026-10-07' })] });
  const { model, scope } = prep(ctx);
  const r = A.computeReimbursements(ctx, model, scope, '2026-10-01', '2026-10-31', TODAY);
  const c = r.counts;
  assert.equal(c.claims, 5); assert.equal(c.paid, 1); assert.equal(c.approved, 2); assert.equal(c.paidAmt, 100); assert.equal(c.approvedAmt, 300);
  assert.equal(c.outstandingAmt, 200 + 300 + 300);                                                                                    // approved-not-paid + both pending; rejected excluded
  assert.ok(r.issues.some(i => i.kind === 'Possible duplicate claim')); assert.ok(r.issues.some(i => i.kind === 'Repeated pending claims'));
});

// ── regularisation ──
t('regularisation counts by submission, SLA backlog, late requests', () => {
  const rg = (o) => ({ user_id: 'a', attendance_date: '2026-10-01', audit_log: [{ timestamp: o.sub }], _createdAt: o.sub, ...o });
  const ctx = mkCtx({ employees: [emp({ uid: 'a', reporting_manager_id: 'm' }), emp({ uid: 'm' })], regs: [
    rg({ id: '1', status: 'completed', sub: '2026-10-05T05:00:00Z', hr_approved_at: '2026-10-05T11:00:00Z' }),                       // 6 h
    rg({ id: '2', status: 'pending', sub: '2026-10-20T05:00:00Z', manager_id: 'm' }),                                                 // 11 days old → over SLA
    rg({ id: '3', status: 'rejected', sub: '2026-10-25T05:00:00Z', attendance_date: '2026-10-24' }),
    rg({ id: '4', status: 'completed', sub: '2026-09-28T05:00:00Z' }),                                                                // outside the period
  ] });
  const { model, scope } = prep(ctx);
  const r = A.computeRegularisation(ctx, model, scope, '2026-10-01', '2026-10-31', TODAY, { detail: true });
  assert.equal(r.counts.total, 3); assert.equal(r.counts.approved, 1); assert.equal(r.counts.pending, 1); assert.equal(r.counts.rejected, 1);
  assert.equal(r.counts.avgApprovalHours, 6); assert.equal(r.counts.late, 1); assert.equal(r.backlogOverSla, 1);
});

// ── filters ──
t('department filter limits employees and transactions', () => {
  const ctx = mkCtx({ depts: [{ name: 'Ops' }, { name: 'HR' }], employees: [emp({ uid: 'a' }), emp({ uid: 'b', department: 'HR' })], att: att([{ u: 'a', d: '2026-10-19', s: 'present' }, { u: 'b', d: '2026-10-19', s: 'absent' }]) });
  const { model, scope } = prep(ctx, { department: 'HR' });
  const r = A.computeAttendance(ctx, model, scope, '2026-10-19', '2026-10-19', TODAY);
  assert.equal(r.total.sched, 1); assert.equal(r.total.absent, 1); assert.equal(r.total.present, 0);
});

console.log(`\n${n} MIS tests passed`);
process.exit(0);
