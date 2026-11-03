// Visitor kiosk — pure rule tests. Run: node backend/tests/kiosk.test.mjs
import assert from 'node:assert/strict';
import { parseInvitationCode, validateVisit, publicVisit, safePhotoUrl, idReference, last10, maskMobile, makeLimiter, summariseByLocation, durationToDeparture, cleanText, groupFields } from '../utils/kiosk.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const QR = '11111111-2222-3333-4444-555555555555';
const NOW = Date.parse('2026-11-03T10:00:00Z');   // IST-digits-as-UTC "now"
const visit = (o = {}) => ({ id: 'abcd1234-0000-0000-0000-000000000001', visitor_name: 'A', mobile_number: '9812345678', location_name: 'Duhai', status: 'approved', expected_arrival: '2026-11-03T09:00:00.000Z', ...o });

t('codes: full QR in any case / without dashes, 8-character Pass ID, junk refused', () => {
  assert.deepEqual(parseInvitationCode(QR), { kind: 'qr', value: QR });
  assert.deepEqual(parseInvitationCode(QR.toUpperCase().replace(/-/g, '')), { kind: 'qr', value: QR });
  assert.deepEqual(parseInvitationCode(' ABCD-1234 '), { kind: 'pass_id', value: 'abcd1234' });
  for (const bad of ['', 'hello', 'x'.repeat(200), "' OR 1=1 --", '1234']) assert.equal(parseInvitationCode(bad).kind, null, bad);
});

t('an approved invitation is valid on its day, until departure', () => {
  assert.equal(validateVisit(visit(), 'Duhai', 'checkin', NOW).ok, true);
  assert.equal(validateVisit(visit({ expected_departure: '2026-11-03T17:00:00.000Z' }), 'Duhai', 'checkin', NOW).ok, true);
  assert.equal(validateVisit(visit({ expected_departure: '2026-11-03T09:30:00.000Z' }), 'Duhai', 'checkin', NOW).code, 'expired');
});

t('every refusal has its own clear message', () => {
  const m = (o, loc = 'Duhai') => validateVisit(visit(o), loc, 'checkin', NOW);
  assert.equal(validateVisit(null, 'Duhai').message, 'Invalid invitation pass.');
  assert.equal(m({}, 'Corporate Office').message, 'This invitation belongs to another office location.');
  assert.equal(m({ status: 'pending_approval' }).message, 'Your invitation is awaiting approval.');
  assert.equal(m({ status: 'cancelled' }).message, 'This invitation has been cancelled.');
  assert.equal(m({ status: 'checked_in' }).message, 'You have already checked in.');
  assert.equal(m({ status: 'checked_out' }).code, 'checked_out');
  assert.equal(m({ status: 'rejected' }).code, 'rejected');
  assert.equal(m({ expected_arrival: '2026-11-01T09:00:00.000Z' }).message, 'Your invitation has expired.');
  const future = m({ expected_arrival: '2026-11-06T09:00:00.000Z' }); assert.equal(future.code, 'not_yet'); assert.match(future.message, /06 Nov 2026/);
});

t('check-out only works for a visitor who is inside, at their own office', () => {
  assert.equal(validateVisit(visit({ status: 'checked_in' }), 'Duhai', 'checkout', NOW).ok, true);
  assert.equal(validateVisit(visit({ status: 'approved' }), 'Duhai', 'checkout', NOW).code, 'not_checked_in');
  assert.equal(validateVisit(visit({ status: 'checked_out' }), 'Duhai', 'checkout', NOW).code, 'checked_out');
  assert.equal(validateVisit(visit({ status: 'checked_in' }), 'Corporate Office', 'checkout', NOW).code, 'wrong_location');
});

t('the kiosk only ever sees a trimmed view of a visit', () => {
  const p = publicVisit(visit({ qr_code: QR, mobile_number: '9812345678', photo_url: 'x' }));
  assert.equal(p.mobile_masked, 'XXXXXX5678'); assert.equal(p.qr_code, undefined); assert.equal(p.mobile_number, undefined); assert.equal(p.has_photo, true);
});

t('photo urls: only this app\'s own uploads; id numbers keep only the last four', () => {
  assert.ok(safePhotoUrl('/api/upload/file/11111111-2222-3333-4444-555555555555.jpg'));
  assert.ok(safePhotoUrl('https://maxone.maxvoltenergy.com/api/upload/file/11111111-2222-3333-4444-555555555555'));
  for (const bad of ['https://evil.example/a.png', 'javascript:alert(1)', '/api/upload/file/../../x']) assert.equal(safePhotoUrl(bad), '', bad);
  assert.equal(idReference('Aadhaar', '1234 5678 9012'), 'Aadhaar ending 9012'); assert.equal(idReference('', ''), ''); assert.equal(idReference('Passport', '12'), 'Passport');
});

t('phone numbers, text clean-up, durations', () => {
  assert.equal(last10('+91 98123-45678'), '9812345678'); assert.equal(maskMobile('9812345678'), 'XXXXXX5678');
  assert.equal(cleanText(' <b>Hi</b>\u0000  there '), 'b Hi /b there');
  assert.equal(durationToDeparture(60, NOW), '2026-11-03T11:00:00.000Z'); assert.equal(durationToDeparture(0, NOW), null); assert.equal(durationToDeparture(99999, NOW), null);
});

t('limiter allows N hits per window, then blocks', () => {
  const l = makeLimiter(3, 1000); assert.ok(l.hit('a') && l.hit('a') && l.hit('a')); assert.equal(l.hit('a'), false); assert.ok(l.hit('b'));
});

t('location report counts every status, per location', () => {
  const rows = summariseByLocation([
    visit({ status: 'pending_approval', source: 'walk_in', source_kiosk_id: 'k1' }), visit({ status: 'approved' }), visit({ status: 'checked_in', checked_in_via_kiosk_id: 'k1' }),
    visit({ status: 'checked_out' }), visit({ status: 'rejected', source: 'walk_in' }), visit({ location_name: 'Corporate Office', status: 'cancelled' }),
  ]);
  const d = rows.find(r => r.location === 'Duhai');
  assert.deepEqual([d.total, d.walk_in, d.invited, d.pending, d.approved, d.rejected, d.inside, d.checked_out, d.via_kiosk], [5, 2, 3, 1, 3, 1, 1, 1, 2]);
  assert.equal(rows.find(r => r.location === 'Corporate Office').cancelled, 1);
});

t('group entries: count is 1-20, names trimmed, kiosk can demand every name', () => {
  assert.deepEqual(groupFields(undefined, undefined), { visitor_count: 1, companion_names: [] });
  assert.equal(groupFields(99, []).visitor_count, 20); assert.equal(groupFields(-3, []).visitor_count, 1);
  assert.deepEqual(groupFields(3, [' Raj ', '', 'Sita', 'Extra']), { visitor_count: 3, companion_names: ['Raj', 'Sita'] });
  assert.match(groupFields(3, ['Raj'], { requireNames: true }).error, /2 other visitors/); assert.equal(groupFields(2, ['Raj'], { requireNames: true }).error, undefined);
});

console.log(`\n${n} kiosk rule checks passed`);
