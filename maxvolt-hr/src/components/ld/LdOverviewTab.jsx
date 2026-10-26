import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Play, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { Tile } from '@/components/ld/shared';
import BulkAssignDialog from '@/components/ld/BulkAssignDialog';
import SuggestAssignDialog from '@/components/ld/SuggestAssignDialog';


// Add the website tour, policy acknowledgements and department org chart to the induction template (and optionally to
// inductions already running that have not started the corporate induction).
export function PublishOpeningDialog({ onClose, onDone }) {
  const [running, setRunning] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await ld('ld_publishOpeningSteps', { apply_to_running: running });
      toast.success(r.already ? `Steps were already in the template${running ? `; added to ${r.migrated} running induction(s)` : ''}` : `Published as template version ${r.version}${running ? `; added to ${r.migrated} running induction(s)` : ''}`);
      if (r.skipped?.length) toast.warning(`Left unchanged because they have already started the corporate induction: ${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? '…' : ''}`, { duration: 12000 });
      onDone?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish the opening steps</DialogTitle></DialogHeader>
        <div className="text-sm text-gray-700 space-y-2">
          <p>Every induction will start, in this order:</p>
          <ol className="list-decimal pl-5 space-y-0.5"><li><b>Explore the Maxvolt website</b> — 10 minutes, timed</li><li><b>HR policies</b> — each opens in turn; read, then sign the acknowledgement (stored permanently)</li><li><b>Department introduction</b> — the department org chart (Management at the top, their direct reports in the middle) and a quiz on it</li></ol>
          <p>The Corporate Induction and everything after it start once these three are done. New joiners get this automatically from now on.</p>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={running} onChange={e => setRunning(e.target.checked)} />Also add the steps to running inductions that have not started the Corporate Induction yet (people who already have progress are left as they are).</label>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Publish</Button></div>
      </DialogContent>
    </Dialog>
  );
}

const ICON = { ok: [CheckCircle2, 'text-green-600'], warn: [AlertTriangle, 'text-amber-600'], fail: [XCircle, 'text-red-600'], info: [Info, 'text-blue-500'] };

// "Are we ready to run the induction?" — live checks with a one-click way to fix what can be fixed from here.
function ReadinessCard({ onTab }) {
  const [rd, setRd] = useState(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState('');
  const [assign, setAssign] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [pub, setPub] = useState(false);
  const nav = useNavigate();
  const load = useCallback(async () => { try { setRd(await ld('ld_getReadiness')); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!rd) return null;

  const act = async (a) => {
    if (a.type === 'tab') onTab?.(a.tab);
    else if (a.type === 'bulk') setAssign(true);
    else if (a.type === 'suggest') setSuggest(true);
    else if (a.type === 'publish_opening') setPub(true);
    else if (a.type === 'link') nav(createPageUrl(a.page));
    else if (a.type === 'auto_hod') {
      setBusy('hod');
      try { const r = await ld('ld_bulkAssignPeople', { scope: 'all_open', hod_from_department: true }); toast.success(`${r.updated} HOD(s) filled from the department heads`); await load(); } catch (e) { toast.error(e.message); }
      setBusy('');
    }
  };
  const tone = rd.blockers ? 'border-red-300 bg-red-50/40' : rd.warnings ? 'border-amber-300 bg-amber-50/40' : 'border-green-300 bg-green-50/40';
  return (
    <Card className={tone}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          Pilot readiness
          {rd.blockers > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">{rd.blockers} to fix before the pilot</span>}
          {rd.warnings > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{rd.warnings} to review</span>}
          {!rd.blockers && !rd.warnings && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ready</span>}
          <span className="ml-auto text-xs font-normal text-gray-400">{open ? 'Hide' : 'Show'}</span>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {rd.checks.map(c => { const [Icon, cls] = ICON[c.status] || ICON.info; return (
            <div key={c.key} className="flex items-start gap-2.5 bg-white rounded-lg border p-2.5">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cls}`} />
              <div className="flex-1 min-w-0"><div className="text-sm font-medium text-gray-900">{c.title}</div><div className="text-xs text-gray-600 mt-0.5">{c.detail}</div></div>
              {c.action && <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={busy === 'hod' && c.action.type === 'auto_hod'} onClick={() => act(c.action)}>{busy === 'hod' && c.action.type === 'auto_hod' && <Loader2 className="w-3 h-3 animate-spin mr-1" />}{c.action.label}</Button>}
            </div>
          ); })}
        </CardContent>
      )}
      <BulkAssignDialog open={assign} onClose={() => setAssign(false)} ids={null} onDone={load} />
      <SuggestAssignDialog open={suggest} onClose={() => setSuggest(false)} onDone={load} />
      {pub && <PublishOpeningDialog onClose={() => setPub(false)} onDone={() => { setPub(false); load(); }} />}
    </Card>
  );
}

export default function LdOverviewTab({ onTab }) {
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
      <ReadinessCard onTab={onTab} />
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

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Programme KPIs vs target</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              ['Induction coverage', k.coverage_pct, '%', 100, `${k.eligible_total} active employees`],
              ['Completed within 30 days', k.completion_30d_pct, '%', 90, 'of those due'],
              ['First-attempt pass rate', k.first_attempt_pass_pct, '%', 60, 'content-quality signal'],
              ['Pass after remediation', k.pass_after_remediation_pct, '%', 98, 'of those who failed once'],
              ['Average assessment score', k.avg_assessment_score, '%', 90, ''],
              ['Steps overdue > 7 days', k.overdue_over_7d, '', 0, 'target zero', true],
              ['Learner satisfaction', d.feedback_avg, ' / 5', 4, 'feedback rating'],
            ].map(([label, val, unit, target, note, lowerBetter]) => {
              const has = val != null;
              const good = has && (lowerBetter ? val <= target : val >= target);
              return (
                <div key={label} className="rounded-lg border p-3">
                  <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
                  <div className={`text-2xl font-bold mt-1 ${!has ? 'text-gray-400' : good ? 'text-green-600' : 'text-amber-600'}`}>{has ? `${val}${unit}` : '—'}</div>
                  <div className="text-[10px] text-gray-400">target {lowerBetter ? target : `≥ ${target}${unit.trim() === '/ 5' ? '' : unit}`}{note ? ` · ${note}` : ''}</div>
                </div>
              );
            })}
          </div>
          {d.policy && <p className="text-[11px] text-gray-400 mt-2">Gate policy in force: {d.policy.pass_score}% pass mark · {d.policy.max_attempts} attempts · critical-question rule {d.policy.critical_rule ? 'on' : 'off'}.{d.policy.pass_score < 90 && <b className="text-amber-700"> The scope document asks for 90% — apply it in Settings.</b>}</p>}
        </CardContent>
      </Card>

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
