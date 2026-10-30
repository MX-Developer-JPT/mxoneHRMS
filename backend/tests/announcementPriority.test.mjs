// Dashboard announcement ordering rules — pure tests. Run: node backend/tests/announcementPriority.test.mjs
import assert from 'node:assert/strict';
import { pickAnnouncements, isRead, isNew, tierOf, whenLabel, MAX_SHOWN, NEW_DAYS, URGENT_STICKY_DAYS } from '../../maxvolt-hr/src/lib/announcementPriority.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const NOW = Date.parse('2026-10-30T10:00:00Z');
const day = (d) => new Date(NOW - d * 86400000).toISOString();
const A = (id, category, daysAgo, readBy = []) => ({ id, category, title: id, created_date: day(daysAgo), read_by: readBy.map(u => ({ user_id: u })) });
const ids = (l) => l.map(a => a.id);

t('nothing is ever dropped: a read announcement from months ago is still listed', () => {
  // the real situation: a single 53-day-old announcement that 144 people have read
  const only = [A('gate-pass', 'general', 53, ['me', 'u2', 'u3'])];
  assert.deepEqual(ids(pickAnnouncements(only, 'me', NOW)), ['gate-pass']);
  assert.equal(pickAnnouncements([A('ancient', 'general', 900, ['me'])], 'me', NOW).length, 1);
  assert.equal(pickAnnouncements([A('ancient-unread', 'general', 900)], 'me', NOW).length, 1);
});

t('order: new urgent, new (newest first), recent urgent already read, then everything else newest first', () => {
  const l = [
    A('old-read', 'general', 30, ['me']), A('new-general-old', 'general', 5), A('new-general-new', 'general', 1),
    A('urgent-read-recent', 'urgent', 4, ['me']), A('new-urgent', 'urgent', 9), A('read-newest', 'general', 0, ['me']),
  ];
  assert.deepEqual(ids(pickAnnouncements(l, 'me', NOW)), ['new-urgent', 'new-general-new', 'new-general-old', 'urgent-read-recent', 'read-newest', 'old-read']);
});

t('read state is per person', () => {
  const a = A('x', 'general', 1, ['someone-else']);
  assert.equal(isRead(a, 'me'), false); assert.equal(isRead(a, 'someone-else'), true);
  assert.equal(isNew(a, 'me', NOW), true); assert.equal(isNew(a, 'someone-else', NOW), false);
  assert.equal(isRead({ id: 'y' }, 'me'), false, 'no read_by at all');
});

t('"new" means unread AND published within 90 days — an old unread one is listed but not flagged new', () => {
  assert.equal(isNew(A('u', 'general', NEW_DAYS - 1), 'me', NOW), true);
  assert.equal(isNew(A('u', 'general', NEW_DAYS + 1), 'me', NOW), false);
  assert.equal(tierOf(A('u', 'general', NEW_DAYS + 1), 'me', NOW), 3);
  const l = [A('last-year-unread', 'general', 400), A('read-recent', 'general', 3, ['me'])];
  assert.deepEqual(ids(pickAnnouncements(l, 'me', NOW)), ['read-recent', 'last-year-unread'], 'recent beats ancient even though one is unread');
});

t('an urgent announcement stays prominent for three weeks after being read, then is just another one', () => {
  assert.equal(tierOf(A('r', 'urgent', URGENT_STICKY_DAYS - 1, ['me']), 'me', NOW), 2);
  assert.equal(tierOf(A('r', 'urgent', URGENT_STICKY_DAYS + 1, ['me']), 'me', NOW), 3);
  assert.equal(tierOf(A('n', 'urgent', 200), 'me', NOW), 3, 'an unread urgent from long ago is not "new"');
});

t('reading something moves it down; an empty list stays empty', () => {
  assert.deepEqual(ids(pickAnnouncements([A('a', 'general', 1), A('b', 'general', 2)], 'me', NOW)), ['a', 'b']);
  assert.deepEqual(ids(pickAnnouncements([A('a', 'general', 1, ['me']), A('b', 'general', 2)], 'me', NOW)), ['b', 'a']);
  assert.deepEqual(pickAnnouncements([], 'me', NOW), []); assert.deepEqual(pickAnnouncements(null, 'me', NOW), []);
});

t('publish_date wins over created_date; the input list is not modified', () => {
  const a = { id: 'a', category: 'general', created_date: day(100), publish_date: day(1) };
  const b = A('b', 'general', 50, ['me']);
  assert.deepEqual(ids(pickAnnouncements([b, a], 'me', NOW)), ['a', 'b']);
  const input = [b, a]; pickAnnouncements(input, 'me', NOW); assert.deepEqual(ids(input), ['b', 'a']);
});

t('labels: today, yesterday, n days ago, then a date (with the year when it is old); the panel shows at most 4', () => {
  assert.equal(whenLabel(A('a', 'x', 0), NOW), 'Today'); assert.equal(whenLabel(A('a', 'x', 1), NOW), 'Yesterday'); assert.equal(whenLabel(A('a', 'x', 3), NOW), '3 days ago');
  assert.match(whenLabel(A('a', 'x', 53), NOW), /Sep/); assert.match(whenLabel(A('a', 'x', 400), NOW), /20\d\d/); assert.equal(MAX_SHOWN, 4);
});

console.log(`\n${n} announcement-priority tests passed`);
