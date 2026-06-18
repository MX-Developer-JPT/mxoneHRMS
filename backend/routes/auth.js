import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

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
router.post('/register', (req, res) => {
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
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = signToken(user);
  res.status(201).json({ token, user: formatUser(user) });
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

// POST /api/auth/reset-password-request
router.post('/reset-password-request', (req, res) =>
  res.json({ success: true, message: 'If registered, a reset link will be sent.' }));

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token: resetToken, new_password } = req.body;
  if (!resetToken || !new_password) return res.status(400).json({ error: 'Token and new password required' });
  res.json({ success: true });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (_req, res) => res.json({ success: true }));

// POST /api/auth/resend-otp
router.post('/resend-otp', (_req, res) => res.json({ success: true }));

export default router;
