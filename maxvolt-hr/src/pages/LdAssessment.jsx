import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, Timer, CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { ld } from '@/lib/ld';

const TYPE_HINT = { mcq: 'Choose one', multi: 'Choose all that apply', truefalse: 'True or false', short: 'Type your answer' };

export default function LdAssessment() {
  const [params] = useSearchParams();
  const induction_id = params.get('induction_id');
  const gate_id = params.get('gate_id');
  const assignment_id = params.get('assignment_id');
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(null);
  const submittedRef = useRef(false);

  const start = async () => {
    setBusy(true);
    try { setAttempt(await ld('ld_startAttempt', { induction_id, gate_id, assignment_id })); setAnswers({}); setResult(null); submittedRef.current = false; }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const submit = async (auto = false) => {
    if (submittedRef.current || !attempt) return;
    submittedRef.current = true;
    setBusy(true);
    try { const r = await ld('ld_submitAttempt', { attempt_id: attempt.attempt_id, answers }); setResult(r.result); if (auto) toast.info('Time is up — your answers were submitted.'); }
    catch (e) { toast.error(e.message); submittedRef.current = false; }
    setBusy(false);
  };

  useEffect(() => {
    if (!attempt?.expires_at || result) return;
    const end = Date.parse(attempt.expires_at) - 60000; // the server allows one extra minute of grace
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) { clearInterval(t); submit(true); }
    }, 1000);
    return () => clearInterval(t);
  }, [attempt, result]);  

  const set = (id, v) => setAnswers(a => ({ ...a, [id]: v }));
  const toggle = (id, i) => setAnswers(a => { const cur = Array.isArray(a[id]) ? a[id] : []; return { ...a, [id]: cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i] }; });
  const back = induction_id ? `/LdInductionDetail?id=${induction_id}` : '/MyLearning';

  if (result) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <Card className={result.passed ? 'border-green-300' : 'border-red-300'}><CardContent className="p-6 text-center space-y-3">
          {result.passed ? <CheckCircle2 className="w-14 h-14 text-green-600 mx-auto" /> : <XCircle className="w-14 h-14 text-red-600 mx-auto" />}
          <h1 className="text-2xl font-bold">{result.passed ? 'Passed 🎉' : 'Not passed this time'}</h1>
          <div className="text-4xl font-extrabold">{result.score}%</div>
          <div className="text-sm text-gray-600">Pass mark {result.pass_score}%{result.attempt_no ? ` · attempt ${result.attempt_no}` : ''}</div>
          {!result.passed && result.gaps?.length > 0 && (
            <div className="text-left bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-sm font-semibold text-red-800 mb-1">Topics to revisit</div>
              <ul className="text-xs text-red-700 list-disc pl-4 space-y-0.5">{result.gaps.slice(0, 12).map((g, i) => <li key={i}>{g}</li>)}</ul>
              <div className="text-xs text-gray-600 mt-2">Your trainer / HR has been told. They will arrange retraining and then reopen the assessment for you.</div>
            </div>
          )}
          <Link to={back}><Button>Back to my induction</Button></Link>
        </CardContent></Card>
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <Card><CardContent className="p-6 space-y-4 text-center">
          <ClipboardCheck className="w-12 h-12 text-blue-600 mx-auto" />
          <h1 className="text-xl font-bold">Knowledge assessment</h1>
          <ul className="text-sm text-gray-600 text-left list-disc pl-6 space-y-1">
            <li>Questions cover the company, business, safety, HR policy and Maxvolt One.</li>
            <li>The pass mark is shown with your result; every attempt is recorded.</li>
            <li>Once started, a time limit may apply — your answers are submitted automatically when it ends.</li>
            <li>Do not refresh or leave the page while answering.</li>
          </ul>
          <Button onClick={start} disabled={busy} className="gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Start</Button>
          <div><Link to={back} className="text-sm text-gray-500 underline">Cancel</Link></div>
        </CardContent></Card>
      </div>
    );
  }

  const answered = attempt.questions.filter(q => { const a = answers[q.id]; return Array.isArray(a) ? a.length : (a !== undefined && String(a).trim() !== ''); }).length;
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="flex-1"><div className="text-sm font-semibold">{attempt.title}</div><Progress value={(answered / attempt.questions.length) * 100} className="h-1.5 mt-1.5" /><div className="text-[11px] text-gray-500 mt-1">{answered}/{attempt.questions.length} answered · pass mark {attempt.pass_score}%</div></div>
        {left != null && <div className={`flex items-center gap-1 text-sm font-mono ${left < 120 ? 'text-red-600' : 'text-gray-700'}`}><Timer className="w-4 h-4" />{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>}
      </div>
      {attempt.questions.map((q, n) => (
        <Card key={q.id}><CardContent className="p-4 space-y-3">
          <div className="text-sm"><span className="text-gray-400 mr-2">{n + 1}.</span><span className="font-medium text-gray-900">{q.text}</span>{q.scenario && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">Scenario</span>}</div>
          <div className="text-[11px] text-gray-400">{TYPE_HINT[q.type]}</div>
          {q.type === 'short' ? <Input value={answers[q.id] || ''} onChange={e => set(q.id, e.target.value)} placeholder="Your answer" />
            : <div className="space-y-1.5">{q.options.map((o, i) => {
              const checked = q.type === 'multi' ? (answers[q.id] || []).includes(i) : answers[q.id] === i;
              return (
                <label key={i} className={`flex items-start gap-2 text-sm rounded-lg border p-2.5 cursor-pointer ${checked ? 'border-blue-400 bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={q.id} className="mt-0.5" checked={!!checked} onChange={() => (q.type === 'multi' ? toggle(q.id, i) : set(q.id, i))} />
                  <span>{o}</span>
                </label>
              );
            })}</div>}
        </CardContent></Card>
      ))}
      <div className="flex justify-end pb-6"><Button size="lg" disabled={busy} onClick={() => { if (answered < attempt.questions.length && !window.confirm(`You have answered ${answered} of ${attempt.questions.length}. Submit anyway?`)) return; submit(false); }} className="gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Submit answers</Button></div>
    </div>
  );
}
