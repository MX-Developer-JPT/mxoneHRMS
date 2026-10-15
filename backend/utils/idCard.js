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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '../assets');

const NAVY = rgb(0.17, 0.15, 0.45);
const INK = rgb(0.1, 0.1, 0.1);

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
async function preparePhoto(photoBase64) {
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

/**
 * @param {Array<{name,designation,employee_id,doj,department,photo_base64}>} cards
 * @param {{emergency_no: string}} opts  same emergency number on every card
 * @returns {Promise<Uint8Array>} PDF bytes (1 page per card)
 */
export async function buildIdCardsPdf(cards, { emergency_no = '' } = {}) {
  const assets = loadAssets();
  const tpl = await PDFDocument.load(assets.template);
  const tplPage = tpl.getPage(0);
  const { width: W, height: H } = tplPage.getSize();

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const font = await out.embedFont(assets.semibold, { subset: true });
  const [front] = await out.embedPages([tplPage]);
  out.setTitle('Maxvolt Energy - ID Cards');
  out.setAuthor('Maxvolt Energy Industries Limited');
  out.setCreator('Maxvolt One');

  for (const card of cards) {
    const page = out.addPage([W, H]);
    page.drawPage(front);

    // Photo first, so the text is always drawn on top of it.
    const photo = await preparePhoto(card.photo_base64);
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
  }
  return out.save();
}
