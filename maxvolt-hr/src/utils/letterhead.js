/**
 * Maxvolt Energy letterhead — the single official letterhead used by EVERY
 * generated document in the app (letters, offer letters, payslips, Form 16,
 * salary structures, asset handover, job descriptions, exit documents…).
 *
 * The letterhead is the company's own artwork (public/letterhead.jpg, an A4
 * page: header with logo + tagline, footer with registered office / contact /
 * CIN). It is laid down as the page background and the document content is
 * flowed inside the blank area between header and footer. The server-side PDF
 * generators (backend/routes/functions.js makeLetterheadChrome) use the same
 * artwork, so every document looks identical however it is produced.
 */

const BG_URL = (typeof window !== 'undefined' ? window.location.origin : '') + '/letterhead.jpg?v=1';

// Blank band of the artwork (A4 = 210 x 297mm): header ends ~44mm from the top,
// footer rule starts ~265mm. Spacers keep content clear of both on EVERY
// printed page (thead/tfoot repeat per page when printing).
const HEAD_SPACE_MM = 48;
const FOOT_SPACE_MM = 38;
const SIDE_PAD_MM = 15;

export function letterheadStyles() {
  return `
    @page { margin: 0; size: A4; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #e5e7eb; }

    /* Full-page artwork, repeated behind every printed page. */
    .lh-bg { display: none; }
    .lh-bg img { width: 100%; height: 100%; display: block; }

    /* On screen the sheet is one continuous page: the header artwork at the
       top, the footer artwork at the very end (a repeated page background
       would slice through the middle of a long document). Printing switches
       to the per-page fixed artwork below. */
    .lh-sheet {
      position: relative; width: 210mm; margin: 0 auto; background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,.18);
    }
    .lh-sheet::before, .lh-sheet::after {
      content: ''; position: absolute; left: 0; width: 100%; pointer-events: none;
      background-image: url('${BG_URL}'); background-size: 210mm 297mm; background-repeat: no-repeat;
    }
    .lh-sheet::before { top: 0; height: ${HEAD_SPACE_MM}mm; background-position: left top; }
    .lh-sheet::after { bottom: 0; height: ${FOOT_SPACE_MM}mm; background-position: left bottom; }
    .lh-page { width: 100%; border-collapse: collapse; min-height: 297mm; }
    .lh-page td { padding: 0; vertical-align: top; }
    .lh-head-space { height: ${HEAD_SPACE_MM}mm; }
    .lh-foot-space { height: ${FOOT_SPACE_MM}mm; }
    .lh-page td.lh-content { padding: 0 ${SIDE_PAD_MM}mm; }

    @media print {
      html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .lh-bg { display: block; position: fixed; top: 0; left: 0; width: 210mm; height: 297mm; z-index: 0; }
      .lh-sheet { width: 100%; margin: 0; box-shadow: none; background: none; position: relative; z-index: 1; }
      .lh-sheet::before, .lh-sheet::after { display: none; }
      .lh-page { min-height: 0; }
      .no-print { display: none !important; }
    }
  `;
}

export function letterheadHeader() {
  return `<div class="lh-bg"><img src="${BG_URL}" alt="" /></div>`;
}

export function letterheadFooter() {
  return '';
}

/**
 * Returns the full letterhead HTML string without opening any window.
 */
export function buildLetterheadHtml(title, contentHtml, extraStyles = '') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    ${letterheadStyles()}
    ${extraStyles}
  </style>
</head>
<body>
${letterheadHeader()}
<div class="lh-sheet">
  <table class="lh-page">
    <thead><tr><td><div class="lh-head-space"></div></td></tr></thead>
    <tbody><tr><td class="lh-content">${contentHtml}</td></tr></tbody>
    <tfoot><tr><td><div class="lh-foot-space"></div></td></tr></tfoot>
  </table>
</div>
<div class="no-print" style="text-align:center;padding:14px;background:#f9fafb;border-top:1px solid #e5e7eb;">
  <button onclick="window.print()" style="background:#111;color:#fcd116;padding:9px 28px;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:bold;">🖨️ Print / Save as PDF</button>
</div>
</body>
</html>`;
}

/**
 * Opens (or downloads) a base64-encoded PDF via a blob URL + a synthetic
 * <a> click — NOT window.open(). window.open() called after an `await`
 * (as every PDF-generating call here is) is no longer inside the click
 * event's user-gesture window, so most browsers silently block it as a
 * popup with no visible error. An anchor click, by contrast, is reliably
 * allowed even when triggered from an async handler — this is the pattern
 * that actually works for "Preview"/"Download PDF" buttons in this app.
 */
export function openPdfBlob(base64, filename, { download = false } = {}) {
  if (!base64) return;
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  if (download) a.download = filename || 'document.pdf';
  else { a.target = '_blank'; a.rel = 'noopener'; }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Wraps content in a full letterhead page and opens a print window.
 *
 * `existingWin` lets a caller pass an ALREADY-open window (opened
 * synchronously, in direct response to the click, before any async data
 * fetch) instead of this function opening one itself. That matters: most
 * callers here fetch the document's data via an async functions.invoke()
 * first and only call this afterward — by the time that promise resolves,
 * enough browsers no longer treat window.open() as tied to the original
 * user gesture and silently block it (no exception, `win` is just null),
 * which used to throw here (`win.document.write` on null) the instant a
 * user's browser did that — caught by the caller's try/catch and logged to
 * console, with nothing at all shown to the user, who just saw the
 * button's loading state reset with no explanation. Falls back to opening
 * its own window (the original behavior) when no existingWin is passed, and
 * still guards against a null result either way instead of throwing.
 */
export function openLetterheadPrintWindow(title, contentHtml, extraStyles = '', autoPrint = true, existingWin = null) {
  const html = buildLetterheadHtml(title, contentHtml, extraStyles);
  const win = existingWin || window.open('', '_blank', 'width=900,height=720');
  if (!win || win.closed) return null;
  win.document.write(html);
  win.document.close();
  if (autoPrint) setTimeout(() => { try { win.print(); } catch { /* window may have been closed by the user already */ } }, 500);
  return win;
}