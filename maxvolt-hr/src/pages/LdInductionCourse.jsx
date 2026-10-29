import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, BookOpen, CheckCircle2, XCircle, PauseCircle, ClipboardCheck, ArrowRight, ArrowLeft, RotateCcw, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld } from '@/lib/ld';
import { mmss, useWatchClock } from '@/lib/ldTime';

const TONES = {
  yellow: 'border-yellow-300 bg-yellow-50 text-yellow-950',
  green: 'border-green-300 bg-green-50 text-green-950',
  red: 'border-red-300 bg-red-50 text-red-950',
};

// ── lesson blocks ──────────────────────────────────────────────────────────
function Block({ b }) {
  switch (b.t) {
    case 'p': return <p className="text-sm sm:text-[15px] leading-relaxed text-gray-800">{b.text}</p>;
    case 'list': return <ul className="list-disc pl-5 space-y-2 text-sm text-gray-800 break-words">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
    case 'chips': return <div className="flex flex-wrap gap-2">{b.items.map(x => <span key={x} className="px-3 py-1.5 rounded-full bg-gray-900 text-yellow-300 text-xs sm:text-sm font-medium">{x}</span>)}</div>;
    case 'stats': return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {b.items.map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-white px-3 py-3 min-w-0">
            {v ? <><div className="text-lg sm:text-xl font-bold text-gray-900 break-words leading-tight">{v}</div><div className="text-xs text-gray-500 mt-0.5">{k}</div></> : <div className="text-sm font-semibold text-gray-900">{k}</div>}
          </div>
        ))}
      </div>
    );
    case 'cards': return (
      <div className={`grid gap-3 ${b.cols === 1 ? 'grid-cols-1' : b.cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : b.cols === 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {b.items.map((c, i) => (
          <div key={i} className="rounded-xl border bg-white p-3 sm:p-4 border-l-4 border-l-yellow-400 min-w-0">
            {c.tag && <span className="inline-block text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded bg-gray-900 text-yellow-300 mb-1.5">{c.tag}</span>}
            <div className="font-semibold text-gray-900 text-sm break-words">{c.title}</div>
            {c.text && <p className="text-sm text-gray-700 mt-1 break-words">{c.text}</p>}
          </div>
        ))}
      </div>
    );
    case 'table': return (
      <div className="rounded-xl border overflow-hidden bg-white">
        <div className="grid grid-cols-[34%_66%] sm:grid-cols-[28%_72%] bg-gray-900 text-white text-xs sm:text-sm font-semibold"><div className="px-3 py-2 bg-yellow-400 text-gray-900">{b.head[0]}</div><div className="px-3 py-2">{b.head[1]}</div></div>
        {b.rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[34%_66%] sm:grid-cols-[28%_72%] border-t text-sm"><div className="px-3 py-2.5 font-semibold text-gray-900 bg-gray-50 break-words">{r[0]}</div><div className="px-3 py-2.5 text-gray-800 break-words">{r[1]}</div></div>
        ))}
      </div>
    );
    case 'timeline': return (
      <ol className="relative border-l-2 border-yellow-400 ml-3 space-y-3">
        {b.items.map((x, i) => (
          <li key={i} className="pl-5 relative">
            <span className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-yellow-400 border-2 border-white" />
            <span className="inline-block text-xs font-bold px-2 py-0.5 rounded bg-gray-900 text-yellow-300 mr-2">{x.label}</span>
            <span className="text-sm text-gray-800">{x.text}</span>
          </li>
        ))}
      </ol>
    );
    case 'steps': return (
      <ol className="space-y-2">
        {b.items.map((x, i) => (
          <li key={i} className="flex items-start gap-3 rounded-xl border bg-white p-3">
            <span className="w-7 h-7 shrink-0 rounded-full bg-yellow-400 text-gray-900 font-bold text-sm flex items-center justify-center">{i + 1}</span>
            <div className="min-w-0"><div className="font-semibold text-sm text-gray-900">{x.title}</div>{x.text && <div className="text-sm text-gray-700 break-words">{x.text}</div>}</div>
          </li>
        ))}
      </ol>
    );
    case 'people': return (
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {b.items.map(x => (
          <div key={x.name} className="rounded-xl border bg-white overflow-hidden min-w-0">
            <img src={x.photo_src} alt={x.name} loading="lazy" className="w-full aspect-square object-cover object-top bg-gray-100" />
            <div className="p-3"><div className="font-semibold text-sm text-gray-900">{x.name}</div><div className="text-xs text-blue-800 font-medium mt-0.5">{x.role}</div><div className="text-xs text-gray-600 mt-1">{x.focus}</div></div>
          </div>
        ))}
      </div>
    );
    case 'callout': return (
      <div className={`rounded-xl border-l-4 border p-3 sm:p-4 ${TONES[b.tone] || TONES.yellow}`}>
        {b.title && <div className="font-bold text-sm mb-1">{b.title}</div>}
        <p className="text-sm leading-relaxed">{b.text}</p>
      </div>
    );
    case 'images': return (
      <div className={`grid gap-3 ${b.items.length === 1 ? 'grid-cols-1' : b.items.length === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {b.items.map(m => (
          <figure key={m.src} className="rounded-xl border bg-white overflow-hidden">
            <img src={m.src} alt={m.caption} loading="lazy" className={`w-full object-contain bg-white ${b.items.length === 1 ? 'max-h-72' : 'h-32 sm:h-40'}`} />
            <figcaption className="px-2 py-1 text-[11px] text-gray-500 border-t">{m.caption}</figcaption>
          </figure>
        ))}
      </div>
    );
    default: return null;
  }
}

