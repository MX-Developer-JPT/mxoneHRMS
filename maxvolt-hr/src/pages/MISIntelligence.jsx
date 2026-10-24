import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, RefreshCw, Download, FileText, FileSpreadsheet, AlertTriangle, BarChart3, X, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { mis, downloadBase64, fmtD, todayIST, PERIODS, COMPARES } from '@/lib/mis';
import { OverviewTab, AttendanceTab, ExceptionsTab, LeaveTab, WorkforceTab, DepartmentsTab, GatePassTab, VisitorsTab, ReimbursementsTab, InsightsTab, DataQualityTab } from '@/components/misx/tabs';

const TABS = [
  ['overview', 'Overview'], ['attendance', 'Attendance'], ['exceptions', 'Exceptions'], ['leave', 'Leave'], ['workforce', 'Workforce & recruitment'],
  ['departments', 'Departments'], ['gatepass', 'Gate pass'], ['visitors', 'Visitors'], ['reimbursements', 'Reimbursements'], ['insights', 'Insights'], ['quality', 'Data quality'],
];
const LINK_TAB = { regularisation: 'attendance', workforce: 'workforce', attendance: 'attendance', leave: 'leave', exceptions: 'exceptions', gatepass: 'gatepass', visitors: 'visitors', reimbursements: 'reimbursements', departments: 'departments' };
const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
const Lbl = ({ t, children }) => <label className="text-[11px] text-gray-500 flex flex-col gap-1">{t}{children}</label>;
const DEFAULT = { preset: 'monthly', anchor: todayIST(), from: todayIST(), to: todayIST(), compare: 'previous', compare_from: '', compare_to: '', filters: {} };

