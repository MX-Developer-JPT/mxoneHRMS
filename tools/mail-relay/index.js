'use strict';
const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

// When packaged by pkg, config.json sits next to the .exe.
// When run as plain node for dev, it sits next to index.js.
const BASE_DIR   = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const LOG_PATH    = path.join(BASE_DIR, 'mail-relay.log');

// ── Logging ────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

// ── Load config ────────────────────────────────────────────
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  log(`Config loaded — SMTP ${cfg.smtp?.host}:${cfg.smtp?.port} as ${cfg.smtp?.user}`);
} catch (e) {
  log(`FATAL: Cannot load config.json at ${CONFIG_PATH}`);
  log(`Create a config.json file next to this exe. See config.example.json.`);
  log(`Error: ${e.message}`);
  process.exit(1);
}

const PORT    = cfg.port    || 2525;
const API_KEY = cfg.apiKey  || '';

if (!API_KEY) log('WARNING: No apiKey set in config.json — relay accepts requests from anyone!');

// ── Nodemailer transport ───────────────────────────────────
function makeTransport() {
  const s    = cfg.smtp || {};
  const port = Number(s.port) || 587;
  return nodemailer.createTransport({
    host: s.host,
    port,
    secure: typeof s.secure === 'boolean' ? s.secure : port === 465,
    requireTLS: port === 587 ? true : undefined,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15_000,
    greetingTimeout:   10_000,
    socketTimeout:     15_000,
  });
}

// ── HTTP server ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // ── GET /health ──────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    return send(200, {
      ok: true,
      relay: 'Maxvolt Mail Relay',
      smtp: `${cfg.smtp?.host}:${cfg.smtp?.port}`,
      uptime: Math.floor(process.uptime()) + 's',
    });
  }

  // ── Auth (all other routes) ──────────────────────────────
  if (API_KEY) {
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (auth !== API_KEY) {
      log(`AUTH FAIL from ${req.socket.remoteAddress}`);
      return send(401, { error: 'Unauthorized' });
    }
  }

  // ── GET /verify — test SMTP connection ───────────────────
  if (req.method === 'GET' && req.url === '/verify') {
    const t = makeTransport();
    try {
      await t.verify();
      t.close();
      log(`VERIFY OK — ${cfg.smtp?.host}:${cfg.smtp?.port}`);
      return send(200, { ok: true, host: cfg.smtp?.host, port: cfg.smtp?.port });
    } catch (e) {
      t.close();
      log(`VERIFY FAIL — ${e.message}`);
      return send(500, { ok: false, error: e.message });
    }
  }

  // ── POST /send ───────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 5_000_000) req.destroy(); });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body); } catch {
        return send(400, { error: 'Invalid JSON' });
      }

      const { to, from, subject, html, text } = payload;
      if (!to || !subject) return send(400, { error: '"to" and "subject" are required' });

      const t = makeTransport();
      try {
        const info = await t.sendMail({
          from: from || cfg.smtp?.from || undefined,
          to, subject,
          html: html || undefined,
          text: text || undefined,
        });
        t.close();
        log(`SENT to="${to}" subject="${subject}" id=${info.messageId}`);
        return send(200, { ok: true, messageId: info.messageId });
      } catch (e) {
        t.close();
        log(`FAIL to="${to}" error=${e.message}`);
        return send(500, { error: e.message });
      }
    });
    return;
  }

  send(404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`Maxvolt Mail Relay  →  http://0.0.0.0:${PORT}`);
  log(`SMTP relay          →  ${cfg.smtp?.host}:${cfg.smtp?.port}`);
  log(`Log file            →  ${LOG_PATH}`);
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});

process.on('uncaughtException', e => log(`UNCAUGHT: ${e.message}`));
process.on('unhandledRejection', e => log(`UNHANDLED: ${e}`));
