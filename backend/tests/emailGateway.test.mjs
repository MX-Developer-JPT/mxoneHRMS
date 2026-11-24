// Max Mail gateway sender with Brevo fallback. Run: node backend/tests/emailGateway.test.mjs
import assert from 'node:assert/strict';
process.env.MAIL_GATEWAY_URL = 'https://gw.test'; process.env.MAIL_GATEWAY_KEY = 'mm_live_test'; process.env.BREVO_API_KEY = 'brevo-test'; process.env.EMAIL_PROVIDER = 'auto'; process.env.EMAIL_SETTINGS_FROM_ENV = '1'; process.env.SMTP_FROM = 'Maxvolt HR <no-reply@maxvoltenergy.com>';
const { sendEmail, verifyEmail, getEmailStats } = await import('../utils/email.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

// a scripted fake network: gateway responses are queued, Brevo always accepts
let gw = []; const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); calls.push({ url: u, opts });
  if (u.startsWith('https://api.brevo.com')) return new Response(JSON.stringify({ messageId: '<brevo-1>' }), { status: 201 });
  const next = gw.shift() ?? { status: 202, body: { id: 'mm-1', status: 'queued' } };
  if (next.throw) throw next.throw;
  return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: next.headers || {} });
};
const reset = (...q) => { calls.length = 0; gw = q; };
const base = { to: 'priya@maxvoltenergy.com', subject: 'Hello', html: '<p>Hi</p>' };

