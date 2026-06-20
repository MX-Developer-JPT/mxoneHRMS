import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// In production Railway mounts a persistent volume at /app/data
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/app/data' : __dirname;
const db = new DatabaseSync(join(DATA_DIR, 'hrms.db'));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA cache_size = -16000");   // 16 MB page cache
db.exec("PRAGMA synchronous = NORMAL");  // safe with WAL, faster than FULL
db.exec("PRAGMA busy_timeout = 5000");   // wait up to 5s on lock instead of failing
db.exec("PRAGMA temp_store = MEMORY");   // temp tables in RAM

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
  CREATE INDEX IF NOT EXISTS idx_entities_created      ON entities(created_at);
  CREATE INDEX IF NOT EXISTS idx_entities_type_created ON entities(type, created_at);
  CREATE INDEX IF NOT EXISTS idx_entities_updated      ON entities(updated_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS otps (
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    token      TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Purge expired OTPs and reset tokens so they don't accumulate over time
db.exec("DELETE FROM otps WHERE expires_at < datetime('now')");
db.exec("DELETE FROM reset_tokens WHERE expires_at < datetime('now')");

export default db;
