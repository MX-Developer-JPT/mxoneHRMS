import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Generic month-grid calendar for a list of request-like records — plots a
// colored dot per day that has one or more records, click to see them.
// Shared by Leave/Regularisation/GatePass/Reimbursements and Approvals so
// each request type doesn't need its own bespoke calendar.
export default function RequestMiniCalendar({ monthDate, items, getDate, getColor, onDayClick }) {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);
  const today = new Date();

  const itemsForDay = (day) => items.filter(it => {
    const d = getDate(it);
    return d && isSameDay(new Date(d), day);
  });

  return (
    <Card>
      <CardContent className="p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map(d => <div key={d} className="text-center text-xs font-medium text-gray-500">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map(day => {
            const dayItems = itemsForDay(day);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                onClick={() => dayItems.length > 0 && onDayClick(dayItems)}
                className={`relative text-center text-xs p-1 rounded min-h-[40px] flex flex-col items-center justify-start
                  ${dayItems.length > 0 ? 'bg-blue-50 border border-blue-200 cursor-pointer hover:bg-blue-100' : 'border border-transparent'}
                  ${isToday ? 'ring-1 ring-blue-500' : ''}`}
              >
                <span className="font-medium">{day.getDate()}</span>
                <div className="flex gap-0.5 flex-wrap justify-center mt-0.5">
                  {dayItems.slice(0, 4).map((it, i) => (
                    <div key={i} className={`w-1.5 h-1.5 rounded-full ${getColor(it)}`} />
                  ))}
                  {dayItems.length > 4 && <span className="text-[9px] text-gray-400">+{dayItems.length - 4}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
