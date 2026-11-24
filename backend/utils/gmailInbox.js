// Reads the hiring mailbox (for example careers@maxvoltenergy.com) through the Gmail API with the Google service account
// (domain-wide delegation, READ-ONLY scope) and hands each new email to candidate intake. Nothing in the mailbox is changed or
// deleted: processed messages are remembered in the database instead of being labelled.
import jwt from 'jsonwebtoken';
import { one, all, run } from '../db.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const STATE_ID = 'intake-mail-state';
const MAX_PER_RUN = 25;
const MAX_ATTACHMENT = 15 * 1024 * 1024;

export const intakeMailbox = () => String(process.env.INTAKE_MAILBOX || '').trim().toLowerCase();

function loadKey() {
  const b64 = process.env.INTAKE_GOOGLE_KEY_B64 || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || '';
  if (!b64.trim()) throw new Error('No Google service account key is configured (INTAKE_GOOGLE_KEY_B64)');
  let j; try { j = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8')); } catch { throw new Error('The Google service account key is not valid'); }
  if (!j.client_email || !j.private_key) throw new Error('The Google service account key is incomplete');
  return { email: j.client_email, key: String(j.private_key).replace(/\\n/g, '\n') };
}

let tokenCache = { mailbox: '', token: '', exp: 0 };
async function accessToken(mailbox) {
  if (tokenCache.mailbox === mailbox && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const { email, key } = loadKey();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: email, sub: mailbox, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3000 }, key, { algorithm: 'RS256' });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const why = d.error_description || d.error || `HTTP ${r.status}`;
    const raw = `${d.error || ''} ${d.error_description || ''}`;
    const hint = /unauthorized_client/i.test(raw) ? ` — Google has not allowed this service account to read mail yet: in the Workspace Admin Console add the scope ${SCOPE} to its domain-wide delegation` : /invalid_grant|invalid_subject/i.test(raw) ? ` — ${mailbox} is not a mailbox Google recognises for this account` : '';
    throw new Error(`Google sign-in failed: ${why}${hint}`);
  }
  tokenCache = { mailbox, token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3000) * 1000 };
  return tokenCache.token;
}

