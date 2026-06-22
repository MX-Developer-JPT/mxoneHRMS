import { q, one, run } from '../db.js';

// ── Settings ───────────────────────────────────────────────
// SMTP config lives in the `settings` table (editable from Admin Panel),
// falling back to environment variables.
async function getSetting(key, fallback = '') {
  try {
    const row = await one('SELECT value FROM settings WHERE key=$1', [key]);
    if (row?.value) return row.value;
  } catch {}
  return process.env[key] || fallback;
}

async function getSmtpConfig() {
  const [host, port, secure, user, pass, from, dkimDomain, dkimSelector, dkimKey] = await Promise.all([
    getSetting('SMTP_HOST', ''),
    getSetting('SMTP_PORT', '587'),
    getSetting('SMTP_SECURE', ''),
    getSetting('SMTP_USER', ''),
    getSetting('SMTP_PASS', ''),
    getSetting('SMTP_FROM', ''),
    getSetting('DKIM_DOMAIN', ''),
    getSetting('DKIM_SELECTOR', ''),
    getSetting('DKIM_PRIVATE_KEY', ''),
  ]);
  const portNum = Number(port) || 587;
  return {
    host,
    port: portNum,
    secure: secure ? secure === 'true' || secure === '1' : portNum === 465,
    user,
    pass,
    from: from || user,
    dkim: dkimDomain && dkimSelector && dkimKey
      ? { domainName: dkimDomain, keySelector: dkimSelector, privateKey: dkimKey }
      : null,
  };
}

export function isSmtpConfigured(cfg) {
  return Boolean(cfg.host && cfg.user);
}

// ── Transport (cached; reset when settings change) ─────────
let transporter = null;

export function resetEmailTransport() {
  transporter = null;
}

function buildTransportOptions(cfg) {
  const is587 = cfg.port === 587;
  return {
    host: cfg.host,
    port: cfg.port,
    // port 465 = implicit TLS (secure:true), 587 = STARTTLS (secure:false + requireTLS:true)
    secure: cfg.secure,
    requireTLS: is587 ? true : undefined,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: {
      // tolerate self-signed / chain certs (common on shared mail servers like Titan)
      rejectUnauthorized: false,
    },
    // Fail fast — without these nodemailer waits 2+ minutes on a blocked port
    connectionTimeout: 10_000,
    greetingTimeout:   8_000,
    socketTimeout:     10_000,
    ...(cfg.dkim ? { dkim: cfg.dkim } : {}),
  };
}

async function getTransport() {
  if (transporter) return transporter;
  const cfg = await getSmtpConfig();
  if (!isSmtpConfigured(cfg)) throw new Error('SMTP is not configured (set host + user in Admin → Email Settings).');
  const { default: nodemailer } = await import('nodemailer');
  transporter = nodemailer.createTransport(buildTransportOptions(cfg));
  return transporter;
}

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s — the SMTP port may be blocked by the server/firewall`)), ms)
    ),
  ]);

export async function verifySmtp() {
  const cfg = await getSmtpConfig();
  if (!isSmtpConfigured(cfg)) return { ok: false, error: 'SMTP host / user not configured. Add them in Admin Panel → Email Settings.' };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const probe = nodemailer.createTransport(buildTransportOptions(cfg));
    await withTimeout(probe.verify(), 15_000, `Connecting to ${cfg.host}:${cfg.port}`);
    probe.close();
    transporter = null;
    return { ok: true, provider: 'smtp', host: cfg.host, port: cfg.port };
  } catch (e) {
    return { ok: false, provider: 'smtp', error: `SMTP: ${e.message}` };
  }
}

// Send directly via SMTP without the queue — used by admin test-email so the
// caller sees the real error immediately instead of getting a queue job ID.
export async function sendSmtpDirect({ to, from, subject, html, text }) {
  const cfg = await getSmtpConfig();
  if (!isSmtpConfigured(cfg)) throw new Error('SMTP is not configured (set host + user in Admin → Email Settings).');
  const { default: nodemailer } = await import('nodemailer');
  const t = nodemailer.createTransport(buildTransportOptions(cfg));
  try {
    const info = await withTimeout(
      t.sendMail({ from: from || cfg.from || undefined, to, subject, html: html || undefined, text: text || undefined }),
      15_000,
      `Sending via ${cfg.host}:${cfg.port}`
    );
    return { success: true, messageId: info.messageId, provider: 'smtp' };
  } finally {
    t.close();
  }
}

// ── Enqueue ────────────────────────────────────────────────
export async function enqueueEmail({ to, from, cc, bcc, replyTo, subject, html, text, sendAt }) {
  const toAddr = Array.isArray(to) ? to.join(', ') : to;
  const ccStr = Array.isArray(cc) ? cc.join(', ') : cc;
  const bccStr = Array.isArray(bcc) ? bcc.join(', ') : bcc;
  const cfg = await getSmtpConfig();
  const runAt = sendAt && new Date(sendAt) > new Date() ? new Date(sendAt).toISOString() : new Date().toISOString();
  const { rows } = await q(
    `INSERT INTO email_jobs (to_addr, from_addr, cc, bcc, reply_to, subject, html, body_text, next_attempt_at, max_attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [toAddr, from || cfg.from || null, ccStr || null, bccStr || null, replyTo || null, subject, html || null, text || null, runAt,
     Number(process.env.EMAIL_MAX_ATTEMPTS) || 5],
  );
  // Nudge the worker so near-immediate sends don't wait for the next poll tick.
  setImmediate(tick);
  return rows[0].id;
}

