import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, GraduationCap, ArrowRight, Award, AlertTriangle, CheckCircle2, Clock, BookOpen, Users, Lock, Star, ExternalLink, ClipboardCheck } from 'lucide-react';
import { ld, GATE_STATUS, fmtDate, openContent } from '@/lib/ld';

const Stat = ({ icon: Icon, label, value, tone = 'text-gray-900' }) => (
  <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
    <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><Icon className="w-5 h-5" /></div>
    <div><div className={`text-xl font-bold ${tone}`}>{value}</div><div className="text-xs text-gray-500">{label}</div></div>
  </div>
);

export const StatusPill = ({ status }) => {
  const s = GATE_STATUS[status] || { label: status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  return <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border font-medium ${s.cls}`}>{s.label}</span>;
};

export default function MyLearning() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try { setData(await ld('ld_getMyLearning')); }
    catch (e) { toast.error('Could not load your learning: ' + e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  if (!data) return null;
  const ind = data.induction;
  const next = data.next;

  const act = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const sendFeedback = async () => {
    await act('fb', () => ld('ld_submitFeedback', { assignment_id: feedback.assignment_id, induction_id: feedback.induction_id, rating: feedback.rating, comments: feedback.comments }), 'Thanks for your feedback');
    setFeedback(null);
  };
  const logCheckin = async () => {
    await act('ci', () => ld('ld_buddyCheckin', { induction_id: checkin.id, note }), 'Check-in logged');
    setCheckin(null); setNote('');
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><GraduationCap className="w-6 h-6 text-blue-600" /> My Learning</h1>
        <p className="text-sm text-gray-500">Your induction, assigned training, certificates and what to do next.</p>
      </div>

      {/* WHAT DO I NEED TO DO NEXT? */}
      {ind && (
        <Card className={`border-2 ${next?.overdue ? 'border-red-300 bg-red-50/40' : 'border-blue-200 bg-blue-50/40'}`}>
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-1">What do I need to do next?</div>
            {ind.status === 'COMPLETED' ? (
              <div className="flex items-center gap-3"><CheckCircle2 className="w-8 h-8 text-green-600" /><div><div className="text-lg font-bold">Induction complete 🎉</div><div className="text-sm text-gray-600">All mandatory steps are done. Your certificate is below.</div></div></div>
            ) : next ? (
              <div className="grid md:grid-cols-[1fr_auto] gap-4 items-center">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap"><span className="text-lg font-bold text-gray-900">{next.gate_id} · {next.gate_name}</span><StatusPill status={next.status} /></div>
                  <div className="text-sm text-gray-800"><b>Required action:</b> {next.required_action}</div>
                  <div className="text-sm text-gray-600 flex flex-wrap gap-x-5 gap-y-1">
                    <span className={next.overdue ? 'text-red-700 font-semibold' : ''}><Clock className="w-3.5 h-3.5 inline mr-1" />Due {fmtDate(next.due_date)}{next.overdue ? ' — overdue' : ''}</span>
                    <span>Approver: <b>{next.approver || '—'}</b></span>
                    {next.next_gate && <span>Next: {next.next_gate}</span>}
                  </div>
                </div>
                <Button onClick={() => nav(`/LdInductionDetail?id=${ind.id}`)} className="gap-2">Open <ArrowRight className="w-4 h-4" /></Button>
              </div>
            ) : (
              <div className="text-sm text-gray-700">Nothing is waiting for you right now — the next step unlocks automatically.</div>
            )}
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Induction progress</span><span>{ind.progress?.done}/{ind.progress?.total} steps · {ind.progress?.percent}%</span></div>
              <Progress value={ind.progress?.percent || 0} className="h-2" />
              <div className="flex flex-wrap gap-1.5 mt-3">
                {ind.gates.map(g => (
                  <span key={g.gate_id} title={`${g.name} — ${GATE_STATUS[g.status]?.label}`} className={`text-[10px] px-1.5 py-0.5 rounded border ${GATE_STATUS[g.status]?.cls}`}>{g.status === 'LOCKED' && <Lock className="w-2.5 h-2.5 inline mr-0.5" />}{g.gate_id}</span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {!ind && (
        <Card><CardContent className="p-5 text-sm text-gray-600">No induction is assigned to you. Your assigned training appears below.</CardContent></Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={BookOpen} label="Mandatory completed" value={`${data.stats.mandatory_done}/${data.stats.mandatory_total}`} />
        <Stat icon={AlertTriangle} label="Overdue" value={data.stats.overdue} tone={data.stats.overdue ? 'text-red-600' : 'text-gray-900'} />
        <Stat icon={Clock} label="Training hours" value={data.stats.hours} />
        <Stat icon={Award} label="Certificates" value={data.certificates.length} />
      </div>

      <Tabs defaultValue="learning">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="learning">My training ({data.assignments.length})</TabsTrigger>
          <TabsTrigger value="certs">Certificates ({data.certificates.length})</TabsTrigger>
          {data.actions_for_me.length > 0 && <TabsTrigger value="actions">Needs my action ({data.actions_for_me.length})</TabsTrigger>}
          {data.buddy_for.length > 0 && <TabsTrigger value="buddy">As a buddy ({data.buddy_for.length})</TabsTrigger>}
        </TabsList>

        <TabsContent value="learning" className="space-y-3">
          {data.assignments.length === 0 && <Card><CardContent className="p-6 text-center text-gray-500 text-sm">Nothing assigned yet.</CardContent></Card>}
          {data.assignments.map(a => (
            <Card key={a.id} className={a.overdue ? 'border-red-200' : ''}>
              <CardContent className="p-4 flex flex-wrap items-center gap-3 justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{a.course_title}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-3">
                    <span>{a.course?.category}</span>{a.course?.duration_min ? <span>{a.course.duration_min} min</span> : null}
                    <span className={a.overdue ? 'text-red-600 font-medium' : ''}>Due {fmtDate(a.due_date)}</span>
                    {a.mandatory && <Badge variant="outline" className="text-[10px] border-red-200 text-red-600">Mandatory</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={a.status === 'COMPLETED' ? 'border-green-300 text-green-700' : a.overdue ? 'border-red-300 text-red-700' : ''}>{a.overdue && a.status !== 'COMPLETED' ? 'Overdue' : a.status.replace('_', ' ')}</Badge>
                  {a.course?.file && <Button size="sm" variant="outline" onClick={() => openContent(a.course.file).catch(e => toast.error(e.message))}><ExternalLink className="w-3.5 h-3.5 mr-1" />Open</Button>}
                  {a.course?.content_url && <a href={a.course.content_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink className="w-3.5 h-3.5 mr-1" />Open</Button></a>}
                  {a.status === 'ASSIGNED' && <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, () => ld('ld_updateProgress', { assignment_id: a.id, action: 'start' }))}>Start</Button>}
                  {a.status !== 'COMPLETED' && a.status !== 'WAIVED' && (a.course?.assessment_id
                    ? <Link to={`/LdAssessment?assignment_id=${a.id}`}><Button size="sm"><ClipboardCheck className="w-3.5 h-3.5 mr-1" />Take assessment</Button></Link>
                    : <Button size="sm" disabled={busy === a.id} onClick={() => act(a.id, () => ld('ld_updateProgress', { assignment_id: a.id, action: 'complete' }), 'Marked complete')}>Mark complete</Button>)}
                  {a.status === 'COMPLETED' && <Button size="sm" variant="ghost" onClick={() => setFeedback({ assignment_id: a.id, title: a.course_title, rating: 5, comments: '' })}><Star className="w-3.5 h-3.5 mr-1" />Feedback</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="certs" className="space-y-3">
          {data.certificates.length === 0 && <Card><CardContent className="p-6 text-center text-gray-500 text-sm">No certificates yet.</CardContent></Card>}
          {data.certificates.map(c => (
            <Card key={c.id}><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-semibold flex items-center gap-2"><Award className="w-4 h-4 text-amber-500" />{c.title}</div>
                <div className="text-xs text-gray-500">{c.certificate_id} · issued {fmtDate(c.issue_date)}{c.expiry_date ? ` · expires ${fmtDate(c.expiry_date)}` : ''}{c.score != null ? ` · score ${c.score}%` : ''}</div></div>
              <div className="flex items-center gap-2"><Badge variant="outline" className={c.status === 'VALID' ? 'border-green-300 text-green-700' : c.status === 'EXPIRING' ? 'border-amber-300 text-amber-700' : 'border-red-300 text-red-700'}>{c.status}</Badge>
                <Link to={`/LdCertificate?id=${c.id}`}><Button size="sm" variant="outline">View / print</Button></Link></div>
            </CardContent></Card>
          ))}
        </TabsContent>

        <TabsContent value="actions" className="space-y-2">
          {data.actions_for_me.map((x, i) => (
            <Card key={i}><CardContent className="p-4 flex items-center justify-between gap-3">
              <div><div className="font-semibold">{x.employee} — {x.gate}</div><div className="text-xs text-gray-500">Due {fmtDate(x.due_date)}</div></div>
              <div className="flex items-center gap-2"><StatusPill status={x.status} /><Link to={`/LdInductionDetail?id=${x.induction_id}`}><Button size="sm">Open</Button></Link></div>
            </CardContent></Card>
          ))}
        </TabsContent>

        <TabsContent value="buddy" className="space-y-2">
          {data.buddy_for.map(b => (
            <Card key={b.id}><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" />{b.name}</div>
                <div className="text-xs text-gray-500">{b.department} · joined {fmtDate(b.doj)} · {b.progress?.percent}% through induction · {b.checkins} check-in(s){b.last_checkin ? `, last ${fmtDate(b.last_checkin)}` : ''}</div></div>
              <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => setCheckin(b)}>Log a check-in</Button></div>
            </CardContent></Card>
          ))}
          <p className="text-xs text-gray-500">A buddy is a peer, not the Reporting Manager — help with routines, introductions and the right SPOC. Formal approvals stay with the authorised roles.</p>
        </TabsContent>
      </Tabs>

      <Dialog open={!!feedback} onOpenChange={o => !o && setFeedback(null)}>
        <DialogContent><DialogHeader><DialogTitle>How was “{feedback?.title}”?</DialogTitle></DialogHeader>
          <div className="flex gap-1">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setFeedback(f => ({ ...f, rating: n }))}><Star className={`w-7 h-7 ${n <= (feedback?.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} /></button>)}</div>
          <Textarea placeholder="What worked, what didn't?" value={feedback?.comments || ''} onChange={e => setFeedback(f => ({ ...f, comments: e.target.value }))} />
          <Button onClick={sendFeedback} disabled={busy === 'fb'}>Submit feedback</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!checkin} onOpenChange={o => !o && setCheckin(null)}>
        <DialogContent><DialogHeader><DialogTitle>Check-in with {checkin?.name}</DialogTitle></DialogHeader>
          <Textarea placeholder="How are they settling in? Anything they need help with?" value={note} onChange={e => setNote(e.target.value)} />
          <Button onClick={logCheckin} disabled={busy === 'ci'}>Save check-in</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
