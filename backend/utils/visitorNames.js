// Visit records saved without a person's name (the host of an older invitation, who approved it, who let the visitor in)
// still hold that person's id. The names are filled in when the records are read; the stored records are not rewritten.
const FIELDS = [['host_user_id', 'host_name'], ['created_by', 'created_by_name'], ['approved_by', 'approved_by_name'], ['rejected_by', 'rejected_by_name'],
  ['cancelled_by', 'cancelled_by_name'], ['check_in_by', 'check_in_by_name'], ['check_out_by', 'check_out_by_name']];

/** `names` is a Map of user id -> name. Returns copies with the blanks filled (events included). */
export function fillNames(visits, names) {
  return visits.map((v) => {
    const out = { ...v };
    for (const [id, name] of FIELDS) if (!out[name] && out[id] && names.get(out[id])) out[name] = names.get(out[id]);
    if (Array.isArray(out.events)) out.events = out.events.map((e) => (!e.by_name && e.by_id && names.get(e.by_id) ? { ...e, by_name: names.get(e.by_id) } : e));
    return out;
  });
}

export const missingIds = (visits) => [...new Set(visits.flatMap((v) => [
  ...FIELDS.filter(([id, name]) => v[id] && !v[name]).map(([id]) => v[id]),
  ...(v.events || []).filter((e) => e.by_id && !e.by_name).map((e) => e.by_id),
]))];

/** fillNames() with the names read from the employee record, else the account. */
export async function withVisitorNames(visits) {
  const ids = missingIds(visits);
  if (!ids.length) return visits;
  const { all } = await import('../db.js');
  const rows = await all("SELECT u.id, u.full_name, u.display_name, u.email, e.data::jsonb->>'display_name' AS employee_name FROM users u LEFT JOIN entities e ON e.type='Employee' AND e.user_id=u.id WHERE u.id = ANY($1::text[])", [ids]);
  // someone whose account is gone may still have an employee record
  const orphans = await all("SELECT user_id AS id, data::jsonb->>'display_name' AS employee_name FROM entities WHERE type='Employee' AND user_id = ANY($1::text[])", [ids]);
  const names = new Map();
  for (const r of [...orphans, ...rows]) { const n = r.employee_name || r.display_name || r.full_name || r.email; if (n) names.set(r.id, n); }
  return fillNames(visits, names);
}
