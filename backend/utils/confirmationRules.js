// Employee confirmation workflow rules (pure). HR starts and records observations; the reporting manager decides.
import { isLeaver } from './leavers.js';

export const STATUS = { pending_hr: 'Pending HR Initiation', pending_manager: 'Pending Manager Assessment', confirmed: 'Confirmed', on_hold: 'On Hold', rejected: 'Rejected' };
export const DECISIONS = { confirm: 'confirmed', hold: 'on_hold', reject: 'rejected' };
export const REMINDER_DAYS = 15;
export const CRITERIA = ['work_quality', 'productivity', 'technical_competence', 'communication', 'teamwork', 'discipline', 'learning_ability', 'attendance'];
export const OBSERVATION_FIELDS = { attendance: 'Attendance irregularities / absenteeism', complaints: 'Complaints or negative feedback', disciplinary: 'Disciplinary issues', other: 'Other observations' };

const ymd = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const addMonths = (d, m) => {
  const x = new Date(`${d}T00:00:00Z`), day = x.getUTCDate();
  x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m);
  x.setUTCDate(Math.min(day, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()));
  return x.toISOString().slice(0, 10);
};

/** Currently employed and still on probation. */
export const onProbation = (e) => !!e && !isLeaver(e) && e.status === 'active'
  && (e.employee_status === 'probation' || (!e.employee_status && !ymd(e.confirmation_date) && !ymd(e.employee_confirmation_date)));

/** Confirmation due date: the recorded probation end (or revised review date), else six months after joining. */
export function dueDate(e) {
  const joined = ymd(e?.date_of_joining);
  const recorded = [e?.probation_end_date, e?.employee_confirmation_date, e?.confirmation_date].map(ymd).find((d) => d && (!joined || d > joined));
  return recorded || (joined ? addMonths(joined, 6) : '');
}

/** The status shown on the tracker for an employee and their confirmation case (if any). */
export function trackerStatus(e, c) {
  if (c && c.status !== 'cancelled') return c.status;
  return onProbation(e) ? 'pending_hr' : '';
}

export function cleanObservations(o = {}) {
  const out = {};
  for (const k of Object.keys(OBSERVATION_FIELDS)) { const v = String(o[k] || '').trim().slice(0, 2000); if (v) out[k] = v; }
  return out;
}

/** Problems with a manager's decision; an empty list means it can be recorded. */
export function decisionProblems({ decision, remarks, review_date, scores, comments }, today) {
  const p = [];
  if (!DECISIONS[decision]) return ['Choose Confirm, Hold or Reject.'];
  const missing = CRITERIA.filter((k) => !(Number(scores?.[k]) >= 1 && Number(scores?.[k]) <= 5));
  if (missing.length) p.push('Rate every assessment criterion from 1 to 5.');
  if (String(comments || '').trim().length < 10) p.push('Write your assessment of the employee (at least 10 characters).');
  if (decision !== 'confirm' && String(remarks || '').trim().length < 10) p.push(`Give the reason for ${decision === 'hold' ? 'holding the confirmation' : 'not confirming'} (at least 10 characters). It is sent to the employee.`);
  if (decision === 'hold') {
    const d = ymd(review_date);
    if (!d || d <= today) p.push('Choose a revised review date in the future.');
    else if (daysBetween(today, d) > 366) p.push('The revised review date must be within a year.');
  }
  return p;
}

/** Is today the day to remind the manager? Exactly 15 days before; the two days after are a catch-up if the job did not run. */
export function reminderDue(e, c, today) {
  if (!onProbation(e) || ['confirmed', 'rejected'].includes(c?.status)) return null;
  const due = dueDate(e);
  if (!due) return null;
  const left = daysBetween(today, due);
  return left <= REMINDER_DAYS && left >= REMINDER_DAYS - 2 ? { due, days_left: left } : null;
}

/** What a decision changes on the employee record. */
export function employeeAfterDecision(emp, status, { today, reviewDate = '', remarks = '', byName = '' }) {
  const upd = { ...emp, confirmation_status: status };
  if (status === 'confirmed') Object.assign(upd, { employee_status: 'confirmation', confirmation_date: today, employee_confirmation_date: today });
  else {
    Object.assign(upd, { employee_status: 'probation' });
    if (status === 'on_hold') Object.assign(upd, { probation_end_date: reviewDate, probation_extension_note: remarks, confirmation_date: '', employee_confirmation_date: '' });
    if (status === 'rejected') Object.assign(upd, { probation_outcome: 'not_confirmed', probation_not_confirmed_date: today, probation_not_confirmed_reason: remarks || 'Probation not confirmed', probation_not_confirmed_by: byName });
  }
  if (status !== 'rejected') for (const k of ['probation_outcome', 'probation_not_confirmed_date', 'probation_not_confirmed_reason', 'probation_not_confirmed_by']) delete upd[k];
  return upd;
}

/** Fields only the workflow (or an administrator's correction) may change once an employee has a confirmation case. */
export const PROTECTED_FIELDS = ['employee_status', 'confirmation_date', 'employee_confirmation_date', 'probation_end_date', 'confirmation_status', 'probation_outcome'];
export const changedProtected = (current, patch) => PROTECTED_FIELDS.filter((k) => k in (patch || {}) && String(patch[k] ?? '') !== String(current?.[k] ?? ''));
