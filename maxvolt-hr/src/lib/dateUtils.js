import { format, isValid } from 'date-fns';

const parseTs = (s) => {
  const str = String(s).trim();
  // HH:MM or HH:MM:SS — time-only, no date part
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) return new Date(`1970-01-01T${str.length === 5 ? str + ':00' : str}`);
  // yyyy-MM-dd — date-only, anchor at midnight local
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00');
  // everything else (ISO with T or space separator)
  return new Date(str.replace(' ', 'T'));
};

export const safeDate = (dateStr, fmt = 'MMM d, yyyy') => {
  if (!dateStr) return '—';
  try { const d = parseTs(dateStr); return isValid(d) ? format(d, fmt) : '—'; } catch { return '—'; }
};

export const safeTime = (ts) => {
  if (!ts) return '—';
  try { const d = parseTs(ts); return isValid(d) ? format(d, 'h:mm a') : '—'; } catch { return '—'; }
};
