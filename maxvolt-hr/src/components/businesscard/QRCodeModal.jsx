import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Copy, Check, ExternalLink } from 'lucide-react';

// QR generated locally (qrcode package) — works offline and never sends the
// card link to a third-party QR website, unlike the previous api.qrserver.com call.
export default function QRCodeModal({ card, onClose, getCardUrl }) {
  const [copied, setCopied] = useState(false);
  const [qrSrc, setQrSrc] = useState('');
  const cardUrl = getCardUrl(card);

  useEffect(() => {
    QRCode.toDataURL(cardUrl, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then(setQrSrc).catch(() => setQrSrc(''));
  }, [cardUrl]);

  const handleDownload = () => {
    if (!qrSrc) return;
    const a = document.createElement('a');
    a.href = qrSrc;
    a.download = `${(card.name || 'card').replace(/[^\w]+/g, '_')}_QR.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(cardUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs text-center">
        <DialogHeader>
          <DialogTitle>QR Code — {card.name}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center my-1">
          {qrSrc
            ? <img src={qrSrc} alt="QR Code" className="w-56 h-56 rounded-xl border shadow-sm" />
            : <div className="w-56 h-56 rounded-xl bg-gray-100 animate-pulse" />}
        </div>
        <p className="text-xs text-gray-500 break-all px-2 bg-gray-50 rounded p-2">{cardUrl}</p>
        <div className="flex gap-2 mt-1">
          <Button variant="outline" className="flex-1 gap-2" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
          <Button className="flex-1 gap-2" onClick={handleDownload} disabled={!qrSrc}>
            <Download className="w-4 h-4" /> Download
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
          <a href={cardUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" /> Open card</a>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
