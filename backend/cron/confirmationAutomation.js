// Probation-confirmation email reminders — runs unattended (see server.js
// for the schedule). Emails an employee's reporting manager once their
// probation end date is within CONFIRMATION_DUE_WINDOW_DAYS — the same
// "due soon" threshold ConfirmationManagement.jsx already uses in its own
// UI (getProbationEmployees case in functions.js), so the email and the
// dashboard badge agree.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';

const CONFIRMATION_DUE_WINDOW_DAYS = 30;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateString() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Has this employee already been reminded for this exact probation end
// date? Keyed on (user_id, probation_end_date) rather than just user_id, so
// extending someone's probation to a new date allows a fresh reminder later.
async function alreadyReminded(userId, probationEndDate) {
  const row = await one(
    "SELECT id FROM entities WHERE type='ConfirmationReminderLog' AND user_id=$1 AND data::jsonb->>'probation_end_date'=$2",
    [userId, probationEndDate]
  );
  return !!row;
}

async function markReminded(userId, probationEndDate) {
  const id = uuidv4();
  await run(
    "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ConfirmationReminderLog',$2,'sent',$3)",
    [id, userId, JSON.stringify({ id, user_id: userId, probation_end_date: probationEndDate, sent_at: new Date().toISOString() })]
  );
}

export async function sendConfirmationDueReminders() {
  const today = istDateString();
  const todayMs = new Date(today + 'T00:00:00Z').getTime();

  const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
  const employees = empRows.map(r => JSON.parse(r.data))
    .filter(e => e.user_id && (e.employee_status === 'probation' || (!e.employee_status && !e.confirmation_date)));
  if (employees.length === 0) return { checked: 0, sent: 0 };

  const managerIds = new Set(employees.map(e => e.reporting_manager_id).filter(Boolean));
  const userRows = managerIds.size
    ? await all("SELECT id, full_name, email FROM users WHERE id = ANY($1)", [[...managerIds]])
    : [];
  const managerMap = new Map(userRows.map(u => [u.id, u]));

  let checked = 0, sent = 0;
  for (const emp of employees) {
    if (!emp.reporting_manager_id) continue;
    const manager = managerMap.get(emp.reporting_manager_id);
    if (!manager?.email) continue;

    // Same 180-day (six month) fallback used by getProbationEmployees — kept
    // in sync so the email and the Confirmation Management dashboard never
    // disagree, and matches the Appointment Letter's stated probation period
    // (the old 90-day fallback flagged employees overdue three months early).
    const probEnd = emp.probation_end_date
      ? new Date(emp.probation_end_date + 'T00:00:00Z')
      : (emp.date_of_joining ? new Date(new Date(emp.date_of_joining + 'T00:00:00Z').getTime() + 180 * 24 * 60 * 60 * 1000) : null);
    if (!probEnd) continue;

    const daysLeft = Math.ceil((probEnd.getTime() - todayMs) / (24 * 60 * 60 * 1000));
    if (daysLeft > CONFIRMATION_DUE_WINDOW_DAYS) continue;
    checked++;

    const probEndStr = probEnd.toISOString().slice(0, 10);
    if (await alreadyReminded(emp.user_id, probEndStr)) continue;

    try {
      const tpl = emailTemplates.confirmationDueReminder({
        managerName: manager.full_name,
        employeeName: emp.display_name || 'An employee',
        department: emp.department,
        designation: emp.designation,
        probationEndDate: probEndStr,
        daysLeft,
      });
      await sendEmail({ to: manager.email, ...tpl });
      await markReminded(emp.user_id, probEndStr);
      sent++;
    } catch (e) {
      console.error('[confirmation-reminder] send failed for', emp.user_id, e.message);
    }
  }
  return { checked, sent };
}
