// Visitor Kiosk — a locked-down front for the existing Visitor Management module.
//
// Two routers:
//   kioskRouter       /api/kiosk        used by the kiosk device. Its own credentials and its own token (signed with a
//                                       different secret, so a kiosk token is useless anywhere else in the app and an
//                                       employee/admin token is useless here). Every query is pinned to the location
//                                       the kiosk account is configured for — on the server, not in the screen.
//   kioskAdminRouter  /api/kiosk-admin  used by Admin Panel -> Kiosks (admin manages; admin/HR/management read).
//
// No parallel visitor system: kiosks read and write the same `Visitor` entity, with the same statuses
// (pending_approval -> approved/rejected -> checked_in -> checked_out, or cancelled), the same QR pass, the same
// blocked-visitor list, the same host notifications. The kiosk only adds `source_kiosk_*` / `*_via_kiosk_id` stamps.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { one, all, run, q } from '../db.js';
import { JWT_SECRET } from './auth.js';
import {
  parseInvitationCode, last10, cleanText, istNowIso, istNowMs, validateVisit, publicVisit, safePhotoUrl, idReference, ID_TYPES,
  durationToDeparture, makeLimiter, generatePassword, summariseByLocation, MESSAGES,
} from '../utils/kiosk.js';

// A different secret from user tokens: verifying a user token here, or a kiosk token in auth.js, always fails.
const KIOSK_SECRET = createHash('sha256').update('maxvolt-kiosk:' + JWT_SECRET).digest('hex');
const SESSION_HOURS = 12;          // sliding: the kiosk's heartbeat keeps refreshing it; an unplugged kiosk signs itself out
const TICKET_MINUTES = 10;         // from "code accepted" to "check-in pressed"
const CLAIM_MINUTES = 90;          // a walk-in who was approved while waiting can still check in from the kiosk

const loginLimiter = makeLimiter(8, 15 * 60 * 1000);        // per IP + username
const codeFailLimiter = makeLimiter(10, 10 * 60 * 1000);    // wrong invitation codes per kiosk
const codeTryLimiter = makeLimiter(40, 60 * 1000);          // any invitation lookup per kiosk
const walkinLimiter = makeLimiter(12, 60 * 60 * 1000);      // walk-in submissions per kiosk
const hostSearchLimiter = makeLimiter(60, 60 * 1000);       // employee searches per kiosk

const clientIp = (req) => String(req.ip || req.headers['x-forwarded-for'] || '').slice(0, 64);

/* ───────────────────────────── shared helpers ───────────────────────────── */

async function activeLocation(name) {
  if (!name) return null;
  return one("SELECT id FROM entities WHERE type='AppLocation' AND data::jsonb->>'name'=$1 AND COALESCE(data::jsonb->>'is_active','true')<>'false'", [name]);
}

async function writeLog(kiosk, action, { visitor_id = '', result = '', detail = '', ip = '', actor = '' } = {}) {
  try {
    const id = uuidv4();
    const rec = {
      id, kiosk_id: kiosk?.id || '', kiosk_code: kiosk?.kiosk_code || '', kiosk_name: kiosk?.name || '', location_name: kiosk?.location_name || '',
      action, visitor_id, result, detail: String(detail || '').slice(0, 300), actor: actor || (kiosk ? 'kiosk' : ''), ip, at: new Date().toISOString(), at_ist: istNowIso(),
    };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'KioskLog',NULL,'active',$2)", [id, JSON.stringify(rec)]);
  } catch (e) { console.warn('[kiosk] log failed:', e.message); }
}

async function notify(userId, { title, message, type = 'info', link = '' }) {
  if (!userId) return;
  try {
    await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [uuidv4(), userId, title, message, type, link || null]);
    const { sendPushToUser } = await import('../utils/push.js');
    sendPushToUser(userId, { title, message, type, link });
  } catch (e) { console.warn('[kiosk] notify failed:', e.message); }
}

// Same rule as Visitor Management: a gate admin with no assignment covers every location.
async function gateAdminIdsFor(locationName) {
  const rows = await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('gate_admin','front_desk_admin')");
  const out = [];
  for (const r of rows) {
    const a = await one("SELECT data FROM entities WHERE type='GateAdminLocation' AND user_id=$1", [r.id]);
    const locs = a ? JSON.parse(a.data).locations : null;
    if (!Array.isArray(locs) || locs.includes(locationName)) out.push(r.id);
  }
  return out;
}

