// Visitors still "checked in" after the day they arrived were never checked out by the gate.
// Left alone they show as "Currently Inside" forever and distort the headcount. Once the day has passed they are closed,
// flagged auto_checked_out. No exit time is made up: it stays empty ("not recorded"), and the moment of closing is kept.
import { all, run } from '../db.js';
import { withEvent } from '../utils/visitorRecord.js';

export async function closeStaleVisitors() {
  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);   // IST digits, same convention as the visitor check-in times
  const rows = await all("SELECT id, data FROM entities WHERE type='Visitor' AND status='checked_in'");
  let closed = 0;
  for (const r of rows) {
    let v; try { v = JSON.parse(r.data); } catch { continue; }
    const inDay = String(v.check_in_time || '').slice(0, 10);
    if (v.status !== 'checked_in' || !inDay || inDay >= todayIST) continue;
    const at = new Date().toISOString();
    const upd = withEvent({ ...v, status: 'checked_out', check_out_time: null, check_out_by: null, check_out_by_name: 'System (auto)', auto_checked_out: true, auto_closed_at: at }, 'auto_closed', { by_name: 'System' }, at);
    await run("UPDATE entities SET status='checked_out', data=$1, updated_at=NOW()::TEXT WHERE id=$2 AND status='checked_in'", [JSON.stringify(upd), r.id]);
    closed++;
  }
  return { checked: rows.length, closed };
}
