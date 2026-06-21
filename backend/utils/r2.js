// Cloudflare R2 (S3-compatible) object storage for employee documents.
// Bucket is PRIVATE — files are written with the backend's credentials and
// read only via short-lived presigned URLs the backend generates on demand,
// so a leaked link expires and can't expose sensitive PII.
//
// Railway env vars required:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   (optional) R2_PREFIX  — key prefix/folder, defaults to "maxvolt-hr"

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PREFIX = 'maxvolt-hr',
} = process.env;

export const isR2Configured = () =>
  !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);

let _client = null;
function client() {
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return _client;
}

export function buildKey(id, ext = '') {
  return `${R2_PREFIX}/${id}${ext}`;
}

export async function putToR2(key, buffer, mime) {
  await client().send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mime || 'application/octet-stream',
  }));
  return key;
}

// Short-lived presigned GET URL (default 1 hour).
export async function presignGet(key, { expiresIn = 3600, filename } = {}) {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ...(filename ? { ResponseContentDisposition: `inline; filename="${String(filename).replace(/"/g, '')}"` } : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

export async function deleteFromR2(key) {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    console.warn('[r2] delete failed:', e.message);
  }
}
