// Employee ID cards (55 x 88 mm, portrait, one page per card).
//
// The company's blank card artwork (assets/id-card-template.pdf) is embedded UNCHANGED as a vector
// page; only the personal details are drawn on top: name (up to two lines) + designation under the
// logo, the photo on the right, and Employee ID / D.O.J. / Department / Emergency No. next to the
// template's own labels. Geometry was measured from the approved sample ("1 Id Card MaxVolt
// 25-08-2026.pdf"); every value below is a distance from the TOP edge in points.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '../assets');

const NAVY = rgb(0.17, 0.15, 0.45);
const INK = rgb(0.1, 0.1, 0.1);
const AMBER = rgb(0xf5 / 255, 0x9a / 255, 0x0b / 255);
const GREY = rgb(0.33, 0.33, 0.35);
const WHITE = rgb(1, 1, 1);

const NAME_X = 4.9, NAME_MAX_W = 74;
const NAME_BASE = [57, 67.6];         // baselines of the first / second name line
const ROLE_BASE_ONE_LINE = 67.6;      // designation baseline when the name fits on one line
const ROLE_BASE_TWO_LINES = 77.2;     // ...and when it wraps to two
const VALUE_X = 62.8, VALUE_MAX_W = 87;
const DETAIL_BASE = [143.7, 152.8, 161.8, 170.8];   // Employee ID, D.O.J., Department, Emergency No.

// Photo: a normal (opaque) photo is cover-cropped into the box above the details block; a PNG with a
// transparent background (cut-out person, like the sample) uses the tall box so the shoulders reach
// down behind the details, exactly like the approved card.
const PHOTO_X = 84, PHOTO_W = 71.9;
const PHOTO_BOX = { top: 38.4, bottom: 134 };
const PHOTO_BOX_CUTOUT = { top: 38.4, bottom: 171 };
const LOGO_CLIP_H = 46;              // top strip of the template that holds the logo + tagline

let _cache;
function loadAssets() {
  if (_cache) return _cache;
  _cache = {
    template: readFileSync(join(ASSETS, 'id-card-template.pdf')),
    semibold: readFileSync(join(ASSETS, 'fonts/Montserrat-SemiBold.woff')),
  };
  return _cache;
}

function fitSize(font, text, size, maxW, minSize = 4.6) {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxW) s -= 0.1;
  return s;
}

// Splits a name over at most two lines so each fits NAME_MAX_W at the given size.
function wrapName(font, name, size) {
  if (font.widthOfTextAtSize(name, size) <= NAME_MAX_W) return [name];
  const words = name.split(/\s+/);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(font.widthOfTextAtSize(a, size), font.widthOfTextAtSize(b, size));
    if (!best || w < best.w) best = { w, lines: [a, b] };
  }
  return best ? best.lines : [name];
}

// Decodes a data URL / base64 string and prepares it for the card. Returns { bytes, type, cutout }.
export async function preparePhoto(photoBase64) {
  if (!photoBase64) return null;
  const raw = String(photoBase64).replace(/^data:[^;]+;base64,/, '');
  const input = Buffer.from(raw, 'base64');
  if (!input.length) return null;
  const meta = await sharp(input).metadata();
  const cutout = !!meta.hasAlpha;
  const box = cutout ? PHOTO_BOX_CUTOUT : PHOTO_BOX;
  const boxW = PHOTO_W, boxH = box.bottom - box.top;
  const SCALE = 8; // px per pt — ample for 300 dpi print
  let img = sharp(input).rotate(); // honour EXIF orientation from phones
  if (cutout) {
    img = img.resize(Math.round(boxW * SCALE), Math.round(boxH * SCALE), { fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();
  } else {
    img = img.resize(Math.round(boxW * SCALE), Math.round(boxH * SCALE), { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 90 });
  }
  return { bytes: await img.toBuffer(), type: cutout ? 'png' : 'jpg', cutout, box };
}

// Serialisable form of a prepared photo (what is stored with a saved ID card) and back.
export async function prepareCard(card) {
  if (card.photo_prepared) return card;
  const ph = await preparePhoto(card.photo_base64);
  const { photo_base64, ...rest } = card;
  return { ...rest, photo_prepared: ph ? { b64: ph.bytes.toString('base64'), type: ph.type, cutout: ph.cutout } : null };
}
const fromPrepared = (pp) => (pp ? { bytes: Buffer.from(pp.b64, 'base64'), type: pp.type, box: pp.cutout ? PHOTO_BOX_CUTOUT : PHOTO_BOX } : null);

function drawQr(page, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, cell = size / n;
  page.drawRectangle({ x: x - 3, y: y - 3, width: size + 6, height: size + 6, color: WHITE });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run++;
      page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell - 0.02, width: run * cell + 0.04, height: cell + 0.04, color: rgb(0, 0, 0) });
      c += run;
    }
  }
}

function wrapText(font, text, size, maxW) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW || !line) line = t; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

const centerText = (page, font, text, size, y, color, W) => page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });

