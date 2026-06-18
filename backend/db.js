import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// In production Railway mounts a persistent volume at /app/data
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/app/data' : __dirname;
const db = new DatabaseSync(join(DATA_DIR, 'hrms.db'));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    full_name   TEXT,
    first_name  TEXT,
    middle_name TEXT,
    last_name   TEXT,
    role        TEXT DEFAULT 'user',
    custom_role TEXT,
    display_name TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entities (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    user_id     TEXT,
    status      TEXT,
    is_active   INTEGER DEFAULT 1,
    data        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_entities_type         ON entities(type);
  CREATE INDEX IF NOT EXISTS idx_entities_user_id      ON entities(user_id);
  CREATE INDEX IF NOT EXISTS idx_entities_type_user    ON entities(type, user_id);
  CREATE INDEX IF NOT EXISTS idx_entities_type_status  ON entities(type, status);
  CREATE INDEX IF NOT EXISTS idx_entities_type_active  ON entities(type, is_active);
`);

export default db;
