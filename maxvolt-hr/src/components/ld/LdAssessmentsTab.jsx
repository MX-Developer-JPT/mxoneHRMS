import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Upload, Download, AlertTriangle, ShieldAlert } from 'lucide-react';
import { ld, downloadCsv } from '@/lib/ld';
import { Field } from '@/components/ld/shared';

const newQ = (topic = '') => ({ type: 'mcq', text: '', options: ['', '', '', ''], correct: [0], accepted: [], points: 1, scenario: false, critical: false, topic });
const TYPE = { mcq: 'Multiple choice (one answer)', multi: 'Multiple selection', truefalse: 'True / False', short: 'Short answer (keywords)' };
const MAX_OPTS = 6;
const CSV_COLS = ['topic', 'type', 'question', ...Array.from({ length: MAX_OPTS }, (_, i) => `option${i + 1}`), 'correct', 'critical', 'points', 'scenario', 'accepted'];

// ── CSV helpers (import / export of question banks) ─────────────────────────────────────────
function parseDelimited(text) {
  const first = text.split(/\r?\n/)[0] || '';
  const delim = first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
const truthy = (v) => /^(y|yes|true|1|x)$/i.test(String(v || '').trim());
const TYPE_ALIAS = { mcq: 'mcq', single: 'mcq', one: 'mcq', multi: 'multi', multiple: 'multi', truefalse: 'truefalse', tf: 'truefalse', 'true/false': 'truefalse', 'true false': 'truefalse', short: 'short', text: 'short' };

function rowsToQuestions(text, topicKeys) {
  const rows = parseDelimited(text);
  if (rows.length < 2) return { questions: [], errors: ['No data rows found — the first row must be the column headings.'] };
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iTopic = col('topic', 'block'), iType = col('type'), iQ = col('question', 'text'), iCorrect = col('correct', 'answer'), iCrit = col('critical'), iPts = col('points'), iScn = col('scenario'), iAcc = col('accepted', 'keywords');
  const iOpts = Array.from({ length: MAX_OPTS }, (_, n) => col(`option${n + 1}`, 'abcdef'[n] ? `option${'abcdef'[n]}` : '', 'abcdef'[n]));
  const errors = [];
  if (iQ < 0) return { questions: [], errors: ['A "question" column is required.'] };
  const questions = [];
  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const g = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const text = g(iQ); if (!text) return;
    let type = TYPE_ALIAS[g(iType).toLowerCase()] || '';
    const options = iOpts.map(i => g(i)).filter(Boolean);
    const topic = g(iTopic).toUpperCase();
    if (topic && topicKeys.length && !topicKeys.includes(topic)) errors.push(`Row ${line}: block "${topic}" is not one of ${topicKeys.join(', ')}.`);
    const corr = g(iCorrect);
    const q = { type, text, options, correct: [], accepted: [], points: Number(g(iPts)) || 1, scenario: truthy(g(iScn)), critical: truthy(g(iCrit)), topic };
    const toIdx = (tok) => { const t = tok.trim(); if (!t) return -1; if (/^\d+$/.test(t)) return Number(t) - 1; const li = 'abcdef'.indexOf(t.toLowerCase()); return t.length === 1 ? li : -1; };
    if (!type) type = options.length === 0 ? 'short' : /^true|false$/i.test(options[0] || '') && options.length === 2 ? 'truefalse' : (corr.split(/[;,\s|]+/).filter(Boolean).length > 1 ? 'multi' : 'mcq');
    q.type = type;
    if (type === 'short') { q.options = []; q.accepted = (g(iAcc) || corr).split(/[;|]/).map(x => x.trim()).filter(Boolean); if (!q.accepted.length) errors.push(`Row ${line}: a short-answer question needs accepted keywords.`); }
    else {
      if (type === 'truefalse') { q.options = ['True', 'False']; q.correct = [/^(t|true|1)$/i.test(corr) ? 0 : /^(f|false|2)$/i.test(corr) ? 1 : -1]; }
      else { q.correct = corr.split(/[;,\s|]+/).filter(Boolean).map(toIdx); if (type === 'mcq') q.correct = q.correct.slice(0, 1); }
      if (type !== 'truefalse' && q.options.length < 2) errors.push(`Row ${line}: at least two options are needed.`);
      if (!q.correct.length || q.correct.some(c => c < 0 || c >= q.options.length)) errors.push(`Row ${line}: the correct answer "${corr}" does not match the options.`);
    }
    questions.push(q);
  });
  return { questions, errors };
}