const publicKiosk = (k) => ({ id: k.id, kiosk_code: k.kiosk_code, name: k.name, location_name: k.location_name });
const adminKiosk = (k) => { const { password_hash, ...rest } = k; return rest; };

const signSession = (k) => jwt.sign({ typ: 'kiosk', kid: k.id, sv: k.session_version || 1 }, KIOSK_SECRET, { expiresIn: `${SESSION_HOURS}h` });
const signTicket = (k, visitorId, intent, minutes) => jwt.sign({ typ: 'ticket', kid: k.id, vid: visitorId, intent }, KIOSK_SECRET, { expiresIn: `${minutes}m` });

async function loadKioskRow(id) {
  const row = await one("SELECT id, data FROM entities WHERE type='Kiosk' AND id=$1", [id]);
  return row ? { row, k: JSON.parse(row.data) } : null;
}
async function saveKiosk(row, k) {
  await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify(k), k.is_active ? 'active' : 'inactive', row.id]);
}

/* ───────────────────────────── kiosk device API ───────────────────────────── */

export const kioskRouter = Router();
kioskRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

kioskRouter.post('/login', async (req, res) => {
  try {
    const username = cleanText(req.body?.username, 60).toLowerCase();
    const password = String(req.body?.password || '');
    const ip = clientIp(req);
    if (!username || !password) return res.status(400).json({ error: 'Enter the kiosk username and password' });
    const key = `${ip}|${username}`;
    if (loginLimiter.count(key) >= 8) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });

    const rows = await all("SELECT id, data FROM entities WHERE type='Kiosk' AND data::jsonb->>'username'=$1", [username]);
    const row = rows[0];
    const k = row ? JSON.parse(row.data) : null;
    const good = !!k && await bcrypt.compare(password, k.password_hash || '');
    if (!good) {
      loginLimiter.hit(key);
      await writeLog(k || null, 'login_failed', { result: 'rejected', detail: `username ${username}`, ip, actor: 'device' });
      return res.status(401).json({ error: 'Incorrect kiosk username or password' });
    }
    if (!k.is_active) {
      await writeLog(k, 'login_failed', { result: 'inactive', ip });
      return res.status(403).json({ error: 'This kiosk has been deactivated. Please contact the administrator.' });
    }
    if (!(await activeLocation(k.location_name))) return res.status(403).json({ error: 'The location assigned to this kiosk is not active. Please contact the administrator.' });
    loginLimiter.reset(key);
    const now = new Date().toISOString();
    const upd = { ...k, last_login_at: now, last_active_at: now, last_ip: ip, device_agent: String(req.headers['user-agent'] || '').slice(0, 160) };
    await saveKiosk(row, upd);
    await writeLog(upd, 'login', { result: 'ok', ip });
    return res.json({ success: true, token: signSession(upd), kiosk: publicKiosk(upd) });
  } catch (e) { console.error('[kiosk/login]', e.message); return res.status(500).json({ error: 'Something went wrong' }); }
});

// Everything below needs a valid kiosk session that is still allowed: account active, session not revoked, location unchanged and live.
async function kioskAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Kiosk is not signed in', code: 'signed_out' });
  let d;
  try { d = jwt.verify(token, KIOSK_SECRET); } catch { return res.status(401).json({ error: 'Kiosk session expired', code: 'signed_out' }); }
  if (d.typ !== 'kiosk') return res.status(401).json({ error: 'Kiosk session expired', code: 'signed_out' });
  let found;
  try { found = await loadKioskRow(d.kid); } catch (e) { return res.status(503).json({ error: 'Temporarily unavailable' }); }
  if (!found) return res.status(401).json({ error: 'Kiosk not found', code: 'signed_out' });
  const { row, k } = found;
  if (!k.is_active) return res.status(401).json({ error: 'This kiosk has been deactivated', code: 'signed_out' });
  if ((k.session_version || 1) !== d.sv) return res.status(401).json({ error: 'This kiosk session was ended by the administrator', code: 'signed_out' });
  if (!(await activeLocation(k.location_name))) return res.status(401).json({ error: 'The location assigned to this kiosk is not active', code: 'signed_out' });
  // last-seen, written at most every 30s
  if (!k.last_active_at || Date.now() - Date.parse(k.last_active_at) > 30000) {
    k.last_active_at = new Date().toISOString(); k.last_ip = clientIp(req);
    saveKiosk(row, k).catch(() => {});
  }
  req.kiosk = k; req.kioskTokenIat = d.iat;
  next();
}
kioskRouter.use(kioskAuth);

