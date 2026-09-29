import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { scheduledOffStatus } from '@/lib/attendanceSource';
import { safeTime } from '@/lib/dateUtils';

// Single source of truth for "what status does this record actually
// display" — trusts an explicit backend status (including a deliberate
// 'absent' auto-close) over the check_in_time fallback, which only kicks in
// for a stale/missing status. Shared so every calendar (HR's org-wide view,
// an employee's own, a manager's own) agrees on the same day's status.
export function getDisplayStatus(record) {
  const s = record.status;
  if (s && s !== 'in_progress') return s;
  if (record.check_in_time) return 'present';
  return s || 'absent';
}

export const EMP_STATUS_CAL_COLORS = {
  present: 'bg-green-100 border-green-300 text-green-800',
  late: 'bg-green-100 border-green-300 text-green-800',
  on_duty: 'bg-teal-100 border-teal-300 text-teal-800',
  work_from_home: 'bg-cyan-100 border-cyan-300 text-cyan-800',
  half_day: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  short_attendance: 'bg-orange-100 border-orange-300 text-orange-800',
  leave: 'bg-blue-100 border-blue-300 text-blue-800',
  holiday: 'bg-purple-100 border-purple-300 text-purple-800',
  week_off: 'bg-gray-100 border-gray-200 text-gray-500',
  absent: 'bg-red-100 border-red-300 text-red-700',
};

const STATUS_LABEL = { present: 'P', late: 'P', absent: 'A', half_day: 'HD', leave: 'L', holiday: 'H', week_off: 'W', on_duty: 'OD', work_from_home: 'WFH', short_attendance: 'SA' };

