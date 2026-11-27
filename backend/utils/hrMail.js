// Central HR email distribution. HR logins often use addresses with no inbox, so the Admin Panel maps each HR account to the
// real mailbox. Every outgoing mail then (1) goes to the real mailbox wherever an HR login address was addressed and
// (2) copies all active, mapped HR accounts. sendEmail() applies this — no module needs to know HR addresses.
//
// Mails that carry a secret are the exception: copying them would hand HR the key to someone else's account or decision.
//  • one-time codes / password reset (source "otp") and self-tests: no HR copy at all;
//  • mails with a private link (onboarding invite, offer acceptance, document upload, CV decision links…): HR receives a
//    SEPARATE copy with the private links removed.

export const CONFIG_KEY = 'HR_EMAIL_CONFIG';
export const NEVER_COPY = ['otp', 'test'];
// Mail types an administrator may switch the HR copy off for (all are copied unless switched off).
export const OPTIONAL_TYPES = [
  { key: 'payslip', label: 'Payslips' },
  { key: 'salary-revision', label: 'Salary revision letters' },
  { key: 'celebration', label: 'Birthday & work anniversary mails' },
];
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
export const validEmail = (e) => {
  const s = String(e || '').trim();
  return s.length <= 254 && EMAIL_RE.test(s) && !s.includes('..') && !s.split('@')[0].startsWith('.') && !s.split('@')[0].endsWith('.') && !s.toLowerCase().includes('.disabled-');
};

const EMPTY = () => ({ rewrite: new Map(), cc: [], excluded: [] });

// users: active HR accounts [{id,email}]; config: stored settings object.
export function buildDirectory(users, config = {}) {
  const dir = EMPTY();
  dir.excluded = Array.isArray(config.excluded_types) ? config.excluded_types : [];
  const seen = new Set();
  for (const u of users || []) {
    const actual = String(config.mappings?.[u.id]?.email || '').trim().toLowerCase();
    if (!validEmail(actual)) continue;
    const login = String(u.email || '').trim().toLowerCase();
    if (login && login !== actual) dir.rewrite.set(login, actual);
    if (config.cc_enabled !== false && !seen.has(actual)) { seen.add(actual); dir.cc.push(actual); }
  }
  return dir;
}

export const HR_USERS_SQL = "SELECT id, email, full_name, display_name FROM users WHERE disabled_at IS NULL AND COALESCE(NULLIF(custom_role,''), role) = 'hr' ORDER BY full_name";

let cache = null, cacheAt = 0, override = null;
export const clearHrMailCache = () => { cache = null; };
export const setHrDirectoryForTests = (d) => { override = d; };

// Never throws: if the configuration cannot be read, mail goes out as it was addressed.
export async function loadHrDirectory() {
  if (override) return override;
  if (process.env.EMAIL_SETTINGS_FROM_ENV) return EMPTY();
  if (cache && Date.now() - cacheAt < 30000) return cache;
  try {
    const { all, one } = await import('../db.js');
    const row = await one('SELECT value FROM settings WHERE key=$1', [CONFIG_KEY]);
    cache = buildDirectory(await all(HR_USERS_SQL), row?.value ? JSON.parse(row.value) : {});
    cacheAt = Date.now();
    return cache;
  } catch (e) {
    console.warn('[hr-mail] configuration not available:', e.message);
    return cache || EMPTY();
  }
}

// Where HR-only mail (support requests, account deletion …) should go: the configured mailboxes, else the given fallback.
export async function hrRecipients(fallback) {
  const { cc } = await loadHrDirectory();
  return cc.length ? cc : [fallback].filter(Boolean);
}

// A link is private when it carries a token or a long random segment — anyone holding it can act as the recipient.
const PRIVATE_URL = /(?:reset-password|onboarding-invite|offer-accept|candidate-documents|application-status|\/api\/hiring\/decide\/|[?&](?:token|t|key|code|sig|signature|x-amz-signature)=|\/[A-Fa-f0-9]{32,}(?:[/?#]|$)|\/[A-Za-z0-9_-]{40,}(?:[/?#]|$))/i;
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
const REMOVED = '[private link removed]';
export const hasPrivateLink = (...parts) => parts.some((p) => (String(p || '').match(URL_RE) || []).some((u) => PRIVATE_URL.test(u)));
const scrubUrls = (s) => String(s).replace(URL_RE, (u) => (PRIVATE_URL.test(u) ? REMOVED : u));
export function redactPrivateLinks(html) {
  if (!html) return html;
  const noAnchors = String(html).replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (all, _q, href, inner) => (PRIVATE_URL.test(href) ? `<span style="color:#64748b">${scrubUrls(inner.replace(/<[^>]+>/g, '')).trim() || 'Link'} ${REMOVED}</span>` : all));
  return scrubUrls(noAnchors);
}

const addrOf = (a) => { const m = String(a).match(/<([^>]+)>\s*$/); return (m ? m[1] : String(a)).trim().toLowerCase(); };

// message: { to:[], cc:[], replyTo, subject, html, text, meta } with cleaned address lists. Returns { primary, copy|null }.
export function planDistribution(message, dir) {
  const real = (a) => { const e = addrOf(a); const r = dir.rewrite.get(e); return r ? String(a).includes('<') ? String(a).replace(/<[^>]+>\s*$/, `<${r}>`) : r : a; };
  const seen = new Set();
  const uniq = (list) => list.map(real).filter((a) => { const e = addrOf(a); if (seen.has(e)) return false; seen.add(e); return true; });
  const primary = { ...message, to: uniq(message.to), cc: uniq(message.cc || []), replyTo: message.replyTo ? real(message.replyTo) : message.replyTo };
  const source = String(message.meta?.source || '');
  if (!dir.cc.length || NEVER_COPY.includes(source) || dir.excluded.includes(source)) return { primary, copy: null };
  const extra = dir.cc.filter((e) => !seen.has(e));
  if (!extra.length) return { primary, copy: null };
  if (!hasPrivateLink(message.html, message.text)) return { primary: { ...primary, cc: [...primary.cc, ...extra] }, copy: null };
  const sentTo = primary.to.map(addrOf).join(', ');
  const note = `HR copy of an email sent to ${sentTo}. Private links have been removed.`;
  const banner = `<div style="font-family:Arial,sans-serif;font-size:12px;color:#92400e;background:#fef3c7;padding:8px 12px;margin-bottom:8px">${note.replace(/</g, '&lt;')}</div>`;
  const body = redactPrivateLinks(message.html);
  const copy = {
    ...message, to: extra, cc: [], replyTo: primary.replyTo, scheduledAt: message.scheduledAt,
    subject: `[HR copy] ${message.subject}`,
    html: body ? (/<body[^>]*>/i.test(body) ? body.replace(/<body[^>]*>/i, (m) => m + banner) : banner + body) : undefined,
    text: message.text ? `${note}\n\n${scrubUrls(message.text)}` : undefined,
    meta: { ...(message.meta || {}), confirm: false },
  };
  return { primary, copy };
}
