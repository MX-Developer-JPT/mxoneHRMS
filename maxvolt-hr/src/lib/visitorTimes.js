// The history and times of a visit for the screens. Mirrors backend/utils/visitorRecord.js: events and approved_at /
// rejected_at / cancelled_at are true instants; check_in_time / check_out_time are India clock digits written with a "Z".
export const EVENT_LABELS = {
  invited: 'Invited', registered: 'Registered at the gate', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
  pass_scanned: 'Pass scanned', checked_in: 'Checked in', checked_out: 'Checked out', auto_closed: 'Closed automatically (exit not recorded)',
};
const IST = 5.5 * 3600000;
const trueInstant = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const instantOfIstDigits = (s) => { const t = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(String(s)) ? s : `${s}Z`); return Number.isFinite(t) ? new Date(t - IST).toISOString() : ''; };

export function visitTimeline(v) {
  const events = [...(Array.isArray(v?.events) ? v.events : [])];
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

/** A true instant as India date and time, to the second. */
export const istText = (instant) => {
  const t = Date.parse(String(instant || ''));
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }) : '—';
};

/** The real exit time; nothing when the day was closed automatically (older records hold a made-up 23:59). */
export const exitTime = (v) => (v?.auto_checked_out ? '' : v?.check_out_time || '');
