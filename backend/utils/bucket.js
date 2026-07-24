// Railway Bucket (S3-compatible) object storage for employee documents.
// Bucket is PRIVATE — files are written with the backend's credentials and
// read only via short-lived presigned URLs the backend generates on demand,
// so a leaked link expires and can't expose sensitive PII.
//
// Replaces Cloudflare R2 as the primary upload target (see utils/r2.js,
// which is kept around read-only so files uploaded before the switch still
// resolve correctly).
//
// Railway env vars required (from the Bucket service's Variables tab):
//   RAILWAY_BUCKET_ENDPOINT, RAILWAY_BUCKET_ACCESS_KEY_ID,
//   RAILWAY_BUCKET_SECRET_ACCESS_KEY, RAILWAY_BUCKET_NAME
//   (optional) RAILWAY_BUCKET_PREFIX — key prefix/folder, defaults to "maxvolt-hr"

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  RAILWAY_BUCKET_ENDPOINT,
  RAILWAY_BUCKET_ACCESS_KEY_ID,
  RAILWAY_BUCKET_SECRET_ACCESS_KEY,
  RAILWAY_BUCKET_NAME,
  RAILWAY_BUCKET_PREFIX = 'maxvolt-hr',
} = process.env;

export const isBucketConfigured = () =>
  !!(RAILWAY_BUCKET_ENDPOINT && RAILWAY_BUCKET_ACCESS_KEY_ID && RAILWAY_BUCKET_SECRET_ACCESS_KEY && RAILWAY_BUCKET_NAME);

let _client = null;
function client() {
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: RAILWAY_BUCKET_ENDPOINT,
    credentials: { accessKeyId: RAILWAY_BUCKET_ACCESS_KEY_ID, secretAccessKey: RAILWAY_BUCKET_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  return _client;
}

export function buildKey(id, ext = '') {
  return `${RAILWAY_BUCKET_PREFIX}/${id}${ext}`;
}

export async function putToBucket(key, buffer, mime) {
  await client().send(new PutObjectCommand({
    Bucket: RAILWAY_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mime || 'application/octet-stream',
  }));
  return key;
}

// Short-lived presigned GET URL (default 1 hour).
export async function presignGet(key, { expiresIn = 3600, filename } = {}) {
  const cmd = new GetObjectCommand({
    Bucket: RAILWAY_BUCKET_NAME,
    Key: key,
    ...(filename ? { ResponseContentDisposition: `inline; filename="${String(filename).replace(/"/g, '')}"` } : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

export async function deleteFromBucket(key) {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: RAILWAY_BUCKET_NAME, Key: key }));
  } catch (e) {
    console.warn('[bucket] delete failed:', e.message);
  }
}