// Step C1 of the induction: the whole Maxvolt induction deck taught as 13 lessons (one at a time), then a quiz.
// HR / L&D can open the page without an induction id to preview the lessons.
export default function LdInductionCourse() {
  const [sp] = useSearchParams();
  const id = sp.get('id');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [cur, setCur] = useState(0);
  const [seen, setSeen] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(`ld-course-seen-${id || 'preview'}`) || '[]')); } catch { return new Set(); } });
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const top = useRef(null);

  const load = useCallback(() => ld('ld_getCourse', id ? { induction_id: id } : {}).then(setD).catch(e => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSeen(prev => { const n = new Set(prev); n.add(cur); try { localStorage.setItem(`ld-course-seen-${id || 'preview'}`, JSON.stringify([...n])); } catch { /* storage unavailable */ } return n; });
  }, [cur, id]);

  const g = d?.gate;
  const open = !!g && ['READY', 'IN_PROGRESS', 'OVERDUE'].includes(g.status);
  const study = d?.study;
  const enabled = !!d?.is_self && open && !!study && !study.done && !d?.paused;
  const clock = useWatchClock({
    enabled, startSeconds: study?.seconds || 0,
    send: (visible) => ld('ld_trackTime', { induction_id: id, gate_id: 'C1', task_id: study.task_id, visible }),
    onDone: () => load(),
  });

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!d) return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;

  const mods = d.modules;
  const m = mods[cur];
  const studyDone = !!study?.done || clock.done;
  const quizDone = !!d.quiz?.done;
  const target = study?.target || d.study_seconds || 900;
  const secs = studyDone ? target : Math.min(clock.seconds, target);
  const pct = Math.min(100, Math.round((secs / target) * 100));
  const allSeen = mods.every((_, i) => seen.has(i));
  const next = id ? `${createPageUrl('LdProductTraining')}?id=${id}` : null;
  const go = (i) => { setCur(i); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };

  const start = async () => {
    setBusy(true); setResult(null); setAnswers({});
    try { setQuiz(await ld('ld_startCourseQuiz', { induction_id: id })); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await ld('ld_submitCourseQuiz', { quiz_id: quiz.quiz_id, answers });
      setResult(r.result); setQuiz(q => ({ ...q, submitted: true }));
      if (r.result.passed) toast.success(`Passed with ${r.result.score}%`); else toast.error(`Scored ${r.result.score}% — revise the lessons and try again`);
      load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const answered = quiz ? quiz.questions.every(q => answers[q.id] !== undefined) : false;

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-4xl mx-auto space-y-3 sm:space-y-4 overflow-x-hidden">
      <div ref={top} className="flex flex-wrap items-center gap-3 scroll-mt-16">
        <BookOpen className="w-5 h-5 text-blue-600" />
        <h1 className="text-lg sm:text-xl font-bold text-gray-900 min-w-0 flex-1 sm:flex-none">Maxvolt induction course</h1>
        <Link to={id ? createPageUrl('MyLearning') : createPageUrl('LdControlCentre')} className="sm:ml-auto text-sm text-blue-700 hover:underline">{id ? '← My Learning' : '← Control Centre'}</Link>
      </div>
      {!id && <div className="text-sm bg-blue-50 border border-blue-200 rounded p-2 text-blue-900">Preview — this is what a new joiner learns. Content: Final Induction Deck, last reviewed {d.updated}; edit it in <code>backend/utils/ldCourse.js</code>.</div>}
      {g && g.status === 'LOCKED' && <div className="text-sm bg-gray-50 border rounded p-3 text-gray-700">This course opens after the website tour.</div>}

      {d.is_self && g && !studyDone && open && (
        <div className="sticky top-0 z-10 rounded-lg border bg-white p-3 space-y-1.5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2.5 rounded-full bg-gray-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{mmss(secs)} / {mmss(target)}</div>
          </div>
          <div className="text-xs text-gray-600">Go through all 13 lessons. The quiz unlocks after {mmss(target)} of study and once you have opened every lesson — time counts only while this page is open and in front{enabled && !clock.active ? ' (paused now — come back to this tab)' : ''}.</div>
        </div>
      )}
      {d.is_self && studyDone && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded p-2.5 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" />Study time complete{allSeen ? '' : ' — open the remaining lessons to unlock the quiz'}.</div>}

      <nav className="flex gap-1.5 text-xs overflow-x-auto -mx-3 px-3 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible" aria-label="Lessons">
        {mods.map((x, i) => (
          <button key={x.id} type="button" onClick={() => go(i)} className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full whitespace-nowrap border ${i === cur ? 'bg-gray-900 text-yellow-300 border-gray-900' : seen.has(i) ? 'bg-green-50 text-green-800 border-green-200' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-blue-100'}`}>
            {seen.has(i) && i !== cur ? <Check className="w-3 h-3" /> : <span className="font-bold">{x.no}</span>}{x.title}
          </button>
        ))}
      </nav>

      <article className="rounded-2xl border bg-white p-3 sm:p-5 space-y-4">
        <header className="border-b pb-3">
          <div className="text-xs font-bold tracking-widest text-yellow-600 uppercase">Lesson {m.no} of {mods.length}</div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 mt-0.5 break-words">{m.title}</h2>
          <p className="text-sm text-gray-500">{m.subtitle}</p>
        </header>
        {m.blocks.map((b, i) => <Block key={i} b={b} />)}
        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" disabled={cur === 0} onClick={() => go(cur - 1)}><ArrowLeft className="w-4 h-4 mr-1" />Previous</Button>
          <span className="text-xs text-gray-500">{cur + 1} / {mods.length}</span>
          {cur < mods.length - 1 ? <Button size="sm" onClick={() => go(cur + 1)}>Next lesson<ArrowRight className="w-4 h-4 ml-1" /></Button> : <Button size="sm" variant="outline" onClick={() => document.getElementById('course-quiz')?.scrollIntoView({ behavior: 'smooth' })}>Go to the quiz</Button>}
        </div>
      </article>

      {d.is_self && g && (
        <div id="course-quiz" className="rounded-xl border bg-white p-3 sm:p-4 space-y-3 scroll-mt-16">
          <div className="flex flex-wrap items-center gap-2"><ClipboardCheck className="w-5 h-5 text-blue-600" /><h2 className="font-semibold text-gray-900">Induction course quiz</h2><span className="text-xs text-gray-500">{d.questions} questions from all 13 lessons · pass mark {d.pass_score}% · you can retake it — each attempt is a new quiz{d.quiz?.attempts ? ` · attempts so far: ${d.quiz.attempts}` : ''}</span></div>
          {quizDone && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3"><CheckCircle2 className="w-5 h-5" />Quiz passed. The induction course is complete.
              {next && <Link to={next} className="sm:ml-auto"><Button size="sm">Continue to our products <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}</div>
          )}
          {!quizDone && !studyDone && <p className="text-sm text-gray-600">The quiz opens after {mmss(target)} of study.</p>}
          {!quizDone && studyDone && !allSeen && <p className="text-sm text-amber-800">Open every lesson (the chips above turn green) to unlock the quiz — {mods.filter((_, i) => !seen.has(i)).length} left.</p>}
          {!quizDone && studyDone && allSeen && !quiz && <Button className="w-full sm:w-auto" onClick={start} disabled={busy || !open}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Start quiz</Button>}
          {!quizDone && quiz && !result && (
            <div className="space-y-4">
              {quiz.questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2"><span className="text-sm font-semibold text-gray-500">{i + 1}.</span><div className="text-sm font-medium text-gray-900">{q.text}</div></div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{q.options.map((o, oi) => (
                    <label key={oi} className={`flex items-start gap-2 rounded-md border px-3 py-3 sm:py-2 text-sm cursor-pointer ${answers[q.id] === oi ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'}`}><input type="radio" className="mt-0.5 shrink-0" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers(a => ({ ...a, [q.id]: oi }))} />{o}</label>
                  ))}</div>
                </div>
              ))}
              <Button className="w-full sm:w-auto" onClick={submit} disabled={!answered || busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Submit answers</Button>
              {!answered && <span className="block sm:inline sm:ml-3 mt-1 text-xs text-gray-500">Answer all {quiz.questions.length} questions.</span>}
            </div>
          )}
          {result && (
            <div className="space-y-3">
              <div className={`rounded p-3 text-sm flex items-center gap-2 ${result.passed ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                {result.passed ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}You scored <b>{result.score}%</b> ({result.right} of {result.total}). {result.passed ? 'Passed.' : `Pass mark is ${result.pass_score}%. Go through the lessons again and retake.`}
              </div>
              {quiz && result.results.map((r, i) => !r.ok && (
                <div key={r.id} className="text-sm rounded border p-2"><span className="text-gray-500">{i + 1}. {quiz.questions[i]?.text}</span><div>Your answer: <span className="text-red-700">{r.picked == null ? '—' : quiz.questions[i]?.options[r.picked]}</span> · Correct: <span className="text-green-700 font-medium">{r.correct_text}</span></div></div>
              ))}
              {!result.passed && <Button variant="outline" onClick={() => { setQuiz(null); setResult(null); setAnswers({}); go(0); }}><RotateCcw className="w-4 h-4 mr-1.5" />Study again, then retake</Button>}
              {result.passed && next && <Link to={next}><Button className="w-full sm:w-auto">Continue to our products <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}
            </div>
          )}
        </div>
      )}
      {d.paused && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 flex items-center gap-2"><PauseCircle className="w-4 h-4" />Induction training is paused by HR.</div>}
    </div>
  );
}
