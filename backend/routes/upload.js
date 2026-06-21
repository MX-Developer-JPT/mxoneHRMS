import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { one, run } from '../db.js';
import { JWT_SECRET } from './auth.js';
import { isR2Configured, buildKey, putToR2, presignGet } from '../utils/r2.js';

const router = Router();

// Storage priority:
//   1. Cloudflare R2 (private bucket + signed URLs) — preferred for documents
//   2. Cloudinary (if configured)
//   3. PostgreSQL bytes — always-available persistent fallback
// All three survive Railway redeploys (unlike the ephemeral container disk).
const USE_CLOUDINARY = !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY));

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ── Cloudinary upload helper (v2 SDK) ─────────────────────────────────────
async function uploadToCloudinary(buffer, originalname) {
  const { v2: cloudinary } = await import('cloudinary');
  cloudinary.config(); // reads CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET

  const ext = path.extname(originalname).replace('.', '').toLowerCase();
  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  const resource_type = isImg ? 'image' : 'raw';

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'maxvolt-hr', public_id: uuidv4(), resource_type },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

if (isR2Configured()) console.log('✓ File uploads → Cloudflare R2 (private bucket, signed URLs)');
else if (USE_CLOUDINARY) console.log('✓ File uploads → Cloudinary');
else console.log('✓ File uploads → PostgreSQL (persistent across redeploys)');

// Optional: identify the uploader if a token is present (uploads stay open so
// the public job-application page can attach resumes without logging in).
function optionalUser(req) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

// ── POST /api/upload ──────────────────────────────────────────────────────
router.post('/', memUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const id = uuidv4();
  const ext = path.extname(req.file.originalname || '');
  const mime = req.file.mimetype || 'application/octet-stream';
  const uploader = optionalUser(req)?.id || null;

  try {
    // 1. Cloudflare R2 (private) — store object, keep only a key reference in DB
    if (isR2Configured()) {
      try {
        const key = buildKey(id, ext);
        await putToR2(key, req.file.buffer, mime);
        await run(
          "INSERT INTO files(id, filename, mime, size, storage, r2_key, uploaded_by) VALUES($1,$2,$3,$4,'r2',$5,$6)",
          [id, req.file.originalname || `${id}${ext}`, mime, req.file.size, key, uploader]
        );
        return res.json({ file_url: `/api/upload/file/${id}${ext}`, filename: req.file.originalname, size: req.file.size });
      } catch (r2Err) {
        console.warn('[upload] R2 failed, falling back:', r2Err.message);
      }
    }

    // 2. Cloudinary
    if (USE_CLOUDINARY) {
      try {
        const result = await uploadToCloudinary(req.file.buffer, req.file.originalname);
        return res.json({ file_url: result.secure_url, filename: result.public_id, size: req.file.size });
      } catch (cloudErr) {
        console.warn('[upload] Cloudinary failed, falling back to DB:', cloudErr.message);
      }
    }

    // 3. PostgreSQL bytes — always-available persistent fallback
    await run(
      "INSERT INTO files(id, filename, mime, size, data, storage, uploaded_by) VALUES($1,$2,$3,$4,$5,'db',$6)",
      [id, req.file.originalname || `${id}${ext}`, mime, req.file.size, req.file.buffer, uploader]
    );
    return res.json({ file_url: `/api/upload/file/${id}${ext}`, filename: req.file.originalname, size: req.file.size });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── GET /api/upload/file/:id ──────────────────────────────────────────────
// Permanent reference. The :id may carry an extension (uuid.pdf) — strip it.
// R2-backed files redirect to a short-lived signed URL (bucket stays private);
// DB-backed files are streamed directly.
router.get('/file/:id', async (req, res) => {
  try {
    const id = String(req.params.id).replace(/\.[^.]+$/, '');
    const row = await one("SELECT filename, mime, data, storage, r2_key FROM files WHERE id=$1", [id]);
    if (!row) return res.status(404).json({ error: 'File not found' });

    if (row.storage === 'r2' && row.r2_key) {
      const url = await presignGet(row.r2_key, { expiresIn: 3600, filename: row.filename });
      return res.redirect(302, url);
    }

    // DB-stored bytes
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(row.filename || 'file').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.send(row.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
