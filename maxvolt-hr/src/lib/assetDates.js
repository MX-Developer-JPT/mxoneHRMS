import { format, parseISO, isValid, isBefore } from 'date-fns';

// Asset / inventory dates come from forms, Excel imports and older records, so any of them can be empty or malformed.
// date-fns throws "Invalid time value" on a bad one, which used to blank the whole page — these never throw.
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : parseISO(String(v));
  return isValid(d) ? d : null;
};

/** Formats a date string/Date; returns `fallback` for empty or invalid values. */
export function fmtDate(v, pattern = 'dd MMM yyyy', fallback = '—') {
  const d = toDate(v);
  return d ? format(d, pattern) : fallback;
}

/** True when the date is valid and already past (used for "overdue return"). */
export function isPastDate(v) {
  const d = toDate(v);
  return !!d && isBefore(d, new Date());
}
