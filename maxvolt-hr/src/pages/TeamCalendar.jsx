import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, UserCheck, UserX, CalendarDays, FileText, Clock, Users, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isSameDay, parseISO, addMonths, subMonths } from 'date-fns';

const STATUS_CONFIG = {
  present: { label: 'Present', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', dot: 'bg-green-500' },
  absent: { label: 'Absent', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', dot: 'bg-red-500' },
  leave: { label: 'On Leave', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', dot: 'bg-yellow-500' },
  half_day: { label: 'Half Day', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', dot: 'bg-orange-500' },
  holiday: { label: 'Holiday', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', dot: 'bg-purple-500' },
  week_off: { label: 'Week Off', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', dot: 'bg-gray-400' },
  no_record: { label: 'No Record', color: 'bg-gray-50 text-gray-400', dot: 'bg-gray-300' },
};

export default function TeamCalendar() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(undefined);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarData, setCalendarData] = useState({ employees: [], holidays: [], attendance: {}, leaves: {} });
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [tcEmpOpen, setTcEmpOpen] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [departments, setDepartments] = useState([]);
  const [viewMode, setViewMode] = useState('grid'); // grid | list

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null));
    base44.entities.Department.list().then(setDepartments).catch(() => {});
  }, []);

  useEffect(() => {
    if (currentUser !== undefined) loadCalendarData();
  }, [currentMonth, currentUser]);

  const loadCalendarData = async () => {
    setLoading(true);
    try {
      const month = currentMonth.getMonth() + 1;
      const year = currentMonth.getFullYear();
      const role = currentUser?.custom_role || currentUser?.role;
      const isManager = role === 'management' || role === 'manager';
      const params = { month, year };
      if (isManager && currentUser?.id) params.manager_id = currentUser.id;
      const response = await base44.functions.invoke('getTeamCalendar', params);
      const d = response?.data || response;
      if (d?.success) {
        setCalendarData(d.data);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };


  const filteredEmployees = useMemo(() => {
    return calendarData.employees.filter(e => {
      if (selectedEmployee !== 'all') return e.user_id === selectedEmployee;
      if (selectedDepartment !== 'all') return e.department === selectedDepartment;
      return true;
    });
  }, [calendarData.employees, selectedEmployee, selectedDepartment]);

  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const dayAbbreviations = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getStatusForDay = (userId, dateStr) => {
    // leaves[userId] is { "YYYY-MM-DD": "leave" } — a plain object, not an array
    const leaveMap    = calendarData.leaves[userId]     || {};
    const attendance  = calendarData.attendance[userId] || {};
    const holidays    = calendarData.holidays            || [];

    // Holidays first
    if (holidays.some(h => h.date === dateStr)) return 'holiday';

    // Sunday = week off
    if (getDay(parseISO(dateStr)) === 0) return 'week_off';

    // Leave
    if (leaveMap[dateStr]) return leaveMap[dateStr] === 'half_day' ? 'half_day' : 'leave';

    // Attendance record
    const rec = attendance[dateStr];
    if (rec) {
      if (rec === 'half_day') return 'half_day';
      if (rec === 'present' || rec === 'on_duty') return 'present';
      return rec;
    }

    return 'no_record';
  };

  useEffect(() => {
    setSelectedEmployee('all');
  }, [selectedDepartment]);

  // Quick stats for the month
  const stats = useMemo(() => {
    if (filteredEmployees.length === 0) return { total: 0, presentAvg: 0, absentAvg: 0, onLeave: 0 };
    const today = format(new Date(), 'yyyy-MM-dd');
    let presentCount = 0, absentCount = 0, leaveCount = 0;
    filteredEmployees.forEach(emp => {
      const status = getStatusForDay(emp.user_id, today);
      if (status === 'present' || status === 'half_day') presentCount++;
      else if (status === 'absent') absentCount++;
      else if (status === 'leave') leaveCount++;
    });
    return { total: filteredEmployees.length, presentCount, absentCount, leaveCount };
  }, [filteredEmployees, calendarData]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Team Calendar</h1>
            <p className="text-muted-foreground text-sm mt-1">See who's in and out at a glance</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
              {viewMode === 'grid' ? 'List View' : 'Grid View'}
            </Button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-0 bg-blue-50 dark:bg-blue-900/20">
            <CardContent className="p-4 flex items-center gap-3">
              <Users className="w-5 h-5 text-blue-600" />
              <div><p className="text-2xl font-bold text-blue-600">{stats.total}</p><p className="text-xs text-muted-foreground">Team Members</p></div>
            </CardContent>
          </Card>
          <Card className="border-0 bg-green-50 dark:bg-green-900/20">
            <CardContent className="p-4 flex items-center gap-3">
              <UserCheck className="w-5 h-5 text-green-600" />
              <div><p className="text-2xl font-bold text-green-600">{stats.presentCount}</p><p className="text-xs text-muted-foreground">In Today</p></div>
            </CardContent>
          </Card>
          <Card className="border-0 bg-red-50 dark:bg-red-900/20">
            <CardContent className="p-4 flex items-center gap-3">
              <UserX className="w-5 h-5 text-red-600" />
              <div><p className="text-2xl font-bold text-red-600">{stats.absentCount}</p><p className="text-xs text-muted-foreground">Absent Today</p></div>
            </CardContent>
          </Card>
          <Card className="border-0 bg-yellow-50 dark:bg-yellow-900/20">
            <CardContent className="p-4 flex items-center gap-3">
              <FileText className="w-5 h-5 text-yellow-600" />
              <div><p className="text-2xl font-bold text-yellow-600">{stats.leaveCount}</p><p className="text-xs text-muted-foreground">On Leave Today</p></div>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Month Navigation */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-lg font-bold min-w-[160px] text-center">{format(currentMonth, 'MMMM yyyy')}</h2>
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
              </div>
              <div className="flex gap-2">
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All Depts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Popover open={tcEmpOpen} onOpenChange={setTcEmpOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className="flex items-center justify-between rounded-md border border-input bg-background px-2 py-1 text-xs h-8 min-w-[144px] hover:bg-accent">
                      <span className="text-foreground truncate">
                        {selectedEmployee === 'all' ? 'All Employees' : (filteredEmployees.find(e => e.user_id === selectedEmployee)?.display_name || selectedEmployee)}
                      </span>
                      <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[240px] p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Search employee..." />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="all employees" onSelect={() => { setSelectedEmployee('all'); setTcEmpOpen(false); }}>
                            <Check className={`mr-2 h-4 w-4 ${selectedEmployee === 'all' ? 'opacity-100' : 'opacity-0'}`} /> All Employees
                          </CommandItem>
                          {filteredEmployees.map(e => (
                            <CommandItem key={e.user_id} value={`${e.display_name || ''}`} onSelect={() => { setSelectedEmployee(e.user_id); setTcEmpOpen(false); }}>
                              <Check className={`mr-2 h-4 w-4 ${selectedEmployee === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                              {e.display_name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 px-1">
          {Object.entries(STATUS_CONFIG).filter(([k]) => !['no_record', 'week_off'].includes(k)).map(([key, config]) => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <span className={`w-3 h-3 rounded-full ${config.dot}`}></span>
              <span className="text-muted-foreground">{config.label}</span>
            </div>
          ))}
        </div>

        {/* Calendar Grid View */}
        {viewMode === 'grid' ? (
          <Card>
            <CardContent className="p-2 md:p-4 overflow-x-auto">
              <div className="min-w-[700px]">
                {/* Day headers */}
                <div className="grid gap-px" style={{ gridTemplateColumns: `120px repeat(${days.length}, 1fr)` }}>
                  <div className="p-2 text-xs font-semibold text-muted-foreground text-center border-b">Employee</div>
                  {days.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    return (
                      <div key={dateStr} className={`p-1 text-center border-b ${isToday(day) ? 'bg-blue-50 dark:bg-blue-900/20 rounded-t' : ''}`}>
                        <p className="text-[10px] text-muted-foreground">{dayAbbreviations[getDay(day)]}</p>
                        <p className={`text-xs font-semibold ${isToday(day) ? 'text-blue-600' : ''}`}>{format(day, 'd')}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Employee rows */}
                {filteredEmployees.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No team members found</p>
                ) : (
                  filteredEmployees.map(emp => (
                    <div key={emp.user_id} className="grid gap-px mt-px" style={{ gridTemplateColumns: `120px repeat(${days.length}, 1fr)` }}>
                      <div className="p-2 text-xs truncate border-b flex flex-col justify-center">
                        <span className="font-medium">{emp.display_name}</span>
                        <span className="text-[10px] text-muted-foreground">{emp.department}</span>
                      </div>
                      {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const status = getStatusForDay(emp.user_id, dateStr);
                        const config = STATUS_CONFIG[status] || STATUS_CONFIG.no_record;
                        return (
                          <div key={dateStr} className={`h-7 flex items-center justify-center border-b border-r border-gray-50 ${isToday(day) ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`} title={`${emp.display_name}: ${config.label} — ${format(day, 'dd MMM')}`}>
                            <span className={`w-4 h-4 rounded-full ${config.dot}`}></span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          /* List View */
          <Card>
            <CardContent className="p-4">
              <div className="space-y-3">
                {filteredEmployees.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No team members found</p>
                ) : (
                  filteredEmployees.map(emp => {
                    const todayStr = format(new Date(), 'yyyy-MM-dd');
                    const todayStatus = getStatusForDay(emp.user_id, todayStr);
                    const config = STATUS_CONFIG[todayStatus] || STATUS_CONFIG.no_record;
                    return (
                      <div key={emp.user_id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-muted/30">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-primary font-semibold text-sm">{emp.display_name?.charAt(0)}</span>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{emp.display_name}</p>
                            <p className="text-xs text-muted-foreground">{emp.department} · {emp.designation}</p>
                          </div>
                        </div>
                        <Badge className={config.color}>{config.label}</Badge>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Leaves */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" /> Upcoming Leaves
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const upcomingLeaves = [];
              const today = format(new Date(), 'yyyy-MM-dd');
              // leaves[userId] is a date-map: { 'yyyy-MM-dd': 'leave' }
              Object.entries(calendarData.leaves).forEach(([userId, datemap]) => {
                const emp = calendarData.employees.find(e => e.user_id === userId);
                // Group consecutive leave dates into ranges
                const dates = Object.keys(datemap).filter(d => d >= today).sort();
                if (!dates.length) return;
                let start = dates[0], prev = dates[0];
                for (let i = 1; i <= dates.length; i++) {
                  const cur = dates[i];
                  const prevDay = new Date(prev);
                  const curDay = cur ? new Date(cur) : null;
                  const isConsec = curDay && (curDay - prevDay) <= 86400000;
                  if (!isConsec) {
                    upcomingLeaves.push({ start_date: start, end_date: prev, employee: emp, userId });
                    start = cur; prev = cur;
                  } else { prev = cur; }
                }
              });
              upcomingLeaves.sort((a, b) => a.start_date.localeCompare(b.start_date));
              if (upcomingLeaves.length === 0) return <p className="text-center text-muted-foreground py-4 text-sm">No upcoming leaves</p>;
              return (
                <div className="space-y-2">
                  {upcomingLeaves.slice(0, 10).map((leave, i) => (
                    <div key={i} className="flex items-center justify-between text-sm p-2 bg-yellow-50 dark:bg-yellow-900/10 rounded border border-yellow-200 dark:border-yellow-800">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-yellow-600" />
                        <span className="font-medium">{leave.employee?.display_name || 'Unknown'}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(leave.start_date), 'dd MMM')}
                        {leave.end_date && leave.end_date !== leave.start_date ? ` — ${format(parseISO(leave.end_date), 'dd MMM')}` : ''}
                      </span>
                      <Badge variant="outline" className="text-xs">{leave.leave_type || 'Leave'}</Badge>
                    </div>
                  ))}
                  {upcomingLeaves.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center">+{upcomingLeaves.length - 10} more</p>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}