kioskRouter.get('/me', (req, res) => {
  // refresh the session while the device is alive
  const fresh = (Date.now() / 1000 - (req.kioskTokenIat || 0)) > 3600 ? signSession(req.kiosk) : null;
  res.json({ success: true, kiosk: publicKiosk(req.kiosk), token: fresh, server_time: Date.now(), ist: istNowIso(), id_types: ID_TYPES });
});

kioskRouter.post('/logout', async (req, res) => {
  await writeLog(req.kiosk, 'logout', { result: 'ok', ip: clientIp(req) });
  res.json({ success: true });
});

// ── Look up an invitation / pass. Location is part of the query for short Pass IDs; a full QR code is looked up globally
//    only so a visitor at the wrong office can be told so — nothing about that visit is returned.
async function findByCode(kiosk, parsed, mobile4) {
  if (parsed.kind === 'qr') {
    const r = await one("SELECT id, data FROM entities WHERE type='Visitor' AND data::jsonb->>'qr_code'=$1", [parsed.value]);
    return r ? { row: r, v: JSON.parse(r.data) } : null;
  }
  if (parsed.kind === 'pass_id') {
    if (!/^\d{4}$/.test(mobile4 || '')) return { needMobile: true };
    const rows = await all("SELECT id, data FROM entities WHERE type='Visitor' AND lower(id) LIKE $1 AND data::jsonb->>'location_name'=$2 LIMIT 5", [parsed.value + '%', kiosk.location_name]);
    const hit = rows.map(r => ({ row: r, v: JSON.parse(r.data) })).find(x => last10(x.v.mobile_number).slice(-4) === mobile4);
    return hit || null;
  }
  return null;
}

kioskRouter.post('/lookup', async (req, res) => {
  const kiosk = req.kiosk; const ip = clientIp(req);
  try {
    const intent = req.body?.intent === 'checkout' ? 'checkout' : 'checkin';
    if (!codeTryLimiter.hit(kiosk.id) || codeFailLimiter.count(kiosk.id) >= 10) {
      await writeLog(kiosk, 'invite_lookup', { result: 'rate_limited', ip });
      return res.status(429).json({ success: false, code: 'rate_limited', error: 'Too many attempts. Please wait a few minutes or ask the reception for help.' });
    }
    const parsed = parseInvitationCode(req.body?.code);
    const mobile4 = String(req.body?.mobile_last4 || '').replace(/\D/g, '').slice(-4);
    if (!parsed.kind) { codeFailLimiter.hit(kiosk.id); await writeLog(kiosk, 'invite_lookup', { result: 'invalid', detail: 'unreadable code', ip }); return res.json({ success: false, code: 'invalid', error: MESSAGES.invalid }); }
    const found = await findByCode(kiosk, parsed, mobile4);
    if (found?.needMobile) return res.json({ success: false, code: 'need_mobile', error: 'Please enter the last 4 digits of the mobile number the invitation was sent to.' });
    if (!found) { codeFailLimiter.hit(kiosk.id); await writeLog(kiosk, 'invite_lookup', { result: 'invalid', detail: parsed.kind === 'pass_id' ? 'pass id not matched' : 'code not found', ip }); return res.json({ success: false, code: 'invalid', error: MESSAGES.invalid }); }

    const verdict = validateVisit(found.v, kiosk.location_name, intent);
    if (!verdict.ok) {
      if (verdict.code === 'wrong_location') codeFailLimiter.hit(kiosk.id);
      await writeLog(kiosk, 'invite_lookup', { visitor_id: verdict.code === 'wrong_location' ? '' : found.v.id, result: verdict.code, detail: `${intent}`, ip });
      return res.json({ success: false, code: verdict.code, error: verdict.message });
    }
    await writeLog(kiosk, 'invite_lookup', { visitor_id: found.v.id, result: 'valid', detail: intent, ip });
    return res.json({ success: true, visitor: publicVisit(found.v), ticket: signTicket(kiosk, found.v.id, intent, TICKET_MINUTES), intent });
  } catch (e) { console.error('[kiosk/lookup]', e.message); return res.status(500).json({ error: 'Something went wrong' }); }
});

function readTicket(req, intent) {
  try {
    const d = jwt.verify(String(req.body?.ticket || ''), KIOSK_SECRET);
    if (d.typ !== 'ticket' || d.kid !== req.kiosk.id || d.intent !== intent) return null;
    return d;
  } catch { return null; }
}

