import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Users, Clock, FileText, DollarSign, TrendingDown, TrendingUp,
  Download, Search, RefreshCw, UserPlus, LogOut, BookOpen, Laptop,
  ChevronRight, Filter, X, BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import MobileSelect from '@/components/MobileSelect';

// ── Report catalogue ────────────────────────────────────────────────────────
const REPORTS = [
  {
    id: 'employee_master',
    title: 'Employee Master',
    desc: 'Complete list of all active employees with personal, payroll and statutory details.',
    icon: Users,
    color: 'blue',
    dateLabel: null,
  },
  {
    id: 'attendance_monthly',
    title: 'Monthly Attendance',
    desc: 'Present, absent, leave and half-day counts per employee for a selected date range.',
    icon: Clock,
    color: 'green',
    dateLabel: 'Date range',
  },
  {
    id: 'leave_balance',
    title: 'Leave Usage',
    desc: 'Casual, sick, earned and other leave consumed per employee (all-time).',
    icon: FileText,
    color: 'purple',
    dateLabel: null,
  },
  {
    id: 'payroll_summary',
    title: 'Payroll Summary',
    desc: 'Month-wise gross, net pay, TDS, PF and PT for every employee.',
    icon: DollarSign,
    color: 'indigo',
    dateLabel: 'Month range',
  },
  {
    id: 'new_joiners',
    title: 'New Joiners',
    desc: 'Employees who joined within the selected date range.',
    icon: UserPlus,
    color: 'emerald',
    dateLabel: 'Joining date range',
  },
  {
    id: 'exit_report',
    title: 'Exit Report',
    desc: 'Resignations, exit type, last working day and reason for the selected period.',
    icon: LogOut,
    color: 'red',
    dateLabel: 'Resignation date range',
  },
  {
    id: 'training_status',
    title: 'Training Status',
    desc: 'Training enrolments and completion status for all employees.',
    icon: BookOpen,
    color: 'amber',
    dateLabel: null,
  },
  {
    id: 'asset_assignment',
    title: 'Asset Assignment',
    desc: 'All assets currently assigned, with employee details and expected return date.',
    icon: Laptop,
    color: 'slate',
    dateLabel: null,
  },
];

const COLOR = {
  blue:    { card: 'bg-blue-50 border-blue-200',    icon: 'bg-blue-100 text-blue-600',    badge: 'bg-blue-600' },
  green:   { card: 'bg-green-50 border-green-200',  icon: 'bg-green-100 text-green-600',  badge: 'bg-green-600' },
  purple:  { card: 'bg-purple-50 border-purple-200',icon: 'bg-purple-100 text-purple-600',badge: 'bg-purple-600' },
  indigo:  { card: 'bg-indigo-50 border-indigo-200',icon: 'bg-indigo-100 text-indigo-600',badge: 'bg-indigo-600' },
  emerald: { card: 'bg-emerald-50 border-emerald-200',icon:'bg-emerald-100 text-emerald-600',badge:'bg-emerald-600' },
  red:     { card: 'bg-red-50 border-red-200',      icon: 'bg-red-100 text-red-600',      badge: 'bg-red-600' },
  amber:   { card: 'bg-amber-50 border-amber-200',  icon: 'bg-amber-100 text-amber-600',  badge: 'bg-amber-600' },
  slate:   { card: 'bg-slate-50 border-slate-200',  icon: 'bg-slate-100 text-slate-600',  badge: 'bg-slate-600' },
};

function thisMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function downloadCSV(columns, rows, filename) {
  const escape = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(escape).join(',');
  const body   = rows.map(r => r.map(escape).join(',')).join('\n');
  const blob   = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Quick stats strip ───────────────────────────────────────────────────────
function StatsStrip() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    base44.functions.invoke('getMISData', {}).then(r => setStats(r.data?.metrics)).catch(() => {});
  }, []);
  const items = [
    { label: 'Active Employees', value: stats?.totalActive ?? '—', icon: Users, color: 'text-blue-600' },
    { label: 'Present Today',    value: stats?.presentToday ?? '—', icon: TrendingUp, color: 'text-green-600' },
    { label: 'Pending Leaves',   value: stats?.pendingLeaveRequests ?? '—', icon: FileText, color: 'text-amber-600' },
    { label: 'Attrition Rate',   value: stats ? `${stats.attritionRate}%` : '—', icon: TrendingDown, color: 'text-red-600' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Report config panel ─────────────────────────────────────────────────────
function ReportPanel({ report, departments, onClose, onData }) {
  const [fromDate,   setFromDate]   = useState(thisMonthStart());
  const [toDate,     setToDate]     = useState(today());
  const [department, setDepartment] = useState('all');
  const [loading,    setLoading]    = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('generateReport', {
        report_type: report.id,
        from_date: fromDate,
        to_date: toDate,
        department,
      });
      onData(res.data);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${COLOR[report.color].icon}`}>
            <report.icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{report.title}</h3>
            <p className="text-xs text-gray-500">{report.desc}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        {report.dateLabel && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40 h-9 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40 h-9 text-sm" />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
          <MobileSelect
            value={department}
            onValueChange={setDepartment}
            label="All Departments"
            options={[{ value: 'all', label: 'All Departments' }, ...departments.map(d => ({ value: d, label: d }))]}
            className="w-44 h-9 text-sm"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={run} disabled={loading} className="h-9 gap-2 bg-blue-600 hover:bg-blue-700">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
            {loading ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Data preview table ──────────────────────────────────────────────────────
function PreviewTable({ data, report }) {
  const [search, setSearch] = useState('');
  const { columns, rows, total } = data;

  const filtered = search.trim()
    ? rows.filter(r => r.some(c => String(c).toLowerCase().includes(search.toLowerCase())))
    : rows;

  const handleDownload = () => {
    const safeTitle = report.title.replace(/\s+/g, '_');
    downloadCSV(columns, rows, `${safeTitle}_${today()}.csv`);
    toast.success(`Downloaded ${rows.length} rows`);
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Table header */}
      <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-800">{report.title}</span>
          <Badge className="bg-blue-100 text-blue-700 border-0">{total} records</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…" className="pl-8 h-8 w-44 text-sm" />
          </div>
          <Button onClick={handleDownload} size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 h-8">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              {columns.map((col, i) => (
                <th key={i} className="px-3 py-2.5 text-left font-semibold text-gray-600 text-xs whitespace-nowrap border-b">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400">No records found</td></tr>
            ) : filtered.map((row, ri) => (
              <tr key={ri} className="hover:bg-gray-50 border-b last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                    {cell === '' || cell === null || cell === undefined ? <span className="text-gray-300">—</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {search && (
        <div className="px-5 py-2 border-t bg-gray-50 text-xs text-gray-500">
          Showing {filtered.length} of {total} records
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function Reports() {
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportData,     setReportData]     = useState(null);
  const [departments,    setDepartments]    = useState([]);

  useEffect(() => {
    base44.entities.Employee.filter({ status: 'active' }).then(emps => {
      const depts = [...new Set((emps || []).map(e => e.department).filter(Boolean))].sort();
      setDepartments(depts);
    }).catch(() => {});
  }, []);

  const selectReport = (r) => {
    setSelectedReport(r);
    setReportData(null);
  };

  const handleData = useCallback((data) => {
    setReportData(data);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">HR Reports</h1>
          <p className="text-sm text-gray-500">Generate and download tabular reports for any module</p>
        </div>
      </div>

      {/* Quick stats */}
      <StatsStrip />

      {/* Config panel (appears when a report is selected) */}
      {selectedReport && (
        <ReportPanel
          report={selectedReport}
          departments={departments}
          onClose={() => { setSelectedReport(null); setReportData(null); }}
          onData={handleData}
        />
      )}

      {/* Preview table (appears after generate) */}
      {reportData && selectedReport && (
        <PreviewTable data={reportData} report={selectedReport} />
      )}

      {/* Report catalogue */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-gray-800">Available Reports</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {REPORTS.map(r => {
            const c = COLOR[r.color];
            const isActive = selectedReport?.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => selectReport(r)}
                className={`text-left p-4 rounded-xl border-2 transition-all hover:shadow-md ${
                  isActive ? `${c.card} border-current shadow-md` : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${c.icon}`}>
                  <r.icon className="w-5 h-5" />
                </div>
                <div className="flex items-start justify-between gap-1 mb-1">
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">{r.title}</h3>
                  {isActive && (
                    <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${c.badge}`}>
                      <ChevronRight className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{r.desc}</p>
                {r.dateLabel && (
                  <span className="inline-block mt-2 text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                    {r.dateLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
