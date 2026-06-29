import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ClipboardList, Plus, BarChart3, CheckCircle2, Trash2, Send, RefreshCw,
  Smile, Meh, Frown, TrendingUp, Users, X, Lock
} from 'lucide-react';
import { toast } from 'sonner';

const ENPS_QUESTION = { id: 'enps', text: 'How likely are you to recommend Maxvolt as a place to work?', type: 'nps' };

export default function PulseSurveys() {
  const [loading, setLoading] = useState(true);
  const [isHR, setIsHR] = useState(false);
  const [surveys, setSurveys] = useState([]);

  const [respondSurvey, setRespondSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [resultsFor, setResultsFor] = useState(null);
  const [results, setResults] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getPulseSurveys', {});
      const d = res.data || res;
      if (d.success) { setSurveys(d.surveys || []); setIsHR(d.is_hr); }
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const openRespond = (s) => { setRespondSurvey(s); setAnswers({}); };

  const submitResponse = async () => {
    const required = (respondSurvey?.questions || []).filter(q => q.type !== 'text');
    if (required.some(q => answers[q.id] === undefined)) { toast.error('Please answer all rating questions'); return; }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('submitSurveyResponse', { survey_id: respondSurvey.id, answers });
      const d = res.data || res;
      if (d.success) { toast.success('Thank you for your feedback! 🙏'); setRespondSurvey(null); load(); }
      else toast.error(d.error || 'Could not submit');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSubmitting(false);
  };

  const openResults = async (s) => {
    setResultsFor(s); setResults(null);
    try {
      const res = await base44.functions.invoke('getSurveyResults', { survey_id: s.id });
      const d = res.data || res;
      if (d.success) setResults(d);
      else toast.error(d.error || 'Failed');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const closeSurvey = async (s) => {
    if (!confirm(`Close "${s.title}"? Employees will no longer be able to respond.`)) return;
    await base44.functions.invoke('closePulseSurvey', { survey_id: s.id });
    toast.success('Survey closed');
    load();
  };

  const activeForMe = surveys.filter(s => s.status === 'active' && !s.completed);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-violet-600" /> Pulse Surveys & eNPS
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isHR ? 'Launch anonymous pulse checks and measure employee Net Promoter Score.' : 'Share your honest, anonymous feedback to help us improve.'}
          </p>
        </div>
        {isHR && (
          <Button onClick={() => setShowCreate(true)} className="bg-violet-600 hover:bg-violet-700 text-white">
            <Plus className="w-4 h-4 mr-2" /> New Survey
          </Button>
        )}
      </div>

      {/* Active surveys to respond to (everyone) */}
      {activeForMe.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-700">Awaiting your response</h2>
          {activeForMe.map(s => (
            <Card key={s.id} className="border-violet-200 bg-violet-50/50 hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{s.title}</p>
                    <Badge className={s.type === 'enps' ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'}>{s.type === 'enps' ? 'eNPS' : 'Pulse'}</Badge>
                  </div>
                  {s.description && <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>}
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Anonymous · {s.questions.length} question{s.questions.length > 1 ? 's' : ''}</p>
                </div>
                <Button onClick={() => openRespond(s)} className="bg-violet-600 hover:bg-violet-700 text-white flex-shrink-0">Respond</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* All surveys list */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-700">{isHR ? 'All surveys' : 'Surveys'}</h2>
        {loading ? (
          <div className="text-center py-12 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : surveys.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-gray-400">
            <ClipboardList className="w-10 h-10 mx-auto mb-2 text-gray-300" /> No surveys yet.
          </CardContent></Card>
        ) : surveys.map(s => (
          <Card key={s.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-800">{s.title}</p>
                  <Badge className={s.type === 'enps' ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'}>{s.type === 'enps' ? 'eNPS' : 'Pulse'}</Badge>
                  <Badge className={s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{s.status}</Badge>
                  {s.completed && <Badge className="bg-blue-100 text-blue-700"><CheckCircle2 className="w-3 h-3 mr-1" /> Responded</Badge>}
                </div>
                {s.description && <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>}
                {isHR && <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Users className="w-3 h-3" /> {s.response_count} response{s.response_count !== 1 ? 's' : ''}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {!isHR && s.status === 'active' && !s.completed && (
                  <Button size="sm" onClick={() => openRespond(s)} className="bg-violet-600 hover:bg-violet-700 text-white">Respond</Button>
                )}
                {isHR && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openResults(s)}><BarChart3 className="w-3.5 h-3.5 mr-1" /> Results</Button>
                    {s.status === 'active' && <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => closeSurvey(s)}>Close</Button>}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Respond dialog */}
      <Dialog open={!!respondSurvey} onOpenChange={() => setRespondSurvey(null)}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{respondSurvey?.title}</DialogTitle></DialogHeader>
          {respondSurvey && (
            <div className="space-y-5">
              <p className="text-xs text-gray-400 flex items-center gap-1"><Lock className="w-3 h-3" /> Your response is anonymous.</p>
              {respondSurvey.questions.map(q => (
                <div key={q.id}>
                  <Label className="text-sm">{q.text}</Label>
                  {q.type === 'nps' ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Array.from({ length: 11 }, (_, n) => (
                        <button key={n} onClick={() => setAnswers(a => ({ ...a, [q.id]: n }))}
                          className={`w-9 h-9 rounded-lg border text-sm font-medium transition-all ${answers[q.id] === n ? (n >= 9 ? 'bg-green-500 text-white border-transparent' : n <= 6 ? 'bg-red-500 text-white border-transparent' : 'bg-amber-400 text-white border-transparent') : 'bg-white hover:bg-gray-50 text-gray-600'}`}>
                          {n}
                        </button>
                      ))}
                      <div className="w-full flex justify-between text-xs text-gray-400 mt-1"><span>Not likely</span><span>Extremely likely</span></div>
                    </div>
                  ) : q.type === 'text' ? (
                    <Textarea rows={2} className="mt-1.5" placeholder="Optional…" value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />
                  ) : (
                    <div className="mt-2 flex gap-2">
                      {[1, 2, 3, 4, 5].map(n => {
                        const Icon = n <= 2 ? Frown : n === 3 ? Meh : Smile;
                        return (
                          <button key={n} onClick={() => setAnswers(a => ({ ...a, [q.id]: n }))}
                            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border transition-all ${answers[q.id] === n ? 'bg-violet-600 text-white border-transparent' : 'bg-white hover:bg-gray-50 text-gray-500'}`}>
                            <Icon className="w-5 h-5" /><span className="text-xs font-medium">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRespondSurvey(null)}>Cancel</Button>
                <Button onClick={submitResponse} disabled={submitting} className="bg-violet-600 hover:bg-violet-700 text-white">
                  {submitting ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Submitting…</> : <><Send className="w-4 h-4 mr-2" /> Submit</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog (HR) */}
      {showCreate && <CreateSurveyDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}

      {/* Results dialog (HR) */}
      <Dialog open={!!resultsFor} onOpenChange={() => { setResultsFor(null); setResults(null); }}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-600" /> {resultsFor?.title} — Results</DialogTitle></DialogHeader>
          {!results ? (
            <div className="py-12 text-center text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
          ) : (
            <div className="space-y-5">
              <div className="flex gap-3">
                <div className="flex-1 bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-800">{results.response_count}</p>
                  <p className="text-xs text-gray-500">responses</p>
                </div>
                <div className="flex-1 bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-800">{results.response_rate}%</p>
                  <p className="text-xs text-gray-500">response rate</p>
                </div>
                {results.enps && (
                  <div className={`flex-1 rounded-lg p-3 text-center ${results.enps.score >= 30 ? 'bg-green-50' : results.enps.score >= 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <p className={`text-2xl font-bold ${results.enps.score >= 30 ? 'text-green-600' : results.enps.score >= 0 ? 'text-amber-600' : 'text-red-600'}`}>{results.enps.score}</p>
                    <p className="text-xs text-gray-500">eNPS</p>
                  </div>
                )}
              </div>

              {results.enps && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-gray-700">Net Promoter breakdown</p>
                  <div className="flex h-4 rounded-full overflow-hidden">
                    <div className="bg-green-500" style={{ width: `${results.enps.promoter_pct}%` }} title="Promoters" />
                    <div className="bg-amber-400" style={{ width: `${results.enps.passive_pct}%` }} title="Passives" />
                    <div className="bg-red-500" style={{ width: `${results.enps.detractor_pct}%` }} title="Detractors" />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>👍 {results.enps.promoters} promoters</span>
                    <span>😐 {results.enps.passives}</span>
                    <span>👎 {results.enps.detractors} detractors</span>
                  </div>
                </div>
              )}

              {results.questions.map(q => (
                <div key={q.id} className="border-t pt-3">
                  <p className="text-sm font-medium text-gray-700">{q.text}</p>
                  {q.type === 'text' ? (
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                      {q.comments?.length ? q.comments.map((c, i) => (
                        <p key={i} className="text-sm text-gray-600 bg-gray-50 rounded p-2 italic">"{c}"</p>
                      )) : <p className="text-xs text-gray-400">No comments</p>}
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-3">
                      <span className="text-2xl font-bold text-violet-600">{q.average}</span>
                      <span className="text-xs text-gray-400">avg · {q.count} responses</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateSurveyDialog({ onClose, onCreated }) {
  const [type, setType] = useState('pulse');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState([{ text: '', type: 'rating' }]);
  const [saving, setSaving] = useState(false);

  const effectiveQuestions = type === 'enps'
    ? [ENPS_QUESTION, ...questions.filter(q => q.text.trim())]
    : questions.filter(q => q.text.trim());

  const save = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (effectiveQuestions.length === 0) { toast.error('Add at least one question'); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('createPulseSurvey', { title, description, type, questions: effectiveQuestions });
      const d = res.data || res;
      if (d.success) { toast.success('Survey launched & employees notified'); onCreated(); }
      else toast.error(d.error || 'Failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Survey</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setType('pulse')} className={`rounded-lg border px-3 py-2 text-sm ${type === 'pulse' ? 'bg-violet-600 text-white border-transparent' : 'bg-white text-gray-700'}`}>Pulse (rating questions)</button>
            <button onClick={() => setType('enps')} className={`rounded-lg border px-3 py-2 text-sm ${type === 'enps' ? 'bg-teal-600 text-white border-transparent' : 'bg-white text-gray-700'}`}>eNPS (0–10 + comments)</button>
          </div>
          <div>
            <Label>Title</Label>
            <Input className="mt-1" value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'enps' ? 'Q2 Employee NPS' : 'Monthly team pulse'} />
          </div>
          <div>
            <Label>Description <span className="text-gray-400 font-normal">(optional)</span></Label>
            <Input className="mt-1" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          {type === 'enps' && (
            <div className="text-xs bg-teal-50 border border-teal-100 rounded-lg p-2.5 text-teal-700">
              The standard eNPS question ("How likely are you to recommend Maxvolt…", 0–10) is added automatically. Add extra questions below if you like.
            </div>
          )}
          <div>
            <Label>Questions</Label>
            <div className="space-y-2 mt-1">
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={q.text} onChange={e => setQuestions(qs => qs.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder={`Question ${i + 1}`} />
                  <select value={q.type} onChange={e => setQuestions(qs => qs.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                    className="border rounded-md text-sm px-2 bg-white">
                    <option value="rating">Rating 1–5</option>
                    <option value="text">Comment</option>
                  </select>
                  {questions.length > 1 && <Button variant="ghost" size="sm" onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setQuestions(qs => [...qs, { text: '', type: 'rating' }])}>
              <Plus className="w-4 h-4 mr-1" /> Add question
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
              {saving ? 'Launching…' : 'Launch Survey'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
