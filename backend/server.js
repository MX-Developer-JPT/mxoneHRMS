import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import cron from 'node-cron';
import authRouter           from './routes/auth.js';
import entitiesRouter       from './routes/entities.js';
import functionsRouter      from './routes/functions.js';
import uploadRouter         from './routes/upload.js';
import aiRouter             from './routes/ai.js';
import adminRouter          from './routes/admin.js';
import attendanceLogRouter  from './routes/attendancelog.js';
import notificationsRouter  from './routes/notifications.js';
import pushRouter           from './routes/push.js';
import { runNightlyAttendanceAutomation } from './cron/attendanceAutomation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Auto-start Ollama + pull model ───────────────────────────
async function ensureOllama() {
  if (process.env.GROQ_API_KEY) return;

  const OLLAMA_URL = 'http://localhost:11434';
  const MODEL      = process.env.OLLAMA_MODEL || 'tinyllama';
  const isProd     = process.env.NODE_ENV === 'production';

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
    } catch { /* Ollama not installed */ }
    return;
  }

  console.log(`⚙ Checking Ollama model "${MODEL}"…`);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res  = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      const has  = (data.models || []).some(m => m.name.startsWith(MODEL.split(':')[0]));
      if (has) { console.log(`✓ Ollama model "${MODEL}" ready`); return; }

      console.log(`⬇ Pulling Ollama model "${MODEL}"…`);
      const pullRes = await fetch(`${OLLAMA_URL}/api/pull`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: MODEL, stream: false }),
        signal:  AbortSignal.timeout(600_000),
      });
      if (pullRes.ok) console.log(`✓ Ollama model "${MODEL}" downloaded`);
      else console.warn(`⚠ Ollama pull returned ${pullRes.status}`);
      return;
    } catch {
      await wait(3000);
    }
  }
  console.warn('⚠ Ollama did not become ready — AI features unavailable until next restart');
}
ensureOllama().catch(() => {});

const app  = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const UPLOADS_PATH = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(__dirname, 'uploads');
if (!existsSync(UPLOADS_PATH)) mkdirSync(UPLOADS_PATH, { recursive: true });

// Bootstrap admin user and settings from Railway environment variables on every startup.
async function bootstrapFromEnv() {
  try {
    const { one, run } = await import('./db.js');
    const bcrypt = (await import('bcryptjs')).default;
    const { v4: uuid } = await import('uuid');

    const adminEmail    = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName     = process.env.ADMIN_NAME || 'Admin';
    if (adminEmail && adminPassword) {
      const existing = await one('SELECT id FROM users WHERE email=$1', [adminEmail]);
      if (!existing) {
        const hash = bcrypt.hashSync(adminPassword, 10);
        await run(
          `INSERT INTO users(id,email,password,full_name,role,display_name,custom_role) VALUES($1,$2,$3,$4,'admin',$5,'admin')`,
          [uuid(), adminEmail, hash, adminName, adminName]
        );
        console.log(`✓ Admin user restored from env: ${adminEmail}`);
      }
    }

    const envSettings = {
      brevo_api_key:   process.env.BREVO_API_KEY,
      webhook_api_key: process.env.WEBHOOK_API_KEY,
      smtp_host:       process.env.SMTP_HOST,
      smtp_port:       process.env.SMTP_PORT,
      smtp_user:       process.env.SMTP_USER,
      smtp_pass:       process.env.SMTP_PASS,
      smtp_from:       process.env.SMTP_FROM,
      company_name:    process.env.COMPANY_NAME,
      company_logo:    process.env.COMPANY_LOGO,
    };
    for (const [key, value] of Object.entries(envSettings)) {
      if (value) await run(
        `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()::TEXT)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT`,
        [key, value]
      );
    }

    console.log('✓ Supabase PostgreSQL connected');
  } catch (e) {
    console.warn('Env bootstrap skipped:', e.message);
  }
}

// Auto-seed on first run if no admin user exists
async function autoSeed() {
  try {
    const { one } = await import('./db.js');
    const adminExists = await one("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
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

bootstrapFromEnv().then(() => autoSeed()).catch(() => {});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
const UPLOADS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/uploads'
  : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', db: 'supabase', env: process.env.NODE_ENV || 'development' });
});

// Mock base44 public-settings so AuthContext doesn't crash on old code
app.get('/api/apps/public/prod/public-settings/by-id/:id', (_req, res) => {
  res.json({ id: _req.params.id, public_settings: { auth_required: true, google_auth_enabled: false }, app_name: 'Maxvolt One' });
});

app.use('/api/auth',            authRouter);
app.use('/api/entities',        entitiesRouter);
app.use('/api/functions',       functionsRouter);
app.use('/api/upload',          uploadRouter);
app.use('/api/ai',              aiRouter);
app.use('/api/admin',           adminRouter);
app.use('/api/attendance-log',  attendanceLogRouter);
app.use('/api/notifications',   notificationsRouter);
app.use('/api/push',            pushRouter);

// Production: serve built React frontend
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, 'public');
  // Brand assets (favicon/logo/manifest icons) aren't content-hashed like the
  // JS/CSS bundle, so a 1y cache means anyone who already loaded the app keeps
  // serving old bytes from disk cache indefinitely after a logo/icon swap —
  // bit us once already. Short-cache + revalidate these specifically instead.
  const SHORT_CACHE_FILES = new Set([
    'favicon.ico', 'favicon.svg', 'favicon-96x96.png', 'apple-touch-icon.png',
    'maxvolt-logo.jpg', 'manifest.json',
  ]);
  app.use(express.static(frontendDist, {
    maxAge: '1y',
    etag: true,
    setHeaders: (res, filePath) => {
      const base = path.basename(filePath);
      // Never cache HTML or the service worker — always revalidate
      if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (SHORT_CACHE_FILES.has(base) || filePath.includes(`${path.sep}icons${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

const server = app.listen(PORT, () => {
  console.log(`\n✓ Maxvolt One Backend  http://localhost:${PORT}  [${process.env.NODE_ENV || 'development'}]`);
});
// No hard timeout — long-running ops like bulk biometric processing must complete fully
server.setTimeout(0);
server.keepAliveTimeout = 65000;

// ── Nightly attendance automation — 2:00 AM IST ──────────────
// Marks employees with no attendance record absent, and force-closes
// any check-in that was never checked out by the 2 AM cutoff.
cron.schedule('0 2 * * *', () => {
  runNightlyAttendanceAutomation().catch(err => console.error('[attendance-cron] failed:', err));
}, { timezone: 'Asia/Kolkata' });

