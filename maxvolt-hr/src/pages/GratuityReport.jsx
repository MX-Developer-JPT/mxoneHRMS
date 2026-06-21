import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import MobileSelect from '@/components/MobileSelect';
import {
  Landmark, IndianRupee, Users, ShieldCheck, Clock, Search,
  Filter, Download, RefreshCw, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

const fmt = (n) => '₹' + (n || 0).toLocaleString('en-IN');

export default function GratuityReport() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [departments, setDepartments] = useState([]);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getGratuityReport', {});
      const d = res.data || res;
      if (d.success) {
        setSummary(d.summary || {});
        setRows(d.employees || []);
        setDepartments([...new Set((d.employees || []).map(e => e.department).filter(Boolean))]);
      } else toast.error(d.error || 'Failed to compute gratuity');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const filtered = rows.filter(r => {
    if (filter === 'eligible' && !r.eligible) return false;
    if (filter === 'near' && !r.near_eligible) return false;
    if (deptFilter !== 'all' && r.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.name?.toLowerCase().includes(q) && !r.employee_code?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const exportCSV = () => {
    const headers = ['Employee Code', 'Name', 'Department', 'Date of Joining', 'Years of Service', 'Monthly Basic+DA', 'Eligible', 'Accrued Liability', 'Payable If Exit Today'];
    const lines = filtered.map(r => [
      r.employee_code, r.name, r.department, r.date_of_joining, r.years_of_service,
      r.monthly_basic, r.eligible ? 'Yes' : 'No', r.accrued_liability, r.payable_if_exit_today
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gratuity-report-${summary.as_of || 'export'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-indigo-600" /> Gratuity Liability & Eligibility
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            As per the Payment of Gratuity Act, 1972 — 15/26 × last-drawn (Basic + DA) × years of service, capped at {fmt(summary.cap || 2000000)}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Recompute
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={IndianRupee} color="indigo" label="Total accrued liability" value={fmt(summary.total_accrued_liability)} />
        <Stat icon={ShieldCheck} color="emerald" label="Eligible (≥5 yrs)" value={summary.eligible_count || 0} />
        <Stat icon={Clock} color="amber" label="Nearing eligibility (4–5 yrs)" value={summary.near_eligible_count || 0} />
        <Stat icon={IndianRupee} color="rose" label="Payable if all exit today" value={fmt(summary.total_payable_if_exit)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search name or code…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <MobileSelect value={filter} onValueChange={setFilter} label="Eligibility" className="w-40"
            options={[{ value: 'all', label: 'All employees' }, { value: 'eligible', label: 'Eligible (≥5 yrs)' }, { value: 'near', label: 'Nearing (4–5 yrs)' }]} />
        </div>
        {departments.length > 0 && (
          <MobileSelect value={deptFilter} onValueChange={setDeptFilter} label="Department" className="w-44"
            options={[{ value: 'all', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]} />
        )}
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} shown</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-left">DOJ</th>
              <th className="px-4 py-3 text-right">Years</th>
              <th className="px-4 py-3 text-right">Monthly Basic+DA</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Accrued Liability</th>
              <th className="px-4 py-3 text-right">Payable if Exit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400"><RefreshCw className="w-5 h-5 mx-auto animate-spin" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                No employees with a salary structure match the filters.
              </td></tr>
            ) : filtered.map(r => (
              <tr key={r.user_id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800">{r.name}</p>
                  <p className="text-xs text-gray-400">{r.employee_code}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">{r.department || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{r.date_of_joining}</td>
                <td className="px-4 py-3 text-right text-gray-700">{r.years_of_service}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(r.monthly_basic)}</td>
                <td className="px-4 py-3 text-center">
                  {r.eligible ? (
                    <Badge className="bg-emerald-100 text-emerald-700">Eligible</Badge>
                  ) : r.near_eligible ? (
                    <Badge className="bg-amber-100 text-amber-700">Nearing</Badge>
                  ) : (
                    <Badge variant="outline" className="text-gray-500">Accruing</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-indigo-700">{fmt(r.accrued_liability)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{r.payable_if_exit_today ? fmt(r.payable_if_exit_today) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Accrued liability is the accounting provision from date of joining (for all employees). "Payable if exit" applies only to employees who have completed ≥5 years, using statutory rounding (&gt;6 months rounds up to a full year).
      </p>
    </div>
  );
}

function Stat({ icon: Icon, color, label, value }) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600', emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600', rose: 'bg-rose-100 text-rose-600',
  };
  return (
    <Card>
      <CardContent className="pt-5 flex items-center gap-4">
        <div className={`p-3 rounded-full ${colors[color]}`}><Icon className="w-6 h-6" /></div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-800 truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
