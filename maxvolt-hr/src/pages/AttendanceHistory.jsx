import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AttendanceCalendar from '../components/attendance/AttendanceCalendar';
import AttendanceDetailsDialog from '../components/attendance/AttendanceDetailsDialog';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isAfter, getDay } from 'date-fns';
import { safeDate, safeTime } from '@/lib/dateUtils';
import { ClipboardList, Coffee, Activity, Fingerprint, MapPin, Camera, DoorOpen } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { getAttendanceMethod, getCheckInMethod, getCheckOutMethod, effectiveStatus, isCurrentlyInProgress } from '@/lib/attendanceSource';

const METHOD_SHORT_LABEL = { biometric: 'Biometric', geofence: 'Geofence', selfie: 'Selfie', manual: 'Manual' };
import { Button } from "@/components/ui/button";
import { Link } from 'react-router-dom';

export default function AttendanceHistory() {
  const [user, setUser] = useState(null);
  const [dateOfJoining, setDateOfJoining] = useState(null);
  const [attendanceData, setAttendanceData] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [gatePasses, setGatePasses] = useState({}); // 'yyyy-MM-dd' -> gate pass, only for days the employee actually departed
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

      const [records, holidayRecords, empRecords, gatePassRecords] = await Promise.all([
        base44.entities.Attendance.filter({ user_id: currentUser.id }, '-date', 500),
        base44.entities.Holiday.list(),
        base44.entities.Employee.filter({ user_id: currentUser.id }),
        base44.entities.GatePass.filter({ employee_user_id: currentUser.id }, '-created_date', 500),
      ]);
      setAttendanceData(records);
      setHolidays(holidayRecords);
      setDateOfJoining(empRecords?.[0]?.date_of_joining || null);

      // Only mark a day when the employee actually departed on that gate
      // pass — 'approved' (awaiting departure) or 'pending_approval'/
      // 'rejected'/'cancelled' passes never left the gate and shouldn't be
      // shown as a real outing. "Actually departed" == has a departure_time,
      // which every status past 'approved' (departed/returned/auto_closed)
      // carries. Last one wins per date if there was more than one that day.
      const gpMap = {};
      gatePassRecords
        .filter(g => g.departure_time && ['departed', 'returned', 'auto_closed'].includes(g.status))
        .forEach(g => { gpMap[g.request_date] = g; });
      setGatePasses(gpMap);

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
        // effectiveStatus so a past day stuck on a stale 'in_progress' flag
        // still counts correctly (present/absent) instead of falling into
        // neither present nor absent — see attendanceSource.js.
        const st = effectiveStatus(att);
        if (['present','late','on_duty','work_from_home','short_attendance'].includes(st)) present++;
        else if (st === 'half_day') present += 0.5;
        else if (st === 'absent') absent++;
        else if (st === 'leave') leave++;
        totalHours += att.working_hours || 0;
      } else {
        // No record: if not sunday, not holiday, and not before this
        // employee's own joining date, count as absent.
        const dayStr = format(day, 'yyyy-MM-dd');
        const isPreJoining = dateOfJoining && dayStr < dateOfJoining;
        if (!isSunday(day) && !isHoliday(day) && !isPreJoining) {
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
    late: 'bg-orange-100 text-orange-800',
    short_attendance: 'bg-rose-100 text-rose-800',
    on_duty: 'bg-teal-100 text-teal-800',
    work_from_home: 'bg-cyan-100 text-cyan-800',
    absent: 'bg-red-100 text-red-800',
    half_day: 'bg-yellow-100 text-yellow-800',
    leave: 'bg-blue-100 text-blue-800',
    holiday: 'bg-purple-100 text-purple-800',
    week_off: 'bg-gray-100 text-gray-800',
    in_progress: 'bg-amber-100 text-amber-800',
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
              dateOfJoining={dateOfJoining}
              gatePasses={gatePasses}
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
            {(() => {
              const fmtMins = (mins) => {
                if (!mins || mins <= 0) return null;
                const h = Math.floor(mins / 60), m = Math.round(mins % 60);
                return h > 0 ? `${h}h ${m}m` : `${m}m`;
              };
              const monthRecords = attendanceData
                .filter(a => {
                  const d = new Date(a.date);
                  return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date));
              if (!monthRecords.length) return (
                <p className="text-center text-gray-400 py-6">No records for {format(currentMonth, 'MMMM yyyy')}</p>
              );
              return (
                <div className="space-y-2">
                  {monthRecords.map(a => {
                    const sessions = a.sessions || (a.punch_sessions?.filter(s => s.punch_in || s.session_number) || []);
                    const totalWorkMins = a.total_working_minutes ?? (a.working_hours ? Math.round(a.working_hours * 60) : 0);
                    const totalBreakMins = a.total_break_minutes ?? (a.break_hours ? Math.round(a.break_hours * 60) : 0);
                    // Only genuinely TODAY's record can be "Working" — a
                    // stale is_in_progress on a past day (missed closing
                    // punch, not yet auto-closed, or auto-closed already)
                    // must never read as still in progress. See
                    // attendanceSource.js.
                    const isWorking = isCurrentlyInProgress(a);
                    const displayStatus = effectiveStatus(a);
                    const sessionCount = a.session_count || sessions.length;
                    const method = getAttendanceMethod(a);
                    const gatePass = gatePasses[String(a.date).slice(0, 10)] || null;
                    return (
                      <div
                        key={a.id}
                        className="border rounded-lg p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => setSelectedDay({ day: new Date(a.date), attendance: a })}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{safeDate(a.date, 'EEE, MMM d, yyyy')}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-gray-500 mt-1">
                              {a.check_in_time && <span className="text-green-600">In: {safeTime(a.check_in_time)}</span>}
                              {/* is_in_progress takes priority over a stale
                                  check_out_time — that field only ever
                                  reflects the LAST *completed* session's
                                  checkout (see buildSessions), so after a
                                  check-out then a NEW check-in later the
                                  same day, check_out_time is still sitting
                                  there from the earlier session even though
                                  a fresh session is genuinely active. */}
                              {isWorking
                                ? <span className="text-green-500 flex items-center gap-0.5"><Activity className="w-3 h-3" /> Working</span>
                                : a.check_out_time && <span className="text-red-500">Out: {safeTime(a.check_out_time)}</span>
                              }
                              {sessionCount > 1 && <span className="text-blue-500">{sessionCount} sessions</span>}
                              {gatePass && (
                                <span className="text-orange-600 flex items-center gap-0.5" title={gatePass.reason || ''}>
                                  <DoorOpen className="w-3 h-3" /> Gate Pass{gatePass.outing_type ? ` — ${gatePass.outing_type.replace(/_/g, ' ')}` : ''}
                                </span>
                              )}
                              {totalBreakMins > 0 && (
                                <span className="text-amber-600 flex items-center gap-0.5">
                                  <Coffee className="w-3 h-3" /> Break: {fmtMins(totalBreakMins)}
                                </span>
                              )}
                              {a.check_in_time && a.check_out_time && getCheckInMethod(a).key !== getCheckOutMethod(a).key ? (
                                <span className="text-purple-600 flex items-center gap-0.5">
                                  In: {METHOD_SHORT_LABEL[getCheckInMethod(a).key]} · Out: {METHOD_SHORT_LABEL[getCheckOutMethod(a).key]}
                                </span>
                              ) : (
                                <>
                                  {a.check_in_time && method.key === 'biometric' && (
                                    <span className="text-green-600 flex items-center gap-0.5"><Fingerprint className="w-3 h-3" /> Biometric</span>
                                  )}
                                  {a.check_in_time && method.key === 'geofence' && (
                                    <span className="text-indigo-600 flex items-center gap-0.5"><MapPin className="w-3 h-3" /> Geofence</span>
                                  )}
                                  {a.check_in_time && method.key === 'selfie' && (
                                    <span className="text-blue-600 flex items-center gap-0.5"><Camera className="w-3 h-3" /> Selfie</span>
                                  )}
                                </>
                              )}
                            </div>
                            {/* Per-session mini timeline */}
                            {sessions.length > 1 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {sessions.map((s, i) => {
                                  const cin  = s.check_in  || s.punch_in;
                                  const cout = s.check_out || s.punch_out;
                                  const dur  = s.duration_minutes != null ? s.duration_minutes : (s.duration_hours != null ? Math.round(s.duration_hours * 60) : null);
                                  return (
                                    <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">
                                      S{i + 1}: {safeTime(cin)}{cout ? `→${safeTime(cout)}` : '●'}
                                      {dur != null && ` (${fmtMins(dur)})`}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xl font-bold text-blue-600">
                              {totalWorkMins > 0 ? fmtMins(totalWorkMins) : (isWorking ? '●' : '-')}
                            </p>
                            <Badge className={statusColors[displayStatus] || 'bg-gray-100 text-gray-700'}>
                              {(displayStatus || '').replace(/_/g, ' ').toUpperCase()}
                            </Badge>
                            {a.regularised && (
                              <Badge className="ml-1 bg-violet-100 text-violet-800 border-violet-200" title="Marked present after regularisation approval">
                                Regularised
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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