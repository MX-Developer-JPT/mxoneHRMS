import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay } from 'date-fns';

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function MultiDateCalendarPicker({ selectedDates = [], onChange, maxDate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const max = maxDate ? new Date(maxDate) : new Date();
  const firstDay = startOfMonth(currentMonth);
  const lastDay = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: firstDay, end: lastDay });
  const startPad = getDay(firstDay);

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
            return (
              <button
                type="button"
                key={dateStr}
                disabled={isDisabled}
                onClick={() => toggleDate(day)}
                className={`text-center text-xs py-1.5 rounded transition-colors
                  ${isSelected ? 'bg-blue-600 text-white font-semibold' : ''}
                  ${!isSelected && !isDisabled ? 'hover:bg-blue-50' : ''}
                  ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                  ${!isSelected && isWeekend ? 'text-gray-400' : ''}
                `}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected dates chips */}
      {selectedDates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedDates.map(d => (
            <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
              {format(new Date(d + 'T00:00:00'), 'MMM d')}
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