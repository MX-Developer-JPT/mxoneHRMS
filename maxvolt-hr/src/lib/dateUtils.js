import { format, isValid } from 'date-fns';

// All timestamps in this app are stored as "IST clock digits + Z"
// (e.g. "2026-06-25T09:30:00.000Z" means 9:30 AM IST, NOT 9:30 UTC).
// To display correctly we strip the tz suffix and parse as local time so
// JavaScript treats the raw digits as the display value regardless of the
// browser's timezone setting.
const parseTs = (s) => {
  const str = String(s).trim();
  // HH:MM or HH:MM:SS — time-only
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    return new Date(`1970-01-01T${str.length <= 5 ? str + ':00' : str}`);
  }
  // yyyy-MM-dd — date-only, anchor at midnight local
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00');
  // ISO with or without tz suffix — strip any tz marker so the raw digits
  // are parsed as local time (matching the "IST digits" stored convention)
  const naked = str.replace(' ', 'T').replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
  return new Date(naked);
};

export const safeDate = (dateStr, fmt = 'MMM d, yyyy') => {
  if (!dateStr) return '—';
  try { const d = parseTs(dateStr); return isValid(d) ? format(d, fmt) : '—'; } catch { return '—'; }
};

export const safeTime = (ts) => {
  if (!ts) return '—';
  try { const d = parseTs(ts); return isValid(d) ? format(d, 'h:mm a') : '—'; } catch { return '—'; }
};
