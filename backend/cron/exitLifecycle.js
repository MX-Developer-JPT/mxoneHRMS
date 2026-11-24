// Daily watch over resignations so nothing waits for nobody:
//  • the reporting manager has `manager_decision_days` to decide — after that HR is told and may decide in the manager's place;
//  • a case the manager approved waits no more than `hr_decision_days` for HR before HR is reminded;
//  • the last working day is near (or has passed) and the case is still not closed — HR is told, once a day at most;
//  • a withdrawal request nobody has decided is raised again.
// Each alert is remembered on the case (alerts.<key>) so it fires once per day at most.
import { all, run } from '../db.js';
import { istToday, addDaysYmd, diffDaysYmd, mergeCfg } from '../utils/exitPolicy.js';
import { v4 as uuidv4 } from 'uuid';

async function notifyDb(userId, { title, message, type = 'warning', link = '/exit-management' }) {
  if (!userId) return;
  try { await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), userId, title, message, type, link]); } catch { /* best effort */ }
}

export async function runExitLifecycle() {
  const today = istToday();
  const cfgRow = (await all("SELECT data FROM entities WHERE type='ExitWorkflowConfig' AND id='exit-workflow-global'"))[0];
  const cfg = mergeCfg(cfgRow ? JSON.parse(cfgRow.data) : {});
  const hr = await all("SELECT id FROM users WHERE role IN ('hr','admin')");
  const rows = await all("SELECT id,data FROM entities WHERE type='Exit' AND status NOT IN ('completed','withdrawn','cancelled','manager_rejected','hr_rejected')");
  let sent = 0, escalated = 0;
  for (const r of rows) {
    let ex; try { ex = JSON.parse(r.data); } catch { continue; }
    const alerts = { ...(ex.alerts || {}) };
    let changed = false, audit = ex.audit_log || [];
    const name = ex.employee_snapshot?.name || 'An employee';
    const once = async (key, fn) => { if (alerts[key] === today) return; alerts[key] = today; changed = true; await fn(); sent++; };

    const mgrDue = ex.manager_due_at || (ex.created_at ? addDaysYmd(String(ex.created_at).slice(0, 10), cfg.manager_decision_days) : null);
    if (ex.status === 'submitted' && mgrDue && mgrDue < today && !ex.manager_escalated) {
      ex = { ...ex, manager_escalated: true }; escalated++; changed = true;
      audit = [...audit, { actor_id: null, actor_name: 'System', action: `Escalated to HR — the reporting manager did not decide within ${cfg.manager_decision_days} day(s)`, comment: '', timestamp: new Date().toISOString() }];
      for (const h of hr) await notifyDb(h.id, { title: 'Resignation waiting on manager', message: `${name}'s resignation has waited over ${cfg.manager_decision_days} day(s) for the reporting manager. You can now decide it in the manager's place.` });
      if (ex.manager_id) await notifyDb(ex.manager_id, { title: 'Resignation needs your decision', message: `${name}'s resignation is overdue for your decision. HR has been told.` });
    }
    if (ex.status === 'manager_approved') {
      const since = (ex.approval_stages || []).find(s => s.stage === 'manager')?.timestamp?.slice(0, 10) || ex.created_at?.slice(0, 10) || today;
      if (diffDaysYmd(since, today) >= cfg.hr_decision_days) await once('hr_wait', async () => { for (const h of hr) await notifyDb(h.id, { title: 'Resignation awaiting HR', message: `${name}'s resignation has been waiting ${diffDaysYmd(since, today)} day(s) for an HR decision.` }); });
    }
    if (ex.withdrawal_request?.status === 'pending' && ex.withdrawal_request.requested_at && diffDaysYmd(ex.withdrawal_request.requested_at.slice(0, 10), today) >= 2) {
      await once('withdrawal_wait', async () => { for (const h of hr) await notifyDb(h.id, { title: 'Withdrawal request waiting', message: `${name} asked to withdraw their resignation ${diffDaysYmd(ex.withdrawal_request.requested_at.slice(0, 10), today)} days ago. Please decide.` }); });
    }
    if (['in_notice', 'clearance_pending', 'clearance_done', 'fnf_prepared', 'fnf_verified', 'fnf_hr_approved', 'fnf_finance_processed', 'fnf_employee_accepted'].includes(ex.status) && ex.last_working_date) {
      const left = diffDaysYmd(today, String(ex.last_working_date).slice(0, 10));
      if (left >= 0 && left <= 3 && ['in_notice', 'clearance_pending'].includes(ex.status)) await once('lwd_near', async () => { for (const h of hr) await notifyDb(h.id, { title: 'Last working day is close', message: `${name}'s last working day is ${left === 0 ? 'today' : `in ${left} day(s)`} and clearance is not complete.` }); await notifyDb(ex.user_id, { title: 'Complete your exit steps', message: `Your last working day is ${ex.last_working_date}. Please finish your clearances, handover and exit interview.`, link: '/my-exit' }); });
      if (left < 0 && diffDaysYmd(String(ex.last_working_date).slice(0, 10), today) % 3 === 0) await once('lwd_passed', async () => { for (const h of hr) await notifyDb(h.id, { title: 'Exit case still open after last working day', message: `${name}'s last working day was ${ex.last_working_date}; the case is at "${ex.status}".` }); });
    }
    if (changed) await run('UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify({ ...ex, alerts, audit_log: audit }), r.id]);
  }
  return { checked: rows.length, alerts: sent, escalated };
}
