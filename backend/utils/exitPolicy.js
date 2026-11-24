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
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v) => YMD.test(String(v || ''));
export const addDaysYmd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const diffDaysYmd = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);   // b − a
export const daysInMonthOf = (ymd) => { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const istToday = (ms = Date.now()) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

export function mergeCfg(stored = {}) {
  const out = { ...EXIT_DEFAULTS };
  for (const k of Object.keys(EXIT_DEFAULTS)) if (stored[k] !== undefined && stored[k] !== null && stored[k] !== '') out[k] = typeof EXIT_DEFAULTS[k] === 'boolean' ? stored[k] !== false : (Number(stored[k]) || EXIT_DEFAULTS[k]);
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
export function evaluateResignation({ today, proposedLastDay, noticeDays, buyoutRequested = false, buyoutDays = 0, cfg = EXIT_DEFAULTS }) {
  const errors = [];
  const resignationDate = today;
  const standardLwd = addDaysYmd(resignationDate, noticeDays);
  if (!isYmd(proposedLastDay)) errors.push('Enter the last working day you are proposing.');
  else {
    if (proposedLastDay < today) errors.push('The last working day cannot be in the past.');
    if (diffDaysYmd(today, proposedLastDay) > cfg.max_notice_days) errors.push(`The last working day cannot be more than ${cfg.max_notice_days} days from today.`);
  }
  const served = isYmd(proposedLastDay) ? diffDaysYmd(resignationDate, proposedLastDay) : noticeDays;
  const shortfall = Math.max(0, noticeDays - served);
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
export const EXIT_HAND_EDITABLE = ['kt_items', 'kt_overall_completion', 'hr_exit_interview', 'hr_interview_completed', 'hr_notes', 'audit_log'];
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
