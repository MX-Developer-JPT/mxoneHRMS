// The history of one visit (pure). Every action appends an event stamped with the server's clock as a true instant (UTC ISO,
// to the millisecond); screens and exports show it in India time. Older records only have separate time fields, from which
// the same history is rebuilt: check_in_time / check_out_time are stored as India clock digits written with a "Z", while
// approved_at / rejected_at / cancelled_at are true instants.
export const EVENT_LABELS = {
  invited: 'Invited', registered: 'Registered at the gate', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
  pass_scanned: 'Pass scanned', checked_in: 'Checked in', checked_out: 'Checked out', auto_closed: 'Closed automatically (exit not recorded)',
};
const IST = 5.5 * 3600000;
const MAX_EVENTS = 200;

/** A new copy of the visit with one more event. */
export function withEvent(visit, action, { by = null, by_name = '', via = '', note = '' } = {}, at = new Date().toISOString()) {
  const event = { action, at, by_id: by, by_name, ...(via ? { via } : {}), ...(note ? { note: String(note).slice(0, 300) } : {}) };
  return { ...visit, events: [...(Array.isArray(visit.events) ? visit.events : []), event].slice(-MAX_EVENTS) };
}

/** "India digits" stamp -> the true instant. */
export const instantOfIstDigits = (s) => { const t = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(String(s)) ? s : `${s}Z`); return Number.isFinite(t) ? new Date(t - IST).toISOString() : ''; };
const trueInstant = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/** The visit's history, oldest first: recorded events, plus those older records only hold in their time fields. */
export function visitTimeline(v) {
  const events = [...(Array.isArray(v.events) ? v.events : [])];
  const have = new Set(events.map((e) => e.action));
  const add = (action, at, by_name) => { if (at && !have.has(action)) events.push({ action, at, by_name: by_name || '' }); };
  if (!have.has('invited') && !have.has('registered')) add(v.source === 'walk_in' ? 'registered' : 'invited', trueInstant(v.registered_at || v.created_at), v.created_by_name);
  add('approved', trueInstant(v.approved_at), v.approved_by_name);
  add('rejected', trueInstant(v.rejected_at), v.rejected_by_name);
  add('cancelled', trueInstant(v.cancelled_at), v.cancelled_by_name);
  if (v.check_in_time) add('checked_in', instantOfIstDigits(v.check_in_time), v.check_in_by_name);
  if (v.check_out_time && !v.auto_checked_out) add('checked_out', instantOfIstDigits(v.check_out_time), v.check_out_by_name);
  if (v.auto_checked_out) add('auto_closed', trueInstant(v.auto_closed_at), 'System');
  return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The real exit time of a visit; nothing when the day was closed automatically (older records hold a made-up 23:59). */
export const exitTime = (v) => (v?.auto_checked_out ? '' : v?.check_out_time || '');

/** "28 Nov 2026 4:05:09 PM" in India time for a true instant. */
export function istText(instant) {
  const t = Date.parse(String(instant || ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + IST);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const h = d.getUTCHours();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())} ${mon} ${d.getUTCFullYear()} ${h % 12 || 12}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${h >= 12 ? 'PM' : 'AM'}`;
}