export default function MISIntelligence() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const setTab = (t) => { const n = new URLSearchParams(sp); n.set('tab', LINK_TAB[t] || t); setSp(n, { replace: true }); window.scrollTo({ top: 0 }); };
  const [params, setParams] = useState(DEFAULT);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [role, setRole] = useState('');
  const [focusKey, setFocusKey] = useState(null);
  const seq = useRef(0);
  const key = useMemo(() => JSON.stringify(params), [params]);

  useEffect(() => { base44.auth.me().then(u => setRole(u?.custom_role || u?.role || '')).catch(() => {}); }, []);
  const fullAccess = ['hr', 'admin', 'management'].includes(role);

  const load = useCallback(async (force = false) => {
    const my = ++seq.current; // a slower, older response can never overwrite a newer one
    setLoading(true); setError('');
    try {
      const d = await mis('getMisAnalytics', { ...params, ...(force ? { _t: Date.now() } : {}) });
      if (my === seq.current) setData(d);
    } catch (e) {
      if (my === seq.current) setError(e.message || 'MIS data could not be retrieved');
    } finally { if (my === seq.current) setLoading(false); }
  }, [params]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [key]);

  const set = (patch) => setParams(p => ({ ...p, ...patch }));
  const setFilter = (k, v) => setParams(p => ({ ...p, filters: { ...p.filters, [k]: v } }));
  const applyFilter = (patch) => { setParams(p => ({ ...p, filters: { ...p.filters, ...patch } })); if (patch.department && patch.department !== 'all') setTab('departments'); };
  const opts = data?.meta?.filterOptions;
  const activeFilters = Object.entries(params.filters).filter(([, v]) => v && v !== 'all');
  const regParams = params; // registers are queried with the exact same filters as the dashboard

  const body = () => {
    if (!data) return null;
    const common = { d: data, params: regParams, setTab, applyFilter };
    switch (tab) {
      case 'attendance': return <AttendanceTab {...common} />;
      case 'exceptions': return <ExceptionsTab {...common} />;
      case 'leave': return <LeaveTab {...common} />;
      case 'workforce': return <WorkforceTab {...common} />;
      case 'departments': return <DepartmentsTab {...common} />;
      case 'gatepass': return <GatePassTab {...common} />;
      case 'visitors': return <VisitorsTab {...common} />;
      case 'reimbursements': return <ReimbursementsTab {...common} />;
      case 'insights': return <InsightsTab d={data} onRefresh={() => load(true)} focusKey={focusKey} canEdit={fullAccess} />;
      case 'quality': return <DataQualityTab {...common} />;
      default: return <OverviewTab d={data} setTab={setTab} onOpenInsight={(i) => { setFocusKey(i.key); setTab('insights'); }} />;
    }
  };
  const visibleTabs = TABS.filter(([id]) => fullAccess || !['visitors', 'reimbursements', 'quality'].includes(id));

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BarChart3 className="w-6 h-6 text-blue-600" />Intelligent MIS</h1>
          <p className="text-sm text-gray-500">Attendance, leave, workforce, recruitment, gate pass, visitors and reimbursements — one calculation engine for the screen and the exports.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(s => !s)}><SlidersHorizontal className="w-4 h-4 mr-1.5" />Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}</Button>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}><RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
          {fullAccess && <Button size="sm" onClick={() => setExportOpen(true)} disabled={!data}><Download className="w-4 h-4 mr-1.5" />Export</Button>}
        </div>
      </div>

      {/* period + comparison */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <Lbl t="Reporting period"><select className={cls} value={params.preset} onChange={e => set({ preset: e.target.value })}>{PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Lbl>
        {params.preset === 'custom'
          ? (<><Lbl t="From"><input type="date" className={cls} value={params.from} max={params.to} onChange={e => set({ from: e.target.value })} /></Lbl><Lbl t="To"><input type="date" className={cls} value={params.to} min={params.from} onChange={e => set({ to: e.target.value })} /></Lbl></>)
          : (<Lbl t={params.preset === 'daily' ? 'Date' : 'Any date in the period'}><input type="date" className={cls} value={params.anchor} onChange={e => set({ anchor: e.target.value })} /></Lbl>)}
        <Lbl t="Compare with"><select className={cls} value={params.compare} onChange={e => set({ compare: e.target.value })}>{COMPARES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Lbl>
        {params.compare === 'custom' && (<><Lbl t="Comparison from"><input type="date" className={cls} value={params.compare_from} onChange={e => set({ compare_from: e.target.value })} /></Lbl><Lbl t="Comparison to"><input type="date" className={cls} value={params.compare_to} min={params.compare_from} onChange={e => set({ compare_to: e.target.value })} /></Lbl></>)}
        {data && !loading && (
          <div className="ml-auto text-[11px] text-gray-500 leading-relaxed text-right">
            <div><b className="text-gray-700">{fmtD(data.meta.period.from)} – {fmtD(data.meta.period.to)}</b>{data.meta.period.elapsed ? ' (elapsed days only)' : ''} · vs {data.meta.compare ? `${fmtD(data.meta.compare.from)} – ${fmtD(data.meta.compare.to)}` : 'no comparison'}</div>
            <div>{data.meta.employeesInScope} active employees · {data.meta.workingCalendar.scheduledEmployeeDays} scheduled employee-days{data.meta.workingCalendar.holidays.length ? ` · holidays: ${data.meta.workingCalendar.holidays.map(h => `${fmtD(h.date).slice(0, 5)} ${h.name}`).join(', ')}` : ''}</div>
            <div>Data as of {new Date(data.meta.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })} IST{data.meta.scoped ? ' · your reporting team only' : ''}</div>
          </div>
        )}
      </div>

      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
          {[['department', 'Department', opts?.departments], ['location', 'Location / plant', opts?.locations], ['category', 'Employee category', opts?.categories], ['employment_status', 'Employment status', opts?.employmentStatuses], ['designation', 'Designation', opts?.designations]].map(([k, l, list]) => (
            <Lbl key={k} t={l}><select className={`${cls} max-w-[200px]`} value={params.filters[k] || 'all'} onChange={e => setFilter(k, e.target.value)}><option value="all">All</option>{(list || []).map(v => <option key={v} value={v}>{v}</option>)}</select></Lbl>
          ))}
          <Lbl t="Reporting manager"><select className={`${cls} max-w-[220px]`} value={params.filters.manager || 'all'} onChange={e => setFilter('manager', e.target.value)}><option value="all">All</option>{(opts?.managers || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Lbl>
          {!!activeFilters.length && <button className="h-9 text-sm text-blue-700 hover:underline" onClick={() => set({ filters: {} })}>Clear filters</button>}
        </div>
      )}
      {!showFilters && !!activeFilters.length && (
        <div className="flex flex-wrap items-center gap-2">{activeFilters.map(([k, v]) => <span key={k} className="inline-flex items-center gap-1 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-full px-2.5 py-1">{k.replace(/_/g, ' ')}: {k === 'manager' ? (opts?.managers.find(m => m.id === v)?.name || v) : v}<button onClick={() => setFilter(k, 'all')} aria-label={`Remove ${k} filter`}><X className="w-3 h-3" /></button></span>)}</div>
      )}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-2"><AlertTriangle className="w-5 h-5 shrink-0" /><div><b>MIS data could not be retrieved.</b> {error}<div className="text-xs mt-1">No figures are shown for this request — a failed retrieval is never displayed as zeros.{data ? ' The figures below are from the previous successful request, not the one you asked for.' : ''}</div><button className="underline mt-1" onClick={() => load(true)}>Try again</button></div></div>
      )}

      <div className="border-b border-gray-200 overflow-x-auto"><div className="flex gap-1 min-w-max">{visibleTabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{label}{id === 'insights' && data ? ` (${data.insights.filter(i => !['Resolved', 'Dismissed'].includes(i.status)).length})` : ''}</button>)}</div></div>

      <div className={loading && data ? 'opacity-60 pointer-events-none transition-opacity' : ''}>
        {!data && loading ? <div className="flex items-center justify-center py-24 text-gray-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" />Calculating from live records…</div> : body()}
      </div>

      {exportOpen && data && <ExportDialog data={data} params={params} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function ExportDialog({ data, params, onClose }) {
  const [fmt, setFmt] = useState('xlsx');
  const [o, setO] = useState({ include_insights: true, include_exceptions: true, include_charts: true, include_detail: true });
  const [busy, setBusy] = useState(false);
  const tog = (k) => setO(x => ({ ...x, [k]: !x[k] }));
  const run = async () => {
    setBusy(true);
    try {
      toast.info('Preparing report…');
      const d = await mis('exportMisIntelligence', { ...params, ...o, format: fmt });
      downloadBase64(d.base64, d.filename, d.mime);
      toast.success(`${d.filename} downloaded`);
      onClose();
    } catch (e) { toast.error('Export failed: ' + e.message); }
    setBusy(false);
  };
  const T = data.attendance.total;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Export Intelligent MIS</DialogTitle></DialogHeader>
        <div className="rounded-lg bg-gray-50 border p-3 text-xs text-gray-700 space-y-1">
          <div className="font-medium text-gray-900">Preview</div>
          <div>Period: <b>{fmtD(data.meta.period.from)} – {fmtD(data.meta.period.to)}</b> · Comparison: <b>{data.meta.compare ? `${fmtD(data.meta.compare.from)} – ${fmtD(data.meta.compare.to)}` : 'none'}</b></div>
          <div>Scope: {Object.entries(params.filters).filter(([, v]) => v && v !== 'all').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ') || 'whole company'}</div>
          <div>{data.meta.employeesInScope} active employees · {T.sched} scheduled employee-days · compliance {T.rates.compliance ?? 'n/a'}% · {data.insights.filter(i => i.status !== 'Dismissed').length} insights · {data.attendance.exceptionCount} attendance exceptions</div>
          <div>Reconciliation: {data.reconciliation.every(r => r.ok) ? <span className="text-green-700 font-medium">all checks pass</span> : <span className="text-red-700 font-medium">{data.reconciliation.filter(r => !r.ok).length} check(s) failed</span>}</div>
        </div>
        <div className="flex gap-2">
          {[['xlsx', 'Excel workbook', FileSpreadsheet, '11 analysis sheets + registers + definitions'], ['pdf', 'PDF report', FileText, 'Management-ready, with charts & methodology']].map(([id, l, Icon, sub]) => (
            <button key={id} onClick={() => setFmt(id)} className={`flex-1 text-left rounded-lg border p-3 ${fmt === id ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}><Icon className="w-5 h-5 text-blue-600 mb-1" /><div className="text-sm font-medium">{l}</div><div className="text-[11px] text-gray-500">{sub}</div></button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[['include_insights', 'Insights'], ['include_exceptions', 'Exceptions'], ['include_charts', 'Charts (PDF)'], ['include_detail', 'Employee / transaction detail (Excel)']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={o[k]} onChange={() => tog(k)} />{l}</label>)}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={run} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Generate</Button></div>
      </DialogContent>
    </Dialog>
  );
}
