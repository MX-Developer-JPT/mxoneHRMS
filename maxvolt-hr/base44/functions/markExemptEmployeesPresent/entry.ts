import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * markExemptEmployeesPresent
 * Marks all attendance-exempt employees as present for all working days 
 * in a given month/year (defaults to current month).
 * Called by HR or automated scheduling.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const month = body.month || (now.getMonth() + 1);
    const year = body.year || now.getFullYear();

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // Fetch exempt employees
    const exemptEmps = await base44.asServiceRole.entities.Employee.filter({
      is_attendance_exempt: true,
      status: 'active'
    });

    if (exemptEmps.length === 0) {
      return Response.json({ success: true, message: 'No exempt employees found', marked: 0 });
    }

    // Fetch holidays for this month
    const holidays = await base44.asServiceRole.entities.Holiday.filter({ year });
    const holidayDates = new Set(holidays.map(h => h.date?.split('T')[0]));

    let markedCount = 0;

    for (const emp of exemptEmps) {
      // Get shift for this employee to determine weekly off days
      const shifts = emp.shift_id
        ? await base44.asServiceRole.entities.Shift.filter({ id: emp.shift_id })
        : await base44.asServiceRole.entities.Shift.filter({ is_default: true });
      const weeklyOff = shifts[0]?.weekly_off_days || [0]; // default Sunday off

      // Get existing attendance for this employee this month
      const existingAtt = await base44.asServiceRole.entities.Attendance.filter({
        user_id: emp.user_id
      });
      const existingDates = new Set(existingAtt.map(a => a.date?.split('T')[0]));

      // Iterate each day in the month
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayOfWeek = d.getDay();
        const isWeekOff = weeklyOff.includes(dayOfWeek);
        const isHoliday = holidayDates.has(dateStr);

        // Skip weekends and holidays
        if (isWeekOff || isHoliday) continue;

        if (!existingDates.has(dateStr)) {
          // Create present record
          await base44.asServiceRole.entities.Attendance.create({
            user_id: emp.user_id,
            date: dateStr,
            status: 'present',
            lop_applicable: false,
            lop_deduction_days: 0,
            auto_marked: true,
            notes: 'Auto-marked: Attendance exempt employee'
          });
          markedCount++;
        }
      }
    }

    return Response.json({
      success: true,
      message: `Marked ${markedCount} attendance records for ${exemptEmps.length} exempt employees`,
      marked: markedCount,
      employees: exemptEmps.length
    });
  } catch (error) {
    console.error('markExemptEmployeesPresent error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});