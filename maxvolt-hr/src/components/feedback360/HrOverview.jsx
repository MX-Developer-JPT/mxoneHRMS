import { useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2, Search, Download, AlertTriangle, Users, Star, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { downloadBase64 } from '@/lib/ld';
import { ScoreBar, scoreText } from './shared';
import Feedback360Results from './Feedback360Results';

const SORTS = { overall_desc: 'Highest overall', overall_asc: 'Lowest overall', name: 'Name (A–Z)', raters: 'Most raters' };

// HR / admin: the 360° ratings of every employee for a period — who has been rated, how, and the full results of anyone.
export default function HrOverview() {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState('');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [show, setShow] = useState('all');
  const [sort, setSort] = useState('overall_desc');
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (per) => {
    try {
      const res = await base44.functions.invoke('get360Overview', per ? { period: per } : {});
      const r = res?.data || res;
      if (r?.success === false || r?.error) throw new Error(r.error || 'Could not load');
      setD(r); setPeriod(r.period);
    } catch (e) { toast.error(e.message || 'Could not load the ratings'); }
  }, []);
  useEffect(() => { load(null); }, [load]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await base44.functions.invoke('export360Feedback', { period });
      const r = res?.data || res;
      if (!r?.success) throw new Error(r?.error || 'Export failed');
      downloadBase64(r.base64, r.filename);
    } catch (e) { toast.error(e.message); }
    setExporting(false);
  };

  const departments = useMemo(() => [...new Set((d?.rows || []).map(r => r.department).filter(Boolean))].sort(), [d]);
  const rows = useMemo(() => {
    let list = (d?.rows || []).filter(r => (!dept || r.department === dept)
      && (show === 'all' || (show === 'rated' && r.reviewers > 0) || (show === 'none' && r.reviewers === 0) || (show === 'low' && r.reviewers > 0 && r.low_sample))
      && (!q || `${r.name} ${r.code} ${r.department} ${r.designation}`.toLowerCase().includes(q.toLowerCase())));
    const by = { overall_desc: (a, b) => (b.overall ?? -1) - (a.overall ?? -1), overall_asc: (a, b) => (a.overall ?? 99) - (b.overall ?? 99), name: (a, b) => a.name.localeCompare(b.name), raters: (a, b) => b.reviewers - a.reviewers };
    return [...list].sort(by[sort] || by.overall_desc);
  }, [d, q, dept, show, sort]);

  if (!d) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  const s = d.summary;
  const stat = (Icon, label, value, sub) => (
    <Card><CardContent className="p-3 sm:p-4 flex items-center gap-3"><div className="p-2 rounded-full bg-blue-50 text-blue-600"><Icon className="w-4 h-4" /></div><div className="min-w-0"><div className="text-xl font-bold text-gray-900 tabular-nums">{value}</div><div className="text-xs text-gray-500 leading-tight">{label}{sub ? <span className="block text-gray-400">{sub}</span> : null}</div></div></CardContent></Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2"><label htmlFor="ov-period" className="text-xs text-gray-500">Period</label>
          <select id="ov-period" value={period} onChange={e => { setPeriod(e.target.value); load(e.target.value); }} className="border rounded-md text-sm px-2 py-1.5 bg-white">{d.periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={exportXlsx} disabled={exporting}>{exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}Export to Excel</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat(Users, 'Employees rated', `${s.rated} / ${s.employees}`, `${s.coverage_pct}% coverage`)}
        {stat(Star, 'Average overall', s.average == null ? '—' : s.average.toFixed(1), 'out of 5, rated employees')}
        {stat(CheckCircle2, 'Self-assessments', s.self_done, `of ${s.employees} employees`)}
        {stat(AlertTriangle, 'Low sample', s.low_sample, `rated by fewer than ${d.min_raters} people`)}
      </div>

      {s.rated > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Company average by competency</CardTitle></CardHeader><CardContent className="space-y-2.5">
            {d.competencies.map(c => <div key={c.key}><div className="flex justify-between text-xs mb-1"><span className="text-gray-700">{c.label}</span><span className={`tabular-nums font-semibold ${scoreText(s.competency_avg[c.key])}`}>{s.competency_avg[c.key]?.toFixed(1) ?? '—'}</span></div><ScoreBar score={s.competency_avg[c.key]} /></div>)}
          </CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Average by department</CardTitle></CardHeader><CardContent className="space-y-2.5">
            {s.departments.slice(0, 8).map(x => <div key={x.department}><div className="flex justify-between text-xs mb-1"><span className="text-gray-700 truncate">{x.department} <span className="text-gray-400">· {x.rated} rated</span></span><span className={`tabular-nums font-semibold ${scoreText(x.average)}`}>{x.average?.toFixed(1)}</span></div><ScoreBar score={x.average} /></div>)}
          </CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input className="pl-8" placeholder="Search name, code, department" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select value={dept} onChange={e => setDept(e.target.value)} className="border rounded-md text-sm px-2 py-2 bg-white" aria-label="Department"><option value="">All departments</option>{departments.map(x => <option key={x} value={x}>{x}</option>)}</select>
        <select value={show} onChange={e => setShow(e.target.value)} className="border rounded-md text-sm px-2 py-2 bg-white" aria-label="Show"><option value="all">Everyone</option><option value="rated">Rated</option><option value="none">Not rated yet</option><option value="low">Low sample</option></select>
        <select value={sort} onChange={e => setSort(e.target.value)} className="border rounded-md text-sm px-2 py-2 bg-white" aria-label="Sort">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <p className="text-xs text-gray-500">{rows.length} employee{rows.length === 1 ? '' : 's'}. You see every rating and the anonymous comments, but never who gave them. Tap a row for the full results.</p>

      <div className="hidden md:block rounded-xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="px-3 py-2 font-medium">Employee</th><th className="px-3 py-2 font-medium">Raters</th><th className="px-3 py-2 font-medium w-44">Overall</th>{d.competencies.map(c => <th key={c.key} className="px-2 py-2 font-medium whitespace-nowrap">{c.short || c.label}</th>)}<th className="px-3 py-2 font-medium">Self</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.user_id} className="border-b last:border-0 hover:bg-blue-50/40 cursor-pointer" onClick={() => setOpen(r)}>
                <td className="px-3 py-2"><div className="font-medium text-gray-900">{r.name}</div><div className="text-xs text-gray-500">{[r.code, r.department].filter(Boolean).join(' · ')}</div></td>
                <td className="px-3 py-2 tabular-nums">{r.reviewers}{r.reviewers > 0 && r.low_sample && <span title="Low sample" className="ml-1 text-orange-600">⚠</span>}</td>
                <td className="px-3 py-2">{r.overall == null ? <span className="text-xs text-gray-400">Not rated</span> : <div className="flex items-center gap-2"><span className={`w-8 font-semibold tabular-nums ${scoreText(r.overall)}`}>{r.overall.toFixed(1)}</span><div className="flex-1"><ScoreBar score={r.overall} /></div></div>}</td>
                {d.competencies.map(c => <td key={c.key} className={`px-2 py-2 tabular-nums ${scoreText(r.scores[c.key])}`}>{r.scores[c.key]?.toFixed(1) ?? '—'}</td>)}
                <td className="px-3 py-2 tabular-nums text-gray-600">{r.self_overall?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={d.competencies.length + 4} className="px-3 py-10 text-center text-gray-400">No employees match.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {rows.map(r => (
          <button key={r.user_id} type="button" onClick={() => setOpen(r)} className="w-full text-left rounded-xl border bg-white p-3 space-y-2">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="font-medium text-gray-900 truncate">{r.name}</div><div className="text-xs text-gray-500 truncate">{[r.code, r.department].filter(Boolean).join(' · ')}</div></div>
              <div className="text-right shrink-0">{r.overall == null ? <span className="text-xs text-gray-400">Not rated</span> : <span className={`text-lg font-bold tabular-nums ${scoreText(r.overall)}`}>{r.overall.toFixed(1)}</span>}<div className="text-[11px] text-gray-500">{r.reviewers} rater{r.reviewers === 1 ? '' : 's'}{r.reviewers > 0 && r.low_sample ? ' ⚠' : ''}</div></div></div>
            {r.overall != null && <ScoreBar score={r.overall} />}
          </button>
        ))}
        {rows.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No employees match.</p>}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>360° results</DialogTitle></DialogHeader>
          {open && <Feedback360Results key={open.user_id + period} subjectUserId={open.user_id} initialPeriod={period} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
