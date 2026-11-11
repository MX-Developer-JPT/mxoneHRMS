import React, { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, ClipboardCheck, Users, CalendarClock, CheckCircle2, AlertTriangle, Target } from 'lucide-react';
import { ap, STATUS_TONE, CYCLE_TONE, label, fmtDate, inputCls } from '@/lib/appraisal';
import ReviewPanel from '@/components/appraisal/ReviewPanel';
import TeamTable from '@/components/appraisal/TeamTable';
import CyclesAdmin from '@/components/appraisal/CyclesAdmin';
import TemplatesAdmin from '@/components/appraisal/TemplatesAdmin';
import SettingsAdmin from '@/components/appraisal/SettingsAdmin';
import Analytics from '@/components/appraisal/Analytics';

const Stat = ({ icon: Icon, label: l, value, sub, tone = 'text-slate-900' }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-xs text-slate-500"><Icon className="w-4 h-4" />{l}</div><div className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</div>{sub && <div className="text-xs text-slate-400">{sub}</div>}</div>);

function DevPlans({ cycleId }) {
  const [d, setD] = useState(null);
  useEffect(() => { ap('ap_list_dev_plans', { cycle_id: cycleId }).then(setD).catch(e => toast.error(e.message)); }, [cycleId]);
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  return (<div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500 bg-slate-50"><th className="p-2">Employee</th><th>Skill gap</th><th>Recommended training</th><th>Category</th><th>Priority</th><th>Target</th><th>Status</th></tr></thead>
    <tbody>{d.plans.map(x => <tr key={x.id} className="border-t"><td className="p-2">{x.employee}</td><td>{x.skill_gap}</td><td>{x.recommended_training}{x.training_program_name && <div className="text-xs text-slate-400">Programme: {x.training_program_name}</div>}</td><td>{label(x.category)}</td><td>{label(x.priority)}</td><td>{fmtDate(x.target_date)}</td><td>{label(x.status)}</td></tr>)}
      {!d.plans.length && <tr><td colSpan={7} className="p-6 text-center text-slate-400">No training recommendations yet.</td></tr>}</tbody></table></div>);
}

export default function Appraisal() {
  const [dash, setDash] = useState(null); const [cycleId, setCycleId] = useState(''); const [tab, setTab] = useState('dashboard'); const [open, setOpen] = useState(null); const [tick, setTick] = useState(0); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const d = await ap('ap_dashboard', { cycle_id: cycleId || undefined }); setDash(d); if (!cycleId && d.cycle) setCycleId(d.cycle.id); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [cycleId]);
  useEffect(() => { load(); }, [load, tick]);
  const changed = () => setTick(t => t + 1);

  if (loading) return <div className="p-10 text-center"><Loader2 className="inline w-6 h-6 animate-spin text-slate-400" /></div>;
  const isHR = !!dash?.is_hr, isMgr = !!dash?.is_manager, me = dash?.me;
  const tabs = [['dashboard', 'Dashboard'], ...(me ? [['mine', 'My Appraisal']] : []), ...(isMgr || isHR ? [['team', isHR ? 'All Reviews' : 'Team Reviews']] : []), ['dev', 'Development Plans'], ...(isHR ? [['cycles', 'Cycles'], ['templates', 'KPI Templates'], ['analytics', 'Reports & Analytics'], ['settings', 'Settings']] : [])];

  if (open) return (<div className="p-4 md:p-6 max-w-6xl mx-auto"><Button variant="ghost" size="sm" className="mb-3" onClick={() => { setOpen(null); changed(); }}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button><ReviewPanel reviewId={open} onChanged={changed} /></div>);

  return (<div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
    <div className="flex flex-wrap items-center gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Performance Appraisal</h1><p className="text-sm text-slate-500">KPI-based reviews, self-assessment, manager evaluation, one-on-one meetings and HR calibration.</p></div>
      {dash?.cycles?.length > 0 && <select className={`${inputCls} w-72 ml-auto`} value={cycleId} onChange={e => setCycleId(e.target.value)}>{dash.cycles.map(c => <option key={c.id} value={c.id}>{c.name} · {label(c.status)}</option>)}</select>}</div>
    <div className="flex flex-wrap gap-1 border-b border-slate-200">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}</div>

    {!dash?.cycle && tab !== 'cycles' && tab !== 'templates' && tab !== 'settings' && tab !== 'analytics' && (
      <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-slate-500">{isHR ? 'No appraisal cycle exists yet. Open the Cycles tab to create one.' : 'There is no active appraisal cycle for you right now.'}</div>)}

    {dash?.cycle && tab === 'dashboard' && (<div className="space-y-5">
      <div className="rounded-lg border bg-white p-4 flex flex-wrap items-center gap-4"><div><div className="font-semibold">{dash.cycle.name}</div><div className="text-xs text-slate-500">Review period {fmtDate(dash.cycle.review_start)} – {fmtDate(dash.cycle.review_end)}</div></div><Badge className={`${CYCLE_TONE[dash.cycle.status]} border-0`}>{label(dash.cycle.status)}</Badge>
        <div className="ml-auto text-xs text-slate-600 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1">{[['Self-assessment', dash.cycle.deadlines.self], ['Manager evaluation', dash.cycle.deadlines.manager], ['Review meeting', dash.cycle.deadlines.meeting], ['HR finalisation', dash.cycle.deadlines.hr]].map(([l, v]) => <div key={l}><div className="text-slate-400">{l}</div><div className="font-medium">{fmtDate(v)}</div></div>)}</div></div>
      {me && <div className="space-y-2"><h3 className="font-semibold">My appraisal</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={ClipboardCheck} label="Status" value={<Badge className={`${STATUS_TONE[me.status] || ''} border-0 text-sm`}>{me.status_label}</Badge>} />
        <Stat icon={Target} label="Goals completed" value={`${me.goals_done}/${me.goals_total}`} sub={`${me.goal_completion}%`} /><Stat icon={CalendarClock} label="Self-assessment due" value={me.days_to_self_deadline == null ? '—' : me.days_to_self_deadline >= 0 ? `${me.days_to_self_deadline} days` : `${-me.days_to_self_deadline} days late`} tone={me.days_to_self_deadline < 0 ? 'text-red-600' : 'text-slate-900'} sub={fmtDate(me.self_deadline)} />
        <Stat icon={CheckCircle2} label="Result" value={me.final != null ? me.final : '—'} sub={me.band || 'Published after HR review'} /></div>
        <Button onClick={() => setOpen(me.review_id)}>Open my appraisal</Button></div>}
      {dash.team && <div className="space-y-2"><h3 className="font-semibold">{isHR ? 'Whole organisation' : 'My team'}</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Employees" value={(isHR ? dash.hr : dash.team).total} /><Stat icon={ClipboardCheck} label="Self-assessments pending" value={(isHR ? dash.hr : dash.team).self_pending} tone="text-amber-600" /><Stat icon={ClipboardCheck} label="Waiting for manager" value={(isHR ? dash.hr : dash.team).mgr_pending} tone="text-blue-600" /><Stat icon={CalendarClock} label="Meetings pending" value={(isHR ? dash.hr : dash.team).meetings_pending} />
        <Stat icon={CheckCircle2} label="Meetings completed" value={(isHR ? dash.hr : dash.team).meetings_completed} /><Stat icon={ClipboardCheck} label="Waiting for HR" value={(isHR ? dash.hr : dash.team).hr_pending} tone="text-purple-600" /><Stat icon={CheckCircle2} label="Finalised" value={(isHR ? dash.hr : dash.team).finalised} tone="text-emerald-600" /><Stat icon={AlertTriangle} label="Late self-assessments" value={(isHR ? dash.hr : dash.team).late_self} tone="text-red-600" /></div>
        {isHR && <p className="text-sm text-slate-500">Completion: {dash.hr.completion}%</p>}</div>}
    </div>)}

    {dash?.cycle && tab === 'mine' && me && <ReviewPanel key={me.review_id} reviewId={me.review_id} onChanged={changed} />}
    {dash?.cycle && tab === 'team' && <TeamTable cycleId={cycleId} isHR={isHR} onOpen={setOpen} refreshKey={tick} />}
    {dash?.cycle && tab === 'dev' && <DevPlans cycleId={cycleId} />}
    {isHR && tab === 'cycles' && <CyclesAdmin onChanged={changed} />}
    {isHR && tab === 'templates' && <TemplatesAdmin />}
    {isHR && tab === 'analytics' && <Analytics cycleId={cycleId} />}
    {isHR && tab === 'settings' && <SettingsAdmin />}
  </div>);
}