function questionsToRows(questions) {
  return questions.map(q => {
    const o = {};
    o.topic = q.topic || ''; o.type = q.type; o.question = q.text;
    for (let i = 0; i < MAX_OPTS; i++) o[`option${i + 1}`] = q.options?.[i] || '';
    o.correct = q.type === 'short' ? '' : q.type === 'truefalse' ? (q.correct[0] === 0 ? 'True' : 'False') : q.correct.map(c => c + 1).join(';');
    o.critical = q.critical ? 'yes' : ''; o.points = q.points || 1; o.scenario = q.scenario ? 'yes' : ''; o.accepted = (q.accepted || []).join(';');
    return o;
  });
}

// ── question bank coverage vs. the scope document ───────────────────────────────────────────
function Coverage({ a, topics }) {
  const active = a.questions;
  const count = (k) => active.filter(q => (q.topic || '') === k).length;
  const untagged = active.filter(q => !q.topic).length;
  const critical = active.filter(q => q.critical).length;
  const perAttempt = a.questions_per_attempt || active.length;
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Question-bank coverage — {a.title}</CardTitle></CardHeader><CardContent className="space-y-2">
      <div className="text-xs text-gray-600">{active.length} questions · {critical} critical · {perAttempt} per attempt{active.length >= perAttempt * 3 ? ' · pool is at least 3× an attempt ✓' : <span className="text-amber-700"> · aim for a pool of at least {perAttempt * 3} so retakes differ</span>}</div>
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
        {topics.map(t => {
          const n = count(t.key); const ok = n >= t.min;
          return (
            <div key={t.key}>
              <div className="flex justify-between text-xs mb-0.5"><span><b>{t.key}</b> {t.label}</span><span className={ok ? 'text-green-700' : 'text-amber-700'}>{n}/{t.min}</span></div>
              <Progress value={Math.min(100, t.min ? (n / t.min) * 100 : 100)} className="h-1.5" />
            </div>
          );
        })}
      </div>
      {untagged > 0 && <div className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{untagged} question(s) have no topic block — tag them so results can show weak topics.</div>}
    </CardContent></Card>
  );
}