kioskRouter.post('/checkin', async (req, res) => {
  const kiosk = req.kiosk; const ip = clientIp(req);
  try {
    const t = readTicket(req, 'checkin');
    if (!t) return res.status(400).json({ success: false, code: 'ticket', error: 'This step timed out. Please start again.' });
    const row = await one("SELECT id, data FROM entities WHERE type='Visitor' AND id=$1", [t.vid]);
    const v = row ? JSON.parse(row.data) : null;
    const verdict = validateVisit(v, kiosk.location_name, 'checkin');
    if (!verdict.ok) { await writeLog(kiosk, 'check_in', { visitor_id: t.vid, result: verdict.code, ip }); return res.json({ success: false, code: verdict.code, error: verdict.message }); }
    if (req.body?.declaration !== true) return res.json({ success: false, code: 'declaration', error: 'Please accept the visitor guidelines to continue.' });

    const photo = safePhotoUrl(req.body?.photo_url);
    const now = istNowIso();
    const upd = {
      ...v, status: 'checked_in', check_in_time: now, check_in_by: null, check_in_by_name: `Kiosk — ${kiosk.name}`,
      checked_in_via_kiosk_id: kiosk.id, checked_in_via_kiosk_name: kiosk.name,
      photo_url: photo || v.photo_url || '',
      id_proof_reference: idReference(req.body?.id_type, req.body?.id_number) || v.id_proof_reference || '',
      vehicle_number: cleanText(req.body?.vehicle_number, 20).toUpperCase() || v.vehicle_number || '',
      declaration_accepted_at: now,
    };
    // Atomic: only moves an approved visit; a second tap / second kiosk can't check the same visitor in twice.
    const r = await q("UPDATE entities SET status='checked_in', data=$1, updated_at=NOW()::TEXT WHERE id=$2 AND type='Visitor' AND status='approved'", [JSON.stringify(upd), v.id]);
    if (!r.rowCount) { await writeLog(kiosk, 'check_in', { visitor_id: v.id, result: 'checked_in', detail: 'duplicate prevented', ip }); return res.json({ success: false, code: 'checked_in', error: MESSAGES.checked_in }); }
    await writeLog(kiosk, 'check_in', { visitor_id: v.id, result: 'ok', detail: v.source === 'walk_in' ? 'walk-in' : 'invited', ip });
    await notify(v.host_user_id, { title: 'Your Visitor Has Arrived', message: `${v.visitor_name}${v.company ? ` (${v.company})` : ''} has checked in at the ${v.location_name} kiosk.`, type: 'info', link: '/MyVisitors' });
    return res.json({ success: true, message: 'Check-in Successful! Your host has been notified. Please wait for further instructions.', host_name: v.host_name });
  } catch (e) { console.error('[kiosk/checkin]', e.message); return res.status(500).json({ error: 'Something went wrong' }); }
});

kioskRouter.post('/checkout', async (req, res) => {
  const kiosk = req.kiosk; const ip = clientIp(req);
  try {
    const t = readTicket(req, 'checkout');
    if (!t) return res.status(400).json({ success: false, code: 'ticket', error: 'This step timed out. Please start again.' });
    const row = await one("SELECT id, data FROM entities WHERE type='Visitor' AND id=$1", [t.vid]);
    const v = row ? JSON.parse(row.data) : null;
    const verdict = validateVisit(v, kiosk.location_name, 'checkout');
    if (!verdict.ok) { await writeLog(kiosk, 'check_out', { visitor_id: t.vid, result: verdict.code, ip }); return res.json({ success: false, code: verdict.code, error: verdict.message }); }
    const upd = { ...v, status: 'checked_out', check_out_time: istNowIso(), check_out_by: null, check_out_by_name: `Kiosk — ${kiosk.name}`, checked_out_via_kiosk_id: kiosk.id };
    const r = await q("UPDATE entities SET status='checked_out', data=$1, updated_at=NOW()::TEXT WHERE id=$2 AND type='Visitor' AND status='checked_in'", [JSON.stringify(upd), v.id]);
    if (!r.rowCount) return res.json({ success: false, code: 'checked_out', error: MESSAGES.checked_out });
    await writeLog(kiosk, 'check_out', { visitor_id: v.id, result: 'ok', ip });
    return res.json({ success: true, message: 'Check-out complete. Thank you for visiting MaxVolt Energy!' });
  } catch (e) { console.error('[kiosk/checkout]', e.message); return res.status(500).json({ error: 'Something went wrong' }); }
});

