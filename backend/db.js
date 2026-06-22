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
      display_name TEXT,
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role  TEXT;
  `);

  // files: support R2-backed rows (key reference instead of inline bytes)
  await pool.query(`
    ALTER TABLE files ADD COLUMN IF NOT EXISTS storage TEXT DEFAULT 'db';
    ALTER TABLE files ADD COLUMN IF NOT EXISTS r2_key  TEXT;
    ALTER TABLE files ALTER COLUMN data DROP NOT NULL;
  `);

  // Durable email send queue — drained 24/7 by the in-process worker
  // (backend/utils/emailQueue.js). Survives restarts; retries with backoff.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_jobs (
      id              BIGSERIAL PRIMARY KEY,
      to_addr         TEXT NOT NULL,
      from_addr       TEXT,
      cc              TEXT,
      bcc             TEXT,
      reply_to        TEXT,
      subject         TEXT,
      html            TEXT,
      body_text       TEXT,
      status          TEXT NOT NULL DEFAULT 'queued',  -- queued | sending | sent | dead
      attempts        INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 5,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error      TEXT,
      message_id      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at         TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_email_jobs_due ON email_jobs(status, next_attempt_at);
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
