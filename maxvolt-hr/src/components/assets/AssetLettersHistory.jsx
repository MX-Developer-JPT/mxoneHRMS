import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, FileText, Printer, Download, Eye, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { al, downloadLetterPdf, letterState, LETTER_STATUS } from '@/lib/assetLetters';

const fmt = (iso, f = 'dd MMM yyyy') => { try { return iso ? format(new Date(iso), f) : '—'; } catch { return '—'; } };

/** Every asset letter on record: view, reprint, download, and see its print / download history. */
export default function AssetLettersHistory({ open, onClose, letters, loading, onOpen, refreshKey }) {
  const [q, setQ] = useState('');
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState(null);
  useEffect(() => { if (open) { setQ(''); setExpanded(null); } }, [open]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (letters || []).filter(l => (!onlyOutdated || l.outdated) && (!s || [l.ref_no, l.employee_name, l.employee_code, ...(l.asset_codes || []), ...(l.asset_names || [])].join(' ').toLowerCase().includes(s)));
  }, [letters, q, onlyOutdated]);

  const pdf = async (l, withLh) => {
    setBusy(l.id + withLh);
    try { await downloadLetterPdf(l, withLh); refreshKey?.(); } catch (e) { toast.error(e.message || 'Could not create the PDF'); }
    setBusy('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-5xl w-[96vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Asset Letters <Badge variant="secondary">{letters?.length || 0}</Badge></DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search by letter no., employee, asset…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={onlyOutdated} onChange={e => setOnlyOutdated(e.target.checked)} />Needs revision only</label>
        </div>
        {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No letters yet. Generate one from an assigned asset (“Letter” button) or when assigning assets.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(l => {
              const st = letterState(l);
              return (
                <div key={l.id} className={`border rounded-lg p-3 text-sm ${l.status === 'superseded' ? 'bg-muted/30' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{l.ref_no}</span>
                    <Badge className={`${LETTER_STATUS[st].cls} text-[10px]`}>{LETTER_STATUS[st].label}</Badge>
                    {l.outdated && <Badge className="bg-amber-100 text-amber-800 text-[10px] flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Asset changed — revise</Badge>}
                    <span className="font-medium">{l.employee_name}</span><span className="text-xs text-muted-foreground">{l.employee_code}</span>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpen(l)}><Eye className="w-3.5 h-3.5 mr-1" /> View / Print</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === l.id + true} onClick={() => pdf(l, true)}>{busy === l.id + true ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />} PDF</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === l.id + false} onClick={() => pdf(l, false)} title="PDF without the letterhead">{busy === l.id + false ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Printer className="w-3.5 h-3.5 mr-1" />} Plain PDF</Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(l.asset_names || []).join(', ')} · {(l.asset_codes || []).join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Issued {fmt(l.issue_date)} · generated {fmt(l.generated_at, 'dd MMM yyyy, hh:mm a')} by {l.generated_by_name || '—'}
                    {l.acknowledged_at ? ` · acknowledged ${fmt(l.acknowledged_at)}` : ' · not yet acknowledged'}
                    {l.version > 1 ? ` · version ${l.version}` : ''} · printed {l.print_count}× · downloaded {l.download_count}×
                    <button type="button" className="ml-2 underline" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>{expanded === l.id ? 'hide' : 'history'}</button>
                  </p>
                  {expanded === l.id && (
                    <ul className="mt-2 border-t pt-2 text-xs space-y-0.5">
                      {[...(l.history || [])].reverse().map((h, i) => (
                        <li key={i}><span className="text-muted-foreground">{fmt(h.at, 'dd MMM yyyy, hh:mm a')}</span> — <span className="font-medium">{h.action}</span>{h.variant ? ` (${h.variant.replace(/_/g, ' ')})` : ''} by {h.by_name || '—'}{h.note ? ` — ${h.note}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export async function loadLetters(params = {}) { const d = await al('al_list', params); return d; }
