import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardList, Plus, BarChart3, CheckCircle2, Send, RefreshCw, Smile, Meh, Frown, Users, Lock, Eye, BellRing, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import CreateSurveyDialog from '@/components/pulse/CreateSurveyDialog';
import { ps, fmtDate } from '@/lib/pulse';

const PrivacyTag = ({ s }) => s.anonymous
  ? <Badge className="bg-violet-50 text-violet-700 border border-violet-200"><Lock className="w-3 h-3 mr-1" />Anonymous</Badge>
  : <Badge className="bg-amber-50 text-amber-700 border border-amber-200"><Eye className="w-3 h-3 mr-1" />Named</Badge>;

const isRequired = (q) => q.required !== false && q.type !== 'text';
const hasAnswer = (v) => !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));

export default function PulseSurveys() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isHR, setIsHR] = useState(false);
  const [surveys, setSurveys] = useState([]);
  const [respondSurvey, setRespondSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    try { const d = await ps('ps_list'); setSurveys(d.surveys || []); setIsHR(!!d.is_hr); }
    catch (e) { toast.error('Could not load surveys: ' + e.message); }
    setLoading(false);
  };

  const openRespond = (s) => { setRespondSurvey(s); setAnswers({}); };
  const setA = (id, v) => setAnswers(a => ({ ...a, [id]: v }));
  const toggleMulti = (id, opt) => setAnswers(a => { const cur = Array.isArray(a[id]) ? a[id] : []; return { ...a, [id]: cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt] }; });

  const submitResponse = async () => {
    const missing = (respondSurvey?.questions || []).filter(q => isRequired(q) && !hasAnswer(answers[q.id]));
    if (missing.length) { toast.error(`Please answer: ${missing[0].text}`); return; }
    setSubmitting(true);
    try { await ps('ps_submit', { survey_id: respondSurvey.id, answers }); toast.success('Thank you for your feedback! 🙏'); setRespondSurvey(null); load(); }
    catch (e) { toast.error(e.message); }
    setSubmitting(false);
  };

  const closeSurvey = async (s) => {
    if (!confirm(`Close "${s.title}"? Employees will no longer be able to respond.`)) return;
    try { await ps('ps_close', { survey_id: s.id }); toast.success('Survey closed'); load(); } catch (e) { toast.error(e.message); }
  };
  const remind = async (s) => {
    if (!confirm(`Send a reminder to everyone who has not responded to "${s.title}"?${s.anonymous ? ' (Anonymous survey — you will see how many were reminded, never who.)' : ''}`)) return;
    try { const d = await ps('ps_remind', { survey_id: s.id }); toast.success(`Reminder sent to ${d.sent} ${d.sent === 1 ? 'person' : 'people'}`); } catch (e) { toast.error(e.message); }
  };

  const activeForMe = surveys.filter(s => s.status === 'active' && !s.completed);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2"><ClipboardList className="w-6 h-6 text-violet-600" /> Pulse Surveys &amp; eNPS</h1>
          <p className="text-gray-500 text-sm mt-1">{isHR ? 'Launch surveys, import questions from Excel, and analyse results employee-wise or in total.' : 'Share your feedback to help us improve. Each survey tells you up front whether it is anonymous.'}</p>
        </div>
        {isHR && <Button onClick={() => setShowCreate(true)} className="bg-violet-600 hover:bg-violet-700 text-white"><Plus className="w-4 h-4 mr-2" /> New Survey</Button>}
      </div>

      {activeForMe.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-700">Awaiting your response</h2>
          {activeForMe.map(s => (
            <Card key={s.id} className="border-violet-200 bg-violet-50/50 hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-800 break-words">{s.title}</p>
                    <Badge className={s.type === 'enps' ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'}>{s.type === 'enps' ? 'eNPS' : 'Pulse'}</Badge>
                    <PrivacyTag s={s} />
                  </div>
                  {s.description && <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>}
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-2 flex-wrap"><span>{s.questions.length} question{s.questions.length > 1 ? 's' : ''}</span>{s.closes_at && <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" />closes {fmtDate(s.closes_at)}</span>}</p>
                </div>
                <Button onClick={() => openRespond(s)} className="bg-violet-600 hover:bg-violet-700 text-white flex-shrink-0">Respond</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-semibold text-gray-700">{isHR ? 'All surveys' : 'Surveys'}</h2>
        {loading ? (
          <div className="text-center py-12 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : surveys.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-gray-400"><ClipboardList className="w-10 h-10 mx-auto mb-2 text-gray-300" /> No surveys yet.</CardContent></Card>
        ) : surveys.map(s => (
          <Card key={s.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-800">{s.title}</p>
                  <Badge className={s.type === 'enps' ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'}>{s.type === 'enps' ? 'eNPS' : 'Pulse'}</Badge>
                  <Badge className={s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{s.status}</Badge>
                  <PrivacyTag s={s} />
                  {s.completed && <Badge className="bg-blue-100 text-blue-700"><CheckCircle2 className="w-3 h-3 mr-1" /> Responded</Badge>}
                </div>
                {s.description && <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>}
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
                  <span>Launched {fmtDate(s.created_at)}</span>
                  {isHR && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {s.response_count} response{s.response_count !== 1 ? 's' : ''}</span>}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0 flex-wrap">
                {s.status === 'active' && !s.completed && <Button size="sm" onClick={() => openRespond(s)} className="bg-violet-600 hover:bg-violet-700 text-white">Respond</Button>}
                {isHR && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/PulseSurveyResults?id=${s.id}`)}><BarChart3 className="w-3.5 h-3.5 mr-1" /> Results</Button>
                    {s.status === 'active' && <Button size="sm" variant="outline" onClick={() => remind(s)}><BellRing className="w-3.5 h-3.5 mr-1" /> Remind</Button>}
                    {s.status === 'active' && <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => closeSurvey(s)}>Close</Button>}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!respondSurvey} onOpenChange={() => setRespondSurvey(null)}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{respondSurvey?.title}</DialogTitle></DialogHeader>
          {respondSurvey && (
            <div className="space-y-5">
              {respondSurvey.anonymous
                ? <p className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg p-2.5 flex items-start gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />This survey is anonymous. HR cannot see who gave which answer — only your department and designation are kept, and only in groups of 5 or more.</p>
                : <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-1.5"><Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />This survey is NOT anonymous. HR can see your name against your answers.</p>}
              {respondSurvey.questions.map((q, n) => (
                <div key={q.id}>
                  <Label className="text-sm leading-snug">{n + 1}. {q.text}{isRequired(q) && <span className="text-red-500"> *</span>}</Label>
                  {q.type === 'nps' ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Array.from({ length: 11 }, (_, k) => (
                        <button key={k} type="button" onClick={() => setA(q.id, k)}
                          className={`w-9 h-9 rounded-lg border text-sm font-medium transition-all ${answers[q.id] === k ? (k >= 9 ? 'bg-green-500 text-white border-transparent' : k <= 6 ? 'bg-red-500 text-white border-transparent' : 'bg-amber-400 text-white border-transparent') : 'bg-white hover:bg-gray-50 text-gray-600'}`}>{k}</button>
                      ))}
                      <div className="w-full flex justify-between text-xs text-gray-400 mt-1"><span>Not likely</span><span>Extremely likely</span></div>
                    </div>
                  ) : q.type === 'text' ? (
                    <Textarea rows={3} className="mt-1.5" placeholder="Optional…" value={answers[q.id] || ''} onChange={e => setA(q.id, e.target.value)} />
                  ) : q.type === 'yesno' ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[['yes', 'Yes'], ['no', 'No']].map(([v, l]) => <button key={v} type="button" onClick={() => setA(q.id, v)} className={`py-2 rounded-lg border text-sm font-medium transition-all ${answers[q.id] === v ? 'bg-violet-600 text-white border-transparent' : 'bg-white hover:bg-gray-50 text-gray-600'}`}>{l}</button>)}
                    </div>
                  ) : q.type === 'single' ? (
                    <div className="mt-2 space-y-1.5">
                      {(q.options || []).map(o => <label key={o} className={`flex items-start gap-2 text-sm rounded-lg border p-2.5 cursor-pointer ${answers[q.id] === o ? 'border-violet-400 bg-violet-50' : 'hover:bg-gray-50'}`}><input type="radio" className="mt-0.5" name={q.id} checked={answers[q.id] === o} onChange={() => setA(q.id, o)} /><span>{o}</span></label>)}
                    </div>
                  ) : q.type === 'multi' ? (
                    <div className="mt-2 space-y-1.5">
                      <div className="text-[11px] text-gray-400">Choose all that apply</div>
                      {(q.options || []).map(o => { const on = (answers[q.id] || []).includes(o); return <label key={o} className={`flex items-start gap-2 text-sm rounded-lg border p-2.5 cursor-pointer ${on ? 'border-violet-400 bg-violet-50' : 'hover:bg-gray-50'}`}><input type="checkbox" className="mt-0.5" checked={on} onChange={() => toggleMulti(q.id, o)} /><span>{o}</span></label>; })}
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      {[1, 2, 3, 4, 5].map(k => { const Icon = k <= 2 ? Frown : k === 3 ? Meh : Smile; return (
                        <button key={k} type="button" onClick={() => setA(q.id, k)} className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border transition-all ${answers[q.id] === k ? 'bg-violet-600 text-white border-transparent' : 'bg-white hover:bg-gray-50 text-gray-500'}`}><Icon className="w-5 h-5" /><span className="text-xs font-medium">{k}</span></button>
                      ); })}
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

      {showCreate && <CreateSurveyDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}
