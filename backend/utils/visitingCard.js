// Print-ready visiting cards (88 x 55 mm, two sides per card).
//
// The company's own artwork (assets/visiting-card-template.pdf — page 1 front,
// page 2 back) is embedded UNCHANGED as vector pages; only the personal
// details are drawn on top of the back's blank area: name, designation,
// phone, email (each with the same round icon style the template uses for
// address / website) and a QR code linking to the person's digital card.
// Output is a single PDF, front then back for every person, so it can be
// printed duplex or sent straight to a print shop.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, setCharacterSpacing } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '../assets');

const NAVY = rgb(0x0b / 255, 0x1e / 255, 0x2f / 255);
const AMBER = rgb(0xf5 / 255, 0xa0 / 255, 0x01 / 255);
const INK = rgb(0.102, 0.102, 0.094);
const GREY = rgb(0.32, 0.32, 0.34);
const WHITE = rgb(1, 1, 1);

// Geometry on the back page — measured from the approved sample card
// ("Gourav Dubey Visiting Card.pdf"). Page is 249.45 x 155.91 pt; the values
// below are distances from the TOP edge (converted with H - value when drawn).
// Everything is Montserrat SemiBold like the template's own address block:
// name 15 pt, designation 7 pt, phone / email 7.5 pt (all SemiBold).
const ICON_X = 237.3;          // round icon centre x
const ICON_R = 4.5;            // round icon radius (same as template's address / web icons)
const TEXT_RIGHT = 226.6;      // right edge of phone / email text
const NAME_RIGHT = 241.8;      // right edge of name + designation (= icon's right edge)
const TEXT_MAX_W = 150;
const NAME_TOP = { name: 24.37, role: 36.73 };      // baselines
const PHONE_BASE = 71.86, MAIL_BASE = 88.64;        // baselines
const PHONE_ICON_CY = 69.1, MAIL_ICON_CY = 86.65;   // icon centres
const QR_X = 19.3, QR_TOP = 29.2, QR_SIZE = 33.6;   // QR modules area

const PATH_PHONE = 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
const PATH_MAIL = 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z';

let _cache;
async function loadAssets() {
  if (_cache) return _cache;
  _cache = {
    template: readFileSync(join(ASSETS, 'visiting-card-template.pdf')),
    semibold: readFileSync(join(ASSETS, 'fonts/Montserrat-SemiBold.woff')),
  };
  return _cache;
}
// Maxvolt ReEarth artwork + fonts, loaded only when a ReEarth card is printed.
let _reCache;
function loadReearthAssets() {
  if (_reCache) return _reCache;
  _reCache = {
    template: readFileSync(join(ASSETS, 'reearth-visiting-card-template.pdf')),
    plexSemi: readFileSync(join(ASSETS, 'fonts/IBMPlexSans-SemiBold.woff')),
    plexMed: readFileSync(join(ASSETS, 'fonts/IBMPlexSans-Medium.woff')),
    plexBold: readFileSync(join(ASSETS, 'fonts/IBMPlexSans-Bold.woff')),
  };
  return _reCache;
}

// ── Maxvolt ReEarth card (88 x 55 mm) ─────────────────────────────────────────────────────────────
// Page 1 (front) is the ReEarth template unchanged. Page 2 (back) is the approved layout — green pill with the
// phone / e-mail / address / web icons, address and website, faint logo, green base bar — with the personal
// details left blank. Geometry and type were measured from the approved sample ("Dr. Tushar D. Maske.pdf");
// values are distances from the TOP edge (drawn as H - value). Everything is IBM Plex Sans (open font, SIL OFL):
// name SemiBold 15.4 pt, designation Medium 8.64 pt (+0.30 pt letter-spacing), phone / e-mail SemiBold 7.5 pt,
// all in the template's near-black ink. `x` values are text origins.
const RE_INK = rgb(0.10245, 0.10118, 0.09511);
export const RE = {
  nameX: 6.95, nameBase: 24.7, nameSize: 15.2,
  roleX: 7.87, roleBase: 34.97, roleSize: 8.64, roleTracking: 0.304,
  phoneX: 31.52, phoneBase: 74.0, mailX: 31.83, mailBase: 93.85, textSize: 7.5,
  maxLeftW: 233, maxRowW: 205,
};
const reWidth = (font, text, size, tracking = 0) => font.widthOfTextAtSize(text, size) + tracking * Math.max(0, text.length - 1);

// Draws one line of text with optional letter-spacing; shrinks tracking, then size, until it fits maxW.
function drawFitted(page, font, text, { x, y, size, color, tracking = 0, maxW, minSize = 5.2 }) {
  if (!text) return;
  let s = size, t = tracking;
  while (s > minSize && reWidth(font, text, s, t) > maxW) { s -= 0.1; t = tracking * (s / size); }
  if (t) page.pushOperators(setCharacterSpacing(t));
  page.drawText(text, { x, y, size: s, font, color });
  if (t) page.pushOperators(setCharacterSpacing(0));
}

// Shrinks the font until the text fits maxW (never below minSize).
function fitSize(font, text, size, maxW, minSize = 5.2) {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxW) s -= 0.2;
  return s;
}

function drawRightText(page, font, text, size, xRight, y, color, maxW = TEXT_MAX_W) {
  if (!text) return;
  const s = fitSize(font, text, size, maxW);
  page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, s), y, size: s, font, color });
}

