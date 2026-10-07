import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { useEmployees, EmployeeSelect, Field } from '@/components/ld/shared';

export default function LdJoinersTab() {
  const emps = useEmployees();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [dept, setDept] = useState('all');
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);

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

  const start = async () => {
    if (!dlg.user_id) { toast.error('Select an employee'); return; }
    setBusy(true);
    try { await ld('ld_startInduction', { user_id: dlg.user_id, buddy_user_id: dlg.buddy || undefined, trainer_user_id: dlg.trainer || undefined }); toast.success('Induction started'); setDlg(null); await load(); } catch (e) { toast.error(e.message); }
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
        <Button size="sm" onClick={() => setDlg({})}><Plus className="w-4 h-4 mr-1" />Start induction</Button>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Department</th><th>Joined</th><th>Manager</th><th>Buddy</th><th>Progress</th><th>Current step</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-gray-500">No inductions match.</td></tr>}
            {shown.map(r => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-2"><Link className="text-blue-700 hover:underline font-medium" to={`/LdInductionDetail?id=${r.id}`}>{r.name}</Link><div className="text-[11px] text-gray-400">{r.code} · {r.designation}</div></td>
                <td>{r.department}</td><td>{fmtDate(r.doj)}</td><td>{r.manager || '—'}</td><td>{r.buddy || <span className="text-amber-600">none</span>}</td>
                <td className="w-32"><Progress value={r.progress.percent} className="h-1.5" /><div className="text-[10px] text-gray-500">{r.progress.done}/{r.progress.total}</div></td>
                <td className="text-xs">{r.current_gate}</td><td className={r.overdue_gates ? 'text-red-600 text-xs' : 'text-xs'}>{fmtDate(r.due_date)}</td>
                <td className="text-xs">{r.overdue_gates ? <span className="text-red-600 font-semibold">Overdue</span> : r.failed_gates ? <span className="text-red-600">Failed step</span> : r.pending_signoffs ? <span className="text-amber-600">Awaiting approval</span> : r.status_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <Dialog open={!!dlg} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start a New Employee Induction</DialogTitle></DialogHeader>
          <p className="text-xs text-gray-500">Normally this happens automatically when onboarding is approved. Use this for an employee who is missing one. Due dates are counted from the joining date (or today for a late enrolment).</p>
          <Field label="Employee"><EmployeeSelect emps={emps} value={dlg?.user_id} onChange={v => setDlg(d => ({ ...d, user_id: v }))} /></Field>
          <Field label="Buddy (a peer — optional now)"><EmployeeSelect emps={emps} value={dlg?.buddy} onChange={v => setDlg(d => ({ ...d, buddy: v }))} placeholder="Assign later" /></Field>
          <Field label="Trainer (optional)"><EmployeeSelect emps={emps} value={dlg?.trainer} onChange={v => setDlg(d => ({ ...d, trainer: v }))} placeholder="Assign later" /></Field>
          <Button onClick={start} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Start induction</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
