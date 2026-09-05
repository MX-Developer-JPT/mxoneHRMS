import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders a scannable QR image for a visitor's pass code. The code itself
// (Visitor.qr_code) is just an opaque uuid — the QR encodes that string
// verbatim, and VisitorQRScanner decodes it back to the same string, which
// visitorCheckIn/visitorCheckOut then look up directly. No embedded visitor
// data in the QR itself, so a stale/cached QR image never goes out of sync
// with the visitor record it points to.
export default function VisitorQRCode({ value, size = 200 }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!value) { setDataUrl(''); return; }
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then(url => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(''); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!value) return null;
  if (!dataUrl) return <div className="bg-gray-100 rounded-lg animate-pulse" style={{ width: size, height: size }} />;
  return <img src={dataUrl} alt="Visitor QR Pass" width={size} height={size} className="rounded-lg border" />;
}
