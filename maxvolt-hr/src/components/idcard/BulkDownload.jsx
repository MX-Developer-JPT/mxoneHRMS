import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Download, IdCard, QrCode } from 'lucide-react';
import { openPdfBlob } from '@/utils/letterhead';

// Pick several employees and download their saved ID cards and business cards as print-ready PDFs.
export default function BulkDownload() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [sel, setSel] = useState(new Set());
  const [sides, setSides] = useState('both');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await base44.functions.invoke('getBulkCardStatus', {});
      const d = r?.data || r;
      if (!d?.success) throw new Error(d?.error || 'Could not load employees');
      setRows(d.employees);
    } catch (e) { toast.error(e.message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const depts = useMemo(() => [...new Set((rows || []).map(r => r.department).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => (rows || []).filter(r => {
    if (dept !== 'all' && r.department !== dept) return false;
    const t = q.trim().toLowerCase();
    return !t || `${r.name} ${r.code} ${r.department} ${r.designation}`.toLowerCase().includes(t);
  }), [rows, q, dept]);

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShown = shown.length > 0 && shown.every(r => sel.has(r.user_id));
  const toggleAll = () => setSel(s => {
    const n = new Set(s);
    if (allShown) shown.forEach(r => n.delete(r.user_id)); else shown.forEach(r => n.add(r.user_id));
    return n;
  });
  const chosen = (rows || []).filter(r => sel.has(r.user_id));

  const downloadId = async () => {
    if (!chosen.length) { toast.error('Select at least one employee'); return; }
    setBusy('id');
    try {
      const r = await base44.functions.invoke('downloadIdCards', { employee_codes: chosen.map(c => c.code), sides });
      const d = r?.data || r;
      if (!d?.success || !d.base64) throw new Error(d?.error || 'Could not build the ID cards');
      openPdfBlob(d.base64, d.filename);
      toast.success(`${d.total} ID card${d.total > 1 ? 's' : ''} ready${d.missing?.length ? ` — ${d.missing.length} skipped (no saved card): ${d.missing.slice(0, 5).join(', ')}${d.missing.length > 5 ? '…' : ''}` : ''}`);
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const downloadBiz = async () => {
    if (!chosen.length) { toast.error('Select at least one employee'); return; }
    setBusy('biz');
    try {
      const p = await base44.functions.invoke('prepareBusinessCards', { user_ids: chosen.map(c => c.user_id) });
      const pd = p?.data || p;
      if (!pd?.success || !pd.ids?.length) throw new Error(pd?.error || 'No business cards could be prepared');
      const r = await base44.functions.invoke('generateVisitingCards', { ids: pd.ids });
      const d = r?.data || r;
      if (!d?.success || !d.base64) throw new Error(d?.error || 'Could not build the business cards');
      openPdfBlob(d.base64, d.filename);
      toast.success(`${d.total} business card${d.total > 1 ? 's' : ''} ready${pd.created ? ` — ${pd.created} newly created from employee records` : ''}`);
      if (pd.created) load();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (!rows) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-60" placeholder="Search name, code, department…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="h-9 rounded-md border bg-white px-2 text-sm" value={dept} onChange={e => setDept(e.target.value)}>
          <option value="all">All departments</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">{sel.size} selected</span>
      </div>

      <Card className="sticky top-0 z-10">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <IdCard className="w-4 h-4 text-blue-600" />
            <select className="h-9 rounded-md border bg-white px-2 text-sm" value={sides} onChange={e => setSides(e.target.value)}>
              <option value="both">ID cards: front + back</option>
              <option value="front">ID cards: front only</option>
              <option value="back">ID cards: back only</option>
            </select>
            <Button size="sm" onClick={downloadId} disabled={!!busy || !sel.size}>{busy === 'id' ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}Download ID cards</Button>
          </div>
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-blue-600" />
            <Button size="sm" variant="outline" onClick={downloadBiz} disabled={!!busy || !sel.size}>{busy === 'biz' ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}Download business cards</Button>
          </div>
          <p className="text-[11px] text-gray-500 basis-full">ID cards are available for employees whose card was created on the Create tab. Missing business cards are created automatically from the employee record.</p>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
            <th className="p-2 w-8"><input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Select all shown" /></th>
            <th>Employee</th><th>Department</th><th>ID card</th><th>Business card</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-500">No employees match.</td></tr>}
            {shown.map(r => (
              <tr key={r.user_id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(r.user_id)}>
                <td className="p-2"><input type="checkbox" checked={sel.has(r.user_id)} onChange={() => toggle(r.user_id)} onClick={e => e.stopPropagation()} /></td>
                <td><div className="font-medium">{r.name}</div><div className="text-[11px] text-gray-400">{r.code} · {r.designation || '—'}</div></td>
                <td>{r.department || '—'}</td>
                <td>{r.id_card ? <Badge variant="outline" className="border-green-300 text-green-700">Saved</Badge> : <Badge variant="outline" className="text-gray-400">Not created</Badge>}</td>
                <td>{r.business_card ? <Badge variant="outline" className="border-green-300 text-green-700">Exists</Badge> : <Badge variant="outline" className="border-amber-300 text-amber-700">Will be created</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
