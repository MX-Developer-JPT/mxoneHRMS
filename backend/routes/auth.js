import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { sendEmail, emailTemplates } from '../utils/email.js';

const router = Router();
export const JWT_SECRET = process.env.JWT_SECRET || 'maxvolt-hr-jwt-secret-2024';

export const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

const formatUser = (u) => u ? {
  id: u.id, email: u.email,
  full_name: u.full_name, first_name: u.first_name,
  middle_name: u.middle_name, last_name: u.last_name,
  role: u.role, custom_role: u.custom_role,
  display_name: u.display_name || u.full_name
} : null;

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json(formatUser(user));
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user);
  res.json({ token, user: formatUser(user) });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, full_name, first_name, last_name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const name = full_name || [first_name, last_name].filter(Boolean).join(' ') || '';
  db.prepare(`INSERT INTO users (id, email, password, full_name, first_name, last_name, role, display_name)
              VALUES (?, ?, ?, ?, ?, ?, 'onboarding_pending', ?)`)
    .run(id, email.toLowerCase().trim(), hash, name, first_name || '', last_name || '', name);

  // Generate OTP and send verification email
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM otps WHERE email = ?').run(email.toLowerCase().trim());
  db.prepare('INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)').run(email.toLowerCase().trim(), code, expiresAt);

  const tpl = emailTemplates.otpEmail({ name, code, expiresMinutes: 10 });
  sendEmail({ to: email.toLowerCase().trim(), ...tpl }).catch(e =>
    console.error('[auth] OTP email failed:', e.message)
  );

  res.status(201).json({ pendingVerification: true, email: email.toLowerCase().trim() });
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => res.json({ success: true }));

// PATCH /api/auth/me
router.patch('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { full_name, first_name, middle_name, last_name, display_name } = req.body;
    const name = full_name || [first_name, middle_name, last_name].filter(Boolean).join(' ');
    db.prepare(`UPDATE users SET full_name=?, first_name=?, middle_name=?, last_name=?,
                display_name=?, updated_at=datetime('now') WHERE id=?`)
      .run(name, first_name || null, middle_name || null, last_name || null,
          display_name || name, decoded.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    res.json(formatUser(user));
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
  const { email, otpCode } = req.body;
  if (!email || !otpCode) return res.status(400).json({ error: 'Email and code required' });
  const norm = email.toLowerCase().trim();
  const record = db.prepare('SELECT * FROM otps WHERE email = ?').get(norm);
  if (!record) return res.status(400).json({ error: 'No verification code found. Please register again or request a new code.' });
  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM otps WHERE email = ?').run(norm);
    return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
  }
  if (record.code !== String(otpCode)) return res.status(400).json({ error: 'Invalid verification code' });
  db.prepare('DELETE FROM otps WHERE email = ?').run(norm);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(norm);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const access_token = signToken(user);
  res.json({ access_token, user: formatUser(user) });
});

// POST /api/auth/resend-otp
router.post('/resend-otp', async (req, res) => {
  const email = typeof req.body === 'string' ? req.body : req.body?.email;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const norm = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(norm);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM otps WHERE email = ?').run(norm);
  db.prepare('INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)').run(norm, code, expiresAt);
  const tpl = emailTemplates.otpEmail({ name: user.full_name, code, expiresMinutes: 10 });
  sendEmail({ to: norm, ...tpl }).catch(e => console.error('[auth] Resend OTP failed:', e.message));
  res.json({ success: true });
});

// POST /api/auth/reset-password-request
router.post('/reset-password-request', async (req, res) => {
  const { email } = req.body;
  // Always respond immediately — never reveal whether email exists
  res.json({ success: true, message: 'If registered, a reset link will be sent.' });
  if (!email) return;
  try {
    const norm = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(norm);
    if (!user) return;
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM reset_tokens WHERE email = ?').run(norm);
    db.prepare('INSERT INTO reset_tokens (token, email, expires_at) VALUES (?, ?, ?)').run(token, norm, expiresAt);
    const appUrl = process.env.APP_URL || 'https://your-app.railway.app';
    const resetLink = `${appUrl}/reset-password?token=${token}`;
    const tpl = emailTemplates.passwordResetEmail({ name: user.full_name, resetLink });
    await sendEmail({ to: norm, ...tpl });
  } catch(e) {
    console.error('[auth] Password reset email failed:', e.message);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token: resetToken, new_password, newPassword } = req.body;
  const pwd = new_password || newPassword;
  if (!resetToken || !pwd) return res.status(400).json({ error: 'Token and new password required' });
  if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const record = db.prepare('SELECT * FROM reset_tokens WHERE token = ?').get(resetToken);
  if (!record) return res.status(400).json({ error: 'Invalid or expired reset link' });
  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(resetToken);
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
  }
  const hash = bcrypt.hashSync(pwd, 10);
  db.prepare("UPDATE users SET password=?,updated_at=datetime('now') WHERE email=?").run(hash, record.email);
  db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(resetToken);
  res.json({ success: true });
});

export default router;