// Host picker — eligible = active employees who have a login. Returns just id, name, department.
kioskRouter.get('/hosts', async (req, res) => {
  try {
    if (!hostSearchLimiter.hit(req.kiosk.id)) return res.status(429).json({ error: 'Please slow down' });
    const term = cleanText(req.query.q, 40).toLowerCase();
    if (term.length < 2) return res.json({ success: true, hosts: [] });
    const like = '%' + term.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const rows = await all(
      `SELECT user_id, data::jsonb->>'display_name' AS name, data::jsonb->>'department' AS department
         FROM entities
        WHERE type='Employee' AND user_id IS NOT NULL AND COALESCE(data::jsonb->>'status', status)='active'
          AND (lower(COALESCE(data::jsonb->>'display_name','')) LIKE $1 OR lower(COALESCE(data::jsonb->>'employee_code','')) LIKE $1 OR lower(COALESCE(data::jsonb->>'department','')) LIKE $1)
        ORDER BY data::jsonb->>'display_name' LIMIT 8`, [like]);
    const ids = rows.map(r => r.user_id);
    const live = ids.length ? new Set((await all("SELECT id FROM users WHERE id = ANY($1::text[])", [ids])).map(u => u.id)) : new Set();
    return res.json({ success: true, hosts: rows.filter(r => live.has(r.user_id) && r.name).map(r => ({ id: r.user_id, name: r.name, department: r.department || '' })) });
  } catch (e) { console.error('[kiosk/hosts]', e.message); return res.status(500).json({ error: 'Something went wrong' }); }
});

kioskRouter.post('/walkin', async (req, res) => {
  const kiosk = req.kiosk; const ip = clientIp(req); const b = req.body || {};
  try {
    if (!walkinLimiter.hit(kiosk.id)) return res.status(429).json({ success: false, error: 'Too many registrations just now. Please ask the reception for help.' });
    const name = cleanText(b.visitor_name, 80);
    const mobile = last10(b.mobile_number);
    const email = cleanText(b.visitor_email, 120).toLowerCase();
    const company = cleanText(b.company, 100);
    const purpose = cleanText(b.purpose, 200);
    const hostId = cleanText(b.host_user_id, 80);
    const fail = (error, code = 'invalid_input') => res.json({ success: false, code, error });
    if (name.length < 2) return fail('Please enter your full name.');
    if (!/^[6-9]\d{9}$/.test(mobile)) return fail('Please enter a valid 10-digit mobile number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Please enter a valid email address, or leave it blank.');
    if (purpose.length < 3) return fail('Please tell us the purpose of your visit.');
    if (!hostId) return fail('Please choose the person you are visiting.');
    if (b.declaration !== true) return fail('Please accept the visitor guidelines to continue.');
    const photo = safePhotoUrl(b.photo_url);
    if (!photo && b.photo_skipped !== true) return fail('Please take your photograph to continue.');

    const host = await one(
      `SELECT e.user_id, e.data::jsonb->>'display_name' AS name, e.data::jsonb->>'department' AS department FROM entities e
         JOIN users u ON u.id = e.user_id
        WHERE e.type='Employee' AND e.user_id=$1 AND COALESCE(e.data::jsonb->>'status', e.status)='active'`, [hostId]);
    if (!host) return fail('The person you selected is not available. Please choose again.');

    const blocked = await one("SELECT id FROM entities WHERE type='BlockedVisitor' AND right(regexp_replace(data::jsonb->>'mobile_number','\\D','','g'),10)=$1", [mobile]);
    if (blocked) { await writeLog(kiosk, 'walkin_register', { result: 'restricted', ip }); return res.json({ success: false, code: 'RESTRICTED', error: 'We are unable to register this visit. Please speak to the reception.' }); }

    const today = istNowIso().slice(0, 10);
    const dup = await one(
      `SELECT id, data FROM entities WHERE type='Visitor' AND data::jsonb->>'location_name'=$1
          AND status IN ('pending_approval','approved','checked_in')
          AND right(regexp_replace(data::jsonb->>'mobile_number','\\D','','g'),10)=$2
          AND substr(COALESCE(data::jsonb->>'expected_arrival',''),1,10)=$3 LIMIT 1`, [kiosk.location_name, mobile, today]);
    if (dup) {
      const ds = JSON.parse(dup.data).status;
      await writeLog(kiosk, 'walkin_register', { visitor_id: dup.id, result: 'duplicate', detail: ds, ip });
      return res.json({ success: false, code: 'duplicate', error: ds === 'checked_in' ? 'You have already checked in today.' : ds === 'approved' ? 'You already have an approved visit today. Choose "I Have an Invitation" or ask the reception.' : 'A request for this mobile number is already waiting for approval. Please wait for your host to respond.' });
    }

    const id = uuidv4(); const nowMs = istNowMs();
    const data = {
      id, visitor_name: name, mobile_number: mobile, visitor_email: email, company,
      visitor_category: ['guest', 'vendor', 'client', 'interview', 'delivery', 'other'].includes(b.visitor_category) ? b.visitor_category : 'guest',
      purpose, host_user_id: host.user_id, host_name: host.name, host_department: host.department || '',
      created_by: null, created_by_name: `Kiosk — ${kiosk.name}`,
      source: 'walk_in', source_kiosk_id: kiosk.id, source_kiosk_name: kiosk.name, source_kiosk_code: kiosk.kiosk_code,
      location_name: kiosk.location_name,
      expected_arrival: new Date(nowMs).toISOString(), expected_departure: durationToDeparture(b.duration_minutes, nowMs),
      vehicle_number: cleanText(b.vehicle_number, 20).toUpperCase(), photo_url: photo,
      id_proof_reference: idReference(b.id_type, b.id_number),
      declaration_accepted_at: istNowIso(),
      status: 'pending_approval',
    };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Visitor',$2,'pending_approval',$3)", [id, host.user_id, JSON.stringify(data)]);
    await writeLog(kiosk, 'walkin_register', { visitor_id: id, result: 'pending_approval', detail: `host ${host.name}`, ip });
    await notify(host.user_id, { title: 'Visitor Waiting at Gate', message: `${name}${company ? ` from ${company}` : ''} is at the ${kiosk.location_name} kiosk to meet you — please approve or reject.`, type: 'info', link: '/MyVisitors' });
    for (const gid of await gateAdminIdsFor(kiosk.location_name)) {
      if (gid !== host.user_id) await notify(gid, { title: 'New Visitor Request', message: `${name}${company ? ` (${company})` : ''} registered at the ${kiosk.location_name} kiosk to meet ${host.name} — awaiting approval.`, type: 'info', link: '/VisitorManagement' });
    }
    return res.json({
      success: true, status: 'pending_approval', visitor_id: id, host_name: host.name,
      message: 'Registration Submitted Successfully. Your request has been sent to the concerned employee for approval. Please wait for confirmation.',
      claim: signTicket(kiosk, id, 'claim', CLAIM_MINUTES),
    });
  } catch (e) { console.error('[kiosk/walkin]', e.message); return res.status(500).json({ error: 'Something went wrong' }); }
});

