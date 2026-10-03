// Shared helpers for the digital business card (public page, admin page,
// QR modal and print sheet) so links and contact files are built one way.

export const cardUrl = (card) => `${window.location.origin}/PublicBusinessCard?slug=${encodeURIComponent(card.unique_slug)}`;

// vCard text values: escape backslash, comma, semicolon, newline.
const esc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const normUrl = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`);

// RFC-compliant vCard 3.0. `N` is mandatory in 3.0 (the previous version only
// wrote FN, which several importers reject or mangle), and the structured
// name is split into family / given parts.
export function buildVCard(card) {
  const name = String(card.name || '').trim();
  const parts = name.split(/\s+/);
  const family = parts.length > 1 ? parts[parts.length - 1] : '';
  const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
  const wa = String(card.whatsapp_number || '').replace(/[^0-9+]/g, '');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(family)};${esc(given)};;;`,
    `FN:${esc(name)}`,
    card.company ? `ORG:${esc(card.company)}` : '',
    card.job_title ? `TITLE:${esc(card.job_title)}` : '',
    card.phone_number ? `TEL;TYPE=WORK,VOICE:${esc(card.phone_number)}` : '',
    wa && wa !== String(card.phone_number || '').replace(/[^0-9+]/g, '') ? `TEL;TYPE=CELL:${esc(card.whatsapp_number)}` : '',
    card.email ? `EMAIL;TYPE=INTERNET,WORK:${esc(card.email)}` : '',
    card.website ? `URL:${normUrl(card.website)}` : '',
    card.linkedin_url ? `URL;TYPE=LinkedIn:${normUrl(card.linkedin_url)}` : '',
    card.address ? `ADR;TYPE=WORK:;;${esc(card.address)};;;;` : '',
    'NOTE:Simplifying work. Empowering people',
    'END:VCARD',
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}

export function downloadVCard(card) {
  const blob = new Blob([buildVCard(card)], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(card.name || 'contact').replace(/[^\w]+/g, '_')}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
export const webHref = normUrl;
export const digits = (v) => String(v || '').replace(/[^0-9]/g, '');