// The exact compact month-grid + legend + stats view HR/management/a
// reporting manager see for any one employee on All Attendance — extracted
// here so an employee's own "My Attendance" page and a manager's own
// attendance can show the identical view for themselves, instead of a
// visually different one.
export default function EmployeeAttendanceCalendar({ emp, year, month, records, loading, onNavigate, onDayClick, holidaySet, shiftMap, defaultShift }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);
  const recMap = {};
  (records || []).forEach(r => { recMap[String(r.date).slice(0, 10)] = r; });

  const weeks = [];
  let week = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }

  const dayInfo = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = recMap[ds];
    const isFuture = ds > today;
    let status = rec ? getDisplayStatus(rec) : null;
    let inferred = false;
    if (!rec && !isFuture && emp) {
      const off = scheduledOffStatus(emp, ds, holidaySet, shiftMap, defaultShift);
      status = off || 'absent';
      inferred = true;
    }
    const isLate = !!rec && (rec.status === 'late' || rec.late_arrival || (rec.late_minutes > 0) || (rec.late_arrival_minutes > 0));
    const isEarlyOut = !!rec && (rec.early_departure || (rec.early_departure_minutes > 0));
    dayInfo[ds] = { rec, status, inferred, isFuture, isLate, isEarlyOut };
  }

  const summary = { present: 0, absent: 0, leave: 0, halfDay: 0, wfh: 0, ot: 0, late: 0, earlyOut: 0, holiday: 0, weekOff: 0 };
  Object.values(dayInfo).forEach(({ rec, status: s, isFuture, isLate, isEarlyOut }) => {
    if (isFuture) return;
    if (s === 'absent') summary.absent++;
    else if (s === 'leave') summary.leave++;
    else if (s === 'half_day') summary.halfDay++;
    else if (s === 'holiday') summary.holiday++;
    else if (s === 'week_off') summary.weekOff++;
    else if (['present', 'late', 'on_duty', 'short_attendance', 'work_from_home'].includes(s) || rec?.check_in_time) summary.present++;
    if (s === 'work_from_home') summary.wfh++;
    if (rec && (rec.overtime_minutes || 0) > 0) summary.ot++;
    if (isLate) summary.late++;
    if (isEarlyOut) summary.earlyOut++;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => onNavigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <span className="font-semibold text-gray-800 text-sm">{monthLabel}</span>
        <button onClick={() => onNavigate(1)} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className={`text-center text-[10px] font-bold py-1 ${i === 0 ? 'text-red-400' : 'text-gray-400'}`}>{d}</div>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((wk, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-0.5">
                {wk.map((d, di) => {
                  if (!d) return <div key={di} />;
                  const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const { rec, status, inferred, isFuture, isLate, isEarlyOut } = dayInfo[ds];
                  const colorClass = status ? (EMP_STATUS_CAL_COLORS[status] || 'bg-gray-50 border-gray-200 text-gray-500') : 'bg-white border-gray-100 text-gray-400';
                  const isToday = ds === today;
                  const checkIn = rec?.check_in_time;
                  const checkOut = rec?.check_out_time;
                  const hours = rec?.working_hours;
                  return (
                    <div
                      key={di}
                      className={`relative border rounded text-center py-1 px-0.5 text-[10px] font-medium leading-tight ${isFuture ? 'bg-gray-50 border-gray-100 text-gray-300' : colorClass} ${isToday ? 'ring-1 ring-blue-500' : ''} ${(isLate || isEarlyOut) ? 'ring-1 ring-amber-400' : ''} ${rec && onDayClick ? 'cursor-pointer hover:ring-1 hover:ring-blue-400' : ''}`}
                      title={rec ? `${status?.replace(/_/g, ' ')}${rec.regularised ? ' (Regularised)' : ''}${isLate ? ' · Late arrival' : ''}${isEarlyOut ? ' · Early departure' : ''}${checkIn ? ` · In: ${safeTime(checkIn)}` : ''}${checkOut ? ` · Out: ${safeTime(checkOut)}` : ''}${hours ? ` · ${hours.toFixed(1)}h` : ''}${onDayClick ? ' — click for full details' : ''}` : (isFuture ? '' : `${status?.replace(/_/g, ' ') || 'Absent'}${inferred && status === 'absent' ? ' — no attendance record' : ''}`)}
                      onClick={() => rec && onDayClick?.(rec)}
                    >
                      {rec?.regularised && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-violet-500" />}
                      {isLate && <span className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" title="Late arrival" />}
                      {isEarlyOut && <span className="absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" title="Early departure" />}
                      <div className={`font-bold text-[11px] ${isToday ? 'text-blue-600' : di === 0 ? 'text-red-400' : ''}`}>{d}</div>
                      <div>{status ? (STATUS_LABEL[status] || status.slice(0, 2).toUpperCase()) : (isFuture ? '' : '—')}</div>
                      {hours > 0 && <div className="text-[9px] opacity-70">{hours.toFixed(1)}h</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
            {[['P', 'bg-green-100 text-green-700', 'Present'], ['A', 'bg-red-100 text-red-700', 'Absent'], ['L', 'bg-blue-100 text-blue-700', 'Leave'], ['HD', 'bg-yellow-100 text-yellow-700', 'Half Day'], ['WFH', 'bg-cyan-100 text-cyan-700', 'WFH'], ['OD', 'bg-teal-100 text-teal-700', 'On Duty'], ['H', 'bg-purple-100 text-purple-700', 'Holiday'], ['W', 'bg-gray-100 text-gray-500', 'Week Off']].map(([code, cls, label]) => (
              <span key={code} className={`px-1.5 py-0.5 rounded border ${cls}`}>{code} {label}</span>
            ))}
            <span className="px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Regularised
            </span>
            <span className="px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Late Arrival
            </span>
            <span className="px-1.5 py-0.5 rounded border bg-orange-50 text-orange-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Early Departure
            </span>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { label: 'Present', value: summary.present, cls: 'text-green-700 bg-green-50' },
              { label: 'Absent', value: summary.absent, cls: 'text-red-700 bg-red-50' },
              { label: 'Leave', value: summary.leave, cls: 'text-blue-700 bg-blue-50' },
              { label: 'Half Day', value: summary.halfDay, cls: 'text-yellow-700 bg-yellow-50' },
              { label: 'WFH', value: summary.wfh, cls: 'text-cyan-700 bg-cyan-50' },
              { label: 'Late Arrival', value: summary.late, cls: 'text-amber-700 bg-amber-50' },
              { label: 'Early Departure', value: summary.earlyOut, cls: 'text-orange-700 bg-orange-50' },
              { label: 'Holiday', value: summary.holiday, cls: 'text-purple-700 bg-purple-50' },
              { label: 'Week Off', value: summary.weekOff, cls: 'text-gray-700 bg-gray-50' },
              { label: 'OT Days', value: summary.ot, cls: 'text-purple-700 bg-purple-50' },
            ].map(({ label, value, cls }) => (
              <div key={label} className={`rounded-lg p-2 text-center ${cls}`}>
                <p className="text-sm font-bold">{value}</p>
                <p className="text-[10px] opacity-80">{label}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
