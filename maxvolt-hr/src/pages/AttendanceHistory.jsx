import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AttendanceCalendar from '../components/attendance/AttendanceCalendar';
import AttendanceDetailsDialog from '../components/attendance/AttendanceDetailsDialog';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isAfter, getDay } from 'date-fns';
import { safeDate, safeTime } from '@/lib/dateUtils';
import { ClipboardList } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from 'react-router-dom';

export default function AttendanceHistory() {
  const [user, setUser] = useState(null);
  const [attendanceData, setAttendanceData] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const [records, holidayRecords] = await Promise.all([
        base44.entities.Attendance.filter({ user_id: currentUser.id }, '-date', 500),
        base44.entities.Holiday.list()
      ]);
      setAttendanceData(records);
      setHolidays(holidayRecords);
      setLoading(false);
    } catch (error) {
      console.error('Error loading attendance:', error);
      setLoading(false);
    }
  };

  const handleDayClick = (day, attendance) => {
    if (attendance) {
      setSelectedDay({ day, attendance });
    }
  };

  // Compute stats for the selected month
  const getMonthStats = () => {
    const today = new Date();
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

    const holidayDates = holidays.map(h => h.date);

    const isHoliday = (date) => holidayDates.some(hd => isSameDay(new Date(hd), date));
    const isSunday = (date) => getDay(date) === 0;

    let present = 0, absent = 0, leave = 0, totalHours = 0;

    daysInMonth.forEach(day => {
      if (isAfter(day, today)) return; // skip future days
      const att = attendanceData.find(a => isSameDay(new Date(a.date), day));
      if (att) {
        if (att.status === 'present' || att.status === 'half_day' || att.status === 'on_duty') present++;
        else if (att.status === 'absent') absent++;
        else if (att.status === 'leave') leave++;
        totalHours += att.working_hours || 0;
      } else {
        // No record: if not sunday and not holiday, count as absent
        if (!isSunday(day) && !isHoliday(day)) {
          absent++;
        }
      }
    });

    return { present, absent, leave, totalHours };
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const stats = getMonthStats();

  const statusColors = {
    present: 'bg-green-100 text-green-800',
    absent: 'bg-red-100 text-red-800',
    half_day: 'bg-yellow-100 text-yellow-800',
    leave: 'bg-blue-100 text-blue-800',
    holiday: 'bg-purple-100 text-purple-800',
    week_off: 'bg-gray-100 text-gray-800'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-3xl">Attendance History</CardTitle>
                <p className="text-gray-600">View your attendance records</p>
              </div>
              <Link to="/AttendanceRegularisation">
                <Button variant="outline" className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" />
                  Regularisation Requests
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <AttendanceCalendar
              attendanceData={attendanceData}
              holidays={holidays}
              currentMonth={currentMonth}
              onMonthChange={setCurrentMonth}
              onDayClick={handleDayClick}
            />
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-600">{stats.present}</p>
                <p className="text-sm text-gray-600 mt-2">Present Days</p>
                <p className="text-xs text-gray-400">{format(currentMonth, 'MMM yyyy')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-red-600">{stats.absent}</p>
                <p className="text-sm text-gray-600 mt-2">Absent Days</p>
                <p className="text-xs text-gray-400">{format(currentMonth, 'MMM yyyy')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-600">{stats.leave}</p>
                <p className="text-sm text-gray-600 mt-2">Leave Days</p>
                <p className="text-xs text-gray-400">{format(currentMonth, 'MMM yyyy')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-purple-600">{stats.totalHours.toFixed(1)}</p>
                <p className="text-sm text-gray-600 mt-2">Total Hours</p>
                <p className="text-xs text-gray-400">{format(currentMonth, 'MMM yyyy')}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Daily Hours List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily Working Hours — {format(currentMonth, 'MMMM yyyy')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {attendanceData
                .filter(a => {
                  const d = new Date(a.date);
                  return a.working_hours && d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                  <div>
                    <p className="font-medium text-sm">{safeDate(a.date, 'EEE, MMM d, yyyy')}</p>
                    <div className="flex gap-3 text-xs text-gray-500 mt-1">
                      {a.check_in_time && <span>In: {safeTime(a.check_in_time)}</span>}
                      {a.check_out_time && <span>Out: {safeTime(a.check_out_time)}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-blue-600">{a.working_hours?.toFixed(2)}h</p>
                    <Badge className={statusColors[a.status] || 'bg-gray-100 text-gray-700'}>
                      {a.status?.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                </div>
              ))}
              {attendanceData.filter(a => {
                const d = new Date(a.date);
                return a.working_hours && d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
              }).length === 0 && (
                <p className="text-center text-gray-400 py-6">No working hours recorded for {format(currentMonth, 'MMMM yyyy')}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <AttendanceDetailsDialog
          record={selectedDay?.attendance}
          employee={{ display_name: user?.full_name, user: { full_name: user?.full_name } }}
          open={!!selectedDay}
          onClose={() => setSelectedDay(null)}
        />
      </div>
    </div>
  );
}