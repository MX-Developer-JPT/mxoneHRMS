import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from 'lucide-react';

export default function CvViewerModal({ open, onClose, resumeUrl, candidateName }) {
  if (!resumeUrl) return null;

  // Use Google Docs viewer for PDFs / docs (works for public URLs)
  const isPdf = resumeUrl.toLowerCase().includes('.pdf') || resumeUrl.includes('supabase');
  const viewerUrl = isPdf
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(resumeUrl)}&embedded=true`
    : resumeUrl;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">CV — {candidateName}</DialogTitle>
            <div className="flex gap-2">
              <a href={resumeUrl} download target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-1" /> Download
                </Button>
              </a>

            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden px-4 pb-4">
          <iframe
            src={viewerUrl}
            className="w-full h-full rounded-lg border"
            title={`CV - ${candidateName}`}
            allow="fullscreen"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}