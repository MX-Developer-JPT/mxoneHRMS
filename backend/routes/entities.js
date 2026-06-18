import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

/* ── helpers ─────────────────────────────────────────── */

const parseRow = (row) => {
  if (!row) return null;
  const d = JSON.parse(row.data);
  // always expose id, created_date, updated_date
  d.id         = row.id;
  d.created_date = row.created_at;
  d.updated_date = row.updated_at;
  return d;
};

const matchesFilter = (data, filter) => {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => {
    if (v === undefined || v === null) return true;
    if (k === 'id') return data.id === v;
    const fv = data[k];
    if (Array.isArray(v)) return v.includes(fv);
    return fv === v;
  });
};

const sortRows = (arr, sortField) => {
  if (!sortField) return arr;
  const desc = sortField.startsWith('-');
  const field = desc ? sortField.slice(1) : sortField;
  return [...arr].sort((a, b) => {
    const av = a[field] ?? a.created_date ?? '';
    const bv = b[field] ?? b.created_date ?? '';
    const cmp = String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });
};

/* ── LIST  GET /api/entities/:type ───────────────────── */
router.get('/:type', (req, res) => {
  const { type } = req.params;
  const { sort, limit } = req.query;
  let rows = db.prepare('SELECT * FROM entities WHERE type = ?').all(type);
  let data = rows.map(parseRow);
  if (sort)  data = sortRows(data, sort);
  if (limit) data = data.slice(0, parseInt(limit, 10));
  res.json(data);
});

/* ── FILTER  POST /api/entities/:type/filter ─────────── */
router.post('/:type/filter', (req, res) => {
  const { type } = req.params;
  const { query = {}, sort, limit } = req.body;

  let rows;
  if (query.user_id && query.status) {
    rows = db.prepare('SELECT * FROM entities WHERE type=? AND user_id=? AND status=?')
              .all(type, query.user_id, query.status);
  } else if (query.user_id) {
    rows = db.prepare('SELECT * FROM entities WHERE type=? AND user_id=?')
              .all(type, query.user_id);
  } else if (query.status) {
    rows = db.prepare('SELECT * FROM entities WHERE type=? AND status=?')
              .all(type, query.status);
  } else if (query.is_active !== undefined) {
    rows = db.prepare('SELECT * FROM entities WHERE type=? AND is_active=?')
              .all(type, query.is_active ? 1 : 0);
  } else {
    rows = db.prepare('SELECT * FROM entities WHERE type=?').all(type);
  }

  let data = rows.map(parseRow).filter(d => matchesFilter(d, query));
  if (sort)  data = sortRows(data, sort);
  if (limit) data = data.slice(0, parseInt(limit, 10));
  res.json(data);
});

/* ── GET ONE  GET /api/entities/:type/:id ─────────────── */
router.get('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const row = db.prepare('SELECT * FROM entities WHERE type=? AND id=?').get(type, id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseRow(row));
});

/* ── CREATE  POST /api/entities/:type ─────────────────── */
router.post('/:type', (req, res) => {
  const { type } = req.params;
  const body = req.body;
  const id = body.id || uuidv4();
  const data = { ...body, id };

  db.prepare(`INSERT INTO entities (id, type, user_id, status, is_active, data)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, type,
        data.user_id  ?? null,
        data.status   ?? null,
        data.is_active !== false ? 1 : 0,
        JSON.stringify(data));

  const row = db.prepare('SELECT * FROM entities WHERE id=?').get(id);
  res.status(201).json(parseRow(row));
});

/* ── UPDATE  PATCH /api/entities/:type/:id ─────────────── */
router.patch('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const row = db.prepare('SELECT * FROM entities WHERE type=? AND id=?').get(type, id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const current = JSON.parse(row.data);
  const updated = { ...current, ...req.body, id };

  db.prepare(`UPDATE entities
              SET data=?, user_id=?, status=?, is_active=?, updated_at=datetime('now')
              WHERE id=?`)
    .run(JSON.stringify(updated),
        updated.user_id ?? row.user_id,
        updated.status  ?? row.status,
        updated.is_active !== false ? 1 : 0,
        id);

  const newRow = db.prepare('SELECT * FROM entities WHERE id=?').get(id);
  res.json(parseRow(newRow));
});

/* ── DELETE  DELETE /api/entities/:type/:id ─────────────── */
router.delete('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const r = db.prepare('DELETE FROM entities WHERE type=? AND id=?').run(type, id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

export default router;
