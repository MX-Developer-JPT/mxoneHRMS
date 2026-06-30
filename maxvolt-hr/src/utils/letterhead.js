/**
 * Maxvolt Energy letterhead HTML generator.
 * Matches the official letterhead format exactly.
 */

const LOGO_URL = (typeof window !== 'undefined' ? window.location.origin : '') + '/maxvolt-logo.jpg';

export function letterheadStyles() {
  return `
    @page { margin: 0; size: A4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: white; }

    /* ─── Top orange bar ─── */
    .lh-top-bar { width: 100%; height: 14px; display: flex; }
    .lh-top-bar .seg1 { flex: 1.6; background: #e87722; }
    .lh-top-bar .seg2 { flex: 3.6; background: #f4a83a; }
    .lh-top-bar .seg3 { flex: 0.8; background: #e87722; }

    /* ─── Logo area ─── */
    .lh-logo-row { padding: 18px 28px 12px 28px; }
    .lh-logo-row img { height: 72px; }

    /* ─── Content wrapper (padded) ─── */
    .lh-content { padding: 0 28px 16px 28px; flex: 1; }

    /* ─── Bottom footer ─── */
    .lh-footer-title { text-align: center; font-size: 15px; font-weight: bold; color: #e87722; padding: 10px 28px 6px; }
    .lh-footer-cols { display: flex; border-top: 1px solid #e87722; padding: 8px 28px; gap: 0; }
    .lh-footer-col { flex: 1; padding: 0 14px; font-size: 9px; color: #333; line-height: 1.55; }
    .lh-footer-col + .lh-footer-col { border-left: 1px solid #ccc; }
    .lh-footer-col strong { display: block; font-size: 9.5px; margin-bottom: 2px; color: #1a1a1a; }

    /* ─── Bottom orange bar ─── */
    .lh-bot-bar { width: 100%; height: 14px; display: flex; }
    .lh-bot-bar .seg1 { flex: 1.6; background: #e87722; }
    .lh-bot-bar .seg2 { flex: 3.6; background: #f4a83a; }
    .lh-bot-bar .seg3 { flex: 0.8; background: #e87722; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
  `;
}

export function letterheadHeader() {
  return `
    <div class="lh-top-bar"><div class="seg1"></div><div class="seg2"></div><div class="seg3"></div></div>
    <div class="lh-logo-row">
      <img src="${LOGO_URL}" alt="Maxvolt Energy" onerror="this.style.display='none'" />
    </div>
  `;
}

export function letterheadFooter() {
  return `
    <div class="lh-footer-title">Maxvolt Energy Industries Limited</div>
    <div class="lh-footer-cols">
      <div class="lh-footer-col">
        <strong>Head Office</strong>
        E-82 Bulandshahr Road Industrial Area,<br>
        Ghaziabad, Uttar Pradesh – 201009<br>
        CIN No. L40106DL2019PLC349854
      </div>
      <div class="lh-footer-col">
        <strong>Registered Office</strong>
        F-108, Plot No. 1 F/F United Plaza,<br>
        Community Centre, Karkardooma,<br>
        New Delhi – 110092
      </div>
      <div class="lh-footer-col">
        <strong>Contact Details</strong>
        Phone +91 120 4291595<br>
        Email: info@maxvoltenergy.com<br>
        Web: www.maxvoltenergy.com
      </div>
    </div>
    <div class="lh-bot-bar"><div class="seg1"></div><div class="seg2"></div><div class="seg3"></div></div>
  `;
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
    html, body { height: 100%; }
    .lh-page { display: flex; flex-direction: column; min-height: 100vh; }
    ${extraStyles}
  </style>
</head>
<body>
<div class="lh-page">
  ${letterheadHeader()}
  <div class="lh-content">${contentHtml}</div>
  ${letterheadFooter()}
</div>
<div class="no-print" style="text-align:center;padding:14px;background:#f9fafb;border-top:1px solid #e5e7eb;">
  <button onclick="window.print()" style="background:#e87722;color:white;padding:9px 28px;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:bold;">🖨️ Print / Save as PDF</button>
</div>
</body>
</html>`;
}

/**
 * Wraps content in a full letterhead page and opens a print window.
 */
export function openLetterheadPrintWindow(title, contentHtml, extraStyles = '', autoPrint = true) {
  const html = buildLetterheadHtml(title, contentHtml, extraStyles);
  const win = window.open('', '_blank', 'width=900,height=720');
  win.document.write(html);
  win.document.close();
  if (autoPrint) setTimeout(() => win.print(), 500);
  return win;
}