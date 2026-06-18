import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * calculateLOP - Calculates Loss of Pay for a single employee for a given month/year
 * Input: { user_id, month, year }
 * Output: { lop_days, lop_amount, lop_breakdown, lop_detail }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { user_id, month, year } = await req.json();
    if (!user_id || !month || !year) {
      return Response.json({ error: 'user_id, month, year are required' }, { status: 400 });
    }

    const result = await computeLOP(base44, user_id, month, year);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('calculateLOP error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

export async function computeLOP(base44, user_id, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const totalCalendarDays = endDate.getDate();

  // Fetch config (active config)
  const configs = await base44.asServiceRole.entities.PayrollConfiguration.filter({ is_active: true });
  const config = configs[0] || {
    lop_calculation_basis: 'working_days',
    lop_impacted_components: ['basic_salary', 'hra'],
    lop_fixed_components_only: true,
    lop_half_day_enabled: true,
    lop_partial_day_threshold_late_marks: 3,
    lop_partial_day_threshold_early_exit: 3,
    lop_roles_exempt: [],
    lop_designations_exempt: []
  };

  // Fetch employee
  const empList = await base44.asServiceRole.entities.Employee.filter({ user_id, status: 'active' });
  const emp = empList[0];
  if (!emp) return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, lop_detail: { reason: 'Employee not found or inactive' } };

  // Attendance exemption check — exempt employees have no LOP
  if (emp.is_attendance_exempt) {
    return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, lop_detail: { reason: 'Employee is attendance exempt' } };
  }

  // Role/designation exemption check
  const empUser = (await base44.asServiceRole.entities.User.filter({ id: user_id }))[0];
  const empRole = empUser?.role || empUser?.custom_role || '';
  if ((config.lop_roles_exempt || []).includes(empRole)) {
    return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, lop_detail: { reason: 'Role exempt from LOP' } };
  }
  if ((config.lop_designations_exempt || []).includes(emp.designation)) {
    return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, lop_detail: { reason: 'Designation exempt from LOP' } };
  }

  // Fetch salary structure
  const salaryStructures = await base44.asServiceRole.entities.SalaryStructure.filter({ user_id, status: 'active' });
  const salary = salaryStructures[0];
  if (!salary) return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, lop_detail: { reason: 'No active salary structure' } };

  // Fetch attendance for the month
  const allAttendance = await base44.asServiceRole.entities.Attendance.list('-date', 10000);
  const empAttendance = allAttendance.filter(a => {
    if (a.user_id !== user_id) return false;
    const d = new Date(a.date);
    return d >= startDate && d <= endDate;
  });

  // Fetch approved leaves overlapping this month
  const allLeaves = await base44.asServiceRole.entities.Leave.filter({ user_id, status: 'approved' });
  const monthLeaves = allLeaves.filter(l => {
    const ls = new Date(l.start_date), le = new Date(l.end_date);
    return ls <= endDate && le >= startDate;
  });

  // Build set of paid leave dates
  const paidLeaveDates = new Set();
  let paidLeaveDays = 0;
  for (const leave of monthLeaves) {
    const ls = new Date(Math.max(new Date(leave.start_date), startDate));
    const le = new Date(Math.min(new Date(leave.end_date), endDate));
    for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (!paidLeaveDates.has(dateStr)) {
        paidLeaveDates.add(dateStr);
        paidLeaveDays += leave.half_day ? 0.5 : 1;
      }
    }
  }

  // Fetch shifts for working days calculation
  const shiftList = emp.shift_id
    ? await base44.asServiceRole.entities.Shift.filter({ id: emp.shift_id })
    : await base44.asServiceRole.entities.Shift.filter({ is_default: true });
  const shift = shiftList[0];
  const weeklyOff = shift?.weekly_off_days || [0]; // 0=Sunday by default

  // Fetch holidays for the month
  const holidays = await base44.asServiceRole.entities.Holiday.filter({ year });
  const holidayDates = new Set(holidays.map(h => h.date?.split('T')[0]));

  // Calculate total working days in month
  let totalWorkingDays = 0;
  const workingDaysList = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay();
    const isWeekoff = weeklyOff.includes(dayOfWeek);
    const isHoliday = holidayDates.has(dateStr);
    if (!isWeekoff && !isHoliday) {
      totalWorkingDays++;
      workingDaysList.push(dateStr);
    }
  }

  const denominatorDays = config.lop_calculation_basis === 'calendar_days' ? totalCalendarDays : totalWorkingDays;

  // Map attendance by date
  const attByDate = {};
  for (const a of empAttendance) {
    attByDate[a.date?.split('T')[0]] = a;
  }

  // Count late marks and early exits for partial day LOP
  let lateMarkCount = 0;
  let earlyExitCount = 0;
  let presentDays = 0;
  let halfDayCount = 0;
  let unapprovedAbsentDays = 0;
  let unapprovedAbsentDates = [];

  for (const dateStr of workingDaysList) {
    if (paidLeaveDates.has(dateStr)) continue; // Covered by paid leave

    const att = attByDate[dateStr];
    if (!att) {
      // No attendance record = absent without approval
      unapprovedAbsentDays++;
      unapprovedAbsentDates.push(dateStr);
    } else if (att.status === 'absent') {
      unapprovedAbsentDays++;
      unapprovedAbsentDates.push(dateStr);
    } else if (att.status === 'present') {
      presentDays++;
      if (att.late_arrival) lateMarkCount++;
      if (att.early_departure) earlyExitCount++;
    } else if (att.status === 'half_day') {
      halfDayCount++;
      presentDays += 0.5;
    } else if (['holiday', 'week_off', 'on_duty', 'leave'].includes(att.status)) {
      presentDays += 1;
    }
  }

  // LOP from unapproved absences
  let lopFromAbsences = unapprovedAbsentDays;

  // LOP from partial day (late marks)
  const lateThreshold = config.lop_partial_day_threshold_late_marks || 3;
  const earlyThreshold = config.lop_partial_day_threshold_early_exit || 3;
  let lopFromLateness = 0;
  if (config.lop_half_day_enabled) {
    lopFromLateness = Math.floor(lateMarkCount / lateThreshold) * 0.5;
    lopFromLateness += Math.floor(earlyExitCount / earlyThreshold) * 0.5;
  }

  const totalLopDays = Math.round((lopFromAbsences + lopFromLateness) * 4) / 4;

  if (totalLopDays === 0) {
    return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, lop_detail: { present_days: presentDays, paid_leave_days: paidLeaveDays, working_days: totalWorkingDays } };
  }

  // Calculate per-day salary for each impacted component
  const components = {
    basic_salary: salary.basic_salary || 0,
    hra: salary.hra || 0,
    conveyance: salary.conveyance || 0,
    medical: salary.medical || 0,
    special_allowance: salary.special_allowance || 0,
    lta: salary.lta || 0
  };

  const impacted = config.lop_impacted_components || ['basic_salary', 'hra'];
  const lopBreakdown = {};
  let totalLopAmount = 0;

  for (const comp of impacted) {
    const monthlyAmt = components[comp] || 0;
    const perDay = monthlyAmt / denominatorDays;
    const deduction = Math.round(perDay * totalLopDays * 100) / 100;
    if (deduction > 0) {
      lopBreakdown[comp] = deduction;
      totalLopAmount += deduction;
    }
  }

  return {
    lop_days: totalLopDays,
    lop_amount: Math.round(totalLopAmount * 100) / 100,
    lop_breakdown: lopBreakdown,
    lop_detail: {
      present_days: presentDays,
      paid_leave_days: paidLeaveDays,
      working_days: totalWorkingDays,
      denominator_days: denominatorDays,
      unapproved_absent_days: unapprovedAbsentDays,
      unapproved_absent_dates: unapprovedAbsentDates,
      late_mark_count: lateMarkCount,
      early_exit_count: earlyExitCount,
      lop_from_absences: lopFromAbsences,
      lop_from_lateness: lopFromLateness,
      calculation_basis: config.lop_calculation_basis
    }
  };
}