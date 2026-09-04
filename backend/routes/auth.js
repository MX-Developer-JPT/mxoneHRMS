import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { one, run } from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';

const router = Router();

// A hardcoded fallback secret here would mean anyone who reads this
// (public/committed) source could forge an admin JWT the moment JWT_SECRET
// is ever unset. If it's missing, generate a random one for this process
// instead — every login before the next restart still works correctly,
// existing sessions from a prior process are invalidated (the safe
// direction to fail in), and there's never a predictable, guessable secret.
export const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const generated = randomBytes(48).toString('hex');
  console.error('[auth] JWT_SECRET is not set in the environment — using a random secret generated for this process only. Set JWT_SECRET so sessions survive a restart.');
  return generated;
})();

export const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, role: user.role, custom_role: user.custom_role || user.role }, JWT_SECRET, { expiresIn: '30d' });

const formatUser = (u) => u ? {
  id: u.id, email: u.email,
  full_name: u.full_name, first_name: u.first_name,
  middle_name: u.middle_name, last_name: u.last_name,
  role: u.role, custom_role: u.custom_role,
  display_name: u.display_name || u.full_name,
  must_change_password: !!u.must_change_password
} : null;

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  // JWT verification and the DB lookup are deliberately two separate
  // try/catch blocks, not one shared catch — a single catch around both
  // meant ANY failure (a bad/expired token, but ALSO a transient DB
  // connection drop, pool timeout, or brief Postgres restart) came back as
  // the same 401 "Invalid or expired token". The frontend (AuthContext's
  // checkUserAuth) treats 401 as a genuine "this session really is
  // invalid" signal and clears the token, logging the user out — so a
  // momentary server/DB connectivity blip was silently logging out
  // perfectly valid sessions instead of surfacing a retry prompt. Only an
  // actual bad token should ever produce 401 here; a DB error is a server
  // problem (503), which the frontend already knows to treat as "can't
  // reach the server right now" rather than "you're logged out".
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const user = await one('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json(formatUser(user));
  } catch (e) {
    console.error('[auth] /me user lookup failed (not a token problem):', e.message);
    res.status(503).json({ error: 'Server temporarily unavailable — please try again' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await one('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user);
  res.json({ token, user: formatUser(user) });

  // Fire-and-forget adoption-analytics login event — recorded server-side
  // (not from the client) so activation/active-user numbers can't be
  // skipped by a client that never calls the event-logging endpoint.
  const eventId = uuidv4();
  run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'UsageEvent',$2,'active',$3)", [
    eventId, user.id, JSON.stringify({ id: eventId, user_id: user.id, event_type: 'login', module: null, feature: null, meta: null, timestamp: new Date().toISOString() }),
  ]).catch(e => console.error('[auth] login event log failed:', e.message));
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, full_name, first_name, last_name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const norm = email.toLowerCase().trim();
  const existing = await one('SELECT id FROM users WHERE email = $1', [norm]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const name = full_name || [first_name, last_name].filter(Boolean).join(' ') || '';
  await run(
    `INSERT INTO users (id, email, password, full_name, first_name, last_name, role, display_name)
     VALUES ($1, $2, $3, $4, $5, $6, 'onboarding_pending', $7)`,
    [id, norm, hash, name, first_name || '', last_name || '', name]
  );

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await run('DELETE FROM otps WHERE email = $1', [norm]);
  await run('INSERT INTO otps (email, code, expires_at) VALUES ($1, $2, $3)', [norm, code, expiresAt]);

  const tpl = emailTemplates.otpEmail({ name, code, expiresMinutes: 10 });
  sendEmail({ to: norm, ...tpl }).catch(e =>
    console.error('[auth] OTP email failed:', e.message)
  );

  res.status(201).json({ pendingVerification: true, email: norm });
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => res.json({ success: true }));

// PATCH /api/auth/me
router.patch('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { full_name, first_name, middle_name, last_name, display_name } = req.body;
    const name = full_name || [first_name, middle_name, last_name].filter(Boolean).join(' ');
    await run(
      `UPDATE users SET full_name=$1, first_name=$2, middle_name=$3, last_name=$4,
       display_name=$5, updated_at=NOW()::TEXT WHERE id=$6`,
      [name, first_name || null, middle_name || null, last_name || null, display_name || name, decoded.id]
    );
    const user = await one('SELECT * FROM users WHERE id = $1', [decoded.id]);
    res.json(formatUser(user));
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { email, otpCode } = req.body;
  if (!email || !otpCode) return res.status(400).json({ error: 'Email and code required' });
  const norm = email.toLowerCase().trim();
  const record = await one('SELECT * FROM otps WHERE email = $1', [norm]);
  if (!record) return res.status(400).json({ error: 'No verification code found. Please register again or request a new code.' });
  if (new Date(record.expires_at) < new Date()) {
    await run('DELETE FROM otps WHERE email = $1', [norm]);
    return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
  }
  if (record.code !== String(otpCode)) return res.status(400).json({ error: 'Invalid verification code' });
  await run('DELETE FROM otps WHERE email = $1', [norm]);
  const user = await one('SELECT * FROM users WHERE email = $1', [norm]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const access_token = signToken(user);
  res.json({ access_token, user: formatUser(user) });
});

// POST /api/auth/resend-otp
router.post('/resend-otp', async (req, res) => {
  const email = typeof req.body === 'string' ? req.body : req.body?.email;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const norm = email.toLowerCase().trim();
  const user = await one('SELECT * FROM users WHERE email = $1', [norm]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await run('DELETE FROM otps WHERE email = $1', [norm]);
  await run('INSERT INTO otps (email, code, expires_at) VALUES ($1, $2, $3)', [norm, code, expiresAt]);
  const tpl = emailTemplates.otpEmail({ name: user.full_name, code, expiresMinutes: 10 });
  sendEmail({ to: norm, ...tpl }).catch(e => console.error('[auth] Resend OTP failed:', e.message));
  res.json({ success: true });
});

// POST /api/auth/reset-password-request
router.post('/reset-password-request', async (req, res) => {
  const { email } = req.body;
  res.json({ success: true, message: 'If registered, a reset link will be sent.' });
  if (!email) return;
  try {
    const norm = email.toLowerCase().trim();
    // Case-insensitive lookup — every current insert path lowercases first,
    // but a row created before that was consistent (see the admin-bootstrap
    // fix in server.js) could still have mixed-case email, in which case an
    // exact `=` match would silently find nothing and this request would
    // (correctly, by this endpoint's own design for unregistered emails)
    // no-op — except the account genuinely exists, it just never got a
    // reset link because of the casing mismatch.
    const user = await one('SELECT * FROM users WHERE LOWER(email) = $1', [norm]);
    if (!user) return;
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await run('DELETE FROM reset_tokens WHERE email = $1', [norm]);
    await run('INSERT INTO reset_tokens (token, email, expires_at) VALUES ($1, $2, $3)', [token, norm, expiresAt]);
    const appUrl = process.env.APP_URL || 'https://maxone.maxvoltenergy.com';
    const resetLink = `${appUrl}/reset-password?token=${token}`;
    const tpl = emailTemplates.passwordResetEmail({ name: user.full_name, resetLink });
    await sendEmail({ to: norm, ...tpl });
  } catch(e) {
    console.error('[auth] Password reset email failed:', e.message);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token: resetToken, new_password, newPassword } = req.body;
  const pwd = new_password || newPassword;
  if (!resetToken || !pwd) return res.status(400).json({ error: 'Token and new password required' });
  if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const record = await one('SELECT * FROM reset_tokens WHERE token = $1', [resetToken]);
  if (!record) return res.status(400).json({ error: 'Invalid or expired reset link' });
  if (new Date(record.expires_at) < new Date()) {
    await run('DELETE FROM reset_tokens WHERE token = $1', [resetToken]);
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
  }
  const hash = bcrypt.hashSync(pwd, 10);
  // Case-insensitive, matching the lookup fix above — record.email is
  // always lowercase (set from the requester's normalized input), but
  // users.email might not be for a row from before that was consistently
  // enforced everywhere. An exact `=` here would silently update zero rows
  // and still report success, leaving the password completely unchanged.
  const upd = await run('UPDATE users SET password=$1, updated_at=NOW()::TEXT WHERE LOWER(email)=$2', [hash, record.email]);
  if (!upd.rowCount) {
    await run('DELETE FROM reset_tokens WHERE token = $1', [resetToken]);
    return res.status(400).json({ error: 'Could not find the account for this reset link. Please request a new one.' });
  }
  await run('DELETE FROM reset_tokens WHERE token = $1', [resetToken]);
  res.json({ success: true });
});

// POST /api/auth/change-password  — authenticated; clears must_change_password flag
router.post('/change-password', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  let decoded;
  try { decoded = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = await one('SELECT * FROM users WHERE id=$1', [decoded.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // For bulk-imported users with must_change_password, skip current password check
  if (!user.must_change_password) {
    if (!current_password) return res.status(400).json({ error: 'Current password required' });
    if (!bcrypt.compareSync(current_password, user.password)) return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  await run('UPDATE users SET password=$1, must_change_password=FALSE, updated_at=NOW()::TEXT WHERE id=$2', [hash, user.id]);
  res.json({ success: true });
});

// POST /api/auth/request-password-change-otp — authenticated. Sends a code
// to the LOGGED-IN user's own email (never a body-supplied address, so this
// can't be abused to spam an arbitrary inbox) for the "I don't remember my
// current password" self-service change flow in App Settings. Reuses the
// same `otps` table as registration verification — the OTP just needs to be
// tied to an email and expire, and that flow's use of it is unrelated.
router.post('/request-password-change-otp', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  let decoded;
  try { decoded = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const user = await one('SELECT * FROM users WHERE id=$1', [decoded.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const norm = user.email.toLowerCase().trim();
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await run('DELETE FROM otps WHERE email = $1', [norm]);
  await run('INSERT INTO otps (email, code, expires_at) VALUES ($1, $2, $3)', [norm, code, expiresAt]);
  const tpl = emailTemplates.otpEmail({ name: user.full_name, code, expiresMinutes: 10 });
  sendEmail({ to: norm, ...tpl }).catch(e => console.error('[auth] Password-change OTP email failed:', e.message));
  // Masked so the UI can show "we sent a code to j***@maxvoltenergy.com"
  // without exposing the full address to anything reading the response.
  const maskedEmail = norm.replace(/^(.{1,2}).*(@.*)$/, (_, a, b) => `${a}***${b}`);
  res.json({ success: true, email: maskedEmail });
});

// POST /api/auth/verify-password-change-otp — authenticated. Verifies the
// code against the logged-in user's own email and sets the new password in
// one step — no current-password check, since not remembering it is exactly
// why this path exists.
router.post('/verify-password-change-otp', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  let decoded;
  try { decoded = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const { otp_code, new_password } = req.body;
  if (!otp_code || !new_password) return res.status(400).json({ error: 'Verification code and new password are required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = await one('SELECT * FROM users WHERE id=$1', [decoded.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const norm = user.email.toLowerCase().trim();

  const record = await one('SELECT * FROM otps WHERE email = $1', [norm]);
  if (!record) return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
  if (new Date(record.expires_at) < new Date()) {
    await run('DELETE FROM otps WHERE email = $1', [norm]);
    return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
  }
  if (record.code !== String(otp_code)) return res.status(400).json({ error: 'Invalid verification code' });
  await run('DELETE FROM otps WHERE email = $1', [norm]);

  const hash = bcrypt.hashSync(new_password, 10);
  await run('UPDATE users SET password=$1, must_change_password=FALSE, updated_at=NOW()::TEXT WHERE id=$2', [hash, user.id]);
  res.json({ success: true });
});

export default router;
