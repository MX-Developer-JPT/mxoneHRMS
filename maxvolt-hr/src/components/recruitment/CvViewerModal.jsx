import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from 'lucide-react';

export default function CvViewerModal({ open, onClose, resumeUrl, candidateName }) {
  if (!resumeUrl) return null;

  // Older resume_url values were stored as a bare relative path
  // (/api/upload/file/<id>.pdf) — Google's Docs viewer proxy needs a URL it
  // can reach over the open internet, not one relative to this app, which
  // is exactly why this showed "No preview available" for every candidate.
  // window.location.origin always reflects wherever this page is actually
  // running (prod domain, staging, localhost), so use it directly rather
  // than hardcoding a domain here too.
  const absoluteResumeUrl = /^https?:\/\//i.test(resumeUrl)
    ? resumeUrl
    : `${window.location.origin}${resumeUrl.startsWith('/') ? '' : '/'}${resumeUrl}`;

  // Google Docs viewer renders PDF, DOC, DOCX, PPT, and XLS inline — use it
  // for every resume format rather than only PDFs (a raw docx handed to an
  // <iframe> can't be rendered by the browser at all).
  const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(absoluteResumeUrl)}&embedded=true`;

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