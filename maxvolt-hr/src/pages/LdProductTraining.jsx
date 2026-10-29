import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, Package, CheckCircle2, XCircle, PauseCircle, ClipboardCheck, ArrowRight, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld } from '@/lib/ld';
import { mmss, useWatchClock } from '@/lib/ldTime';

// Step W2 of the induction: learn what Maxvolt makes and who it serves (products, services, segments), then a short quiz.
// HR / L&D can open the page without an induction id to preview the material.
export default function LdProductTraining() {
  const [sp] = useSearchParams();
  const id = sp.get('id');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [quiz, setQuiz] = useState(null);       // { quiz_id, questions, attempt_no }
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => ld('ld_getProductTraining', id ? { induction_id: id } : {}).then(setD).catch(e => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const g = d?.gate;
  const open = !!g && ['READY', 'IN_PROGRESS', 'OVERDUE'].includes(g.status);
  const study = d?.study;
  const enabled = !!d?.is_self && open && !!study && !study.done && !d?.paused;
  const clock = useWatchClock({
    enabled, startSeconds: study?.seconds || 0,
    send: (visible) => ld('ld_trackTime', { induction_id: id, gate_id: 'W2', task_id: study.task_id, visible }),
    onDone: () => load(),
  });

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!d) return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;

  const studyDone = !!study?.done || clock.done;
  const quizDone = !!d.quiz?.done;
  const target = study?.target || d.study_seconds || 480;
  const secs = studyDone ? target : Math.min(clock.seconds, target);
  const pct = Math.min(100, Math.round((secs / target) * 100));
  const next = id ? `${createPageUrl('LdPolicyReader')}?id=${id}` : null;

  const start = async () => {
    setBusy(true); setResult(null); setAnswers({});
    try { setQuiz(await ld('ld_startProductQuiz', { induction_id: id })); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await ld('ld_submitProductQuiz', { quiz_id: quiz.quiz_id, answers });
      setResult(r.result); setQuiz(q => ({ ...q, submitted: true }));
      if (r.result.passed) toast.success(`Passed with ${r.result.score}%`); else toast.error(`Scored ${r.result.score}% — revise the material and try again`);
      load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const answered = quiz ? quiz.questions.every(q => answers[q.id] !== undefined) : false;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Package className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Know our products, services and segments</h1>
        <Link to={id ? createPageUrl('MyLearning') : createPageUrl('LdControlCentre')} className="ml-auto text-sm text-blue-700 hover:underline">{id ? '← My Learning' : '← Control Centre'}</Link>
      </div>
      {!id && <div className="text-sm bg-blue-50 border border-blue-200 rounded p-2 text-blue-900">Preview — this is the material and quiz a new joiner sees. Content last reviewed {d.updated}; update it in <code>backend/utils/ldProducts.js</code> when the catalogue changes.</div>}
      {g && g.status === 'LOCKED' && <div className="text-sm bg-gray-50 border rounded p-3 text-gray-700">This step opens after the website tour.</div>}

      {d.is_self && g && !studyDone && open && (
        <div className="sticky top-0 z-10 rounded-lg border bg-white p-3 space-y-1.5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2.5 rounded-full bg-gray-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{mmss(secs)} / {mmss(target)}</div>
          </div>
          <div className="text-xs text-gray-600">Read each section below. The quiz unlocks after {mmss(target)} — time counts only while this page is open and in front{enabled && !clock.active ? ' (paused now — come back to this tab)' : ''}.</div>
        </div>
      )}
      {d.is_self && studyDone && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded p-2.5 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Study time complete — you can revisit any section while you take the quiz.</div>}

      <nav className="flex flex-wrap gap-1.5 text-xs">
        {d.sections.map(s => <a key={s.id} href={`#sec-${s.id}`} className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-blue-100">{s.title.split(' — ')[0]}</a>)}
      </nav>

      <div className="space-y-4">
        {d.sections.map((s, i) => (
          <section key={s.id} id={`sec-${s.id}`} className="rounded-xl border bg-white p-4 md:p-5 scroll-mt-20">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 shrink-0 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900">{s.title}</h2>
                <p className="text-sm text-gray-700 mt-1">{s.intro}</p>
              </div>
            </div>
            {s.images?.length > 0 && (
              <div className="mt-3 grid gap-3 grid-cols-2 md:grid-cols-3">
                {s.images.map(m => (
                  <figure key={m.src} className="rounded-lg border bg-gray-50 overflow-hidden">
                    <img src={m.src} alt={m.caption} loading="lazy" className="w-full h-40 md:h-44 object-contain bg-white" />
                    <figcaption className="px-2 py-1 text-[11px] text-gray-500 border-t">{m.caption}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {s.facts?.length > 0 && (
              <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                {s.facts.map(([k, v]) => <div key={k} className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-blue-700">{k}</div><div className="text-sm font-medium text-gray-900">{v}</div></div>)}
              </div>
            )}
            <ul className="mt-3 space-y-1.5 text-sm text-gray-800 list-disc pl-5">{s.points.map((p, pi) => <li key={pi}>{p}</li>)}</ul>
          </section>
        ))}
      </div>

      {d.is_self && g && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2"><ClipboardCheck className="w-5 h-5 text-blue-600" /><h2 className="font-semibold text-gray-900">Product knowledge quiz</h2><span className="text-xs text-gray-500">{d.questions} questions · pass mark {d.pass_score}% · you can retake it — each attempt is a new quiz{d.quiz?.attempts ? ` · attempts so far: ${d.quiz.attempts}` : ''}</span></div>
          {quizDone && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3"><CheckCircle2 className="w-5 h-5" />Quiz passed. This step is complete.
              {next && <Link to={next} className="ml-auto"><Button size="sm">Continue to HR policies <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}</div>
          )}
          {!quizDone && !studyDone && <p className="text-sm text-gray-600">The quiz opens after you have studied the material for {mmss(target)}.</p>}
          {!quizDone && studyDone && !quiz && <Button onClick={start} disabled={busy || !open}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Start quiz</Button>}
          {!quizDone && quiz && !result && (
            <div className="space-y-4">
              {quiz.questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2"><span className="text-sm font-semibold text-gray-500">{i + 1}.</span><div className="text-sm font-medium text-gray-900">{q.text}</div></div>
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
                {result.passed ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}You scored <b>{result.score}%</b> ({result.right} of {result.total}). {result.passed ? 'Passed.' : `Pass mark is ${result.pass_score}%. Read the material again and retake.`}
              </div>
              {quiz && result.results.map((r, i) => !r.ok && (
                <div key={r.id} className="text-sm rounded border p-2"><span className="text-gray-500">{i + 1}. {quiz.questions[i]?.text}</span><div>Your answer: <span className="text-red-700">{r.picked == null ? '—' : quiz.questions[i]?.options[r.picked]}</span> · Correct: <span className="text-green-700 font-medium">{r.correct_text}</span></div></div>
              ))}
              {!result.passed && <Button variant="outline" onClick={() => { setQuiz(null); setResult(null); setAnswers({}); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><RotateCcw className="w-4 h-4 mr-1.5" />Study again, then retake</Button>}
              {result.passed && next && <Link to={next}><Button>Continue to HR policies <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}
            </div>
          )}
        </div>
      )}
      {d.paused && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 flex items-center gap-2"><PauseCircle className="w-4 h-4" />Induction training is paused by HR.</div>}
    </div>
  );
}
