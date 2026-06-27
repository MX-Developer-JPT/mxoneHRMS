import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { one, all, run } from '../db.js';
import { JWT_SECRET } from './auth.js';
import { sendEmail, verifyEmail, emailTemplates, getEmailConfig } from '../utils/email.js';

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

// ── Delete ALL entities of a type (must be before /:type/:id) ─
router.delete('/entities/:type/all', async (req, res) => {
  const r = await run('DELETE FROM entities WHERE type=$1', [req.params.type]);
  res.json({ success: true, deleted: r.rowCount });
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

// ── Bulk delete users ──────────────────────────────────────
router.post('/users/bulk-delete', async (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Only admins can delete users' });
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  const safeIds = ids.filter(id => id !== req.currentUser.id);
  if (!safeIds.length) return res.status(400).json({ error: 'Cannot delete your own account' });
  let deleted = 0, entitiesDeleted = 0;
  for (const userId of safeIds) {
    const r1 = await run('DELETE FROM entities WHERE user_id=$1', [userId]);
    const r2 = await run("DELETE FROM entities WHERE user_id IS DISTINCT FROM $1 AND data::jsonb->>'user_id'=$1", [userId]);
    const r3 = await run('DELETE FROM users WHERE id=$1', [userId]);
    if (r3.rowCount > 0) { deleted++; entitiesDeleted += (r1.rowCount || 0) + (r2.rowCount || 0); }
  }
  res.json({ success: true, deleted, entities_deleted: entitiesDeleted, skipped: ids.length - deleted });
});

// ── Delete user (cascade: removes all linked entities) ────
router.delete('/users/:id', async (req, res) => {
  if (!req.isAdmin)
    return res.status(403).json({ error: 'Only admins can delete users' });
  if (req.currentUser.id === req.params.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const userId = req.params.id;
  // Remove all entities linked to this user — both via the user_id column and inside the JSON data.
  // Some entities (Leave, Reimbursement, Document, etc.) are created by other users (HR/admin)
  // so their user_id column may differ; they reference the employee through data::jsonb->>'user_id'.
  const byColumn = await run('DELETE FROM entities WHERE user_id=$1', [userId]);
  const byJson   = await run("DELETE FROM entities WHERE user_id IS DISTINCT FROM $1 AND data::jsonb->>'user_id'=$1", [userId]);
  const totalDeleted = (byColumn.rowCount || 0) + (byJson.rowCount || 0);
  // Remove the user account
  const result = await run('DELETE FROM users WHERE id=$1', [userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, entities_deleted: totalDeleted, by_column: byColumn.rowCount, by_json: byJson.rowCount });
});

// ── Email settings: from address only (API key is server-side) ────────────
router.get('/smtp-settings', async (_req, res) => {
  res.json(await getEmailConfig());
});

router.post('/smtp-settings', async (req, res) => {
  const { from } = req.body;
  if (from !== undefined) {
    await run(
      `INSERT INTO settings(key,value,updated_at) VALUES('SMTP_FROM',$1,NOW()::TEXT)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT`,
      [String(from)]
    );
  }
  res.json({ success: true });
});

// ── Email: verify SMTP config ──────────────────────────────
router.get('/email-status', async (_req, res) => {
  const result = await verifyEmail();
  res.json(result);
});

// ── Email: verify Brevo connection ────────────────────────
router.get('/email-status', async (_req, res) => {
  res.json(await verifyEmail());
});

// ── Email: send test email ─────────────────────────────────
router.post('/test-email', async (req, res) => {
  const to = req.body?.to || req.currentUser.email;
  if (!to) return res.status(400).json({ error: 'No recipient email address found' });
  try {
    const verify = await verifyEmail();
    if (!verify.ok) return res.status(500).json({ error: verify.error });
    const tmpl   = emailTemplates.testEmail({ to });
    const result = await sendEmail({ to, ...tmpl });
    res.json({ success: true, sentTo: to, messageId: result.messageId, provider: 'brevo' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
