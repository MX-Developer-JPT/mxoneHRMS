import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Building2, Clock, AlertTriangle, Fingerprint, Camera, RefreshCw, ChevronDown, ChevronUp, Download, UserX, FileSpreadsheet, Coffee, BarChart3, CalendarDays, List, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { safeTime } from '@/lib/dateUtils';
import { toast } from 'sonner';
import MobileSelect from '@/components/MobileSelect';
import AttendanceDetailsDialog from '@/components/attendance/AttendanceDetailsDialog';
import BiometricSyncStatus from '@/components/attendance/BiometricSyncStatus';

const STATUS_COLORS = {
  present: 'bg-green-100 text-green-800 border-green-200',
  absent: 'bg-red-100 text-red-800 border-red-200',
  half_day: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  leave: 'bg-blue-100 text-blue-800 border-blue-200',
  holiday: 'bg-purple-100 text-purple-800 border-purple-200',
  week_off: 'bg-gray-100 text-gray-700 border-gray-200',
  on_duty: 'bg-teal-100 text-teal-800 border-teal-200',
};

function toDateStr(val) {
  if (!val) return '';
  return String(val).slice(0, 10);
}

function getDisplayStatus(record) {
  const s = record.status;
  // Preserve meaningful statuses that have check_in_time set
  if (s && s !== 'absent' && s !== 'in_progress') return s;
  // Fall back to 'present' when check_in_time exists but status is stale/missing
  if (record.check_in_time) return 'present';
  return s || 'absent';
}

const EMP_STATUS_CAL_COLORS = {
  present: 'bg-green-100 border-green-300 text-green-800',
  on_duty: 'bg-teal-100 border-teal-300 text-teal-800',
  work_from_home: 'bg-cyan-100 border-cyan-300 text-cyan-800',
  half_day: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  short_attendance: 'bg-orange-100 border-orange-300 text-orange-800',
  leave: 'bg-blue-100 border-blue-300 text-blue-800',
  holiday: 'bg-purple-100 border-purple-300 text-purple-800',
  week_off: 'bg-gray-100 border-gray-200 text-gray-500',
  absent: 'bg-red-100 border-red-300 text-red-700',
};

