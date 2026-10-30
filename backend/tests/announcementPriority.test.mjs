// Dashboard announcement ordering rules — pure tests. Run: node backend/tests/announcementPriority.test.mjs
import assert from 'node:assert/strict';
import { pickAnnouncements, isRead, whenLabel, MAX_SHOWN, READ_DAYS, UNREAD_DAYS } from '../../maxvolt-hr/src/lib/announcementPriority.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const NOW = Date.parse('2026-10-30T10:00:00Z');
const day = (d) => new Date(NOW - d * 86400000).toISOString();
const A = (id, category, daysAgo, readBy = []) => ({ id, category, title: id, created_date: day(daysAgo), read_by: readBy.map(u => ({ user_id: u })) });
const ids = (l) => l.map(a => a.id);

t('urgent first, then unread, then newest', () => {
  const l = [A('old-general', 'general', 5), A('new-general', 'general', 1), A('urgent-old', 'urgent', 10), A('read-new', 'general', 0, ['me'])];
  assert.deepEqual(ids(pickAnnouncements(l, 'me', NOW)), ['urgent-old', 'new-general', 'old-general', 'read-new']);
});

t('an unread urgent announcement beats a newer unread one; read ones sink below unread ones', () => {
  const l = [A('read-urgent', 'urgent', 1, ['me']), A('unread-general', 'general', 3), A('unread-urgent', 'urgent', 8)];
  assert.deepEqual(ids(pickAnnouncements(l, 'me', NOW)), ['unread-urgent', 'read-urgent', 'unread-general'], 'urgent (any state) is above general; unread above read within a group');
});

t('read state is per person', () => {
  const a = A('x', 'general', 1, ['someone-else']);
  assert.equal(isRead(a, 'me'), false); assert.equal(isRead(a, 'someone-else'), true);
  assert.equal(isRead({ id: 'y' }, 'me'), false, 'no read_by at all');
});

t('unread stays for 90 days, then goes', () => {
  assert.equal(pickAnnouncements([A('u', 'general', UNREAD_DAYS - 1)], 'me', NOW).length, 1);
  assert.equal(pickAnnouncements([A('u', 'general', UNREAD_DAYS + 1)], 'me', NOW).length, 0);
});

t('a read announcement drops off after a week; a read urgent one stays three times as long', () => {
  assert.equal(pickAnnouncements([A('r', 'general', READ_DAYS - 1, ['me'])], 'me', NOW).length, 1);
  assert.equal(pickAnnouncements([A('r', 'general', READ_DAYS + 1, ['me'])], 'me', NOW).length, 0);
  assert.equal(pickAnnouncements([A('r', 'urgent', READ_DAYS * 3 - 1, ['me'])], 'me', NOW).length, 1);
  assert.equal(pickAnnouncements([A('r', 'urgent', READ_DAYS * 3 + 1, ['me'])], 'me', NOW).length, 0);
});

t('reading something makes it sink; nothing left means nothing is shown', () => {
  const before = pickAnnouncements([A('a', 'general', 1), A('b', 'general', 2)], 'me', NOW);
  assert.deepEqual(ids(before), ['a', 'b']);
  assert.deepEqual(ids(pickAnnouncements([A('a', 'general', 1, ['me']), A('b', 'general', 2)], 'me', NOW)), ['b', 'a']);
  assert.deepEqual(pickAnnouncements([], 'me', NOW), []); assert.deepEqual(pickAnnouncements(null, 'me', NOW), []);
});

t('publish_date wins over created_date for age and order', () => {
  const a = { id: 'a', category: 'general', created_date: day(100), publish_date: day(1) };
  assert.equal(pickAnnouncements([a], 'me', NOW).length, 1, 'recently published although created long ago');
});

t('labels: today, yesterday, n days ago, then a date; the panel shows at most 4', () => {
  assert.equal(whenLabel(A('a', 'x', 0), NOW), 'Today'); assert.equal(whenLabel(A('a', 'x', 1), NOW), 'Yesterday'); assert.equal(whenLabel(A('a', 'x', 3), NOW), '3 days ago');
  assert.match(whenLabel(A('a', 'x', 20), NOW), /\d/); assert.equal(MAX_SHOWN, 4);
});

console.log(`\n${n} announcement-priority tests passed`);
