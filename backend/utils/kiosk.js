// Visitor Kiosk — pure helpers (no DB, no Express) so the rules can be unit-tested.
// The kiosk adapts to the existing Visitor Management rules (statuses, QR pass,
// IST-digits-as-UTC timestamps); nothing here changes those rules.

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const PASS_ID_RE = /^[0-9a-f]{8}$/i;   // "Pass ID" printed on the visitor pass = first 8 characters of the visit id

// Text typed or scanned on the kiosk -> something safe to put in a query.
// Returns { kind: 'qr'|'pass_id'|null, value }.
export function parseInvitationCode(raw) {
  const s = String(raw || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!s || s.length > 80) return { kind: null, value: '' };
  if (UUID_RE.test(s)) {
    const h = s.replace(/-/g, '').toLowerCase();
    return { kind: 'qr', value: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
  }
  const compact = s.replace(/[\s-]/g, '');
  if (PASS_ID_RE.test(compact)) return { kind: 'pass_id', value: compact.toLowerCase() };
  return { kind: null, value: '' };
}

export const digitsOf = (v) => String(v || '').replace(/\D/g, '');
// Indian mobile numbers: last 10 digits identify the person whatever prefix was typed.
export const last10 = (v) => digitsOf(v).slice(-10);
export const maskMobile = (v) => { const d = digitsOf(v); return d.length > 4 ? 'X'.repeat(d.length - 4) + d.slice(-4) : d; };

export function cleanText(v, max = 120) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const istNowMs = () => Date.now() + 5.5 * 3600000;
export const istNowIso = () => new Date(istNowMs()).toISOString();
const istDigitsMs = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? t : null; };

const fmtDay = (iso) => {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const MESSAGES = {
  invalid: 'Invalid invitation pass.',
  wrong_location: 'This invitation belongs to another office location.',
  cancelled: 'This invitation has been cancelled.',
  rejected: 'This visit request was declined. Please speak to the reception.',
  pending_approval: 'Your invitation is awaiting approval.',
  checked_in: 'You have already checked in.',
  checked_out: 'This visit has already been completed.',
  expired: 'Your invitation has expired.',
  not_checked_in: 'You have not checked in yet.',
};

// Can this visitor record be checked in (intent 'checkin') or out (intent 'checkout') at a kiosk of `location`?
// Mirrors verifyVisitorQR / visitorCheckIn / visitorCheckOut, adding the invitation-validity window the kiosk spec asks for:
// an approved pass is usable from the start of its visit day until its expected departure (or the end of that day).
export function validateVisit(v, kioskLocation, intent = 'checkin', nowMs = istNowMs()) {
  const fail = (code, message) => ({ ok: false, code, message: message || MESSAGES[code] || MESSAGES.invalid });
  if (!v) return fail('invalid');
  if (v.location_name !== kioskLocation) return fail('wrong_location');
  if (intent === 'checkout') {
    if (v.status === 'checked_in') return { ok: true, code: 'valid' };
    if (v.status === 'checked_out') return fail('checked_out');
    if (v.status === 'cancelled') return fail('cancelled');
    if (v.status === 'rejected') return fail('rejected');
    return fail('not_checked_in');
  }
  switch (v.status) {
    case 'cancelled': return fail('cancelled');
    case 'rejected': return fail('rejected');
    case 'pending_approval': return fail('pending_approval');
    case 'checked_in': return fail('checked_in');
    case 'checked_out': return fail('checked_out');
    case 'approved': break;
    default: return fail('invalid');
  }
  const day = String(v.expected_arrival || '').slice(0, 10);
  if (day) {
    const start = istDigitsMs(`${day}T00:00:00Z`);
    const end = v.expected_departure ? istDigitsMs(v.expected_departure) : start + 86400000;
    if (start != null && nowMs < start) return fail('not_yet', `This invitation is for ${fmtDay(day)}. Please come back on that day.`);
    if (end != null && nowMs > end) return fail('expired');
  }
  return { ok: true, code: 'valid' };
}

// What a kiosk may show about a visit — never the full record.
export function publicVisit(v) {
  return {
    id: v.id, visitor_name: v.visitor_name, company: v.company || '', host_name: v.host_name || '', purpose: v.purpose || '',
    mobile_masked: maskMobile(v.mobile_number), expected_arrival: v.expected_arrival || null, status: v.status,
    location_name: v.location_name, has_photo: !!v.photo_url, visitor_count: v.visitor_count || 1, companion_names: v.companion_names || [], vehicle_number: v.vehicle_number || '',
  };
}

// Only images this app itself stored are accepted as a visitor photo (no arbitrary URLs from a public screen).
export function safePhotoUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:\/\/[^/]+)?\/api\/upload\/file\/[0-9a-f-]{36}(\.[a-z0-9]{2,5})?$/i.test(s) ? s : '';
}

