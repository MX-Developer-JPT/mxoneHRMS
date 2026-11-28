import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Printer, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { openLetterheadPrintWindow, fitOnOnePage } from '@/utils/letterhead';

// Exit letters from the configured templates. Each one shows why it cannot be issued yet; the relieving and experience letters wait
// for the mandatory exit conditions (clearances, settlement, last working day, access revocation).
export default function ExitDocuments({ exit, name }) {
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { const r = await base44.functions.invoke('ex_doc_list', { exit_id: exit.id }); setDocs(r?.data?.success ? r.data : { documents: [], log: [] }); } catch { setDocs({ documents: [], log: [] }); }
  }, [exit.id, exit.status]);
  useEffect(() => { load(); }, [load]);
  const generate = async (type, title) => {
    setBusy(type);
    try {
      const r = await base44.functions.invoke('ex_generate_document', { exit_id: exit.id, doc_type: type });
      if (r?.data?.success) { openLetterheadPrintWindow(`${title} – ${name || ''}`, type === 'relieving_letter' ? fitOnOnePage(r.data.html) : r.data.html, '', false); load(); }
      else toast.error(r?.data?.error || 'Could not generate');
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  if (!docs) return <div className="py-6 text-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>;
  return (
    <div className="space-y-3">
      <div className="border rounded-lg divide-y">
        {docs.documents.map(d => (
          <div key={d.type} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0"><div className="flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-blue-500" />{d.title}{d.generated > 0 && <Badge variant="outline" className="text-[10px]">issued {d.generated}×</Badge>}</div>
              {!d.available && <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><Lock className="w-3 h-3" />{d.reason}</p>}</div>
            <Button size="sm" variant="outline" disabled={!d.available || busy === d.type} onClick={() => generate(d.type, d.title)}>{busy === d.type ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Printer className="w-3 h-3 mr-1" />}View / print</Button>
          </div>))}
      </div>
      {docs.log?.length > 0 && <div className="text-xs text-gray-500"><p className="font-semibold mb-1">Issued</p>{docs.log.slice().reverse().map((l, i) => <p key={i}>{l.title} · {String(l.at).slice(0, 16).replace('T', ' ')} · {l.by}</p>)}</div>}
    </div>
  );
}
