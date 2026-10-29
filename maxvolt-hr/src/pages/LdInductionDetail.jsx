import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, ChevronDown, ChevronRight, Lock, CheckCircle2, Circle, ClipboardCheck, ExternalLink, UserCog, ShieldAlert, Award, History, ArrowLeft } from 'lucide-react';
import { ld, ROLE_LABEL, STAGES, fmtDate, fmtDateTime, openContent } from '@/lib/ld';
import { StatusPill } from '@/pages/MyLearning';
import { PausedBanner } from '@/components/ld/PauseControl';
import { createPageUrl } from '@/utils';
import { mmss } from '@/lib/ldTime';

// Steps that open their own screen (they cannot be ticked off by hand)
const STEP_PAGE = { timed: 'LdWebsiteTour', policy_ack: 'LdPolicyReader', org_view: 'LdDeptIntro', org_quiz: 'LdDeptIntro', product_study: 'LdProductTraining', product_quiz: 'LdProductTraining' };

const ACTIVE_EDIT = ['READY', 'IN_PROGRESS', 'OVERDUE'];

// After a failed attempt the employee must revisit the weak topics (and wait a short cooling-off) before retrying.
function RelearnPanel({ g, onConfirm, busy }) {
  const info = g.attempts_info || {};
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = info.relearn_ready_at ? Math.max(0, Math.ceil((Date.parse(info.relearn_ready_at) - now) / 1000)) : 0;
  const last = g.attempts[g.attempts.length - 1];
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="text-sm font-semibold text-amber-900">Review before your next attempt</div>
      <div className="text-xs text-amber-900">You scored {last?.score}%. Revisit the induction content, then confirm below — the next attempt unlocks after that.</div>
      {(last?.weak_topics || []).length > 0 && (
        <ul className="text-xs text-amber-900 list-disc pl-4">{last.weak_topics.map(t => <li key={t.topic}>Block <b>{t.topic}</b> — {t.correct}/{t.total} right ({t.pct}%)</li>)}</ul>
      )}
      {last?.gaps?.length > 0 && <details className="text-xs text-amber-900"><summary className="cursor-pointer">Questions you missed</summary><ul className="list-disc pl-4 mt-1 space-y-0.5">{last.gaps.slice(0, 15).map((q, i) => <li key={i}>{q}</li>)}</ul></details>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => openContent('induction-deck').catch(e => toast.error(e.message))}>Open induction presentation</Button>
        <Button size="sm" variant="outline" onClick={() => openContent('induction-guide').catch(e => toast.error(e.message))}>Open training guide</Button>
        <Button size="sm" disabled={left > 0 || busy} onClick={onConfirm}>{left > 0 ? `I have reviewed the topics (${left}s)` : 'I have reviewed the topics'}</Button>
      </div>
    </div>
  );
}

function Person({ label, name }) {
  return <div className="text-xs"><div className="text-gray-500">{label}</div><div className="font-medium text-gray-900">{name || <span className="text-gray-400">Not assigned</span>}</div></div>;
}

