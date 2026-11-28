// The reminder sent to the Reporting Manager exactly 15 days before an employee's confirmation due date, with every HR
// mailbox in CC. Runs daily (see server.js). One reminder per employee per due date.
import { one, all, run } from '../db.js';
import { reminderDue } from '../utils/confirmationRules.js';
import { mails, deliver } from '../utils/confirmationMail.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const istToday = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function sendConfirmationDueReminders({ today = istToday(), send = deliver } = {}) {
  const employees = (await all("SELECT user_id, data FROM entities WHERE type='Employee' AND status='active'")).map((r) => { const d = parse(r.data); return { ...d, user_id: d.user_id || r.user_id }; }).filter((e) => e.user_id);
  const cases = (await all("SELECT data FROM entities WHERE type='ConfirmationCase'")).map((r) => parse(r.data)).filter((c) => c.status !== 'cancelled');
  const users = Object.fromEntries((await all('SELECT id, full_name, email, disabled_at FROM users')).map((u) => [u.id, u]));
  let checked = 0, sent = 0, failed = 0;
  for (const e of employees) {
    const c = cases.filter((x) => x.user_id === e.user_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const due = reminderDue(e, c, today);
    if (!due) continue;
    checked++;
    // The id is fixed by employee and due date, so two runs (or two servers) can never both send it.
    const id = `cfr15-${e.user_id}-${due.due}`;
    const claim = await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ConfirmationReminderLog',$2,'sending',$3) ON CONFLICT (id) DO NOTHING", [id, e.user_id, JSON.stringify({ id, user_id: e.user_id, kind: 'due_15', probation_end_date: due.due, at: new Date().toISOString() })]);
    const claimed = claim?.rowCount ?? claim?.changes;
    if (claimed === 0) continue;
    const manager = users[e.reporting_manager_id];
    const result = await send(manager && !manager.disabled_at ? manager.email : '', mails.reminder({
      name: e.display_name || users[e.user_id]?.full_name || '', code: e.employee_code || '', department: e.department || '', designation: e.designation || '',
      joined: e.date_of_joining, due: due.due, daysLeft: due.days_left, managerName: manager?.full_name || '', started: c?.status === 'pending_manager',
    }));
    if (result.status !== 'sent') {
      failed++;
      await run("DELETE FROM entities WHERE type='ConfirmationReminderLog' AND id=$1", [id]);   // tried again by the next run in the catch-up window
      continue;
    }
    sent++;
    await run("UPDATE entities SET status='sent', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ id, user_id: e.user_id, kind: 'due_15', probation_end_date: due.due, ...result }), id]);
    if (c) {
      const row = await one("SELECT data FROM entities WHERE type='ConfirmationCase' AND id=$1", [c.id]);
      if (row) {
        const d = parse(row.data);
        d.history = [...(d.history || []), { at: result.at, actor_id: null, actor_name: 'System', action: 'email_sent', detail: `15-day reminder to ${result.to.join(', ')}${result.cc.length ? ` (CC ${result.cc.join(', ')})` : ''}` }];
        await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(d), c.id]);
      }
    }
    if (manager) {
      try { await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [`${id}-n`, manager.id, 'Confirmation due in 15 days', `${e.display_name || 'A team member'} is due for confirmation on ${due.due}.`, 'warning', '/ConfirmationManagement']); } catch { /* already notified */ }
    }
  }
  return { checked, sent, failed };
}
