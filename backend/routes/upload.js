import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const USE_CLOUDINARY = !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY));

let upload;

if (USE_CLOUDINARY) {
  // ── Cloudinary storage (production with env vars set) ───────────
  const { v2: cloudinary } = await import('cloudinary');
  const { CloudinaryStorage } = await import('multer-storage-cloudinary');

  cloudinary.config(); // reads CLOUDINARY_URL or individual env vars automatically

  const cloudStorage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => {
      const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
      const isPdf  = ext === 'pdf';
      const isImg  = ['jpg','jpeg','png','gif','webp','svg'].includes(ext);
      return {
        folder: 'maxvolt-hr',
        resource_type: isPdf ? 'raw' : (isImg ? 'image' : 'raw'),
        public_id: uuidv4(),
        // PDFs and raw files: keep original format
        ...(isPdf ? {} : isImg ? { format: ext === 'png' ? 'webp' : ext } : {}),
      };
    },
  });

  upload = multer({
    storage: cloudStorage,
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  console.log('✓ File uploads → Cloudinary');
} else {
  // ── Local disk storage (dev or no Cloudinary env vars) ──────────
  const UPLOADS_DIR = process.env.NODE_ENV === 'production'
    ? '/app/uploads'
    : path.join(__dirname, '../uploads');

  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

  const diskStorage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
  });

  upload = multer({ storage: diskStorage, limits: { fileSize: 20 * 1024 * 1024 } });

  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠ CLOUDINARY_URL not set — uploads stored on local disk. Set CLOUDINARY_URL in Railway Variables for persistent file storage.');
  }
}

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  // Cloudinary gives req.file.path as the secure URL; disk gives req.file.filename
  const file_url = req.file.path || `/uploads/${req.file.filename}`;
  res.json({ file_url, filename: req.file.filename || req.file.public_id, size: req.file.size });
});

export default router;
