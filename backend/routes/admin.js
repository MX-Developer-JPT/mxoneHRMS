import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { JWT_SECRET } from './auth.js';
import { sendEmail, verifyEmail, emailTemplates, getSmtpPublicConfig } from '../utils/email.js';

const router = Router();

// ── Admin auth middleware ──────────────────────────────────
router.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!['admin', 'hr'].includes(decoded.role))
      return res.status(403).json({ error: 'Admin or HR role required' });
    req.currentUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── Stats ──────────────────────────────────────────────────
router.get('/stats', (_req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const entityCount = db.prepare('SELECT COUNT(*) as c FROM entities').get().c;
  const typeCounts = db.prepare(
    "SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY count DESC"
  ).all();
  res.json({ users: userCount, entities: entityCount, by_type: typeCounts });
});

// ── List entity types ──────────────────────────────────────
router.get('/entity-types', (_req, res) => {
  const rows = db.prepare(
    "SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY type ASC"
  ).all();
  res.json(rows);
});

// ── List entities of a type (paginated) ───────────────────
router.get('/entities/:type', (req, res) => {
  const { type } = req.params;
  const page  = parseInt(req.query.page  || 1,  10);
  const limit = parseInt(req.query.limit || 50, 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  let rows, total;
  if (search) {
    const like = `%${search}%`;
    rows  = db.prepare("SELECT * FROM entities WHERE type=? AND data LIKE ? LIMIT ? OFFSET ?").all(type, like, limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type=? AND data LIKE ?").get(type, like).c;
  } else {
    rows  = db.prepare("SELECT * FROM entities WHERE type=? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(type, limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type=?").get(type).c;
  }

  const data = rows.map(r => {
    const d = JSON.parse(r.data);
    d._created_at = r.created_at;
    d._updated_at = r.updated_at;
    return d;
  });
  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── Get single entity ──────────────────────────────────────
router.get('/entities/:type/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM entities WHERE type=? AND id=?').get(req.params.type, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const d = JSON.parse(row.data);
  d._created_at = row.created_at;
  d._updated_at = row.updated_at;
  res.json(d);
});

// ── Create entity ──────────────────────────────────────────
router.post('/entities/:type', (req, res) => {
  const { type } = req.params;
  const id   = req.body.id || uuidv4();
  const data = { ...req.body, id };
  db.prepare("INSERT INTO entities(id,type,user_id,status,is_active,data) VALUES(?,?,?,?,1,?)")
    .run(id, type, data.user_id ?? null, data.status ?? null, JSON.stringify(data));
  res.status(201).json(data);
});

// ── Update entity (full replace of data) ──────────────────
router.put('/entities/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const row = db.prepare('SELECT * FROM entities WHERE type=? AND id=?').get(type, id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const data = { ...req.body, id };
  db.prepare("UPDATE entities SET data=?,user_id=?,status=?,updated_at=datetime('now') WHERE id=?")
    .run(JSON.stringify(data), data.user_id ?? row.user_id, data.status ?? row.status, id);
  res.json(data);
});

// ── Delete entity ──────────────────────────────────────────
router.delete('/entities/:type/:id', (req, res) => {
  const r = db.prepare('DELETE FROM entities WHERE type=? AND id=?').run(req.params.type, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── Bulk delete entities ───────────────────────────────────
router.post('/entities/:type/bulk-delete', (req, res) => {
  const { ids = [] } = req.body;
  let deleted = 0;
  for (const id of ids) {
    const r = db.prepare('DELETE FROM entities WHERE type=? AND id=?').run(req.params.type, id);
    deleted += r.changes;
  }
  res.json({ success: true, deleted });
});

// ── List users ─────────────────────────────────────────────
router.get('/users', (_req, res) => {
  const users = db.prepare(
    "SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name,created_at FROM users ORDER BY created_at DESC"
  ).all();
  res.json(users);
});

// ── Get single user ────────────────────────────────────────
router.get('/users/:id', (req, res) => {
  const u = db.prepare(
    "SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name,created_at FROM users WHERE id=?"
  ).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(u);
});

// ── Create user ────────────────────────────────────────────
router.post('/users', (req, res) => {
  const { email, password, full_name, first_name, last_name, role = 'employee', custom_role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const name = full_name || [first_name, last_name].filter(Boolean).join(' ');
  db.prepare("INSERT INTO users(id,email,password,full_name,first_name,last_name,role,custom_role,display_name) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id, email.toLowerCase().trim(), hash, name, first_name || '', last_name || '', role, custom_role || role, name);
  const u = db.prepare("SELECT id,email,full_name,role,custom_role,display_name FROM users WHERE id=?").get(id);
  res.status(201).json(u);
});

// ── Update user ────────────────────────────────────────────
router.patch('/users/:id', (req, res) => {
  const { full_name, first_name, last_name, role, custom_role, email } = req.body;
  const fields = []; const vals = [];
  if (full_name)   { fields.push('full_name=?');    vals.push(full_name); }
  if (first_name)  { fields.push('first_name=?');   vals.push(first_name); }
  if (last_name)   { fields.push('last_name=?');    vals.push(last_name); }
  if (role)        { fields.push('role=?');          vals.push(role); }
  if (custom_role) { fields.push('custom_role=?');   vals.push(custom_role); }
  if (email)       { fields.push('email=?');         vals.push(email.toLowerCase().trim()); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push("updated_at=datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals);
  const u = db.prepare("SELECT id,email,full_name,role,custom_role,display_name FROM users WHERE id=?").get(req.params.id);
  res.json(u);
});

// ── Reset user password ────────────────────────────────────
router.patch('/users/:id/password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare("UPDATE users SET password=? WHERE id=?").run(bcrypt.hashSync(password, 10), req.params.id);
  res.json({ success: true });
});

// ── Delete user ────────────────────────────────────────────
router.delete('/users/:id', (req, res) => {
  if (req.currentUser.id === req.params.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const r = db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── SMTP settings: get (password masked) ──────────────────
router.get('/smtp-settings', (_req, res) => {
  res.json(getSmtpPublicConfig());
});

// ── SMTP / Resend settings: save to DB ────────────────────
router.post('/smtp-settings', (req, res) => {
  const { host, port, secure, user, pass, from, resend_api_key } = req.body;
  const MASK = '••••••••••••••••';
  const set = (key, val) => {
    if (val === undefined || val === null) return;
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(key, String(val));
  };
  if (host  !== undefined) set('SMTP_HOST',   host);
  if (port  !== undefined) set('SMTP_PORT',   String(port));
  if (secure !== undefined) set('SMTP_SECURE', secure ? 'true' : 'false');
  if (user  !== undefined) set('SMTP_USER',   user);
  if (pass  && pass !== MASK) set('SMTP_PASS', pass);
  if (from  !== undefined) set('SMTP_FROM',   from);
  if (resend_api_key && resend_api_key !== MASK) set('RESEND_API_KEY', resend_api_key);
  res.json({ success: true });
});

// ── Email: verify SMTP config ──────────────────────────────
router.get('/email-status', async (_req, res) => {
  const result = await verifyEmail();
  res.json(result);
});

// ── Email: send test email ─────────────────────────────────
router.post('/test-email', async (req, res) => {
  const to = req.body?.to || req.currentUser.email;
  if (!to) return res.status(400).json({ error: 'No recipient email address found' });

  const verify = await verifyEmail();
  if (!verify.ok) return res.status(500).json({ error: verify.error });

  try {
    const tmpl = emailTemplates.testEmail({ to });
    const result = await sendEmail({ to, ...tmpl });
    res.json({ success: true, sentTo: to, messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
