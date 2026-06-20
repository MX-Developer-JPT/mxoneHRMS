/**
 * Runs BEFORE server.js starts (called from start.sh).
 * Restores the SQLite database from Cloudinary if the local file is missing.
 * Exits 0 always — a restore failure just means we start fresh, not that the app fails.
 */
import { existsSync, writeFileSync, mkdirSync, statSync } from 'fs';

const DB_PATH    = '/app/data/hrms.db';
const BACKUP_ID  = 'maxvolt-hr-db/hrms-backup';
const MIN_SIZE   = 8192; // bytes — anything smaller is an empty/just-created DB

if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) {
  console.log('[restore] CLOUDINARY_URL not configured — skipping DB restore');
  process.exit(0);
}

if (existsSync(DB_PATH)) {
  const size = statSync(DB_PATH).size;
  if (size > MIN_SIZE) {
    console.log(`[restore] DB exists (${Math.round(size / 1024)} KB) — no restore needed`);
    process.exit(0);
  }
  console.log('[restore] DB file is empty/minimal — checking Cloudinary for backup…');
}

try {
  const { v2: cloudinary } = await import('cloudinary');
  cloudinary.config(); // reads CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET

  // Generate a signed URL so we can download the raw DB file
  const url = cloudinary.url(BACKUP_ID, {
    resource_type: 'raw',
    sign_url: true,
    type: 'authenticated',
  });

  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!resp.ok) {
    // No backup exists yet (first ever run, or backup was deleted)
    console.log(`[restore] No backup found (HTTP ${resp.status}) — starting fresh`);
    process.exit(0);
  }

  const buf = await resp.arrayBuffer();
  mkdirSync('/app/data', { recursive: true });
  writeFileSync(DB_PATH, Buffer.from(buf));
  console.log(`[restore] ✓ DB restored from Cloudinary (${Math.round(buf.byteLength / 1024)} KB)`);
} catch (e) {
  console.error('[restore] Restore failed:', e.message, '— starting fresh');
}

process.exit(0);
