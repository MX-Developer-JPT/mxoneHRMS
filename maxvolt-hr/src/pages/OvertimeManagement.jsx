import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Clock, DollarSign, Users, Download, AlertTriangle, Settings2 } from 'lucide-react';
import { downloadBase64 } from '@/lib/download';
import { safeDate } from '@/lib/dateUtils';

const VIEWS = [
  { key: 'day', label: 'Day-wise' }, { key: 'month', label: 'Month-wise' }, { key: 'department', label: 'Department-wise' },
  { key: 'employee', label: 'Employee-wise' }, { key: 'checks', label: 'Punches to check' },
];
const TYPE = { working: 'Working day', weekly_off: 'Weekly off', holiday: 'Holiday', half_holiday: 'Half-day holiday' };
const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const hrs = (m) => (Math.round((m / 60) * 100) / 100).toLocaleString('en-IN');
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const clock = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : '—');
const monthName = (m) => safeDate(`${m}-01`, 'MMM yyyy');
const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}` }; };

export default function OvertimeManagement() {
  const [period, setPeriod] = useState(thisMonth);
  const [department, setDepartment] = useState('all');
  const [userId, setUserId] = useState('all');
  const [allHistory, setAllHistory] = useState(false);
  const [view, setView] = useState('month');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);

  const params = () => ({
    ...(allHistory && userId !== 'all' ? {} : period),
    department: department === 'all' ? undefined : department,
    user_id: userId === 'all' ? undefined : userId,
  });

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await base44.functions.invoke('ot_report', params());
      setData(r?.data || r);
    } catch (e) { setError(e.message || 'Could not load overtime'); setData(null); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [period.from, period.to, department, userId, allHistory]);

  const download = async () => {
    setExporting(true);
    try {
      const r = await base44.functions.invoke('ot_export', { ...params(), view: view === 'checks' ? 'muster' : view });
      const d = r?.data || r;
      downloadBase64(d.base64, d.filename);
      toast.success('Overtime report downloaded');
    } catch (e) { toast.error(e.message || 'Download failed'); }
    setExporting(false);
  };

  const savePolicy = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke('ot_save_policy', { policy });
      toast.success('Overtime policy saved');
      setPolicy(null); load();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    setSaving(false);
  };

  const t = data?.totals;
  const p = data?.policy;
  const table = useMemo(() => {
    if (!data) return null;
    const total = (rows) => rows.reduce((s, r) => s + (r.ot_minutes || 0), 0);
    if (view === 'day') return { heads: ['Date', 'Employee', 'Department', 'Day type', 'In', 'Out', 'Worked', 'Standard', 'Overtime'], rows: data.days.map((d) => [safeDate(d.date, 'dd MMM yyyy'), `${d.employee_name} (${d.employee_code})`, d.department, TYPE[d.day_type], clock(d.first_in), clock(d.last_out), hm(d.worked_minutes), hm(d.standard_minutes), hm(d.ot_minutes)]) };
    if (view === 'month') return { heads: ['Month', 'Employee', 'Department', 'OT days', 'OT hours', 'Off-day hours', 'Amount'], rows: data.months.map((m) => [monthName(m.month), `${m.employee_name} (${m.employee_code})`, m.department, m.ot_days, hrs(m.ot_minutes), hrs(m.off_day_minutes), rupees(m.ot_amount)]) };
    if (view === 'department') return { heads: ['Department', 'Employees', 'OT days', 'OT hours', 'Off-day hours', 'Amount'], rows: data.departments.map((d) => [d.department, d.employees, d.ot_days, hrs(d.ot_minutes), hrs(d.off_day_minutes), rupees(d.ot_amount)]) };
    if (view === 'employee') return { heads: ['Employee', 'Department', 'Designation', 'OT days', 'OT hours', 'Off-day hours', 'Amount'], rows: data.employees.map((e) => [`${e.employee_name} (${e.employee_code})`, e.department, e.designation, e.ot_days, hrs(e.ot_minutes), hrs(e.off_day_minutes), rupees(e.ot_amount)]), footer: `Total ${hrs(total(data.employees))} hours` };
    return { heads: ['Date', 'Employee', 'Department', 'Worked', 'What to check'], rows: data.checks.map((d) => [safeDate(d.date, 'dd MMM yyyy'), `${d.employee_name} (${d.employee_code})`, d.department, hm(d.worked_minutes), d.notes]) };
  }, [data, view]);

  const LIMIT = 500;
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overtime Management</h1>
          <p className="text-gray-500 text-sm mt-1">Calculated from attendance punches, shift hours, weekly offs and holidays</p>
        </div>
        <div className="flex gap-2">
          {data?.can_edit && <Button variant="outline" onClick={() => setPolicy(policy ? null : { ...p, min_minutes: p.min_minutes ?? '' })}><Settings2 className="w-4 h-4 mr-2" />Policy</Button>}
          <Button onClick={download} disabled={exporting || loading || !data}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}Export Excel
          </Button>
        </div>
      </div>

      {policy && (
        <Card><CardContent className="p-4 space-y-3 text-sm">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="space-y-1"><span className="text-gray-600">Minimum extra minutes (blank = shift grace)</span><Input type="number" min="0" value={policy.min_minutes} onChange={(e) => setPolicy({ ...policy, min_minutes: e.target.value })} /></label>
            <label className="space-y-1"><span className="text-gray-600">Round down to (minutes)</span><Input type="number" min="1" max="60" value={policy.round_to_minutes} onChange={(e) => setPolicy({ ...policy, round_to_minutes: e.target.value })} /></label>
            <label className="space-y-1"><span className="text-gray-600">Do not count days longer than (hours)</span><Input type="number" min="8" max="24" value={policy.max_day_hours} onChange={(e) => setPolicy({ ...policy, max_day_hours: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={policy.eligible_only} onChange={(e) => setPolicy({ ...policy, eligible_only: e.target.checked })} />Only employees marked “Overtime eligible”</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={policy.off_day_all_hours} onChange={(e) => setPolicy({ ...policy, off_day_all_hours: e.target.checked })} />All hours worked on weekly offs and holidays are overtime</label>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={savePolicy} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save policy</Button>
            <Button size="sm" variant="ghost" onClick={() => setPolicy(null)}>Cancel</Button>
            <span className="text-xs text-gray-400">The pay multiplier ({p.multiplier}×) is set in Payroll Settings.</span>
          </div>
        </CardContent></Card>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-gray-500 space-y-1"><span className="block">Month</span><Input type="month" className="w-40" value={period.from.slice(0, 7)} disabled={allHistory} onChange={(e) => { if (!e.target.value) return; const [y, m] = e.target.value.split('-').map(Number); setPeriod({ from: `${e.target.value}-01`, to: `${e.target.value}-${pad(new Date(y, m, 0).getDate())}` }); }} /></label>
        <label className="text-xs text-gray-500 space-y-1"><span className="block">From</span><Input type="date" className="w-40" value={period.from} disabled={allHistory} onChange={(e) => e.target.value && setPeriod((x) => ({ ...x, from: e.target.value }))} /></label>
        <label className="text-xs text-gray-500 space-y-1"><span className="block">To</span><Input type="date" className="w-40" value={period.to} disabled={allHistory} onChange={(e) => e.target.value && setPeriod((x) => ({ ...x, to: e.target.value }))} /></label>
        <div className="w-52">
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All departments</SelectItem>{(data?.departments_list || []).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="w-60">
          <Select value={userId} onValueChange={(v) => { setUserId(v); if (v === 'all') setAllHistory(false); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All employees</SelectItem>{(data?.people || []).map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name} ({e.code})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {userId !== 'all' && <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={allHistory} onChange={(e) => setAllHistory(e.target.checked)} />Complete history</label>}
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={load}>Try again</Button></div>}

      {loading ? <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[[Clock, 'Overtime hours', hrs(t.ot_minutes)], [DollarSign, 'Overtime amount', rupees(t.ot_amount)], [Users, 'Employees with overtime', t.employees], [AlertTriangle, 'Punches to check', t.checks]].map(([Icon, label, value]) => (
              <Card key={label}><CardContent className="p-4 flex items-center gap-3"><Icon className="w-5 h-5 text-gray-500" /><div><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900">{value}</p></div></CardContent></Card>
            ))}
          </div>
          {p.eligible_only && <p className="text-xs text-gray-500">{data.eligible_count} active employee(s) are marked overtime eligible. Mark others in the employee profile.</p>}

          <Card><CardContent className="p-0">
            <div className="flex overflow-x-auto border-b">
              {VIEWS.map((v) => <button key={v.key} onClick={() => setView(v.key)} className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 ${view === v.key ? 'border-red-600 text-red-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{v.label}</button>)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr>{table.heads.map((h) => <th key={h} className="text-left px-4 py-2.5 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {table.rows.slice(0, LIMIT).map((r, i) => <tr key={i} className="hover:bg-gray-50">{r.map((c, j) => <td key={j} className="px-4 py-2.5 text-gray-700">{c}</td>)}</tr>)}
                  {!table.rows.length && <tr><td colSpan={table.heads.length} className="py-10 text-center text-gray-400">Nothing for this period</td></tr>}
                </tbody>
              </table>
            </div>
            {table.rows.length > LIMIT && <p className="p-3 text-xs text-gray-500 border-t">Showing the first {LIMIT} of {table.rows.length} rows. The Excel export contains all of them.</p>}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
