import express from 'express';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'maxvolt-hr-jwt-secret';

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Ensure notifications table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    type        TEXT DEFAULT 'info',
    is_read     INTEGER DEFAULT 0,
    link        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

// GET /api/notifications - get my notifications (latest 50)
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  const unread = db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0`).get(req.user.id).c;
  res.json({ notifications: rows, unread });
});

// PATCH /api/notifications/read-all - mark all as read (must be before /:id/read)
router.patch('/read-all', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.user.id);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read - mark one as read
router.patch('/:id/read', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`).run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/notifications - create notification (internal use / admin)
router.post('/', requireAuth, (req, res) => {
  const { user_id, title, message, type = 'info', link } = req.body;
  const targetUserId = user_id || req.user.id;
  const id = uuidv4();
  db.prepare(`INSERT INTO notifications(id,user_id,title,message,type,link) VALUES(?,?,?,?,?,?)`).run(id, targetUserId, title, message, type, link || null);
  res.json({ success: true, id });
});

export default router;
