import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Download, Trash2 } from 'lucide-react';
import { openPdfBlob } from '@/utils/letterhead';

const fmtWhen = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const SIDES = { front: 'front', back: 'back', both: 'front + back' };

// Every ID-card / business-card PDF that was generated, kept so it can be downloaded again.
export default function CardHistory() {
  const [rows, setRows] = useState(null);
  const [kind, setKind] = useState('all');
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await base44.functions.invoke('listCardHistory', { kind: kind === 'all' ? undefined : kind });
      const d = r?.data || r;
      if (!d?.success) throw new Error(d?.error || 'Could not load history');
      setRows(d.history); setCanDelete(!!d.can_delete);
    } catch (e) { toast.error(e.message); setRows([]); }
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  const open = async (h) => {
    setBusy(h.id);
    try {
      const r = await base44.functions.invoke('getCardHistoryPdf', { id: h.id });
      const d = r?.data || r;
      if (!d?.success) throw new Error(d?.error || 'Could not open this PDF');
      if (d.url) window.open(d.url, '_blank', 'noopener');
      else openPdfBlob(d.base64, d.filename || h.filename);
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const remove = async (h) => {
    if (!window.confirm(`Delete this PDF from the history (${h.total} card${h.total > 1 ? 's' : ''})?`)) return;
    setBusy('d' + h.id);
    try { await base44.functions.invoke('deleteCardHistory', { id: h.id }); toast.success('Deleted'); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (!rows) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select className="h-9 rounded-md border bg-white px-2 text-sm" value={kind} onChange={e => { setRows(null); setKind(e.target.value); }}>
          <option value="all">All cards</option><option value="id_card">ID cards</option><option value="business_card">Business cards</option>
        </select>
        <span className="text-xs text-gray-500">{rows.length} PDF{rows.length === 1 ? '' : 's'} (latest 300)</span>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Generated</th><th>Type</th><th>Cards</th><th>People</th><th>By</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">Nothing generated yet. PDFs you create from now on are kept here.</td></tr>}
            {rows.map(h => (
              <tr key={h.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
                <td className="p-2 whitespace-nowrap">{fmtWhen(h.at)}</td>
                <td><Badge variant="outline">{h.kind === 'id_card' ? `ID card${h.sides ? ` (${SIDES[h.sides] || h.sides})` : ''}` : 'Business card'}</Badge></td>
                <td>{h.total}</td>
                <td className="text-xs max-w-xs">{(h.names || []).slice(0, 3).join(', ')}{(h.names || []).length > 3 ? ` +${h.total - 3} more` : ''}</td>
                <td className="text-xs">{h.created_by_name || '—'}</td>
                <td className="pr-2 whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => open(h)}>{busy === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}Open</Button>
                  {canDelete && <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" disabled={!!busy} onClick={() => remove(h)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
