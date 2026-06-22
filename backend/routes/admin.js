import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { one, all, run } from '../db.js';
import { JWT_SECRET } from './auth.js';
import { sendEmail, verifyEmail, emailTemplates, getSmtpPublicConfig } from '../utils/email.js';
import { resetEmailTransport } from '../utils/emailQueue.js';

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
    req.isAdmin = decoded.role === 'admin';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── Stats ──────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  const ucRow = await one('SELECT COUNT(*) as c FROM users');
  const ecRow = await one('SELECT COUNT(*) as c FROM entities');
  const typeCounts = await all(
    "SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY count DESC"
  );
  res.json({
    users: parseInt(ucRow.c, 10),
    entities: parseInt(ecRow.c, 10),
    by_type: typeCounts.map(r => ({ ...r, count: parseInt(r.count, 10) })),
  });
});

// ── List entity types ──────────────────────────────────────
router.get('/entity-types', async (_req, res) => {
  const rows = await all(
    "SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY type ASC"
  );
  res.json(rows.map(r => ({ ...r, count: parseInt(r.count, 10) })));
});

// ── List entities of a type (paginated) ───────────────────
router.get('/entities/:type', async (req, res) => {
  const { type } = req.params;
  const page   = parseInt(req.query.page  || 1,  10);
  const limit  = parseInt(req.query.limit || 50, 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  let rows, totalRow;
  if (search) {
    const like = `%${search}%`;
    rows     = await all("SELECT * FROM entities WHERE type=$1 AND data LIKE $2 LIMIT $3 OFFSET $4", [type, like, limit, offset]);
    totalRow = await one("SELECT COUNT(*) as c FROM entities WHERE type=$1 AND data LIKE $2", [type, like]);
  } else {
    rows     = await all("SELECT * FROM entities WHERE type=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [type, limit, offset]);
    totalRow = await one("SELECT COUNT(*) as c FROM entities WHERE type=$1", [type]);
  }

  const total = parseInt(totalRow.c, 10);
  const data  = rows.map(r => {
    const d = JSON.parse(r.data);
    d._created_at = r.created_at;
    d._updated_at = r.updated_at;
    return d;
  });
  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── Get single entity ──────────────────────────────────────
router.get('/entities/:type/:id', async (req, res) => {
  const row = await one('SELECT * FROM entities WHERE type=$1 AND id=$2', [req.params.type, req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const d = JSON.parse(row.data);
  d._created_at = row.created_at;
  d._updated_at = row.updated_at;
  res.json(d);
});

// ── Create entity ──────────────────────────────────────────
router.post('/entities/:type', async (req, res) => {
  const { type } = req.params;
  const id   = req.body.id || uuidv4();
  const data = { ...req.body, id };
  await run(
    "INSERT INTO entities(id,type,user_id,status,is_active,data) VALUES($1,$2,$3,$4,1,$5)",
    [id, type, data.user_id ?? null, data.status ?? null, JSON.stringify(data)]
  );
  res.status(201).json(data);
});

// ── Update entity (full replace of data) ──────────────────
router.put('/entities/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const row = await one('SELECT * FROM entities WHERE type=$1 AND id=$2', [type, id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const data = { ...req.body, id };
  await run(
    "UPDATE entities SET data=$1,user_id=$2,status=$3,updated_at=NOW()::TEXT WHERE id=$4",
    [JSON.stringify(data), data.user_id ?? row.user_id, data.status ?? row.status, id]
  );
  res.json(data);
});

// ── Delete entity ──────────────────────────────────────────
router.delete('/entities/:type/:id', async (req, res) => {
  const result = await run('DELETE FROM entities WHERE type=$1 AND id=$2', [req.params.type, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── Bulk delete entities ───────────────────────────────────
router.post('/entities/:type/bulk-delete', async (req, res) => {
  const { ids = [] } = req.body;
  let deleted = 0;
  for (const id of ids) {
    const r = await run('DELETE FROM entities WHERE type=$1 AND id=$2', [req.params.type, id]);
    deleted += r.rowCount;
  }
  res.json({ success: true, deleted });
});

// ── List users ─────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  const users = await all(
    "SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name,created_at FROM users ORDER BY created_at DESC"
  );
  res.json(users);
});

// ── Get single user ────────────────────────────────────────
router.get('/users/:id', async (req, res) => {
  const u = await one(
    "SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name,created_at FROM users WHERE id=$1",
    [req.params.id]
  );
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(u);
});

// ── Create user ────────────────────────────────────────────
router.post('/users', async (req, res) => {
  const { email, password, full_name, first_name, last_name, role = 'employee', custom_role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const name = full_name || [first_name, last_name].filter(Boolean).join(' ');
  await run(
    "INSERT INTO users(id,email,password,full_name,first_name,last_name,role,custom_role,display_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, email.toLowerCase().trim(), hash, name, first_name || '', last_name || '', role, custom_role || role, name]
  );
  const u = await one("SELECT id,email,full_name,role,custom_role,display_name FROM users WHERE id=$1", [id]);
  res.status(201).json(u);
});

// ── Update user ────────────────────────────────────────────
router.patch('/users/:id', async (req, res) => {
  if ((req.body.role || req.body.custom_role) && !req.isAdmin)
    return res.status(403).json({ error: 'Only admins can change user roles' });

  const { full_name, first_name, last_name, role, custom_role, email } = req.body;
  const fields = []; const vals = []; let pi = 0;
  if (full_name)  { fields.push(`full_name=$${++pi}`);  vals.push(full_name); }
  if (first_name) { fields.push(`first_name=$${++pi}`); vals.push(first_name); }
  if (last_name)  { fields.push(`last_name=$${++pi}`);  vals.push(last_name); }
  if (role) {
    fields.push(`role=$${++pi}`);        vals.push(role);
    fields.push(`custom_role=$${++pi}`); vals.push(custom_role || role);
  } else if (custom_role) {
    fields.push(`custom_role=$${++pi}`); vals.push(custom_role);
  }
  if (email) { fields.push(`email=$${++pi}`); vals.push(email.toLowerCase().trim()); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push(`updated_at=NOW()::TEXT`);
  vals.push(req.params.id);
  await run(`UPDATE users SET ${fields.join(',')} WHERE id=$${++pi}`, vals);
  const u = await one("SELECT id,email,full_name,role,custom_role,display_name FROM users WHERE id=$1", [req.params.id]);
  res.json(u);
});

// ── Reset user password ────────────────────────────────────
router.patch('/users/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  await run("UPDATE users SET password=$1 WHERE id=$2", [bcrypt.hashSync(password, 10), req.params.id]);
  res.json({ success: true });
});

// ── Delete user ────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  if (!req.isAdmin)
    return res.status(403).json({ error: 'Only admins can delete users' });
  if (req.currentUser.id === req.params.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const result = await run('DELETE FROM users WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── SMTP settings: get (password masked) ──────────────────
router.get('/smtp-settings', async (_req, res) => {
  res.json(await getSmtpPublicConfig());
});

// ── Email settings: save to DB ────────────────────────────
router.post('/smtp-settings', async (req, res) => {
  const {
    provider, resend_api_key, brevo_api_key, from,
    smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure,
  } = req.body;
  const set = (key, val) => run(
    `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()::TEXT)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT`,
    [key, String(val)]
  );
  const del = (key) => run('DELETE FROM settings WHERE key=$1', [key]);

  if (provider !== undefined)        await set('EMAIL_PROVIDER', provider);
  if (resend_api_key !== undefined)  await (resend_api_key ? set('RESEND_API_KEY', resend_api_key) : del('RESEND_API_KEY'));
  if (brevo_api_key  !== undefined)  await (brevo_api_key  ? set('BREVO_API_KEY',  brevo_api_key)  : del('BREVO_API_KEY'));
  if (smtp_host !== undefined)       await (smtp_host ? set('SMTP_HOST', smtp_host) : del('SMTP_HOST'));
  if (smtp_port !== undefined)       await set('SMTP_PORT', smtp_port || '587');
  if (smtp_user !== undefined)       await (smtp_user ? set('SMTP_USER', smtp_user) : del('SMTP_USER'));
  if (smtp_pass !== undefined)       await (smtp_pass ? set('SMTP_PASS', smtp_pass) : del('SMTP_PASS'));
  if (smtp_secure !== undefined)     await set('SMTP_SECURE', smtp_secure ? 'true' : 'false');
  if (from !== undefined)            await set('SMTP_FROM', from);

  // SMTP config may have changed — drop the cached transporter so the next
  // send rebuilds it with fresh credentials.
  resetEmailTransport();
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
