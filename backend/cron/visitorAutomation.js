// Visitors still "checked in" after the day they arrived were never checked out by the gate.
// Left alone they show as "Currently Inside" forever and distort the headcount. Once the day has passed they are closed
// as checked out at the end of that day, flagged auto_checked_out so the register shows it was not a real gate scan.
import { all, run } from '../db.js';

export async function closeStaleVisitors() {
  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);   // IST digits, same convention as the visitor check-in times
  const rows = await all("SELECT id, data FROM entities WHERE type='Visitor' AND status='checked_in'");
  let closed = 0;
  for (const r of rows) {
    let v; try { v = JSON.parse(r.data); } catch { continue; }
    const inDay = String(v.check_in_time || '').slice(0, 10);
    if (v.status !== 'checked_in' || !inDay || inDay >= todayIST) continue;
    const upd = { ...v, status: 'checked_out', check_out_time: `${inDay}T23:59:00.000Z`, check_out_by: null, check_out_by_name: 'System (auto)', auto_checked_out: true };
    await run("UPDATE entities SET status='checked_out', data=$1, updated_at=NOW()::TEXT WHERE id=$2 AND status='checked_in'", [JSON.stringify(upd), r.id]);
    closed++;
  }
  return { checked: rows.length, closed };
}
