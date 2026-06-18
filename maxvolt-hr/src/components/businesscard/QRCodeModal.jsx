import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Copy, Check } from 'lucide-react';

// Simple QR code generation using a public API
export default function QRCodeModal({ card, onClose, getCardUrl }) {
  const [copied, setCopied] = useState(false);
  const cardUrl = getCardUrl(card);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(cardUrl)}&bgcolor=ffffff&color=1e3a5f&margin=10`;

  const handleDownload = async () => {
    const response = await fetch(qrUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.name.replace(/\s+/g, '_')}_QR.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cardUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs text-center">
        <DialogHeader>
          <DialogTitle>QR Code — {card.name}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center my-2">
          <img
            src={qrUrl}
            alt="QR Code"
            className="w-56 h-56 rounded-lg border shadow-sm"
          />
        </div>
        <p className="text-xs text-gray-500 break-all px-2 bg-gray-50 rounded p-2">{cardUrl}</p>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1 gap-2" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
          <Button className="flex-1 gap-2" onClick={handleDownload}>
            <Download className="w-4 h-4" /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}