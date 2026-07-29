// Application-level WAF-style hardening.
//
// This is NOT a substitute for an edge WAF (Cloudflare, AWS WAF, etc.) — those
// inspect traffic before it ever reaches this process and can absorb
// volumetric attacks. Railway serves this app directly with no such proxy in
// front of it today, so this middleware is the defense-in-depth layer that
// runs inside the app instead: rate limiting, security headers, blocking
// known scanner/exploit signatures, and rejecting obviously malicious
// requests before they reach any route handler.
//
// Deliberately does NOT deep-scan request BODIES for "SQLi-looking" text —
// this app already parameterizes every SQL query (no string-built SQL
// anywhere), so body-based SQLi is not the exposure a body scanner would be
// defending against, and free-text fields are everywhere here (resume text,
// rejection reasons, ticket subjects, AI-generated content) where a naive
// keyword scanner would false-positive on legitimate business text (e.g. a
// resume that says "wrote complex SQL SELECT/UNION queries"). Query strings
// and URL paths, by contrast, are simple filters/IDs in this app, so they're
// scanned — genuine attack traffic there has no legitimate-content risk.
import rateLimit from 'express-rate-limit';

// ── Rate limiting ─────────────────────────────────────────────
// Railway's edge proxies every request; without trust proxy set correctly
// (see server.js), X-Forwarded-For would be ignored and every client would
// be rate-limited together as "one IP". server.js sets `trust proxy` before
// these are applied.

// Generous global ceiling — this is abuse/DoS protection, not a normal-usage
// throttle. Deliberately high: this is an internal company app where many
// employees on the same office Wi-Fi can share one public IP behind NAT, and
// several pages poll every 30s (attendance, notifications) — a low per-IP
// limit would throttle a whole office of legitimate concurrent users, not
// just an attacker.
export const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down and try again shortly.' },
});

// Tighter limit on auth endpoints specifically — the highest-value target
// for credential stuffing / brute force / OTP-guessing bots. Skips /me and
// /logout: those are routine session checks the frontend calls on every
// page load / navigation (AuthContext, Dashboard routing), not credential
// attempts — counting them here would lock out real active users, not bots.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/me' || req.path === '/logout',
  message: { error: 'Too many auth attempts from this address — please wait 15 minutes and try again.' },
});

// ── Known scanner / exploit-tool user agents ─────────────────
const BLOCKED_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /nessus/i, /acunetix/i,
  /dirbuster/i, /gobuster/i, /wpscan/i, /zgrab/i, /shodan/i, /censys/i,
  /python-requests\/.*bot/i, /havij/i, /zaproxy/i, /openvas/i,
];

// ── Malicious query-string / URL-path signatures ─────────────
// Path traversal, null-byte injection, classic SQLi/XSS/command-injection
// tokens, and common CVE probe paths — these have no legitimate use in this
// app's URLs (query params here are simple filters/dates/IDs, never HTML or
// SQL fragments), so matching them is a strong, low-false-positive signal.
const MALICIOUS_PATTERNS = [
  /\.\.[/\\]/,                                   // path traversal
  /%2e%2e[/\\]?/i,                               // encoded path traversal
  /\x00/,                                        // null byte
  /<script[\s>]/i, /javascript:/i, /onerror\s*=/i, /onload\s*=/i, // XSS
  /union\s+select/i, /select\s+.*\s+from\s+information_schema/i,  // SQLi
  /;\s*drop\s+table/i, /;\s*delete\s+from/i, /'\s*or\s+'?1'?\s*=\s*'?1/i,
  /\$where\s*:/i, /\{\{.*\}\}/,                  // NoSQL / template injection
  /(^|\/)\.env($|\/)/i, /(^|\/)\.git($|\/)/i, /wp-admin/i, /wp-login/i, /phpmyadmin/i, // common probe paths
  /;\s*(cat|wget|curl|nc|bash|sh)\s+/i,           // command injection
];

function looksMalicious(str) {
  if (!str) return false;
  return MALICIOUS_PATTERNS.some(re => re.test(str));
}

export function wafGuard(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  if (BLOCKED_UA_PATTERNS.some(re => re.test(ua))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Absurdly long URLs are a common scanner/fuzzer fingerprint, not
  // something any real client of this app produces.
  if (req.originalUrl.length > 2048) {
    return res.status(414).json({ error: 'URI too long' });
  }

  if (looksMalicious(req.originalUrl)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  next();
}
