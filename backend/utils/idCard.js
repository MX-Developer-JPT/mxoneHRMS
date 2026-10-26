// Employee ID cards, one page per card: Maxvolt Energy (55 x 88 mm) and Maxvolt ReEarth (54 x 85 mm).
//
// The company's blank card artwork (assets/id-card-template.pdf) is embedded UNCHANGED as a vector
// page; only the personal details are drawn on top: name (up to two lines) + designation under the
// logo, the photo on the right, and Employee ID / D.O.J. / Department / Emergency No. next to the
// template's own labels. Geometry was measured from the approved sample ("1 Id Card MaxVolt
// 25-08-2026.pdf"); every value below is a distance from the TOP edge in points.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath } from 'pdf-lib';
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
// A rectangular photo must not run over the orange shape: its lower-left corner is cut along the shape's
// slanted top edge (measured from the template: (84,111.2) -> (131,155.8), 0.6 pt clear of it).
const PHOTO_CLIP = [[84, 110.6], [84, 38.4], [PHOTO_X + PHOTO_W, 38.4], [PHOTO_X + PHOTO_W, 134], [108.1, 134]];
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
let _reCache;
function loadReearthAssets() {
  if (_reCache) return _reCache;
  _reCache = {
    template: readFileSync(join(ASSETS, 'reearth-id-card-template.pdf')),
    bold: readFileSync(join(ASSETS, 'fonts/Montserrat-Bold.woff')),
    semibold: loadAssets().semibold,
  };
  return _reCache;
}

// Which company's card this is: the explicit choice wins; otherwise ReEarth employee codes (MVR…) get the ReEarth card.
export function cardCompany(card) {
  const c = String(card?.company || '').toLowerCase();
  if (c === 'reearth' || c === 'energy') return c;
  return /^MVR/i.test(String(card?.employee_id || card?.code || '').trim()) ? 'reearth' : 'energy';
}

