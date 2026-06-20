import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Building2, Clock, AlertTriangle, Fingerprint, Camera, RefreshCw, ChevronDown, ChevronUp, Download, UserX, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
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
  if (record.check_in_time) return 'present';
  return record.status;
}

export default function AllAttendance() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [attendanceMap, setAttendanceMap] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [collapsedDepts, setCollapsedDepts] = useState({});
  const [markingAbsent, setMarkingAbsent] = useState(false);

  useEffect(() => { loadData(); }, [date]);

  useEffect(() => {
    const interval = setInterval(() => loadData(), 30000);
    return () => clearInterval(interval);
  }, [date]);

  const loadData = async () => {
    setLoading(true);
    const currentUser = await base44.auth.me();
    const userRole = currentUser.custom_role || currentUser.role;

    const [empRecords, usersResp, attendanceResp] = await Promise.all([
      base44.entities.Employee.filter({ status: 'active' }, '-created_date', 500),
      base44.functions.invoke('getAllUsers', {}),
      base44.functions.invoke('getAllAttendance', { date }),
    ]);

    const users = usersResp.data?.users || [];
    const dayRecords = attendanceResp.data?.records || [];
    let emps = empRecords.map(e => ({ ...e, _user: users.find(u => u.id === e.user_id) }));

    if (userRole === 'manager') {
      // Manager sees only their direct reports (employees whose reporting_manager_id = this user)
      emps = emps.filter(e => e.reporting_manager_id === currentUser.id);
    } else if (userRole === 'management') {
      // Management sees their department
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

    setEmployees(emps);
    setAttendanceMap(map);
    setLoading(false);
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

  const departments = useMemo(() => [...new Set(employees.map(e => e.department).filter(Boolean))].sort(), [employees]);

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
    present: rows.filter(r => getDisplayStatus(r) === 'present' || r.status === 'on_duty').length,
    absent: rows.filter(r => !r.check_in_time && r.status === 'absent').length,
    halfDay: rows.filter(r => !r.check_in_time && r.status === 'half_day').length,
    leave: rows.filter(r => r.status === 'leave').length,
    late: rows.filter(r => r.late_arrival).length,
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
    // Use the currently selected date's month/year for export
    const [yr, mo] = date.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();

    // Fetch all attendance records for the full month
    const monthStart = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const monthEnd = `${yr}-${String(mo).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

    let monthRecords = [];
    try {
      const res = await base44.functions.invoke('getAllAttendance', { date_from: monthStart, date_to: monthEnd });
      monthRecords = res.data?.records || [];
    } catch { monthRecords = []; }

    // Build map: user_id -> { date -> status }
    const recordMap = {};
    monthRecords.forEach(r => {
      if (!recordMap[r.user_id]) recordMap[r.user_id] = {};
      recordMap[r.user_id][r.date?.slice(0,10)] = r;
    });

    const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
    const header1 = ['Employee Name', 'Employee No', 'Designation', 'Location', ...dayHeaders, 'Present', 'Leave', 'Holiday', 'Absent', 'Off Day', 'Rest Day', 'On duty', 'Status unknown', 'Total'];

    const csvRows = employees.map(emp => {
      const empRecords = recordMap[emp.user_id] || {};
      let present = 0, leave = 0, holiday = 0, absent = 0, offDay = 0, restDay = 0, onDuty = 0, unknown = 0;
      const dayCells = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const rec = empRecords[dateStr];
        const dow = new Date(dateStr).getDay(); // 0=Sun, 6=Sat
        let cell = '';
        if (!rec) {
          if (dow === 0) { cell = 'OFF'; offDay++; }
          else if (dow === 6) { cell = 'OFF'; offDay++; } // Saturday = week off by default
          else { cell = 'A'; absent++; }
        } else {
          // check_in_time (or biometric_synced) = actually present
          const hasCheckedIn = rec.check_in_time || rec.biometric_synced || rec.check_in_selfie_url;
          const s = rec.status;
          if (s === 'week_off') { cell = 'OFF'; offDay++; }
          else if (s === 'holiday') { cell = 'H'; holiday++; }
          else if (s === 'leave') { cell = 'L'; leave++; }
          else if (s === 'on_duty') { cell = 'OD'; onDuty++; }
          else if (s === 'half_day') { cell = 'HD'; present += 0.5; absent += 0.5; }
          else if (hasCheckedIn || s === 'present') { cell = 'P'; present++; }
          else { cell = 'A'; absent++; }
        }
        dayCells.push(cell);
      }

      const total = present + leave + holiday + absent + offDay + restDay + onDuty;
      return [
        emp.display_name || emp.employee_code,
        emp.employee_code,
        emp.designation || '',
        emp.work_location || '',
        ...dayCells,
        present, leave, holiday, absent, offDay, restDay, onDuty, unknown, total
      ];
    });

    // Build CSV
    const monthName = new Date(yr, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const titleRow = [`Attendance Muster - ${monthName}`];
    const csv = [titleRow, header1, ...csvRows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Attendance_Muster_${monthName.replace(' ', '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDetailedReport = async () => {
    const [yr, mo] = date.split('-').map(Number);
    try {
      toast.info('Generating attendance report…');
      const res = await base44.functions.invoke('exportAttendanceReport', { month: mo, year: yr });
      if (!res.data?.success) { toast.error(res.data?.error || 'Export failed'); return; }
      const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Report exported — ${res.data.total_employees} employees`);
    } catch (e) { toast.error('Export error: ' + e.message); }
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
            <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
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
                ...departments.map(d => ({ value: d, label: d }))
              ]} />
            </div>
          </CardContent>
        </Card>

        {/* Department Groups */}
        <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([dept, records]) => (
            <Card key={dept}>
              <CardHeader className="p-4 pb-2 cursor-pointer" onClick={() => toggleDept(dept)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-gray-800">
                    <Building2 className="w-4 h-4 text-blue-500" />
                    {dept}
                    <span className="text-sm font-normal text-gray-500">({records.length})</span>
                    <span className="text-xs text-green-600 font-medium">{records.filter(r => getDisplayStatus(r) === 'present' || r.status === 'on_duty').length} present</span>
                    {records.filter(r => !r.check_in_time && r.status === 'absent').length > 0 && (
                      <span className="text-xs text-red-500 font-medium">{records.filter(r => !r.check_in_time && r.status === 'absent').length} absent</span>
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
                      const name = emp?.display_name || emp?._user?.full_name || record.user_id;
                      const displayStatus = getDisplayStatus(record);
                      return (
                        <div
                          key={record.id}
                          className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-white hover:shadow-sm transition-shadow ${!record._virtual ? 'cursor-pointer' : ''}`}
                          onClick={() => !record._virtual && setSelectedRecord(record)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 font-semibold text-sm">{name.charAt(0).toUpperCase()}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm text-gray-900 truncate">{name}</p>
                              <p className="text-xs text-gray-500">{emp?.designation || emp?.employee_code}</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {/* Show all punch sessions if available, else fall back to check_in/check_out */}
                            {(record.punch_sessions?.length > 0 ? record.punch_sessions : (record.check_in_time ? [{ punch_in: record.check_in_time, punch_out: record.check_out_time }] : [])).map((session, idx) => (
                              <span key={idx} className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100">
                                {record.punch_sessions?.length > 1 && <span className="text-gray-400 mr-1">S{idx + 1}</span>}
                                <span className="text-green-600 font-medium">In</span> {format(new Date(session.punch_in), 'hh:mm a')}
                                {session.punch_out && <> · <span className="text-red-500 font-medium">Out</span> {format(new Date(session.punch_out), 'hh:mm a')}</>}
                                {!session.punch_out && <span className="text-green-500 ml-1">●</span>}
                              </span>
                            ))}
                            {record.working_hours > 0 && (
                              <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">{record.working_hours.toFixed(1)}h</span>
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
                            {record.late_arrival && record.late_arrival_minutes > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-orange-600">
                                <AlertTriangle className="w-3 h-3" /> {record.late_arrival_minutes}m late
                              </span>
                            )}
                            {emp?.overtime_eligible && record.overtime_minutes > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                <Clock className="w-3 h-3" /> OT {Math.floor(record.overtime_minutes/60)}h{record.overtime_minutes%60>0?`${record.overtime_minutes%60}m`:''}
                              </span>
                            )}
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
        </div>
      </div>

      <AttendanceDetailsDialog
        record={selectedRecord}
        employee={selectedRecord ? employees.find(e => e.user_id === selectedRecord.user_id) : null}
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />
    </div>
  );
}