export async function getEmailJob(id) {
  return one('SELECT * FROM email_jobs WHERE id=$1', [id]);
}

export async function queueStats() {
  const { rows } = await q(`
    SELECT
      COUNT(*) FILTER (WHERE status='queued')  AS queued,
      COUNT(*) FILTER (WHERE status='sending') AS sending,
      COUNT(*) FILTER (WHERE status='sent')    AS sent,
      COUNT(*) FILTER (WHERE status='dead')    AS dead
    FROM email_jobs`);
  const r = rows[0] || {};
  return { queued: +r.queued || 0, sending: +r.sending || 0, sent: +r.sent || 0, dead: +r.dead || 0 };
}

// ── Worker ─────────────────────────────────────────────────
const CONCURRENCY = Number(process.env.EMAIL_CONCURRENCY) || 5;
const POLL_MS = Number(process.env.EMAIL_POLL_INTERVAL_MS) || 2000;
const RETRY_BASE_MS = Number(process.env.EMAIL_RETRY_BASE_MS) || 60_000;
const RETRY_MAX_MS = Number(process.env.EMAIL_RETRY_MAX_MS) || 3_600_000;

let inFlight = 0;
let timer = null;
let ticking = false;

function backoffMs(attempts) {
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
}

// Atomically grab the next due job; safe across replicas via SKIP LOCKED.
async function claimNext() {
  const { rows } = await q(`
    UPDATE email_jobs SET status='sending', updated_at=NOW()
    WHERE id = (
      SELECT id FROM email_jobs
      WHERE status='queued' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`);
  return rows[0] || null;
}

async function processJob(job) {
  try {
    const t = await getTransport();
    const info = await t.sendMail({
      from: job.from_addr || undefined,
      to: job.to_addr,
      cc: job.cc || undefined,
      bcc: job.bcc || undefined,
      replyTo: job.reply_to || undefined,
      subject: job.subject,
      html: job.html || undefined,
      text: job.body_text || undefined,
    });
    await run(
      "UPDATE email_jobs SET status='sent', attempts=attempts+1, message_id=$1, sent_at=NOW(), updated_at=NOW(), last_error=NULL WHERE id=$2",
      [info.messageId, job.id],
    );
  } catch (err) {
    const attempts = (job.attempts || 0) + 1;
    if (attempts >= job.max_attempts) {
      await run("UPDATE email_jobs SET status='dead', attempts=$1, last_error=$2, updated_at=NOW() WHERE id=$3",
        [attempts, err.message, job.id]);
      console.error(`[emailQueue] job ${job.id} permanently failed:`, err.message);
    } else {
      const nextAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
      await run("UPDATE email_jobs SET status='queued', attempts=$1, next_attempt_at=$2, last_error=$3, updated_at=NOW() WHERE id=$4",
        [attempts, nextAt, err.message, job.id]);
      console.warn(`[emailQueue] job ${job.id} failed (attempt ${attempts}) — retrying:`, err.message);
    }
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    while (inFlight < CONCURRENCY) {
      const job = await claimNext();
      if (!job) break;
      inFlight++;
      processJob(job).finally(() => { inFlight--; });
    }
  } catch (e) {
    console.error('[emailQueue] tick error:', e.message);
  } finally {
    ticking = false;
  }
}

export async function startEmailWorker() {
  // Recovery: re-queue anything left 'sending' when the process last died.
  try {
    const { rowCount } = await run("UPDATE email_jobs SET status='queued' WHERE status='sending'");
    if (rowCount) console.log(`[emailQueue] re-queued ${rowCount} interrupted email(s)`);
  } catch (e) {
    console.error('[emailQueue] recovery failed:', e.message);
  }
  if (timer) clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
  console.log(`[emailQueue] worker started (concurrency ${CONCURRENCY}, poll ${POLL_MS}ms)`);
}
