import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Undo2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

// Every leave import keeps a copy of what it overwrote. "Undo" first runs a dry run — nothing changes — and shows each
// balance as it is now and as it would be after the undo; only the confirm button on that preview applies it.
const KIND = { leave_history: 'Leave history import', leave_balances: 'Leave balances import' };
const FIELDS = [['total_allocated', 'Allocated'], ['used', 'Used'], ['available', 'Available'], ['carried_forward', 'Carried fwd']];
const when = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso || ''; } };
const call = async (fn, p) => { const r = await base44.functions.invoke(fn, p); return r?.data || r; };

export default function LeaveImportUndo({ onChanged }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await call('listLeaveImportSnapshots', {}); if (d.success) setList(d.snapshots || []); } catch { /* the panel stays empty */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openPreview = async (snap) => {
    setBusy(snap.id); setSearch('');
    try {
      const d = await call('undoLeaveImport', { snapshot_id: snap.id, mode: 'preview' });
      if (!d.success) toast.error(d.error || 'Could not prepare the preview'); else setPreview(d);
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const apply = async () => {
    setBusy('apply');
    try {
      const d = await call('undoLeaveImport', { snapshot_id: preview.snapshot.id, mode: 'apply', preview_hash: preview.preview_hash });
      if (!d.success) { toast.error(d.error || 'Undo failed'); }
      else { toast.success(`Undone — ${d.restored} balance(s) restored${d.removed ? `, ${d.removed} removed` : ''}`); setPreview(null); load(); onChanged?.(); }
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const active = list.filter(s => s.status === 'active');
  const s = preview?.summary;
  const rows = (preview?.rows || []).filter(r => !search || `${r.employee_name} ${r.employee_code} ${r.policy}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><ShieldCheck className="w-4 h-4" /> Undo a leave import</div>
      <p className="text-xs text-amber-800 mt-1">Each import saves a copy of the balances it replaced. Pick one to preview exactly what would change — nothing is changed until you confirm the preview.</p>
      {loading ? <p className="text-xs text-gray-500 mt-2">Loading…</p> : active.length === 0 ? (
        <p className="text-xs text-gray-600 mt-2">No saved imports yet. Imports made from now on can be undone here.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {active.slice(0, 6).map(sn => (
            <div key={sn.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white border border-amber-100 px-3 py-2 text-xs">
              <span><b>{KIND[sn.kind] || 'Leave import'}</b> · {sn.year} · {when(sn.created_at)} · by {sn.created_by_name || 'unknown'} · {sn.summary?.balances || 0} balances{sn.summary?.history ? `, ${sn.summary.history} history records` : ''}</span>
              <Button size="sm" variant="outline" className="h-7 border-amber-300 text-amber-800" onClick={() => openPreview(sn)} disabled={!!busy}>
                {busy === sn.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Undo2 className="w-3 h-3 mr-1" />} Preview undo
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o && busy !== 'apply') setPreview(null); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Preview — undo {preview ? (KIND[preview.snapshot.kind] || 'leave import').toLowerCase() : ''}</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Import made {when(preview.snapshot.created_at)} by {preview.snapshot.created_by_name || 'unknown'}. <b>This is a preview — nothing has been changed yet.</b></p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-2"><p className="text-lg font-bold text-blue-700">{s.balances_restored}</p>balances restored</div>
                <div className="bg-red-50 border border-red-100 rounded-lg p-2"><p className="text-lg font-bold text-red-700">{s.balances_removed}</p>created by the import, removed</div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-2"><p className="text-lg font-bold text-gray-700">{s.balances_unchanged + s.balances_kept}</p>left as they are</div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-2"><p className="text-lg font-bold text-amber-700">{s.changed_since_import}</p>have leave activity since</div>
              </div>
              {(s.history_restored > 0 || s.history_removed > 0) && <p className="text-xs text-gray-600">Leave history: {s.history_restored} record(s) restored to their earlier content{s.history_removed ? `, ${s.history_removed} added by the import removed` : ''}.</p>}
              {s.changed_since_import > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded p-2">Where leave was approved, rejected or applied after the import, that activity is kept on top of the restored balance.</p>}
              <input className="h-9 w-full sm:w-72 rounded-md border border-gray-300 px-2 text-sm" placeholder="Search employee or leave type…" value={search} onChange={e => setSearch(e.target.value)} />
              <div className="border rounded-lg overflow-auto max-h-[45vh]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0"><tr><th className="text-left p-2">Employee</th><th className="text-left p-2">Leave</th>{FIELDS.map(([k, l]) => <th key={k} className="p-2 text-center">{l}<div className="font-normal text-gray-400">now → after undo</div></th>)}<th className="text-left p-2">Result</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2"><b>{r.employee_name || '—'}</b><div className="text-gray-400">{r.employee_code}</div></td>
                        <td className="p-2">{r.policy}</td>
                        {FIELDS.map(([k]) => {
                          const a = r.current?.[k], b = r.restored?.[k];
                          return <td key={k} className={`p-2 text-center ${r.restored && a !== b ? 'font-semibold text-blue-700' : 'text-gray-500'}`}>{a ?? '—'} → {r.restored ? b : 'removed'}</td>;
                        })}
                        <td className="p-2">{r.action === 'remove' ? 'Removed (created by the import)' : r.action === 'recreate' ? 'Re-created' : r.action === 'keep' ? 'Kept' : 'Restored'}{r.note ? <div className="text-gray-400">{r.note}</div> : null}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-400">Nothing to show</td></tr>}
                  </tbody>
                </table>
              </div>
              {preview.truncated && <p className="text-xs text-gray-500">Showing the first 1,000 rows; the undo applies to all of them.</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setPreview(null)} disabled={busy === 'apply'}>Cancel</Button>
                <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={apply} disabled={busy === 'apply' || (s.balances_restored + s.balances_removed + s.history_restored + s.history_removed === 0)}>
                  {busy === 'apply' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Undo2 className="w-4 h-4 mr-1" />} Confirm undo
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
