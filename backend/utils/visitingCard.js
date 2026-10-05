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
import { PDFDocument, rgb } from 'pdf-lib';
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
export async function buildVisitingCardsPdf(cards, baseUrl) {
  const assets = await loadAssets();
  const tpl = await PDFDocument.load(assets.template);
  const tplFront = tpl.getPage(0), tplBack = tpl.getPage(1);
  const { width: W, height: H } = tplFront.getSize();

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const fSemi = await out.embedFont(assets.semibold, { subset: true });
  const [front, back] = await out.embedPages([tplFront, tplBack]);

  out.setTitle('Maxvolt Energy — Visiting Cards');
  out.setAuthor('Maxvolt Energy Industries Limited');
  out.setCreator('Maxvolt One');

  for (const card of cards) {
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
