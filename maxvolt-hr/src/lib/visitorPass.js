// Generates a professionally-designed visitor QR pass as a PNG image (not a
// plain QR code or a PDF) — a branded card with the MaxVolt logo, location,
// visitor/host details and the scannable QR embedded, matching the
// functional spec's requirement that the shared/downloaded artifact be a
// finished pass image. Built on an in-memory <canvas> so it works entirely
// client-side with no server round-trip.
import QRCode from 'qrcode';
import { safeDate, safeTime } from './dateUtils';

const W = 900, H = 1250;
const BRAND = '#0f4c81'; // matches Layout.jsx's admin/management blue family
const ACCENT = '#1a73c1';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || '').split(' ');
  let line = '', lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines++;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y + lines * lineHeight);
  return lines + 1;
}

const STATUS_LABEL = {
  pending_approval: 'PENDING APPROVAL', approved: 'VALID — READY FOR CHECK-IN',
  checked_in: 'CURRENTLY INSIDE', checked_out: 'VISIT COMPLETED',
  rejected: 'REJECTED', cancelled: 'CANCELLED',
};

// visitor: the Visitor record (needs qr_code, visitor_name, company,
// location_name, host_name, purpose, expected_arrival, expected_departure,
// status, id). location: the matching AppLocation record (for address), or
// null if unavailable.
export async function generateVisitorPassImage(visitor, location) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Header banner
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, BRAND);
  grad.addColorStop(1, ACCENT);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 190);

  try {
    const logo = await loadImage('/maxvolt-logo.jpg');
    const logoH = 90, logoW = logoH * (logo.width / logo.height);
    ctx.save();
    roundRect(ctx, 40, 50, logoW, logoH, 10);
    ctx.clip();
    ctx.drawImage(logo, 40, 50, logoW, logoH);
    ctx.restore();
  } catch { /* logo optional — pass still renders without it */ }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.fillText('Maxvolt Energy Industries Ltd.', 160, 90);
  ctx.font = '20px Arial, sans-serif';
  ctx.fillText('VISITOR GATE PASS', 160, 125);
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(visitor.location_name || 'Office', W - 40, 90);
  if (location?.address) {
    ctx.font = '16px Arial, sans-serif';
    wrapText(ctx, location.address, W - 40, 118, 320, 20);
  }
  ctx.textAlign = 'left';

  let y = 250;
  const labelColor = '#6b7280', valueColor = '#111827';
  const field = (label, value, big = false) => {
    ctx.fillStyle = labelColor;
    ctx.font = '15px Arial, sans-serif';
    ctx.fillText(label.toUpperCase(), 50, y);
    ctx.fillStyle = valueColor;
    ctx.font = big ? 'bold 32px Arial, sans-serif' : 'bold 20px Arial, sans-serif';
    y += big ? 40 : 28;
    ctx.fillText(value || '—', 50, y);
    y += big ? 22 : 30;
  };

  field('Visitor Name', visitor.visitor_name, true);
  field('Company / Organisation', visitor.company || '—');
  field('Meeting', visitor.host_name);
  field('Purpose of Visit', visitor.purpose);

  // Two-column row: arrival / departure
  const col2X = 480;
  const rowY = y;
  ctx.fillStyle = labelColor; ctx.font = '15px Arial, sans-serif';
  ctx.fillText('EXPECTED ARRIVAL', 50, rowY);
  ctx.fillText('EXPECTED DEPARTURE', col2X, rowY);
  ctx.fillStyle = valueColor; ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillText(`${safeDate(visitor.expected_arrival, 'dd MMM yyyy')} · ${safeTime(visitor.expected_arrival)}`, 50, rowY + 28);
  ctx.fillText(visitor.expected_departure ? safeTime(visitor.expected_departure) : 'Not specified', col2X, rowY + 28);
  y = rowY + 60;

  if (visitor.vehicle_number) { field('Vehicle Number', visitor.vehicle_number); }

  // Divider
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(50, y + 10); ctx.lineTo(W - 50, y + 10); ctx.stroke();
  y += 50;

  // QR code
  const qrSize = 320;
  const qrDataUrl = await QRCode.toDataURL(visitor.qr_code || visitor.id, { width: qrSize, margin: 1 });
  const qrImg = await loadImage(qrDataUrl);
  const qrX = (W - qrSize) / 2;
  roundRect(ctx, qrX - 16, y - 16, qrSize + 32, qrSize + 32, 16);
  ctx.fillStyle = '#f9fafb'; ctx.fill();
  ctx.strokeStyle = '#e5e7eb'; ctx.stroke();
  ctx.drawImage(qrImg, qrX, y, qrSize, qrSize);
  y += qrSize + 40;

  // Status badge
  const statusText = STATUS_LABEL[visitor.status] || (visitor.status || '').toUpperCase();
  ctx.font = 'bold 22px Arial, sans-serif';
  const badgeW = ctx.measureText(statusText).width + 50;
  const badgeColors = {
    approved: '#2563eb', checked_in: '#16a34a', pending_approval: '#ca8a04',
    checked_out: '#6b7280', rejected: '#dc2626', cancelled: '#6b7280',
  };
  ctx.fillStyle = badgeColors[visitor.status] || '#6b7280';
  roundRect(ctx, (W - badgeW) / 2, y - 34, badgeW, 46, 23);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(statusText, W / 2, y - 3);
  ctx.textAlign = 'left';
  y += 40;

  ctx.fillStyle = labelColor;
  ctx.font = '14px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Pass ID: ${(visitor.id || '').slice(0, 8).toUpperCase()}`, W / 2, y);
  y += 30;
  ctx.font = 'italic 14px Arial, sans-serif';
  wrapText(ctx, 'This pass must be presented at the gate. It is valid only for the visit and location shown above and is non-transferable.', W / 2 - 300, y, 600, 18);
  ctx.textAlign = 'left';

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Uses the Web Share API's file-sharing capability (share the actual
// designed image, not a link) where the platform supports it; falls back to
// a plain download so the user can share manually where it isn't
// (desktop Chrome/Firefox — no navigator.canShare({files}) support there).
export async function shareOrDownloadPass(blob, filename, title) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title || 'Visitor Pass' });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // fall through to download on any other share failure
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