function drawIconCircle(page, cy, fill, svgPath, glyph = 0.56) {
  page.drawCircle({ x: ICON_X, y: cy, size: ICON_R, color: fill });
  const scale = (ICON_R * 2 * glyph) / 24;  // glyph size relative to the circle
  page.drawSvgPath(svgPath, { x: ICON_X - 12 * scale, y: cy + 12 * scale, scale, color: WHITE, borderWidth: 0 });
}

function drawQr(page, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const n = qr.modules.size;
  const cell = size / n;
  page.drawRectangle({ x: x - 2.4, y: y - 2.4, width: size + 4.8, height: size + 4.8, color: WHITE });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run++;
      // +0.04pt overlap hides hairline seams some viewers show between rects.
      page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell - 0.02, width: run * cell + 0.04, height: cell + 0.04, color: rgb(0, 0, 0) });
      c += run;
    }
  }
}

/**
 * @param {Array<{name,job_title,phone_number,email,unique_slug}>} cards
 * @param {string} baseUrl  e.g. https://maxone.maxvoltenergy.com
 * @returns {Promise<Uint8Array>} PDF bytes (2 pages per card: front, back)
 */
export const cardBrand = (card) => (card?.brand === 'reearth' ? 'reearth' : 'energy');

export async function buildVisitingCardsPdf(cards, baseUrl) {
  const assets = await loadAssets();
  const tpl = await PDFDocument.load(assets.template);
  const tplFront = tpl.getPage(0), tplBack = tpl.getPage(1);
  const { width: W, height: H } = tplFront.getSize();

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const fSemi = await out.embedFont(assets.semibold, { subset: true });
  const [front, back] = await out.embedPages([tplFront, tplBack]);

  const brands = new Set(cards.map(cardBrand));
  const onlyRe = brands.size === 1 && brands.has('reearth');
  out.setTitle(onlyRe ? 'Maxvolt ReEarth — Visiting Cards' : brands.has('reearth') ? 'Maxvolt — Visiting Cards' : 'Maxvolt Energy — Visiting Cards');
  out.setAuthor(onlyRe ? 'Maxvolt ReEarth' : 'Maxvolt Energy Industries Limited');
  out.setCreator('Maxvolt One');

  // ReEarth artwork + fonts only when needed (same output document, so a mixed selection prints in one PDF)
  let re = null;
  if (brands.has('reearth')) {
    const ra = loadReearthAssets();
    const rtpl = await PDFDocument.load(ra.template);
    const [rFront, rBack] = await out.embedPages([rtpl.getPage(0), rtpl.getPage(1)]);
    re = { front: rFront, back: rBack, semi: await out.embedFont(ra.plexSemi, { subset: true }), med: await out.embedFont(ra.plexMed, { subset: true }), bold: await out.embedFont(ra.plexBold, { subset: true }) };
  }

  for (const card of cards) {
    if (cardBrand(card) === 'reearth') {
      out.addPage([W, H]).drawPage(re.front);
      const rp = out.addPage([W, H]);
      rp.drawPage(re.back);
      const name = String(card.name || '').trim(), role = String(card.job_title || '').trim();
      drawFitted(rp, re.bold, name, { x: RE.nameX, y: H - RE.nameBase, size: RE.nameSize, color: RE_INK, maxW: RE.maxLeftW });
      drawFitted(rp, re.med, role, { x: RE.roleX, y: H - RE.roleBase, size: RE.roleSize, color: RE_INK, tracking: RE.roleTracking, maxW: RE.maxLeftW });
      drawFitted(rp, re.semi, String(card.phone_number || '').trim(), { x: RE.phoneX, y: H - RE.phoneBase, size: RE.textSize, color: RE_INK, maxW: RE.maxRowW });
      drawFitted(rp, re.semi, String(card.email || '').trim(), { x: RE.mailX, y: H - RE.mailBase, size: RE.textSize, color: RE_INK, maxW: RE.maxRowW });
      continue;
    }

    const fp = out.addPage([W, H]);
    fp.drawPage(front);

    const bp = out.addPage([W, H]);
    bp.drawPage(back);

    // Name + designation (top right, right-aligned to the icon column)
    drawRightText(bp, fSemi, String(card.name || '').trim(), 15, NAME_RIGHT, H - NAME_TOP.name, INK, 175);
    drawRightText(bp, fSemi, String(card.job_title || '').trim(), 7, NAME_RIGHT, H - NAME_TOP.role, INK, 175);

    // Phone + email rows (icon + right-aligned text), same rhythm as the
    // template's address / website rows below them.
    if (card.phone_number) {
      drawIconCircle(bp, H - PHONE_ICON_CY, AMBER, PATH_PHONE, 0.68);
      drawRightText(bp, fSemi, String(card.phone_number).trim(), 7.5, TEXT_RIGHT, H - PHONE_BASE, INK);
    }
    if (card.email) {
      drawIconCircle(bp, H - MAIL_ICON_CY, INK, PATH_MAIL, 0.58);
      drawRightText(bp, fSemi, String(card.email).trim(), 7.5, TEXT_RIGHT, H - MAIL_BASE, INK);
    }

    // QR (top left): opens the person's digital card
    if (card.unique_slug) {
      const url = `${baseUrl.replace(/\/+$/, '')}/PublicBusinessCard?slug=${encodeURIComponent(card.unique_slug)}`;
      drawQr(bp, url, QR_X, H - QR_TOP - QR_SIZE, QR_SIZE);
    }
  }
  return out.save();
}
