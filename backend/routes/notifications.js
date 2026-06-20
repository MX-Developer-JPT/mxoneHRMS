import express from 'express';
import { one, all, run } from '../db.js';
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

// GET /api/notifications - get my notifications (latest 50)
router.get('/', requireAuth, async (req, res) => {
  const rows = await all(
    `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread_row = await one(
    `SELECT COUNT(*) as c FROM notifications WHERE user_id=$1 AND is_read=0`,
    [req.user.id]
  );
  res.json({ notifications: rows, unread: parseInt(unread_row?.c || 0, 10) });
});

// PATCH /api/notifications/read-all - mark all as read (must be before /:id/read)
router.patch('/read-all', requireAuth, async (req, res) => {
  await run(`UPDATE notifications SET is_read=1 WHERE user_id=$1`, [req.user.id]);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read - mark one as read
router.patch('/:id/read', requireAuth, async (req, res) => {
  await run(`UPDATE notifications SET is_read=1 WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  res.json({ success: true });
});

// POST /api/notifications - create notification (internal use / admin)
router.post('/', requireAuth, async (req, res) => {
  const { user_id, title, message, type = 'info', link } = req.body;
  const targetUserId = user_id || req.user.id;
  const id = uuidv4();
  await run(
    `INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, targetUserId, title, message, type, link || null]
  );
  res.json({ success: true, id });
});

export default router;
