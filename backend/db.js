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

  // One-time backfill: GatePass rows were created without the `user_id`
  // column set (only `employee_user_id` inside `data` was set), which broke
  // the manager-approval authorization check in routes/entities.js
  // (checkApprovalAuthorization resolves the requester via `current.user_id`)
  // and the reporting-manager notification-on-create hook (same field) for
  // every gate pass ever submitted. Idempotent — only touches rows still
  // missing user_id, so safe to run on every startup.
  await pool.query(
    "UPDATE entities SET user_id = data::jsonb->>'employee_user_id' " +
    "WHERE type='GatePass' AND user_id IS NULL AND data::jsonb->>'employee_user_id' IS NOT NULL"
  );

  // One-time seed: map known biometric device names to their site, per
  // explicit instruction — 'Biomatrice 2' / 'LabourAtt' punches mean Duhai,
  // 'Biometric' punches mean Ghaziabad. Location Master already lets HR
  // reconfigure this (AppLocation.biometric_devices) going forward; this
  // just seeds whichever existing location rows match by name so the All
  // Attendance Location filter works immediately without manual setup.
  // Idempotent — only adds a device name a location doesn't already have.
  try {
    const deviceSeeds = [
      { namePattern: '%ghaziabad%', devices: ['Biometric'] },
      { namePattern: '%duhai%',     devices: ['Biomatrice 2', 'LabourAtt'] },
    ];
    for (const { namePattern, devices } of deviceSeeds) {
      const { rows } = await pool.query(
        "SELECT id, data FROM entities WHERE type='AppLocation' AND data::jsonb->>'name' ILIKE $1",
        [namePattern]
      );
      for (const row of rows) {
        const d = JSON.parse(row.data);
        const existing = Array.isArray(d.biometric_devices) ? d.biometric_devices : [];
        const existingUpper = new Set(existing.map(x => String(x).trim().toUpperCase()));
        const merged = [...existing, ...devices.filter(dev => !existingUpper.has(dev.toUpperCase()))];
        if (merged.length !== existing.length) {
          await pool.query("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [
            JSON.stringify({ ...d, biometric_devices: merged }), row.id,
          ]);
        }
      }
    }
  } catch (e) {
    console.error('[pg] biometric device seed failed:', e.message);
  }
}

await initSchema().catch(err => {
  console.error('[pg] Schema initialization failed:', err.message);
  process.exit(1);
});

// Runs `fn(client)` inside a single BEGIN/COMMIT transaction on one held
// connection — needed anywhere a read-then-write decision (balance/limit
// checks) must be atomic against concurrent requests, since `one`/`all`/`run`
// each borrow a fresh connection from the pool with no shared transaction
// context. Rolls back and rethrows on any error; always releases the client.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

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
