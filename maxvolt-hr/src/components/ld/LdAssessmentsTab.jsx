import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { ld } from '@/lib/ld';
import { Field } from '@/components/ld/shared';

const newQ = () => ({ type: 'mcq', text: '', options: ['', '', '', ''], correct: [0], accepted: [], points: 1, scenario: false });
const TYPE = { mcq: 'Multiple choice (one answer)', multi: 'Multiple selection', truefalse: 'True / False', short: 'Short answer (keywords)' };

export default function LdAssessmentsTab() {
  const [list, setList] = useState(null);
  const [ed, setEd] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList((await ld('ld_listAssessments')).assessments); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try { await ld('ld_saveAssessment', { assessment: ed }); toast.success('Assessment saved'); setEd(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const setQ = (i, patch) => setEd(a => ({ ...a, questions: a.questions.map((q, n) => n === i ? { ...q, ...patch } : q) }));
  const changeType = (i, type) => setQ(i, type === 'truefalse' ? { type, options: ['True', 'False'], correct: [0] } : type === 'short' ? { type, options: [], correct: [], accepted: [] } : { type, options: ['', '', '', ''], correct: [0] });

  if (!list) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center"><p className="text-sm text-gray-500">Question banks used by induction gates and courses. Editing questions creates a new version — earlier attempts stay linked to the version they were taken on.</p>
        <Button size="sm" onClick={() => setEd({ title: '', description: '', pass_score: 80, max_attempts: 3, time_limit_min: 30, randomize: true, status: 'active', questions: [newQ()] })}><Plus className="w-4 h-4 mr-1" />New assessment</Button></div>
      {list.map(a => (
        <Card key={a.id} className={a.status === 'archived' ? 'opacity-60' : ''}><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-semibold">{a.title} <span className="text-xs text-gray-400">v{a.version}</span> {a.status === 'archived' && <Badge variant="outline" className="text-[10px]">Superseded / archived</Badge>}</div>
            <div className="text-xs text-gray-500">{a.questions.length} questions · pass {a.pass_score}% · {a.max_attempts} attempts · {a.time_limit_min ? `${a.time_limit_min} min` : 'untimed'}{a.randomize ? ' · randomised' : ''}</div></div>
          {a.status !== 'archived' && <Button size="sm" variant="outline" onClick={() => setEd(JSON.parse(JSON.stringify(a)))}>Edit</Button>}
        </CardContent></Card>
      ))}

      <Dialog open={!!ed} onOpenChange={o => !o && setEd(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{ed?.id ? 'Edit assessment' : 'New assessment'}</DialogTitle></DialogHeader>
          {ed && (
            <div className="space-y-4">
              <Field label="Title"><Input value={ed.title} onChange={e => setEd(a => ({ ...a, title: e.target.value }))} /></Field>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Pass mark %"><Input type="number" value={ed.pass_score} onChange={e => setEd(a => ({ ...a, pass_score: e.target.value }))} /></Field>
                <Field label="Max attempts"><Input type="number" value={ed.max_attempts} onChange={e => setEd(a => ({ ...a, max_attempts: e.target.value }))} /></Field>
                <Field label="Time limit (min, 0 = none)"><Input type="number" value={ed.time_limit_min} onChange={e => setEd(a => ({ ...a, time_limit_min: e.target.value }))} /></Field>
                <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={ed.randomize !== false} onChange={e => setEd(a => ({ ...a, randomize: e.target.checked }))} />Randomise questions</label>
              </div>
              <div className="space-y-3">
                {ed.questions.map((q, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2 bg-gray-50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
                      <select className="h-8 rounded-md border bg-white px-2 text-xs" value={q.type} onChange={e => changeType(i, e.target.value)}>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!q.scenario} onChange={e => setQ(i, { scenario: e.target.checked })} />Scenario</label>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => setEd(a => ({ ...a, questions: a.questions.filter((_, n) => n !== i) }))}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                    <Textarea rows={2} placeholder="Question" className="bg-white" value={q.text} onChange={e => setQ(i, { text: e.target.value })} />
                    {q.type === 'short' ? (
                      <Field label="Accepted answers / keywords (comma separated — any one counts)"><Input className="bg-white" value={(q.accepted || []).join(', ')} onChange={e => setQ(i, { accepted: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Field>
                    ) : (
                      <div className="space-y-1.5">
                        {q.options.map((o, n) => (
                          <div key={n} className="flex items-center gap-2">
                            <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={`c${i}`} checked={q.correct.includes(n)} onChange={() => setQ(i, { correct: q.type === 'multi' ? (q.correct.includes(n) ? q.correct.filter(x => x !== n) : [...q.correct, n]) : [n] })} title="Correct answer" />
                            <Input className="bg-white h-8" value={o} disabled={q.type === 'truefalse'} placeholder={`Option ${n + 1}`} onChange={e => setQ(i, { options: q.options.map((x, m) => m === n ? e.target.value : x) })} />
                            {q.type !== 'truefalse' && q.options.length > 2 && <button className="text-gray-400 hover:text-red-600" onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== n), correct: q.correct.filter(x => x !== n).map(x => x > n ? x - 1 : x) })}><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        ))}
                        {q.type !== 'truefalse' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setQ(i, { options: [...q.options, ''] })}>+ Option</Button>}
                        <div className="text-[11px] text-gray-400">Tick the correct answer{q.type === 'multi' ? 's' : ''}.</div>
                      </div>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setEd(a => ({ ...a, questions: [...a.questions, newQ()] }))}><Plus className="w-4 h-4 mr-1" />Add question</Button>
              </div>
              <Button onClick={save} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save assessment</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
