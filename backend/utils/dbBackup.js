/**
 * Backs up the live SQLite database to Cloudinary as a raw binary.
 * Called periodically from server.js and on SIGTERM before shutdown.
 */
import { existsSync, statSync } from 'fs';

const DB_PATH   = '/app/data/hrms.db';
const BACKUP_ID = 'maxvolt-hr-db/hrms-backup';
let lastBackupSize = 0;

export async function backupDB({ force = false } = {}) {
  if (process.env.NODE_ENV !== 'production') return;
  if (!existsSync(DB_PATH)) return;
  if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) return;

  try {
    const size = statSync(DB_PATH).size;
    if (!force && size === lastBackupSize) return; // nothing changed
    if (size < 4096) return; // empty/just-created, don't overwrite a real backup

    const { v2: cloudinary } = await import('cloudinary');
    cloudinary.config();

    await cloudinary.uploader.upload(DB_PATH, {
      resource_type: 'raw',
      public_id: BACKUP_ID,
      type: 'authenticated',
      overwrite: true,
      invalidate: true,
    });

    lastBackupSize = size;
    console.log(`[backup] ✓ DB backed up to Cloudinary (${Math.round(size / 1024)} KB)`);
  } catch (e) {
    console.error('[backup] Backup failed:', e.message);
  }
}
