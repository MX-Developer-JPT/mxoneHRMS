// Nightly job for the automatic CL, SL and EL credits. The rules are in utils/leaveGrantRules.js.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { GRANT_START_DATE, GRANT_RULES, RULES_VERSION, addDays, planGrants } from '../utils/leaveGrantRules.js';

export * from '../utils/leaveGrantRules.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istDate = (offset = 0) => new Date(Date.now() + IST_OFFSET_MS + offset * 86400000).toISOString().slice(0, 10);

async function notify(userId, title, message) {
  try {
    await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [uuidv4(), userId, title, message, 'success', '/Leave']);
    const { sendPushToUser } = await import('../utils/push.js');
    sendPushToUser(userId, { title, message, type: 'success', link: '/Leave' });
  } catch (e) { console.warn('[leave-grant] notify failed:', e.message); }
}

async function creditBalance(userId, policy, year, days) {
  const rows = await all("SELECT id,data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [userId]);
  const row = rows.map(r => ({ id: r.id, d: JSON.parse(r.data) })).find(r => r.d.leave_policy_id === policy.id && Number(r.d.year) === year);
  if (row) {
    const d = { ...row.d, accrued_this_year: (row.d.accrued_this_year || 0) + days, available: (row.d.available || 0) + days };
    await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), row.id]);
  } else {
    const id = uuidv4();
    const d = { id, user_id: userId, leave_policy_id: policy.id, year, total_allocated: policy.total_days || 0, accrued_this_year: days, used: 0, pending_approval: 0, available: days, carried_forward: 0 };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveBalance',$2,'active',$3)", [id, userId, JSON.stringify(d)]);
  }
}

export async function runLeaveGrants({ upTo = istDate(-1), today = istDate(0) } = {}) {
  const out = { employees: 0, grants: 0, days_granted: 0, errors: 0 };
  const policies = {};
  for (const r of await all("SELECT data FROM entities WHERE type='LeavePolicy'")) {
    const p = JSON.parse(r.data);
    if (GRANT_RULES[p.code] && p.is_active !== false) policies[p.code] = p;
  }
  if (!Object.keys(policies).length) return out;

  const employees = (await all("SELECT data FROM entities WHERE type='Employee' AND status='active'")).map(r => JSON.parse(r.data)).filter(e => e.user_id);
  const states = {};
  for (const r of await all("SELECT id,data FROM entities WHERE type='LeaveGrantState'")) { const d = JSON.parse(r.data); states[d.user_id] = { id: r.id, d }; }

  // One attendance query for the whole window, grouped by employee.
  const att = {};
  for (const r of await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date'>=$1 AND data::jsonb->>'date'<=$2", [GRANT_START_DATE, upTo])) {
    const a = JSON.parse(r.data);
    ((att[a.user_id] ||= {})[a.date] ||= []).push(a);
  }

  for (const emp of employees) {
    try {
      const doj = emp.date_of_joining ? String(emp.date_of_joining).slice(0, 10) : '';
      const begin = doj && doj > GRANT_START_DATE ? doj : GRANT_START_DATE;
      let st = states[emp.user_id];
      // a brand new state has nothing to recount, so it starts on the current rules
      if (!st) st = { id: null, d: { id: uuidv4(), user_id: emp.user_id, last_processed: addDays(begin, -1), counters: { CL: 0, SL: 0, EL: 0 }, grants_by_year: {}, log: [], rules_version: RULES_VERSION } };
      const d = st.d;
      const before = JSON.stringify(d);
      const due = planGrants({ emp, byDate: att[emp.user_id] || {}, state: d, upTo, today, policies });
      if (st.id && JSON.stringify(d) === before) continue;
      if (d.log.length > 200) d.log = d.log.slice(-200);
      // State first, credit second: a crash in between can at worst miss one credit (visible in `log`), never double-credit it on the next run.
      if (st.id) await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), st.id]);
      else await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveGrantState',$2,'active',$3)", [d.id, emp.user_id, JSON.stringify(d)]);
      for (const g of due) {
        await creditBalance(emp.user_id, policies[g.code], g.year, g.days);
        out.grants++; out.days_granted += g.days;
        await notify(emp.user_id, `${g.code} credited`, `${g.days} day of ${policies[g.code].name || g.code} was credited for ${g.why}.`);
      }
      out.employees++;
    } catch (e) { out.errors++; console.warn('[leave-grant] failed for', emp.user_id, e.message); }
  }
  console.log('[leave-grant]', JSON.stringify(out));
  return out;
}
