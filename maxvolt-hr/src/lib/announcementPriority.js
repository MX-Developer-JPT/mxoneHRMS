// Which announcements a dashboard shows, and in what order. Pure rules (unit-tested in backend/tests/announcementPriority.test.mjs).
//   • urgent first, then unread, then newest;
//   • everything unread stays (for UNREAD_DAYS) until it is read;
//   • one already read drops off the dashboard after READ_DAYS (urgent ones stay 3 × as long);
//   • the dashboard shows at most MAX_SHOWN, the rest are one click away.
export const MAX_SHOWN = 4;
export const UNREAD_DAYS = 90;
export const READ_DAYS = 7;

export const dateOf = (a) => new Date(a.publish_date || a.created_date || 0);
export const ageDays = (a, now = Date.now()) => Math.max(0, (now - dateOf(a).getTime()) / 86400000);
export const isRead = (a, userId) => Array.isArray(a.read_by) && a.read_by.some(r => r.user_id === userId);

export function pickAnnouncements(list, userId, now = Date.now()) {
  const wanted = (list || []).filter(a => {
    const age = ageDays(a, now);
    if (!isRead(a, userId)) return age <= UNREAD_DAYS;
    return age <= (a.category === 'urgent' ? READ_DAYS * 3 : READ_DAYS);
  });
  return wanted.sort((a, b) => (b.category === 'urgent') - (a.category === 'urgent') || (isRead(a, userId) - isRead(b, userId)) || dateOf(b) - dateOf(a));
}

export function whenLabel(a, now = Date.now()) {
  const d = Math.floor(ageDays(a, now));
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return dateOf(a).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
