import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// A bare <iframe src="...pdf">/<embed> only renders inline when the
// browser/WebView itself has a built-in PDF viewer — true for desktop
// Chrome/Firefox/Edge and for actual mobile Safari/Chrome, but NOT
// guaranteed inside a Capacitor app's embedded WKWebView/Android WebView,
// which frequently has no PDF-rendering capability at all and shows a
// blank page with a broken-plugin placeholder icon instead (confirmed
// on-device: this is exactly what payslip PDFs did here before this
// change). react-pdf (a React wrapper around Mozilla's pdf.js) renders
// every page onto a plain <canvas> using pure JavaScript — no native/
// WebView PDF support required at all, so it renders identically
// everywhere: desktop, mobile browser, and inside the native app.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

/**
 * Reusable document viewer modal.
 * Props:
 *   url: string | null  — the document URL to display
 *   title: string       — dialog title
 *   open: boolean
 *   onClose: () => void
 */
export default function DocViewerModal({ url, title = 'Document', open, onClose, content = null, isHtml = false }) {
  const isPdf   = url && (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf'));
  // A blob:/data: URL has no file extension at all (just an opaque id) —
  // never matches isPdf's substring check, but is exactly what the
  // system-generated-payslip-HTML and base64-PDF-fallback paths pass in.
  // Not actually reachable from any current caller with a real (non-PDF,
  // non-blob) extensionless URL, so treating "no recognizable extension at
  // all" as "try rendering it as a PDF" is a safe default rather than
  // silently falling through to the generic <iframe> branch, which is the
  // exact thing this component exists to avoid for PDFs.
  const looksLikeBlobOrOpaque = url && /^(blob:|data:)/i.test(url);
  const isImage = url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
  const renderAsPdf = isPdf || (looksLikeBlobOrOpaque && !isImage);

  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfError, setPdfError] = useState(null);
  const [pageWidth, setPageWidth] = useState(600);
  const containerRef = useRef(null);

  // Reset to page 1 / clear any previous error whenever a different
  // document is opened, so leftover state from the last-viewed PDF never
  // bleeds into this one.
  useEffect(() => {
    setNumPages(null);
    setPageNumber(1);
    setPdfError(null);
  }, [url]);

  // Size the rendered page to the actual available width instead of a
  // fixed pixel value — a phone-width modal would otherwise either
  // overflow or render at a fraction of the screen.
  useEffect(() => {
    if (!open) return;
    const measure = () => { if (containerRef.current) setPageWidth(containerRef.current.clientWidth - 32); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  const copyContent = () => {
    if (content) { navigator.clipboard.writeText(content); }
  };

  const [downloading, setDownloading] = useState(false);
  // The <a download> anchor-click technique (still used below as the last-
  // resort path — utils/letterhead.js's openPdfBlob uses the same thing
  // for offer/HR letters) doesn't work on-device: the HTML `download`
  // attribute has no effect at all unless the browser/WebView itself has a
  // download manager wired up to intercept it — real desktop/mobile
  // browsers do; this app's embedded Capacitor WKWebView/Android WebView
  // does not (same class of gap as window.open()'s missing window-creation
  // delegate, just for downloads instead of new windows).
  //
  // The Web Share API is the real fix, but its file-sharing support
  // (navigator.share({files})) is inconsistent across Android WebView
  // versions/OEMs — confirmed working on iOS, confirmed NOT working on
  // some Android phones even after this was added. Two things changed
  // here to cope with that: (1) navigator.canShare()'s own pre-check is
  // skipped and share() is attempted directly — some Android WebView
  // builds report canShare(files) as false even when share() would have
  // actually worked, so trusting that pre-check was itself excluding
  // devices that could have succeeded; (2) a genuine share failure now
  // falls through to sharing the plain URL instead (Web Share API's
  // original text/url form, supported far more broadly and for far
  // longer than file-sharing), which at least hands the user's own browser
  // or a file manager app the link to fetch and save it themselves, before
  // finally falling back to the anchor-download technique as the last
  // resort for whatever's left (desktop browsers, where it already works).
  const handleDownload = async () => {
    if (!url) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const blob = await res.blob();

      // A downloaded file with no extension often shows no icon and won't
      // auto-open in the right app on the device — title (e.g. "Payslip —
      // Aug 2026") never carries one, so derive one from the URL when
      // possible, else fall back to what this modal is actually rendering.
      const urlExtMatch = /\.(pdf|jpe?g|png|gif|webp|docx?|xlsx?)(\?|$)/i.exec(url);
      const ext = urlExtMatch ? urlExtMatch[1].toLowerCase() : (renderAsPdf ? 'pdf' : isImage ? 'jpg' : '');
      const baseName = (title || 'document').replace(/[\\/:*?"<>|]/g, '_');
      const filename = ext && !baseName.toLowerCase().endsWith(`.${ext}`) ? `${baseName}.${ext}` : baseName;
      const mimeType = blob.type || (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');

      if (typeof navigator.share === 'function') {
        // 1) File sharing — the only path that hands the OS an actual file
        // to save, not just a link. Attempted directly rather than gated
        // on canShare() (see comment above); AbortError means the user
        // closed the share sheet themselves, not a failure.
        try {
          const file = new File([blob], filename, { type: mimeType });
          await navigator.share({ files: [file], title: filename });
          setDownloading(false);
          return;
        } catch (shareErr) {
          if (shareErr?.name === 'AbortError') { setDownloading(false); return; }
        }

        // 2) File sharing unsupported/failed — share the real URL instead
        // (meaningless for a blob:/data: URL, which resolves to nothing
        // outside this page, so only tried for a real remote URL).
        if (!/^(blob:|data:)/i.test(url)) {
          try {
            await navigator.share({ url, title: filename });
            setDownloading(false);
            return;
          } catch (shareErr2) {
            if (shareErr2?.name === 'AbortError') { setDownloading(false); return; }
          }
        }
      }

      // 3) Last resort — reliable on desktop browsers only.
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      console.error('Download failed:', e.message);
      toast.error('Download failed: ' + e.message);
    }
    setDownloading(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <DialogTitle className="text-base font-semibold truncate pr-4">{title}</DialogTitle>
          <div className="flex items-center gap-2 flex-shrink-0">
            {renderAsPdf && numPages > 1 && (
              <div className="flex items-center gap-1 mr-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pageNumber <= 1} onClick={() => setPageNumber(n => Math.max(1, n - 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-gray-500 tabular-nums w-14 text-center">{pageNumber} / {numPages}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pageNumber >= numPages} onClick={() => setPageNumber(n => Math.min(numPages, n + 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
            {url && (
              <Button variant="outline" size="sm" className="gap-1" onClick={handleDownload} disabled={downloading}>
                {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Download
              </Button>
            )}
            {!url && content && (
              <Button variant="outline" size="sm" className="gap-1" onClick={copyContent}>
                <Download className="w-3 h-3" /> Copy
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100">
          {!url && !content ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-3">
              <X className="w-10 h-10 text-gray-300" />
              <p className="text-sm">No document available for this file.</p>
              <p className="text-xs text-gray-400">Contact HR to get a copy of this document.</p>
            </div>
          ) : !url && content ? (
            <div className="p-8 bg-white min-h-full">
              {isHtml
                ? <div dangerouslySetInnerHTML={{ __html: content }} className="max-w-3xl mx-auto" />
                : <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 max-w-3xl mx-auto leading-relaxed">{content}</pre>
              }
            </div>
          ) : renderAsPdf ? (
            pdfError ? (
              // pdf.js couldn't parse this at all (rare — a genuinely corrupt
              // file, or a password-protected PDF pdf.js itself can't open
              // without a password prompt this component doesn't have).
              // Falling back to an <iframe> here is still strictly better
              // than nothing: it works on desktop/real mobile browsers even
              // though it's the same rendering this component exists to
              // avoid inside the native app.
              <iframe src={url} title={title} className="w-full h-full border-0" />
            ) : (
              <div className="flex flex-col items-center py-4">
                <Document
                  file={url}
                  onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                  onLoadError={(e) => { console.error('PDF render failed:', e?.message); setPdfError(e); }}
                  loading={<div className="flex items-center gap-2 text-gray-400 py-16"><Loader2 className="w-5 h-5 animate-spin" /> Loading document…</div>}
                  error={<div className="text-gray-400 py-16 text-sm">Couldn't load this document.</div>}
                >
                  <Page
                    pageNumber={pageNumber}
                    width={Math.max(280, pageWidth)}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    className="shadow-md"
                  />
                </Document>
              </div>
            )
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
