import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { useEmployees, EmployeeSelect, EmployeeMultiSelect, Field } from '@/components/ld/shared';
import BulkAssignDialog from '@/components/ld/BulkAssignDialog';
import SuggestAssignDialog from '@/components/ld/SuggestAssignDialog';

export default function LdJoinersTab() {
  const emps = useEmployees();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [dept, setDept] = useState('all');
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState([]);          // selected induction ids
  const [assignOpen, setAssignOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [act, setAct] = useState(null); // { kind: 'restart' | 'cancel', row, reason, anchor, start_date }

  const load = useCallback(async () => {
    try { setRows((await ld('ld_listInductions', { include_cancelled: false })).inductions); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const depts = useMemo(() => [...new Set((rows || []).map(r => r.department).filter(Boolean))].sort(), [rows]);
  const shown = (rows || []).filter(r => {
    if (q && !`${r.name} ${r.code} ${r.department} ${r.manager}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (dept !== 'all' && r.department !== dept) return false;
    if (status === 'overdue') return r.overdue_gates > 0;
    if (status === 'blocked') return r.blocked_gates > 0;
    if (status === 'failed') return r.failed_gates > 0;
    if (status === 'approval') return r.pending_signoffs > 0;
    if (status !== 'all') return r.status_label === status;
    return true;
  });

  // "wave" mode: everyone without an induction in the chosen departments / locations, in batches
  const loadWave = async (wave) => {
    try { const pv = await ld('ld_previewWave', { wave }); setDlg(d => ({ ...d, wave, preview: pv })); } catch (e) { toast.error(e.message); }
  };
  const toggleWave = (k, v) => { const w = dlg.wave || {}; const cur = w[k] || []; loadWave({ ...w, [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }); };

  const start = async () => {
    const ids = dlg.user_ids || [];
    if (dlg.mode === 'wave') { if (!dlg.preview?.will_start) { toast.error('No one matches this wave'); return; } }
    else if (!ids.length) { toast.error('Select at least one employee'); return; }
    const anchor = dlg.anchor || 'joining';
    if (anchor === 'date' && !dlg.start_date) { toast.error('Choose the start date'); return; }
    setBusy(true);
    try { const r = await ld('ld_startInduction', { user_ids: dlg.mode === 'wave' ? [] : ids, wave: dlg.mode === 'wave' ? dlg.wave : undefined, buddy_user_id: dlg.buddy || undefined, trainer_user_id: dlg.trainer || undefined, anchor, start_date: anchor === 'date' ? dlg.start_date : undefined }); toast.success(`Induction started for ${r.started} employee(s)${r.failed ? `, ${r.failed} failed` : ''}`); setDlg(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const doAct = async () => {
    if (!act) return;
    if ((act.reason || '').trim().length < 3) { toast.error('Please give a reason'); return; }
    const anchor = act.anchor || 'today';
    if (act.kind === 'restart' && anchor === 'date' && !act.start_date) { toast.error('Choose the start date'); return; }
    setBusy(true);
    try {
      if (act.kind === 'cancel') await ld('ld_cancelInduction', { induction_id: act.row.id, reason: act.reason });
      else await ld('ld_restartInduction', { induction_id: act.row.id, reason: act.reason, anchor, start_date: anchor === 'date' ? act.start_date : undefined });
      toast.success(act.kind === 'cancel' ? 'Induction cancelled' : 'Induction restarted'); setAct(null); await load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (!rows) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input className="w-56" placeholder="Search name, code, manager…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="h-9 rounded-md border bg-white px-2 text-sm" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="Not started">Not started</option><option value="In progress">In progress</option><option value="Completed">Completed</option>
          <option value="overdue">Overdue</option><option value="blocked">Blocked</option><option value="failed">Assessment / step failed</option><option value="approval">Awaiting approval</option>
        </select>
        <select className="h-9 rounded-md border bg-white px-2 text-sm" value={dept} onChange={e => setDept(e.target.value)}>
          <option value="all">All departments</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setSuggestOpen(true)}>Suggest buddies &amp; HODs</Button>
        <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>{sel.length ? `Assign people to ${sel.length} selected` : 'Assign people to all running'}</Button>
        <Button size="sm" onClick={() => setDlg({})}><Plus className="w-4 h-4 mr-1" />Start induction</Button>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2 w-8"><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.filter(r => r.status === 'IN_PROGRESS').every(r => sel.includes(r.id)) && shown.some(r => r.status === 'IN_PROGRESS')} onChange={e => setSel(e.target.checked ? shown.filter(r => r.status === 'IN_PROGRESS').map(r => r.id) : [])} /></th><th className="p-2">Employee</th><th>Department</th><th>Joined</th><th>Manager</th><th>Buddy</th><th>Progress</th><th>Current step</th><th>Due</th><th>Status</th><th className="pr-2">Actions</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={11} className="p-6 text-center text-gray-500">No inductions match.</td></tr>}
            {shown.map(r => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-2 w-8">{r.status === 'IN_PROGRESS' && <input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.id)} onChange={() => setSel(x => (x.includes(r.id) ? x.filter(i => i !== r.id) : [...x, r.id]))} />}</td>
                <td className="p-2"><Link className="text-blue-700 hover:underline font-medium" to={`/LdInductionDetail?id=${r.id}`}>{r.name}</Link><div className="text-[11px] text-gray-400">{r.code} · {r.designation}</div></td>
                <td>{r.department}</td><td>{fmtDate(r.doj)}</td><td>{r.manager || '—'}</td><td>{r.buddy || <span className="text-amber-600">none</span>}</td>
                <td className="w-32"><Progress value={r.progress.percent} className="h-1.5" /><div className="text-[10px] text-gray-500">{r.progress.done}/{r.progress.total}</div></td>
                <td className="text-xs">{r.current_gate}</td><td className={r.overdue_gates ? 'text-red-600 text-xs' : 'text-xs'}>{fmtDate(r.due_date)}</td>
                <td className="text-xs">{r.overdue_gates ? <span className="text-red-600 font-semibold">Overdue</span> : r.failed_gates ? <span className="text-red-600">Failed step</span> : r.pending_signoffs ? <span className="text-amber-600">Awaiting approval</span> : r.status_label}</td>
                <td className="pr-2 whitespace-nowrap">{r.status_label !== 'Completed' && <><Button size="sm" variant="outline" className="h-7 px-2 text-xs mr-1" onClick={() => setAct({ kind: 'restart', row: r })}>Restart</Button><Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700 border-red-200" onClick={() => setAct({ kind: 'cancel', row: r })}>Cancel</Button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <SuggestAssignDialog open={suggestOpen} onClose={() => setSuggestOpen(false)} onDone={load} />
      <BulkAssignDialog open={assignOpen} onClose={() => setAssignOpen(false)} ids={sel.length ? sel : null} count={sel.length} onDone={() => { setSel([]); load(); }} />

      <Dialog open={!!act} onOpenChange={o => !o && setAct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{act?.kind === 'cancel' ? 'Cancel induction' : 'Restart induction'} — {act?.row?.name}</DialogTitle></DialogHeader>
          <p className="text-xs text-gray-500">{act?.kind === 'cancel' ? 'The induction is stopped and all open steps are cancelled. The record and audit trail are kept.' : 'The current induction is cancelled (history kept) and a fresh one starts from step 1. Buddy and trainer carry over.'}</p>
          <Textarea placeholder="Reason (required)" value={act?.reason || ''} onChange={e => setAct(a => ({ ...a, reason: e.target.value }))} />
          {act?.kind === 'restart' && (
            <div className="space-y-1 text-sm">
              <div className="text-xs text-gray-600">Count due dates from</div>
              {[['today', 'Today'], ['joining', 'Joining date (if recent)'], ['date', 'A date I choose']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2"><input type="radio" name="rowanchor" checked={(act.anchor || 'today') === k} onChange={() => setAct(a => ({ ...a, anchor: k }))} />{l}</label>
              ))}
              {act.anchor === 'date' && <Input type="date" value={act.start_date || ''} onChange={e => setAct(a => ({ ...a, start_date: e.target.value }))} />}
            </div>
          )}
          <Button variant={act?.kind === 'cancel' ? 'destructive' : 'default'} onClick={doAct} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{act?.kind === 'cancel' ? 'Cancel induction' : 'Restart induction'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dlg} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start a New Employee Induction</DialogTitle></DialogHeader>
          <p className="text-xs text-gray-500">Normally this happens automatically when onboarding is approved. Use this for an employee who is missing one. Works for any employee, new or long-serving, one or many. Even while induction training is paused, the employees you select start and keep running; everyone else stays paused.</p>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="smode" checked={dlg?.mode !== 'wave'} onChange={() => setDlg(d => ({ ...d, mode: 'pick' }))} />Pick employees</label>
            <label className="flex items-center gap-2"><input type="radio" name="smode" checked={dlg?.mode === 'wave'} onChange={() => { setDlg(d => ({ ...d, mode: 'wave' })); loadWave(dlg?.wave || { limit: 100 }); }} />A wave — by department / location</label>
          </div>
          {dlg?.mode !== 'wave' ? (
            <Field label="Employees (one or many)"><EmployeeMultiSelect emps={emps} value={dlg?.user_ids || []} onChange={v => setDlg(d => ({ ...d, user_ids: v }))} /></Field>
          ) : (
            <div className="space-y-2 rounded-lg border p-3 bg-gray-50">
              <p className="text-xs text-gray-500">Starts the induction for every active employee who does not have one yet, in the departments / locations ticked (leave all unticked for everyone). Use a start date of “today” or a chosen date so each wave&apos;s due dates count from the wave start.</p>
              <div className="text-xs font-semibold">Departments</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs max-h-24 overflow-y-auto">{(dlg.preview?.departments || []).map(x => <label key={x} className="flex items-center gap-1"><input type="checkbox" checked={(dlg.wave?.departments || []).includes(x)} onChange={() => toggleWave('departments', x)} />{x}</label>)}</div>
              <div className="text-xs font-semibold">Locations</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs max-h-24 overflow-y-auto">{(dlg.preview?.locations || []).map(x => <label key={x} className="flex items-center gap-1"><input type="checkbox" checked={(dlg.wave?.locations || []).includes(x)} onChange={() => toggleWave('locations', x)} />{x}</label>)}</div>
              <div className="flex items-center gap-2 text-xs">Batch size <Input type="number" className="w-24 h-8" value={dlg.wave?.limit || 100} onChange={e => loadWave({ ...(dlg.wave || {}), limit: Number(e.target.value) || 100 })} /> (max 500)</div>
              {dlg.preview && <div className="text-xs"><b>{dlg.preview.will_start}</b> of {dlg.preview.total} matching employee(s) will start now{dlg.preview.sample?.length ? ` — e.g. ${dlg.preview.sample.slice(0, 4).map(x => x.name).join(', ')}` : ''}.</div>}
            </div>
          )}
          <Field label="Count due dates from">
            <div className="space-y-1 text-sm">
              {[['joining', 'Joining date (default — recent joiners)'], ['today', 'Today'], ['date', 'A date I choose']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2"><input type="radio" name="anchor" checked={(dlg?.anchor || 'joining') === k} onChange={() => setDlg(d => ({ ...d, anchor: k }))} />{l}</label>
              ))}
              {dlg?.anchor === 'date' && <Input type="date" value={dlg.start_date || ''} onChange={e => setDlg(d => ({ ...d, start_date: e.target.value }))} />}
            </div>
          </Field>
          <Field label="Buddy (a peer — optional; applies to all selected)"><EmployeeSelect emps={emps} value={dlg?.buddy} onChange={v => setDlg(d => ({ ...d, buddy: v }))} placeholder="Assign later" /></Field>
          <Field label="Trainer (optional)"><EmployeeSelect emps={emps} value={dlg?.trainer} onChange={v => setDlg(d => ({ ...d, trainer: v }))} placeholder="Assign later" /></Field>
          <Button onClick={start} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Start induction{dlg?.mode === 'wave' ? (dlg.preview ? ` for ${dlg.preview.will_start} employees` : '') : (dlg?.user_ids?.length || 0) > 1 ? ` for ${dlg.user_ids.length} employees` : ''}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
