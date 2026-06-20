/**
 * Runs BEFORE server.js starts (called from start.sh).
 * Restores the SQLite database from Cloudinary if the local file is missing.
 * Exits 0 always — a restore failure just means we start fresh.
 */
import { existsSync, writeFileSync, mkdirSync, statSync } from 'fs';

const DB_PATH    = '/app/data/hrms.db';
const BACKUP_ID  = 'maxvolt-hr-db/hrms-backup';
const MIN_SIZE   = 8192; // bytes — smaller = empty/just-created DB

if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) {
  console.log('[restore] Cloudinary not configured — skipping restore');
  process.exit(0);
}

if (existsSync(DB_PATH)) {
  const size = statSync(DB_PATH).size;
  if (size > MIN_SIZE) {
    console.log(`[restore] DB exists (${Math.round(size / 1024)} KB) — no restore needed`);
    process.exit(0);
  }
  console.log(`[restore] DB is empty/minimal (${size}B) — checking Cloudinary for backup…`);
}

try {
  const { v2: cloudinary } = await import('cloudinary');
  cloudinary.config();

  const cfg = cloudinary.config();
  if (!cfg.cloud_name) {
    console.error('[restore] Could not determine Cloudinary cloud name — check CLOUDINARY_URL format');
    process.exit(0);
  }

  // type: 'upload' = public URL, no signing required. Works on free Cloudinary plans.
  const url = `https://res.cloudinary.com/${cfg.cloud_name}/raw/upload/${BACKUP_ID}`;
  console.log(`[restore] Downloading from: ${url.replace(cfg.cloud_name, '***')}`);

  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });

  if (!resp.ok) {
    if (resp.status === 404) {
      console.log('[restore] No backup found (first deploy or backup was deleted) — starting fresh');
    } else {
      console.error(`[restore] Download failed: HTTP ${resp.status} ${resp.statusText}`);
    }
    process.exit(0);
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength < MIN_SIZE) {
    console.error(`[restore] Downloaded file is too small (${buf.byteLength}B) — ignoring, starting fresh`);
    process.exit(0);
  }

  mkdirSync('/app/data', { recursive: true });
  writeFileSync(DB_PATH, Buffer.from(buf));
  console.log(`[restore] ✓ DB restored from Cloudinary (${Math.round(buf.byteLength / 1024)} KB)`);
} catch (e) {
  console.error('[restore] Restore error:', e.message, '— starting fresh');
}

process.exit(0);