// A single entry can cover several people: visitor_count includes the named visitor; companion_names are the others.
export function groupFields(count, names, { requireNames = false } = {}) {
  const n = Math.floor(Number(count));
  const visitor_count = Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 1;
  const list = (Array.isArray(names) ? names : []).map(x => cleanText(x, 80)).filter(Boolean).slice(0, visitor_count - 1);
  if (requireNames && list.length < visitor_count - 1) return { error: `Please enter the name of each of the ${visitor_count - 1} other visitor${visitor_count > 2 ? 's' : ''}.` };
  return { visitor_count, companion_names: list };
}

export const ID_TYPES = ['Aadhaar', 'Driving Licence', 'Voter ID', 'Passport', 'PAN', 'Company ID', 'Other'];
// Only the type and the last four characters are kept — the full number never leaves the kiosk.
export function idReference(type, number) {
  const t = ID_TYPES.includes(type) ? type : '';
  const n = cleanText(number, 40).replace(/\s/g, '');
  if (!t && !n) return '';
  return n.length >= 4 ? `${t || 'ID'} ending ${n.slice(-4)}` : (t || 'ID');
}

export function durationToDeparture(minutes, nowMs = istNowMs()) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0 || m > 12 * 60) return null;
  return new Date(nowMs + m * 60000).toISOString();
}

// Small in-memory limiter: allow `max` hits per `windowMs` per key.
export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    hit(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now); hits.set(key, arr);
      if (hits.size > 5000) for (const [k, a] of hits) if (!a.some(t => now - t < windowMs)) hits.delete(k);
      return true;
    },
    reset(key) { hits.delete(key); },
    count(key) { const now = Date.now(); return (hits.get(key) || []).filter(t => now - t < windowMs).length; },
  };
}

const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePassword(len = 14, rnd = (n) => Math.floor(Math.random() * n)) {
  let s = '';
  for (let i = 0; i < len; i++) s += PW_ALPHABET[rnd(PW_ALPHABET.length)];
  return s;
}

// Location-wise register: one row per location.
export function summariseByLocation(visitors) {
  const rows = new Map();
  const row = (loc) => {
    if (!rows.has(loc)) rows.set(loc, { location: loc, invited: 0, walk_in: 0, total: 0, pending: 0, approved: 0, rejected: 0, inside: 0, checked_out: 0, cancelled: 0, via_kiosk: 0 });
    return rows.get(loc);
  };
  for (const v of visitors) {
    const r = row(v.location_name || 'Unassigned');
    r.total++;
    if (v.source === 'walk_in') r.walk_in++; else r.invited++;
    if (v.status === 'pending_approval') r.pending++;
    if (['approved', 'checked_in', 'checked_out'].includes(v.status)) r.approved++;
    if (v.status === 'rejected') r.rejected++;
    if (v.status === 'checked_in') r.inside++;
    if (v.status === 'checked_out') r.checked_out++;
    if (v.status === 'cancelled') r.cancelled++;
    if (v.source_kiosk_id || v.checked_in_via_kiosk_id || v.checked_out_via_kiosk_id) r.via_kiosk++;
  }
  return [...rows.values()].sort((a, b) => a.location.localeCompare(b.location));
}