// The walk-in confirmation screen polls this with the claim it was given. Never reveals internal notes.
kioskRouter.post('/walkin-status', async (req, res) => {
  try {
    const t = readTicket(req, 'claim');
    if (!t) return res.json({ success: false, code: 'ticket', error: 'Status is no longer available.' });
    const row = await one("SELECT data FROM entities WHERE type='Visitor' AND id=$1", [t.vid]);
    const v = row ? JSON.parse(row.data) : null;
    if (!v || v.location_name !== req.kiosk.location_name) return res.json({ success: false, code: 'invalid', error: 'Status is no longer available.' });
    const out = { success: true, status: v.status, host_name: v.host_name };
    if (v.status === 'approved') out.ticket = signTicket(req.kiosk, v.id, 'checkin', TICKET_MINUTES);
    return res.json(out);
  } catch { return res.status(500).json({ error: 'Something went wrong' }); }
});

/* ───────────────────────────── admin API ───────────────────────────── */

export const kioskAdminRouter = Router();

async function adminAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  let d;
  try { d = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }
  if (!d?.id || d.typ) return res.status(401).json({ error: 'Invalid token' });
  try {
    const u = await one('SELECT id, full_name, display_name, role, custom_role FROM users WHERE id=$1', [d.id]);
    if (!u) return res.status(401).json({ error: 'Invalid token' });
    const role = u.custom_role || u.role;
    if (!['admin', 'hr', 'management'].includes(role)) return res.status(403).json({ error: 'Admin, HR or management access required' });
    req.adminUser = { id: u.id, name: u.display_name || u.full_name || u.id, role };
    next();
  } catch { return res.status(503).json({ error: 'Temporarily unable to verify access' }); }
}
const adminOnly = (req, res, next) => (req.adminUser.role === 'admin' ? next() : res.status(403).json({ error: 'Only an administrator can manage kiosks' }));
kioskAdminRouter.use(adminAuth);

