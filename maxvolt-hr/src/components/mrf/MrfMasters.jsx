import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowUp, ArrowDown, Plus, Power, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { mrf } from '@/lib/mrf';
import { selectCls } from './Pickers';

/** HR administration: every dropdown of the requisition form lives here and can be changed without a code release. */
export default function MrfMasters({ onChanged }) {
  const [masters, setMasters] = useState(null);
  const [labels, setLabels] = useState({});
  const [kind, setKind] = useState('position_tier');
  const [newLabel, setNewLabel] = useState('');
  const [meta, setMeta] = useState({ min: '', max: '' });
  const [edit, setEdit] = useState(null);       // { id, label }
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const load = async () => { try { const d = await mrf('mrf_master_list'); setMasters(d.masters); setLabels(d.labels); } catch (e) { toast.error(e.message); } };
  useEffect(() => { load(); }, []);
  const apply = async (fn, ok) => { setBusy(true); try { const d = await fn(); setMasters(d.masters); onChanged?.(); if (ok) toast.success(ok); } catch (e) { toast.error(e.message); } setBusy(false); };
  if (!masters) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  const allRows = masters[kind] || [];
  const rows = allRows;
  const shownRows = filter.trim() ? allRows.filter((r) => r.label.toLowerCase().includes(filter.trim().toLowerCase())) : allRows;
  const move = (i, d) => { const ids = rows.map((r) => r.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; apply(() => mrf('mrf_master_reorder', { kind, ids })); };

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-muted-foreground">These lists feed the requisition form. Add, rename, deactivate or reorder entries — changes apply immediately. Deactivated entries stay on old requisitions but disappear from new forms.</p>
      <select className={selectCls + ' max-w-xs'} value={kind} onChange={(e) => { setKind(e.target.value); setEdit(null); setFilter(''); }}>
        {Object.entries(labels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {allRows.length > 15 && <Input className="max-w-xs" placeholder={`Search ${allRows.length} entries…`} value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder={`Add to ${labels[kind] || ''}`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        {kind === 'experience_range' && <><Input className="w-24" type="number" placeholder="Min yrs" value={meta.min} onChange={(e) => setMeta({ ...meta, min: e.target.value })} /><Input className="w-24" type="number" placeholder="Max yrs" value={meta.max} onChange={(e) => setMeta({ ...meta, max: e.target.value })} /></>}
        <Button disabled={busy || !newLabel.trim()} onClick={() => apply(() => mrf('mrf_master_save', { kind, label: newLabel, meta: kind === 'experience_range' ? meta : undefined }), 'Added').then(() => { setNewLabel(''); setMeta({ min: '', max: '' }); })}><Plus className="w-4 h-4 mr-1.5" />Add</Button>
      </div>
      <div className="border rounded-lg divide-y">
        {shownRows.map((r) => { const i = allRows.indexOf(r); return (
          <div key={r.id} className={`flex items-center gap-2 p-2 text-sm ${r.is_active === false ? 'opacity-50' : ''}`}>
            <span className="w-6 text-xs text-muted-foreground">{i + 1}</span>
            {edit?.id === r.id ? (
              <>
                <Input className="h-8 flex-1" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} autoFocus />
                <Button size="icon" variant="ghost" onClick={() => apply(() => mrf('mrf_master_save', { kind, id: r.id, label: edit.label }), 'Renamed').then(() => setEdit(null))}><Check className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setEdit(null)}><X className="w-4 h-4" /></Button>
              </>
            ) : (
              <>
                <span className="flex-1">{r.label}{r.meta && kind === 'experience_range' && <span className="text-xs text-muted-foreground"> ({r.meta.min}–{r.meta.max} yrs)</span>}</span>
                {r.is_active === false && <Badge variant="outline">Inactive</Badge>}
                <Button size="icon" variant="ghost" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setEdit({ id: r.id, label: r.label })} aria-label="Rename"><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => apply(() => mrf('mrf_master_save', { kind, id: r.id, label: r.label, is_active: r.is_active === false }), r.is_active === false ? 'Activated' : 'Deactivated')} aria-label="Toggle active"><Power className="w-4 h-4" /></Button>
              </>
            )}
          </div>
        ); })}
      </div>
      <p className="text-xs text-muted-foreground">Departments and work locations come from their own masters (Department Management, Location Master) — they are not duplicated here. Designations typed on a requisition are added to the Designations list automatically.</p>
    </div>
  );
}
