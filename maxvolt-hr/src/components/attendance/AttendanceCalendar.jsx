import React from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, Coffee, Briefcase, Home } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isAfter, addMonths, subMonths } from 'date-fns';

const statusConfig = {
  present: { color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle },
  on_duty: { color: 'bg-teal-100 text-teal-800 border-teal-300', icon: Briefcase },
  work_from_home: { color: 'bg-cyan-100 text-cyan-800 border-cyan-300', icon: Home },
  absent: { color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle },
  half_day: { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock },
  leave: { color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Coffee },
  holiday: { color: 'bg-purple-100 text-purple-800 border-purple-200', icon: Coffee },
  week_off: { color: 'bg-gray-100 text-gray-800 border-gray-200', icon: Coffee },
  present_leave: { color: 'bg-teal-100 text-teal-800 border-teal-300', icon: CheckCircle }
};

export default function AttendanceCalendar({ attendanceData, holidays = [], currentMonth, onMonthChange, onDayClick, dateOfJoining }) {

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const today = new Date();
  const holidayDates = holidays.map(h => h.date);

  const isHoliday = (date) => holidayDates.some(hd => isSameDay(new Date(hd), date));
  const isSunday = (date) => date.getDay() === 0;

  const getAttendanceForDate = (date) => {
    return attendanceData.find(att => isSameDay(new Date(att.date), date));
  };

  const firstDayOfWeek = monthStart.getDay();

  return (
    <Card className="p-3 sm:p-6">
      <div className="space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg sm:text-2xl font-bold">{format(currentMonth, 'MMMM yyyy')}</h2>
          <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
            <Button variant="outline" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={() => onMonthChange(subMonths(currentMonth, 1))}>
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
            <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-4" onClick={() => onMonthChange(new Date())}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={() => onMonthChange(addMonths(currentMonth, 1))}>
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
          </div>
        </div>

        {/* Every cell in a CSS grid row stretches to match the tallest cell in
            that row — a day with an extra "Xh" line used to force every other
            cell in its row taller too, producing wildly uneven, pill-shaped
            rows on narrow mobile screens (7 columns leaves each cell very
            narrow, so any extra height reads as an elongated oval). Fixing
            each cell to a uniform aspect-square, single-line-of-content shape
            removes that row-to-row size variance entirely. */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-semibold text-[10px] sm:text-sm text-gray-600 py-1 sm:py-2">
              <span className="sm:hidden">{day.slice(0, 1)}</span>
              <span className="hidden sm:inline">{day}</span>
            </div>
          ))}

          {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
            <div key={`empty-${idx}`} />
          ))}

          {daysInMonth.map(day => {
            const attendance = getAttendanceForDate(day);
            const isPast = !isAfter(day, today) && !isSameDay(day, today);
            const isTodayDay = isSameDay(day, today);
            const isWeekend = isSunday(day);
            const isHol = isHoliday(day);

            let status = attendance?.status || null;
            // Detect approved leave day: present status with leave notes
            const isApprovedLeaveDay = status === 'present' && attendance?.notes?.toLowerCase().includes('approved leave');
            // A day before the employee's own joining date has no record for
            // a real reason — they weren't employed yet — never guessed absent.
            const isPreJoining = !status && dateOfJoining && format(day, 'yyyy-MM-dd') < dateOfJoining;

            // Mark as absent if past, no record, not sunday, not holiday, not pre-joining
            if (!status && (isPast || isTodayDay) && !isWeekend && !isHol && !isPreJoining) {
              status = 'absent';
            } else if (!status && isWeekend) {
              status = 'week_off';
            } else if (!status && isHol) {
              status = 'holiday';
            }

            const displayStatus = isApprovedLeaveDay ? 'present_leave' : status;
            const config = displayStatus ? statusConfig[displayStatus] : null;
            const Icon = config?.icon;

            return (
              <button
                key={day.toISOString()}
                onClick={() => onDayClick && attendance && onDayClick(day, attendance)}
                className={`
                  relative aspect-square w-full flex flex-col items-center justify-center gap-0
                  overflow-hidden p-0.5 sm:p-2 rounded-md sm:rounded-lg border-2 transition-all hover:shadow-md
                  ${config ? config.color : 'bg-white border-gray-200 hover:bg-gray-50'}
                  ${isTodayDay ? 'ring-2 ring-blue-500' : ''}
                `}
                title={attendance ? [
                  displayStatus?.replace(/_/g, ' '),
                  attendance.regularised && 'Regularised',
                  attendance.working_hours > 0 && `${attendance.working_hours.toFixed(1)}h`,
                ].filter(Boolean).join(' · ') : undefined}
              >
                {attendance?.regularised && (
                  <span
                    className="absolute top-0.5 right-0.5 w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-violet-500"
                  />
                )}
                <div className="text-[11px] sm:text-sm font-semibold leading-none">{format(day, 'd')}</div>
                {Icon && <Icon className="w-3 h-3 sm:w-4 sm:h-4 mt-0.5 sm:mt-1 flex-shrink-0" />}
                {isApprovedLeaveDay && <div className="text-[9px] sm:text-xs mt-0.5 font-bold text-teal-700 leading-none">L</div>}
                {attendance?.working_hours > 0 && !isApprovedLeaveDay && (
                  <div className="hidden sm:block text-xs mt-1 font-medium leading-none">{attendance.working_hours.toFixed(1)}h</div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-4 pt-3 sm:pt-4 border-t text-xs sm:text-sm">
          {Object.entries(statusConfig).map(([status, config]) => (
            <div key={status} className="flex items-center gap-1.5 sm:gap-2">
              <div className={`w-3 h-3 sm:w-4 sm:h-4 rounded border-2 ${config.color}`} />
              <span className="capitalize">{status === 'present_leave' ? 'Present (On Leave)' : status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}