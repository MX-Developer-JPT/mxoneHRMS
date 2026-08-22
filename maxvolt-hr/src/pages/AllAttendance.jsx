import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Building2, Clock, AlertTriangle, Fingerprint, Camera, MapPin, RefreshCw, ChevronDown, ChevronUp, Download, UserX, FileSpreadsheet, Coffee, BarChart3, CalendarDays, List, ChevronLeft, ChevronRight, Loader2, Wrench } from 'lucide-react';
import { getAttendanceMethod, getGeofenceDetail, scheduledOffStatus } from '@/lib/attendanceSource';
import { format } from 'date-fns';
import { safeTime } from '@/lib/dateUtils';
import { toast } from 'sonner';
import MobileSelect from '@/components/MobileSelect';
import AttendanceDetailsDialog from '@/components/attendance/AttendanceDetailsDialog';
import BiometricSyncStatus from '@/components/attendance/BiometricSyncStatus';
import { resolveHierarchy } from '@/lib/hierarchy';

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
  // Trust an explicit backend status always — including 'absent', which may be
  // a deliberate auto-close (checked in, never checked out — see
  // backend/cron/attendanceAutomation.js markUnclosedCheckInsAsAbsent) and must
  // never be silently overridden back to 'present' just because check_in_time
  // is set (it always is for that exact case). Only 'in_progress' (a session
  // still open) falls through to the check-in-based 'present' inference below,
  // which is intentional — an open session should read as present, not as its
  // own separate badge, until it resolves one way or the other.
  if (s && s !== 'in_progress') return s;
  // Fall back to 'present' when check_in_time exists but status is stale/missing
  if (record.check_in_time) return 'present';
  return s || 'absent';
}

