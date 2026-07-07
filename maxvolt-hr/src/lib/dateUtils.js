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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Current instant as an "IST digits + Z" ISO string, matching the storage
// convention used everywhere else in this app (see comment at top of file).
export const nowIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString();

export const safeDate = (dateStr, fmt = 'MMM d, yyyy') => {
  if (!dateStr) return '—';
  try { const d = parseTs(dateStr); return isValid(d) ? format(d, fmt) : '—'; } catch { return '—'; }
};

export const safeTime = (ts) => {
  if (!ts) return '—';
  try {
    const d = parseTs(ts);
    if (!isValid(d)) return '—';
    // Legacy records created before the IST-digit fix were stored in real UTC.
    // When parseTs strips the Z and parses as local (IST), a UTC 03:30 becomes
    // "3:30 AM IST" — 5:30 h too early. Heuristic: if the resulting local hour
    // is < 5 and the original string had a Z suffix (full ISO datetime), it's
    // almost certainly a pre-fix UTC-stored timestamp → add IST offset to display.
    const str = String(ts).trim();
    const isFullIsoWithZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str) && str.includes('Z');
    if (isFullIsoWithZ && d.getHours() < 5) {
      return format(new Date(d.getTime() + IST_OFFSET_MS), 'h:mm a');
    }
    return format(d, 'h:mm a');
  } catch { return '—'; }
};
