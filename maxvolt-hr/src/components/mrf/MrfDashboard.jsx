import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, statusOf, PRIORITY_CLS, fmt, labelOf } from '@/lib/mrf';
import { selectCls } from './Pickers';

const CARDS = [['total', 'Total'], ['draft', 'Draft'], ['pending_jd_approval', 'Pending JD approval'], ['approved', 'Approved'], ['pending_hr_publication', 'Pending HR publication'], ['published', 'Published'],
  ['active_hiring', 'Active hiring'], ['filled', 'Filled'], ['on_hold', 'On hold'], ['cancelled', 'Cancelled / rejected'], ['overdue', 'Overdue']];

function Bars({ title, rows, unit = '', empty = 'No data yet' }) {
  const max = Math.max(1, ...(rows || []).map((r) => r.value));
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {!rows?.length ? <p className="text-xs text-muted-foreground">{empty}</p> : rows.slice(0, 12).map((r) => (
          <div key={r.name} className="text-xs">
            <div className="flex justify-between"><span className="truncate pr-2">{r.name}</span><span className="font-medium">{r.value}{unit}</span></div>
            <div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </div>
        ))}
      </CardContent></Card>
  );
}

export default function MrfDashboard({ options, onOpen }) {
  const masters = options?.masters || {};
  const [filters, setFilters] = useState({});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const set = (k, v) => setFilters((p) => ({ ...p, [k]: v || undefined }));
  useEffect(() => {
    let live = true; setLoading(true);
    mrf('mrf_dashboard', { filters }).then((d) => { if (live) setData(d); }).catch((e) => toast.error(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [filters]);
  const opts = (kind) => (masters[kind] || []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>);
  const designations = useMemo(() => [...new Set((data?.requisitions || []).map((r) => r.designation).filter(Boolean))].sort(), [data]);
  const hms = useMemo(() => { const m = new Map(); (data?.requisitions || []).forEach((r) => r.hiring_manager_id && m.set(r.hiring_manager_id, r.hiring_manager_name)); return [...m.entries()]; }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <select className={selectCls} value={filters.department || ''} onChange={(e) => set('department', e.target.value)}><option value="">All departments</option>{(options?.departments || []).map((d) => <option key={d.name}>{d.name}</option>)}</select>
        <select className={selectCls} value={filters.hiring_manager_id || ''} onChange={(e) => set('hiring_manager_id', e.target.value)}><option value="">All hiring managers</option>{hms.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <select className={selectCls} value={filters.position_tier || ''} onChange={(e) => set('position_tier', e.target.value)}><option value="">All tiers</option>{opts('position_tier')}</select>
        <select className={selectCls} value={filters.designation || ''} onChange={(e) => set('designation', e.target.value)}><option value="">All designations</option>{designations.map((d) => <option key={d}>{d}</option>)}</select>
        <Input placeholder="Location contains…" value={filters.location || ''} onChange={(e) => set('location', e.target.value)} />
        <select className={selectCls} value={filters.priority || ''} onChange={(e) => set('priority', e.target.value)}><option value="">All priorities</option>{opts('priority')}</select>
        <select className={selectCls} value={filters.requisition_type || ''} onChange={(e) => set('requisition_type', e.target.value)}><option value="">All types</option>{opts('requisition_type')}</select>
        <select className={selectCls} value={filters.employment_type || ''} onChange={(e) => set('employment_type', e.target.value)}><option value="">All employment types</option>{opts('employment_type')}</select>
        <select className={selectCls} value={filters.status || ''} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{['draft', 'pending_hm_approval', 'changes_requested', 'pending_hr_publication', 'published', 'on_hold', 'closed', 'cancelled', 'rejected'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
        <div className="flex items-center gap-1 text-xs"><span className="text-muted-foreground shrink-0">Raised</span><Input type="date" value={filters.req_from || ''} onChange={(e) => set('req_from', e.target.value)} /><Input type="date" value={filters.req_to || ''} onChange={(e) => set('req_to', e.target.value)} /></div>
        <div className="flex items-center gap-1 text-xs"><span className="text-muted-foreground shrink-0">Target</span><Input type="date" value={filters.target_from || ''} onChange={(e) => set('target_from', e.target.value)} /><Input type="date" value={filters.target_to || ''} onChange={(e) => set('target_to', e.target.value)} /></div>
        <Button variant="ghost" size="sm" onClick={() => setFilters({})}>Clear filters</Button>
      </div>

      {loading && !data ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {CARDS.map(([k, l]) => (
              <Card key={k}><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{l}</p><p className={`text-2xl font-bold ${k === 'overdue' && data.counts[k] ? 'text-red-600' : ''}`}>{data.counts[k] ?? 0}</p></CardContent></Card>
            ))}
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <Bars title="Vacancies by department" rows={data.analytics.by_department} />
            <Bars title="Vacancies by position tier" rows={data.analytics.by_tier} />
            <Bars title="New vs replacement hiring" rows={data.analytics.new_vs_replacement} />
            <Bars title="Ageing of open requisitions" rows={data.analytics.ageing} />
            <Bars title="Pending approvals by Hiring Manager" rows={data.analytics.pending_by_hiring_manager} empty="Nothing waiting" />
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Turnaround</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1.5">
                <p>Average JD approval time: <b>{data.analytics.avg_jd_approval_days ?? '—'}</b> {data.analytics.avg_jd_approval_days != null && 'days'}</p>
                <p>Average time to publish: <b>{data.analytics.avg_publication_days ?? '—'}</b> {data.analytics.avg_publication_days != null && 'days'}</p>
                <p>Filled vs target date: <b>{data.analytics.target_vs_actual_days == null ? '—' : `${data.analytics.target_vs_actual_days > 0 ? '+' : ''}${data.analytics.target_vs_actual_days} days`}</b><span className="text-xs text-muted-foreground"> (positive = later than target)</span></p>
              </CardContent></Card>
          </div>
          <Card><CardContent className="p-0">
            {data.requisitions.length === 0 ? <p className="text-center text-muted-foreground py-8 text-sm">No requisitions match these filters.</p> : (
              <div className="divide-y">
                {data.requisitions.map((r) => { const st = statusOf(r); return (
                  <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="w-full text-left p-3 hover:bg-muted/40 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{r.requisition_id}</span><span className="font-medium">{r.designation}</span>
                    <Badge className={st.cls}>{st.label}</Badge><Badge className={PRIORITY_CLS[r.priority] || ''}>{labelOf(masters, 'priority', r.priority)}</Badge>
                    {r.overdue && <Badge className="bg-red-100 text-red-700">Overdue</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{r.department} · HM {r.hiring_manager_name || '—'} · target {r.target_hire_date ? fmt(r.target_hire_date) : '—'} · {r.age_days}d old</span>
                  </button>
                ); })}
              </div>
            )}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
