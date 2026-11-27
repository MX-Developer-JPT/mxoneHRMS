import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Download, RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, fmt } from '@/lib/mrf';
import { downloadBase64 } from '@/lib/mis';
import { selectCls } from './Pickers';

// Recruitment MIS — every figure is computed by the server from live requisitions, candidates, CV reviews, interviews and offers,
// and every figure opens the records behind it.
const VIEWS = [['overview', 'Overview'], ['matrix', 'MRF matrix'], ['delays', 'Bottlenecks'], ['performance', 'Departments, recruiters & budget'], ['compare', 'Comparisons']];
const SLA_CLS = {
  overdue: 'bg-red-100 text-red-800', delayed: 'bg-amber-100 text-amber-900', approaching: 'bg-amber-100 text-amber-900', on_track: 'bg-green-100 text-green-800', completed_on_time: 'bg-green-100 text-green-800',
  completed_late: 'bg-orange-100 text-orange-900',
};
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);
const inr = (n) => (n ? `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L` : '—');
const REFRESH_MS = 60000;
// the matrix columns that count candidates, with the funnel stage each one stands for
const STAGE_COLS = [['total_cvs', 'Total CVs', 0], ['shortlisted', 'Shortlisted', 1], ['sent_for_review', 'Sent for review', 2], ['hm_approved', 'Approved', 3], ['interviews_scheduled', 'Interviews scheduled', 4], ['interviews_completed', 'Interviews completed', 5],
  ['selected', 'Selected', 6], ['offers_released', 'Offers released', 7], ['offers_accepted', 'Offers accepted', 8], ['joined', 'Joined', 10]];

