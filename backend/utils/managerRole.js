// Someone named as a reporting manager must be able to reach the approval screens for their team. They get the team-scoped
// "manager" role — never "management", which is organisation-wide. Anyone who already holds another role keeps it.
const BASIC_ROLES = ['', 'user', 'employee', 'onboarding_pending'];

export const needsManagerRole = (user) => !!user && BASIC_ROLES.includes(String(user.custom_role || user.role || ''));

/** Gives a basic account the manager role. Returns true when the role changed. */
export async function ensureManagerRole(userId, db) {
  if (!userId) return false;
  const { one, run } = db || (await import('../db.js'));
  const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [userId]);
  if (!needsManagerRole(u)) return false;
  await run("UPDATE users SET role='manager', custom_role='manager', updated_at=NOW()::TEXT WHERE id=$1", [userId]);
  return true;
}