// Standard back: logo (clipped from the template itself), ownership notice, return address, emergency number,
// QR, signature line and an orange footer band.
function drawBack(page, { W, H, font, logo, emergency_no, qr_url }) {
  page.drawPage(logo, { x: 3, y: H - LOGO_CLIP_H + 2 });
  page.drawRectangle({ x: 14, y: H - 52, width: W - 28, height: 1.4, color: AMBER });

  centerText(page, font, 'EMPLOYEE ID CARD', 7.2, H - 66, NAVY, W);
  const para = wrapText(font, 'This card is the property of Maxvolt Energy Industries Limited. It must be worn visibly on company premises, is not transferable, and must be surrendered on leaving the company.', 5.4, W - 32);
  let y = H - 80;
  for (const l of para) { page.drawText(l, { x: 16, y, size: 5.4, font, color: GREY }); y -= 7.6; }

  y -= 5;
  page.drawText('If found, please return to:', { x: 16, y, size: 5.8, font, color: INK }); y -= 8.4;
  for (const l of ['Maxvolt Energy Industries Limited', 'Head Office: E-82, Bulandshahr Road', 'Industrial Area, Ghaziabad 201009']) {
    page.drawText(l, { x: 16, y, size: 5.6, font, color: GREY }); y -= 7.4;
  }
  y -= 3;
  page.drawText('Emergency No. :', { x: 16, y, size: 6.4, font, color: INK });
  page.drawText(String(emergency_no || ''), { x: 16 + font.widthOfTextAtSize('Emergency No. :', 6.4) + 4, y, size: 6.8, font, color: AMBER });

  const QR = 38;
  drawQr(page, qr_url, 17, H - 164 - QR, QR);
  page.drawText('Scan to connect', { x: 16, y: H - 211, size: 5, font, color: GREY });

  page.drawLine({ start: { x: 82, y: H - 195 }, end: { x: W - 14, y: H - 195 }, thickness: 0.5, color: GREY });
  page.drawText('Authorised Signatory', { x: 82 + (W - 14 - 82 - font.widthOfTextAtSize('Authorised Signatory', 5)) / 2, y: H - 202, size: 5, font, color: GREY });

  page.drawSvgPath('M0 0 L' + W + ' 14 L' + W + ' 34 L0 34 Z', { x: 0, y: 34, scale: 1, color: AMBER, borderWidth: 0 });
  centerText(page, font, 'www.maxvoltenergy.com', 6, 6.5, WHITE, W);
}

/**
 * @param {Array<{name,designation,employee_id,doj,department,photo_base64}>} cards
 * @param {{emergency_no: string}} opts  same emergency number on every card
 * @returns {Promise<Uint8Array>} PDF bytes (1 page per card)
 */
export async function buildIdCardsPdf(cards, { emergency_no = '', sides = 'front' } = {}) {
  const assets = loadAssets();
  const tpl = await PDFDocument.load(assets.template);
  const tplPage = tpl.getPage(0);
  const { width: W, height: H } = tplPage.getSize();

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const font = await out.embedFont(assets.semibold, { subset: true });
  const [front] = await out.embedPages([tplPage]);
  const logo = await out.embedPage(tplPage, { left: 3, bottom: H - LOGO_CLIP_H + 2, right: W - 3, top: H - 2 });
  out.setTitle('Maxvolt Energy - ID Cards');
  out.setAuthor('Maxvolt Energy Industries Limited');
  out.setCreator('Maxvolt One');

  for (const rawCard of cards) {
    const card = rawCard.photo_prepared || !rawCard.photo_base64 ? rawCard : await prepareCard(rawCard);
    if (sides === 'back' || sides === 'both') {
      // (for 'both' the back is added after the front below)
    }
    const page = out.addPage([W, H]);
    if (sides === 'back') { drawBack(page, { W, H, font, logo, emergency_no, qr_url: card.qr_url || 'https://www.maxvoltenergy.com' }); continue; }
    page.drawPage(front);

    // Photo first, so the text is always drawn on top of it.
    const photo = fromPrepared(card.photo_prepared);
    if (photo) {
      const img = photo.type === 'png' ? await out.embedPng(photo.bytes) : await out.embedJpg(photo.bytes);
      page.drawImage(img, { x: PHOTO_X, y: H - photo.box.bottom, width: PHOTO_W, height: photo.box.bottom - photo.box.top });
    }

    // Name (navy, italic look via skew) — one or two lines — then designation.
    const name = String(card.name || '').trim();
    if (name) {
      const size = fitSize(font, name, 10, NAME_MAX_W * 2 - 6, 6);
      const lines = wrapName(font, name, size);
      lines.slice(0, 2).forEach((line, i) => {
        const s = fitSize(font, line, size, NAME_MAX_W);
        page.drawText(line, { x: NAME_X, y: H - NAME_BASE[i], size: s, font, color: NAVY, ySkew: degrees(11) });
      });
      const role = String(card.designation || '').trim();
      if (role) {
        const base = lines.length > 1 ? ROLE_BASE_TWO_LINES : ROLE_BASE_ONE_LINE;
        const s = fitSize(font, role, 7.2, NAME_MAX_W);
        page.drawText(role, { x: NAME_X, y: H - base, size: s, font, color: NAVY, ySkew: degrees(11) });
      }
    }

    // Detail values, aligned with the template's own labels.
    const details = [card.employee_id, card.doj, card.department, emergency_no];
    details.forEach((v, i) => {
      const text = String(v || '').trim();
      if (!text) return;
      const s = fitSize(font, text, 6.9, VALUE_MAX_W);
      page.drawText(text, { x: VALUE_X, y: H - DETAIL_BASE[i], size: s, font, color: INK });
    });

    if (sides === 'both') {
      const bp = out.addPage([W, H]);
      drawBack(bp, { W, H, font, logo, emergency_no, qr_url: card.qr_url || 'https://www.maxvoltenergy.com' });
    }
  }
  return out.save();
}