function Sla({ row }) { return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap ${SLA_CLS[row.sla_status] || 'bg-gray-100 text-gray-700'}`}>{row.sla_label}</span>; }

function Funnel({ stages, onStage, compact = false }) {
  const max = Math.max(1, stages[0]?.count || 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[560px]">
        <thead><tr className="text-left text-muted-foreground border-b"><th className="py-1.5 w-[26%]">Stage</th><th className="w-[34%]">Candidates</th><th className="pl-4">Conversion</th><th>Drop-off</th><th>Avg days</th><th>Waiting here</th></tr></thead>
        <tbody>{stages.map((s) => (
          <tr key={s.key} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" tabIndex={0} onClick={() => onStage(s)} onKeyDown={(e) => e.key === 'Enter' && onStage(s)} title={`Open the ${s.count} candidate(s) who reached “${s.label}”`}>
            <td className={compact ? 'py-1' : 'py-1.5'}>{s.label}</td>
            <td><div className="flex items-center gap-2"><div className="flex-1 h-3"><div className="h-3 rounded-r bg-blue-600" style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 3 : 0 }} /></div><b className="w-8 text-right tabular-nums">{s.count}</b></div></td>
            <td className="pl-4 tabular-nums">{s.conversion_pct === null ? '—' : `${s.conversion_pct}%`}</td><td className="tabular-nums">{s.dropoff_pct === null ? '—' : `${s.dropoff_pct}%`}</td><td className="tabular-nums">{dash(s.avg_days)}</td><td className="tabular-nums">{s.waiting || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Bars({ title, rows, onPick, empty = 'No data yet' }) {
  const max = Math.max(1, ...(rows || []).map((r) => r.value));
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {!rows?.some((r) => r.value) ? <p className="text-xs text-muted-foreground">{empty}</p> : rows.slice(0, 12).map((r) => (
          <button key={r.name} type="button" className="block w-full text-left text-xs rounded hover:bg-muted/50" onClick={() => onPick(`${title}: ${r.name}`, r.mrf_ids)}>
            <div className="flex justify-between"><span className="truncate pr-2">{r.name}</span><span className="font-medium">{r.value}</span></div>
            <div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-blue-600" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </button>
        ))}
      </CardContent></Card>
  );
}

function GroupTable({ title, first, rows, onPick, money = false }) {
  const heads = money ? [['mrfs', 'MRFs'], ['positions', 'Positions'], ['filled', 'Filled'], ['remaining', 'Remaining'], ['fill_pct', 'Fill %'], ['proposed_annual_ctc', 'Proposed annual CTC']]
    : [['mrfs', 'MRFs'], ['open', 'Open'], ['positions', 'Positions'], ['filled', 'Filled'], ['fill_pct', 'Fill %'], ['overdue', 'Overdue'], ['cvs', 'CVs'], ['shortlisted', 'Shortlisted'], ['interviews', 'Interviews'], ['offers', 'Offers'], ['accepted', 'Accepted'], ['joined', 'Joined'], ['avg_time_to_fill', 'Avg days to fill']];
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
      <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground border-b"><th className="py-2 pr-3">{first}</th>{heads.map(([k, l]) => <th key={k} className="pr-3 whitespace-nowrap">{l}</th>)}</tr></thead>
        <tbody>{rows.length === 0 && <tr><td colSpan={heads.length + 1} className="py-4 text-center text-muted-foreground">No records</td></tr>}
          {rows.map((r) => <tr key={r.key} className="border-b hover:bg-muted/40 cursor-pointer" tabIndex={0} onClick={() => onPick(`${first}: ${r.name}`, r.mrf_ids)} onKeyDown={(e) => e.key === 'Enter' && onPick(`${first}: ${r.name}`, r.mrf_ids)}>
            <td className="py-1.5 pr-3 font-medium">{r.name}</td>{heads.map(([k]) => <td key={k} className="pr-3 tabular-nums">{k === 'proposed_annual_ctc' ? inr(r[k]) : k === 'fill_pct' ? `${r[k]}%` : dash(r[k])}</td>)}</tr>)}
        </tbody></table>
    </CardContent></Card>
  );
}

export default function MrfDashboard({ onOpen, refreshKey = 0 }) {
  const [filters, setFilters] = useState({});
  const [view, setView] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [month, setMonth] = useState(() => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 7));
  const [reportReq, setReportReq] = useState('');
  const [reporting, setReporting] = useState('');   // 'month' | a requisition id
  const [drill, setDrill] = useState(null);        // { title, mrfIds, candidates | null }
  const [openRow, setOpenRow] = useState(null);
  const [openRule, setOpenRule] = useState(null);
  const seq = useRef(0);
  const set = (k, v) => setFilters((p) => ({ ...p, [k]: v || undefined }));

  const load = useCallback(async (quiet = false) => {
    const mine = ++seq.current; if (!quiet) setLoading(true);
    try { const d = await mrf('mrf_mis', { filters }); if (mine === seq.current) setData(d); } catch (e) { if (!quiet) toast.error(e.message); }
    if (mine === seq.current) setLoading(false);
  }, [filters]);
  useEffect(() => { load(); }, [load, refreshKey]);
  // candidate moves made elsewhere appear without a manual reload
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(true); };
    const t = setInterval(tick, REFRESH_MS); window.addEventListener('focus', tick);
    return () => { clearInterval(t); window.removeEventListener('focus', tick); };
  }, [load]);

  const byId = useMemo(() => new Map((data?.mrfs || []).map((m) => [m.id, m])), [data]);
  const pickMrfs = (title, mrfIds) => setDrill({ title, mrfIds, candidates: null });
  const pickStage = (stage, mrfId) => {
    const list = data.candidates.filter((c) => c.reached >= stage.index && (!mrfId || c.mrf_id === mrfId));
    setDrill({ title: `${mrfId ? `${byId.get(mrfId)?.mrf_no || byId.get(mrfId)?.designation} · ` : ''}${stage.label} (${list.length})`, mrfIds: [...new Set(list.map((c) => c.mrf_id))], candidates: list });
  };
  const pickKpi = (k) => {
    const ids = k.candidate_ids ? new Set(k.candidate_ids) : null;
    setDrill({ title: `${k.label}: ${dash(k.value)}${k.value !== null && k.unit ? ` ${k.unit}` : ''}`, mrfIds: k.mrf_ids, candidates: ids ? data.candidates.filter((c) => ids.has(c.id)) : null });
  };
  const exportXlsx = async () => {
    setExporting(true);
    try { const r = await mrf('mrf_mis_export', { filters }); downloadBase64(r.base64, r.filename, r.mime); toast.success(`${r.filename} downloaded`); } catch (e) { toast.error(e.message); }
    setExporting(false);
  };

  const funnelReport = async (key, args) => {
    setReporting(key);
    try { const r = await mrf('mrf_funnel_report', args); downloadBase64(r.base64, r.filename, r.mime); toast.success(`${r.filename} downloaded`); } catch (e) { toast.error(e.message); }
    setReporting('');
  };
  const spin = (key) => (reporting === key ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />);

  const o = data?.options || {};
  const sel = (key, all, list) => (
    <select className={selectCls} value={filters[key] || ''} onChange={(e) => set(key, e.target.value)} aria-label={all}>
      <option value="">{all}</option>{(list || []).map((x) => (typeof x === 'string' ? <option key={x} value={x}>FY {x}</option> : <option key={x.value} value={x.value}>{x.label}</option>))}
    </select>
  );

  return (
    <div className="space-y-4 min-w-0">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 [&>*]:min-w-0">
        {sel('fy', 'All financial years', o.financial_years)}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">From<Input type="date" className="min-w-0 px-2" value={filters.from || ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">To<Input type="date" className="min-w-0 px-2" value={filters.to || ''} onChange={(e) => set('to', e.target.value)} /></label>
        {sel('department', 'All departments', o.departments)}{sel('designation', 'All designations', o.designations)}{sel('tier', 'All tiers', o.tiers)}
        {sel('recruiter_id', 'All recruiters', o.recruiters)}{sel('hiring_manager_id', 'All hiring managers', o.hiring_managers)}{sel('budget_status', 'All budget statuses', o.budget_statuses)}
        {sel('requisition_type', 'All requisition types', o.requisition_types)}{sel('stage', 'All stages', o.stages)}{sel('sla_status', 'All SLA statuses', o.sla_statuses)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setFilters({})}>Clear filters</Button>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}><RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={exporting || !data}>{exporting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}Export all MIS data</Button>
        <span className="text-xs text-muted-foreground ml-auto">{data ? `${data.mrfs.length} requisition(s)${data.org_wide ? '' : ' — yours only'} · updated ${fmt(data.generated_at, true)}` : ''}</span>
      </div>
      <Card><CardContent className="p-3 space-y-2">
        <p className="text-sm font-medium">Matrix and funnel report (Excel)</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 [&>*]:min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Month<Input type="month" className="w-44 min-w-0" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
            <Button size="sm" onClick={() => funnelReport('month', { month, filters })} disabled={!!reporting || !month}>{spin('month')}Download month report</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${selectCls} flex-1 min-w-[12rem] !w-auto`} value={reportReq} onChange={(e) => setReportReq(e.target.value)} aria-label="Requisition for the report">
              <option value="">Choose a requisition</option>
              {(data?.mrfs || []).map((m) => <option key={m.id} value={m.id}>{[m.mrf_no || 'Older', m.designation, m.department].filter(Boolean).join(' · ')}</option>)}
            </select>
            <Button size="sm" onClick={() => funnelReport(reportReq, { requisition_id: reportReq })} disabled={!!reporting || !reportReq}>{spin(reportReq || 'none')}Download requisition report</Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">The month report covers requisitions submitted in that month: total funnel, matrix and one sheet per requisition. The filters above apply to it, except the financial year and dates.</p>
      </CardContent></Card>
      <div className="flex border-b overflow-x-auto">{VIEWS.map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${view === k ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground'}`}>{l}{k === 'delays' && data?.bottlenecks.length ? ` (${data.bottlenecks.reduce((s, b) => s + b.count, 0)})` : ''}</button>)}</div>

      {loading && !data ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div> : !data ? <p className="text-sm text-muted-foreground py-8 text-center">The report could not be loaded.</p> : (
        <>
          {view === 'overview' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
                {data.kpis.map((k) => (
                  <button key={k.key} type="button" onClick={() => pickKpi(k)} title={k.hint || 'Open the records'} className="rounded-lg border bg-card p-3 text-left hover:border-primary">
                    <p className="text-[11px] text-muted-foreground leading-tight">{k.label}</p>
                    <p className={`text-2xl font-bold ${k.key === 'overdue' && k.value ? 'text-red-600' : ''}`}>{k.value === null ? '—' : k.value}{k.value !== null && k.unit && <span className="text-xs font-normal text-muted-foreground ml-1">{k.unit}</span>}</p>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 [&>*]:min-w-0">
                <Card className="xl:col-span-2"><CardHeader className="pb-2"><CardTitle className="text-base">Recruitment funnel</CardTitle></CardHeader><CardContent><Funnel stages={data.funnel} onStage={(s) => pickStage(s)} />
                  <p className="text-[11px] text-muted-foreground mt-2">A candidate counts in every stage up to the furthest one reached. Average days is the time from the previous stage, where both dates are recorded.</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />Where hiring is stuck</CardTitle></CardHeader><CardContent className="space-y-1.5">
                  {data.bottlenecks.length === 0 && <p className="text-sm text-muted-foreground">Nothing is past its allowed time.</p>}
                  {data.bottlenecks.map((b) => <button key={b.rule} type="button" onClick={() => { setView('delays'); setOpenRule(b.rule); }} className="w-full flex justify-between gap-2 text-left text-sm rounded border p-2 hover:border-primary"><span>{b.label} <span className="text-xs text-muted-foreground">(over {b.limit} d)</span></span><b>{b.count}</b></button>)}
                </CardContent></Card>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 [&>*]:min-w-0">
                <Bars title="Vacancies by department" rows={data.analytics.by_department} onPick={pickMrfs} />
                <Bars title="Vacancies by position tier" rows={data.analytics.by_tier} onPick={pickMrfs} />
                <Bars title="Vacancies by requisition type" rows={data.analytics.by_type} onPick={pickMrfs} />
                <Bars title="Days open (open requisitions)" rows={data.analytics.ageing} onPick={pickMrfs} />
                <Bars title="Pending approvals by Hiring Manager" rows={data.analytics.pending_by_hiring_manager} onPick={pickMrfs} empty="Nothing waiting" />
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Turnaround</CardTitle></CardHeader><CardContent className="text-sm space-y-1.5">
                  <p>Average JD approval time: <b>{dash(data.analytics.avg_jd_approval_days)}</b>{data.analytics.avg_jd_approval_days !== null && ' days'}</p>
                  <p>Average time to publish: <b>{dash(data.analytics.avg_publication_days)}</b>{data.analytics.avg_publication_days !== null && ' days'}</p>
                  <p>Filled vs target date: <b>{data.analytics.target_vs_actual_days === null ? '—' : `${data.analytics.target_vs_actual_days > 0 ? '+' : ''}${data.analytics.target_vs_actual_days} days`}</b><span className="text-xs text-muted-foreground"> (positive = later)</span></p>
                </CardContent></Card>
              </div>
              {(data.data_quality.unlinked_count > 0 || data.data_quality.duplicates.length > 0) && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                  {data.data_quality.unlinked_count > 0 && <p>{data.data_quality.unlinked_count} candidate(s) are not linked to any requisition and are not counted here. <Link className="underline" to="/CandidateIntake">Link them in Candidate Intake</Link>.</p>}
                  {data.data_quality.duplicates.length > 0 && <p>{data.data_quality.duplicates.length} repeat record(s) of the same person on a requisition are counted once ({data.data_quality.duplicates.slice(0, 4).map((d) => `${d.name} · ${d.mrf_no || 'older'}`).join(', ')}{data.data_quality.duplicates.length > 4 ? '…' : ''}).</p>}
                </div>
              )}
            </>
          )}

          {view === 'matrix' && (
            <Card><CardContent className="p-0 overflow-auto max-h-[70vh]">
              <table className="text-xs w-max min-w-full">
                <thead className="sticky top-0 z-20 bg-muted"><tr className="text-left">
                  {['MRF ID', 'Department', 'Designation', 'Position tier', 'Hiring Manager', 'Recruiter', 'Budget status', 'Requisition type', 'Experience', 'Proposed CTC', 'Submitted', 'Target date', 'Current stage', ...STAGE_COLS.map((c) => c[1]), 'Positions remaining', 'Overall progress', 'Days elapsed', 'Days remaining', 'SLA status']
                    .map((h, i) => <th key={h} className={`px-2 py-2 font-medium whitespace-nowrap ${i === 0 ? 'sticky left-0 bg-muted z-10' : ''}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.mrfs.length === 0 && <tr><td colSpan={28} className="py-8 px-4 text-muted-foreground">No requisitions match these filters.</td></tr>}
                  {data.mrfs.map((m) => (
                    <React.Fragment key={m.id}>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="px-2 py-2 sticky left-0 bg-card whitespace-nowrap">
                          <button type="button" aria-label={openRow === m.id ? 'Hide funnel' : 'Show funnel'} aria-expanded={openRow === m.id} onClick={() => setOpenRow(openRow === m.id ? null : m.id)} className="align-middle mr-1">{openRow === m.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                          {m.v2 ? <button type="button" className="font-mono text-primary underline" onClick={() => onOpen(m.id)}>{m.mrf_no}</button> : <Link className="text-primary underline" to="/JobRequisitions">Older</Link>}
                        </td>
                        {[m.department, m.designation, m.tier_label, m.hiring_manager, m.recruiter, m.budget_label, m.type_label, m.experience, m.ctc_label, m.submission_date && fmt(m.submission_date), m.target_date && fmt(m.target_date)].map((v, i) => <td key={i} className="px-2 py-2 whitespace-nowrap">{dash(v)}</td>)}
                        <td className="px-2 py-2 whitespace-nowrap">{m.stage_label}{m.reopened && <span className="ml-1 rounded bg-blue-100 text-blue-800 px-1">Reopened</span>}{m.positions_withdrawn > 0 && <span className="ml-1 rounded bg-gray-100 px-1">{m.positions_withdrawn} withdrawn</span>}</td>
                        {STAGE_COLS.map(([key, label, index]) => (
                          <td key={key} className="px-2 py-1 min-w-[72px]">
                            <button type="button" className="w-full text-left rounded hover:bg-muted" disabled={!m[key]} onClick={() => pickStage({ index, label: data.stage_labels[index].label }, m.id)} title={m.total_cvs ? `${label}: ${m[key]} of ${m.total_cvs}` : label}>
                              <span className={`tabular-nums ${m[key] ? 'font-medium' : 'text-muted-foreground'}`}>{m[key]}</span>
                              <span className="block h-1 rounded bg-muted mt-0.5"><span className="block h-1 rounded bg-blue-600" style={{ width: `${m.total_cvs ? (m[key] / m.total_cvs) * 100 : 0}%` }} /></span>
                            </button>
                          </td>
                        ))}
                        <td className="px-2 py-2 tabular-nums">{m.remaining} <span className="text-muted-foreground">of {m.positions}</span></td>
                        <td className="px-2 py-2 min-w-[110px]"><div className="flex items-center gap-1.5"><div className="flex-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-blue-600" style={{ width: `${m.progress_pct}%` }} /></div><span className="tabular-nums">{m.progress_pct}%</span></div></td>
                        <td className="px-2 py-2 tabular-nums">{dash(m.days_elapsed)}</td><td className={`px-2 py-2 tabular-nums ${m.days_remaining < 0 ? 'text-red-600 font-medium' : ''}`}>{dash(m.days_remaining)}</td>
                        <td className="px-2 py-2"><Sla row={m} /></td>
                      </tr>
                      {openRow === m.id && (
                        <tr className="bg-muted/20 border-b"><td colSpan={28} className="p-3">
                          <div className="sticky left-3 w-[min(900px,85vw)] space-y-3">
                            <div className="flex flex-wrap gap-x-5 gap-y-1">
                              <span><b>{m.mrf_no || 'Older'}</b> · {m.designation}</span><span>Fulfilment <b>{m.fulfilment_pct}%</b> ({m.filled} of {m.positions})</span>
                              <span>Bottleneck: <b>{m.bottleneck ? `${m.bottleneck.label} — ${m.bottleneck.count}${m.bottleneck.breached ? `, longest ${m.bottleneck.max_days} days` : ''}` : 'none'}</b></span>
                              {m.on_hold_days > 0 && <span>On hold for {m.on_hold_days} day(s)</span>}
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => funnelReport(m.id, { requisition_id: m.id })} disabled={!!reporting}>{spin(m.id)}Excel report</Button>
                            </div>
                            <Funnel compact stages={m.funnel} onStage={(s) => pickStage(s, m.id)} />
                            <ol className="flex flex-wrap gap-1.5">{m.milestones.map((s) => <li key={s.key} className={`rounded border px-2 py-1 ${s.at ? 'bg-card' : 'text-muted-foreground'}`}><span className="block">{s.label}</span><b>{s.at ? fmt(s.at) : 'not yet'}</b></li>)}</ol>
                            {m.history.length > 0 && <details><summary className="cursor-pointer font-medium">History ({m.history.length})</summary><ul className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">{[...m.history].reverse().map((h, i) => <li key={i}>{fmt(h.at, true)} · <b>{h.by}</b> · {h.action.replace(/_/g, ' ')}{h.detail ? ` — ${h.detail}` : ''}</li>)}</ul></details>}
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          )}

          {view === 'delays' && (
            <div className="space-y-2">
              {data.bottlenecks.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nothing is past its allowed time. HR can change the times under Validation rules.</p>}
              {data.bottlenecks.map((b) => (
                <Card key={b.rule}><CardContent className="p-0">
                  <button type="button" aria-expanded={openRule === b.rule} className="w-full flex items-center gap-2 p-3 text-left text-sm" onClick={() => setOpenRule(openRule === b.rule ? null : b.rule)}>
                    {openRule === b.rule ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}<b className="flex-1">{b.label}</b><span className="text-xs text-muted-foreground">allowed {b.limit} day(s)</span><span className="rounded bg-amber-100 text-amber-900 px-2 py-0.5 text-xs">{b.count}</span>
                  </button>
                  {openRule === b.rule && (
                    <div className="overflow-x-auto border-t"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground border-b"><th className="p-2">Requisition</th><th>Position</th><th>Candidate</th><th>Waiting since</th><th>Days</th></tr></thead><tbody>
                      {b.items.map((i, n) => <tr key={n} className="border-b"><td className="p-2">{byId.get(i.mrf_id)?.v2 ? <button type="button" className="font-mono text-primary underline" onClick={() => onOpen(i.mrf_id)}>{i.mrf_no}</button> : 'Older'}</td><td>{i.designation}</td><td>{i.candidate_id ? <Link className="text-primary underline" to={`/Recruitment?candidate=${i.candidate_id}`}>{i.name}</Link> : i.name || '—'}</td><td>{fmt(i.since)}</td><td className="font-medium text-red-600">{i.days}</td></tr>)}
                    </tbody></table></div>
                  )}
                </CardContent></Card>
              ))}
            </div>
          )}

          {view === 'performance' && (
            <div className="space-y-3">
              <GroupTable title="Department-wise progress" first="Department" rows={data.departments} onPick={pickMrfs} />
              <GroupTable title="Recruiter-wise performance" first="Recruiter" rows={data.recruiters} onPick={pickMrfs} />
              <GroupTable title="Budget analysis" first="Budget status" rows={data.budget} onPick={pickMrfs} money />
              <p className="text-[11px] text-muted-foreground">Proposed annual CTC is the middle of each requisition’s CTC range × positions, leaving out cancelled and rejected requisitions. A requisition’s recruiter is the one assigned on it, else whoever sent its CVs for review or scheduled its interviews.</p>
            </div>
          )}

          {view === 'compare' && (
            <div className="space-y-3">
              <GroupTable title="Financial year comparison" first="Financial year" rows={data.comparisons.by_fy} onPick={pickMrfs} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 [&>*]:min-w-0">
                <Card><CardHeader className="pb-2"><CardTitle className="text-base">Month by month</CardTitle></CardHeader><CardContent className="overflow-x-auto">
                  <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground border-b"><th className="py-2">Month</th><th>MRFs submitted</th><th>CVs received</th><th>Offers released</th><th>Joined</th></tr></thead><tbody>
                    {data.comparisons.by_month.map((x) => <tr key={x.month} className="border-b hover:bg-muted/40 cursor-pointer" tabIndex={0} onClick={() => pickMrfs(`Activity in ${x.month}`, x.mrf_ids)} onKeyDown={(e) => e.key === 'Enter' && pickMrfs(`Activity in ${x.month}`, x.mrf_ids)}><td className="py-1.5 font-medium">{x.month}</td><td>{x.submitted}</td><td>{x.cvs}</td><td>{x.offers}</td><td>{x.joined}</td></tr>)}
                  </tbody></table>
                </CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-base">Date range against the period before</CardTitle></CardHeader><CardContent className="overflow-x-auto">
                  {!data.comparisons.periods ? <p className="text-sm text-muted-foreground">Choose both a From and a To date to compare that period with the equally long one before it.</p> : (
                    <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground border-b"><th className="py-2">Measure</th><th>{fmt(data.comparisons.periods.current.from)} – {fmt(data.comparisons.periods.current.to)}</th><th>{fmt(data.comparisons.periods.previous.from)} – {fmt(data.comparisons.periods.previous.to)}</th></tr></thead><tbody>
                      {data.comparisons.periods.rows.map((x) => <tr key={x.key} className="border-b"><td className="py-1.5">{x.label}{x.unit ? ` (${x.unit})` : ''}</td><td className="font-medium">{dash(x.current)}</td><td>{dash(x.previous)}</td></tr>)}
                    </tbody></table>
                  )}
                </CardContent></Card>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={!!drill} onOpenChange={(v) => !v && setDrill(null)}>
        <DialogContent className="max-w-4xl w-[96vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{drill?.title}</DialogTitle></DialogHeader>
          {drill && (
            <div className="space-y-4 text-xs">
              {drill.candidates && data?.candidates_hidden > 0 && <p className="rounded border bg-muted/40 p-2">Candidate records are shown only to HR, admin, recruiters and the requisition’s Hiring Manager. The counts include everyone.</p>}
              {drill.candidates && (
                <div className="overflow-x-auto"><p className="font-semibold mb-1">Candidates ({drill.candidates.length})</p>
                  <table className="w-full"><thead><tr className="text-left text-muted-foreground border-b"><th className="py-1.5">Candidate</th><th>Requisition</th><th>Position</th><th>Current status</th><th>Applied</th><th>In status since</th></tr></thead><tbody>
                    {drill.candidates.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No candidates</td></tr>}
                    {drill.candidates.slice(0, 500).map((c) => <tr key={c.id} className="border-b"><td className="py-1.5"><Link className="text-primary underline" to={`/Recruitment?candidate=${c.id}`}>{c.name}</Link></td><td className="font-mono">{c.mrf_no || 'Older'}</td><td>{c.designation}</td><td>{c.status_label}</td><td>{fmt(c.applied)}</td><td>{fmt(c.since)}</td></tr>)}
                  </tbody></table>
                  {drill.candidates.length > 500 && <p className="text-muted-foreground mt-1">First 500 shown — the Excel export has all of them.</p>}
                </div>
              )}
              <div className="overflow-x-auto"><p className="font-semibold mb-1">Requisitions ({drill.mrfIds.length})</p>
                <table className="w-full"><thead><tr className="text-left text-muted-foreground border-b"><th className="py-1.5">MRF</th><th>Position</th><th>Department</th><th>Current stage</th><th>Filled</th><th>SLA</th></tr></thead><tbody>
                  {drill.mrfIds.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No requisitions</td></tr>}
                  {drill.mrfIds.map((id) => byId.get(id)).filter(Boolean).map((m) => <tr key={m.id} className="border-b"><td className="py-1.5">{m.v2 ? <button type="button" className="font-mono text-primary underline" onClick={() => { setDrill(null); onOpen(m.id); }}>{m.mrf_no}</button> : <Link className="text-primary underline" to="/JobRequisitions">Older</Link>}</td><td>{m.designation}</td><td>{m.department}</td><td>{m.stage_label}</td><td>{m.filled}/{m.positions}</td><td><Sla row={m} /></td></tr>)}
                </tbody></table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
