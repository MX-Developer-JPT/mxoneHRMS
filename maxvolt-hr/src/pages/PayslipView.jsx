import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { buildPayslipPageHtml } from '../utils/payslipPrint';

// Public page opened in the device's real browser from a short-lived signed
// link (see getPayslipDownloadLink on the backend) — no app login exists in
// that browser, so the token in the URL is the only credential. A real
// browser can "Save as PDF" from its print dialog, which the embedded app
// WebView cannot do.
export default function PayslipView() {
  const { token } = useParams();
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const frameRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/payslip-download/${encodeURIComponent(token)}/data`);
        if (res.status === 401) throw new Error('This payslip link has expired. Please go back to the app and tap the payslip again.');
        if (!res.ok) throw new Error('Could not load this payslip.');
        const data = await res.json();
        if (!data?.success) throw new Error(data?.error || 'Could not load this payslip.');
        setHtml(buildPayslipPageHtml(data));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [token]);

  const handleDownload = () => {
    const win = frameRef.current?.contentWindow;
    if (win) { win.focus(); win.print(); } else { window.print(); }
  };

  if (error) {
    return <div className="min-h-screen flex items-center justify-center p-6 text-center text-gray-600">{error}</div>;
  }
  if (!html) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading payslip…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-white border-b shadow-sm">
        <div className="text-sm text-gray-600">Choose <span className="font-semibold">Save as PDF</span> in the print dialog to download.</div>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <Download className="w-4 h-4" /> Download PDF
        </button>
      </div>
      <iframe ref={frameRef} title="Payslip" srcDoc={html} className="flex-1 w-full border-0 bg-white" />
    </div>
  );
}