kioskAdminRouter.get('/overview', async (_req, res) => {
  try {
    const rows = await all("SELECT data FROM entities WHERE type='Kiosk' ORDER BY created_at");
    const kiosks = rows.map(r => adminKiosk(JSON.parse(r.data)));
    const online = (k) => k.is_active && k.last_active_at && Date.now() - Date.parse(k.last_active_at) < 3 * 60 * 1000;
    const byLoc = {};
    for (const k of kiosks) { const e = byLoc[k.location_name] || (byLoc[k.location_name] = { location: k.location_name, total: 0, active: 0 }); e.total++; if (k.is_active) e.active++; }
    const locations = (await all("SELECT data::jsonb->>'name' AS name FROM entities WHERE type='AppLocation' AND COALESCE(data::jsonb->>'is_active','true')<>'false' ORDER BY 1")).map(r => r.name).filter(Boolean);
    res.json({
      success: true, kiosks: kiosks.map(k => ({ ...k, online: !!online(k) })), locations,
      stats: { total: kiosks.length, active: kiosks.filter(k => k.is_active).length, inactive: kiosks.filter(k => !k.is_active).length, online: kiosks.filter(online).length, by_location: Object.values(byLoc) },
      can_manage: _req.adminUser.role === 'admin',
    });
  } catch (e) { console.error('[kiosk-admin/overview]', e.message); res.status(500).json({ error: e.message }); }
});

const validUsername = (u) => /^[a-z0-9._-]{3,40}$/.test(u);

kioskAdminRouter.post('/', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const name = cleanText(b.name, 80); const username = cleanText(b.username, 40).toLowerCase(); const location = cleanText(b.location_name, 120);
    if (!name) return res.json({ success: false, error: 'Kiosk name is required' });
    if (!validUsername(username)) return res.json({ success: false, error: 'Username must be 3–40 characters: letters, numbers, dot, dash or underscore' });
    if (!(await activeLocation(location))) return res.json({ success: false, error: 'Choose a configured, active office location' });
    if (await one("SELECT id FROM entities WHERE type='Kiosk' AND data::jsonb->>'username'=$1", [username])) return res.json({ success: false, error: 'That username is already used by another kiosk' });
    const password = b.password ? String(b.password) : generatePassword();
    if (password.length < 10) return res.json({ success: false, error: 'Password must be at least 10 characters' });
    const seq = (await all("SELECT data::jsonb->>'kiosk_code' AS c FROM entities WHERE type='Kiosk'")).map(r => parseInt(String(r.c || '').replace(/\D/g, ''), 10) || 0);
    const id = uuidv4();
    const k = {
      id, kiosk_code: `KSK-${String(Math.max(0, ...seq) + 1).padStart(3, '0')}`, name, location_name: location, username,
      password_hash: await bcrypt.hash(password, 10), is_active: true, session_version: 1, device_id: cleanText(b.device_id, 80),
      last_login_at: null, last_active_at: null, created_by: req.adminUser.id, created_by_name: req.adminUser.name, created_at: new Date().toISOString(),
    };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Kiosk',NULL,'active',$2)", [id, JSON.stringify(k)]);
    await writeLog(k, 'kiosk_created', { result: 'ok', actor: req.adminUser.name, detail: `location ${location}` });
    res.json({ success: true, kiosk: adminKiosk(k), password });   // the password is shown to the administrator once
  } catch (e) { console.error('[kiosk-admin/create]', e.message); res.status(500).json({ error: e.message }); }
});

