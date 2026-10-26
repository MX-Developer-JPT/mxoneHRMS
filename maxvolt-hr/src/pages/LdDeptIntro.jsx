import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, Building2, CheckCircle2, XCircle, PauseCircle, ClipboardCheck, ArrowRight, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld } from '@/lib/ld';
import { mmss, useWatchClock } from '@/lib/ldTime';
import OrgChartView from '@/components/ld/OrgChartView';

const LVL = { top: ['Top level', 'bg-blue-700 text-white'], middle: ['Middle level', 'bg-teal-600 text-white'], team: ['Team', 'bg-gray-200 text-gray-700'] };

// Department introduction: study the department org chart (Management at the top, their direct reports in the middle),
// then answer a quiz made from it. HR / L&D can also open any department's chart (preview).
export default function LdDeptIntro() {
  const [sp] = useSearchParams();
  const id = sp.get('id'), dept = sp.get('dept');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [quiz, setQuiz] = useState(null);       // { quiz_id, questions, attempt_no }
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => ld('ld_getOrgIntro', id ? { induction_id: id } : { department: dept }).then(setD).catch(e => setErr(e.message)), [id, dept]);
  useEffect(() => { load(); }, [load]);

  const g = d?.gate;
  const open = !!g && ['READY', 'IN_PROGRESS', 'OVERDUE'].includes(g.status);
  const viewTask = d?.view;
  const enabled = !!d?.is_self && open && !!viewTask && !viewTask.done;
  const clock = useWatchClock({
    enabled, startSeconds: viewTask?.seconds || 0,
    send: (visible) => ld('ld_trackTime', { induction_id: id, gate_id: 'D1', task_id: viewTask.task_id, visible }),
    onDone: () => load(),
  });

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!d) return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;

  const viewDone = !!viewTask?.done || clock.done;
  const quizDone = !!d.quiz?.done;
  const target = viewTask?.target || 120;
  const secs = viewDone ? target : Math.min(clock.seconds, target);
  const noChart = d.org.counts.total === 0;
  const next = id ? `${createPageUrl('LdInductionDetail')}?id=${id}` : null;

  const start = async () => {
    setBusy(true); setResult(null); setAnswers({});
    try { setQuiz(await ld('ld_startOrgQuiz', { induction_id: id })); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await ld('ld_submitOrgQuiz', { quiz_id: quiz.quiz_id, answers });
      setResult(r.result); setQuiz(q => ({ ...q, submitted: true }));
      if (r.result.passed) toast.success(`Passed with ${r.result.score}%`); else toast.error(`Scored ${r.result.score}% — review the chart and try again`);
      load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const answered = quiz ? quiz.questions.every(q => answers[q.id] !== undefined) : false;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Building2 className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Your department — {d.department || 'not set'}</h1>
        <Link to={id ? createPageUrl('MyLearning') : createPageUrl('LdControlCentre')} className="ml-auto text-sm text-blue-700 hover:underline">{id ? '← My Learning' : '← Control Centre'}</Link>
      </div>
      {!id && <div className="text-sm bg-blue-50 border border-blue-200 rounded p-2 text-blue-900">Preview — this is what a new joiner in this department sees.</div>}
      {g && g.status === 'LOCKED' && <div className="text-sm bg-gray-50 border rounded p-3 text-gray-700">This step opens after the HR policies are signed.</div>}
      {noChart && <div className="text-sm bg-amber-50 border border-amber-200 rounded p-3 text-amber-900">{d.department ? 'No other active employees are recorded in this department yet.' : 'Your department is not set in Maxvolt One yet — please ask HR to update your profile. HR will sign this step off.'}</div>}

      {!noChart && (
        <>
          <div className="rounded-xl border bg-blue-50/60 p-3 text-sm text-gray-800">
            <b>Know these people first.</b> The <span className="font-semibold text-blue-800">top level</span> is Maxvolt&apos;s Management; the <span className="font-semibold text-teal-700">middle level</span> are the leaders of your department who report directly to Management. Learn their names, designations and who reports to whom — then everyone else in your team.
            {d.is_self && !viewDone && open && <span className="block mt-1 text-gray-600">Study the chart for {mmss(target)} to unlock the quiz — time counts while this page is in front: <b className="tabular-nums">{mmss(secs)} / {mmss(target)}</b>{!clock.active && ' (paused)'}.</span>}
          </div>
          <OrgChartView org={d.org} />
        </>
      )}

      {d.is_self && !noChart && g && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2"><ClipboardCheck className="w-5 h-5 text-blue-600" /><h2 className="font-semibold text-gray-900">Org chart quiz</h2><span className="text-xs text-gray-500">{d.questions} questions · pass mark {d.pass_score}% · you can retake it — each attempt is a new quiz{d.quiz?.attempts ? ` · attempts so far: ${d.quiz.attempts}` : ''}</span></div>
          {quizDone && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3"><CheckCircle2 className="w-5 h-5" />Quiz passed. Your department introduction is complete.
              {next && <Link to={next} className="ml-auto"><Button size="sm">Back to my induction <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}</div>
          )}
          {!quizDone && !viewDone && <p className="text-sm text-gray-600">The quiz opens after you have studied the chart for {mmss(target)}.</p>}
          {!quizDone && viewDone && !quiz && <Button onClick={start} disabled={busy || !open}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Start quiz</Button>}
          {!quizDone && quiz && !result && (
            <div className="space-y-4">
              {quiz.questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2"><span className="text-sm font-semibold text-gray-500">{i + 1}.</span><div className="flex-1"><div className="text-sm font-medium text-gray-900">{q.text}</div></div><span className={`text-[10px] px-2 py-0.5 rounded-full ${LVL[q.level]?.[1] || ''}`}>{LVL[q.level]?.[0]}</span></div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{q.options.map((o, oi) => (
                    <label key={oi} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${answers[q.id] === oi ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'}`}><input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers(a => ({ ...a, [q.id]: oi }))} />{o}</label>
                  ))}</div>
                </div>
              ))}
              <Button onClick={submit} disabled={!answered || busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Submit answers</Button>
              {!answered && <span className="ml-3 text-xs text-gray-500">Answer all {quiz.questions.length} questions.</span>}
            </div>
          )}
          {result && (
            <div className="space-y-3">
              <div className={`rounded p-3 text-sm flex items-center gap-2 ${result.passed ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                {result.passed ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}You scored <b>{result.score}%</b> ({result.right} of {result.total}). {result.passed ? 'Passed.' : `Pass mark is ${result.pass_score}%. Look at the chart again and retake.`}
              </div>
              {quiz && result.results.map((r, i) => !r.ok && (
                <div key={r.id} className="text-sm rounded border p-2"><span className="text-gray-500">{i + 1}. {quiz.questions[i]?.text}</span><div>Your answer: <span className="text-red-700">{r.picked == null ? '—' : quiz.questions[i]?.options[r.picked]}</span> · Correct: <span className="text-green-700 font-medium">{r.correct_text}</span></div></div>
              ))}
              {!result.passed && <Button variant="outline" onClick={() => { setQuiz(null); setResult(null); setAnswers({}); }}><RotateCcw className="w-4 h-4 mr-1.5" />Study again, then retake</Button>}
              {result.passed && next && <Link to={next}><Button>Back to my induction <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}
            </div>
          )}
        </div>
      )}
      {d.paused && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 flex items-center gap-2"><PauseCircle className="w-4 h-4" />Induction training is paused by HR.</div>}
    </div>
  );
}
