import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FlaskConical, Play, RotateCcw, Trash2, ExternalLink, CheckCircle2, Timer, Award, Globe, BookOpen, Package, FileSignature, Network } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld, GATE_STATUS } from '@/lib/ld';

const STEP_LINKS = [
  { gate: 'W1', page: 'LdWebsiteTour', label: 'Website tour', icon: Globe },
  { gate: 'C1', page: 'LdInductionCourse', label: 'Induction course', icon: BookOpen },
  { gate: 'W2', page: 'LdProductTraining', label: 'Product knowledge', icon: Package },
  { gate: 'P1', page: 'LdPolicyReader', label: 'HR policies', icon: FileSignature },
  { gate: 'D1', page: 'LdDeptIntro', label: 'Department intro', icon: Network },
];

// L&D Control Centre → Test cycle. A dry run of the whole journey for the person testing: a test induction and a test training
// assignment where every timed step takes 30 seconds. Test data is flagged, kept out of every report, register and certificate
// list, and never notifies anyone else; "End test cycle" deletes all of it.
export default function LdTestCycleTab() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [wait, setWait] = useState(0);

  const load = useCallback(async () => {
    try { const r = await ld('ld_getTestCycle'); setD(r); setWait(r.training?.wait_left || 0); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);
  useEffect(() => {
    if (!d?.training || d.training.status !== 'IN_PROGRESS') return undefined;
    const i = setInterval(() => setWait(w => Math.max(0, w - 1)), 1000);
    return () => clearInterval(i);
  }, [d?.training?.status, d?.training?.started_at]);

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try { const r = await fn(); if (okMsg) toast.success(okMsg(r)); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const start = (restart = false) => act('start', () => ld('ld_startTestCycle', { restart }), () => 'Test cycle started — every timed step is 30 seconds');
  const end = () => { if (window.confirm('End the test cycle and delete everything it created (test induction, test training, test certificates and signed test acknowledgements)? Nothing real is touched.')) act('end', () => ld('ld_endTestCycle'), (r) => `Test cycle ended — ${r.removed} test record(s) removed`); };
  const trainStart = () => act('t', () => ld('ld_updateProgress', { assignment_id: d.training.id, action: 'start' }), () => 'Training started — it can be completed in 30 seconds');
  const trainDone = () => act('t', () => ld('ld_updateProgress', { assignment_id: d.training.id, action: 'complete' }), () => 'Training completed — see the test certificate below');

  if (!d) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  const ind = d.induction, tr = d.training;
  const link = (page) => `${createPageUrl(page)}?id=${ind.id}`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-amber-900"><FlaskConical className="w-5 h-5" />Test cycle — walk the whole journey in minutes</div>
        <ul className="text-sm text-amber-900 list-disc pl-5 space-y-1">
          <li>You become the new joiner: a test induction (every step, in order) and a test training assignment are created for <b>you</b>.</li>
          <li>Every timed step takes only <b>{d.seconds} seconds</b> — website tour, induction course, product knowledge, each policy, the department chart and the training. Everything is open from today, so no step waits for a date.</li>
          <li>Because you are both the learner and every approver, you can sign off your own steps in a test cycle (never in a real induction). Quizzes and assessments are real: pass marks and attempts still apply.</li>
          <li>Test data is kept apart: it is <b>not counted</b> in any dashboard, KPI, report, certificate register or policy-acknowledgement register, and <b>nobody else is notified</b>. Ending the test deletes all of it.</li>
        </ul>
      </div>

      {!d.active && (
        <div className="rounded-xl border bg-white p-6 text-center space-y-3">
          <p className="text-gray-700">No test cycle is running.</p>
          <Button onClick={() => start(false)} disabled={busy === 'start'}>{busy === 'start' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}Start a test cycle</Button>
        </div>
      )}

      {d.active && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.confirm('Restart the test cycle? The current test data is deleted and a fresh one is created.') && start(true)} disabled={!!busy}><RotateCcw className="w-4 h-4 mr-1.5" />Restart</Button>
            <Button variant="outline" size="sm" className="text-red-700 border-red-200 hover:bg-red-50" onClick={end} disabled={!!busy}>{busy === 'end' ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Trash2 className="w-4 h-4 mr-1.5" />}End test cycle and delete test data</Button>
            <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
          </div>

          {ind && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-gray-900">Test induction</h3>
                <span className="text-sm text-gray-500">{ind.progress.done} of {ind.progress.total} steps done · {ind.progress.percent}%</span>
                <Link to={link('LdInductionDetail')} className="sm:ml-auto"><Button size="sm"><ExternalLink className="w-4 h-4 mr-1.5" />Open the test induction</Button></Link>
              </div>
              <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${ind.progress.percent}%` }} /></div>
              {ind.status === 'COMPLETED' && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded p-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />The test induction is complete.</div>}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Jump straight to a learner step</div>
                <div className="flex flex-wrap gap-2">
                  {STEP_LINKS.filter(s => ind.gates.some(g => g.gate_id === s.gate)).map(s => {
                    const g = ind.gates.find(x => x.gate_id === s.gate); const Icon = s.icon;
                    return <Link key={s.gate} to={link(s.page)}><Button variant="outline" size="sm" disabled={g.status === 'LOCKED'} title={g.status === 'LOCKED' ? 'Opens after the earlier steps' : ''}><Icon className="w-4 h-4 mr-1.5" />{s.label}</Button></Link>;
                  })}
                </div>
              </div>
              <div className="divide-y border rounded-lg text-sm">
                {ind.gates.map(g => {
                  const st = GATE_STATUS[g.status] || { label: g.status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
                  return (
                    <div key={g.gate_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="w-9 text-xs font-mono text-gray-500">{g.gate_id}</span>
                      <span className="flex-1 min-w-[160px] text-gray-900">{g.name}</span>
                      {g.tasks_total > 0 && <span className="text-xs text-gray-500">{g.tasks_done}/{g.tasks_total} tasks</span>}
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tr && (
            <div className="rounded-xl border bg-white p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-gray-900">Test training</h3>
                <span className="text-sm text-gray-600">{tr.title}</span>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-50">{tr.status === 'ASSIGNED' ? 'Not started' : tr.status === 'IN_PROGRESS' ? 'In progress' : 'Completed'}</span>
              </div>
              <p className="text-sm text-gray-600">Assigned the way real training is. Start it, wait {d.seconds} seconds, then mark it complete — completing it issues a test certificate.</p>
              {tr.status === 'ASSIGNED' && <Button size="sm" onClick={trainStart} disabled={busy === 't'}><Play className="w-4 h-4 mr-1.5" />Start the training</Button>}
              {tr.status === 'IN_PROGRESS' && <Button size="sm" onClick={trainDone} disabled={busy === 't' || wait > 0}><Timer className="w-4 h-4 mr-1.5" />{wait > 0 ? `Mark complete (${wait}s)` : 'Mark complete'}</Button>}
              {tr.status === 'COMPLETED' && <div className="text-sm text-green-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Training completed.</div>}
            </div>
          )}

          {d.certificates.length > 0 && (
            <div className="rounded-xl border bg-white p-4 space-y-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Award className="w-4 h-4 text-yellow-600" />Test certificates</h3>
              <ul className="text-sm text-gray-700 space-y-1">{d.certificates.map(c => <li key={c.certificate_id}><span className="font-mono">{c.certificate_id}</span> — {c.title} <span className="text-gray-400">(test only, not in the certificate register)</span></li>)}</ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
