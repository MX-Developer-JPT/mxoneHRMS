import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, Printer, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { ld, fmtDate } from '@/lib/ld';

// Printable completion certificate (use the browser's "Save as PDF" to keep a copy).
export default function LdCertificate() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [cert, setCert] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const d = await ld('ld_listCertificates'); setCert((d.certificates || []).find(c => c.id === id) || null); }
      catch (e) { toast.error(e.message); }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  if (!cert) return <div className="p-6 text-gray-600">Certificate not found. <Link to="/MyLearning" className="text-blue-600 underline">Back</Link></div>;

  return (
    <div className="p-4 md:p-6">
      <style>{`@media print { body * { visibility: hidden; } #ld-cert, #ld-cert * { visibility: visible; } #ld-cert { position: absolute; left: 0; top: 0; width: 100%; } @page { size: A4 landscape; margin: 10mm; } }`}</style>
      <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between print:hidden">
        <Link to="/MyLearning" className="text-sm text-gray-500 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" />Back</Link>
        <Button onClick={() => window.print()} className="gap-2"><Printer className="w-4 h-4" />Print / Save as PDF</Button>
      </div>
      <div id="ld-cert" className="max-w-4xl mx-auto bg-white aspect-[1.414/1] border-[10px] border-double border-[#1a3c5e] p-8 md:p-12 flex flex-col items-center justify-between text-center shadow-lg">
        <div className="space-y-2">
          <img src="/maxvolt-logo.jpg" alt="Maxvolt One" className="h-16 mx-auto object-contain" />
          <div className="text-xs tracking-[0.3em] text-gray-500 uppercase">Maxvolt Energy Industries Limited</div>
        </div>
        <div className="space-y-3">
          <div className="text-3xl md:text-4xl font-serif font-bold text-[#1a3c5e]">Certificate of Completion</div>
          <div className="text-sm text-gray-500">This is to certify that</div>
          <div className="text-3xl md:text-4xl font-serif text-[#f5a001] font-bold">{cert.employee_name}</div>
          {cert.employee_code && <div className="text-xs text-gray-500">Employee ID {cert.employee_code}</div>}
          <div className="text-sm text-gray-500">has successfully completed</div>
          <div className="text-xl md:text-2xl font-semibold text-gray-900">{cert.title}</div>
          {cert.score != null && <div className="text-sm text-gray-600">Assessment score: <b>{cert.score}%</b></div>}
        </div>
        <div className="w-full flex items-end justify-between text-xs text-gray-600">
          <div className="text-left"><div className="font-semibold">Issued</div><div>{fmtDate(cert.issue_date)}</div>{cert.expiry_date && <div>Valid until {fmtDate(cert.expiry_date)}</div>}</div>
          <div className="text-[10px] italic text-gray-400">Simplifying work. Empowering people.</div>
          <div className="text-right"><div className="font-semibold">Certificate ID</div><div className="font-mono">{cert.certificate_id}</div></div>
        </div>
      </div>
    </div>
  );
}
