import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Clock, TrendingDown, BarChart3, Users, RefreshCw, Fingerprint, Camera, MapPin, Activity } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function toDateStr(val) { return val ? String(val).slice(0, 10) : ''; }

export default function AttendanceReports() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [attendance, setAttendance] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [bioLogs, setBioLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [month, year]);

  const loadData = async () => {
    setLoading(true);
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [records, emps, logs] = await Promise.all([
      base44.entities.Attendance.filter({ date: { $gte: startStr, $lte: endStr } }, '-date', 5000),
      base44.entities.Employee.filter({ status: 'active' }, '-created_date', 500),
      base44.entities.AttendanceLog.filter({}, '-LogDate', 3000).catch(() => []),
    ]);

    const filtered = records.filter(r => {
      const d = toDateStr(r.date);
      return d >= startStr && d <= endStr;
    });

    // Filter biometric logs to this month
    const filteredLogs = logs.filter(l => {
      const ld = toDateStr(l.LogDate || l.log_date || l.date);
      return ld >= startStr && ld <= endStr;
    });

    setAttendance(filtered);
    setEmployees(emps);
    setBioLogs(filteredLogs);
    setLoading(false);
  };

  // --- Derived stats ---
  const stats = useMemo(() => {
    const total = attendance.length;
    const present = attendance.filter(a => ['present', 'on_duty'].includes(a.status)).length;
    const halfDay = attendance.filter(a => a.status === 'half_day').length;
    const absent = attendance.filter(a => a.status === 'absent').length;
    const late = attendance.filter(a => a.late_arrival).length;
    const earlyOut = attendance.filter(a => a.early_departure).length;
    const biometric = attendance.filter(a => a.biometric_synced).length;
    const selfie = attendance.filter(a => !a.biometric_synced && (a.check_in_selfie_url || a.check_out_selfie_url)).length;
    const avgHours = total > 0 ? (attendance.reduce((s, a) => s + (a.working_hours || 0), 0) / total) : 0;
    const totalOvertime = attendance.reduce((s, a) => s + (a.overtime_hours || 0), 0);
    return { total, present, halfDay, absent, late, earlyOut, biometric, selfie, avgHours, totalOvertime };
  }, [attendance]);

  // --- Daily trend ---
  const dailyTrend = useMemo(() => {
    const map = {};
    attendance.forEach(a => {
      const d = toDateStr(a.date);
      if (!d) return;
      if (!map[d]) map[d] = { date: d, present: 0, absent: 0, halfDay: 0, late: 0, earlyOut: 0 };
      if (['present', 'on_duty'].includes(a.status)) map[d].present++;
      else if (a.status === 'half_day') map[d].halfDay++;
      else if (a.status === 'absent') map[d].absent++;
      if (a.late_arrival) map[d].late++;
      if (a.early_departure) map[d].earlyOut++;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      ...d,
      label: safeDate(d.date + 'T12:00:00', 'd'),
    }));
  }, [attendance]);

  // --- Department breakdown ---
  const deptBreakdown = useMemo(() => {
    const map = {};
    employees.forEach(e => {
      const dept = e.department || 'Unknown';
      if (!map[dept]) map[dept] = { dept, employees: 0, present: 0, absent: 0, late: 0, earlyOut: 0, avgHours: 0, totalHours: 0, records: 0 };
      map[dept].employees++;
    });
    attendance.forEach(a => {
      const emp = employees.find(e => e.user_id === a.user_id);
      const dept = emp?.department || 'Unknown';
      if (!map[dept]) return;
      map[dept].records++;
      if (['present', 'on_duty'].includes(a.status)) map[dept].present++;
      if (a.status === 'absent') map[dept].absent++;
      if (a.late_arrival) map[dept].late++;
      if (a.early_departure) map[dept].earlyOut++;
      map[dept].totalHours += a.working_hours || 0;
    });
    return Object.values(map).map(d => ({
      ...d,
      avgHours: d.records > 0 ? parseFloat((d.totalHours / d.records).toFixed(1)) : 0,
      attendanceRate: d.records > 0 ? parseFloat(((d.present / d.records) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.employees - a.employees);
  }, [attendance, employees]);

  // --- Late arrivals top offenders ---
  const lateOffenders = useMemo(() => {
    const map = {};
    attendance.filter(a => a.late_arrival && a.late_arrival_minutes > 0).forEach(a => {
      if (!map[a.user_id]) {
        const emp = employees.find(e => e.user_id === a.user_id);
        map[a.user_id] = { name: emp?.display_name || a.user_id, dept: emp?.department || '', count: 0, totalMins: 0 };
      }
      map[a.user_id].count++;
      map[a.user_id].totalMins += a.late_arrival_minutes || 0;
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [attendance, employees]);

  // --- Early departure top offenders ---
  const earlyOffenders = useMemo(() => {
    const map = {};
    attendance.filter(a => a.early_departure && a.early_departure_minutes > 0).forEach(a => {
      if (!map[a.user_id]) {
        const emp = employees.find(e => e.user_id === a.user_id);
        map[a.user_id] = { name: emp?.display_name || a.user_id, dept: emp?.department || '', count: 0, totalMins: 0 };
      }
      map[a.user_id].count++;
      map[a.user_id].totalMins += a.early_departure_minutes || 0;
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [attendance, employees]);

  // --- Method distribution ---
  const methodDist = useMemo(() => [
    { name: 'Biometric', value: stats.biometric, color: '#10b981' },
    { name: 'Selfie', value: stats.selfie, color: '#3b82f6' },
    { name: 'Manual', value: stats.total - stats.biometric - stats.selfie, color: '#9ca3af' },
  ].filter(m => m.value > 0), [stats]);

  // --- Biometric log stats ---
  const bioStats = useMemo(() => {
    const total = bioLogs.length;
    const inPunches  = bioLogs.filter(l => (l.Direction || l.device_direction || '').toUpperCase() === 'IN').length;
    const outPunches = bioLogs.filter(l => (l.Direction || l.device_direction || '').toUpperCase() === 'OUT').length;
    const uniqueEmps = new Set(bioLogs.map(l => l.EmployeeCode || l.employee_code)).size;
    const uniqueDays = new Set(bioLogs.map(l => toDateStr(l.LogDate || l.log_date))).size;
    return { total, inPunches, outPunches, uniqueEmps, uniqueDays };
  }, [bioLogs]);

  // --- Location-wise attendance ---
  const locationBreakdown = useMemo(() => {
    const map = {};
    employees.forEach(e => {
      const loc = e.work_location || 'Unspecified';
      if (!map[loc]) map[loc] = { location: loc, employees: 0, present: 0, absent: 0, late: 0, earlyOut: 0, totalHours: 0, records: 0 };
      map[loc].employees++;
    });
    attendance.forEach(a => {
      const emp = employees.find(e => e.user_id === a.user_id);
      const loc = emp?.work_location || 'Unspecified';
      if (!map[loc]) return;
      map[loc].records++;
      if (['present', 'on_duty', 'late', 'short_attendance'].includes(a.status)) map[loc].present++;
      if (a.status === 'absent') map[loc].absent++;
      if (a.late_arrival) map[loc].late++;
      if (a.early_departure) map[loc].earlyOut++;
      map[loc].totalHours += a.working_hours || 0;
    });
    return Object.values(map).map(loc => ({
      ...loc,
      attendanceRate: loc.records > 0 ? parseFloat(((loc.present / loc.records) * 100).toFixed(1)) : 0,
      avgHours: loc.records > 0 ? parseFloat((loc.totalHours / loc.records).toFixed(1)) : 0,
    })).sort((a, b) => b.employees - a.employees);
  }, [attendance, employees]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <RefreshCw className="animate-spin w-6 h-6 text-blue-500 mr-2" /> Loading reports...
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Attendance Analytics</h1>
            <p className="text-sm text-gray-500 mt-0.5">Late arrivals, early departures & department-wise breakdown</p>
          </div>
          <div className="flex gap-2">
            <Select value={month.toString()} onValueChange={v => setMonth(parseInt(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...Array(12)].map((_, i) => (
                  <SelectItem key={i + 1} value={(i + 1).toString()}>
                    {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={year.toString()} onValueChange={v => setYear(parseInt(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026].map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Present Days', value: stats.present, color: 'text-green-600', sub: `${stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : 0}% rate` },
            { label: 'Absent Days', value: stats.absent, color: 'text-red-600', sub: 'This month' },
            { label: 'Late Arrivals', value: stats.late, color: 'text-orange-600', sub: 'Instances' },
            { label: 'Early Departures', value: stats.earlyOut, color: 'text-yellow-600', sub: 'Instances' },
            { label: 'Avg Work Hrs', value: `${stats.avgHours.toFixed(1)}h`, color: 'text-blue-600', sub: `${stats.totalOvertime.toFixed(1)}h overtime` },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Attendance Method + Daily Trend */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Fingerprint className="w-4 h-4 text-green-500" />Attendance Method</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={methodDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {methodDist.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {methodDist.map(m => (
                  <div key={m.name} className="flex items-center gap-1 text-xs text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }}></span>
                    {m.name}: <strong>{m.value}</strong>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-500" />Daily Attendance Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="present" stroke="#10b981" strokeWidth={2} dot={false} name="Present" />
                  <Line type="monotone" dataKey="absent" stroke="#ef4444" strokeWidth={2} dot={false} name="Absent" />
                  <Line type="monotone" dataKey="late" stroke="#f97316" strokeWidth={1.5} dot={false} name="Late" strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="earlyOut" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Early Out" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Department Breakdown */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-blue-500" />Department-wise Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={deptBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="dept" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="present" fill="#10b981" name="Present" stackId="a" />
                  <Bar dataKey="halfDay" fill="#f59e0b" name="Half Day" stackId="a" />
                  <Bar dataKey="absent" fill="#ef4444" name="Absent" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600 text-left">
                      <th className="px-3 py-2 font-medium">Department</th>
                      <th className="px-3 py-2 text-right font-medium">Staff</th>
                      <th className="px-3 py-2 text-right font-medium">Rate</th>
                      <th className="px-3 py-2 text-right font-medium">Late</th>
                      <th className="px-3 py-2 text-right font-medium">Early Out</th>
                      <th className="px-3 py-2 text-right font-medium">Avg Hrs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptBreakdown.map(d => (
                      <tr key={d.dept} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-800">{d.dept}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{d.employees}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`font-semibold ${d.attendanceRate >= 80 ? 'text-green-600' : d.attendanceRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {d.attendanceRate}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-orange-600 font-medium">{d.late}</td>
                        <td className="px-3 py-2 text-right text-yellow-600 font-medium">{d.earlyOut}</td>
                        <td className="px-3 py-2 text-right text-blue-600 font-medium">{d.avgHours}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Late Arrivals & Early Departures */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                Top Late Arrivals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lateOffenders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No late arrivals this month 🎉</p>
              ) : (
                <div className="space-y-2">
                  {lateOffenders.map((emp, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-orange-50 border border-orange-100">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{emp.name}</p>
                        <p className="text-xs text-gray-500">{emp.dept}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-orange-600">{emp.count}x</p>
                        <p className="text-xs text-gray-500">avg {Math.round(emp.totalMins / emp.count)}m late</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-yellow-500" />
                Top Early Departures
              </CardTitle>
            </CardHeader>
            <CardContent>
              {earlyOffenders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No early departures this month 🎉</p>
              ) : (
                <div className="space-y-2">
                  {earlyOffenders.map((emp, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-yellow-50 border border-yellow-100">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{emp.name}</p>
                        <p className="text-xs text-gray-500">{emp.dept}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-yellow-600">{emp.count}x</p>
                        <p className="text-xs text-gray-500">avg {Math.round(emp.totalMins / emp.count)}m early</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Late + Early Out trend bars */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-500" />
              Daily Late Arrivals & Early Departures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="late" fill="#f97316" name="Late Arrivals" radius={[2, 2, 0, 0]} />
                <Bar dataKey="earlyOut" fill="#f59e0b" name="Early Departures" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Biometric Log Summary */}
        {bioStats.total > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" />
                Biometric Log Coverage
                <span className="ml-auto text-xs font-normal text-gray-400">{bioStats.total} total punches</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Punches', value: bioStats.total, color: 'text-gray-700', bg: 'bg-gray-50' },
                  { label: 'IN Punches', value: bioStats.inPunches, color: 'text-green-700', bg: 'bg-green-50' },
                  { label: 'OUT Punches', value: bioStats.outPunches, color: 'text-blue-700', bg: 'bg-blue-50' },
                  { label: 'Unique Employees', value: bioStats.uniqueEmps, color: 'text-purple-700', bg: 'bg-purple-50' },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} rounded-lg p-3`}>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Biometric punches recorded across <strong>{bioStats.uniqueDays}</strong> working days this month.
                Biometric coverage: <strong className="text-emerald-600">{employees.length > 0 ? Math.round((bioStats.uniqueEmps / employees.length) * 100) : 0}%</strong> of active employees.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Location-wise Attendance */}
        {locationBreakdown.length > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-indigo-500" />
                Location-wise Attendance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={locationBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="location" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="present" fill="#10b981" name="Present" stackId="a" />
                    <Bar dataKey="absent" fill="#ef4444" name="Absent" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 text-left">
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 text-right font-medium">Staff</th>
                        <th className="px-3 py-2 text-right font-medium">Rate</th>
                        <th className="px-3 py-2 text-right font-medium">Late</th>
                        <th className="px-3 py-2 text-right font-medium">Avg Hrs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationBreakdown.map(loc => (
                        <tr key={loc.location} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-800 flex items-center gap-1.5">
                            <MapPin className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            {loc.location}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">{loc.employees}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-semibold ${loc.attendanceRate >= 80 ? 'text-green-600' : loc.attendanceRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {loc.attendanceRate}%
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-orange-600 font-medium">{loc.late}</td>
                          <td className="px-3 py-2 text-right text-blue-600 font-medium">{loc.avgHours}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}