// Daily L&D automation:
//  • auto-create the induction workflow for new joiners that don't have one yet
//  • unlock time-gated steps (30/60/90-day reviews become available N days before they are due)
//  • mark overdue steps, send due-soon reminders and escalate: Employee → Manager → HOD → HR → L&D
//  • assignments: overdue marking + reminders
//  • certificates: expiring / expired
import { one, all } from '../db.js';
import { createInduction, ensureSeed, todayIST, ldInternals } from '../routes/ld.js';

const { list, save, notify, loadInduction, withLock, runAutoChecks, afterChange, setStatus, ownersOf, hrUserIds, getConfig, daysBetween, certStatus } = ldInternals;

export async function ldDailyTick() {
  await ensureSeed();
  const cfg = await getConfig();
  const today = todayIST();
  const out = { started: 0, overdue_marked: 0, escalations: 0, reminders: 0, assignments_overdue: 0, certs: 0, errors: 0 };

  // While HR has paused induction training: nothing starts, unlocks, goes overdue or escalates.
  const paused = !!cfg.paused;

  // 1) New joiners without an induction (approved, joining within the last 30 days or in the next 14)
  if (cfg.auto_start_induction && !paused) {
    try {
      const existing = new Set((await list('LdInduction')).filter(i => i.status !== 'CANCELLED').map(i => i.user_id));
      for (const e of await list('Employee')) {
        if (!e.user_id || e.status !== 'active' || existing.has(e.user_id) || !e.date_of_joining) continue;
        const d = daysBetween(String(e.date_of_joining).slice(0, 10), today);
        if (d > 30 || d < -14) continue;
        try { await createInduction(e.user_id, { actorId: 'system' }); out.started++; } catch (err) { out.errors++; console.warn('[ld-tick] auto-start failed:', err.message); }
      }
    } catch (e) { out.errors++; console.warn('[ld-tick] auto-start scan failed:', e.message); }
  }

  // 2) Active inductions
  for (const row of (paused ? [] : await list('LdInduction')).filter(i => i.status === 'IN_PROGRESS')) {
    try {
      await withLock('ind:' + row.id, async () => {
        const ind = await loadInduction(row.id);
        if (!ind || ind.status !== 'IN_PROGRESS') return;
        await runAutoChecks(ind);
        for (const g of ind.gates) {
          if (['READY', 'IN_PROGRESS'].includes(g.status) && g.due_date < today) {
            g.status_before_overdue = g.status; setStatus(g, 'OVERDUE', 'system', `due ${g.due_date}`); out.overdue_marked++;
          }
          // due-soon reminder (once)
          if (['READY', 'IN_PROGRESS'].includes(g.status) && !g.reminded?.due_soon && daysBetween(today, g.due_date) <= cfg.due_soon_days && daysBetween(today, g.due_date) >= 0) {
            g.reminded = { ...(g.reminded || {}), due_soon: true };
            await notify([ind.user_id, ...(await ownersOf(ind, g))], { title: 'Induction step due soon', message: `${ind.employee.name}: "${g.name}" is due ${g.due_date}.`, type: 'warning', link: `/LdInductionDetail?id=${ind.id}` });
            out.reminders++;
          }
          // sign-off waiting more than 2 days
          if (['SUBMITTED', 'UNDER_REVIEW'].includes(g.status) && g.history?.length) {
            const since = g.history[g.history.length - 1].at;
            const waited = daysBetween(String(since).slice(0, 10), today);
            if (waited >= 2 && g.reminded?.signoff !== today) {
              g.reminded = { ...(g.reminded || {}), signoff: today };
              await notify(await ownersOf(ind, g), { title: 'Sign-off pending', message: `${ind.employee.name}: "${g.name}" has been waiting ${waited} day(s) for sign-off.`, type: 'warning', link: `/LdInductionDetail?id=${ind.id}` });
              out.reminders++;
            }
          }
          // escalation ladder for overdue steps
          if (g.status === 'OVERDUE') {
            const late = daysBetween(g.due_date, today);
            const ladder = [
              ['employee', cfg.escalation_days.employee, async () => [ind.user_id]],
              ['manager', cfg.escalation_days.manager, async () => [ind.employee.reporting_manager_id]],
              ['hod', cfg.escalation_days.hod, async () => [ind.hod_user_id]],
              ['hr', cfg.escalation_days.hr, async () => hrUserIds()],
              ['ld', cfg.escalation_days.ld, async () => cfg.ld_admin_user_ids],
            ];
            const level = ladder.filter(l => late >= l[1]).length;
            if (level > (g.escalation_level || 0)) {
              const [who, , get] = ladder[level - 1];
              const recipients = (await get()).filter(Boolean);
              await notify(recipients, { title: who === 'employee' ? 'Induction step overdue' : `Induction overdue — ${ind.employee.name}`, message: `"${g.name}" is ${late} day(s) overdue (due ${g.due_date}).`, type: 'warning', link: who === 'employee' ? '/MyLearning' : `/LdInductionDetail?id=${ind.id}` });
              g.escalation_level = level; out.escalations++;
            }
          }
        }
        await afterChange(ind, 'system');
        await save('LdInduction', ind);
      });
    } catch (e) { out.errors++; console.warn('[ld-tick] induction failed:', row.id, e.message); }
  }

  // 3) Assignments
  try {
    for (const a of await list('LdAssignment')) {
      if (['COMPLETED', 'WAIVED', 'CANCELLED'].includes(a.status) || !a.due_date) continue;
      const left = daysBetween(today, a.due_date);
      if (left < 0 && a.status !== 'OVERDUE') {
        a.status_before_overdue = a.status; a.status = 'OVERDUE'; await save('LdAssignment', a); out.assignments_overdue++;
        const emp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [a.user_id]);
        const mgr = emp ? JSON.parse(emp.data).reporting_manager_id : null;
        await notify([a.user_id], { title: 'Training overdue', message: `"${a.course_title}" was due ${a.due_date}.`, type: 'warning', link: '/MyLearning' });
        if (a.mandatory && mgr) await notify(mgr, { title: 'Team member training overdue', message: `A mandatory training ("${a.course_title}") is overdue for a team member.`, type: 'warning', link: '/LdTeamLearning' });
      } else if (left >= 0 && left <= cfg.due_soon_days && !a.reminded_due_soon) {
        a.reminded_due_soon = true; await save('LdAssignment', a);
        await notify(a.user_id, { title: 'Training due soon', message: `"${a.course_title}" is due ${a.due_date}.`, type: 'info', link: '/MyLearning' });
        out.reminders++;
      }
    }
  } catch (e) { out.errors++; console.warn('[ld-tick] assignments failed:', e.message); }

  // 4) Certificates
  try {
    for (const c of await list('LdCertificate')) {
      const st = certStatus(c, cfg);
      if (st === 'EXPIRING' && !c.notified_expiring) { c.notified_expiring = true; await save('LdCertificate', c); await notify(c.user_id, { title: 'Certificate expiring', message: `${c.title} expires on ${c.expiry_date}.`, type: 'warning', link: '/MyLearning' }); out.certs++; }
      if (st === 'EXPIRED' && !c.notified_expired) { c.notified_expired = true; await save('LdCertificate', c); await notify([c.user_id, ...(await hrUserIds())], { title: 'Certificate expired', message: `${c.employee_name}: ${c.title} expired on ${c.expiry_date}.`, type: 'warning', link: '/LdControlCentre' }); out.certs++; }
    }
  } catch (e) { out.errors++; console.warn('[ld-tick] certificates failed:', e.message); }

  console.log('[ld-tick]', JSON.stringify(out));
  return out;
}
