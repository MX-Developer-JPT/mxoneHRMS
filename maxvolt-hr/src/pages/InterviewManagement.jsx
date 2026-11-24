import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, CalendarCheck, Clock, Users, CheckCircle2, XCircle, RefreshCw, Ban, MessageSquare, List, CalendarDays, BellRing, Video, MapPin, Search } from 'lucide-react';
import { toast } from 'sonner';
import { rh, statusLabel, statusCls, fmtDT } from '@/lib/hiring';
import CandidateActivity from '@/components/recruitment/CandidateActivity';
import RecruitmentSettingsDialog from '@/components/recruitment/RecruitmentSettingsDialog';

const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const at = (i) => `${String(i.scheduled_date).slice(0, 16)}:00+05:30`;
const modeText = (m) => ({ video: 'Online', in_person: 'Offline', phone: 'Phone' }[m] || m);
const STATUS_BADGE = { scheduled: 'bg-purple-100 text-purple-800', completed: 'bg-green-100 text-green-800', cancelled: 'bg-gray-200 text-gray-700' };
const REC = { select: 'Select', reject: 'Reject', hold: 'On Hold', next_round: 'Next Round' };

function Stat({ label, value, icon: Icon, tone, active, onClick }) {
  return (
    <button onClick={onClick} className={`text-left rounded-xl border p-3 bg-white hover:shadow-md transition ${active ? 'ring-2 ring-blue-400' : ''}`}>
      <div className="flex items-center justify-between"><span className="text-xs text-gray-500">{label}</span><Icon className={`w-4 h-4 ${tone}`} /></div>
      <p className="text-2xl font-bold mt-1">{value ?? 0}</p>
    </button>
  );
}