kioskAdminRouter.patch('/:id', adminOnly, async (req, res) => {
  try {
    const found = await loadKioskRow(req.params.id);
    if (!found) return res.status(404).json({ error: 'Kiosk not found' });
    const { row, k } = found; const b = req.body || {}; const upd = { ...k }; const changes = []; let revoke = false;
    if (b.name !== undefined) { const n = cleanText(b.name, 80); if (!n) return res.json({ success: false, error: 'Kiosk name is required' }); if (n !== k.name) { upd.name = n; changes.push('name'); } }
    if (b.device_id !== undefined) { upd.device_id = cleanText(b.device_id, 80); changes.push('device'); }
    if (b.username !== undefined) {
      const u = cleanText(b.username, 40).toLowerCase();
      if (u !== k.username) {
        if (!validUsername(u)) return res.json({ success: false, error: 'Username must be 3–40 characters: letters, numbers, dot, dash or underscore' });
        if (await one("SELECT id FROM entities WHERE type='Kiosk' AND data::jsonb->>'username'=$1 AND id<>$2", [u, k.id])) return res.json({ success: false, error: 'That username is already used by another kiosk' });
        upd.username = u; changes.push('username'); revoke = true;
      }
    }
    if (b.location_name !== undefined && b.location_name !== k.location_name) {
      if (!(await activeLocation(cleanText(b.location_name, 120)))) return res.json({ success: false, error: 'Choose a configured, active office location' });
      changes.push(`location ${k.location_name} → ${b.location_name}`); upd.location_name = cleanText(b.location_name, 120); revoke = true;   // takes effect at once: old sessions end
    }
    if (b.is_active !== undefined && !!b.is_active !== !!k.is_active) { upd.is_active = !!b.is_active; changes.push(upd.is_active ? 'activated' : 'deactivated'); if (!upd.is_active) revoke = true; }
    if (revoke) upd.session_version = (k.session_version || 1) + 1;
    await saveKiosk(row, upd);
    if (changes.length) await writeLog(upd, 'kiosk_updated', { result: 'ok', actor: req.adminUser.name, detail: changes.join('; ') + (revoke ? ' — sessions ended' : '') });
    res.json({ success: true, kiosk: adminKiosk(upd) });
  } catch (e) { console.error('[kiosk-admin/update]', e.message); res.status(500).json({ error: e.message }); }
});

kioskAdminRouter.post('/:id/reset-credentials', adminOnly, async (req, res) => {
  try {
    const found = await loadKioskRow(req.params.id);
    if (!found) return res.status(404).json({ error: 'Kiosk not found' });
    const password = req.body?.password ? String(req.body.password) : generatePassword();
    if (password.length < 10) return res.json({ success: false, error: 'Password must be at least 10 characters' });
    const upd = { ...found.k, password_hash: await bcrypt.hash(password, 10), session_version: (found.k.session_version || 1) + 1 };
    await saveKiosk(found.row, upd);
    await writeLog(upd, 'credentials_reset', { result: 'ok', actor: req.adminUser.name, detail: 'password changed, sessions ended' });
    res.json({ success: true, password, kiosk: adminKiosk(upd) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

kioskAdminRouter.post('/:id/revoke-sessions', adminOnly, async (req, res) => {
  try {
    const found = await loadKioskRow(req.params.id);
    if (!found) return res.status(404).json({ error: 'Kiosk not found' });
    const upd = { ...found.k, session_version: (found.k.session_version || 1) + 1 };
    await saveKiosk(found.row, upd);
    await writeLog(upd, 'sessions_revoked', { result: 'ok', actor: req.adminUser.name });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

kioskAdminRouter.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const params = []; let where = "type='KioskLog'";
    if (req.query.kiosk_id) { params.push(String(req.query.kiosk_id)); where += ` AND data::jsonb->>'kiosk_id'=$${params.length}`; }
    if (req.query.location) { params.push(String(req.query.location)); where += ` AND data::jsonb->>'location_name'=$${params.length}`; }
    const rows = await all(`SELECT data FROM entities WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`, params);
    res.json({ success: true, logs: rows.map(r => JSON.parse(r.data)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Location-wise visitor report (all visitors, with how many were handled through a kiosk).
kioskAdminRouter.get('/report', async (req, res) => {
  try {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : istNowIso().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : new Date(Date.parse(to + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
    const rows = await all("SELECT data FROM entities WHERE type='Visitor'");
    const day = (v) => String(v.expected_arrival || v.check_in_time || '').slice(0, 10);
    let vis = rows.map(r => JSON.parse(r.data)).filter(v => { const d = day(v); return d >= from && d <= to; });
    if (req.query.location && req.query.location !== 'all') vis = vis.filter(v => v.location_name === req.query.location);
    const kioskOnly = req.query.kiosk_only === '1';
    if (kioskOnly) vis = vis.filter(v => v.source_kiosk_id || v.checked_in_via_kiosk_id || v.checked_out_via_kiosk_id);
    const byLocation = summariseByLocation(vis);
    const total = byLocation.reduce((a, r) => { for (const k of Object.keys(r)) if (typeof r[k] === 'number') a[k] = (a[k] || 0) + r[k]; return a; }, {});
    res.json({ success: true, from, to, by_location: byLocation, total });
  } catch (e) { console.error('[kiosk-admin/report]', e.message); res.status(500).json({ error: e.message }); }
});
