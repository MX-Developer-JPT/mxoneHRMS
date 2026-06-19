import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import authRouter           from './routes/auth.js';
import entitiesRouter       from './routes/entities.js';
import functionsRouter      from './routes/functions.js';
import uploadRouter         from './routes/upload.js';
import aiRouter             from './routes/ai.js';
import adminRouter          from './routes/admin.js';
import attendanceLogRouter  from './routes/attendancelog.js';
import notificationsRouter  from './routes/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Auto-start Ollama + pull model ───────────────────────────
async function ensureOllama() {
  if (process.env.GROQ_API_KEY) return; // Groq is configured — skip Ollama

  const OLLAMA_URL  = 'http://localhost:11434';
  const MODEL       = process.env.OLLAMA_MODEL || 'tinyllama';
  const isProd      = process.env.NODE_ENV === 'production';

  // In dev: start ollama serve if not already running
  if (!isProd) {
    try {
      execSync('ollama --version', { stdio: 'ignore' });
      try {
        execSync(`curl -s ${OLLAMA_URL}/api/tags`, { timeout: 2000, stdio: 'pipe' });
        console.log('✓ Ollama already running');
      } catch {
        const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
        proc.unref();
        console.log('✓ Ollama started');
      }
    } catch { /* Ollama not installed — AI limited */ }
    return;
  }

  // In production: Ollama is already started by Dockerfile CMD.
  // Wait for it to be ready, then pull model if not present.
  console.log(`⚙ Checking Ollama model "${MODEL}"…`);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res  = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      const has  = (data.models || []).some(m => m.name.startsWith(MODEL.split(':')[0]));

      if (has) {
        console.log(`✓ Ollama model "${MODEL}" ready`);
        return;
      }

      // Pull model (blocks until done — runs in background via setTimeout)
      console.log(`⬇ Pulling Ollama model "${MODEL}" (first-run download, may take a few minutes)…`);
      const pullRes = await fetch(`${OLLAMA_URL}/api/pull`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: MODEL, stream: false }),
        signal:  AbortSignal.timeout(600_000), // 10 min max
      });
      if (pullRes.ok) console.log(`✓ Ollama model "${MODEL}" downloaded`);
      else console.warn(`⚠ Ollama pull returned ${pullRes.status}`);
      return;
    } catch {
      // Ollama not ready yet — wait and retry
      await wait(3000);
    }
  }
  console.warn('⚠ Ollama did not become ready — AI features unavailable until next restart');
}
// Run in background so server starts immediately
ensureOllama().catch(() => {});

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

app.use('/api/auth',            authRouter);
app.use('/api/entities',        entitiesRouter);
app.use('/api/functions',       functionsRouter);
app.use('/api/upload',          uploadRouter);
app.use('/api/ai',              aiRouter);
app.use('/api/admin',           adminRouter);
app.use('/api/attendance-log',  attendanceLogRouter);
app.use('/api/notifications',   notificationsRouter);

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
