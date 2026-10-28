// Working-day based leave grants (replaces the monthly total/12 accrual for CL, SL and EL).
//   • CL: +1 day for every 40 working days
//   • SL: +1 day for every 40 working days — only for employees in the manager tier or above
//   • EL: +1 day for every 20 working days — only after probation is completed
// Counting starts on 1 October 2026 (or the joining date if later). A "working day" is any day the
// employee was on paid status: present / on duty / WFH / leave / holiday / weekly off count; absent,
// LOP and short-attendance days do not; a half-day with no leave behind it counts 0.5 (same rule as payroll).
// Per-employee progress is kept in a LeaveGrantState entity so the job is catch-up safe and idempotent.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';

export const GRANT_START_DATE = '2026-10-01';
export const GRANT_RULES = {
  CL: { every: 40, grant: 1, tiers: null },
  SL: { every: 40, grant: 1, tiers: ['manager', 'general_manager', 'director'] },
  EL: { every: 20, grant: 1, needsConfirmation: true },
};
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istDate = (offset = 0) => new Date(Date.now() + IST_OFFSET_MS + offset * 86400000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

const NOT_PAID = new Set(['absent', 'lop', 'short_attendance']);
// 1 = full working day, 0.5 = partial, 0 = not counted
export function dayCredit(rec) {
  if (!rec) return 1; // no row = scheduled off-day / holiday (nightly job marks missed working days absent)
  const s = rec.status;
  if (NOT_PAID.has(s)) return 0;
  if (s === 'half_day' && !rec.leave_id) return 0.5;
  return 1;
}

export function isOnProbation(emp, ds) {
  const confDate = emp.employee_confirmation_date || emp.confirmation_date || '';
  const probationNow = emp.employee_status === 'probation' || (!emp.employee_status && !confDate);
  if (probationNow) return true;
  return !!confDate && ds < String(confDate).slice(0, 10);
}

// Stricter than isOnProbation (which also treats a blank status as probation for accrual): applying for EL is
// blocked only for an employee explicitly on probation, or whose confirmation date has not arrived yet.
export function elBlockedByProbation(emp, ds) {
  const confDate = String(emp?.employee_confirmation_date || emp?.confirmation_date || '').slice(0, 10);
  return emp?.employee_status === 'probation' || (!!confDate && ds < confDate);
}

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

export async function runLeaveGrants({ upTo = istDate(-1) } = {}) {
  const out = { employees: 0, days_processed: 0, grants: 0, errors: 0 };
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
      if (!st) st = { id: null, d: { id: uuidv4(), user_id: emp.user_id, last_processed: addDays(begin, -1), counters: { CL: 0, SL: 0, EL: 0 }, grants_by_year: {}, log: [] } };
      const d = st.d;
      if (d.last_processed >= upTo) continue;
      let changed = false;
      for (let ds = addDays(d.last_processed, 1); ds <= upTo; ds = addDays(ds, 1)) {
        if (ds < begin) { d.last_processed = ds; continue; }
        const rows = att[emp.user_id]?.[ds] || [];
        const credit = rows.length ? Math.max(...rows.map(dayCredit)) : 1;
        out.days_processed++;
        if (credit > 0) {
          for (const [code, rule] of Object.entries(GRANT_RULES)) {
            if (!policies[code]) continue;
            if (rule.tiers && !rule.tiers.includes(emp.designation_tier)) continue;
            if (rule.needsConfirmation && isOnProbation(emp, ds)) continue;
            d.counters[code] = (d.counters[code] || 0) + credit;
            while (d.counters[code] >= rule.every) {
              d.counters[code] -= rule.every;
              const year = Number(ds.slice(0, 4));
              const used = (d.grants_by_year[year] ||= {});
              const cap = policies[code].total_days || Infinity;
              if ((used[code] || 0) + rule.grant > cap) continue; // annual policy cap reached
              await creditBalance(emp.user_id, policies[code], year, rule.grant);
              used[code] = (used[code] || 0) + rule.grant;
              d.log.push({ date: ds, code, days: rule.grant });
              out.grants++;
              await notify(emp.user_id, `${code} credited`, `${rule.grant} day of ${policies[code].name || code} was credited for completing ${rule.every} working days.`);
            }
          }
        }
        d.last_processed = ds; changed = true;
      }
      if (changed || !st.id) {
        if (d.log.length > 200) d.log = d.log.slice(-200);
        if (st.id) await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), st.id]);
        else await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveGrantState',$2,'active',$3)", [d.id, emp.user_id, JSON.stringify(d)]);
      }
      out.employees++;
    } catch (e) { out.errors++; console.warn('[leave-grant] failed for', emp.user_id, e.message); }
  }
  console.log('[leave-grant]', JSON.stringify(out));
  return out;
}