export default function AllAttendance() {
  const navigate = useNavigate();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [attendanceMap, setAttendanceMap] = useState({});
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [collapsedDepts, setCollapsedDepts] = useState({});
  const [markingAbsent, setMarkingAbsent] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [calMonthRecords, setCalMonthRecords] = useState([]); // all records for the month (calendar view)
  const [silentRefreshing, setSilentRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [empCal, setEmpCal] = useState({ open: false, emp: null, year: new Date().getFullYear(), month: new Date().getMonth() + 1, records: [], leaveBalances: [], loading: false });

  useEffect(() => { loadData(false); }, [date]);

  useEffect(() => {
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, [date]);

  // Auto-mark absent: silently runs for yesterday on page load (HR/admin only)
  useEffect(() => {
    const runAutoAbsent = async () => {
      try {
        const me = await base44.auth.me();
        const role = me.custom_role || me.role;
        if (role !== 'hr' && role !== 'admin') return;
        const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
        const res = await base44.functions.invoke('markAbsentEmployees', { date: yesterday });
        if (res.data?.marked > 0) {
          toast.info(`Auto-marked ${res.data.marked} absent for ${yesterday}`);
          loadData(true);
        }
      } catch (_) {}
    };
    runAutoAbsent();
  }, []);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setSilentRefreshing(true);
    try {
      const currentUser = await base44.auth.me();
      const userRole = currentUser.custom_role || currentUser.role;

      const [empRecords, usersResp, attendanceResp, deptRecords] = await Promise.all([
        base44.entities.Employee.filter({ status: 'active' }, '-created_date', 500),
        base44.functions.invoke('getAllUsers', {}),
        base44.functions.invoke('getAllAttendance', { date }),
        base44.entities.Department.list(),
      ]);

      const users = usersResp.data?.users || [];
      const dayRecords = attendanceResp.data?.records || [];
      let emps = empRecords.map(e => ({ ...e, _user: users.find(u => u.id === e.user_id) }));

      if (userRole === 'manager') {
        emps = emps.filter(e => e.reporting_manager_id === currentUser.id);
      } else if (userRole === 'management') {
        try {
          const depts = await base44.entities.Department.filter({ head_user_id: currentUser.id });
          if (depts.length > 0) {
            const codes = new Set(depts.map(d => d.code));
            emps = emps.filter(e => codes.has(e.department));
          }
        } catch (e) {
          console.warn('Could not filter by department:', e.message);
        }
      }

      const map = {};
      dayRecords.forEach(r => { map[r.user_id] = r; });

      // Only show employees who had joined by the selected date
      const selDate = date;
      emps = emps.filter(e => {
        if (!e.date_of_joining) return true; // no DOJ stored → always show
        return e.date_of_joining <= selDate;
      });

      setEmployees(emps);
      setAttendanceMap(map);
      setDepartments(deptRecords.map(d => ({ value: d.name, label: d.name })));
    } catch (e) {
      if (!silent) toast.error('Failed to load attendance: ' + e.message);
    } finally {
      setLoading(false);
      setSilentRefreshing(false);
      setLastRefreshed(new Date());
    }
  };

  const rows = useMemo(() => {
    return employees.map(emp => {
      const record = attendanceMap[emp.user_id];
      if (record) return { ...record, _emp: emp };
      return {
        id: `virtual_${emp.user_id}`,
        user_id: emp.user_id,
        date,
        status: 'absent',
        working_hours: 0,
        _virtual: true,
        _emp: emp,
      };
    });
  }, [employees, attendanceMap, date]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const displayStatus = getDisplayStatus(r);
      if (statusFilter !== 'all' && displayStatus !== statusFilter) return false;
      if (deptFilter !== 'all' && r._emp?.department !== deptFilter) return false;
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        const name = (r._emp?.display_name || r._emp?._user?.full_name || '').toLowerCase();
        const code = (r._emp?.employee_code || '').toLowerCase();
        if (!name.includes(t) && !code.includes(t)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, deptFilter, searchTerm]);


  const grouped = useMemo(() => {
    return filtered.reduce((acc, r) => {
      const dept = r._emp?.department || 'Unknown';
      if (!acc[dept]) acc[dept] = [];
      acc[dept].push(r);
      return acc;
    }, {});
  }, [filtered]);

  const stats = useMemo(() => ({
    total: rows.length,
    present: rows.filter(r => ['present','late','on_duty','work_from_home','short_attendance'].includes(r.status) || (r.check_in_time && !['absent','leave','holiday','week_off'].includes(r.status))).length,
    absent: rows.filter(r => r.status === 'absent' || (!r.check_in_time && !r.status)).length,
    halfDay: rows.filter(r => r.status === 'half_day').length,
    leave: rows.filter(r => r.status === 'leave').length,
    late: rows.filter(r => r.late_minutes > 0 || r.late_arrival_minutes > 0).length,
    totalHours: rows.reduce((s, r) => s + (r.working_hours || 0), 0),
  }), [rows]);

  const toggleDept = (dept) => setCollapsedDepts(p => ({ ...p, [dept]: !p[dept] }));

  const handleMarkAbsent = async () => {
    if (!window.confirm(`Mark all employees without attendance records for ${date} as absent? This will skip employees on approved leave.`)) return;
    setMarkingAbsent(true);
    try {
      const res = await base44.functions.invoke('markAbsentEmployees', { date });
      if (res.data?.success) {
        toast.success(`Marked ${res.data.marked} employee(s) absent for ${date}`);
        loadData();
      } else {
        toast.error(res.data?.error || 'Failed to mark absent');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setMarkingAbsent(false);
  };

  const exportToExcel = async () => {
    const [yr, mo] = date.split('-').map(Number);
    try {
      toast.info('Generating muster roll…');
      const res = await base44.functions.invoke('exportAttendanceMuster', { month: mo, year: yr });
      if (!res.data?.success) { toast.error(res.data?.error || 'Muster export failed'); return; }
      const byteChars = atob(res.data.base64);
      const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
      const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Muster exported — ${res.data.total_employees} employees`);
    } catch (e) { toast.error('Muster export error: ' + e.message); }
  };

  const exportDetailedReport = async () => {
    const [yr, mo] = date.split('-').map(Number);
    try {
      toast.info('Generating attendance report…');
      const res = await base44.functions.invoke('exportAttendanceReport', { month: mo, year: yr });
      if (!res.data?.success) { toast.error(res.data?.error || 'Export failed'); return; }
      let blob;
      if (res.data.base64) {
        const byteChars = atob(res.data.base64);
        const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
        blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      } else {
        blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8;' });
      }
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Report exported — ${res.data.total_employees} employees`);
    } catch (e) { toast.error('Export error: ' + e.message); }
  };

  const openEmployeeCalendar = async (emp, e) => {
    e?.stopPropagation();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    setEmpCal({ open: true, emp, year, month, records: [], leaveBalances: [], loading: true });
    try {
      const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
      const daysInM = new Date(year, month, 0).getDate();
      const monthEnd = `${year}-${String(month).padStart(2,'0')}-${String(daysInM).padStart(2,'0')}`;
      const recs = await base44.entities.Attendance.filter({ user_id: emp.user_id, date: { $gte: monthStart, $lte: monthEnd } });
      setEmpCal(prev => ({ ...prev, records: recs, loading: false }));
    } catch {
      setEmpCal(prev => ({ ...prev, loading: false }));
    }
  };

  const navigateEmpCalMonth = async (delta) => {
    const { year, month, emp } = empCal;
    const d = new Date(year, month - 1 + delta, 1);
    const newYear = d.getFullYear(), newMonth = d.getMonth() + 1;
    setEmpCal(prev => ({ ...prev, year: newYear, month: newMonth, loading: true, records: [] }));
    try {
      const monthStart = `${newYear}-${String(newMonth).padStart(2,'0')}-01`;
      const daysInM = new Date(newYear, newMonth, 0).getDate();
      const monthEnd = `${newYear}-${String(newMonth).padStart(2,'0')}-${String(daysInM).padStart(2,'0')}`;
      const recs = await base44.entities.Attendance.filter({ user_id: emp.user_id, date: { $gte: monthStart, $lte: monthEnd } });
      setEmpCal(prev => ({ ...prev, records: recs, loading: false }));
    } catch {
      setEmpCal(prev => ({ ...prev, loading: false }));
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <RefreshCw className="animate-spin w-6 h-6 text-blue-500 mr-2" /> Loading attendance...
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Attendance</h1>
            <p className="text-sm text-gray-500 mt-0.5">Biometric + Selfie attendance for all active employees</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/AttendanceReports')} title="View Attendance Analytics">
              <BarChart3 className="w-4 h-4 mr-1" /> Analytics
            </Button>
            <BiometricSyncStatus />
            <Button variant="outline" size="sm" onClick={handleMarkAbsent} disabled={markingAbsent} title="Mark employees without attendance as Absent">
              <UserX className="w-4 h-4 mr-1" /> {markingAbsent ? 'Marking...' : 'Mark Absent'}
            </Button>
            <Button variant="outline" size="sm" onClick={exportToExcel} title="Export Attendance Muster (monthly summary)">
              <Download className="w-4 h-4 mr-1" /> Muster
            </Button>
            <Button variant="outline" size="sm" onClick={exportDetailedReport} title="Export detailed report with session hours and overtime">
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Report
            </Button>
            <div className="flex items-center gap-1.5">
              {silentRefreshing && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" title="Refreshing…" />}
              {!silentRefreshing && lastRefreshed && (
                <span className="text-[10px] text-gray-400 hidden sm:block" title={`Last refreshed ${lastRefreshed.toLocaleTimeString()}`}>
                  {format(lastRefreshed, 'h:mm a')}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => loadData(false)} title="Refresh now"><RefreshCw className="w-4 h-4" /></Button>
            </div>
            <div className="flex border rounded-lg overflow-hidden">
              <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button onClick={async () => {
                setViewMode('calendar');
                // Load full month records for calendar
                const [yr, mo] = date.split('-').map(Number);
                const monthStart = `${yr}-${String(mo).padStart(2,'0')}-01`;
                const daysInMonth = new Date(yr, mo, 0).getDate();
                const monthEnd = `${yr}-${String(mo).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
                try {
                  const res = await base44.functions.invoke('getAllAttendance', { date_from: monthStart, date_to: monthEnd });
                  setCalMonthRecords(res.data?.records || []);
                } catch {}
              }} className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${viewMode === 'calendar' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                <CalendarDays className="w-3.5 h-3.5" /> Calendar
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: 'Total', value: stats.total, color: 'text-gray-700' },
            { label: 'Present', value: stats.present, color: 'text-green-600', filter: 'present' },
            { label: 'Absent', value: stats.absent, color: 'text-red-600', filter: 'absent' },
            { label: 'Half Day', value: stats.halfDay, color: 'text-yellow-600', filter: 'half_day' },
            { label: 'On Leave', value: stats.leave, color: 'text-blue-600', filter: 'leave' },
            { label: 'Late', value: stats.late, color: 'text-orange-600' },
          ].map(s => (
            <Card
              key={s.label}
              className={`cursor-pointer hover:shadow-md transition-shadow ${s.filter && statusFilter === s.filter ? 'ring-2 ring-blue-400' : ''}`}
              onClick={() => s.filter && setStatusFilter(statusFilter === s.filter ? 'all' : s.filter)}
            >
              <CardContent className="p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input placeholder="Search by name or code..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="border border-input rounded-md px-3 py-2 text-sm bg-background h-9"
              />
              <MobileSelect value={statusFilter} onValueChange={setStatusFilter} label="Status" className="w-[150px]" options={[
                { value: 'all', label: 'All Status' },
                { value: 'present', label: 'Present' },
                { value: 'absent', label: 'Absent' },
                { value: 'half_day', label: 'Half Day' },
                { value: 'leave', label: 'On Leave' },
                { value: 'holiday', label: 'Holiday' },
                { value: 'week_off', label: 'Week Off' },
                { value: 'on_duty', label: 'On Duty' },
              ]} />
              <MobileSelect value={deptFilter} onValueChange={setDeptFilter} label="Department" className="w-[160px]" options={[
                { value: 'all', label: 'All Departments' },
                ...departments
              ]} />
            </div>
          </CardContent>
        </Card>

        {/* Calendar View */}
        {viewMode === 'calendar' && (() => {
          const [yr, mo] = date.split('-').map(Number);
          const navigateCalMonth = async (delta) => {
            const d = new Date(yr, mo - 1 + delta, 1);
            const newYr = d.getFullYear(), newMo = d.getMonth() + 1;
            const newDate = `${newYr}-${String(newMo).padStart(2,'0')}-01`;
            setDate(newDate);
            const daysInM = new Date(newYr, newMo, 0).getDate();
            const monthEnd = `${newYr}-${String(newMo).padStart(2,'0')}-${String(daysInM).padStart(2,'0')}`;
            try {
              const res = await base44.functions.invoke('getAllAttendance', { date_from: newDate, date_to: monthEnd });
              setCalMonthRecords(res.data?.records || []);
            } catch {}
          };
          const daysInMonth = new Date(yr, mo, 0).getDate();
          const firstDow = new Date(yr, mo - 1, 1).getDay(); // 0=Sun
          // Build map: date → { present, absent, leave, half_day, total }
          const dayMap = {};
          for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayRecs = calMonthRecords.filter(r => r.date?.slice(0,10) === ds);
            const present = dayRecs.filter(r => r.check_in_time || ['present','late','on_duty','work_from_home'].includes(r.status)).length;
            const leave = dayRecs.filter(r => r.status === 'leave').length;
            const halfDay = dayRecs.filter(r => r.status === 'half_day').length;
            const absent = employees.length - present - leave - halfDay;
            dayMap[ds] = { present, absent: Math.max(absent, 0), leave, halfDay, total: employees.length };
          }
          const weeks = [];
          let week = Array(firstDow).fill(null);
          for (let d = 1; d <= daysInMonth; d++) {
            week.push(d);
            if (week.length === 7) { weeks.push(week); week = []; }
          }
          if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }
          const today = format(new Date(), 'yyyy-MM-dd');
          const monthLabel = new Date(yr, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
          return (
            <Card>
              <CardContent className="p-4">
                {/* Month navigation */}
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => navigateCalMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <span className="font-semibold text-gray-800 text-sm">{monthLabel}</span>
                  <button onClick={() => navigateCalMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
                <div className="grid grid-cols-7 mb-2">
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                    <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
                  ))}
                </div>
                <div className="space-y-1">
                  {weeks.map((wk, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1">
                      {wk.map((d, di) => {
                        if (!d) return <div key={di} />;
                        const ds = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                        const info = dayMap[ds];
                        const isToday = ds === today;
                        const isSelected = ds === date;
                        const isSun = di === 0;
                        return (
                          <button
                            key={di}
                            onClick={() => { setDate(ds); setViewMode('list'); }}
                            className={`rounded-lg p-1.5 text-left transition-all hover:ring-2 hover:ring-blue-400 ${isSelected ? 'ring-2 ring-blue-500' : ''} ${isToday ? 'bg-blue-50' : 'bg-white'} border ${isSun ? 'border-gray-100' : 'border-gray-100'}`}
                          >
                            <div className={`text-xs font-bold mb-1 ${isToday ? 'text-blue-600' : isSun ? 'text-red-400' : 'text-gray-700'}`}>{d}</div>
                            {info && employees.length > 0 ? (
                              <div className="space-y-0.5">
                                {info.present > 0 && <div className="text-[10px] leading-tight text-green-700 font-medium">{info.present} In</div>}
                                {info.absent > 0 && <div className="text-[10px] leading-tight text-red-500">{info.absent} Ab</div>}
                                {info.leave > 0 && <div className="text-[10px] leading-tight text-blue-500">{info.leave} Lv</div>}
                                {info.halfDay > 0 && <div className="text-[10px] leading-tight text-yellow-600">{info.halfDay} HD</div>}
                              </div>
                            ) : (
                              <div className="text-[10px] text-gray-300">{isSun ? 'Off' : ''}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3 text-center">Click a day to view that day's attendance in list view</p>
              </CardContent>
            </Card>
          );
        })()}

        {/* Department Groups */}
        {viewMode === 'list' && <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([dept, records]) => (
            <Card key={dept}>
              <CardHeader className="p-4 pb-2 cursor-pointer" onClick={() => toggleDept(dept)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-gray-800">
                    <Building2 className="w-4 h-4 text-blue-500" />
                    {dept}
                    <span className="text-sm font-normal text-gray-500">({records.length})</span>
                    <span className="text-xs text-green-600 font-medium">{records.filter(r => ['present','late','on_duty','work_from_home','short_attendance'].includes(r.status) || (r.check_in_time && !['absent','leave','holiday','week_off'].includes(r.status))).length} present</span>
                    {records.filter(r => r.status === 'absent' || (!r.check_in_time && !r.status)).length > 0 && (
                      <span className="text-xs text-red-500 font-medium">{records.filter(r => r.status === 'absent' || (!r.check_in_time && !r.status)).length} absent</span>
                    )}
                  </div>
                  {collapsedDepts[dept] ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                </div>
              </CardHeader>
              {!collapsedDepts[dept] && (
                <CardContent className="p-4 pt-0">
                  <div className="space-y-2">
                    {records.map(record => {
                      const emp = record._emp;
                      const name = emp?.display_name || emp?._user?.full_name || record.user_id || '?';
                      const displayStatus = getDisplayStatus(record);

                      // Resolve first-in / last-out from all possible sources
                      const richSess = record.sessions || [];
                      const legacySess = (record.punch_sessions || []).filter(s => s.punch_in);
                      const firstIn = record.check_in_time
                        || richSess[0]?.check_in
                        || legacySess[0]?.punch_in
                        || null;
                      const completeSess = richSess.filter(s => s.check_out || s.is_complete);
                      const lastOut = record.check_out_time
                        || (completeSess.length ? completeSess[completeSess.length - 1].check_out : null)
                        || (legacySess.length > 1 ? legacySess[legacySess.length - 1].punch_out : null)
                        || null;

                      return (
                        <div
                          key={record.id}
                          className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3 rounded-lg border bg-white hover:shadow-sm transition-shadow ${!record._virtual ? 'cursor-pointer' : ''}`}
                          onClick={() => !record._virtual && setSelectedRecord(record)}
                        >
                          {/* Left: avatar + name */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 font-semibold text-sm">{name.charAt(0).toUpperCase()}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm text-gray-900 truncate">{name}</p>
                              <p className="text-xs text-gray-400 truncate">{emp?.designation || emp?.employee_code}</p>
                            </div>
                          </div>

                          {/* Center: First In / Last Out — always shown as dedicated block */}
                          <div className="flex items-center gap-4 shrink-0">
                            <div className="text-center min-w-[64px]">
                              <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">First In</p>
                              <p className={`text-sm font-semibold ${firstIn ? 'text-green-700' : 'text-gray-300'}`}>
                                {firstIn ? safeTime(firstIn) : '—'}
                              </p>
                            </div>
                            <div className="text-center min-w-[64px]">
                              <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Last Out</p>
                              <p className={`text-sm font-semibold ${lastOut ? 'text-red-600' : (record.is_in_progress || record.status === 'in_progress') ? 'text-green-500' : 'text-gray-300'}`}>
                                {lastOut ? safeTime(lastOut) : (record.is_in_progress || record.status === 'in_progress') ? '● Active' : '—'}
                              </p>
                            </div>
                          </div>

                          {/* Right: chips */}
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Multi-session pills — only when 2+ sessions */}
                            {richSess.length > 1 && richSess.map((s, idx) => (
                              <span key={idx} className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100">
                                <span className="text-gray-400 mr-1">S{idx + 1}</span>
                                <span className="text-green-600 font-medium">In</span> {safeTime(s.check_in)}
                                {s.check_out && <><span className="text-gray-300 mx-1">·</span><span className="text-red-500 font-medium">Out</span> {safeTime(s.check_out)}</>}
                                {!s.check_out && <span className="text-green-500 ml-1">●</span>}
                              </span>
                            ))}
                            {/* Working time */}
                            {(record.total_working_minutes > 0 || record.working_hours > 0) && (
                              <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">
                                {record.total_working_minutes
                                  ? `${Math.floor(record.total_working_minutes/60)}h${record.total_working_minutes%60>0?`${record.total_working_minutes%60}m`:''}`
                                  : `${record.working_hours.toFixed(1)}h`}
                              </span>
                            )}
                            {/* Break time */}
                            {(record.total_break_minutes > 0 || record.break_hours > 0) && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                <Coffee className="w-3 h-3" />
                                {record.total_break_minutes
                                  ? `${Math.floor(record.total_break_minutes/60)}h${record.total_break_minutes%60>0?`${record.total_break_minutes%60}m`:''}`
                                  : `${record.break_hours.toFixed(1)}h`} break
                              </span>
                            )}
                            {record.biometric_synced && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                                <Fingerprint className="w-3 h-3" /> Bio
                              </span>
                            )}
                            {!record.biometric_synced && (record.check_in_selfie_url || record.check_out_selfie_url) && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                <Camera className="w-3 h-3" /> Selfie
                              </span>
                            )}
                            {(record.late_arrival || record.late_minutes > 0) && (record.late_arrival_minutes || record.late_minutes) > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-orange-600">
                                <AlertTriangle className="w-3 h-3" /> {record.late_arrival_minutes || record.late_minutes}m late
                              </span>
                            )}
                            {emp?.overtime_eligible && record.overtime_minutes > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                <Clock className="w-3 h-3" /> OT {Math.floor(record.overtime_minutes/60)}h{record.overtime_minutes%60>0?`${record.overtime_minutes%60}m`:''}
                              </span>
                            )}
                            <button
                              onClick={(e) => openEmployeeCalendar(emp, e)}
                              className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="View individual calendar"
                            >
                              <CalendarDays className="w-4 h-4" />
                            </button>
                            <Badge className={`text-xs border ${STATUS_COLORS[displayStatus] || 'bg-gray-100 text-gray-700'}`}>
                              {displayStatus.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {Object.keys(grouped).length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-lg font-medium">No records found</p>
              <p className="text-sm mt-1">Try changing the date or filters</p>
            </div>
          )}
        </div>}
      </div>

      {/* Employee Individual Calendar Dialog */}
      <Dialog open={empCal.open} onOpenChange={open => setEmpCal(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-blue-500" />
              {empCal.emp?.display_name || empCal.emp?._user?.full_name || 'Employee'} — Attendance Calendar
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const { year, month, records, loading: calLoading } = empCal;
            const daysInMonth = new Date(year, month, 0).getDate();
            const firstDow = new Date(year, month - 1, 1).getDay();
            const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const recMap = {};
            records.forEach(r => { recMap[r.date?.slice(0,10)] = r; });

            const weeks = [];
            let week = Array(firstDow).fill(null);
            for (let d = 1; d <= daysInMonth; d++) {
              week.push(d);
              if (week.length === 7) { weeks.push(week); week = []; }
            }
            if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }

            const statusLabel = { present: 'P', absent: 'A', half_day: 'HD', leave: 'L', holiday: 'H', week_off: 'W', on_duty: 'OD', work_from_home: 'WFH', short_attendance: 'SA' };

            const summary = { present: 0, absent: 0, leave: 0, halfDay: 0, wfh: 0, ot: 0 };
            records.forEach(r => {
              const s = getDisplayStatus(r);
              if (['present','on_duty','short_attendance'].includes(s) || r.check_in_time) summary.present++;
              else if (s === 'absent') summary.absent++;
              else if (s === 'leave') summary.leave++;
              else if (s === 'half_day') summary.halfDay++;
              if (s === 'work_from_home') summary.wfh++;
              if ((r.overtime_minutes || 0) > 0) summary.ot++;
            });

            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => navigateEmpCalMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <ChevronLeft className="w-4 h-4 text-gray-600" />
                  </button>
                  <span className="font-semibold text-gray-800 text-sm">{monthLabel}</span>
                  <button onClick={() => navigateEmpCalMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                </div>

                {calLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-7 mb-1">
                      {['S','M','T','W','T','F','S'].map((d, i) => (
                        <div key={i} className={`text-center text-[10px] font-bold py-1 ${i === 0 ? 'text-red-400' : 'text-gray-400'}`}>{d}</div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {weeks.map((wk, wi) => (
                        <div key={wi} className="grid grid-cols-7 gap-0.5">
                          {wk.map((d, di) => {
                            if (!d) return <div key={di} />;
                            const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                            const rec = recMap[ds];
                            const status = rec ? getDisplayStatus(rec) : null;
                            const colorClass = status ? (EMP_STATUS_CAL_COLORS[status] || 'bg-gray-50 border-gray-200 text-gray-500') : 'bg-white border-gray-100 text-gray-400';
                            const isToday = ds === today;
                            const isFuture = ds > today;
                            const checkIn = rec?.check_in_time;
                            const checkOut = rec?.check_out_time;
                            const hours = rec?.working_hours;
                            return (
                              <div
                                key={di}
                                className={`border rounded text-center py-1 px-0.5 text-[10px] font-medium leading-tight ${isFuture ? 'bg-gray-50 border-gray-100 text-gray-300' : colorClass} ${isToday ? 'ring-1 ring-blue-500' : ''}`}
                                title={rec ? `${status?.replace(/_/g,' ')}${checkIn ? ` · In: ${safeTime(checkIn)}` : ''}${checkOut ? ` · Out: ${safeTime(checkOut)}` : ''}${hours ? ` · ${hours.toFixed(1)}h` : ''}` : ''}
                              >
                                <div className={`font-bold text-[11px] ${isToday ? 'text-blue-600' : di === 0 ? 'text-red-400' : ''}`}>{d}</div>
                                <div>{status ? (statusLabel[status] || status.slice(0,2).toUpperCase()) : (isFuture ? '' : '—')}</div>
                                {hours > 0 && <div className="text-[9px] opacity-70">{hours.toFixed(1)}h</div>}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
                      {[['P','bg-green-100 text-green-700','Present'],['A','bg-red-100 text-red-700','Absent'],['L','bg-blue-100 text-blue-700','Leave'],['HD','bg-yellow-100 text-yellow-700','Half Day'],['WFH','bg-cyan-100 text-cyan-700','WFH'],['OD','bg-teal-100 text-teal-700','On Duty']].map(([code, cls, label]) => (
                        <span key={code} className={`px-1.5 py-0.5 rounded border ${cls}`}>{code} {label}</span>
                      ))}
                    </div>

                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        { label: 'Present', value: summary.present, cls: 'text-green-700 bg-green-50' },
                        { label: 'Absent', value: summary.absent, cls: 'text-red-700 bg-red-50' },
                        { label: 'Leave', value: summary.leave, cls: 'text-blue-700 bg-blue-50' },
                        { label: 'Half Day', value: summary.halfDay, cls: 'text-yellow-700 bg-yellow-50' },
                        { label: 'WFH', value: summary.wfh, cls: 'text-cyan-700 bg-cyan-50' },
                        { label: 'OT Days', value: summary.ot, cls: 'text-purple-700 bg-purple-50' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className={`rounded-lg p-2 text-center ${cls}`}>
                          <p className="text-sm font-bold">{value}</p>
                          <p className="text-[10px] opacity-80">{label}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <AttendanceDetailsDialog
        record={selectedRecord}
        employee={selectedRecord ? employees.find(e => e.user_id === selectedRecord.user_id) : null}
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />
    </div>
  );
}