// ── Maxvolt ReEarth card geometry (measured from the approved sample; distances are from the TOP edge, in pt) ──
const RE = {
  FRAME: { x0: 40.56, y0: 56.97, x1: 111.43, y1: 127.84, r: 10.7 },      // grey photo frame
  PHOTO: { x0: 40.39, y0: 56.96, x1: 111.59, y1: 127.92 },               // the sample's photo covers the frame by a hair
  NAME_BASE: 141.63, ROLE_BASE: 150.08, LINE_GAP: 8.4, TEXT_MAX_W: 126,
  LABEL_X: 28.54,
  ROWS: [['Employee Id', 81.36, 86.35, 167.08], ['D.O.J', 80.81, 85.8, 176.49], ['Department', 81.01, 86.0, 185.91], ['Emergency No.', 81.85, 85.13, 195.32]],   // label, colon x, value x, baseline
  VALUE_MAX_W: 62,
  INK: rgb(26 / 255, 26 / 255, 24 / 255), GREEN: rgb(0.49, 0.6, 0.16), LEAF: rgb(0.58, 0.71, 0.18),
};

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
export async function preparePhoto(photoBase64, shape = 'portrait') {
  if (!photoBase64) return null;
  const raw = String(photoBase64).replace(/^data:[^;]+;base64,/, '');
  const input = Buffer.from(raw, 'base64');
  if (!input.length) return null;
  const meta = await sharp(input).metadata();
  const cutout = !!meta.hasAlpha;
  const square = shape === 'square';   // ReEarth: a rounded square frame
  const box = square ? { top: RE.PHOTO.y0, bottom: RE.PHOTO.y1 } : cutout ? PHOTO_BOX_CUTOUT : PHOTO_BOX;
  const boxW = square ? RE.PHOTO.x1 - RE.PHOTO.x0 : PHOTO_W, boxH = box.bottom - box.top;
  const SCALE = 8; // px per pt — ample for 300 dpi print
  let img = sharp(input).rotate(); // honour EXIF orientation from phones
  if (cutout) {
    img = img.resize(Math.round(boxW * SCALE), Math.round(boxH * SCALE), { fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();
  } else {
    img = img.resize(Math.round(boxW * SCALE), Math.round(boxH * SCALE), { fit: 'cover', position: square ? 'north' : sharp.strategy.attention }).jpeg({ quality: 90 });
  }
  return { bytes: await img.toBuffer(), type: cutout ? 'png' : 'jpg', cutout, box, shape: square ? 'square' : 'portrait' };
}

// Serialisable form of a prepared photo (what is stored with a saved ID card) and back.
export async function prepareCard(card) {
  if (card.photo_prepared) return card;
  const ph = await preparePhoto(card.photo_base64, cardCompany(card) === 'reearth' ? 'square' : 'portrait');
  const { photo_base64, ...rest } = card;
  return { ...rest, photo_prepared: ph ? { b64: ph.bytes.toString('base64'), type: ph.type, cutout: ph.cutout, shape: ph.shape } : null };
}
// A photo prepared for one company's frame, re-cut for the other (cards can change company).
async function recutPhoto(pp, want) {
  if (!pp || (pp.shape || 'portrait') === want) return pp;
  const SCALE = 8;
  const box = want === 'square' ? { top: RE.PHOTO.y0, bottom: RE.PHOTO.y1 } : pp.cutout ? PHOTO_BOX_CUTOUT : PHOTO_BOX;
  const w = want === 'square' ? RE.PHOTO.x1 - RE.PHOTO.x0 : PHOTO_W, h = box.bottom - box.top;
  const input = Buffer.from(pp.b64, 'base64');
  const img = pp.cutout
    ? sharp(input).resize(Math.round(w * SCALE), Math.round(h * SCALE), { fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png()
    : sharp(input).resize(Math.round(w * SCALE), Math.round(h * SCALE), { fit: 'cover', position: want === 'square' ? 'north' : 'centre' }).jpeg({ quality: 90 });
  return { b64: (await img.toBuffer()).toString('base64'), type: pp.cutout ? 'png' : 'jpg', cutout: pp.cutout, shape: want };
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

// Rounded-rectangle clip (so the photo takes the shape of the template's frame). y values are PDF coordinates.
function clipRoundedRect(page, x0, yBottom, x1, yTop, r) {
  const k = 0.5523 * r;
  page.pushOperators(
    pushGraphicsState(), moveTo(x0 + r, yBottom), lineTo(x1 - r, yBottom), appendBezierCurve(x1 - r + k, yBottom, x1, yBottom + r - k, x1, yBottom + r),
    lineTo(x1, yTop - r), appendBezierCurve(x1, yTop - r + k, x1 - r + k, yTop, x1 - r, yTop), lineTo(x0 + r, yTop),
    appendBezierCurve(x0 + r - k, yTop, x0, yTop - r + k, x0, yTop - r), lineTo(x0, yBottom + r), appendBezierCurve(x0, yBottom + r - k, x0 + r - k, yBottom, x0 + r, yBottom),
    closePath(), clip(), endPath());
}

const fitOrCut = (font, text, size, maxW, minSize) => {
  let t = text, sz = fitSize(font, t, size, maxW, minSize);
  while (font.widthOfTextAtSize(t, sz) > maxW && t.length > 3) { t = t.slice(0, -2); sz = minSize; }
  return { t: t === text ? t : t.trimEnd() + '…', sz };
};

// Front of a ReEarth card: the embedded template + photo in the rounded frame + centred name / designation + the four detail rows.
async function drawReearthFront(out, page, { front, bold, semibold, H }, card, emergency_no) {
  const F = RE.FRAME;
  const pp = await recutPhoto(card.photo_prepared, 'square');
  const ph = pp ? { bytes: Buffer.from(pp.b64, 'base64'), type: pp.type } : null;
  page.drawPage(front);
  if (ph) {
    const img = ph.type === 'png' ? await out.embedPng(ph.bytes) : await out.embedJpg(ph.bytes);
    clipRoundedRect(page, F.x0 - 0.17, H - (F.y1 + 0.08), F.x1 + 0.17, H - (F.y0 - 0.01), F.r);
    page.drawImage(img, { x: RE.PHOTO.x0, y: H - RE.PHOTO.y1, width: RE.PHOTO.x1 - RE.PHOTO.x0, height: RE.PHOTO.y1 - RE.PHOTO.y0 });
    page.pushOperators(popGraphicsState());
  } else {                                           // no photo yet: initials in the empty frame
    const ini = String(card.name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    if (ini) page.drawText(ini, { x: (F.x0 + F.x1) / 2 - bold.widthOfTextAtSize(ini, 26) / 2, y: H - (F.y0 + F.y1) / 2 - 9, size: 26, font: bold, color: rgb(1, 1, 1) });
  }

  const W = page.getWidth();
  const center = (text, font, size, baseTop) => page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y: H - baseTop, size, font, color: RE.INK });
  const name = String(card.name || '').trim();
  let roleBase = RE.ROLE_BASE;
  if (name) {
    const full = `Name - ${name}`;
    let size = fitSize(bold, full, 7, RE.TEXT_MAX_W, 6);
    if (bold.widthOfTextAtSize(full, size) <= RE.TEXT_MAX_W) center(full, bold, size, RE.NAME_BASE);
    else {                                          // long name: two centred lines
      const words = full.split(/\s+/); let best = null;
      for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '); const w = Math.max(bold.widthOfTextAtSize(a, 7), bold.widthOfTextAtSize(b, 7)); if (!best || w < best.w) best = { w, lines: [a, b] }; }
      const lines = best?.lines || [full];
      size = Math.min(7, ...lines.map(l => fitSize(bold, l, 7, RE.TEXT_MAX_W, 5)));
      lines.slice(0, 2).forEach((l, n) => center(l, bold, size, RE.NAME_BASE + n * RE.LINE_GAP));
      roleBase = RE.ROLE_BASE + (lines.length > 1 ? RE.LINE_GAP : 0) - (lines.length > 1 ? 1.2 : 0);
    }
    const role = String(card.designation || '').trim();
    if (role) { const { t, sz } = fitOrCut(semibold, `(${role})`, 7, RE.TEXT_MAX_W, 4.8); center(t, semibold, sz, roleBase); }
  }
  const values = [card.employee_id, card.doj, card.department, emergency_no];
  RE.ROWS.forEach(([label, colonX, valueX, base], n) => {
    page.drawText(label, { x: RE.LABEL_X, y: H - base, size: 6.03, font: bold, color: RE.INK });
    page.drawText(':', { x: colonX, y: H - base, size: 6.03, font: bold, color: RE.INK });
    const v = String(values[n] || '').trim();
    if (v) { const { t, sz } = fitOrCut(bold, v, 6.03, RE.VALUE_MAX_W, 4.2); page.drawText(t, { x: valueX, y: H - base, size: sz, font: bold, color: RE.INK }); }
  });
}

// Back of a ReEarth card (no approved artwork yet): same content as the Energy back in ReEarth colours.
function drawReearthBack(page, { W, H, font, logo, emergency_no, qr_url }) {
  const G = RE.GREEN, INKC = RE.INK;
  page.drawPage(logo, { x: 3, y: H - LOGO_CLIP_H + 2 });
  page.drawRectangle({ x: 14, y: H - 50, width: W - 28, height: 1.4, color: G });
  centerText(page, font, 'EMPLOYEE ID CARD', 7.2, H - 62, G, W);
  const para = wrapText(font, 'This card is the property of Maxvolt ReEarth. It must be worn visibly on company premises, is not transferable, and must be surrendered on leaving the company.', 5.3, W - 32);
  let y = H - 74;
  for (const l of para) { page.drawText(l, { x: 16, y, size: 5.3, font, color: GREY }); y -= 7; }
  y -= 4;
  page.drawText('If found, please return to Maxvolt ReEarth:', { x: 16, y, size: 5.6, font, color: INKC }); y -= 8;
  for (const l of ['Registered office: E-82, Bulandshahr Road', 'Industrial Area, Vijay Nagar (Ghaziabad)', 'Ghaziabad - 201009, Uttar Pradesh']) { page.drawText(l, { x: 16, y, size: 5.3, font, color: GREY }); y -= 7; }
  y -= 4;
  page.drawText('Emergency No. :', { x: 16, y, size: 6.4, font, color: INKC });
  page.drawText(String(emergency_no || ''), { x: 16 + font.widthOfTextAtSize('Emergency No. :', 6.4) + 4, y, size: 6.8, font, color: G });
  const QR = 32, qrTop = y - 8;                       // keep everything above the footer band
  drawQr(page, qr_url, 17, qrTop - QR, QR);
  page.drawText('Scan to connect', { x: 16, y: qrTop - QR - 8, size: 5, font, color: GREY });
  const sigY = qrTop - QR + 6;
  page.drawLine({ start: { x: 82, y: sigY }, end: { x: W - 14, y: sigY }, thickness: 0.5, color: GREY });
  page.drawText('Authorised Signatory', { x: 82 + (W - 14 - 82 - font.widthOfTextAtSize('Authorised Signatory', 5)) / 2, y: sigY - 7, size: 5, font, color: GREY });
  page.drawSvgPath('M0 0 L' + W + ' 14 L' + W + ' 34 L0 34 Z', { x: 0, y: 34, scale: 1, color: G, borderWidth: 0 });
  centerText(page, font, 'www.maxvoltenergy.com', 6, 6.5, WHITE, W);
}

/**
 * @param {Array<{name,designation,employee_id,doj,department,photo_base64,company?}>} cards  company: 'energy' | 'reearth' (default: ReEarth for MVR… codes)
 * @param {{emergency_no: string}} opts  same emergency number on every card
 * @returns {Promise<Uint8Array>} PDF bytes (1 page per card side; a ReEarth page is 54 x 85 mm, an Energy page 55 x 88 mm)
 */
export async function buildIdCardsPdf(cards, { emergency_no = '', sides = 'front' } = {}) {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const kits = {};
  const energy = async () => kits.energy ||= await (async () => {
    const assets = loadAssets();
    const tplPage = (await PDFDocument.load(assets.template)).getPage(0);
    const { width: W, height: H } = tplPage.getSize();
    const font = await out.embedFont(assets.semibold, { subset: true });
    const [front] = await out.embedPages([tplPage]);
    const logo = await out.embedPage(tplPage, { left: 3, bottom: H - LOGO_CLIP_H + 2, right: W - 3, top: H - 2 });
    return { W, H, font, front, logo };
  })();
  const reearth = async () => kits.reearth ||= await (async () => {
    const assets = loadReearthAssets();
    const tplPage = (await PDFDocument.load(assets.template)).getPage(0);
    const { width: W, height: H } = tplPage.getSize();
    const bold = await out.embedFont(assets.bold, { subset: true });
    const semibold = await out.embedFont(assets.semibold, { subset: true });
    const [front] = await out.embedPages([tplPage]);
    const logo = await out.embedPage(tplPage, { left: 3, bottom: H - LOGO_CLIP_H + 2, right: W - 3, top: H - 2 });
    return { W, H, bold, semibold, font: semibold, front, logo };
  })();
  const used = new Set();
  out.setAuthor('Maxvolt Energy Industries Limited');
  out.setCreator('Maxvolt One');

  for (const rawCard of cards) {
    const company = cardCompany(rawCard);
    used.add(company);
    const card = rawCard.photo_prepared || !rawCard.photo_base64 ? rawCard : await prepareCard({ ...rawCard, company });
    const qr_url = card.qr_url || 'https://www.maxvoltenergy.com';

    if (company === 'reearth') {
      const K = await reearth();
      if (sides !== 'back') { const page = out.addPage([K.W, K.H]); await drawReearthFront(out, page, K, card, emergency_no); }
      if (sides === 'back' || sides === 'both') drawReearthBack(out.addPage([K.W, K.H]), { W: K.W, H: K.H, font: K.font, logo: K.logo, emergency_no, qr_url });
      continue;
    }

    const { W, H, font, front, logo } = await energy();
    const page = out.addPage([W, H]);
    if (sides === 'back') { drawBack(page, { W, H, font, logo, emergency_no, qr_url }); continue; }
    page.drawPage(front);

    // Photo first, so the text is always drawn on top of it.
    const photo = fromPrepared(await recutPhoto(card.photo_prepared, 'portrait'));
    if (photo) {
      const img = photo.type === 'png' ? await out.embedPng(photo.bytes) : await out.embedJpg(photo.bytes);
      const imgOpts = { x: PHOTO_X, y: H - photo.box.bottom, width: PHOTO_W, height: photo.box.bottom - photo.box.top };
      if (photo.cutout) {
        page.drawImage(img, imgOpts); // transparent cut-out: the person may sit over the orange, as in the sample card
      } else {
        const pts = PHOTO_CLIP.map(([x, y]) => [x, H - y]);
        page.pushOperators(pushGraphicsState(), moveTo(pts[0][0], pts[0][1]), ...pts.slice(1).map(([x, y]) => lineTo(x, y)), closePath(), clip(), endPath());
        page.drawImage(img, imgOpts);
        page.pushOperators(popGraphicsState());
      }
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

    if (sides === 'both') drawBack(out.addPage([W, H]), { W, H, font, logo, emergency_no, qr_url });
  }
  out.setTitle(used.size > 1 ? 'Maxvolt - ID Cards' : used.has('reearth') ? 'Maxvolt ReEarth - ID Cards' : 'Maxvolt Energy - ID Cards');
  return out.save();
}
