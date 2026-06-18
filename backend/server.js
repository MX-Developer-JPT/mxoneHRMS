import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import authRouter      from './routes/auth.js';
import entitiesRouter  from './routes/entities.js';
import functionsRouter from './routes/functions.js';
import uploadRouter    from './routes/upload.js';
import aiRouter        from './routes/ai.js';
import adminRouter     from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3001;

// Ensure persistent directories exist (important for Railway volumes)
const UPLOADS_PATH = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(__dirname, 'uploads');
const DATA_PATH    = process.env.NODE_ENV === 'production' ? '/app/data'    : __dirname;
if (!existsSync(UPLOADS_PATH)) mkdirSync(UPLOADS_PATH, { recursive: true });
if (!existsSync(DATA_PATH))    mkdirSync(DATA_PATH,    { recursive: true });

// Auto-seed on first run if no admin user exists
async function autoSeed() {
  try {
    const db = (await import('./db.js')).default;
    const adminExists = db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get();
    if (!adminExists) {
      console.log('⚡ First run detected — seeding default data…');
      const { default: seed } = await import('./seed.js');
      if (typeof seed === 'function') await seed();
      console.log('✓ Seed complete');
    }
  } catch (e) {
    console.warn('Auto-seed skipped:', e.message);
  }
}
autoSeed();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
const UPLOADS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/uploads'
  : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR));

// Health check — Railway uses this to verify the container is up
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Mock base44 public-settings so AuthContext doesn't crash on old code
app.get('/api/apps/public/prod/public-settings/by-id/:id', (_req, res) => {
  res.json({ id: _req.params.id, public_settings: { auth_required: true, google_auth_enabled: false }, app_name: 'Maxvolt HR' });
});

app.use('/api/auth',      authRouter);
app.use('/api/entities',  entitiesRouter);
app.use('/api/functions', functionsRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/ai',        aiRouter);
app.use('/api/admin',     adminRouter);

// ── Production: serve built React frontend ─────────────────
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, 'public');
  app.use(express.static(frontendDist, { maxAge: '1d', etag: true }));
  // All non-API routes → React app (client-side routing)
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

app.listen(PORT, () =>
  console.log(`\n✓ Maxvolt HR Backend  http://localhost:${PORT}  [${process.env.NODE_ENV || 'development'}]`)
);
