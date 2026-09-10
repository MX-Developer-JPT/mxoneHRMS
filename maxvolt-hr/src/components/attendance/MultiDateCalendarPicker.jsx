import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import { deriveDayStatus, DAY_STATUS_CONFIG } from '@/lib/attendanceDayStatus';

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function MultiDateCalendarPicker({
  selectedDates = [],
  onChange,
  maxDate,
  // Optional: when supplied, each day cell is tinted with the employee's
  // actual attendance status for that day — same colours as the
  // "My Attendance" calendar — so they can see at a glance which days were
  // absent / had a missed punch and actually need regularising.
  attendanceData = null,
  holidays = [],
  dateOfJoining = null,
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const max = maxDate ? new Date(maxDate) : new Date();
  const firstDay = startOfMonth(currentMonth);
  const lastDay = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: firstDay, end: lastDay });
  const startPad = getDay(firstDay);

  const showStatus = Array.isArray(attendanceData);
  const holidayDates = useMemo(() => holidays.map(h => h.date), [holidays]);
  const attByDate = useMemo(() => {
    const m = {};
    (attendanceData || []).forEach(a => { if (a?.date) m[String(a.date).slice(0, 10)] = a; });
    return m;
  }, [attendanceData]);
  const today = new Date();

  // Which statuses actually appear this month — keeps the legend honest.
  const legendStatuses = useMemo(() => {
    if (!showStatus) return [];
    const seen = new Set();
    days.forEach(day => {
      if (day > max) return;
      const st = deriveDayStatus(day, attByDate[format(day, 'yyyy-MM-dd')], { holidayDates, dateOfJoining, today });
      if (st && DAY_STATUS_CONFIG[st]) seen.add(st);
    });
    return [...seen];
  }, [showStatus, days, max, attByDate, holidayDates, dateOfJoining]);

  const toggleDate = (day) => {
    if (day > max) return;
    const dateStr = format(day, 'yyyy-MM-dd');
    const alreadySelected = selectedDates.includes(dateStr);
    if (alreadySelected) {
      onChange(selectedDates.filter(d => d !== dateStr));
    } else {
      onChange([...selectedDates, dateStr].sort());
    }
  };

  const removeDate = (dateStr) => {
    onChange(selectedDates.filter(d => d !== dateStr));
  };

  return (
    <div className="space-y-3">
      {/* Calendar */}
      <div className="border rounded-lg p-3 bg-white">
        <div className="flex items-center justify-between mb-2">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold">{format(currentMonth, 'MMMM yyyy')}</span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const isSelected = selectedDates.includes(dateStr);
            const isDisabled = day > max;
            const isWeekend = getDay(day) === 0 || getDay(day) === 6;
            const dayStatus = showStatus && !isDisabled
              ? deriveDayStatus(day, attByDate[dateStr], { holidayDates, dateOfJoining, today })
              : null;
            const statusCfg = dayStatus ? DAY_STATUS_CONFIG[dayStatus] : null;
            const StatusIcon = statusCfg?.icon;
            const att = attByDate[dateStr];
            return (
              <button
                type="button"
                key={dateStr}
                disabled={isDisabled}
                onClick={() => toggleDate(day)}
                title={statusCfg ? `${format(day, 'MMM d')} — ${statusCfg.label}${att?.working_hours > 0 ? ` · ${att.working_hours.toFixed(1)}h` : ''}${att?.regularised ? ' · Regularised' : ''}` : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-xs py-1.5 rounded border transition-colors min-h-[38px]
                  ${isSelected ? 'bg-blue-600 text-white font-semibold border-blue-600 ring-2 ring-blue-300' : ''}
                  ${!isSelected && statusCfg ? statusCfg.color : ''}
                  ${!isSelected && !statusCfg ? 'border-transparent' : ''}
                  ${!isSelected && !isDisabled && !statusCfg ? 'hover:bg-blue-50' : ''}
                  ${!isSelected && statusCfg ? 'hover:brightness-95' : ''}
                  ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                  ${!isSelected && !statusCfg && isWeekend ? 'text-gray-400' : ''}
                `}
              >
                <span className="leading-none font-medium">{day.getDate()}</span>
                {!isSelected && StatusIcon && <StatusIcon className="w-3 h-3" />}
                {att?.regularised && !isSelected && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-violet-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend — only the statuses that actually occur this month */}
        {legendStatuses.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 mt-2 border-t text-[11px] text-gray-500">
            {legendStatuses.map(st => (
              <span key={st} className="flex items-center gap-1">
                <span className={`w-2.5 h-2.5 rounded border ${DAY_STATUS_CONFIG[st].color}`} />
                {DAY_STATUS_CONFIG[st].label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Selected dates chips */}
      {selectedDates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedDates.map(d => (
            <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
              {safeDate(d + 'T00:00:00', 'MMM d')}
              <button type="button" onClick={() => removeDate(d)} className="hover:text-red-600">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange([])} className="text-xs text-gray-400 hover:text-red-500 underline">
            Clear all
          </button>
        </div>
      )}
      {selectedDates.length === 0 && (
        <p className="text-xs text-gray-400">Click on dates to select them</p>
      )}
    </div>
  );
}
