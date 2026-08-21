// Exit clearance SLA reminders — runs unattended (see server.js for the
// schedule). For every Exit case still awaiting department clearance,
// checks each of the 5 departments against its configured SLA (days since
// the case entered clearance) and reminds that department's owners (or,
// for working_department, the employee's actual reporting manager) once
// they're overdue. Escalates to HR/admin once a department is more than
// double its SLA overdue.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';

const DEFAULT_SLA_DAYS = 3;
const CLEARANCE_DEPT_KEYS = ['hr', 'finance', 'it', 'admin', 'working_department'];
const CLEARANCE_DEPT_LABELS = {
  hr: 'HR Department', finance: 'Finance / Accounts', it: 'IT Department',
  admin: 'Admin/Facilities', working_department: 'Working Department / Reporting Manager',
};

// Dedup key: (exit_id, dept_key, day) so at most one reminder fires per
// department per day, even though the cron itself may run more than once.
async function alreadyRemindedToday(exitId, deptKey, dayStr) {
  const row = await one(
    "SELECT id FROM entities WHERE type='ExitClearanceReminderLog' AND data::jsonb->>'exit_id'=$1 AND data::jsonb->>'dept_key'=$2 AND data::jsonb->>'day'=$3",
    [exitId, deptKey, dayStr]
  );
  return !!row;
}

async function markReminded(exitId, deptKey, dayStr) {
  const id = uuidv4();
  await run(
    "INSERT INTO entities(id,type,status,data) VALUES($1,'ExitClearanceReminderLog','sent',$2)",
    [id, JSON.stringify({ id, exit_id: exitId, dept_key: deptKey, day: dayStr, sent_at: new Date().toISOString() })]
  );
}

async function notifyDb(userId, { title, message, type = 'warning', link = '' }) {
  if (!userId) return;
  try {
    await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [uuidv4(), userId, title, message, type, link || null]);
  } catch {}
}

export async function sendExitClearanceReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const exitRows = await all("SELECT id,data FROM entities WHERE type='Exit' AND data::jsonb->>'status' IN ('in_notice','clearance_pending')");
  if (!exitRows.length) return { checked: 0, sent: 0 };

  const configRows = await all("SELECT data FROM entities WHERE type='ExitClearanceConfig'");
  const configs = new Map(configRows.map(r => { const c = JSON.parse(r.data); return [c.dept_key, c]; }));

  let checked = 0, sent = 0;
  for (const row of exitRows) {
    const exit = JSON.parse(row.data);
    const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [exit.user_id]);
    const emp = empRow ? JSON.parse(empRow.data) : {};
    const userRow = await one('SELECT full_name FROM users WHERE id=$1', [exit.user_id]);
    const empName = userRow?.full_name || emp.display_name || 'An employee';

    for (const deptKey of CLEARANCE_DEPT_KEYS) {
      const c = exit.clearance_checklist?.[deptKey];
      if (!c || c.status === 'cleared') continue;
      checked++;

      const cfg = configs.get(deptKey);
      const slaDays = Number(cfg?.sla_days) || DEFAULT_SLA_DAYS;
      const clearanceStartedAt = exit.audit_log?.find(a => /clearance initiated|Clearance process started/i.test(a.action))?.timestamp || exit.hr_actioned_at || exit.created_at;
      if (!clearanceStartedAt) continue;
      const daysSinceStart = Math.floor((Date.now() - new Date(clearanceStartedAt).getTime()) / (24 * 60 * 60 * 1000));
      if (daysSinceStart < slaDays) continue;

      if (await alreadyRemindedToday(exit.id, deptKey, today)) continue;

      const ownerIds = deptKey === 'working_department'
        ? (emp.reporting_manager_id ? [emp.reporting_manager_id] : [])
        : (cfg?.owner_user_ids || []);
      if (!ownerIds.length) continue;

      const daysOverdue = daysSinceStart - slaDays;
      for (const ownerId of ownerIds) {
        const owner = await one('SELECT full_name, email FROM users WHERE id=$1', [ownerId]);
        await notifyDb(ownerId, {
          title: `Exit Clearance Overdue — ${empName}`,
          message: `${empName}'s ${CLEARANCE_DEPT_LABELS[deptKey]} clearance is ${daysOverdue} day(s) overdue.`,
          link: '/exit-management',
        });
        if (owner?.email) {
          try {
            const tpl = emailTemplates.exitClearanceReminder({
              ownerName: owner.full_name, employeeName: empName, deptLabel: CLEARANCE_DEPT_LABELS[deptKey],
              lastWorkingDate: exit.last_working_date, daysOverdue,
            });
            await sendEmail({ to: owner.email, ...tpl });
          } catch (e) { console.error('[exit-clearance-reminder] email failed for', ownerId, e.message); }
        }
        sent++;
      }
      // Escalate to HR/admin once more than double the SLA overdue.
      if (daysOverdue > slaDays) {
        const hrRows = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
        for (const hr of hrRows) {
          await notifyDb(hr.id, { title: `Exit Clearance Escalation — ${empName}`, message: `${CLEARANCE_DEPT_LABELS[deptKey]} clearance for ${empName} is significantly overdue (${daysOverdue} days past SLA).`, type: 'error', link: '/exit-management' });
        }
      }
      await markReminded(exit.id, deptKey, today);
    }
  }
  return { checked, sent };
}
