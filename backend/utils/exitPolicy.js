// Business rules for resignation and exit — one place, pure functions (no database), so the same numbers are used by the
// resignation form, HR's approval, the full-and-final draft and the tests.
//
// Rules in short
//  • The notice period comes from the employee's contract (Employee.notice_period_days) or, if none is recorded, from the company
//    policy by grade / employment type. It is never taken from the browser.
//  • The resignation date is the day it is submitted. The standard last working day is that date + the notice days.
//  • A last working day earlier than standard leaves a shortfall. The shortfall is recovered in the full and final settlement,
//    less any days the company waives (HR decides when approving) or buys out (HR approves a buy-out request).
//  • Full and final: pay for the days worked in the last month, leave encashment, gratuity (5 completed years, 15/26 of basic per
//    year, capped), minus notice recovery, loan / advance outstanding, and statutory deductions on the earned amount.

export const EXIT_DEFAULTS = {
  notice_default_days: 30,       // confirmed / regular staff
  notice_senior_days: 90,        // grade contains senior / lead / manager
  notice_contract_days: 15,      // contract and intern
  max_notice_days: 180,          // the longest last working day we accept from a resignation
  manager_decision_days: 3,      // the reporting manager has this long, then HR is told and may decide
  hr_decision_days: 2,           // HR has this long after the manager decides, then it is flagged
  gratuity_min_years: 5,
  gratuity_cap: 2000000,
  leave_encashment_enabled: true,
  enforce_fnf_segregation: true, // the person who prepares the settlement cannot also verify / approve it
  require_exit_interview: true,
  notice_day_mode: 'calendar',   // calendar | working (working days skip weekly offs and holidays)
  approval_hod_enabled: true,    // reporting manager -> HOD -> HR (the HOD step is left out when there is no separate HOD)
  management_grades: '',         // comma separated; a resignation from these grades also needs management approval
  management_departments: '',
  management_designations: '',   // matches if the designation contains any of these words
  retention_enabled: true,
  access_items: [
    { key: 'email', label: 'Official email deactivation' }, { key: 'maxvolt_one', label: 'MaxVolt One account deactivation' }, { key: 'crm_lms', label: 'CRM / LMS access revocation' },
    { key: 'erp', label: 'ERP / application access revocation' }, { key: 'vpn_cloud', label: 'VPN / cloud access revocation' }, { key: 'other', label: 'Other company systems' },
  ],
  doc_templates: {},   // only the templates HR has changed; the rest use the built-in wording
  reasons: [
    { key: 'better_career_opportunity', label: 'Better Career Opportunity' }, { key: 'higher_studies', label: 'Higher Studies' },
    { key: 'personal_reasons', label: 'Personal Reasons' }, { key: 'health_reasons', label: 'Health Reasons' }, { key: 'relocation', label: 'Relocation' },
    { key: 'compensation_benefits', label: 'Compensation / Benefits' }, { key: 'work_environment', label: 'Work Environment' }, { key: 'career_change', label: 'Career Change' },
    { key: 'family_commitments', label: 'Family Commitments' }, { key: 'retirement', label: 'Retirement' }, { key: 'other', label: 'Other', remarks_required: true },
  ],
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v) => YMD.test(String(v || ''));
export const addDaysYmd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const diffDaysYmd = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);   // b − a
export const daysInMonthOf = (ymd) => { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const istToday = (ms = Date.now()) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

export function mergeCfg(stored = {}) {
  const out = { ...EXIT_DEFAULTS };
  for (const k of Object.keys(EXIT_DEFAULTS)) {
    const v = stored[k], d = EXIT_DEFAULTS[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof d === 'boolean') out[k] = v !== false && v !== 'false';
    else if (Array.isArray(d)) { if (Array.isArray(v) && v.length) out[k] = v; }
    else if (typeof d === 'string') out[k] = String(v);
    else if (typeof d === 'object') { if (v && typeof v === 'object') out[k] = v; }
    else out[k] = Number(v) || d;
  }
  return out;
}

/** Notice days that apply to this employee. */
export function noticeDaysFor(emp = {}, cfg = EXIT_DEFAULTS) {
  const contractual = parseInt(emp.notice_period_days, 10);
  if (contractual > 0) return { days: contractual, source: 'Employee contract' };
  const grade = String(emp.employee_grade || emp.grade || '').toLowerCase();
  const type = String(emp.employment_type || '').toLowerCase();
  if (/senior|lead|manager|head|director|vp/.test(grade)) return { days: cfg.notice_senior_days, source: 'Company policy — senior grade' };
  if (/contract|intern|trainee/.test(type)) return { days: cfg.notice_contract_days, source: 'Company policy — contract / intern' };
  return { days: cfg.notice_default_days, source: 'Company policy' };
}

/** Check a resignation before it is created. Returns the figures the form shows and the errors that block it. */
export function evaluateResignation({ today, proposedLastDay, noticeDays, buyoutRequested = false, buyoutDays = 0, cfg = EXIT_DEFAULTS, standardLwd: standardOverride = '' }) {
  const errors = [];
  const resignationDate = today;
  const standardLwd = standardOverride || addDaysYmd(resignationDate, noticeDays);
  if (!isYmd(proposedLastDay)) errors.push('Enter the last working day you are proposing.');
  else {
    if (proposedLastDay < today) errors.push('The last working day cannot be in the past.');
    if (diffDaysYmd(today, proposedLastDay) > cfg.max_notice_days) errors.push(`The last working day cannot be more than ${cfg.max_notice_days} days from today.`);
  }
  const served = isYmd(proposedLastDay) ? diffDaysYmd(resignationDate, proposedLastDay) : noticeDays;
  const shortfall = isYmd(proposedLastDay) && proposedLastDay >= standardLwd ? 0 : Math.max(0, noticeDays - served);
  let buyout = 0;
  if (buyoutRequested) {
    if (shortfall <= 0) errors.push('A notice buy-out is only needed when the last working day is earlier than the notice period.');
    buyout = Math.min(shortfall, Math.max(0, Math.round(Number(buyoutDays) || shortfall)));
  }
  return { ok: errors.length === 0, errors, resignationDate, standardLwd, noticeDays, noticeServedDays: Math.max(0, served), shortfallDays: shortfall, buyoutDays: buyout };
}

/** Days of shortfall the employee still owes after the company waives or buys out some. */
export function recoverableShortfall({ noticeDays, lwd, resignationDate, waivedDays = 0, buyoutApprovedDays = 0 }) {
  const served = Math.max(0, diffDaysYmd(resignationDate, lwd));
  const short = Math.max(0, noticeDays - served);
  return { shortfall: short, recoverable: Math.max(0, short - Math.max(0, Number(waivedDays) || 0)), waived: Math.min(short, Math.max(0, Number(waivedDays) || 0)), buyoutCovered: Math.min(short, Math.max(0, Number(buyoutApprovedDays) || 0)) };
}

/** Whole years of service for gratuity: completed years, a part-year of more than six months counts as a full year. */
export function gratuityYears(doj, lwd) {
  if (!isYmd(doj) || !isYmd(lwd)) return { years: 0, completed: 0, days: 0 };
  const days = diffDaysYmd(doj, lwd) + 1;
  const completed = Math.floor(days / 365.25);
  const rem = days - completed * 365.25;
  return { years: rem > 182.6 ? completed + 1 : completed, completed, days };
}

/** A first full-and-final draft from the employee's records. HR reviews and changes every figure before it is prepared. */
export function draftFnF({ lwd, doj, salary = {}, earnedLeaveDays = 0, loanOutstanding = 0, noticeRecoveryDays = 0, pfCeiling = 25000, cfg = EXIT_DEFAULTS, exitType = 'resignation', alreadyPaidDays = 0 }) {
  const basic = Number(salary.basic) || 0, hra = Number(salary.hra) || 0, special = Number(salary.special) || 0, conveyance = Number(salary.conveyance) || 0;
  const other = Number(salary.other) || 0;
  const gross = basic + hra + special + conveyance + other;
  const totalDays = isYmd(lwd) ? daysInMonthOf(lwd) : 30;
  const lwdDay = isYmd(lwd) ? Number(lwd.slice(8, 10)) : totalDays;
  const paidDays = Math.max(0, lwdDay - Math.max(0, alreadyPaidDays));
  const ratio = totalDays > 0 ? paidDays / totalDays : 0;
  const earnedGross = Math.round(gross * ratio);
  const perDay = gross > 0 ? gross / 30 : 0;
  const notes = [];

  // statutory deductions on what is earned this month
  const pfBase = Math.min(basic, pfCeiling);
  const epf = Math.round(pfBase * 0.12 * ratio);
  const esi = gross > 0 && gross <= 21000 ? Math.round(earnedGross * 0.0075) : 0;

  const notice = Math.round(Math.max(0, noticeRecoveryDays) * perDay);
  if (noticeRecoveryDays > 0) notes.push(`Notice recovery: ${noticeRecoveryDays} day(s) × ₹${Math.round(perDay).toLocaleString('en-IN')} (monthly gross ÷ 30).`);

  const leaveDays = cfg.leave_encashment_enabled && exitType !== 'termination_for_cause' ? Math.max(0, Number(earnedLeaveDays) || 0) : 0;
  const leaveAmount = Math.round(leaveDays * (gross > 0 ? gross / 26 : 0));
  if (leaveDays) notes.push(`Leave encashment: ${leaveDays} day(s) of earned leave × ₹${Math.round(gross / 26).toLocaleString('en-IN')} (monthly gross ÷ 26).`);

  const g = gratuityYears(doj, lwd);
  const gratuityEligible = g.years >= cfg.gratuity_min_years;   // a part-year over six months counts as a year (Payment of Gratuity Act)
  const gratuityAmount = gratuityEligible ? Math.min(cfg.gratuity_cap, Math.round(basic * 15 / 26 * g.years)) : 0;
  notes.push(gratuityEligible ? `Gratuity: ${g.years} year(s) × 15/26 of basic ₹${basic.toLocaleString('en-IN')} (cap ₹${cfg.gratuity_cap.toLocaleString('en-IN')}).` : `Gratuity: not eligible (${g.completed} completed year(s); ${cfg.gratuity_min_years} needed).`);
  if (loanOutstanding > 0) notes.push(`Loan / advance outstanding ₹${Math.round(loanOutstanding).toLocaleString('en-IN')} is recovered from the settlement.`);

  return {
    total_days_in_month: totalDays, paid_days: paidDays,
    earnings: { basic_salary: { actual: basic }, hra: { actual: hra }, special_allowances: { actual: special }, conveyance: { actual: conveyance }, gwi: { actual: 0 }, others: { actual: other } },
    deductions: { epf, esi, medical_insurance: 0, tax: 0, advance: Math.round(loanOutstanding), notice_period: notice, paid_amount: 0 },
    other_earnings: { bonus: { eligibility_period: '', amount: 0 }, gratuity: { years: gratuityEligible ? g.years : g.completed, amount: gratuityAmount }, leave_encashment: { days: leaveDays, amount: leaveAmount }, ot: 0, others: 0 },
    gratuity_eligible: gratuityEligible, years_of_service: g.completed, gross_monthly: gross, per_day: Math.round(perDay), notes,
  };
}

/** Segregation of duties for the settlement: who prepared, verified and approved must be different people. */
export function segregationProblem(fnf = {}, actorId, step, cfg = EXIT_DEFAULTS) {
  if (!cfg.enforce_fnf_segregation) return '';
  if (step === 'verify' && fnf.prepared_by_id && fnf.prepared_by_id === actorId) return 'The person who prepared the settlement cannot also verify it — ask another HR user to verify.';
  if (step === 'approve' && actorId && (fnf.prepared_by_id === actorId || fnf.verified_by_id === actorId)) return 'The person who prepared or verified the settlement cannot also approve it — ask a different approver.';
  return '';
}

/** What must be true before HR can close the case. Returns the list of blockers. */
export function closeBlockers({ exit, cfg = EXIT_DEFAULTS, wf = {}, today, allCleared, loanOutstanding = 0 }) {
  const out = [];
  const pendingAccess = (exit.access_checklist || []).filter((i) => i.key !== 'maxvolt_one' && i.status === 'pending');
  if (pendingAccess.length) out.push(`system access must be revoked or marked not applicable (${pendingAccess.map((i) => i.label).join(', ')})`);
  if (!allCleared) out.push('all mandatory department clearances must be Cleared');
  if (wf.require_employee_declaration && !exit.declaration_signed_at) out.push('the employee must sign the exit declaration');
  if (cfg.require_exit_interview && !exit.exit_interview_completed) out.push('the exit interview must be completed (or skipped by HR with a reason)');
  if (!exit.no_dues_generated) out.push('the No Dues Certificate must be generated');
  if (!exit.fnf_data?.employee_accepted) out.push('the employee must accept the F&F settlement');
  if (!exit.fnf_data?.finance_processed_by_id) out.push('Finance must process the F&F payment');
  if (isYmd(exit.last_working_date) && isYmd(today) && exit.last_working_date > today) out.push(`the last working day (${exit.last_working_date}) has not been reached`);
  const recovered = Number(exit.fnf_data?.deductions?.advance) || 0;
  if (loanOutstanding > 0 && recovered + 0.5 < loanOutstanding) out.push(`a loan / advance of ₹${Math.round(loanOutstanding).toLocaleString('en-IN')} is outstanding but only ₹${recovered.toLocaleString('en-IN')} is recovered in the settlement`);
  return out;
}

/** Employee status the record takes once the case closes. */
export function leftStatusFor(exitType) {
  const t = String(exitType || '').toLowerCase();
  if (/terminat|dismiss|abscond/.test(t)) return 'terminated';
  if (/retire/.test(t)) return 'retired';
  return 'resigned';
}

/** Whether an Exit PATCH from the generic API only touches fields that are safe to edit by hand. */
export const EXIT_HAND_EDITABLE = ['hr_exit_interview', 'hr_interview_completed', 'hr_notes', 'audit_log'];
export function exitPatchProblem(current = {}, body = {}) {
  for (const k of Object.keys(body)) {
    if (k === 'id' || k === 'updated_at' || k === 'created_at' || k === 'updated_date' || k === 'created_date') continue;
    if (!EXIT_HAND_EDITABLE.includes(k)) return `"${k}" can only be changed through the exit workflow`;
  }
  if (body.audit_log !== undefined) {
    const cur = current.audit_log || [], next = body.audit_log;
    if (!Array.isArray(next) || next.length < cur.length || cur.some((c, i) => JSON.stringify(c) !== JSON.stringify(next[i]))) return 'The audit log can only be added to';
  }
  return '';
}

// ── approval chain, status model, reference numbers, notice calendar ────────────────────────────────────────────────────────
const csv = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Whether this employee's resignation also needs management approval under the configured conditions. */
export function needsManagement(emp = {}, cfg = EXIT_DEFAULTS) {
  const g = csv(cfg.management_grades), d = csv(cfg.management_departments), w = csv(cfg.management_designations);
  const grade = String(emp.employee_grade || emp.grade || '').toLowerCase(), dept = String(emp.department || '').toLowerCase(), des = String(emp.designation || '').toLowerCase();
  return !!((g.length && g.includes(grade)) || (d.length && d.includes(dept)) || (w.length && w.some((x) => des.includes(x))));
}

/** Stages a resignation goes through, in order. A stage with nobody to act is left out so a case never waits for nobody. */
export function buildApprovalChain({ emp, managerOk, hodOk, cfg = EXIT_DEFAULTS }) {
  const chain = [];
  if (managerOk) chain.push('manager');
  if (cfg.approval_hod_enabled && hodOk) chain.push('hod');
  chain.push('hr');
  if (needsManagement(emp, cfg)) chain.push('management');
  return chain;
}

/** The stage waiting now (the first one not yet approved), or '' when the chain is finished. */
export const currentStageOf = (exit) => ((exit.approval_stages || []).find((s) => s.status === 'pending') || {}).stage || '';
export const STAGE_LABEL = { manager: 'Reporting Manager', hod: 'HOD', hr: 'HR', management: 'Management' };

/** One label per case for lists, badges and the register (the stored status keeps the machine states the workflow uses). */
export function displayStatus(exit = {}) {
  const s = exit.status;
  const retention = (exit.retention?.discussions || []).length > 0 && exit.retention?.status === 'open';
  if (s === 'withdrawn') return 'Withdrawn';
  if (s === 'cancelled') return exit.cancel_reason === 'retained' ? 'Retained' : 'Cancelled';
  if (['manager_rejected', 'hr_rejected'].includes(s)) return 'Rejected';
  if (s === 'completed') return 'Exit Completed';
  if (exit.withdrawal_request?.status === 'pending') return 'Withdrawal Pending Approval';
  if (retention && ['submitted', 'manager_approved'].includes(s)) return 'Under Retention Discussion';
  if (s === 'submitted' || s === 'manager_approved') { const st = currentStageOf(exit) || 'manager'; return `Pending with ${STAGE_LABEL[st] || st}`; }
  if (s === 'in_notice') return exit.notice_shortfall_days > 0 && exit.notice_waived_days >= exit.notice_shortfall_days ? 'Notice Period Waived' : 'Notice Period';
  if (s === 'clearance_pending') return 'Exit Clearance Pending';
  if (s === 'clearance_done' || String(s).startsWith('fnf_')) return 'F&F Pending';
  return s || 'Submitted';
}

/** Next resignation reference number: EXT-<year>-<4 digit running number>. */
export function nextExitRef(existing = [], year = new Date().getUTCFullYear()) {
  const prefix = `EXT-${year}-`;
  const max = existing.filter((r) => String(r || '').startsWith(prefix)).reduce((m, r) => Math.max(m, parseInt(String(r).slice(prefix.length), 10) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Last working day for a notice period. Working-day mode counts only days that are not weekly offs or holidays. */
export function lastDayFor(resignationDate, days, { mode = 'calendar', weeklyOff = [0], holidays = [] } = {}) {
  if (mode !== 'working') return addDaysYmd(resignationDate, days);
  const hol = new Set(holidays), off = new Set(weeklyOff);
  let d = resignationDate, left = days;
  for (let guard = 0; left > 0 && guard < 800; guard++) {
    d = addDaysYmd(d, 1);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (!off.has(dow) && !hol.has(d)) left--;
  }
  return d;
}

// ── register labels and dashboard analytics (pure — the screens and the tests use the same numbers) ───────────────────────────
export function fnfStatusLabel(exit = {}) {
  const s = exit.status;
  if (s === 'completed') return 'Completed';
  if (exit.fnf_meta?.on_hold) return 'On Hold';
  return ({ fnf_prepared: 'Pending with HR', fnf_verified: 'Under Verification', fnf_hr_approved: 'Pending with Finance', fnf_finance_processed: 'Paid', fnf_employee_accepted: 'Paid' })[s] || 'Not Initiated';
}
export function clearanceSummary(exit = {}) {
  const e = Object.values(exit.clearance_checklist || {});
  if (!e.length) return 'Not started';
  const done = e.filter((v) => ['cleared', 'not_applicable'].includes(v.status)).length;
  return done === e.length ? 'Completed' : `${done} of ${e.length} cleared`;
}
export function noticeStatus(exit = {}, today) {
  if (['submitted', 'manager_approved'].includes(exit.status)) return 'Awaiting approval';
  if (['withdrawn', 'cancelled', 'manager_rejected', 'hr_rejected'].includes(exit.status)) return '—';
  const l = String(exit.last_working_date || '').slice(0, 10);
  if (!isYmd(l)) return '—';
  if (exit.status === 'completed' || l < today) return 'Served';
  return `${diffDaysYmd(today, l)} day(s) left`;
}
const ym = (d) => String(d || '').slice(0, 7);
const bump = (o, k, n = 1) => { o[k || 'Not recorded'] = (o[k || 'Not recorded'] || 0) + n; };
const sortedPairs = (o) => Object.entries(o).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
const AFTER_ACCEPT = ['in_notice', 'clearance_pending', 'clearance_done', 'fnf_prepared', 'fnf_verified', 'fnf_hr_approved', 'fnf_finance_processed', 'fnf_employee_accepted', 'completed'];

/** KPIs and charts for the HR dashboard. `exits` are Exit rows, `empOf(userId)` gives the employee record (department, location, type). */
export function exitAnalytics(exits, empOf, { today, department = '', location = '', employmentType = '', from = '', to = '' } = {}) {
  const rows = exits.filter((x) => {
    const e = empOf(x.user_id) || {};
    const dep = e.department || x.employee_snapshot?.department || '';
    if (department && dep !== department) return false;
    if (location && (e.work_location || e.location || '') !== location) return false;
    if (employmentType && (e.employment_type || '') !== employmentType) return false;
    const d = String(x.resignation_date || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  const lwd = (x) => String(x.last_working_date || '').slice(0, 10);
  const open = rows.filter((x) => !['withdrawn', 'cancelled', 'manager_rejected', 'hr_rejected', 'completed'].includes(x.status));
  const monthKey = today.slice(0, 7);
  const upcoming = (n) => open.filter((x) => AFTER_ACCEPT.includes(x.status) && isYmd(lwd(x)) && lwd(x) >= today && diffDaysYmd(today, lwd(x)) <= n).length;
  const kpis = {
    total: rows.filter((x) => (x.exit_type || 'resignation') === 'resignation').length,
    this_month: rows.filter((x) => ym(x.resignation_date) === monthKey).length,
    pending_approvals: rows.filter((x) => ['submitted', 'manager_approved'].includes(x.status)).length,
    under_retention: rows.filter((x) => x.retention?.status === 'open' && ['submitted', 'manager_approved'].includes(x.status)).length,
    accepted: rows.filter((x) => AFTER_ACCEPT.includes(x.status)).length,
    serving_notice: open.filter((x) => x.status === 'in_notice' || x.status === 'clearance_pending').length,
    upcoming_7: upcoming(7), upcoming_15: upcoming(15), upcoming_30: upcoming(30),
    pending_clearances: open.filter((x) => ['in_notice', 'clearance_pending'].includes(x.status)).length,
    pending_kt: open.filter((x) => AFTER_ACCEPT.includes(x.status) && x.status !== 'completed' && Number(x.kt_overall_completion || 0) < 100).length,
    pending_fnf: rows.filter((x) => ['clearance_done', 'fnf_prepared', 'fnf_verified', 'fnf_hr_approved', 'fnf_finance_processed', 'fnf_employee_accepted'].includes(x.status)).length,
    completed: rows.filter((x) => x.status === 'completed').length,
  };
  const dept = {}, desig = {}, reason = {}, type = { Voluntary: 0, Involuntary: 0, Other: 0 }, trend = {};
  for (const x of rows.filter((r) => AFTER_ACCEPT.includes(r.status))) {
    const e = empOf(x.user_id) || {};
    bump(dept, e.department || x.employee_snapshot?.department); bump(desig, e.designation || x.employee_snapshot?.designation);
  }
  for (const x of rows) {
    bump(reason, x.reason_category || 'other');
    const t = String(x.exit_type || 'resignation').toLowerCase();
    type[/terminat|dismiss|abscond/.test(t) ? 'Involuntary' : /resign|mutual/.test(t) ? 'Voluntary' : 'Other']++;
    if (x.resignation_date) bump(trend, ym(x.resignation_date));
  }
  const months = []; { let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); for (let i = 0; i < 12; i++) { months.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (m === 0) { m = 12; y--; } } }
  const done = rows.filter((x) => x.status === 'completed' && isYmd(lwd(x)) && x.resignation_date);
  const settled = rows.filter((x) => x.fnf_data?.prepared_at && x.fnf_data?.finance_processed_at);
  const avg = (a) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
  const talked = rows.filter((x) => (x.retention?.discussions || []).length > 0);
  return {
    kpis, department: sortedPairs(dept), designation: sortedPairs(desig).slice(0, 12), reasons: sortedPairs(reason), voluntary: Object.entries(type).map(([name, count]) => ({ name, count })).filter((v) => v.count > 0),
    trend: months.map((m) => ({ month: m, count: trend[m] || 0 })),
    avg_notice_served_days: avg(done.map((x) => diffDaysYmd(String(x.resignation_date).slice(0, 10), lwd(x)))),
    avg_fnf_days: avg(settled.map((x) => diffDaysYmd(String(x.fnf_data.prepared_at).slice(0, 10), String(x.fnf_data.finance_processed_at).slice(0, 10)))),
    retention: { discussions: talked.length, retained: talked.filter((x) => x.cancel_reason === 'retained').length, success_rate: talked.length ? Math.round((talked.filter((x) => x.cancel_reason === 'retained').length / talked.length) * 1000) / 10 : null },
    count: rows.length,
  };
}

// ── exit documents: templates, placeholders, and the rules for when each may be issued ───────────────────────────────────────
const P = (s) => s;   // marker: templates are plain HTML with {{placeholders}}
export const DOC_TEMPLATES = {
  resignation_acknowledgement: { title: 'Resignation Acknowledgement', body: P(`<p style="text-align:right;">{{today}}</p><p>Ref: {{reference_no}}</p><p>Dear {{prefix}} {{employee_name}},</p>
<p>We acknowledge receipt of your resignation dated <strong>{{resignation_date}}</strong> from the position of <strong>{{designation}}</strong>{{department_clause}} (Employee Code: {{employee_code}}).</p>
<p>Your proposed last working day is <strong>{{proposed_last_day}}</strong>. The applicable notice period is {{notice_days}} days. The resignation is under review and you will be informed of the decision.</p>
<p>Sincerely,<br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`) },
  resignation_acceptance: { title: 'Resignation Acceptance Letter', body: P(`<p style="text-align:right;">{{today}}</p><p>Ref: {{reference_no}}</p><p>Dear {{prefix}} {{employee_name}},</p>
<p>With reference to your resignation dated <strong>{{resignation_date}}</strong>, we confirm that the company has accepted it. Your last working day with Maxvolt Energy Industries Limited will be <strong>{{last_working_date}}</strong>.</p>
<p>Please complete the knowledge transfer, return all company assets and finish the exit clearances before your last working day. Your full and final settlement will be processed as per company policy once clearances are complete.</p>
<p>Sincerely,<br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`) },
  notice_waiver: { title: 'Notice Period Waiver Letter', body: P(`<p style="text-align:right;">{{today}}</p><p>Ref: {{reference_no}}</p><p>Dear {{prefix}} {{employee_name}},</p>
<p>With reference to your resignation dated <strong>{{resignation_date}}</strong>, the company has agreed to waive <strong>{{waived_days}} day(s)</strong> of the notice period of {{notice_days}} days. Your last working day is <strong>{{last_working_date}}</strong>.</p>
<p>Any remaining notice shortfall will be recovered in your full and final settlement as per policy.</p>
<p>Sincerely,<br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`) },
  relieving_letter: { title: 'Relieving Letter', body: P(`<p style="font-weight:bold;text-align:center;">Relieving Letter</p><p style="text-align:right;">{{today}}</p><p>To Whomsoever It May Concern,</p>
<p>This is to certify that <strong>{{prefix}} {{employee_name}}</strong> (Employee Code: {{employee_code}}) was employed with Maxvolt Energy Industries Limited as <strong>{{designation}}</strong>{{department_clause}} from <strong>{{date_of_joining}}</strong> to <strong>{{last_working_date}}</strong>.</p>
<p>{{prefix}} {{employee_name}} has been formally relieved from the services of the company with effect from <strong>{{last_working_date}}</strong>, after completing all exit formalities.</p>
<p>We wish {{pronoun_obj}} all the best in {{pronoun_pos}} future endeavours.</p>
<p>Sincerely,<br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`) },
  experience_certificate: { title: 'Experience Certificate', body: P(`<p style="font-weight:bold;text-align:center;">Experience Certificate</p><p style="text-align:right;">{{today}}</p><p>To Whomsoever It May Concern,</p>
<p>This is to certify that <strong>{{prefix}} {{employee_name}}</strong> (Employee Code: {{employee_code}}) was employed with <strong>Maxvolt Energy Industries Limited</strong> from <strong>{{date_of_joining}}</strong> to <strong>{{last_working_date}}</strong>, last holding the position of <strong>{{designation}}</strong>{{department_clause}}.</p>
<p>During {{pronoun_pos}} association with the company, {{pronoun_sub}} discharged {{pronoun_pos}} duties with sincerity. We wish {{pronoun_obj}} all the best in {{pronoun_pos}} future career.</p>
<p>Sincerely,<br/>HR Department<br/><strong>Maxvolt Energy Industries Limited</strong></p>`) },
};
export const DOC_TYPES = Object.keys(DOC_TEMPLATES);
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Fill {{placeholders}}; values are escaped so a name can never inject markup. */
export function renderDocTemplate(body, vars = {}) {
  return String(body || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => (vars[k] === undefined ? '' : escHtml(vars[k])));
}
export function templatesFor(cfg = {}) {
  const out = {};
  for (const k of DOC_TYPES) { const o = (cfg.doc_templates || {})[k]; out[k] = { title: o?.title || DOC_TEMPLATES[k].title, body: o?.body || DOC_TEMPLATES[k].body, custom: !!o?.body }; }
  return out;
}
/** Whether a document may be issued now. Returns an error text, or '' when it may. The relieving and experience letters wait for every mandatory exit condition. */
export function docGate(exit = {}, type, { closeBlockers: blockers = [] } = {}) {
  const accepted = ['in_notice', 'clearance_pending', 'clearance_done', 'fnf_prepared', 'fnf_verified', 'fnf_hr_approved', 'fnf_finance_processed', 'fnf_employee_accepted', 'completed'].includes(exit.status);
  if (!DOC_TYPES.includes(type)) return 'Unknown document';
  if (type === 'resignation_acknowledgement') return ['draft'].includes(exit.status) ? 'The resignation has not been submitted' : '';
  if (type === 'resignation_acceptance') return accepted ? '' : 'The resignation has not been accepted yet';
  if (type === 'notice_waiver') return !accepted ? 'The resignation has not been accepted yet' : (exit.notice_waived_days > 0 ? '' : 'No notice period waiver was granted on this case');
  if (blockers.length) return `Not yet — ${blockers.join('; ')}`;
  return '';
}

// ── knowledge transfer and access revocation ───────────────────────────────────────────────────────────────────────────────
export const KT_STATUS = ['assigned', 'in_progress', 'handed_over', 'verified', 'sent_back'];
export function ktSummary(items = []) {
  const v2 = items.filter((i) => i.v === 2);
  const total = v2.length || items.length;
  const done = v2.length ? v2.filter((i) => i.status === 'verified').length : items.filter((i) => i.status === 'completed').length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, pending: total - done };
}
export const DEFAULT_ACCESS_ITEMS = [
  { key: 'email', label: 'Official email deactivation' }, { key: 'maxvolt_one', label: 'MaxVolt One account deactivation' }, { key: 'crm_lms', label: 'CRM / LMS access revocation' },
  { key: 'erp', label: 'ERP / application access revocation' }, { key: 'vpn_cloud', label: 'VPN / cloud access revocation' }, { key: 'other', label: 'Other company systems' },
];
export function buildAccessChecklist(items = DEFAULT_ACCESS_ITEMS, lwd) {
  return items.map((i) => ({ key: i.key, label: i.label, status: 'pending', scheduled_for: lwd || '', done_at: null, done_by: '', remarks: '' }));
}
/** Access items still to do before closing (the MaxVolt One account is closed by the system at closure itself). */
export const accessPending = (exit = {}) => (exit.access_checklist || []).filter((i) => i.key !== 'maxvolt_one' && i.status === 'pending');
