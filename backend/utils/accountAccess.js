// Account access for people who have left.
//
// When an employee's exit takes effect (their exit date is today or earlier) the login account is DISABLED:
//   • the password is scrambled and every token already issued stops working at once (blockDisabledTokens),
//   • the login e-mail is moved aside to an unroutable placeholder and remembered in `former_email`, which frees the
//     address — HR can invite the same person again (Onboarding) with that same e-mail and a brand-new account is created.
// Nothing is deleted: the employee record, attendance, payroll, documents and history stay attached to the old account.
// Restoring a left employee (restoreLeftEmployee) re-enables the old account if its e-mail is still free.
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { one, all, run } from '../db.js';

const LEFT = ['resigned', 'terminated', 'retired'];
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// ids of disabled accounts, kept in memory so the request guard costs nothing; refreshed from the DB every minute
let disabled = new Set();
export async function refreshDisabled() {
  try { disabled = new Set((await all('SELECT id FROM users WHERE disabled_at IS NOT NULL')).map(r => r.id)); }
  catch (e) { console.error('[account-access] refresh failed:', e.message); }
}
export function startDisabledRefresh() { refreshDisabled(); setInterval(refreshDisabled, 60 * 1000).unref?.(); }

/** Express guard: a token that belongs to a disabled account is refused everywhere. */
export function blockDisabledTokens(req, res, next) {
  const h = req.headers.authorization;
  if (h && disabled.size) {
    const d = jwt.decode(h.replace('Bearer ', ''));
    if (d?.id && disabled.has(d.id)) return res.status(401).json({ error: 'Your account has been disabled. Please contact HR.', code: 'account_disabled' });
  }
  next();
}

export async function disableAccount(userId, { reason = 'exit', by = null } = {}) {
  const u = await one('SELECT id, email, role, custom_role, disabled_at FROM users WHERE id=$1', [userId]);
  if (!u || u.disabled_at) return { ok: false, skipped: 'not found or already disabled' };
  if ([u.role, u.custom_role].includes('admin')) return { ok: false, skipped: 'admin accounts are never disabled automatically' };
  const moved = `${u.email}.disabled-${String(u.id).slice(0, 8)}`;
  await run('UPDATE users SET former_email=$1, email=$2, password=$3, disabled_at=$4, disabled_reason=$5, updated_at=NOW()::TEXT WHERE id=$6',
    [u.email, moved, bcrypt.hashSync(randomBytes(24).toString('hex'), 10), new Date().toISOString(), reason, userId]);
  disabled.add(userId);
  try { await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [uuidv4(), by, JSON.stringify({ entity_type: 'User', entity_id: userId, change_type: 'account_disabled', reason, former_email: u.email, timestamp: new Date().toISOString() })]); } catch { /* audit is best-effort */ }
  return { ok: true, former_email: u.email };
}

/** Brings a disabled account back (rehire of the same record). The e-mail must still be free; the password must be reset. */
export async function reenableAccount(userId) {
  const u = await one('SELECT id, former_email, disabled_at FROM users WHERE id=$1', [userId]);
  if (!u || !u.disabled_at) return { ok: true, unchanged: true };
  const taken = u.former_email ? await one('SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2', [u.former_email, userId]) : null;
  if (taken) return { ok: false, error: `${u.former_email} now belongs to a newer account, so the old login cannot be restored. Invite the person again through Onboarding instead.` };
  await run('UPDATE users SET email=COALESCE(former_email, email), former_email=NULL, disabled_at=NULL, disabled_reason=NULL, updated_at=NOW()::TEXT WHERE id=$1', [userId]);
  disabled.delete(userId);
  return { ok: true, email: u.former_email };
}

/** Disables the account of every left employee whose exit date has arrived. Safe to run repeatedly. */
export async function runAccountDisable() {
  const today = istToday();
  const rows = await all(`SELECT e.user_id, e.data FROM entities e JOIN users u ON u.id = e.user_id
    WHERE e.type='Employee' AND u.disabled_at IS NULL AND e.data::jsonb->>'status' = ANY($1)`, [LEFT]);
  let n = 0;
  for (const r of rows) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    const exit = String(d.exit_date || '').slice(0, 10);
    if (exit && exit > today) continue;                 // still serving until the last working day
    const res = await disableAccount(r.user_id, { reason: 'exit' });
    if (res.ok) n++;
  }
  if (n) console.log(`[account-access] disabled ${n} account(s) of employees who have left`);
  return n;
}

/** For one user right after an exit step: disable now if the exit date has arrived. */
export async function disableIfDue(userId) {
  const e = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
  if (!e) return null;
  let d; try { d = JSON.parse(e.data); } catch { return null; }
  if (!LEFT.includes(d.status)) return null;
  const exit = String(d.exit_date || '').slice(0, 10);
  if (exit && exit > istToday()) return null;
  return disableAccount(userId, { reason: 'exit' });
}
