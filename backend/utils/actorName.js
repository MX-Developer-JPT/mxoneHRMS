// The sign-in token carries an id and an email but no name, so anything recording "who did this" needs the name read from
// the database. withName() adds full_name (and display_name) to the signed-in user of a request.
const TTL = 60 * 1000;
const cache = new Map();   // user id -> { name, at }

export const clearActorNames = () => cache.clear();

async function dbName(id) {
  const { one } = await import('../db.js');
  const r = await one("SELECT u.full_name, u.display_name, e.data::jsonb->>'display_name' AS employee_name FROM users u LEFT JOIN entities e ON e.type='Employee' AND e.user_id=u.id WHERE u.id=$1 LIMIT 1", [id]);
  return r?.employee_name || r?.display_name || r?.full_name || '';
}

/** The same user with their name. Never throws: if the name cannot be read, the user is returned as it was. */
export async function withName(user, lookup = dbName) {
  if (!user?.id || user.full_name) return user;
  let hit = cache.get(user.id);
  if (!hit || Date.now() - hit.at > TTL) {
    try { hit = { name: await lookup(user.id), at: Date.now() }; } catch (e) { console.warn('[actor-name] not read:', e.message); return user; }
    if (cache.size > 2000) cache.clear();
    cache.set(user.id, hit);
  }
  return hit.name ? { ...user, full_name: hit.name, display_name: user.display_name || hit.name } : user;
}
