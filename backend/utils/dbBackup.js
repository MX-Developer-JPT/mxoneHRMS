import { existsSync, statSync } from 'fs';

const DB_PATH   = '/app/data/hrms.db';
const BACKUP_ID = 'maxvolt-hr-db/hrms-backup';
let lastBackupSize = -1; // -1 = never backed up this session

export async function backupDB({ force = false } = {}) {
  if (process.env.NODE_ENV !== 'production') return;
  if (!existsSync(DB_PATH)) return;
  if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) return;

  try {
    const size = statSync(DB_PATH).size;
    if (size < 4096) {
      console.log('[backup] DB too small to back up — skipping');
      return;
    }

    // Skip if nothing changed since last backup (unless forced)
    if (!force && size === lastBackupSize) return;

    const { v2: cloudinary } = await import('cloudinary');
    cloudinary.config(); // reads CLOUDINARY_URL env var automatically

    const result = await cloudinary.uploader.upload(DB_PATH, {
      resource_type: 'raw',
      public_id: BACKUP_ID,
      type: 'private',      // private = signed URL required to download (not public)
      overwrite: true,
      invalidate: true,
    });

    lastBackupSize = size;
    console.log(`[backup] ✓ DB backed up to Cloudinary (${Math.round(size / 1024)} KB) — ${result.secure_url}`);
  } catch (e) {
    console.error('[backup] Backup failed:', e.message);
  }
}
