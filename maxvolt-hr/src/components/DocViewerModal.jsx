import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download } from 'lucide-react';

/**
 * Reusable document viewer modal.
 * Props:
 *   url: string | null  — the document URL to display
 *   title: string       — dialog title
 *   open: boolean
 *   onClose: () => void
 */
export default function DocViewerModal({ url, title = 'Document', open, onClose }) {
  const isPdf   = url && (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf'));
  const isImage = url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <DialogTitle className="text-base font-semibold truncate pr-4">{title}</DialogTitle>
          <div className="flex items-center gap-2 flex-shrink-0">
            {url && (
              <a href={url} download target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1">
                  <Download className="w-3 h-3" /> Download
                </Button>
              </a>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-gray-100">
          {!url ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-3">
              <X className="w-10 h-10 text-gray-300" />
              <p className="text-sm">No document URL available for this file.</p>
              <p className="text-xs text-gray-400">The document may not have been uploaded correctly.</p>
            </div>
          ) : isPdf ? (
            <iframe src={url} title={title} className="w-full h-full border-0" />
          ) : isImage ? (
            <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
              <img src={url} alt={title} className="max-w-full max-h-full object-contain rounded shadow" />
            </div>
          ) : (
            <iframe src={url} title={title} className="w-full h-full border-0" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}