import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Play } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { Tile } from '@/components/ld/shared';

export default function LdOverviewTab() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { setD(await ld('ld_getDashboard')); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const startFor = async (u) => {
    setBusy(u.user_id);
    try { await ld('ld_startInduction', { user_id: u.user_id }); toast.success(`Induction started for ${u.name}`); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const tick = async () => {
    setBusy('tick');
    try { const r = await ld('ld_runDailyTick'); toast.success(`Automation run: ${r.result.started} started, ${r.result.overdue_marked} marked overdue, ${r.result.escalations} escalated`); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (!d) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  const k = d.kpis;
  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        <Button size="sm" variant="outline" disabled={busy === 'tick'} onClick={tick} title="Starts missing inductions, marks overdue steps and sends reminders now (it also runs every day at 7:30 AM)">{busy === 'tick' ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}Run automation now</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Tile label="New joiners (inductions)" value={k.total} />
        <Tile label="Not started" value={k.not_started} tone={k.not_started ? 'text-amber-600' : ''} />
        <Tile label="In progress" value={k.in_progress} tone="text-blue-600" />
        <Tile label="Completed" value={k.completed} tone="text-green-600" />
        <Tile label="With overdue steps" value={k.overdue} tone={k.overdue ? 'text-red-600' : ''} />
        <Tile label="Blocked" value={k.blocked} tone={k.blocked ? 'text-orange-600' : ''} />
        <Tile label="Assessment failures" value={k.assessment_failures} tone={k.assessment_failures ? 'text-red-600' : ''} />
        <Tile label="Pending approvals" value={k.pending_approvals} tone={k.pending_approvals ? 'text-amber-600' : ''} />
        <Tile label="Avg days to complete" value={k.avg_completion_days ?? '—'} />
        <Tile label="Assessment pass rate" value={k.assessment_pass_rate != null ? `${k.assessment_pass_rate}%` : '—'} />
        <Tile label="Practical sign-off rate" value={`${k.practical_signoff_rate}%`} />
        <Tile label="30/60/90 review completion" value={`${k.review_completion}%`} />
      </div>

      {d.missing.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent joiners without an induction ({d.missing.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.missing.map(u => (
              <div key={u.user_id} className="flex items-center justify-between gap-3 text-sm bg-white rounded-lg border p-2.5">
                <div><b>{u.name}</b> <span className="text-gray-500">{u.code} · {u.department} · joined {fmtDate(u.doj)}</span></div>
                <Button size="sm" disabled={busy === u.user_id} onClick={() => startFor(u)}>Start induction</Button>
              </div>
            ))}
            <p className="text-xs text-gray-500">New joiners normally get their induction automatically when onboarding is approved; these were approved earlier or before this module existed.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Gate-wise completion</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.gates.length === 0 && <div className="text-sm text-gray-500">No inductions yet.</div>}
            {d.gates.map(g => (
              <div key={g.gate_id}>
                <div className="flex justify-between text-xs mb-0.5"><span><b>{g.gate_id}</b> {g.name}</span><span className="text-gray-500">{g.passed}/{g.total}{g.overdue ? <span className="text-red-600"> · {g.overdue} overdue</span> : ''}{g.failed ? <span className="text-red-600"> · {g.failed} failed</span> : ''}{g.avg_days != null ? ` · avg ${g.avg_days}d` : ''}</span></div>
                <Progress value={g.completion_pct} className="h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Mandatory training compliance by department</CardTitle></CardHeader>
          <CardContent>
            {d.departments.length === 0 ? <div className="text-sm text-gray-500">No mandatory training has been assigned yet. Assign courses from the Catalogue tab.</div> : (
              <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Department</th><th>Assigned</th><th>Done</th><th>Overdue</th><th>Compliance</th></tr></thead>
                <tbody>{d.departments.map(x => <tr key={x.department} className="border-b last:border-0"><td className="py-1.5">{x.department}</td><td>{x.total}</td><td>{x.done}</td><td className={x.overdue ? 'text-red-600' : ''}>{x.overdue}</td><td><span className={x.compliance_pct < 80 ? 'text-red-600 font-semibold' : 'text-green-700'}>{x.compliance_pct}%</span></td></tr>)}</tbody></table>
            )}
            <p className="text-[11px] text-gray-400 mt-2">Target: 100% mandatory training completion; induction ≥ 95%.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Latest inductions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]"><thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Employee</th><th>Department</th><th>Joined</th><th>Progress</th><th>Current step</th><th>Status</th></tr></thead>
            <tbody>{d.inductions.slice(0, 12).map(i => (
              <tr key={i.id} className="border-b last:border-0 hover:bg-gray-50"><td className="py-1.5"><Link className="text-blue-700 hover:underline font-medium" to={`/LdInductionDetail?id=${i.id}`}>{i.name}</Link></td><td>{i.department}</td><td>{fmtDate(i.doj)}</td><td>{i.progress.percent}%</td><td className="text-xs">{i.current_gate}</td><td className={i.overdue_gates ? 'text-red-600' : ''}>{i.overdue_gates ? 'Overdue' : i.status_label}</td></tr>
            ))}</tbody></table>
        </CardContent>
      </Card>
    </div>
  );
}
