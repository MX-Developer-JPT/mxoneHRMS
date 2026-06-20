import { existsSync, statSync } from 'fs';

const DB_PATH   = '/app/data/hrms.db';
const BACKUP_ID = 'maxvolt-hr-db/hrms-backup';
let lastBackupSize = -1; // -1 = never backed up this session

export async function backupDB({ force = false } = {}) {
  if (process.env.NODE_ENV !== 'production') return;
  if (!existsSync(DB_PATH)) { console.log('[backup] DB file not found — skipping'); return; }
  if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) {
    console.log('[backup] CLOUDINARY_URL not set — skipping'); return;
  }

  try {
    const size = statSync(DB_PATH).size;
    if (size < 4096) { console.log(`[backup] DB too small (${size}B) — skipping`); return; }
    if (!force && size === lastBackupSize) return; // nothing changed

    const { v2: cloudinary } = await import('cloudinary');
    cloudinary.config(); // reads CLOUDINARY_URL automatically

    const result = await cloudinary.uploader.upload(DB_PATH, {
      resource_type: 'raw',
      public_id: BACKUP_ID,
      // type: 'upload' = publicly accessible by URL, works on ALL Cloudinary plans
      // including free. The URL is not guessable without knowing the cloud name
      // (stored privately in Railway env vars).
      type: 'upload',
      overwrite: true,
      invalidate: true,
    });

    lastBackupSize = size;
    console.log(`[backup] ✓ DB backed up (${Math.round(size / 1024)} KB) → ${result.secure_url}`);
  } catch (e) {
    console.error('[backup] FAILED:', e.message);
    // Log full error so it's visible in Railway logs
    if (e.http_code) console.error(`[backup]   HTTP ${e.http_code}:`, JSON.stringify(e.error || e));
  }
}