const EMP_STATUS_CAL_COLORS = {
  present: 'bg-green-100 border-green-300 text-green-800',
  late: 'bg-green-100 border-green-300 text-green-800',
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
  const [shiftMap, setShiftMap] = useState({});
  const [defaultShift, setDefaultShift] = useState(null);
  const [holidaySet, setHolidaySet] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [locations, setLocations] = useState([]); // AppLocation rows, each optionally carrying biometric_devices[]
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [collapsedDepts, setCollapsedDepts] = useState({});
  const [markingAbsent, setMarkingAbsent] = useState(false);
  const [repairingSessions, setRepairingSessions] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [calMonthRecords, setCalMonthRecords] = useState([]); // all records for the month (calendar view)
  const [silentRefreshing, setSilentRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [empCal, setEmpCal] = useState({ open: false, emp: null, year: new Date().getFullYear(), month: new Date().getMonth() + 1, records: [], leaveBalances: [], loading: false });

  // Shifts and Holidays are reference data, not per-day — loaded once rather
  // than on every date change / 30s silent refresh below.
  useEffect(() => {
    (async () => {
      try {
        const [shifts, holidays, appLocations] = await Promise.all([
          base44.entities.Shift.list(),
          base44.entities.Holiday.list(),
          base44.entities.AppLocation.list(),
        ]);
        const map = {};
        let def = null;
        shifts.forEach(s => { map[s.id] = s; if (s.is_default) def = s; });
        setShiftMap(map);
        setDefaultShift(def || { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] });
        setHolidaySet(new Set(holidays.map(h => toDateStr(h.date))));
        setLocations(appLocations);
      } catch { /* best-effort — falls back to treating every missing record as absent */ }
    })();
  }, []);

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
      // The 30s background poll only needs fresh Attendance rows — the
      // employee roster, user directory and department list it used to
      // refetch alongside them are effectively static for the page's
      // lifetime, so re-pulling all of them (Employee up to 500 rows,
      // every user, every department) every 30 seconds was four full
      // requests' worth of wasted work per tick for zero behavioral gain.
      // A full reload still happens on date change and the manual Refresh
      // button (both call loadData(false)).
      if (silent && employees.length > 0) {
        const attendanceResp = await base44.functions.invoke('getAllAttendance', { date });
        const dayRecords = attendanceResp.data?.records || [];
        const map = {};
        dayRecords.forEach(r => { map[r.user_id] = r; });
        setAttendanceMap(map);
        return;
      }

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
        // Visibility is hierarchical (direct + indirect reports), not just
        // direct reports — a manager can see their whole downstream team's
        // attendance. This page has no approve/reject action, so there's no
        // approval-authority concern here; that's enforced independently on
        // the actual approval pages (Leave/Regularisation/Reimbursement/
        // GatePass) and again server-side regardless of what this shows.
        const { directIds, downstreamIds } = resolveHierarchy(currentUser.id, empRecords);
        emps = emps.map(e => ({ ...e, _isDirectReport: directIds.has(e.user_id) })).filter(e => downstreamIds.has(e.user_id));
      }
      // hr, admin, management see all employees — no filtering

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
      const offStatus = scheduledOffStatus(emp, date, holidaySet, shiftMap, defaultShift);
      return {
        id: `virtual_${emp.user_id}`,
        user_id: emp.user_id,
        date,
        status: offStatus || 'absent',
        working_hours: 0,
        _virtual: true,
        _emp: emp,
      };
    });
  }, [employees, attendanceMap, date, holidaySet, shiftMap, defaultShift]);

  // Which configured location a biometric device belongs to — e.g. punches
  // from a "Biomatrice 2" or "LabourAtt" device mean the employee is
  // physically at the Duhai site, while "Biometric" means Ghaziabad. Device
  // names are configured per-location in Location Master (AppLocation.
  // biometric_devices), not hardcoded, so HR can add/rename devices there
  // without a code change.
  const deviceLocationMap = useMemo(() => {
    const map = new Map();
    for (const loc of locations) {
      for (const device of (loc.biometric_devices || [])) {
        const key = String(device || '').trim().toUpperCase();
        if (key) map.set(key, loc.name);
      }
    }
    return map;
  }, [locations]);

  const resolveRecordLocation = (record) => {
    const device = String(record?.device_id || '').trim().toUpperCase();
    if (!device) return null;
    return deviceLocationMap.get(device) || null;
  };

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const displayStatus = getDisplayStatus(r);
      if (statusFilter !== 'all' && displayStatus !== statusFilter) return false;
      if (deptFilter !== 'all' && r._emp?.department !== deptFilter) return false;
      if (methodFilter !== 'all' && getAttendanceMethod(r).key !== methodFilter) return false;
      if (locationFilter !== 'all') {
        const loc = resolveRecordLocation(r);
        if (locationFilter === '__unresolved__' ? !!loc : loc !== locationFilter) return false;
      }
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        const name = (r._emp?.display_name || r._emp?._user?.full_name || '').toLowerCase();
        const code = (r._emp?.employee_code || '').toLowerCase();
        if (!name.includes(t) && !code.includes(t)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, deptFilter, methodFilter, locationFilter, deviceLocationMap, searchTerm]);


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
    present: rows.filter(r => ['present','late','on_duty','work_from_home','short_attendance'].includes(r.status) || (r.check_in_time && !['absent','leave','holiday','week_off','half_day'].includes(r.status))).length,
    absent: rows.filter(r => r.status === 'absent' || (!r.check_in_time && !r.status)).length,
    halfDay: rows.filter(r => r.status === 'half_day').length,
    leave: rows.filter(r => r.status === 'leave').length,
    late: rows.filter(r => r.late_minutes > 0 || r.late_arrival_minutes > 0).length,
    earlyOut: rows.filter(r => r.early_departure || r.early_departure_minutes > 0).length,
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

  const handleRepairSessions = async () => {
    if (!window.confirm('Scan all auto-closed attendance records and strip synthetic "ghost" checkout punches left over from a past bug (late biometric syncs splitting one work session into fake 1-minute sessions with a bogus break)? This is safe to run any time.')) return;
    setRepairingSessions(true);
    try {
      const res = await base44.functions.invoke('repairSyntheticAttendancePunches', {});
      if (res.data?.success) {
        toast.success(res.data.message || `Repaired ${res.data.repaired} record(s)`);
        loadData();
      } else {
        toast.error(res.data?.error || 'Repair failed');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setRepairingSessions(false);
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

  const [exportingSwipe, setExportingSwipe] = useState(false);
  const exportSwipeDetails = async () => {
    const [yr, mo] = date.split('-').map(Number);
    setExportingSwipe(true);
    try {
      toast.info('Generating swipe details…');
      const res = await base44.functions.invoke('exportSwipeDetails', { month: mo, year: yr, department: deptFilter });
      if (!res.data?.success) { toast.error(res.data?.error || 'Swipe details export failed'); return; }
      const byteChars = atob(res.data.base64);
      const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
      const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Swipe details exported — ${res.data.total_employees} employees`);
    } catch (e) { toast.error('Swipe details export error: ' + e.message); }
    setExportingSwipe(false);
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
          {/* flex-wrap so every action (Analytics, Mark Absent, Muster, Report)
              stays reachable on narrow phones instead of overflowing off-screen */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/AttendanceReports')} title="View Attendance Analytics">
              <BarChart3 className="w-4 h-4 mr-1" /> Analytics
            </Button>
            <BiometricSyncStatus />
            <Button variant="outline" size="sm" onClick={handleMarkAbsent} disabled={markingAbsent} title="Mark employees without attendance as Absent">
              <UserX className="w-4 h-4 mr-1" /> {markingAbsent ? 'Marking...' : 'Mark Absent'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRepairSessions} disabled={repairingSessions} title="Fix records with fake 1-minute sessions/bogus breaks caused by late biometric syncs">
              {repairingSessions ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wrench className="w-4 h-4 mr-1" />} {repairingSessions ? 'Repairing...' : 'Repair Sessions'}
            </Button>
            <Button variant="outline" size="sm" onClick={exportToExcel} title="Export Attendance Muster (monthly summary)">
              <Download className="w-4 h-4 mr-1" /> Muster
            </Button>
            <Button variant="outline" size="sm" onClick={exportDetailedReport} title="Export detailed report with session hours and overtime">
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Report
            </Button>
            <Button variant="outline" size="sm" onClick={exportSwipeDetails} disabled={exportingSwipe} title="Export first check-in/last check-out, method (biometric/selfie/geofence) and locations for every day of the month">
              {exportingSwipe ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Fingerprint className="w-4 h-4 mr-1" />} Swipe Details
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
            { label: 'Early Out', value: stats.earlyOut, color: 'text-amber-600' },
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
              <MobileSelect value={methodFilter} onValueChange={setMethodFilter} label="Method" className="w-[150px]" options={[
                { value: 'all', label: 'All Methods' },
                { value: 'biometric', label: 'Biometric' },
                { value: 'geofence', label: 'Geofence' },
                { value: 'selfie', label: 'Selfie' },
                { value: 'manual', label: 'Manual' },
              ]} />
              <MobileSelect value={locationFilter} onValueChange={setLocationFilter} label="Location" className="w-[160px]" options={[
                { value: 'all', label: 'All Locations' },
                ...locations.filter(l => (l.biometric_devices || []).length > 0).map(l => ({ value: l.name, label: l.name })),
                { value: '__unresolved__', label: 'Unmapped Device' },
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
            const recordedIds = new Set(dayRecs.map(r => r.user_id));
            const leave = dayRecs.filter(r => r.status === 'leave').length;
            const halfDay = dayRecs.filter(r => r.status === 'half_day').length;
            const present = dayRecs.filter(r => !['leave','half_day','absent'].includes(r.status) && (r.check_in_time || ['present','late','on_duty','work_from_home'].includes(r.status))).length;
            // Employees with no record on a day they weren't even scheduled to
            // work (a declared Holiday, or outside their Shift's working days —
            // typically Sunday) are on a paid day off, not absent.
            const off = employees.filter(e => !recordedIds.has(e.user_id) && scheduledOffStatus(e, ds, holidaySet, shiftMap, defaultShift)).length;
            const absent = employees.length - present - leave - halfDay - off;
            dayMap[ds] = { present, absent: Math.max(absent, 0), leave, halfDay, off, total: employees.length };
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
                                {info.off > 0 && <div className="text-[10px] leading-tight text-gray-400">{info.off} Off</div>}
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
                    <span className="text-xs text-green-600 font-medium">{records.filter(r => ['present','late','on_duty','work_from_home','short_attendance'].includes(r.status) || (r.check_in_time && !['absent','leave','holiday','week_off','half_day'].includes(r.status))).length} present</span>
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
                          className={`grid grid-cols-1 sm:grid-cols-[minmax(160px,240px)_1fr] gap-3 p-3 rounded-lg border bg-white hover:shadow-sm transition-shadow ${!record._virtual ? 'cursor-pointer' : ''}`}
                          onClick={() => !record._virtual && setSelectedRecord(record)}
                        >
                          {/* Name column — a hard grid track, not a flex sibling, so it can
                              never be squeezed or overlapped no matter how many chips the
                              other column ends up wrapping (multi-session rows previously
                              overlapped the name entirely once there were enough chips to
                              overflow a shared flex line). */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 font-semibold text-sm">{name.charAt(0).toUpperCase()}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm text-gray-900 truncate">{name}</p>
                              <p className="text-xs text-gray-400 truncate">{[emp?.employee_code, emp?.designation].filter(Boolean).join(' • ')}</p>
                            </div>
                          </div>

                          {/* Everything else — its own grid column, free to wrap onto as
                              many internal lines as it needs without ever touching the
                              name column's space. */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
                            {/* First In / Last Out — always shown as dedicated block */}
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
                            {(() => {
                              const method = getAttendanceMethod(record);
                              if (method.key === 'biometric') return (
                                <span className="inline-flex items-center gap-0.5 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                                  <Fingerprint className="w-3 h-3" /> Bio
                                </span>
                              );
                              if (method.key === 'geofence') return (
                                <span title={getGeofenceDetail(record)} className="inline-flex items-center gap-0.5 text-xs text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                  <MapPin className="w-3 h-3" /> Geofence
                                </span>
                              );
                              if (method.key === 'selfie') {
                                const selfieUrl = record.check_in_selfie_url || record.check_out_selfie_url;
                                const loc = record.check_in_location || record.check_out_location;
                                const locLabel = loc?.location_address || loc?.address || (loc?.latitude != null ? `${Number(loc.latitude).toFixed(4)}, ${Number(loc.longitude).toFixed(4)}` : '');
                                return (
                                  <span
                                    title={locLabel ? `Selfie — ${locLabel}` : 'Selfie'}
                                    className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200"
                                  >
                                    {selfieUrl ? (
                                      <img src={selfieUrl} alt="Selfie" className="w-4 h-4 rounded-full object-cover border border-blue-300" />
                                    ) : (
                                      <Camera className="w-3 h-3" />
                                    )}
                                    Selfie
                                    {locLabel && <><MapPin className="w-3 h-3 ml-0.5" /><span className="max-w-[140px] truncate">{locLabel}</span></>}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const loc = resolveRecordLocation(record);
                              return loc ? (
                                <span title={`Resolved from biometric device: ${record.device_id}`} className="inline-flex items-center gap-0.5 text-xs text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                  <MapPin className="w-3 h-3" /> {loc}
                                </span>
                              ) : null;
                            })()}
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
                            {record.regularised && (
                              <Badge className="text-xs bg-violet-100 text-violet-800 border border-violet-200" title="Marked present after regularisation approval">
                                Regularised
                              </Badge>
                            )}
                          </div>
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
              {empCal.emp?.display_name || empCal.emp?._user?.full_name || 'Employee'}
              {empCal.emp?.employee_code && <span className="text-xs font-normal text-gray-400">({empCal.emp.employee_code})</span>}
              {' '}— Attendance Calendar
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const { year, month, records, emp: calEmp, loading: calLoading } = empCal;
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

            const statusLabel = { present: 'P', late: 'P', absent: 'A', half_day: 'HD', leave: 'L', holiday: 'H', week_off: 'W', on_duty: 'OD', work_from_home: 'WFH', short_attendance: 'SA' };

            // A day with no Attendance record is only a real absence if the
            // employee was actually scheduled to work it — reuses the same
            // scheduledOffStatus() the org-wide heatmap already relies on, so
            // a Saturday that IS a working day per this employee's Shift (or
            // a Sunday that isn't the shift's off-day) correctly falls
            // through to "no record ⇒ absent" instead of being silently
            // skipped, while a declared Holiday or a real week-off day is
            // shown as such rather than blank or wrongly marked absent.
            const dayInfo = {};
            for (let d = 1; d <= daysInMonth; d++) {
              const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const rec = recMap[ds];
              const isFuture = ds > today;
              let status = rec ? getDisplayStatus(rec) : null;
              let inferred = false;
              if (!rec && !isFuture && calEmp) {
                const off = scheduledOffStatus(calEmp, ds, holidaySet, shiftMap, defaultShift);
                status = off || 'absent';
                inferred = true;
              }
              const isLate = !!rec && (rec.status === 'late' || rec.late_arrival || (rec.late_minutes > 0) || (rec.late_arrival_minutes > 0));
              const isEarlyOut = !!rec && (rec.early_departure || (rec.early_departure_minutes > 0));
              dayInfo[ds] = { rec, status, inferred, isFuture, isLate, isEarlyOut };
            }

            const summary = { present: 0, absent: 0, leave: 0, halfDay: 0, wfh: 0, ot: 0, late: 0, earlyOut: 0, holiday: 0, weekOff: 0 };
            Object.values(dayInfo).forEach(({ rec, status: s, isFuture, isLate, isEarlyOut }) => {
              if (isFuture) return;
              // Explicit non-present statuses must be checked BEFORE the
              // check_in_time fallback below — a half-day or auto-closed
              // absent record still has check_in_time set, so testing
              // check_in_time first (as this used to) silently reclassified
              // every half-day/absent-with-a-punch record as "present",
              // leaving the dedicated Absent/Half Day cards stuck at 0.
              if (s === 'absent') summary.absent++;
              else if (s === 'leave') summary.leave++;
              else if (s === 'half_day') summary.halfDay++;
              else if (s === 'holiday') summary.holiday++;
              else if (s === 'week_off') summary.weekOff++;
              else if (['present','late','on_duty','short_attendance','work_from_home'].includes(s) || rec?.check_in_time) summary.present++;
              if (s === 'work_from_home') summary.wfh++;
              if (rec && (rec.overtime_minutes || 0) > 0) summary.ot++;
              if (isLate) summary.late++;
              if (isEarlyOut) summary.earlyOut++;
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
                            const { rec, status, inferred, isFuture, isLate, isEarlyOut } = dayInfo[ds];
                            const colorClass = status ? (EMP_STATUS_CAL_COLORS[status] || 'bg-gray-50 border-gray-200 text-gray-500') : 'bg-white border-gray-100 text-gray-400';
                            const isToday = ds === today;
                            const checkIn = rec?.check_in_time;
                            const checkOut = rec?.check_out_time;
                            const hours = rec?.working_hours;
                            return (
                              <div
                                key={di}
                                className={`relative border rounded text-center py-1 px-0.5 text-[10px] font-medium leading-tight ${isFuture ? 'bg-gray-50 border-gray-100 text-gray-300' : colorClass} ${isToday ? 'ring-1 ring-blue-500' : ''} ${(isLate || isEarlyOut) ? 'ring-1 ring-amber-400' : ''} ${rec ? 'cursor-pointer hover:ring-1 hover:ring-blue-400' : ''}`}
                                title={rec ? `${status?.replace(/_/g,' ')}${rec.regularised ? ' (Regularised)' : ''}${isLate ? ' · Late arrival' : ''}${isEarlyOut ? ' · Early departure' : ''}${checkIn ? ` · In: ${safeTime(checkIn)}` : ''}${checkOut ? ` · Out: ${safeTime(checkOut)}` : ''}${hours ? ` · ${hours.toFixed(1)}h` : ''} — click for full details` : (isFuture ? '' : `${status?.replace(/_/g,' ') || 'Absent'}${inferred && status === 'absent' ? ' — no attendance record' : ''}`)}
                                onClick={() => rec && setSelectedRecord(rec)}
                              >
                                {rec?.regularised && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-violet-500" />}
                                {isLate && <span className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" title="Late arrival" />}
                                {isEarlyOut && <span className="absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" title="Early departure" />}
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
                      {[['P','bg-green-100 text-green-700','Present'],['A','bg-red-100 text-red-700','Absent'],['L','bg-blue-100 text-blue-700','Leave'],['HD','bg-yellow-100 text-yellow-700','Half Day'],['WFH','bg-cyan-100 text-cyan-700','WFH'],['OD','bg-teal-100 text-teal-700','On Duty'],['H','bg-purple-100 text-purple-700','Holiday'],['W','bg-gray-100 text-gray-500','Week Off']].map(([code, cls, label]) => (
                        <span key={code} className={`px-1.5 py-0.5 rounded border ${cls}`}>{code} {label}</span>
                      ))}
                      <span className="px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Regularised
                      </span>
                      <span className="px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Late Arrival
                      </span>
                      <span className="px-1.5 py-0.5 rounded border bg-orange-50 text-orange-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Early Departure
                      </span>
                    </div>

                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        { label: 'Present', value: summary.present, cls: 'text-green-700 bg-green-50' },
                        { label: 'Absent', value: summary.absent, cls: 'text-red-700 bg-red-50' },
                        { label: 'Leave', value: summary.leave, cls: 'text-blue-700 bg-blue-50' },
                        { label: 'Half Day', value: summary.halfDay, cls: 'text-yellow-700 bg-yellow-50' },
                        { label: 'WFH', value: summary.wfh, cls: 'text-cyan-700 bg-cyan-50' },
                        { label: 'Late Arrival', value: summary.late, cls: 'text-amber-700 bg-amber-50' },
                        { label: 'Early Departure', value: summary.earlyOut, cls: 'text-orange-700 bg-orange-50' },
                        { label: 'Holiday', value: summary.holiday, cls: 'text-purple-700 bg-purple-50' },
                        { label: 'Week Off', value: summary.weekOff, cls: 'text-gray-700 bg-gray-50' },
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