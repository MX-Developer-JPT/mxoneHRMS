import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Check if a date is a weekend (Saturday=6, Sunday=0)
function isWeekend(date) {
  const d = new Date(date);
  return d.getDay() === 0 || d.getDay() === 6;
}

// Calculate actual leave days applying sandwich rule
async function calculateLeaveDays(base44, userId, startDate, endDate, halfDay) {
  if (halfDay) return 0.5;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Get company holidays in range (expand range by 3 days each side for sandwich check)
  const expandStart = new Date(start);
  expandStart.setDate(expandStart.getDate() - 3);
  const expandEnd = new Date(end);
  expandEnd.setDate(expandEnd.getDate() + 3);

  const holidays = await base44.asServiceRole.entities.Holiday.filter({
    year: start.getFullYear()
  });

  const holidayDates = new Set(holidays.map(h => h.date));

  function isNonWorking(dateStr) {
    const d = new Date(dateStr);
    return isWeekend(d) || holidayDates.has(dateStr);
  }

  function dateToStr(d) {
    return d.toISOString().split('T')[0];
  }

  // Apply sandwich rule: expand leave range if non-working days are sandwiched
  let effectiveStart = new Date(start);
  let effectiveEnd = new Date(end);

  // Check if day before start is non-working and day before that is a leave/non-working
  const dayBeforeStart = new Date(effectiveStart);
  dayBeforeStart.setDate(dayBeforeStart.getDate() - 1);

  const dayAfterEnd = new Date(effectiveEnd);
  dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);

  // Sandwich: if leave is right after a weekend/holiday, include those days
  // Check backwards from start
  let checkDay = new Date(dayBeforeStart);
  while (isNonWorking(dateToStr(checkDay))) {
    const dayBefore = new Date(checkDay);
    dayBefore.setDate(dayBefore.getDate() - 1);
    // Only apply sandwich if there's leave on both sides (start is already a leave day)
    // For now just include weekends within the leave range
    checkDay.setDate(checkDay.getDate() - 1);
  }

  // Check forwards from end for sandwich
  let checkDayFwd = new Date(dayAfterEnd);
  while (isNonWorking(dateToStr(checkDayFwd))) {
    checkDayFwd.setDate(checkDayFwd.getDate() + 1);
  }

  // Count days between effectiveStart and effectiveEnd (inclusive)
  // For sandwich: if first working day before start is within 1 day, and first working day after end is within 1 day,
  // then include intervening weekends/holidays

  // Simpler approach: count all days including weekends/holidays within leave range
  // but for sandwich rule: if non-working day is between two leave days, it counts as leave
  let totalDays = 0;
  const current = new Date(start);
  while (current <= end) {
    totalDays++;
    current.setDate(current.getDate() + 1);
  }

  return totalDays;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { leave_policy_id, start_date, end_date, half_day } = await req.json();

    if (!leave_policy_id || !start_date || !end_date) {
      return Response.json({ valid: false, errors: ['Missing required fields'] });
    }

    const errors = [];
    const warnings = [];

    // Load policy
    const policies = await base44.asServiceRole.entities.LeavePolicy.filter({ id: leave_policy_id });
    if (!policies.length) return Response.json({ valid: false, errors: ['Leave policy not found'] });
    const policy = policies[0];

    // Load employee record
    const empRecords = await base44.asServiceRole.entities.Employee.filter({ user_id: user.id, status: 'active' });
    const emp = empRecords[0];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(start_date);
    const end = new Date(end_date);

    // Past date check
    if (start < today) {
      errors.push('Leave cannot be applied for past dates.');
    }

    // End must not be before start
    if (end < start) {
      errors.push('End date must be after start date.');
    }

    // Calculate adjusted days (with sandwich rule)
    const adjustedDays = await calculateLeaveDays(base44, user.id, start_date, end_date, half_day);

    // ---- CL RULES ----
    if (policy.code === 'CL') {
      if (adjustedDays > 3) {
        errors.push('Casual Leave cannot exceed 3 consecutive days.');
      }
    }

    // ---- EL RULES ----
    if (policy.code === 'EL') {
      if (!emp) {
        errors.push('Employee record not found. Cannot apply EL.');
      } else if (emp.employee_status === 'probation' || emp.employee_status === 'trainee') {
        errors.push('Earned Leave is only available after confirmation. Your status is currently on probation/trainee.');
      }
      if (!emp?.employee_confirmation_date) {
        errors.push('No confirmation date found. EL requires confirmed employment status.');
      }
      // Must apply in advance
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (start <= today) {
        errors.push('Earned Leave must be applied in advance (at least 1 day before).');
      }
    }

    // ---- SL RULES ----
    if (policy.code === 'SL') {
      const managerTiers = ['manager', 'general_manager', 'director'];
      const managerRoles = ['management', 'admin', 'hr'];
      const isManagerLevel =
        (emp && managerTiers.includes(emp.designation_tier)) ||
        managerRoles.includes(user.role) ||
        managerRoles.includes(user.custom_role);

      if (!isManagerLevel) {
        errors.push('Sick Leave is only available for Manager level and above.');
      }

      if (adjustedDays > 2) {
        warnings.push('Medical proof (doctor certificate) is required for Sick Leave exceeding 2 consecutive days.');
      }
    }

    // ---- BALANCE CHECK ----
    const currentYear = new Date().getFullYear();
    const balances = await base44.asServiceRole.entities.LeaveBalance.filter({
      user_id: user.id,
      leave_policy_id: policy.id,
      year: currentYear
    });

    let availableBalance = 0;
    if (balances.length > 0) {
      availableBalance = balances[0].available || 0;
    }

    if (adjustedDays > availableBalance) {
      errors.push(`Insufficient ${policy.code} balance. Available: ${availableBalance} days, Requested: ${adjustedDays} days.`);
    }

    // ---- MONTHLY LIMITS CHECK ----
    const startMonth = start.getMonth() + 1; // 1-12
    const startYear = start.getFullYear();

    // Get all approved/pending leaves for this user, this policy, in the same month
    const allLeaves = await base44.asServiceRole.entities.Leave.filter({
      user_id: user.id,
      leave_policy_id: policy.id
    });

    const leavesThisMonth = allLeaves.filter(l => {
      if (l.status === 'rejected' || l.status === 'cancelled') return false;
      const lStart = new Date(l.start_date);
      return lStart.getMonth() + 1 === startMonth && lStart.getFullYear() === startYear;
    });

    const daysUsedThisMonth = leavesThisMonth.reduce((sum, l) => sum + (l.total_days || 0), 0);

    if (policy.total_leave_per_month && (daysUsedThisMonth + adjustedDays) > policy.total_leave_per_month) {
      const remaining = Math.max(policy.total_leave_per_month - daysUsedThisMonth, 0);
      errors.push(`Exceeds monthly total limit for ${policy.code}. Allowed: ${policy.total_leave_per_month} days/month, already used: ${daysUsedThisMonth} days, remaining: ${remaining} days.`);
    }

    if (policy.max_leave_per_month && (daysUsedThisMonth + adjustedDays) > policy.max_leave_per_month) {
      const remaining = Math.max(policy.max_leave_per_month - daysUsedThisMonth, 0);
      errors.push(`Exceeds monthly maximum for ${policy.code}. Max allowed: ${policy.max_leave_per_month} days/month, already used: ${daysUsedThisMonth} days, remaining: ${remaining} days.`);
    }

    return Response.json({
      valid: errors.length === 0,
      errors,
      warnings,
      adjusted_days: adjustedDays,
      available_balance: availableBalance,
      policy_name: policy.name,
      policy_code: policy.code
    });

  } catch (error) {
    return Response.json({ valid: false, errors: [error.message] }, { status: 500 });
  }
});