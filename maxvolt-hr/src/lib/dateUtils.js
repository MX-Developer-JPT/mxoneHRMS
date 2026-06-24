import { format, isValid } from 'date-fns';

export const safeDate = (dateStr, fmt = 'MMM d, yyyy') => {
  if (!dateStr) return '—';
  try {
    const s = String(dateStr).trim();
    // date-only strings (yyyy-MM-dd) must get a T00:00:00 to avoid UTC midnight shift
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s.replace(' ', 'T'));
    return isValid(d) ? format(d, fmt) : '—';
  } catch { return '—'; }
};

export const safeTime = (ts) => {
  if (!ts) return '—';
  try {
    const d = new Date(String(ts).replace(' ', 'T'));
    return isValid(d) ? format(d, 'h:mm a') : '—';
  } catch { return '—'; }
};
