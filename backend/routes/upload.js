import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const USE_CLOUDINARY = !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY));

// Always accept upload into memory first; we decide where to store after
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
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

// ── Local disk fallback ───────────────────────────────────────────────────
const UPLOADS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/uploads'
  : path.join(__dirname, '../uploads');

function saveLocally(buffer, originalname) {
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${uuidv4()}${path.extname(originalname)}`;
  const { writeFileSync } = require('fs'); // sync is fine for small files
  const filepath = path.join(UPLOADS_DIR, filename);
  require('fs').writeFileSync(filepath, buffer);
  return { file_url: `/uploads/${filename}`, filename };
}

if (USE_CLOUDINARY) {
  console.log('✓ File uploads → Cloudinary');
} else if (process.env.NODE_ENV === 'production') {
  console.warn('⚠ CLOUDINARY_URL not set — uploads stored on local disk only. Set it in Railway Variables.');
}

router.post('/', memUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    if (USE_CLOUDINARY) {
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname);
      return res.json({ file_url: result.secure_url, filename: result.public_id, size: req.file.size });
    }

    // Local fallback: write buffer to disk
    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
    const { writeFileSync } = await import('fs');
    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    return res.json({ file_url: `/uploads/${filename}`, filename, size: req.file.size });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

export default router;
