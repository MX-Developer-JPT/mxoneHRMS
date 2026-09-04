import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Moon, RefreshCw, Download, LogIn, LogOut, AlertTriangle, Clock, UserX, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { safeTime } from '@/lib/dateUtils';

const STATUS_CONFIG = {
  checked_in:       { label: 'Checked In',      color: 'bg-green-100 text-green-800 border-green-200',  icon: LogIn },
  overdue_checkout: { label: 'Overdue Checkout', color: 'bg-red-100 text-red-800 border-red-200',        icon: AlertTriangle },
  checked_out:      { label: 'Checked Out',      color: 'bg-blue-100 text-blue-800 border-blue-200',     icon: LogOut },
  not_checked_in:   { label: 'Not Checked In',   color: 'bg-orange-100 text-orange-800 border-orange-200', icon: AlertTriangle },
  upcoming:         { label: 'Upcoming',         color: 'bg-gray-100 text-gray-600 border-gray-200',     icon: Clock },
  absent:           { label: 'Absent',           color: 'bg-red-100 text-red-800 border-red-200',        icon: UserX },
  off_shift:        { label: 'Off Shift',        color: 'bg-gray-50 text-gray-400 border-gray-200',      icon: Sun },
};

const REFRESH_MS = 30000;

export default function NightShiftManagement() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [exporting, setExporting] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await base44.functions.invoke('getNightShiftDashboard', {});
      const d = res.data || res;
      if (d.success) {
        setRows(d.rows || []);
        setCounts(d.counts || {});
        setAsOf(d.as_of);
      } else if (!silent) toast.error(d.error || 'Failed to load night shift data');
    } catch (e) {
      if (!silent) toast.error('Error: ' + e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const filtered = statusFilter === 'all' ? rows : rows.filter(r => r.status === statusFilter);

  const downloadExport = async (fnName, label) => {
    setExporting(fnName);
    try {
      const now = new Date();
      const res = await base44.functions.invoke(fnName, { month: now.getMonth() + 1, year: now.getFullYear(), night_shift_only: true });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || `${label} export failed`); return; }
      const byteChars = atob(d.base64);
      const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
      const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = d.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${label} exported — ${d.total_employees} employee${d.total_employees === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`${label} export error: ` + e.message);
    }
    setExporting('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Moon className="w-6 h-6 text-indigo-600" /> Night Shift Management
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Live status for every employee on an overnight shift{asOf ? ` — updated ${safeTime(asOf)}` : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport('exportAttendanceMuster', 'Muster')} disabled={!!exporting}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> {exporting === 'exportAttendanceMuster' ? 'Exporting…' : 'Export Muster'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport('exportAttendanceReport', 'Report')} disabled={!!exporting}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> {exporting === 'exportAttendanceReport' ? 'Exporting…' : 'Export Report'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadExport('exportSwipeDetails', 'Swipe Details')} disabled={!!exporting}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> {exporting === 'exportSwipeDetails' ? 'Exporting…' : 'Export Swipe Details'}
            </Button>
          </div>
        </div>

        {/* Status summary — click to filter */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[{ key: 'all', label: 'All', count: rows.length }, ...Object.entries(STATUS_CONFIG).map(([key, cfg]) => ({ key, label: cfg.label, count: counts[key] || 0 }))]
            .map(s => (
              <Card
                key={s.key}
                className={`cursor-pointer hover:shadow-md transition-shadow ${statusFilter === s.key ? 'ring-2 ring-indigo-400' : ''}`}
                onClick={() => setStatusFilter(prev => prev === s.key ? 'all' : s.key)}
              >
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-gray-800">{s.count}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </CardContent>
              </Card>
            ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Night Shift Employees {statusFilter !== 'all' ? `— ${STATUS_CONFIG[statusFilter]?.label}` : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Moon className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>{rows.length === 0 ? 'No employees are currently assigned an overnight shift.' : 'No employees match this filter.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(r => {
                  const cfg = STATUS_CONFIG[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-700', icon: Clock };
                  const Icon = cfg.icon;
                  return (
                    <div key={r.employee_id} className="flex flex-wrap items-center justify-between gap-3 p-3 border rounded-lg bg-white hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700 text-sm shrink-0">
                          {r.name.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">{r.name} <span className="text-xs text-gray-400 font-normal">{r.employee_code}</span></p>
                          <p className="text-xs text-gray-500 truncate">{r.designation} · {r.department} · {r.shift_name} ({r.shift_start}–{r.shift_end})</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap shrink-0">
                        {(r.check_in_time || r.check_out_time) && (
                          <div className="text-xs text-gray-500 text-right space-y-0.5">
                            {r.check_in_time && <p className="text-green-600">In: {safeTime(r.check_in_time)}</p>}
                            {r.check_out_time && <p className="text-red-500">Out: {safeTime(r.check_out_time)}</p>}
                          </div>
                        )}
                        <Badge className={`${cfg.color} flex items-center gap-1`}>
                          <Icon className="w-3 h-3" /> {cfg.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