export default function InterviewManagement() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState({ stats: {}, interviews: [] });
  const [opts, setOpts] = useState({ rounds: [], awaiting: [], criteria: [] });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [day, setDay] = useState('');
  const [f, setF] = useState({ status: 'all', department: 'all', requisition_id: '', interviewer_id: '', from: '', to: '', q: '' });
  const [pick, setPick] = useState(new Set());
  const [sched, setSched] = useState(null);       // schedule dialog state
  const [resch, setResch] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [fb, setFb] = useState(null);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canManage = ['hr', 'admin', 'recruiter'].includes(user?.custom_role || user?.role) || ['hr', 'admin', 'recruiter'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me(); setUser(me);
      const filters = { department: f.department, requisition_id: f.requisition_id || undefined, interviewer_id: f.interviewer_id || undefined, from: f.from || undefined, to: f.to || undefined };
      const [l, o, u] = await Promise.all([rh('rh_interview_list', filters), rh('rh_interview_options').catch(() => ({ rounds: [], awaiting: [], criteria: [] })), base44.functions.invoke('getAllUsers', {}).catch(() => null)]);
      setData(l); setOpts(o); setUsers(((u?.data || u)?.users || []).filter((x) => x.full_name));
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, [f.department, f.requisition_id, f.interviewer_id, f.from, f.to]);
  useEffect(() => { load(); }, [load]);

  const uname = (id) => users.find((u) => u.id === id)?.full_name || '';
  const depts = useMemo(() => [...new Set([...data.interviews.map((i) => i.department), ...opts.awaiting.map((a) => a.department)].filter(Boolean))].sort(), [data, opts]);
  const mrfs = useMemo(() => { const m = new Map(); for (const x of [...data.interviews, ...opts.awaiting]) if (x.requisition_id && x.mrf_no) m.set(x.requisition_id, x.mrf_no); return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])); }, [data, opts]);

  const rows = useMemo(() => data.interviews.filter((i) => {
    if (f.status === 'pending_feedback' && !i.feedback_pending) return false;
    if (f.status === 'rescheduled' && !(i.reschedule_count > 0)) return false;
    if (!['all', 'pending_feedback', 'rescheduled'].includes(f.status) && i.status !== f.status) return false;
    if (day && String(i.scheduled_date).slice(0, 10) !== day) return false;
    const q = f.q.trim().toLowerCase();
    return !q || `${i.candidate_name} ${i.position} ${i.mrf_no || ''} ${i.round_name}`.toLowerCase().includes(q);
  }), [data, f, day]);

  const run = async (fn, params, ok) => {
    setBusy(true);
    try { const d = await rh(fn, params); if (ok) toast.success(ok); await load(); return d; } catch (e) { toast.error(e.message); return e.data || null; } finally { setBusy(false); }
  };

  // ── schedule ──
  const openSchedule = (ids) => setSched({ ids, round_key: opts.rounds[0]?.key || '', interviewer_ids: [], date: '', time: '10:00', duration_minutes: 45, mode: 'video', meeting_link: '', location: '', instructions: '', remarks: '', stagger: false, notify: true, override_reason: '', results: null });
  const submitSchedule = async () => {
    setBusy(true);
    try {
      const d = await rh('rh_interview_schedule', { candidate_ids: sched.ids, ...sched });
      const bad = d.results.filter((r) => !r.ok);
      toast.success(`${d.scheduled} interview(s) scheduled${d.results.some((r) => r.emailed) ? ' — invitations sent' : ''}`);
      if (bad.length) setSched({ ...sched, ids: bad.map((b) => b.candidate_id), results: bad }); else setSched(null);
      setPick(new Set()); await load();
    } catch (e) { const bad = e.data?.results?.filter((r) => !r.ok); if (bad?.length) setSched({ ...sched, results: bad }); toast.error(e.message === 'Something went wrong' && bad?.length ? bad[0].error : e.message); }
    setBusy(false);
  };

  // ── calendar ──
  const cal = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)); const lead = first.getUTCDay(); const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Array.from({ length: lead }, () => null).concat(Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`));
    return cells;
  }, [month]);
  const byDay = useMemo(() => { const m = {}; for (const i of data.interviews) { if (i.status === 'cancelled') continue; const d = String(i.scheduled_date).slice(0, 10); (m[d] = m[d] || []).push(i); } return m; }, [data]);

  const S = data.stats || {};
  const mine = (i) => (i.interviewer_ids || []).includes(user?.id);
  if (loading && !user) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Interview Management</h1>
          <p className="text-sm text-gray-500 mt-1">Only candidates the Hiring Manager / HOD recommended by email appear in the scheduling pool.</p>
        </div>
        {canManage && <div className="flex gap-2"><Button variant="outline" onClick={() => run('rh_interview_remind_feedback', {}, 'Feedback reminders sent')} disabled={busy}><BellRing className="w-4 h-4 mr-1" />Remind pending feedback</Button><Button onClick={load} variant="outline"><RefreshCw className="w-4 h-4" /></Button>{['hr', 'admin'].includes(user?.custom_role || user?.role) && <Button variant="outline" onClick={() => setSettingsOpen(true)}>Settings</Button>}</div>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Awaiting interview" value={S.awaiting} icon={Users} tone="text-violet-500" onClick={() => document.getElementById('awaiting')?.scrollIntoView({ behavior: 'smooth' })} />
        <Stat label="Scheduled" value={S.scheduled} icon={CalendarCheck} tone="text-purple-500" active={f.status === 'scheduled'} onClick={() => setF({ ...f, status: 'scheduled' })} />
        <Stat label="Completed" value={S.completed} icon={CheckCircle2} tone="text-green-500" active={f.status === 'completed'} onClick={() => setF({ ...f, status: 'completed' })} />
        <Stat label="Rescheduled" value={S.rescheduled} icon={RefreshCw} tone="text-amber-500" active={f.status === 'rescheduled'} onClick={() => setF({ ...f, status: 'rescheduled' })} />
        <Stat label="Cancelled" value={S.cancelled} icon={Ban} tone="text-gray-500" active={f.status === 'cancelled'} onClick={() => setF({ ...f, status: 'cancelled' })} />
        <Stat label="Selected" value={S.selected} icon={CheckCircle2} tone="text-emerald-500" onClick={() => setF({ ...f, status: 'all' })} />
        <Stat label="Rejected" value={S.rejected} icon={XCircle} tone="text-red-500" onClick={() => setF({ ...f, status: 'all' })} />
        <Stat label="Feedback pending" value={S.feedback_pending} icon={Clock} tone="text-orange-500" active={f.status === 'pending_feedback'} onClick={() => setF({ ...f, status: 'pending_feedback' })} />
      </div>

      {canManage && (
        <Card id="awaiting"><CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <p className="font-semibold">Candidates awaiting an interview ({opts.awaiting.length})</p>
            <Button size="sm" disabled={!pick.size} onClick={() => openSchedule([...pick])}><CalendarCheck className="w-4 h-4 mr-1" />Schedule {pick.size || ''} selected</Button>
          </div>
          {opts.awaiting.length === 0 ? <p className="text-sm text-gray-400 py-3">No candidates are waiting. Send CVs for review from the Candidates page; the ones the Hiring Manager / HOD shortlist by email show up here.</p> : (
            <div className="grid md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {opts.awaiting.map((c) => (
                <label key={c.id} className={`flex items-center gap-3 border rounded-lg px-3 py-2 cursor-pointer ${pick.has(c.id) ? 'bg-blue-50 border-blue-300' : ''}`}>
                  <input type="checkbox" checked={pick.has(c.id)} onChange={() => setPick((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.name}</p><p className="text-xs text-gray-500 truncate">{c.position || '—'}{c.mrf_no ? ` · ${c.mrf_no}` : ''}{c.rounds_done ? ` · ${c.rounds_done} round(s) done` : ''}</p></div>
                  <Badge className={statusCls(c.status)}>{c.status_label}</Badge>
                  <Button size="sm" variant="outline" className="h-7" onClick={(e) => { e.preventDefault(); openSchedule([c.id]); }}>Schedule</Button>
                </label>
              ))}
            </div>
          )}
        </CardContent></Card>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative"><Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" /><input className={`${cls} pl-7 w-52`} placeholder="Search candidate, MRF, round…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <select className={cls} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="all">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={cls} value={f.requisition_id} onChange={(e) => setF({ ...f, requisition_id: e.target.value })}><option value="">All MRFs</option>{mrfs.map(([id, no]) => <option key={id} value={id}>{no}</option>)}</select>
        <select className={cls} value={f.interviewer_id} onChange={(e) => setF({ ...f, interviewer_id: e.target.value })}><option value="">All interviewers</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
        <select className={cls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="rescheduled">Rescheduled</option><option value="cancelled">Cancelled</option><option value="pending_feedback">Feedback pending</option></select>
        <input type="date" className={cls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="From" /><input type="date" className={cls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="To" />
        <div className="ml-auto flex gap-1"><Button size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}><List className="w-4 h-4 mr-1" />List</Button><Button size="sm" variant={view === 'calendar' ? 'default' : 'outline'} onClick={() => setView('calendar')}><CalendarDays className="w-4 h-4 mr-1" />Calendar</Button></div>
      </div>

      {view === 'calendar' && (
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <input type="month" className={cls} value={month} onChange={(e) => { setMonth(e.target.value); setDay(''); }} />
            {day && <Button size="sm" variant="ghost" onClick={() => setDay('')}>Clear day filter</Button>}
          </div>
          <div className="grid grid-cols-7 gap-1 text-xs text-center text-gray-500 mb-1">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {cal.map((d, i) => d ? (
              <button key={i} onClick={() => setDay(day === d ? '' : d)} className={`min-h-[64px] rounded-lg border p-1 text-left text-xs hover:bg-blue-50 ${day === d ? 'ring-2 ring-blue-400' : ''} ${d === todayIST() ? 'bg-yellow-50' : 'bg-white'}`}>
                <div className="font-semibold text-gray-700">{Number(d.slice(8))}</div>
                {(byDay[d] || []).slice(0, 2).map((x) => <div key={x.id} className="truncate rounded bg-purple-100 text-purple-800 px-1 mt-0.5">{String(x.scheduled_date).slice(11, 16)} {x.candidate_name}</div>)}
                {(byDay[d] || []).length > 2 && <div className="text-gray-400 mt-0.5">+{byDay[d].length - 2} more</div>}
              </button>) : <div key={i} />)}
          </div>
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {loading ? <div className="py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : rows.length === 0 ? <p className="text-center text-gray-400 py-10">No interviews match these filters</p> : rows.map((i) => (
          <Card key={i.id}><CardContent className="p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="font-semibold text-blue-700 hover:underline" onClick={() => setHist(i)}>{i.candidate_name}</button>
                  <Badge className={STATUS_BADGE[i.status] || 'bg-gray-100'}>{i.status}</Badge>
                  <Badge variant="outline">{i.round_name || `Round ${i.round_number}`}</Badge>
                  {i.reschedule_count > 0 && <Badge className="bg-amber-100 text-amber-800">Rescheduled {i.reschedule_count}×</Badge>}
                  {i.feedback_pending && <Badge className="bg-orange-100 text-orange-800">Feedback pending{i.pending_interviewers?.length ? `: ${i.pending_interviewers.join(', ')}` : ''}</Badge>}
                  <Badge className={statusCls(i.candidate_status)}>{statusLabel(i.candidate_status)}</Badge>
                </div>
                <p className="text-sm text-gray-600 mt-1">{i.position || '—'}{i.mrf_no ? ` · ${i.mrf_no}` : ''} · {i.department || '—'}</p>
                <p className="text-sm text-gray-700 mt-1 flex items-center gap-3 flex-wrap"><span className="flex items-center gap-1"><CalendarCheck className="w-3.5 h-3.5" />{fmtDT(at(i))} · {i.duration_minutes} min</span><span className="flex items-center gap-1">{i.interview_mode === 'in_person' ? <MapPin className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}{modeText(i.interview_mode)}{(i.meeting_link || i.location) ? ` · ${i.meeting_link || i.location}` : ''}</span></p>
                <p className="text-xs text-gray-500 mt-1">Panel: {(i.interviewer_names || []).join(', ') || '—'}</p>
                {(i.feedbacks || []).length > 0 && <div className="mt-2 space-y-1">{i.feedbacks.map((b, k) => <p key={k} className="text-xs bg-gray-50 rounded px-2 py-1"><b>{b.interviewer_name}</b>: {REC[b.recommendation]} · {b.overall}/5{b.remarks ? ` — ${b.remarks}` : ''}</p>)}</div>}
              </div>
              <div className="flex flex-col gap-1.5">
                {i.status !== 'cancelled' && (mine(i) || canManage) && !(i.feedbacks || []).some((b) => b.interviewer_id === user?.id && i.status === 'completed') && <Button size="sm" onClick={() => setFb({ i, scores: {}, overall: 0, remarks: '', recommendation: '' })}><MessageSquare className="w-3.5 h-3.5 mr-1" />{(i.feedbacks || []).some((b) => b.interviewer_id === user?.id) ? 'Edit feedback' : 'Feedback'}</Button>}
                {canManage && i.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => setResch({ i, date: '', time: String(i.scheduled_date).slice(11, 16), reason: '', notify: true })}><RefreshCw className="w-3.5 h-3.5 mr-1" />Reschedule</Button>}
                {canManage && i.status === 'scheduled' && <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => setCancel({ i, reason: '', notify: true })}><Ban className="w-3.5 h-3.5 mr-1" />Cancel</Button>}
              </div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* schedule */}
      <Dialog open={!!sched} onOpenChange={(o) => !o && !busy && setSched(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Schedule interview{sched?.ids?.length > 1 ? `s (${sched.ids.length} candidates)` : ''}</DialogTitle></DialogHeader>
          {sched && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-gray-600">{sched.ids.map((id) => opts.awaiting.find((a) => a.id === id)?.name || id).join(', ')}</div>
              {sched.results?.map((r, k) => <p key={k} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{r.name}: {r.error}</p>)}
              {sched.results?.some((r) => r.needs_override) && <input className={`${cls} w-full`} placeholder="Reason for an authorised override (HR / admin)" value={sched.override_reason} onChange={(e) => setSched({ ...sched, override_reason: e.target.value })} />}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-500 flex flex-col gap-1">Round<select className={cls} value={sched.round_key} onChange={(e) => setSched({ ...sched, round_key: e.target.value })}>{opts.rounds.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">Mode<select className={cls} value={sched.mode} onChange={(e) => setSched({ ...sched, mode: e.target.value })}><option value="video">Online</option><option value="in_person">Offline (in person)</option><option value="phone">Phone</option></select></label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">Date<input type="date" min={todayIST()} className={cls} value={sched.date} onChange={(e) => setSched({ ...sched, date: e.target.value })} /></label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">Time<input type="time" className={cls} value={sched.time} onChange={(e) => setSched({ ...sched, time: e.target.value })} /></label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">Duration (minutes)<input type="number" min={10} max={480} className={cls} value={sched.duration_minutes} onChange={(e) => setSched({ ...sched, duration_minutes: e.target.value })} /></label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">{sched.mode === 'video' ? 'Meeting link' : 'Venue'}<input className={cls} value={sched.mode === 'video' ? sched.meeting_link : sched.location} onChange={(e) => setSched(sched.mode === 'video' ? { ...sched, meeting_link: e.target.value } : { ...sched, location: e.target.value })} placeholder={sched.mode === 'video' ? 'https://meet…' : 'Office / room'} /></label>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Interviewers / panel</p>
                <select className={`${cls} w-full`} value="" onChange={(e) => e.target.value && setSched({ ...sched, interviewer_ids: [...new Set([...sched.interviewer_ids, e.target.value])] })}><option value="">+ Add an interviewer…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
                <div className="flex gap-1.5 flex-wrap mt-1.5">{sched.interviewer_ids.map((id) => <span key={id} className="text-xs bg-gray-100 rounded px-2 py-1">{uname(id)} <button onClick={() => setSched({ ...sched, interviewer_ids: sched.interviewer_ids.filter((v) => v !== id) })}>×</button></span>)}</div>
              </div>
              <textarea className="w-full rounded-md border border-gray-300 p-2" rows={2} placeholder="Instructions for the candidate (shown in the invitation)" value={sched.instructions} onChange={(e) => setSched({ ...sched, instructions: e.target.value })} />
              <input className={`${cls} w-full`} placeholder="Internal remarks (optional)" value={sched.remarks} onChange={(e) => setSched({ ...sched, remarks: e.target.value })} />
              <div className="flex gap-4 flex-wrap text-xs">
                {sched.ids.length > 1 && <label className="flex items-center gap-1.5"><input type="checkbox" checked={sched.stagger} onChange={(e) => setSched({ ...sched, stagger: e.target.checked })} />One after another (each starts when the previous ends)</label>}
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={sched.notify} onChange={(e) => setSched({ ...sched, notify: e.target.checked })} />Send invitations to the candidate(s) and interviewers</label>
              </div>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSched(null)} disabled={busy}>Cancel</Button><Button onClick={submitSchedule} disabled={busy}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Schedule</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* reschedule */}
      <Dialog open={!!resch} onOpenChange={(o) => !o && setResch(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Reschedule — {resch?.i.candidate_name}</DialogTitle></DialogHeader>
          {resch && <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3"><input type="date" min={todayIST()} className={cls} value={resch.date} onChange={(e) => setResch({ ...resch, date: e.target.value })} /><input type="time" className={cls} value={resch.time} onChange={(e) => setResch({ ...resch, time: e.target.value })} /></div>
            <input className={`${cls} w-full`} placeholder="Reason" value={resch.reason} onChange={(e) => setResch({ ...resch, reason: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={resch.notify} onChange={(e) => setResch({ ...resch, notify: e.target.checked })} />Notify the candidate and interviewers</label>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setResch(null)}>Close</Button><Button disabled={busy || !resch.date} onClick={async () => { const d = await run('rh_interview_reschedule', { interview_id: resch.i.id, date: resch.date, time: resch.time, reason: resch.reason, notify: resch.notify }, 'Interview rescheduled'); if (d?.success !== false) setResch(null); }}>Reschedule</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* cancel */}
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Cancel interview — {cancel?.i.candidate_name}</DialogTitle></DialogHeader>
          {cancel && <div className="space-y-3 text-sm">
            <input className={`${cls} w-full`} placeholder="Reason for cancelling (required)" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cancel.notify} onChange={(e) => setCancel({ ...cancel, notify: e.target.checked })} />Notify the candidate and interviewers</label>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCancel(null)}>Keep interview</Button><Button className="bg-red-600 hover:bg-red-700" disabled={busy || cancel.reason.trim().length < 3} onClick={async () => { const d = await run('rh_interview_cancel', { interview_id: cancel.i.id, reason: cancel.reason, notify: cancel.notify }, 'Interview cancelled'); if (d?.success !== false) setCancel(null); }}>Cancel interview</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* feedback */}
      <Dialog open={!!fb} onOpenChange={(o) => !o && setFb(null)}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>Interview feedback — {fb?.i.candidate_name} ({fb?.i.round_name})</DialogTitle></DialogHeader>
          {fb && <div className="space-y-3 text-sm">
            {(opts.criteria.length ? opts.criteria : [['technical', 'Technical / Functional Competency'], ['communication', 'Communication Skills'], ['experience', 'Relevant Experience'], ['problem_solving', 'Problem-Solving Ability'], ['culture', 'Cultural / Role Alignment']]).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between gap-2"><span>{label}</span><div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setFb({ ...fb, scores: { ...fb.scores, [k]: n } })} className={`w-8 h-8 rounded border text-sm ${fb.scores[k] === n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}`}>{n}</button>)}</div></div>
            ))}
            <div className="flex items-center justify-between gap-2 border-t pt-2 font-semibold"><span>Overall rating</span><div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setFb({ ...fb, overall: n })} className={`w-8 h-8 rounded border text-sm ${fb.overall === n ? 'bg-amber-500 text-white border-amber-500' : 'bg-white'}`}>{n}</button>)}</div></div>
            <textarea className="w-full rounded-md border border-gray-300 p-2" rows={3} placeholder="Interview remarks" value={fb.remarks} onChange={(e) => setFb({ ...fb, remarks: e.target.value })} />
            <div className="flex gap-2 flex-wrap">{Object.entries(REC).map(([k, l]) => <button key={k} onClick={() => setFb({ ...fb, recommendation: k })} className={`px-3 py-1.5 rounded-md border text-sm ${fb.recommendation === k ? (k === 'select' ? 'bg-green-600 text-white' : k === 'reject' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white') : 'bg-white'}`}>{l}</button>)}</div>
            <p className="text-xs text-gray-500">Recorded against this candidate and round. With a panel, the stage moves on once every interviewer has submitted and they agree.</p>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setFb(null)}>Close</Button><Button disabled={busy || !fb.recommendation || !fb.overall} onClick={async () => { const d = await run('rh_interview_feedback', { interview_id: fb.i.id, scores: fb.scores, overall: fb.overall, remarks: fb.remarks, recommendation: fb.recommendation }, 'Feedback saved'); if (d && d.success !== false) setFb(null); }}>Submit feedback</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <RecruitmentSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={load} />

      {/* candidate-wise history */}
      <Dialog open={!!hist} onOpenChange={(o) => !o && setHist(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{hist?.candidate_name} — history</DialogTitle></DialogHeader>{hist && <CandidateActivity candidateId={hist.candidate_id} canAct={canManage} />}</DialogContent>
      </Dialog>
    </div>
  );
}
