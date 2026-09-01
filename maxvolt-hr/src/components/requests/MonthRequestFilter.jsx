import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, List, Grid } from 'lucide-react';
import { format, addMonths, subMonths, isSameMonth } from 'date-fns';

// Shared "current month by default, browse previous months, list/calendar
// toggle" filter bar used across the employee-facing request pages
// (Leave, Regularisation, Gate Pass, Reimbursements) and the Approvals
// queue — kept as one component so all of them behave identically.
export default function MonthRequestFilter({ monthDate, onMonthChange, viewMode, onViewModeChange }) {
  const isCurrentMonth = isSameMonth(monthDate, new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(subMonths(monthDate, 1))}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-sm font-medium min-w-[110px] text-center">{format(monthDate, 'MMMM yyyy')}</span>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(addMonths(monthDate, 1))} disabled={isCurrentMonth}>
        <ChevronRight className="w-4 h-4" />
      </Button>
      {!isCurrentMonth && (
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onMonthChange(new Date())}>
          This Month
        </Button>
      )}
      {onViewModeChange && (
        <div className="flex border rounded-md overflow-hidden ml-auto">
          <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" className="rounded-none h-8" onClick={() => onViewModeChange('list')}>
            <List className="w-3.5 h-3.5" />
          </Button>
          <Button variant={viewMode === 'calendar' ? 'default' : 'ghost'} size="sm" className="rounded-none h-8" onClick={() => onViewModeChange('calendar')}>
            <Grid className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