export default function LdInductionDetail() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const id = params.get('id');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState('');
  const [evidence, setEvidence] = useState({});
  const [forms, setForms] = useState({});
  const [dlg, setDlg] = useState(null);
  const [text, setText] = useState('');
  const [text2, setText2] = useState('');
  const [emps, setEmps] = useState([]);
  const [people, setPeople] = useState({});

  const load = useCallback(async () => {
    try {
      const d = await ld('ld_getInduction', { id });
      setData(d);
      setOpen(o => {
        if (Object.keys(o).length) return o;
        const first = d.induction.gates.find(g => ['READY', 'IN_PROGRESS', 'OVERDUE', 'SUBMITTED', 'UNDER_REVIEW', 'FAILED'].includes(g.status));
        return first ? { [first.gate_id]: true } : {};
      });
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, name, p, ok) => {
    setBusy(key);
    try {
      const r = await ld(name, { induction_id: id, ...p });
      if (ok) toast.success(ok);
      await load();
      return r;
    } catch (e) { toast.error(e.message); return null; }
    finally { setBusy(''); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  if (!data) return <div className="p-6 text-gray-600">Induction not found or you don't have access. <Link to="/MyLearning" className="text-blue-600 underline">Back</Link></div>;
  const ind = data.induction;
  const v = ind._viewer;
  const canAdmin = v.is_ld;

  const openPeopleDialog = async () => {
    setDlg({ kind: 'people' });
    setPeople({ buddy_user_id: ind.buddy_user_id || '', trainer_user_id: ind.trainer_user_id || '', hod_user_id: ind.hod_user_id || '', hr_spoc_user_id: ind.hr_spoc_user_id || '' });
    if (!emps.length) {
      try { setEmps(((await base44.entities.Employee.list()) || []).filter(e => e.user_id && e.status !== 'inactive').sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))); } catch { /* optional */ }
    }
  };

  const gateCard = (g) => {
    const can = ind._can[g.gate_id] || {};
    const editable = ACTIVE_EDIT.includes(g.status);
    const waiting = ['SUBMITTED', 'UNDER_REVIEW'].includes(g.status);
    const isOpen = !!open[g.gate_id];
    const myForm = forms[g.gate_id] || g.form_data || {};
    const doneCount = g.tasks.filter(t => t.done).length;
    const needSign = g.required_signoffs || ['any'];
    const tasksDone = g.tasks.every(t => t.done || t.required === false);
    const todayStr = new Date().toISOString().slice(0, 10);
    return (
      <Card key={g.gate_id} className={g.status === 'OVERDUE' || g.status === 'FAILED' ? 'border-red-300' : g.status === 'PASSED' ? 'border-green-200' : ''}>
        <button className="w-full text-left p-4 flex items-center gap-3" onClick={() => setOpen(o => ({ ...o, [g.gate_id]: !o[g.gate_id] }))}>
          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {g.status === 'LOCKED' && <Lock className="w-3.5 h-3.5 text-gray-400" />}
              <span className="font-semibold text-gray-900">{g.gate_id} · {g.name}</span>
              <StatusPill status={g.status} />
              {g.required === false && <Badge variant="outline" className="text-[10px]">Optional</Badge>}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Owner: {g.owner_roles.map(r => ROLE_LABEL[r] || r).join(' / ')} · Due {fmtDate(g.due_date)}
              {g.tasks.length ? ` · ${doneCount}/${g.tasks.length} items` : ''}
              {g.status === 'LOCKED' && g.depends_on?.length ? ` · unlocks after ${g.depends_on.join(', ')}` : ''}
              {g.status === 'LOCKED' && g.available_from > todayStr ? ` · available from ${fmtDate(g.available_from)}` : ''}
            </div>
          </div>
        </button>
        {isOpen && (
          <CardContent className="pt-0 space-y-4 border-t">
            <p className="text-sm text-gray-600 pt-3">{g.description}</p>
            {g.status === 'BLOCKED' && <div className="text-sm bg-orange-50 border border-orange-200 rounded p-2 text-orange-800"><ShieldAlert className="w-4 h-4 inline mr-1" />Blocked: {g.block_reason || 'on hold'}</div>}
            {g.status === 'WAIVED' && <div className="text-sm bg-purple-50 border border-purple-200 rounded p-2 text-purple-800">Formally waived — see the Waivers tab for the approval.</div>}
            {g.content?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {g.content.map(c => <Button key={c.file} size="sm" variant="outline" onClick={() => openContent(c.file).catch(e => toast.error(e.message))}><ExternalLink className="w-3.5 h-3.5 mr-1" />{c.title}</Button>)}
              </div>
            )}

            {g.tasks.length > 0 && (
              <div className="space-y-2">
                {g.tasks.map(t => {
                  const mine = t.actor === 'employee' ? (can.self || v.is_hr) : can.owner;
                  const actionable = editable && !t.done && mine && !t.auto_check && !t.server_only;
                  const stepPage = t.server_only && STEP_PAGE[t.type];
                  return (
                    <div key={t.id} className="flex items-start gap-2 text-sm">
                      {t.done ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> : <Circle className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />}
                      <div className="flex-1">
                        <div className={t.done ? 'text-gray-500' : 'text-gray-900'}>{t.title} <span className="text-[10px] text-gray-400">{t.actor === 'owner' ? `· ${(g.owner_roles || []).map(r => ROLE_LABEL[r] || r).join(' / ') || 'owner'}` : '· employee'}{t.auto_check ? ' · automatic' : ''}</span></div>
                        {!t.done && t.watch?.sec > 0 && <div className="text-[11px] text-blue-600">{mmss(t.watch.sec)} of {mmss(t.target_seconds || t.min_read_seconds || 0)} so far</div>}
                        {t.type === 'org_quiz' && t.attempts?.length > 0 && !t.done && <div className="text-[11px] text-gray-500">{t.attempts.length} attempt(s) · last score {t.attempts[t.attempts.length - 1].score}%</div>}
                        {t.done && <div className="text-[11px] text-gray-400">{t.done_by === 'system' ? 'Verified automatically' : `Done ${fmtDateTime(t.done_at)}`}{t.evidence ? ` — “${t.evidence}”` : ''}</div>}
                        {actionable && t.evidence_required && <Textarea className="mt-1 text-sm" placeholder="Write your answer…" value={evidence[t.id] || ''} onChange={e => setEvidence(x => ({ ...x, [t.id]: e.target.value }))} />}
                      </div>
                      {stepPage && !t.done && ACTIVE_EDIT.includes(g.status) && <Link to={`${createPageUrl(stepPage)}?id=${ind.id}`}><Button size="sm" variant="outline">{can.self ? (t.watch?.sec > 0 || t.attempts?.length ? 'Continue' : 'Start') : 'View'}</Button></Link>}
                      {actionable && <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => run(t.id, 'ld_completeTask', { gate_id: g.gate_id, task_id: t.id, evidence: evidence[t.id] })}>{t.type === 'ack' ? 'I confirm' : 'Mark done'}</Button>}
                      {t.done && v.is_hr && ['READY', 'IN_PROGRESS', 'OVERDUE', 'SUBMITTED', 'UNDER_REVIEW'].includes(g.status) && <button className="text-[11px] text-gray-400 underline" onClick={() => run(t.id, 'ld_completeTask', { gate_id: g.gate_id, task_id: t.id, undo: true })}>undo</button>}
                    </div>
                  );
                })}
              </div>
            )}

            {g.form && (
              <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
                <div className="text-sm font-semibold">{/Review/.test(g.name) ? 'Review form' : 'Form'}</div>
                {g.form.map(f => (
                  <div key={f.key}>
                    <div className="text-xs text-gray-600 mb-0.5">{f.label}</div>
                    {can.owner && editable
                      ? <Textarea rows={2} className="text-sm bg-white" value={myForm[f.key] || ''} onChange={e => setForms(s => ({ ...s, [g.gate_id]: { ...(s[g.gate_id] || g.form_data || {}), [f.key]: e.target.value } }))} />
                      : <div className="text-sm bg-white border rounded p-2 min-h-[34px] whitespace-pre-wrap">{g.form_data?.[f.key] || <span className="text-gray-300">—</span>}</div>}
                  </div>
                ))}
                {can.owner && editable && <Button size="sm" disabled={busy === 'form' + g.gate_id} onClick={() => run('form' + g.gate_id, 'ld_saveGateForm', { gate_id: g.gate_id, data: myForm }, 'Saved')}>{tasksDone ? 'Save & submit for sign-off' : 'Save'}</Button>}
              </div>
            )}

            {g.competencies && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Practical competencies <span className="text-xs font-normal text-gray-500">LEARN → OBSERVE → PRACTISE → PERFORM → IMPROVE — signed off by the trainer / manager only</span></div>
                {g.competencies.map(c => (
                  <div key={c.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap"><div className="text-sm font-medium">{c.name}</div><Badge variant="outline">{c.stage}</Badge></div>
                    <div className="flex gap-1 mt-2">{STAGES.map(s => <div key={s} className={`h-1.5 flex-1 rounded ${STAGES.indexOf(s) <= STAGES.indexOf(c.stage) ? 'bg-blue-500' : 'bg-gray-200'}`} title={s} />)}</div>
                    {can.owner && editable && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {STAGES.map(s => <Button key={s} size="sm" variant={c.stage === s ? 'default' : 'outline'} className="h-7 text-[11px] px-2" onClick={() => { setText(''); setDlg({ kind: 'stage', gate: g, comp: c, stage: s }); }}>{s}</Button>)}
                      </div>
                    )}
                    {c.evidence?.length > 0 && <div className="text-[11px] text-gray-500 mt-2">Latest evidence: {c.evidence[c.evidence.length - 1].note}</div>}
                  </div>
                ))}
              </div>
            )}

            {g.completion === 'assessment' && (
              <div className="rounded-lg border bg-blue-50/50 p-3 space-y-2">
                <div className="text-sm font-semibold flex items-center gap-2 flex-wrap"><ClipboardCheck className="w-4 h-4 text-blue-600" />Knowledge assessment — pass mark {g.pass_score || 90}%
                  {g.attempts_info && <span className="text-xs font-normal text-gray-500">· attempt {Math.min(g.attempts_info.used + 1, g.attempts_info.max)} of {g.attempts_info.max}{g.attempts_info.left < g.attempts_info.max ? ` (${g.attempts_info.left} left)` : ''}</span>}
                </div>
                {g.attempts_info?.critical_rule && <div className="text-[11px] text-gray-500">Safety / compliance questions marked “critical” must all be answered correctly in addition to the pass mark.</div>}
                {g.attempts.length > 0 && <div className="text-xs text-gray-600 space-y-0.5">{g.attempts.map((a, i) => <div key={a.attempt_id}>Attempt {i + 1}: <b className={a.passed ? 'text-green-700' : 'text-red-700'}>{a.expired ? 'time expired' : `${a.score}%`}</b> {a.passed ? 'passed' : 'not passed'}{a.critical_failed > 0 ? ` · ${a.critical_failed} critical wrong` : ''} · {fmtDateTime(a.at)}</div>)}</div>}
                {can.self && g.attempts_info?.needs_relearn && editable && <RelearnPanel g={g} busy={busy === 'rl'} onConfirm={() => run('rl', 'ld_ackRelearn', { gate_id: g.gate_id }, 'Thanks — you can retake the assessment now')} />}
                {can.self && editable && tasksDone && !g.attempts_info?.needs_relearn && <Link to={`/LdAssessment?induction_id=${ind.id}&gate_id=${g.gate_id}`}><Button size="sm" className="gap-1"><ClipboardCheck className="w-4 h-4" />{g.attempts.length ? 'Retake assessment' : 'Take assessment'}</Button></Link>}
                {can.self && editable && !tasksDone && <div className="text-xs text-gray-500">Finish the preparation items first.</div>}
              </div>
            )}

            {g.status === 'FAILED' && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <div className="text-sm font-semibold text-red-800">Not passed — remediation</div>
                <div className="text-xs text-red-700 whitespace-pre-wrap">{g.remediation?.gap}</div>
                <div className="flex flex-wrap items-center gap-1 text-[11px]">{['GAP_IDENTIFIED', 'REMEDIATION', 'RETRAINING', 'REASSESSMENT'].map(s => <span key={s} className={`px-2 py-0.5 rounded border ${g.remediation?.stage === s ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-500'}`}>{s.replace('_', ' ')}</span>)}</div>
                {(can.owner || canAdmin) && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setText(''); setDlg({ kind: 'remediate', gate: g }); }}>Move to next remediation stage</Button><Button size="sm" onClick={() => { setText(''); setDlg({ kind: 'remediate_finish', gate: g }); }}>Retraining done — release new attempts</Button></div>}
                {can.self && <div className="text-xs text-gray-600">You used all your attempts. Your manager, trainer and HR have been told; a retraining plan will be recorded and then a fresh set of attempts is released. Previous attempts stay on record.</div>}
              </div>
            )}

            {(g.signoffs?.length > 0 || waiting) && (
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-sm font-semibold">Sign-off {needSign[0] !== 'any' && <span className="text-xs font-normal text-gray-500">(required: {needSign.map(r => ROLE_LABEL[r] || r).join(' + ')})</span>}</div>
                {g.signoffs.map((s, i) => <div key={i} className="text-xs"><b className={s.decision === 'pass' ? 'text-green-700' : 'text-red-700'}>{s.decision === 'pass' ? 'Approved' : 'Not approved'}</b> by {s.by_name} ({ROLE_LABEL[s.role] || s.role}) · {fmtDateTime(s.at)}{s.comments ? ` — “${s.comments}”` : ''}</div>)}
                {waiting && can.owner && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => { setText(''); setDlg({ kind: 'decide', gate: g, decision: 'pass' }); }}>Sign off</Button>
                    <Button size="sm" variant="outline" onClick={() => { setText(''); setDlg({ kind: 'decide', gate: g, decision: 'fail' }); }}>Needs more work</Button>
                  </div>
                )}
                {waiting && !can.owner && <div className="text-xs text-gray-500">Waiting for {g.owner_roles.map(r => ROLE_LABEL[r] || r).join(' / ')}.</div>}
              </div>
            )}

            {(canAdmin || can.owner) && !['PASSED', 'WAIVED', 'CANCELLED', 'LOCKED'].includes(g.status) && (
              <div className="flex flex-wrap gap-2 pt-1 border-t">
                <Button size="sm" variant="ghost" className="text-purple-700" onClick={() => { setText(''); setText2(''); setDlg({ kind: 'waiver', gate: g }); }}>Request waiver</Button>
                {canAdmin && g.status !== 'BLOCKED' && <Button size="sm" variant="ghost" onClick={() => { setText(''); setDlg({ kind: 'block', gate: g }); }}>Block</Button>}
                {canAdmin && g.status === 'BLOCKED' && <Button size="sm" variant="ghost" onClick={() => run('ub' + g.gate_id, 'ld_setGateBlocked', { gate_id: g.gate_id, blocked: false }, 'Unblocked')}>Unblock</Button>}
                {canAdmin && <Button size="sm" variant="ghost" onClick={() => { setText(g.due_date); setText2(''); setDlg({ kind: 'due', gate: g }); }}>Change due date</Button>}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    );
  };

  const submitDialog = async () => {
    const d = dlg;
    let r = null;
    if (d.kind === 'decide') r = await run('dec', 'ld_decideGate', { gate_id: d.gate.gate_id, decision: d.decision, comments: text }, d.decision === 'pass' ? 'Signed off' : 'Returned for more work');
    else if (d.kind === 'stage') r = await run('stage', 'ld_advanceCompetency', { gate_id: d.gate.gate_id, competency_id: d.comp.id, stage: d.stage, note: text }, 'Competency updated');
    else if (d.kind === 'remediate') r = await run('rem', 'ld_remediate', { gate_id: d.gate.gate_id, note: text }, 'Remediation updated');
    else if (d.kind === 'remediate_finish') r = await run('rem', 'ld_remediate', { gate_id: d.gate.gate_id, note: text, finish: true }, 'Retraining recorded — fresh attempts released');
    else if (d.kind === 'block') r = await run('blk', 'ld_setGateBlocked', { gate_id: d.gate.gate_id, blocked: true, reason: text }, 'Step blocked');
    else if (d.kind === 'due') r = await run('due', 'ld_changeDueDate', { gate_id: d.gate.gate_id, due_date: text, reason: text2 }, 'Due date updated');
    else if (d.kind === 'waiver') r = await run('wv', 'ld_requestWaiver', { gate_id: d.gate.gate_id, reason: text, evidence: text2, approve_now: canAdmin && !!d.approveNow, comments: text }, d.approveNow ? 'Waiver approved' : 'Waiver requested');
    else if (d.kind === 'cancel') r = await run('cx', 'ld_cancelInduction', { reason: text }, 'Induction cancelled');
    else if (d.kind === 'restart') {
      const anchor = d.anchor || 'today';
      if (anchor === 'date' && !d.start_date) { toast.error('Choose the start date'); return; }
      setBusy('rs');
      try {
        const rr = await ld('ld_restartInduction', { induction_id: id, reason: text, anchor, start_date: anchor === 'date' ? d.start_date : undefined });
        toast.success('Induction restarted'); setDlg(null); setOpen({}); nav(`/LdInductionDetail?id=${rr.induction_id}`);
      } catch (e) { toast.error(e.message); }
      setBusy('');
      return;
    }
    else if (d.kind === 'people') r = await run('ppl', 'ld_assignPeople', people, 'People updated');
    if (r) setDlg(null);
  };

  const dlgTitle = { decide: dlg?.decision === 'pass' ? 'Sign off this step' : 'Return for more work', stage: `Move to ${dlg?.stage}`, remediate: 'Advance remediation', remediate_finish: 'Record retraining and release new attempts', block: 'Block this step', due: 'Change due date', waiver: 'Request a waiver', people: 'Assign people', cancel: 'Cancel this induction', restart: ind.status === 'CANCELLED' ? 'Start the induction again' : 'Restart this induction' }[dlg?.kind];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <Link to={v.is_employee ? '/MyLearning' : '/LdControlCentre'} className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" />Back</Link>
      <PausedBanner paused={data.paused} />
      {v.is_employee && (v.is_hr || v.is_ld) && <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-900 p-3 text-sm">This is your own induction. HR / L&amp;D steps on it can only be completed by another HR or L&amp;D admin (you cannot approve your own induction).</div>}
      <Card><CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{ind.employee.name} <span className="text-sm font-normal text-gray-500">{ind.employee.code}</span></h1>
            <div className="text-sm text-gray-600">{ind.employee.designation} · {ind.employee.department}{ind.employee.grade ? ` · Grade ${ind.employee.grade}` : ''}{ind.employee.location ? ` · ${ind.employee.location}` : ''}</div>
            <div className="text-xs text-gray-500 mt-1">Joined {fmtDate(ind.doj)} · {ind.template_name} v{ind.template_version}</div>
          </div>
          <Badge variant="outline" className={ind.status === 'COMPLETED' ? 'border-green-300 text-green-700' : ind.status === 'CANCELLED' ? 'border-gray-300 text-gray-500' : 'border-blue-300 text-blue-700'}>{ind.status.replace('_', ' ')}</Badge>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Progress</span><span>{ind.progress?.done}/{ind.progress?.total} steps · {ind.progress?.percent}%</span></div>
          <Progress value={ind.progress?.percent || 0} className="h-2" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Person label="Reporting Manager" name={ind.employee.reporting_manager_name} />
          <Person label="HOD" name={ind.hod_name} />
          <Person label="Buddy (peer)" name={ind.buddy_name} />
          <Person label="Trainer" name={ind.trainer_name} />
          <div className="flex items-end gap-2 flex-wrap">{canAdmin && ind.status !== 'COMPLETED' && <><Button size="sm" variant="outline" onClick={() => { setText(''); setDlg({ kind: 'restart' }); }}>{ind.status === 'CANCELLED' ? 'Start again' : 'Restart'}</Button>{ind.status === 'IN_PROGRESS' && <Button size="sm" variant="outline" className="text-red-700 border-red-200" onClick={() => { setText(''); setDlg({ kind: 'cancel' }); }}>Cancel induction</Button>}</>}{!v.is_employee && ind.status !== 'COMPLETED' && (canAdmin || Object.values(ind._can).some(c => c.owner)) && <Button size="sm" variant="outline" onClick={openPeopleDialog}><UserCog className="w-4 h-4 mr-1" />Assign</Button>}</div>
        </div>
      </CardContent></Card>

      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="waivers">Waivers ({data.waivers.length})</TabsTrigger>
          <TabsTrigger value="audit"><History className="w-3.5 h-3.5 mr-1" />Audit trail</TabsTrigger>
        </TabsList>
        <TabsContent value="steps" className="space-y-2">
          {ind.gates.map(gateCard)}
          {ind.status === 'COMPLETED' && <Card className="border-green-300 bg-green-50"><CardContent className="p-4 flex items-center gap-3"><Award className="w-6 h-6 text-amber-500" /><div className="text-sm"><b>Induction completed</b> on {fmtDate(ind.completed_at)}. A completion certificate has been issued.</div></CardContent></Card>}
        </TabsContent>
        <TabsContent value="waivers" className="space-y-2">
          {data.waivers.length === 0 && <div className="text-sm text-gray-500 p-4">No waivers.</div>}
          {data.waivers.map(w => (
            <Card key={w.id}><CardContent className="p-3 text-sm space-y-1">
              <div className="flex items-center justify-between"><b>{w.gate_id} · {w.gate_name}</b><Badge variant="outline" className={w.status === 'APPROVED' ? 'border-green-300 text-green-700' : w.status === 'REJECTED' ? 'border-red-300 text-red-700' : 'border-amber-300 text-amber-700'}>{w.status}</Badge></div>
              <div className="text-gray-600">Reason: {w.reason}</div>{w.evidence && <div className="text-gray-600">Evidence: {w.evidence}</div>}
              <div className="text-xs text-gray-500">Requested by {w.requester_name} · {fmtDateTime(w.created_at)}{w.approver_name ? ` · decided by ${w.approver_name} ${fmtDateTime(w.decided_at)} — “${w.comments}”` : ''}</div>
              {w.status === 'PENDING' && canAdmin && <div className="flex gap-2 pt-1"><Button size="sm" onClick={() => { setText(''); setDlg({ kind: 'decideWaiver', waiver: w, decision: 'approve' }); }}>Approve</Button><Button size="sm" variant="outline" onClick={() => { setText(''); setDlg({ kind: 'decideWaiver', waiver: w, decision: 'reject' }); }}>Reject</Button></div>}
            </CardContent></Card>
          ))}
        </TabsContent>
        <TabsContent value="audit">
          <Card><CardContent className="p-3 space-y-1.5">
            {data.audit.length === 0 && <div className="text-sm text-gray-500">No activity yet.</div>}
            {data.audit.map(a => <div key={a.id} className="text-xs flex gap-3 border-b last:border-0 pb-1.5"><span className="text-gray-400 w-32 shrink-0">{fmtDateTime(a.at)}</span><span className="font-medium w-40 shrink-0">{a.action.replace(/_/g, ' ')}</span><span className="text-gray-600">{a.actor_name}{a.details?.gate ? ` · ${a.details.gate}` : ''}{a.details?.comments ? ` — ${a.details.comments}` : ''}{a.details?.score != null ? ` — ${a.details.score}%` : ''}</span></div>)}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!dlg && dlg.kind !== 'decideWaiver'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlgTitle}{dlg?.gate ? ` — ${dlg.gate.name}` : ''}</DialogTitle></DialogHeader>
          {dlg?.kind === 'people' ? (
            <div className="space-y-3">
              {[['buddy_user_id', 'Buddy (a peer — not the Reporting Manager)'], ['trainer_user_id', 'Trainer'], ['hod_user_id', 'HOD / Department SPOC'], ['hr_spoc_user_id', 'HR SPOC']].map(([k, l]) => (
                <label key={k} className="block text-xs text-gray-600">{l}
                  <select className="mt-1 w-full h-9 rounded-md border bg-white px-2 text-sm" value={people[k] || ''} onChange={e => setPeople(p => ({ ...p, [k]: e.target.value }))}>
                    <option value="">— none —</option>
                    {emps.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name} · {e.department || ''}</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : dlg?.kind === 'cancel' ? (
            <div className="space-y-2"><p className="text-xs text-gray-500">The employee's induction is stopped and all open steps are cancelled. The record and audit trail are kept; you can start a new one later.</p><Textarea placeholder="Reason (required)" value={text} onChange={e => setText(e.target.value)} /></div>
          ) : dlg?.kind === 'restart' ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">{ind.status === 'CANCELLED' ? 'Starts a fresh induction for this employee.' : 'The current induction is cancelled (history kept) and a fresh one starts from step 1. Buddy and trainer are carried over.'}</p>
              {ind.status !== 'CANCELLED' && <Textarea placeholder="Reason (required)" value={text} onChange={e => setText(e.target.value)} />}
              <div className="text-xs text-gray-600">Count due dates from</div>
              {[['today', 'Today'], ['joining', 'Joining date (if recent)'], ['date', 'A date I choose']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="rsanchor" checked={(dlg.anchor || 'today') === k} onChange={() => setDlg(d => ({ ...d, anchor: k }))} />{l}</label>
              ))}
              {dlg.anchor === 'date' && <Input type="date" value={dlg.start_date || ''} onChange={e => setDlg(d => ({ ...d, start_date: e.target.value }))} />}
            </div>
          ) : dlg?.kind === 'due' ? (
            <div className="space-y-2"><Input type="date" value={text} onChange={e => setText(e.target.value)} /><Textarea placeholder="Reason for the change" value={text2} onChange={e => setText2(e.target.value)} /></div>
          ) : dlg?.kind === 'waiver' ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">A mandatory step can only be waived with a recorded reason and evidence, approved by authorised HR / L&D.</p>
              <Textarea placeholder="Reason (required)" value={text} onChange={e => setText(e.target.value)} />
              <Textarea placeholder="Evidence / reference" value={text2} onChange={e => setText2(e.target.value)} />
              {canAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!dlg.approveNow} onChange={e => setDlg(d => ({ ...d, approveNow: e.target.checked }))} /> I am authorised — approve it now</label>}
            </div>
          ) : (
            <Textarea placeholder={dlg?.kind === 'decide' ? (dlg.decision === 'pass' ? 'Comments (optional)' : 'What is the gap? (required)') : dlg?.kind === 'stage' ? 'Evidence / observation (what did you see?)' : 'Note'} value={text} onChange={e => setText(e.target.value)} />
          )}
          <Button onClick={submitDialog} disabled={!!busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.kind === 'decideWaiver'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlg?.decision === 'approve' ? 'Approve' : 'Reject'} waiver</DialogTitle></DialogHeader>
          <Textarea placeholder="Comments (required)" value={text} onChange={e => setText(e.target.value)} />
          <Button onClick={async () => { const r = await run('dw', 'ld_decideWaiver', { waiver_id: dlg.waiver.id, decision: dlg.decision, comments: text }, 'Waiver ' + (dlg.decision === 'approve' ? 'approved' : 'rejected')); if (r) setDlg(null); }}>Confirm</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
