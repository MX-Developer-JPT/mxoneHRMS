// Monthly Roaster credit: every active employee working at Duhai gets 1 Roaster holiday per calendar month.
// The job is idempotent — each balance row remembers which months it was credited for — so it can run daily
// (and at startup) and will also credit someone who joins Duhai or is transferred there part-way through a month.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { ROASTER_CODE, ROASTER_NAME, isDuhai } from '../utils/roaster.js';

export const ROASTER_START_MONTH = '2026-10';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);

// Find-or-create the Roaster leave policy. Created like the other earned policies: no yearly allotment, no carry forward.
export async function ensureRoasterPolicy() {
  const row = await one("SELECT id,data,is_active FROM entities WHERE type='LeavePolicy' AND (data::jsonb->>'code'=$1 OR data::jsonb->>'name'=$2)", [ROASTER_CODE, ROASTER_NAME]);
  if (row) {
    const pd = JSON.parse(row.data);
    if (!row.is_active || pd.is_active !== true) await run("UPDATE entities SET is_active=1, data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ ...pd, is_active: true }), row.id]);
    return { ...pd, id: pd.id || row.id };
  }
  const id = uuidv4();
  const pol = { id, name: ROASTER_NAME, code: ROASTER_CODE, total_days: 0, accrual: 'earned', carry_forward: false, is_active: true,
    description: 'One Roaster holiday per month for employees working at Duhai. Can be taken only on a Saturday (one day, once a month).' };
  await run("INSERT INTO entities(id,type,user_id,status,is_active,data) VALUES($1,'LeavePolicy',NULL,'active',1,$2)", [id, JSON.stringify(pol)]);
  return pol;
}

async function notify(userId, message) {
  try {
    await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [uuidv4(), userId, 'Roaster holiday credited', message, 'success', '/Leave']);
    const { sendPushToUser } = await import('../utils/push.js');
    sendPushToUser(userId, { title: 'Roaster holiday credited', message, type: 'success', link: '/Leave' });
  } catch (e) { console.warn('[roaster] notify failed:', e.message); }
}

export async function runRoasterCredits() {
  const out = { eligible: 0, credited: 0, errors: 0 };
  const month = istNow().toISOString().slice(0, 7);
  if (month < ROASTER_START_MONTH) return out;
  const year = Number(month.slice(0, 4));
  const policy = await ensureRoasterPolicy();
  const employees = (await all("SELECT data FROM entities WHERE type='Employee' AND status='active'")).map(r => JSON.parse(r.data)).filter(e => e.user_id && isDuhai(e));
  out.eligible = employees.length;
  const balances = {};
  for (const r of await all("SELECT id,data FROM entities WHERE type='LeaveBalance' AND data::jsonb->>'leave_policy_id'=$1", [policy.id])) {
    const d = JSON.parse(r.data); if (Number(d.year) === year) balances[d.user_id] = { id: r.id, d };
  }
  for (const emp of employees) {
    try {
      const b = balances[emp.user_id];
      if (b) {
        const months = b.d.roaster_credited_months || [];
        if (months.includes(month)) continue;
        const d = { ...b.d, roaster_credited_months: [...months, month], total_allocated: (b.d.total_allocated || 0) + 1, accrued_this_year: (b.d.accrued_this_year || 0) + 1, available: (b.d.available || 0) + 1 };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), b.id]);
      } else {
        const id = uuidv4();
        const d = { id, user_id: emp.user_id, leave_policy_id: policy.id, year, total_allocated: 1, accrued_this_year: 1, used: 0, pending_approval: 0, available: 1, carried_forward: 0, roaster_credited_months: [month] };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveBalance',$2,'active',$3)", [id, emp.user_id, JSON.stringify(d)]);
      }
      out.credited++;
      await notify(emp.user_id, '1 Roaster holiday was credited for this month. You can take it on any Saturday from the Leave page.');
    } catch (e) { out.errors++; console.warn('[roaster] failed for', emp.user_id, e.message); }
  }
  console.log('[roaster]', JSON.stringify(out));
  return out;
}
