import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[pg] Unexpected pool error:', err.message);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      email        TEXT UNIQUE NOT NULL,
      password     TEXT NOT NULL,
      full_name    TEXT,
      first_name   TEXT,
      middle_name  TEXT,
      last_name    TEXT,
      role         TEXT DEFAULT 'user',
      custom_role  TEXT,
      display_name          TEXT,
      must_change_password  BOOLEAN DEFAULT FALSE,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP::TEXT,
      updated_at   TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE TABLE IF NOT EXISTS entities (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      user_id    TEXT,
      status     TEXT,
      is_active  INTEGER DEFAULT 1,
      data       TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type         ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_user_id      ON entities(user_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type_user    ON entities(type, user_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type_status  ON entities(type, status);
    CREATE INDEX IF NOT EXISTS idx_entities_type_active  ON entities(type, is_active);
    CREATE INDEX IF NOT EXISTS idx_entities_created      ON entities(created_at);
    CREATE INDEX IF NOT EXISTS idx_entities_type_created ON entities(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_entities_updated      ON entities(updated_at);

    CREATE TABLE IF NOT EXISTS otps (
      email      TEXT NOT NULL,
      code       TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE TABLE IF NOT EXISTS reset_tokens (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      title      TEXT NOT NULL,
      message    TEXT NOT NULL,
      type       TEXT DEFAULT 'info',
      is_read    INTEGER DEFAULT 0,
      link       TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      keys       TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS device_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      platform   TEXT NOT NULL DEFAULT 'fcm_android',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

    CREATE TABLE IF NOT EXISTS files (
      id          TEXT PRIMARY KEY,
      filename    TEXT,
      mime        TEXT,
      size        INTEGER,
      data        BYTEA,
      storage     TEXT DEFAULT 'db',
      r2_key      TEXT,
      uploaded_by TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP::TEXT
    );
  `);

  // Ensure columns added after initial schema exist (ALTER TABLE is idempotent with IF NOT EXISTS)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name   TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name  TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name    TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role           TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password  BOOLEAN DEFAULT FALSE;
  `);

  // files: support R2-backed rows (key reference instead of inline bytes)
  await pool.query(`
    ALTER TABLE files ADD COLUMN IF NOT EXISTS storage TEXT DEFAULT 'db';
    ALTER TABLE files ADD COLUMN IF NOT EXISTS r2_key  TEXT;
    ALTER TABLE files ALTER COLUMN data DROP NOT NULL;
  `);

  // Purge expired OTPs and tokens on startup
  await pool.query("DELETE FROM otps WHERE expires_at::TIMESTAMPTZ < NOW()");
  await pool.query("DELETE FROM reset_tokens WHERE expires_at::TIMESTAMPTZ < NOW()");
}

await initSchema().catch(err => {
  console.error('[pg] Schema initialization failed:', err.message);
  process.exit(1);
});

export const q   = (text, params = []) => pool.query(text, params);
export const one = async (text, params = []) => {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
};
export const all = async (text, params = []) => {
  const { rows } = await pool.query(text, params);
  return rows;
};
export const run = async (text, params = []) => {
  const res = await pool.query(text, params);
  return { rowCount: res.rowCount };
};

export default pool;