export default function LdAssessmentsTab() {
  const [list, setList] = useState(null);
  const [topics, setTopics] = useState([]);
  const [ed, setEd] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ q: '', topic: 'all' });
  const [imp, setImp] = useState(null);   // { target: assessmentId | 'new', text, parsed }
  const [an, setAn] = useState(null);
  const [fix, setFix] = useState(null);
  const [anKey, setAnKey] = useState('');

  const load = useCallback(async () => {
    try { const r = await ld('ld_listAssessments'); setList(r.assessments); setTopics(r.topics || []); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const loadAnalytics = useCallback(async () => {
    try { setAn(await ld('ld_getQuestionAnalytics', anKey ? { key: anKey } : {})); } catch (e) { toast.error(e.message); }
  }, [anKey]);

  const live = useMemo(() => (list || []).filter(a => a.status !== 'archived'), [list]);
  const topicKeys = topics.map(t => t.key);

  const save = async () => {
    setBusy(true);
    try { await ld('ld_saveAssessment', { assessment: ed }); toast.success('Assessment saved'); setEd(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const setQ = (i, patch) => setEd(a => ({ ...a, questions: a.questions.map((q, n) => n === i ? { ...q, ...patch } : q) }));
  const changeType = (i, type) => setQ(i, type === 'truefalse' ? { type, options: ['True', 'False'], correct: [0] } : type === 'short' ? { type, options: [], correct: [], accepted: [] } : { type, options: ['', '', '', ''], correct: [0] });

  const parseImport = (text) => setImp(m => ({ ...m, text, parsed: text.trim() ? rowsToQuestions(text, topicKeys) : null }));
  // CSV / text as before; an Excel workbook is read here (sheet "Questions", else the first sheet) and turned into the same rows
  const onFile = async (f) => {
    if (!f) return;
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets['Questions'] || wb.Sheets[wb.SheetNames[0]];
        parseImport(XLSX.utils.sheet_to_csv(ws, { blankrows: false }));
      } else parseImport(await f.text());
    } catch (e) { toast.error('Could not read this file: ' + e.message); }
  };
  const doImport = async () => {
    if (!imp?.parsed?.questions.length) { toast.error('Nothing to import'); return; }
    if (imp.parsed.errors.length) { toast.error('Fix the highlighted rows first'); return; }
    setBusy(true);
    try {
      if (imp.target === 'new') {
        if (!(imp.title || '').trim()) { toast.error('Give the new assessment a title'); setBusy(false); return; }
        await ld('ld_saveAssessment', { assessment: { title: imp.title, description: '', pass_score: 90, max_attempts: 3, time_limit_min: 0, randomize: true, shuffle_options: true, questions: imp.parsed.questions } });
      } else {
        const cur = list.find(a => a.id === imp.target);
        const replace = imp.mode === 'replace';
        await ld('ld_saveAssessment', { assessment: { ...cur, questions: replace ? imp.parsed.questions : [...cur.questions, ...imp.parsed.questions] } });
      }
      toast.success(`${imp.parsed.questions.length} question(s) imported`); setImp(null); await load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const templateCsv = () => downloadCsv(CSV_COLS.map(k => ({ key: k, label: k })), [
    { topic: 'C', type: 'mcq', question: 'What do you do first when you see a safety hazard?', option1: 'Ignore it', option2: 'Stop and report it', option3: 'Fix it yourself', option4: 'Tell a friend', correct: '2', critical: 'yes', points: 1 },
    { topic: 'B', type: 'multi', question: 'Which are leave types?', option1: 'Casual', option2: 'Earned', option3: 'Sick', option4: 'Holiday-for-all', correct: '1;2;3', points: 1 },
    { topic: 'B', type: 'truefalse', question: 'Earned leave can be used before confirmation.', correct: 'False', points: 1 },
    { topic: 'E', type: 'short', question: 'Where do you raise an IT query?', accepted: 'helpdesk;ticket', points: 1 },
  ], 'question-bank-template.csv');

  const shown = (ed?.questions || []).map((q, i) => ({ q, i })).filter(({ q }) => (filter.topic === 'all' || (filter.topic === '_' ? !q.topic : q.topic === filter.topic)) && (!filter.q || q.text.toLowerCase().includes(filter.q.toLowerCase())));

  if (!list) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  return (
    <Tabs defaultValue="banks" onValueChange={v => { if (v === 'analytics' && !an) loadAnalytics(); }}>
      <TabsList><TabsTrigger value="banks">Question banks</TabsTrigger><TabsTrigger value="analytics">Question analytics</TabsTrigger></TabsList>

      <TabsContent value="banks" className="space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2"><p className="text-sm text-gray-500 max-w-2xl">Question banks used by induction gates and courses. Each attempt draws a different selection from the pool. Editing questions creates a new version — earlier attempts stay linked to the version they were taken on.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImp({ target: live[0]?.id || 'new', mode: 'append', text: '', parsed: null })}><Upload className="w-4 h-4 mr-1" />Import CSV</Button>
            <Button size="sm" onClick={() => setEd({ title: '', description: '', pass_score: 90, max_attempts: 3, time_limit_min: 30, questions_per_attempt: 0, randomize: true, shuffle_options: true, status: 'active', questions: [newQ()] })}><Plus className="w-4 h-4 mr-1" />New assessment</Button>
          </div></div>

        {live.filter(a => a.key === 'induction-knowledge-check').map(a => <Coverage key={a.id} a={a} topics={topics} />)}

        {list.map(a => (
          <Card key={a.id} className={a.status === 'archived' ? 'opacity-60' : ''}><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div><div className="font-semibold">{a.title} <span className="text-xs text-gray-400">v{a.version}</span> {a.status === 'archived' && <Badge variant="outline" className="text-[10px]">Superseded / archived</Badge>}</div>
              <div className="text-xs text-gray-500">{a.questions.length} questions{a.questions_per_attempt ? ` (${a.questions_per_attempt} per attempt)` : ''} · {a.questions.filter(q => q.critical).length} critical · pass {a.pass_score}% · {a.max_attempts} attempts · {a.time_limit_min ? `${a.time_limit_min} min` : 'untimed'}{a.randomize ? ' · randomised' : ''}{a.shuffle_options !== false ? ' · options shuffled' : ''}</div></div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => downloadCsv(CSV_COLS.map(k => ({ key: k, label: k })), questionsToRows(a.questions), `${a.title.replace(/\W+/g, '_')}_v${a.version}.csv`)}><Download className="w-4 h-4 mr-1" />CSV</Button>
              {a.status !== 'archived' && <Button size="sm" variant="outline" onClick={() => { setFilter({ q: '', topic: 'all' }); setEd(JSON.parse(JSON.stringify(a))); }}>Edit</Button>}
            </div>
          </CardContent></Card>
        ))}
      </TabsContent>

      <TabsContent value="analytics" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-9 rounded-md border bg-white px-2 text-sm" value={anKey} onChange={e => setAnKey(e.target.value)}>
            <option value="">All assessments</option>{[...new Set(list.map(a => a.key))].map(k => <option key={k} value={k}>{list.find(a => a.key === k)?.title}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={loadAnalytics}>Refresh</Button>
          {an && <span className="text-xs text-gray-500">{an.attempts} scored attempt(s){an.avg_score != null ? ` · average ${an.avg_score}%` : ''}</span>}
        </div>
        {!an ? <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div> : (
          <>
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Questions — hardest first</CardTitle></CardHeader><CardContent className="overflow-x-auto">
              <p className="text-xs text-gray-500 mb-2">Review any question with a pass rate under 40% (poorly worded, or a wrong key?) or over 95% (too easy). If the key was wrong, correct it — affected attempts are re-scored.</p>
              {an.questions.length === 0 ? <div className="text-sm text-gray-500">No scored attempts yet.</div> : (
                <table className="w-full text-sm min-w-[720px]"><thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Question</th><th>Block</th><th>Served</th><th>Right</th><th></th><th></th></tr></thead>
                  <tbody>{an.questions.slice(0, 80).map(r => (
                    <tr key={r.key + r.id} className="border-b last:border-0"><td className="py-1.5 max-w-md">{r.critical && <ShieldAlert className="inline w-3.5 h-3.5 text-red-600 mr-1" />}{r.text}<div className="text-[11px] text-gray-400">{r.title}</div></td><td>{r.topic || '—'}</td><td>{r.served}</td>
                      <td className={r.flag === 'hard' ? 'text-red-600 font-semibold' : r.flag === 'easy' ? 'text-blue-600' : ''}>{r.correct_pct}%</td>
                      <td className="text-[11px]">{r.flag === 'hard' ? <Badge variant="outline" className="border-red-300 text-red-700">Review</Badge> : r.flag === 'easy' ? <Badge variant="outline" className="border-blue-300 text-blue-700">Too easy?</Badge> : ''}</td>
                      <td>{r.assessment_id && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const aq = list.find(x => x.id === r.assessment_id)?.questions.find(x => x.id === r.id); if (aq) setFix({ assessment_id: r.assessment_id, q: aq, correct: [...(aq.correct || [])], accepted: (aq.accepted || []).join(', '), reason: '' }); else toast.error('This question is no longer in the current version'); }}>Fix key</Button>}</td></tr>
                  ))}</tbody></table>
              )}
            </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Weak topic blocks by department</CardTitle></CardHeader><CardContent className="overflow-x-auto">
              {an.weak_topics.length === 0 ? <div className="text-sm text-gray-500">Not enough results yet (needs at least 5 answers per block).</div> : (
                <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Department</th><th>Block</th><th>Answers</th><th>Right</th></tr></thead>
                  <tbody>{an.weak_topics.slice(0, 30).map((r, i) => <tr key={i} className="border-b last:border-0"><td className="py-1.5">{r.department}</td><td>{r.topic}{topics.find(t => t.key === r.topic) ? ` — ${topics.find(t => t.key === r.topic).label}` : ''}</td><td>{r.served}</td><td className={r.correct_pct < 70 ? 'text-red-600 font-semibold' : ''}>{r.correct_pct}%</td></tr>)}</tbody></table>
              )}
            </CardContent></Card>
          </>
        )}
      </TabsContent>

      {/* editor */}
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
                <Field label="Questions per attempt (0 = all)"><Input type="number" value={ed.questions_per_attempt || 0} onChange={e => setEd(a => ({ ...a, questions_per_attempt: e.target.value }))} /></Field>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={ed.randomize !== false} onChange={e => setEd(a => ({ ...a, randomize: e.target.checked }))} />Draw randomly from the pool</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={ed.shuffle_options !== false} onChange={e => setEd(a => ({ ...a, shuffle_options: e.target.checked }))} />Shuffle answer options</label>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Input className="w-56 h-8" placeholder="Search questions…" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
                <select className="h-8 rounded-md border bg-white px-2 text-xs" value={filter.topic} onChange={e => setFilter(f => ({ ...f, topic: e.target.value }))}>
                  <option value="all">All blocks</option>{topics.map(t => <option key={t.key} value={t.key}>{t.key} — {t.label.slice(0, 40)}</option>)}<option value="_">No block</option>
                </select>
                <span className="text-xs text-gray-400">{shown.length} of {ed.questions.length} shown</span>
              </div>
              <div className="space-y-3">
                {shown.map(({ q, i }) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2 bg-gray-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
                      <select className="h-8 rounded-md border bg-white px-2 text-xs" value={q.type} onChange={e => changeType(i, e.target.value)}>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <select className="h-8 rounded-md border bg-white px-2 text-xs" value={q.topic || ''} onChange={e => setQ(i, { topic: e.target.value })}><option value="">Block…</option>{topics.map(t => <option key={t.key} value={t.key}>{t.key}</option>)}</select>
                      <label className="text-xs flex items-center gap-1 text-red-700"><input type="checkbox" checked={!!q.critical} onChange={e => setQ(i, { critical: e.target.checked })} />Critical</label>
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
                            <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={`c${i}`} checked={q.correct.includes(n)} onChange={() => setQ(i, { correct: q.type === 'multi' ? (q.correct.includes(n) ? q.correct.filter(x => x !== n) : [...q.correct, n]) : [n] })} />
                            <Input className="bg-white h-8" value={o} disabled={q.type === 'truefalse'} placeholder={`Option ${n + 1}`} onChange={e => setQ(i, { options: q.options.map((x, m) => m === n ? e.target.value : x) })} />
                            {q.type !== 'truefalse' && q.options.length > 2 && <button className="text-gray-400 hover:text-red-600" onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== n), correct: q.correct.filter(x => x !== n).map(x => (x > n ? x - 1 : x)) })}>✕</button>}
                          </div>
                        ))}
                        {q.type !== 'truefalse' && q.options.length < MAX_OPTS && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setQ(i, { options: [...q.options, ''] })}>+ Option</Button>}
                        <div className="text-[11px] text-gray-400">Tick the correct answer{q.type === 'multi' ? 's (all of them must be chosen — a partly right answer counts as wrong)' : ''}.</div>
                      </div>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => { setFilter({ q: '', topic: 'all' }); setEd(a => ({ ...a, questions: [...a.questions, newQ(filter.topic !== 'all' && filter.topic !== '_' ? filter.topic : '')] })); }}><Plus className="w-4 h-4 mr-1" />Add question</Button>
              </div>
              <Button onClick={save} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save assessment</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* bulk import */}
      <Dialog open={!!imp} onOpenChange={o => !o && setImp(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import questions from CSV</DialogTitle></DialogHeader>
          {imp && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Columns: <code>topic</code> (block A–F), <code>type</code> (mcq / multi / truefalse / short), <code>question</code>, <code>option1…option6</code>, <code>correct</code> (option number, e.g. 2 — or 1;3 for multi — or True/False), <code>critical</code> (yes), <code>points</code>, <code>scenario</code>, <code>accepted</code> (keywords for short answers, separated by ;). An Excel file (.xlsx — the “Questions” sheet) can be uploaded directly, or rows pasted straight in.</p>
              <div className="flex flex-wrap gap-2 items-center"><Button size="sm" variant="outline" onClick={templateCsv}><Download className="w-4 h-4 mr-1" />Download template</Button>
                <input type="file" accept=".xlsx,.xls,.csv,.txt,.tsv" className="text-xs" onChange={e => onFile(e.target.files?.[0])} /></div>
              <Field label="Add to">
                <select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={imp.target} onChange={e => setImp(m => ({ ...m, target: e.target.value }))}>
                  {live.map(a => <option key={a.id} value={a.id}>{a.title} (v{a.version}, {a.questions.length} questions)</option>)}<option value="new">A new assessment…</option>
                </select>
              </Field>
              {imp.target === 'new' ? <Field label="Title of the new assessment"><Input value={imp.title || ''} onChange={e => setImp(m => ({ ...m, title: e.target.value }))} /></Field> : (
                <div className="flex gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" checked={imp.mode !== 'replace'} onChange={() => setImp(m => ({ ...m, mode: 'append' }))} />Add to the existing questions</label><label className="flex items-center gap-2"><input type="radio" checked={imp.mode === 'replace'} onChange={() => setImp(m => ({ ...m, mode: 'replace' }))} />Replace all existing questions</label></div>
              )}
              <Textarea rows={6} className="font-mono text-xs" placeholder="…or paste CSV / Excel rows here (with the heading row)" value={imp.text} onChange={e => parseImport(e.target.value)} />
              {imp.parsed && (
                <div className={`rounded-lg border p-3 text-xs space-y-1 ${imp.parsed.errors.length ? 'border-red-300 bg-red-50 text-red-800' : 'border-green-300 bg-green-50 text-green-800'}`}>
                  <div className="font-semibold">{imp.parsed.questions.length} question(s) read{imp.parsed.errors.length ? ` · ${imp.parsed.errors.length} problem(s)` : ' · ready to import'}</div>
                  {imp.parsed.errors.slice(0, 12).map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              <Button onClick={doImport} disabled={busy || !imp.parsed?.questions.length || imp.parsed.errors.length > 0}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Import</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* answer-key correction */}
      <Dialog open={!!fix} onOpenChange={o => !o && setFix(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Correct the answer key</DialogTitle></DialogHeader>
          {fix && (
            <div className="space-y-3">
              <div className="text-sm font-medium">{fix.q.text}</div>
              {fix.q.type === 'short' ? (
                <Field label="Accepted keywords (comma separated)"><Input value={fix.accepted} onChange={e => setFix(f => ({ ...f, accepted: e.target.value }))} /></Field>
              ) : (
                <div className="space-y-1">{fix.q.options.map((o, n) => (
                  <label key={n} className="flex items-center gap-2 text-sm"><input type={fix.q.type === 'multi' ? 'checkbox' : 'radio'} name="fixc" checked={fix.correct.includes(n)} onChange={() => setFix(f => ({ ...f, correct: fix.q.type === 'multi' ? (f.correct.includes(n) ? f.correct.filter(x => x !== n) : [...f.correct, n]) : [n] }))} />{o}</label>
                ))}</div>
              )}
              <Textarea placeholder="Why is the key being corrected? (required — recorded in the audit trail)" value={fix.reason} onChange={e => setFix(f => ({ ...f, reason: e.target.value }))} />
              <p className="text-xs text-gray-500">Every submitted attempt that served this question is re-scored. People who now pass are moved forward and told; nobody is moved backwards automatically.</p>
              <Button disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const r = await ld('ld_fixAnswerKey', { assessment_id: fix.assessment_id, question_id: fix.q.id, correct: fix.q.type === 'short' ? undefined : fix.correct, accepted: fix.q.type === 'short' ? fix.accepted.split(',').map(s => s.trim()).filter(Boolean) : undefined, reason: fix.reason });
                  toast.success(`Key corrected — ${r.rescored} attempt(s) re-scored, ${r.promoted} now passing${r.demoted ? `, ${r.demoted} would have failed (left unchanged)` : ''}`);
                  setFix(null); await load(); await loadAnalytics();
                } catch (e) { toast.error(e.message); }
                setBusy(false);
              }}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Correct key and re-score</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
