// Which announcements a dashboard shows, and in what order. Pure rules (unit-tested in backend/tests/announcementPriority.test.mjs).
// Nothing ever disappears just because it has been read — the dashboard always shows the latest announcements, so people can come
// back to them; what changes is the ORDER and the highlight:
//   1. new urgent   2. new (newest first)   3. urgent read in the last URGENT_STICKY_DAYS   4. everything else, newest first
// "New" = not read yet and published within NEW_DAYS (an announcement from last year is not "new" to someone who joined since).
// The dashboard shows the first MAX_SHOWN; the rest are one click away.
export const MAX_SHOWN = 4;
export const NEW_DAYS = 90;
export const URGENT_STICKY_DAYS = 21;

export const dateOf = (a) => new Date(a.publish_date || a.created_date || 0);
export const ageDays = (a, now = Date.now()) => Math.max(0, (now - dateOf(a).getTime()) / 86400000);
export const isRead = (a, userId) => Array.isArray(a.read_by) && a.read_by.some(r => r.user_id === userId);
export const isNew = (a, userId, now = Date.now()) => !isRead(a, userId) && ageDays(a, now) <= NEW_DAYS;

export function tierOf(a, userId, now = Date.now()) {
  const urgent = a.category === 'urgent';
  if (isNew(a, userId, now)) return urgent ? 0 : 1;
  return urgent && ageDays(a, now) <= URGENT_STICKY_DAYS ? 2 : 3;
}

export function pickAnnouncements(list, userId, now = Date.now()) {
  return [...(list || [])].sort((a, b) => tierOf(a, userId, now) - tierOf(b, userId, now) || dateOf(b) - dateOf(a));
}

export function whenLabel(a, now = Date.now()) {
  const d = Math.floor(ageDays(a, now));
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return dateOf(a).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(d > 300 ? { year: 'numeric' } : {}) });
}