await t('goes through the gateway with the right shape', async () => {
  reset();
  const r = await sendEmail({ ...base, to: ['Priya K <priya@maxvoltenergy.com>', 'raj@x.com'], cc: 'hr@x.com', replyTo: 'Hema <hema@x.com>', meta: { source: 'otp' }, attachments: [{ filename: 'a.pdf', content: Buffer.from('PDF'), contentType: 'application/pdf' }] });
  assert.deepEqual([r.provider, r.messageId], ['maxmail', 'mm-1']);
  const c = calls[0]; const b = JSON.parse(c.opts.body);
  assert.equal(c.url, 'https://gw.test/v1/send'); assert.equal(c.opts.headers.Authorization, 'Bearer mm_live_test'); assert.ok(c.opts.headers['Idempotency-Key']);
  assert.deepEqual(b.to, [{ email: 'priya@maxvoltenergy.com', name: 'Priya K' }, 'raj@x.com']); assert.deepEqual(b.cc, ['hr@x.com']); assert.equal(b.replyTo, 'hema@x.com'); assert.equal(b.fromName, 'Maxvolt HR'); assert.deepEqual(b.tags, ['otp']);
  assert.deepEqual(b.attachments, [{ filename: 'a.pdf', contentBase64: Buffer.from('PDF').toString('base64'), contentType: 'application/pdf' }]);
});
await t('a gateway outage retries with the SAME idempotency key, then falls back to Brevo', async () => {
  reset({ status: 503, body: { error: { code: 'internal_error', message: 'down' } } }, { status: 503, body: {} }, { status: 502, body: {} });
  const r = await sendEmail(base); assert.equal(r.provider, 'brevo');
  const keys = calls.filter((c) => c.url.includes('/v1/send')).map((c) => c.opts.headers['Idempotency-Key']); assert.equal(keys.length, 3); assert.equal(new Set(keys).size, 1);
  assert.equal(getEmailStats().fallbacks, 1);
});
await t('a network failure falls back; an invalid message does not', async () => {
  reset({ throw: new Error('ECONNRESET') }, { throw: new Error('ECONNRESET') }, { throw: new Error('ECONNRESET') });
  assert.equal((await sendEmail(base)).provider, 'brevo');
  reset({ status: 400, body: { error: { code: 'validation_error', message: 'bad address' } } });
  await assert.rejects(() => sendEmail(base), /bad address/); assert.equal(calls.filter((c) => c.url.includes('brevo')).length, 0, 'Brevo was not tried for an invalid message');
});
await t('quota, auth and size problems fall back to Brevo', async () => {
  for (const s of [{ status: 429, body: { error: { code: 'daily_limit_exceeded', message: 'quota' } } }, { status: 401, body: { error: { code: 'unauthorized', message: 'bad key' } } }, { status: 403, body: { error: { code: 'recipient_domain_not_allowed', message: 'domain' } } }]) { reset(s); assert.equal((await sendEmail(base)).provider, 'brevo'); }
  reset(); const many = Array.from({ length: 11 }, (_, i) => ({ filename: `f${i}.txt`, content: Buffer.from('x') }));
  assert.equal((await sendEmail({ ...base, attachments: many })).provider, 'brevo'); assert.equal(calls.filter((c) => c.url.includes('/v1/send')).length, 0, 'too many attachments never reach the gateway');
});
await t('mail someone is waiting on confirms the real outcome and falls back if delivery failed', async () => {
  reset({ status: 202, body: { id: 'mm-9', status: 'queued' } }, { status: 200, body: { status: 'failed', error: 'Gmail API error (400)' } });
  const r = await sendEmail({ ...base, meta: { confirm: true } }); assert.equal(r.provider, 'brevo');
  reset({ status: 202, body: { id: 'mm-10' } }, { status: 200, body: { status: 'sent' } });
  assert.equal((await sendEmail({ ...base, meta: { confirm: true } })).provider, 'maxmail');
});
await t('scheduled mail goes straight to Brevo; the health check reports the gateway', async () => {
  reset(); assert.equal((await sendEmail({ ...base, scheduledAt: '2030-01-01T00:00:00Z' })).provider, 'brevo'); assert.equal(calls.filter((c) => c.url.includes('/v1/send')).length, 0);
  reset({ status: 200, body: { name: 'hrms', sender: 'no-reply@maxvoltenergy.com', usage_today: { used: 1, remaining: 1499 } } });
  const v = await verifyEmail(); assert.equal(v.ok, true); assert.equal(v.provider, 'maxmail'); assert.equal(v.fallback, true);
  reset({ status: 500, body: {} }); const v2 = await verifyEmail(); assert.equal(v2.ok, true); assert.equal(v2.provider, 'brevo'); assert.match(v2.warning, /not reachable/);
});
await t('address lists are cleaned: split, de-duplicated, invalid and disabled accounts dropped', async () => {
  reset(); await sendEmail({ ...base, to: 'a@x.com, B@x.com; not-an-email', cc: ['a@x.com', 'c@x.com'] });
  const b = JSON.parse(calls[0].opts.body); assert.deepEqual(b.to, ['a@x.com', 'b@x.com']); assert.deepEqual(b.cc, ['c@x.com'], 'cc never repeats a To address');
  reset(); await sendEmail({ ...base, to: ['good@x.com', 'old.person.disabled-123@x.com', '', null] }); assert.deepEqual(JSON.parse(calls[0].opts.body).to, ['good@x.com']);
  await assert.rejects(() => sendEmail({ ...base, to: ['broken', 'left.disabled-9@x.com'] }), /no valid recipient/);
});
await t('a long recipient list goes out as several messages of at most 45', async () => {
  reset(); const many = Array.from({ length: 100 }, (_, i) => `u${i}@x.com`);
  const r = await sendEmail({ ...base, to: many, cc: 'boss@x.com' }); assert.equal(r.messages, 3);
  const sends = calls.filter((c) => c.url.includes('/v1/send')).map((c) => JSON.parse(c.opts.body));
  assert.deepEqual(sends.map((b) => b.to.length), [45, 45, 10]); assert.deepEqual(sends.map((b) => (b.cc || []).length), [1, 0, 0]); assert.equal(sends.flatMap((b) => b.to).length, 100);
  const keys = calls.filter((c) => c.url.includes('/v1/send')).map((c) => c.opts.headers['Idempotency-Key']); assert.equal(new Set(keys).size, 3);
});
console.log(`\n${n} tests passed`); process.exit(0);
