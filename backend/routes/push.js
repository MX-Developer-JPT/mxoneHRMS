import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './auth.js';
import { getPublicKey, saveSubscription, removeSubscription } from '../utils/push.js';

const router = Router();

const getUser = (req) => {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
};

// Public VAPID key for the browser to subscribe
router.get('/vapid-public-key', async (_req, res) => {
  const key = await getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

// Register a push subscription for the signed-in user
router.post('/subscribe', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const ok = await saveSubscription(user.id, req.body?.subscription || req.body);
  if (!ok) return res.status(400).json({ error: 'Invalid subscription' });
  res.json({ success: true });
});

// Remove a subscription (on logout / opt-out)
router.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
  await removeSubscription(endpoint);
  res.json({ success: true });
});

export default router;
