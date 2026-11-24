import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Loader2, Download, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';

const COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];
const KPIS = [['total', 'Total resignations'], ['this_month', 'This month'], ['pending_approvals', 'Pending approvals'], ['under_retention', 'Under retention'], ['accepted', 'Accepted'], ['serving_notice', 'Serving notice'],
  ['upcoming_7', 'Exits in 7 days'], ['upcoming_15', 'Exits in 15 days'], ['upcoming_30', 'Exits in 30 days'], ['pending_clearances', 'Pending clearances'], ['pending_kt', 'Pending KT'], ['pending_fnf', 'Pending F&F'], ['completed', 'Completed exits']];

const sel = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';

// Dashboard (KPIs + charts) and the exit register (search, filter, sort, page, Excel) for HR and management.
export default function ExitInsights({ onOpenCase }) {
  const [f, setF] = useState({ department: '', location: '', employment_type: '', from: '', to: '' });
  const [dash, setDash] = useState(null);
  const [reg, setReg] = useState(null);
  const [reg_f, setRegF] = useState({ q: '', status: '', page: 1, sort: 'resignation_date', dir: 'desc' });
  const [busy, setBusy] = useState(false);
  const setFilter = (k, v) => setF(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [d, r] = await Promise.all([
        base44.functions.invoke('ex_dashboard', f),
        base44.functions.invoke('ex_register', { ...f, ...reg_f, page_size: 15 }),
      ]);
      if (d?.data?.success) setDash(d.data); else toast.error(d?.data?.error || 'Could not load the dashboard');
      if (r?.data?.success) setReg(r.data);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }, [f, reg_f]);
  useEffect(() => { load(); }, [load]);

  const exportExcel = async () => {
    const r = await base44.functions.invoke('ex_register', { ...f, ...reg_f, page_size: 0 });
    const rows = r?.data?.rows || [];
    if (!rows.length) { toast.error('Nothing to export'); return; }
    const XLSX = await import('xlsx');
    const cols = [['reference_no', 'Reference No'], ['employee_code', 'Employee ID'], ['employee_name', 'Employee'], ['department', 'Department'], ['designation', 'Designation'], ['reporting_manager', 'Reporting Manager'], ['resignation_date', 'Resignation Date'], ['proposed_lwd', 'Proposed LWD'], ['approved_lwd', 'Approved LWD'], ['reason', 'Reason'], ['status', 'Status'], ['notice_status', 'Notice Period'], ['clearance_status', 'Clearance'], ['fnf_status', 'F&F']];
    const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c[1]), ...rows.map(x => cols.map(c => x[c[0]] ?? ''))]);
    ws['!cols'] = cols.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Exit register');
    XLSX.writeFile(wb, `Exit_Register_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const sortBy = (k) => setRegF(p => ({ ...p, sort: k, dir: p.sort === k && p.dir === 'desc' ? 'asc' : 'desc', page: 1 }));
  const pages = reg ? Math.max(1, Math.ceil(reg.total / reg.page_size)) : 1;
  const o = dash?.options || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <select className={sel} value={f.department} onChange={e => setFilter('department', e.target.value)}><option value="">All departments</option>{(o.departments || []).map(x => <option key={x}>{x}</option>)}</select>
        <select className={sel} value={f.location} onChange={e => setFilter('location', e.target.value)}><option value="">All locations</option>{(o.locations || []).map(x => <option key={x}>{x}</option>)}</select>
        <select className={sel} value={f.employment_type} onChange={e => setFilter('employment_type', e.target.value)}><option value="">All employee types</option>{(o.employment_types || []).map(x => <option key={x}>{x}</option>)}</select>
        <label className="text-xs text-gray-500">From <Input type="date" className="h-9 w-36 inline-block ml-1" value={f.from} onChange={e => setFilter('from', e.target.value)} /></label>
        <label className="text-xs text-gray-500">To <Input type="date" className="h-9 w-36 inline-block ml-1" value={f.to} onChange={e => setFilter('to', e.target.value)} /></label>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      {dash && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {KPIS.map(([k, label]) => (
              <Card key={k}><CardContent className="p-3"><p className="text-2xl font-bold text-gray-900">{dash.kpis[k]}</p><p className="text-xs text-gray-500">{label}</p></CardContent></Card>))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-3"><p className="text-2xl font-bold">{dash.avg_notice_served_days ?? '—'}</p><p className="text-xs text-gray-500">Avg notice served (days)</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-2xl font-bold">{dash.avg_fnf_days ?? '—'}</p><p className="text-xs text-gray-500">Avg F&F settlement time (days)</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-2xl font-bold">{dash.retention.success_rate == null ? '—' : `${dash.retention.success_rate}%`}</p><p className="text-xs text-gray-500">Retention success ({dash.retention.retained} of {dash.retention.discussions})</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-2xl font-bold">{(dash.voluntary.find(v => v.name === 'Voluntary')?.count || 0)} / {(dash.voluntary.find(v => v.name === 'Involuntary')?.count || 0)}</p><p className="text-xs text-gray-500">Voluntary / involuntary</p></CardContent></Card>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card><CardHeader className="pb-1"><CardTitle className="text-sm">Monthly resignation trend</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={220}><LineChart data={dash.trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="count" name="Resignations" stroke="#dc2626" strokeWidth={2} /></LineChart></ResponsiveContainer></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-sm">Reason-wise</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={dash.reasons} dataKey="count" nameKey="name" outerRadius={80} label={(e) => e.count}>{dash.reasons.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{dash.reasons.map((r, i) => <span key={r.name} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{r.name}</span>)}</div></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-sm">Department-wise (accepted exits)</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={Math.max(180, dash.department.length * 26)}><BarChart data={dash.department} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" name="Exits" fill="#2563eb" /></BarChart></ResponsiveContainer></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-sm">Designation-wise (accepted exits)</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={Math.max(180, dash.designation.length * 26)}><BarChart data={dash.designation} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" name="Exits" fill="#16a34a" /></BarChart></ResponsiveContainer></CardContent></Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Exit register {reg && <span className="text-sm font-normal text-gray-500">({reg.total})</span>}</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Input className="h-9 w-48" placeholder="Search name, ID, reference…" value={reg_f.q} onChange={e => setRegF(p => ({ ...p, q: e.target.value, page: 1 }))} />
            <select className={sel} value={reg_f.status} onChange={e => setRegF(p => ({ ...p, status: e.target.value, page: 1 }))}><option value="">All statuses</option>{(reg?.options?.statuses || []).map(x => <option key={x}>{x}</option>)}</select>
            <Button size="sm" variant="outline" onClick={exportExcel}><Download className="w-4 h-4 mr-1" />Excel</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500 border-b">
              {[['reference_no', 'Ref'], ['employee_name', 'Employee'], ['department', 'Department'], [null, 'Designation'], [null, 'Manager'], ['resignation_date', 'Resigned'], [null, 'Proposed LWD'], ['approved_lwd', 'Approved LWD'], [null, 'Reason'], ['status', 'Status'], [null, 'Notice'], [null, 'Clearance'], [null, 'F&F']].map(([k, l]) => (
                <th key={l} className="py-2 pr-3 whitespace-nowrap font-medium">{k ? <button className="inline-flex items-center gap-1" onClick={() => sortBy(k)}>{l}<ArrowUpDown className="w-3 h-3" /></button> : l}</th>))}
            </tr></thead>
            <tbody>
              {(reg?.rows || []).map(r => (
                <tr key={r.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => onOpenCase?.(r.id)}>
                  <td className="py-2 pr-3 whitespace-nowrap text-blue-700">{r.reference_no || '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap"><div className="font-medium text-gray-900">{r.employee_name}</div><div className="text-gray-400">{r.employee_code}</div></td>
                  <td className="py-2 pr-3">{r.department}</td><td className="py-2 pr-3">{r.designation}</td><td className="py-2 pr-3">{r.reporting_manager}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.resignation_date}</td><td className="py-2 pr-3 whitespace-nowrap">{r.proposed_lwd}</td><td className="py-2 pr-3 whitespace-nowrap">{r.approved_lwd || '—'}</td>
                  <td className="py-2 pr-3">{r.reason}</td><td className="py-2 pr-3"><Badge variant="outline" className="whitespace-nowrap">{r.status}</Badge></td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.notice_status}</td><td className="py-2 pr-3 whitespace-nowrap">{r.clearance_status}</td><td className="py-2 pr-3 whitespace-nowrap">{r.fnf_status}</td>
                </tr>))}
              {reg && reg.rows.length === 0 && <tr><td colSpan={13} className="py-8 text-center text-gray-400">No exit cases match.</td></tr>}
            </tbody>
          </table>
          {reg && pages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-3 text-sm">
              <Button size="sm" variant="outline" disabled={reg_f.page <= 1} onClick={() => setRegF(p => ({ ...p, page: p.page - 1 }))}>Previous</Button>
              <span>Page {reg_f.page} of {pages}</span>
              <Button size="sm" variant="outline" disabled={reg_f.page >= pages} onClick={() => setRegF(p => ({ ...p, page: p.page + 1 }))}>Next</Button>
            </div>)}
        </CardContent>
      </Card>
    </div>
  );
}
