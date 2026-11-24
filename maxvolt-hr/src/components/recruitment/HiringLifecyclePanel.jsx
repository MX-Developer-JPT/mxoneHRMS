import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Download, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { toast } from 'sonner';
import { rh, fmtD } from '@/lib/hiring';
import { downloadBase64 } from '@/lib/mis';

const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);
const TL = [['created', 'MRF created'], ['approved', 'MRF approved'], ['published', 'Job published'], ['first_application', 'First application'], ['first_screening', 'First CV screening'], ['first_cv_sent', 'First CV sent for review'], ['last_cv_sent', 'Last CV sent for review'],
  ['first_manager_response', 'First Manager / HOD response'], ['first_interview_scheduled', 'First interview scheduled'], ['first_interview_conducted', 'First interview conducted'], ['selection', 'Candidate selected'], ['offer_release', 'Offer released'], ['joining', 'Candidate joined'], ['closure', 'MRF closed']];
const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f97316', '#eab308', '#22c55e', '#10b981'];

function Kpi({ label, value, sub, tone = 'text-gray-900' }) {
  return <div className="rounded-xl border bg-white p-3"><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold ${tone}`}>{value}</p>{sub && <p className="text-xs text-gray-400">{sub}</p>}</div>;
}

// Timestamp-driven hiring lifecycle: turnaround per MRF, funnel, managers' response times, recruiter productivity, delays.
export default function HiringLifecyclePanel() {
  const [f, setF] = useState({ department: 'all', designation: 'all', hiring_manager_id: '', hod_id: '', recruiter_id: '', requisition_id: '', source: 'all', mrf_status: 'all', from: '', to: '' });
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});
  const [biz, setBiz] = useState(false);
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v && v !== 'all')); setD(await rh('rh_mis', { filters: clean })); } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const exportAs = async (format) => {
    setExporting(format);
    try { const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v && v !== 'all')); const r = await rh('rh_mis_export', { filters: clean, format }); downloadBase64(r.base64, r.filename, r.mime); toast.success(`${r.filename} downloaded`); } catch (e) { toast.error(e.message); }
    setExporting('');
  };

  if (loading && !d) return <div className="py-16 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading lifecycle analytics…</div>;
  if (!d) return null;
  const o = d.options || {}; const k = d.kpis;
  const val = (m) => (biz ? m.avg_biz : m.avg_cal);

  return (
    <div className="space-y-5">
      <Card><CardContent className="p-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500 flex flex-col gap-1">MRF created from<input type="date" className={cls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">to<input type="date" className={cls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <select className={cls} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="all">All departments</option>{(o.departments || []).map((x) => <option key={x}>{x}</option>)}</select>
        <select className={cls} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })}><option value="all">All designations</option>{(o.designations || []).map((x) => <option key={x}>{x}</option>)}</select>
        <select className={cls} value={f.hiring_manager_id} onChange={(e) => setF({ ...f, hiring_manager_id: e.target.value })}><option value="">All Hiring Managers</option>{(o.managers || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className={cls} value={f.hod_id} onChange={(e) => setF({ ...f, hod_id: e.target.value })}><option value="">All HODs</option>{(o.hods || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className={cls} value={f.recruiter_id} onChange={(e) => setF({ ...f, recruiter_id: e.target.value })}><option value="">All HR / recruiters</option>{(o.recruiters || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className={`${cls} max-w-[220px]`} value={f.requisition_id} onChange={(e) => setF({ ...f, requisition_id: e.target.value })}><option value="">All MRFs</option>{(o.requisitions || []).filter((r) => f.department === 'all' || r.department === f.department).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <select className={cls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="all">All sources</option>{(o.sources || []).map((x) => <option key={x}>{x}</option>)}</select>
        <select className={cls} value={f.mrf_status} onChange={(e) => setF({ ...f, mrf_status: e.target.value })}><option value="all">All MRF statuses</option>{(o.statuses || []).map((x) => <option key={x}>{x}</option>)}</select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportAs('xlsx')} disabled={!!exporting}>{exporting === 'xlsx' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}Excel</Button>
          <Button variant="outline" size="sm" onClick={() => exportAs('pdf')} disabled={!!exporting}>{exporting === 'pdf' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}PDF</Button>
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Requisitions" value={k.mrfs} sub={`${k.open_mrfs} open`} /><Kpi label="Applications" value={k.applications} />
        <Kpi label="CVs sent for review" value={k.cvs_sent} sub={`${k.review_batches} batch(es)`} /><Kpi label="Interviews" value={k.interviews} />
        <Kpi label="Selected" value={k.selected} tone="text-green-600" /><Kpi label="Joined" value={k.joined} tone="text-emerald-600" />
        <Kpi label="Reviews awaiting Manager / HOD" value={k.pending_reviews} sub={`${k.overdue_reviews} overdue`} tone={k.overdue_reviews ? 'text-red-600' : 'text-gray-900'} />
        <Kpi label="Interview feedback pending" value={k.pending_feedback} tone={k.pending_feedback ? 'text-orange-600' : 'text-gray-900'} />
        <Kpi label="Avg time to first CV" value={dash(val(d.metrics.time_to_first_cv))} sub="days" /><Kpi label="Avg manager response" value={dash(val(d.metrics.manager_response_tat))} sub="days" />
        <Kpi label="Avg selection TAT" value={dash(val(d.metrics.selection_tat))} sub="days from MRF creation" /><Kpi label="Avg time to fill" value={dash(val(d.metrics.time_to_fill))} sub="days" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recruitment funnel</CardTitle></CardHeader><CardContent>
          <div style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.funnel} layout="vertical" margin={{ left: 10, right: 60 }}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="stage" width={170} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v, n, p) => [`${v} (${p.payload.from_previous}% of previous · ${p.payload.of_total}% of all)`, 'Candidates']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>{d.funnel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}<LabelList dataKey="count" position="right" style={{ fontSize: 11 }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-gray-600">{d.funnel.slice(1).map((s) => <div key={s.stage} className="flex justify-between border-t py-1"><span>{s.stage}</span><b>{s.from_previous}%</b></div>)}</div>
        </CardContent></Card>

        <Card><CardHeader className="pb-2 flex-row items-center justify-between"><CardTitle className="text-base">Turnaround times (days)</CardTitle>
          <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={biz} onChange={(e) => setBiz(e.target.checked)} />Business days</label></CardHeader><CardContent>
          <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500 text-left"><th className="py-1">Metric</th><th>Average</th><th>Median</th><th>MRFs</th></tr></thead><tbody>
            {Object.entries(d.metrics).map(([key, m]) => <tr key={key} className="border-t"><td className="py-1.5"><div>{d.metric_labels[key]?.[0] || key}</div><div className="text-[11px] text-gray-400">{d.metric_labels[key]?.[1]}</div></td><td className="font-semibold">{dash(biz ? m.avg_biz : m.avg_cal)}</td><td>{biz ? '—' : dash(m.median_cal)}</td><td className="text-gray-500">{m.samples}</td></tr>)}
          </tbody></table>
          <p className="text-[11px] text-gray-400 mt-2">Calendar days from the recorded timestamps. Business days skip the weekly off and company holidays (configurable).</p>
        </CardContent></Card>
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-base">MRF-wise timeline</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2 w-6" /><th>MRF</th><th>Position</th><th>Department</th><th>Hiring Manager</th><th>Status</th><th>CVs sent</th><th>Batches</th><th>Mgr response</th><th>To first CV</th><th>Selection</th><th>Time to fill</th></tr></thead><tbody>
          {d.mrfs.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-gray-400">No requisitions match</td></tr>}
          {d.mrfs.map((m) => (
            <React.Fragment key={m.id}>
              <tr className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setOpen((s) => ({ ...s, [m.id]: !s[m.id] }))}>
                <td className="py-2">{open[m.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                <td className="font-mono">{m.id}</td><td className="font-medium">{m.title}</td><td>{m.department}</td><td>{m.hiring_manager || '—'}</td><td>{m.status}</td>
                <td>{m.counts.cvs_sent}</td><td>{m.counts.batches}</td><td>{dash(biz ? m.metrics.manager_response_tat.biz : m.metrics.manager_response_tat.cal)}</td><td>{dash(biz ? m.metrics.time_to_first_cv.biz : m.metrics.time_to_first_cv.cal)}</td><td>{dash(biz ? m.metrics.selection_tat.biz : m.metrics.selection_tat.cal)}</td><td>{dash(biz ? m.metrics.time_to_fill.biz : m.metrics.time_to_fill.cal)}</td>
              </tr>
              {open[m.id] && (
                <tr className="bg-gray-50"><td /><td colSpan={11} className="py-3">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1.5">{TL.map(([key, label]) => <div key={key} className="flex justify-between"><span className="text-gray-500">{label}</span><b>{fmtD(m.timeline[key])}</b></div>)}</div>
                  <div className="mt-2 text-gray-500">HOD: {m.hod || '—'} · positions {m.filled}/{m.positions} filled · applications {m.counts.applications} · interviews {m.counts.interviews} · offers {m.counts.offers}</div>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody></table>
      </CardContent></Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Department-wise</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Department</th><th>MRFs</th><th>Open</th><th>Apps</th><th>CVs sent</th><th>Interviews</th><th>Joined</th><th>Avg mgr response</th><th>Avg time to fill</th></tr></thead><tbody>
            {d.departments.map((x) => <tr key={x.department} className="border-b"><td className="py-1.5 font-medium">{x.department}</td><td>{x.mrfs}</td><td>{x.open}</td><td>{x.applications}</td><td>{x.cvs_sent}</td><td>{x.interviews}</td><td>{x.joined}</td><td>{dash(x.avg_manager_response)}</td><td>{dash(x.avg_time_to_fill)}</td></tr>)}
          </tbody></table>
        </CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recruiter productivity</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Recruiter</th><th>CVs screened</th><th>CVs submitted</th><th>Batches</th><th>Interviews coordinated</th><th>Hired</th></tr></thead><tbody>
            {d.recruiters.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400">No recruiter activity recorded yet</td></tr>}
            {d.recruiters.map((x) => <tr key={x.user_id} className="border-b"><td className="py-1.5 font-medium">{x.name || x.user_id}</td><td>{x.screened}</td><td>{x.cvs_submitted}</td><td>{x.batches}</td><td>{x.interviews_coordinated}</td><td>{x.hired}</td></tr>)}
          </tbody></table>
        </CardContent></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Waiting on Hiring Manager / HOD ({d.pending_reviews.length})</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Candidate</th><th>MRF</th><th>Reviewer</th><th>Sent</th><th>Days waiting</th></tr></thead><tbody>
            {d.pending_reviews.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-gray-400">No reviews are pending</td></tr>}
            {d.pending_reviews.slice(0, 40).map((x, i) => <tr key={i} className="border-b"><td className="py-1.5 font-medium">{x.candidate}</td><td className="font-mono">{x.requisition_id}</td><td>{x.reviewer} <span className="text-gray-400">({x.role === 'hod' ? 'HOD' : 'HM'})</span></td><td>{fmtD(x.sent)}</td><td className={x.overdue ? 'text-red-600 font-semibold' : ''}>{x.days_waiting}</td></tr>)}
          </tbody></table>
        </CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Interview feedback pending ({d.pending_feedback.length})</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b"><th className="py-2">Candidate</th><th>MRF</th><th>Round</th><th>Interviewers</th><th>Days overdue</th></tr></thead><tbody>
            {d.pending_feedback.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-gray-400">No feedback is pending</td></tr>}
            {d.pending_feedback.map((x, i) => <tr key={i} className="border-b"><td className="py-1.5 font-medium">{x.candidate}</td><td className="font-mono">{x.requisition_id}</td><td>{x.round}</td><td>{x.interviewers}</td><td className="text-orange-600 font-semibold">{x.days_overdue}</td></tr>)}
          </tbody></table>
        </CardContent></Card>
      </div>
    </div>
  );
}
