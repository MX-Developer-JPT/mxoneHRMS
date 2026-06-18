import React from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, Coffee } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isAfter, addMonths, subMonths } from 'date-fns';

const statusConfig = {
  present: { color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle },
  absent: { color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle },
  half_day: { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock },
  leave: { color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Coffee },
  holiday: { color: 'bg-purple-100 text-purple-800 border-purple-200', icon: Coffee },
  week_off: { color: 'bg-gray-100 text-gray-800 border-gray-200', icon: Coffee },
  present_leave: { color: 'bg-teal-100 text-teal-800 border-teal-300', icon: CheckCircle }
};

export default function AttendanceCalendar({ attendanceData, holidays = [], currentMonth, onMonthChange, onDayClick }) {

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
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{format(currentMonth, 'MMMM yyyy')}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => onMonthChange(subMonths(currentMonth, 1))}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <Button variant="outline" onClick={() => onMonthChange(new Date())}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => onMonthChange(addMonths(currentMonth, 1))}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-semibold text-sm text-gray-600 py-2">
              {day}
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

            // Mark as absent if past, no record, not sunday, not holiday
            if (!status && (isPast || isTodayDay) && !isWeekend && !isHol) {
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
                  p-3 rounded-lg border-2 transition-all hover:shadow-md
                  ${config ? config.color : 'bg-white border-gray-200 hover:bg-gray-50'}
                `}
              >
                <div className="text-sm font-semibold">{format(day, 'd')}</div>
                {Icon && <Icon className="w-4 h-4 mx-auto mt-1" />}
                {isApprovedLeaveDay && <div className="text-xs mt-0.5 font-bold text-teal-700">L</div>}
                {attendance?.working_hours > 0 && !isApprovedLeaveDay && (
                  <div className="text-xs mt-1 font-medium">{attendance.working_hours.toFixed(1)}h</div>
                )}
                {attendance?.punch_sessions?.length > 1 && (
                  <div className="text-xs text-gray-500">{attendance.punch_sessions.length}s</div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 pt-4 border-t">
          {Object.entries(statusConfig).map(([status, config]) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded border-2 ${config.color}`} />
              <span className="text-sm capitalize">{status === 'present_leave' ? 'Present (On Leave)' : status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}