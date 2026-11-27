// Central HR email mapping and copy. Run: node backend/tests/hrMail.test.mjs
import assert from 'node:assert/strict';
process.env.MAIL_GATEWAY_URL = 'https://gw.test'; process.env.MAIL_GATEWAY_KEY = 'k'; process.env.BREVO_API_KEY = ''; process.env.EMAIL_PROVIDER = 'auto'; process.env.EMAIL_SETTINGS_FROM_ENV = '1'; process.env.SMTP_FROM = 'Maxvolt HR <no-reply@maxvoltenergy.com>';
const { validEmail, buildDirectory, setHrDirectoryForTests, hrRecipients } = await import('../utils/hrMail.js');
const { sendEmail } = await import('../utils/email.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
let sent = []; let failCopy = false;
globalThis.fetch = async (_u, o = {}) => {
  const b = JSON.parse(o.body); if (failCopy && b.subject.startsWith('[HR copy]')) return new Response(JSON.stringify({ error: { code: 'validation_error', message: 'no' } }), { status: 400 });
  sent.push(b); return new Response(JSON.stringify({ id: 'm' + sent.length }), { status: 202 });
};
const users = [{ id: 'h1', email: 'hr1@dummy.local' }, { id: 'h2', email: 'hr2@dummy.local' }, { id: 'h3', email: 'hr3@dummy.local' }];
const config = { mappings: { h1: { email: 'asha@co.com' }, h2: { email: 'ravi@co.com' }, gone: { email: 'old@co.com' } } };
const use = (c = config) => { sent = []; failCopy = false; setHrDirectoryForTests(buildDirectory(users, c)); };
const mail = (extra) => sendEmail({ to: 'emp@co.com', subject: 'Leave approved', html: '<p>Done <a href="https://app.co/Leave">open</a></p>', ...extra });

await t('address validation', async () => {
  for (const good of ['a@co.com', 'a.b+c@sub.co.in']) assert.ok(validEmail(good), good);
  for (const bad of ['', 'a', 'a@co', 'a b@co.com', 'a..b@co.com', '.a@co.com', 'a@co.com, b@co.com', 'x.disabled-1@co.com']) assert.ok(!validEmail(bad), bad);
});
await t('every configured active HR mailbox is copied; unmapped and former HR are not', async () => {
  use(); await mail(); assert.equal(sent.length, 1); assert.deepEqual(sent[0].cc, ['asha@co.com', 'ravi@co.com']); assert.deepEqual(sent[0].to, ['emp@co.com']);
});
await t('an HR login address is replaced by the real mailbox, with no duplicate in CC', async () => {
  use(); await mail({ to: ['HR One <hr1@dummy.local>', 'emp@co.com'], cc: ['ravi@co.com', 'hr2@dummy.local'], replyTo: 'hr1@dummy.local' });
  assert.deepEqual(sent[0].to, [{ email: 'asha@co.com', name: 'HR One' }, 'emp@co.com']); assert.deepEqual(sent[0].cc, ['ravi@co.com']); assert.equal(sent[0].replyTo, 'asha@co.com');
});
await t('one-time codes are never copied but still reach the HR mailbox', async () => {
  use(); await mail({ to: 'hr1@dummy.local', meta: { source: 'otp' } }); assert.equal(sent.length, 1); assert.deepEqual(sent[0].to, ['asha@co.com']); assert.equal(sent[0].cc, undefined);
});
await t('private links: recipient gets the link, HR gets a separate copy without it', async () => {
  for (const url of ['https://app.co/offer-accept/abc', 'https://app.co/onboarding-invite?token=xyz', 'https://app.co/candidate-documents/1b671a64-40d5-491e-99b0-da01ff1f3341', 'https://app.co/api/hiring/decide/' + 'a'.repeat(48) + '/c1/shortlist']) {
    use(); await mail({ html: `<body><p><a href="${url}">Accept</a> or paste ${url}</p></body>`, text: `Open ${url}` });
    assert.equal(sent.length, 2, url); assert.equal(sent[0].cc, undefined); assert.ok(sent[0].html.includes(url));
    assert.deepEqual(sent[1].to, ['asha@co.com', 'ravi@co.com']); assert.ok(sent[1].subject.startsWith('[HR copy]'));
    assert.ok(!sent[1].html.includes(url) && !sent[1].text.includes(url), 'link removed: ' + url); assert.ok(sent[1].html.includes('private link removed') && sent[1].html.includes('emp@co.com'));
  }
});
await t('a failing HR copy does not fail the real email', async () => { use(); failCopy = true; const r = await mail({ html: '<a href="https://app.co/offer-accept/abc">x</a>' }); assert.ok(r.success); assert.equal(sent.length, 1); });
await t('switched off, an excluded type, or nothing configured: mail goes out as addressed', async () => {
  use({ ...config, cc_enabled: false }); await mail({ to: 'hr1@dummy.local' }); assert.deepEqual(sent[0].to, ['asha@co.com']); assert.equal(sent[0].cc, undefined);
  use({ ...config, excluded_types: ['payslip'] }); await mail({ meta: { source: 'payslip' } }); assert.equal(sent[0].cc, undefined);
  use({}); await mail(); assert.equal(sent[0].cc, undefined);
  setHrDirectoryForTests(null); sent = []; await mail(); assert.equal(sent.length, 1);
});
await t('HR-only mail goes to the configured mailboxes, else the fallback', async () => {
  use(); assert.deepEqual(await hrRecipients('hr@co.com'), ['asha@co.com', 'ravi@co.com']); use({}); assert.deepEqual(await hrRecipients('hr@co.com'), ['hr@co.com']);
});
console.log(`\n${n} passed`);
