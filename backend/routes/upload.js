import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { one, run } from '../db.js';
import { JWT_SECRET } from './auth.js';

const router = Router();

// Cloudinary is preferred when configured (CDN + offloads the DB). Otherwise we
// store files in PostgreSQL, which is persistent across Railway redeploys —
// unlike the container's local disk, which is wiped on every deploy.
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

if (USE_CLOUDINARY) console.log('✓ File uploads → Cloudinary');
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

  try {
    if (USE_CLOUDINARY) {
      try {
        const result = await uploadToCloudinary(req.file.buffer, req.file.originalname);
        return res.json({ file_url: result.secure_url, filename: result.public_id, size: req.file.size });
      } catch (cloudErr) {
        // Don't lose the file — fall through to persistent DB storage
        console.warn('[upload] Cloudinary failed, falling back to DB:', cloudErr.message);
      }
    }

    // Persist in PostgreSQL — survives redeploys
    const id = uuidv4();
    const ext = path.extname(req.file.originalname || '');
    const uploader = optionalUser(req)?.id || null;
    await run(
      "INSERT INTO files(id, filename, mime, size, data, uploaded_by) VALUES($1,$2,$3,$4,$5,$6)",
      [id, req.file.originalname || `${id}${ext}`, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer, uploader]
    );
    // Keep the extension on the URL so downloads/viewers infer the type nicely
    return res.json({ file_url: `/api/upload/file/${id}${ext}`, filename: req.file.originalname, size: req.file.size });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── GET /api/upload/file/:id ──────────────────────────────────────────────
// Serve a DB-stored file. The :id may carry an extension (uuid.pdf) — strip it.
router.get('/file/:id', async (req, res) => {
  try {
    const id = String(req.params.id).replace(/\.[^.]+$/, '');
    const row = await one("SELECT filename, mime, data FROM files WHERE id=$1", [id]);
    if (!row) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(row.filename || 'file').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(row.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
