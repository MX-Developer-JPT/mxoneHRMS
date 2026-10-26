import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { ld } from '@/lib/ld';
import { useEmployees, EmployeeSelect } from '@/components/ld/shared';

// Reviewable proposal: a buddy and a HOD for every running induction that has none, plus one trainer for all.
// Nothing is saved until HR presses Apply; every name can be changed or switched off first.
export default function SuggestAssignDialog({ open, onClose, onDone }) {
  const emps = useEmployees();
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState({});          // induction_id -> { buddy, hod, on }
  const [trainer, setTrainer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setData(null); setErr('');
    ld('ld_suggestAssignments').then(d => {
      setData(d);
      setEdit(Object.fromEntries(d.rows.map(r => [r.induction_id, { buddy: r.buddy?.user_id || '', hod: r.hod?.user_id || '', on: true }])));
      setTrainer('');
    }).catch(e => setErr(e.message));
  }, [open]);

  const set = (id, patch) => setEdit(x => ({ ...x, [id]: { ...x[id], ...patch } }));
  const rows = data?.rows || [];
  const count = useMemo(() => rows.filter(r => edit[r.induction_id]?.on && (edit[r.induction_id].buddy || edit[r.induction_id].hod)).length, [rows, edit]);

  const apply = async () => {
    setBusy(true);
    try {
      const payload = rows.filter(r => edit[r.induction_id]?.on).map(r => ({ induction_id: r.induction_id, buddy_user_id: r.current.buddy ? undefined : edit[r.induction_id].buddy || undefined, hod_user_id: r.current.hod ? undefined : edit[r.induction_id].hod || undefined }));
      const r = await ld('ld_applyAssignments', { rows: payload, trainer_user_id: trainer || undefined });
      toast.success(`${r.updated} induction(s) updated${trainer ? `, trainer set on ${r.trainerSet}` : ''}`);
      if (r.skipped?.length) toast.warning(r.skipped.slice(0, 3).join(' · '), { duration: 9000 });
      onDone?.(); onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-600" />Suggested buddies, HODs and trainer</DialogTitle></DialogHeader>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!data && !err && <div className="flex items-center gap-2 text-gray-500 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" />Finding suitable colleagues…</div>}
        {data && (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">A <b>buddy</b> is a settled colleague (6+ months) from the joiner&apos;s department — never the joiner or their Reporting Manager, not someone still in an induction, at most 3 joiners each, closest in level. A <b>HOD</b> comes from the Departments page; where none is set, the most senior person by designation is proposed and marked <i>confirm</i>. Nothing is saved until you press Apply; change or untick anything.</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2 w-8"></th><th className="p-2">New joiner</th><th className="p-2 min-w-[220px]">Buddy</th><th className="p-2 min-w-[220px]">HOD</th></tr></thead>
              <tbody>{rows.map(r => {
                const e = edit[r.induction_id] || {};
                return (
                  <tr key={r.induction_id} className={`border-b align-top ${e.on ? '' : 'opacity-50'}`}>
                    <td className="p-2"><input type="checkbox" checked={!!e.on} onChange={ev => set(r.induction_id, { on: ev.target.checked })} aria-label={`Include ${r.joiner}`} /></td>
                    <td className="p-2"><div className="font-medium">{r.joiner}</div><div className="text-xs text-gray-500">{r.department}</div></td>
                    <td className="p-2">{r.current.buddy ? <span className="text-xs text-gray-500">Already: {r.current.buddy}</span> : (<><EmployeeSelect emps={emps} value={e.buddy} onChange={v => set(r.induction_id, { buddy: v })} placeholder="No buddy" />{r.buddy && e.buddy === r.buddy.user_id && <div className="text-[11px] text-gray-500 mt-1">{r.buddy.reason}</div>}{!r.buddy && <div className="text-[11px] text-amber-700 mt-1">No eligible colleague found — choose manually.</div>}</>)}</td>
                    <td className="p-2">{r.current.hod ? <span className="text-xs text-gray-500">Already: {r.current.hod}</span> : (<><EmployeeSelect emps={emps} value={e.hod} onChange={v => set(r.induction_id, { hod: v })} placeholder="No HOD" />{r.hod && e.hod === r.hod.user_id && <div className="text-[11px] text-gray-500 mt-1">{r.hod.reason}{r.hod.inferred && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">confirm</span>}</div>}{!r.hod && <div className="text-[11px] text-amber-700 mt-1">No head or senior person found — choose manually.</div>}</>)}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <div className="rounded-lg border bg-gray-50 p-3">
              <div className="text-sm font-medium text-gray-900">Trainer for every running induction without one ({data.summary.needTrainer})</div>
              <p className="text-xs text-gray-500 mb-2">{data.trainers.registered ? `${data.trainers.registered} trainer(s) already registered.` : 'No trainer is registered yet — the person you choose is registered as a trainer.'} Suggestions: HR team, L&amp;D administrators and the proposed department heads.</p>
              <EmployeeSelect emps={emps.filter(x => !data.trainers.candidates.length || data.trainers.candidates.some(c => c.user_id === x.user_id) || x.user_id === trainer)} value={trainer} onChange={setTrainer} placeholder="Leave trainers unchanged" />
            </div>
            <div className="flex items-center justify-between pt-1"><span className="text-xs text-gray-500">{count} induction(s) will be updated{trainer ? ' + trainer assigned' : ''}.</span><div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={apply} disabled={busy || (!count && !trainer)}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Apply</Button></div></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
