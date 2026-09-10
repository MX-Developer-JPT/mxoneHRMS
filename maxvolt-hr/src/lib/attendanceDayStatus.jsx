import { CheckCircle, XCircle, Clock, Coffee, Briefcase, Home, Activity, AlarmClockOff, TimerOff } from 'lucide-react';
import { isSameDay, isAfter, format } from 'date-fns';
import { effectiveStatus } from '@/lib/attendanceSource';

// Single source of truth for the per-day attendance cell styling used by the
// "My Attendance" calendar (AttendanceCalendar.jsx) and, so employees can see
// exactly which days actually need fixing while they pick them, the
// Attendance Regularisation date pickers (MultiDateCalendarPicker.jsx /
// AttendanceRegularisation.jsx). Keep this in lockstep with
// AttendanceHistory.jsx's own `statusColors` list, which drives the same
// badges in that page's list view.
export const DAY_STATUS_CONFIG = {
  present:          { color: 'bg-green-100 text-green-800 border-green-200',  icon: CheckCircle,    label: 'Present' },
  late:             { color: 'bg-orange-100 text-orange-800 border-orange-300', icon: AlarmClockOff, label: 'Late' },
  short_attendance: { color: 'bg-rose-100 text-rose-800 border-rose-300',    icon: TimerOff,       label: 'Short Attendance' },
  on_duty:          { color: 'bg-teal-100 text-teal-800 border-teal-300',    icon: Briefcase,      label: 'On Duty' },
  work_from_home:   { color: 'bg-cyan-100 text-cyan-800 border-cyan-300',    icon: Home,           label: 'Work From Home' },
  absent:           { color: 'bg-red-100 text-red-800 border-red-200',       icon: XCircle,        label: 'Absent' },
  half_day:         { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock,        label: 'Half Day' },
  leave:            { color: 'bg-blue-100 text-blue-800 border-blue-200',    icon: Coffee,         label: 'Leave' },
  holiday:          { color: 'bg-purple-100 text-purple-800 border-purple-200', icon: Coffee,       label: 'Holiday' },
  week_off:         { color: 'bg-gray-100 text-gray-800 border-gray-200',    icon: Coffee,         label: 'Week Off' },
  present_leave:    { color: 'bg-teal-100 text-teal-800 border-teal-300',    icon: CheckCircle,    label: 'Present (On Leave)' },
  // A record whose session never got a closing punch (still is_in_progress)
  // on TODAY — a past day's stale flag is already re-mapped by effectiveStatus.
  in_progress:      { color: 'bg-amber-100 text-amber-800 border-amber-300', icon: Activity,       label: 'In Progress' },
};

/**
 * Resolve what a single calendar day should read as, using the same rules the
 * "My Attendance" calendar applies: a real Attendance record wins (via
 * effectiveStatus, so a stale in_progress on a past day still resolves to
 * present/absent); otherwise a past/today weekday with no record is 'absent',
 * a Sunday is 'week_off', a declared Holiday is 'holiday', and anything before
 * the employee joined — or any future day — stays null (no styling).
 *
 * @param {Date} day
 * @param {object|null} attendance  the Attendance record for that day, if any
 * @param {{ holidayDates?: string[], dateOfJoining?: string|null, today?: Date }} opts
 * @returns {string|null} a key into DAY_STATUS_CONFIG, or null for "nothing to show"
 */
export function deriveDayStatus(day, attendance, { holidayDates = [], dateOfJoining = null, today = new Date() } = {}) {
  let status = attendance ? effectiveStatus(attendance) : null;

  const isPast = !isAfter(day, today) && !isSameDay(day, today);
  const isTodayDay = isSameDay(day, today);
  const isSunday = day.getDay() === 0;
  const isHoliday = holidayDates.some(hd => isSameDay(new Date(hd), day));
  const dayStr = format(day, 'yyyy-MM-dd');
  const isPreJoining = !status && dateOfJoining && dayStr < dateOfJoining;

  if (!status && (isPast || isTodayDay) && !isSunday && !isHoliday && !isPreJoining) status = 'absent';
  else if (!status && isSunday) status = 'week_off';
  else if (!status && isHoliday) status = 'holiday';

  // "Present but on approved leave" — the same override AttendanceCalendar shows.
  if (status === 'present' && attendance?.notes?.toLowerCase().includes('approved leave')) return 'present_leave';

  return status;
}
