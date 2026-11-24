// Stores a file received by the server itself (an emailed CV, a file from a bulk import) the same way /api/upload does.
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { run } from '../db.js';
import { isBucketConfigured, buildKey, putToBucket } from './bucket.js';

const APP_BASE = (process.env.APP_URL || 'https://maxone.maxvoltenergy.com').replace(/\/+$/, '');

export async function saveBuffer({ buffer, filename = 'file', mime = 'application/octet-stream', uploader = null }) {
  const id = uuidv4();
  const ext = path.extname(filename || '');
  if (isBucketConfigured()) {
    try {
      const key = buildKey(id, ext);
      await putToBucket(key, buffer, mime);
      await run("INSERT INTO files(id, filename, mime, size, storage, r2_key, uploaded_by) VALUES($1,$2,$3,$4,'railway',$5,$6)", [id, filename, mime, buffer.length, key, uploader]);
      return { file_url: `${APP_BASE}/api/upload/file/${id}${ext}`, filename, size: buffer.length };
    } catch (e) { console.warn('[fileStore] bucket failed, using the database:', e.message); }
  }
  await run("INSERT INTO files(id, filename, mime, size, data, storage, uploaded_by) VALUES($1,$2,$3,$4,$5,'db',$6)", [id, filename, mime, buffer.length, buffer, uploader]);
  return { file_url: `${APP_BASE}/api/upload/file/${id}${ext}`, filename, size: buffer.length };
}