async function gmail(mailbox, path) {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${await accessToken(mailbox)}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gmail error ${r.status}: ${d?.error?.message || ''}`.trim());
  return d;
}

const b64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const header = (msg, name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name)?.value || '';

/** Walks the MIME tree: plain text, html fallback, and attachment parts. */
function walk(part, out) {
  if (!part) return;
  if (part.filename && (part.body?.attachmentId || part.body?.data)) out.attachments.push({ filename: part.filename, mime: part.mimeType, id: part.body.attachmentId, data: part.body.data, size: part.body.size || 0 });
  else if (part.mimeType === 'text/plain' && part.body?.data) out.text += b64u(part.body.data).toString('utf8') + '\n';
  else if (part.mimeType === 'text/html' && part.body?.data) out.html += b64u(part.body.data).toString('utf8') + '\n';
  for (const p of part.parts || []) walk(p, out);
}

const addrList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const NOISE_FROM = /mailer-daemon|postmaster|no-?reply@maxvoltenergy\.com/i;

async function readState() { const r = await one("SELECT data FROM entities WHERE type='IntakeMailState' AND id=$1", [STATE_ID]); try { return r ? JSON.parse(r.data) : {}; } catch { return {}; } }
async function saveState(s) {
  const have = await one("SELECT id FROM entities WHERE type='IntakeMailState' AND id=$1", [STATE_ID]);
  if (have) await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(s), STATE_ID]);
  else await run("INSERT INTO entities(id,type,status,data) VALUES($1,'IntakeMailState','active',$2)", [STATE_ID, JSON.stringify(s)]);
}
export const intakeMailState = readState;

let running = false;
/** One pass over the hiring mailbox. Safe to run at any time: a message is only ever processed once. */
export async function pollIntakeMailbox({ force = false } = {}) {
  const mailbox = intakeMailbox();
  if (!mailbox) return { skipped: 'INTAKE_MAILBOX is not set' };
  if (running) return { skipped: 'already running' };
  running = true;
  const state = await readState();
  const t0 = Date.now(); const out = { mailbox, checked: 0, processed: 0, created: 0, merged: 0, needs_review: 0, skipped: 0, errors: [] };
  try {
    const backfill = Math.max(1, Number(process.env.INTAKE_BACKFILL_DAYS) || 2);
    const since = state.cursor_epoch ? state.cursor_epoch - 3600 : Math.floor(Date.now() / 1000) - backfill * 86400;
    const q = `in:inbox after:${since} -from:me`;
    const list = await gmail(mailbox, `/messages?q=${encodeURIComponent(q)}&maxResults=100`);
    let truncated = !!list.nextPageToken; let handled = 0;
    const { processInboundEmail } = await import('../routes/candidateIntake.js');
    let newestMs = 0;
    for (const m of list.messages || []) {
      out.checked++;
      const logId = `gmailmsg-${mailbox}-${m.id}`;
      if (await one("SELECT id FROM entities WHERE id=$1", [logId])) continue;
      if (handled >= MAX_PER_RUN) { truncated = true; break; }
      handled++;
      try {
        const msg = await gmail(mailbox, `/messages/${m.id}?format=full`);
        newestMs = Math.max(newestMs, Number(msg.internalDate) || 0);
        const from = header(msg, 'from'); const subject = header(msg, 'subject');
        const auto = /auto-(replied|generated)/i.test(header(msg, 'auto-submitted'));
        let outcomes = [];
        if (NOISE_FROM.test(from) || auto) { out.skipped++; }
        else {
          const parts = { text: '', html: '', attachments: [] }; walk(msg.payload, parts);
          const attachments = [];
          for (const a of parts.attachments) {
            if (a.size > MAX_ATTACHMENT) continue;
            const buf = a.id ? b64u((await gmail(mailbox, `/messages/${m.id}/attachments/${a.id}`)).data) : b64u(a.data);
            attachments.push({ filename: a.filename, buffer: buf, contentType: a.mime });
          }
          const text = parts.text || parts.html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
          const res = await processInboundEmail({ from, to: [...addrList(header(msg, 'to')), ...addrList(header(msg, 'delivered-to')), ...addrList(header(msg, 'cc'))], subject, text, attachments });
          outcomes = res.map((r) => r.outcome);
          for (const o of outcomes) { if (o === 'created') out.created++; else if (o === 'merged') out.merged++; else if (o === 'needs_review') out.needs_review++; }
          out.processed++;
        }
        await run("INSERT INTO entities(id,type,status,data) VALUES($1,'IntakeMailLog','done',$2) ON CONFLICT (id) DO NOTHING", [logId, JSON.stringify({ id: logId, gmail_id: m.id, from, subject, at: new Date().toISOString(), outcomes })]);
      } catch (e) { out.errors.push(`${m.id}: ${e.message}`); console.error('[intake-mail] message failed:', e.message); }
    }
    await saveState({ ...state, cursor_epoch: (!truncated && newestMs) ? Math.floor(newestMs / 1000) : (state.cursor_epoch || Math.floor(Date.now() / 1000) - backfill * 86400), backlog: truncated, last_run_at: new Date().toISOString(), last_ok: out.errors.length === 0, last_error: out.errors[0] || '', last_ms: Date.now() - t0,
      total_processed: (state.total_processed || 0) + out.processed, total_created: (state.total_created || 0) + out.created, total_merged: (state.total_merged || 0) + out.merged, total_review: (state.total_review || 0) + out.needs_review, mailbox });
  } catch (e) {
    out.errors.push(e.message);
    await saveState({ ...state, last_run_at: new Date().toISOString(), last_ok: false, last_error: e.message, mailbox }).catch(() => {});
    console.error('[intake-mail] poll failed:', e.message);
  } finally { running = false; }
  return out;
}
