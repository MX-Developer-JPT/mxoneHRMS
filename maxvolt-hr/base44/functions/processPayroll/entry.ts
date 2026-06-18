import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ─── LOP Calculation (inlined to avoid local imports) ───────────────────────────
async function computeLOP(base44, user_id, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const totalCalendarDays = endDate.getDate();

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

  const empList = await base44.asServiceRole.entities.Employee.filter({ user_id, status: 'active' });
  const emp = empList[0];
  if (!emp) return { lop_days: 0, lop_amount: 0, lop_breakdown: {} };

  const empUser = (await base44.asServiceRole.entities.User.filter({ id: user_id }))[0];
  const empRole = empUser?.role || empUser?.custom_role || '';
  if ((config.lop_roles_exempt || []).includes(empRole)) return { lop_days: 0, lop_amount: 0, lop_breakdown: {} };
  if ((config.lop_designations_exempt || []).includes(emp.designation)) return { lop_days: 0, lop_amount: 0, lop_breakdown: {} };

  const salaryStructures = await base44.asServiceRole.entities.SalaryStructure.filter({ user_id, status: 'active' });
  const salary = salaryStructures[0];
  if (!salary) return { lop_days: 0, lop_amount: 0, lop_breakdown: {} };

  const allAttendance = await base44.asServiceRole.entities.Attendance.list('-date', 10000);
  const empAttendance = allAttendance.filter(a => {
    if (a.user_id !== user_id) return false;
    const d = new Date(a.date);
    return d >= startDate && d <= endDate;
  });

  const allLeaves = await base44.asServiceRole.entities.Leave.filter({ user_id, status: 'approved' });
  const monthLeaves = allLeaves.filter(l => {
    const ls = new Date(l.start_date), le = new Date(l.end_date);
    return ls <= endDate && le >= startDate;
  });

  const paidLeaveDates = new Set();
  for (const leave of monthLeaves) {
    const ls = new Date(Math.max(new Date(leave.start_date), startDate));
    const le = new Date(Math.min(new Date(leave.end_date), endDate));
    for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
      paidLeaveDates.add(d.toISOString().split('T')[0]);
    }
  }

  const shiftList = emp.shift_id
    ? await base44.asServiceRole.entities.Shift.filter({ id: emp.shift_id })
    : await base44.asServiceRole.entities.Shift.filter({ is_default: true });
  const shift = shiftList[0];
  const weeklyOff = shift?.weekly_off_days || [0];

  const holidays = await base44.asServiceRole.entities.Holiday.filter({ year });
  const holidayDates = new Set(holidays.map(h => h.date?.split('T')[0]));

  let totalWorkingDays = 0;
  const workingDaysList = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay();
    if (!weeklyOff.includes(dayOfWeek) && !holidayDates.has(dateStr)) {
      totalWorkingDays++;
      workingDaysList.push(dateStr);
    }
  }

  const denominatorDays = config.lop_calculation_basis === 'calendar_days' ? totalCalendarDays : totalWorkingDays;

  const attByDate = {};
  for (const a of empAttendance) {
    attByDate[a.date?.split('T')[0]] = a;
  }

  let lateMarkCount = 0;
  let earlyExitCount = 0;
  let presentDays = 0;
  let paidLeaveDays = 0;
  let unapprovedAbsentDays = 0;

  for (const dateStr of workingDaysList) {
    if (paidLeaveDates.has(dateStr)) { paidLeaveDays++; continue; }
    const att = attByDate[dateStr];
    if (!att || att.status === 'absent') {
      unapprovedAbsentDays++;
    } else if (att.status === 'present') {
      presentDays++;
      if (att.late_arrival) lateMarkCount++;
      if (att.early_departure) earlyExitCount++;
    } else if (att.status === 'half_day') {
      presentDays += 0.5;
    } else if (['holiday', 'week_off', 'on_duty', 'leave'].includes(att.status)) {
      presentDays += 1;
    }
  }

  const lateThreshold = config.lop_partial_day_threshold_late_marks || 3;
  const earlyThreshold = config.lop_partial_day_threshold_early_exit || 3;
  let lopFromLateness = 0;
  if (config.lop_half_day_enabled) {
    lopFromLateness = Math.floor(lateMarkCount / lateThreshold) * 0.5;
    lopFromLateness += Math.floor(earlyExitCount / earlyThreshold) * 0.5;
  }

  const totalLopDays = Math.round((unapprovedAbsentDays + lopFromLateness) * 4) / 4;

  if (totalLopDays === 0) return { lop_days: 0, lop_amount: 0, lop_breakdown: {}, present_days: presentDays, paid_leave_days: paidLeaveDays, working_days: totalWorkingDays };

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
    present_days: presentDays,
    paid_leave_days: paidLeaveDays,
    working_days: totalWorkingDays
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin' && user?.role !== 'hr') {
      return Response.json({ error: 'Forbidden: Admin/HR access required' }, { status: 403 });
    }

    const { month, year } = await req.json();
    if (!month || !year) return Response.json({ error: 'month and year are required' }, { status: 400 });

    // Get all active employees
    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });
    const users = await base44.asServiceRole.entities.User.list();
    
    // Get holidays for the month
    const holidays = await base44.asServiceRole.entities.Holiday.filter({ year });
    const holidayDates = new Set(holidays.map(h => h.date?.split('T')[0]));

    // Get salary structures
    const salaryStructures = await base44.asServiceRole.entities.SalaryStructure.list();

    // Get approved leaves for the month
    const approvedLeaves = await base44.asServiceRole.entities.Leave.filter({ status: 'approved' });
    
    // Get loan records for EMI deductions
    const loans = await base44.asServiceRole.entities.Loan.filter({ 
      status: { $in: ['active', 'disbursed'] }
    });

    const results = [];

    // Month date boundaries
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    for (const emp of employees) {
      try {
        // Get active salary structure
        const empSalary = salaryStructures.find(s => s.user_id === emp.user_id && s.status === 'active');
        if (!empSalary) {
          results.push({ employee: emp.employee_code, status: 'skipped', reason: 'No active salary structure' });
          continue;
        }

        // ─── Compute LOP via inline function ───
        const existingPayrollCheck = await base44.asServiceRole.entities.Payroll.filter({ user_id: emp.user_id, month, year });
        let lopResult;
        if (existingPayrollCheck.length > 0 && existingPayrollCheck[0].lop_overridden) {
          lopResult = {
            lop_days: existingPayrollCheck[0].loss_of_pay_days || 0,
            lop_amount: existingPayrollCheck[0].loss_of_pay_amount || 0,
            lop_breakdown: existingPayrollCheck[0].lop_deduction_breakdown || {},
            lop_overridden: true,
            working_days: existingPayrollCheck[0].working_days || endDate.getDate(),
            present_days: existingPayrollCheck[0].present_days || 0,
            paid_leave_days: existingPayrollCheck[0].paid_leave_days || 0
          };
        } else {
          lopResult = await computeLOP(base44, emp.user_id, month, year);
        }

        // Working days from LOP result (or fallback)
        const workingDays = lopResult.working_days || endDate.getDate();
        const presentDays = lopResult.present_days || 0;
        const paidLeaveDays = lopResult.paid_leave_days || 0;
        const lossOfPayDays = lopResult.lop_days || 0;

        // Basic salary after LOP deduction
        const lopBasicDeduction = lopResult.lop_breakdown?.basic_salary || 0;
        const basicSalary = (empSalary.basic_salary || 0) - lopBasicDeduction;
        const hra = empSalary.hra || 0;
        const conveyance = empSalary.conveyance || 0;
        const medical = empSalary.medical || 0;
        const specialAllowance = empSalary.special_allowance || 0;
        const lta = empSalary.lta || 0;
        const bonus = empSalary.performance_bonus || 0;

        // Additional LOP deductions on other components
        const hraAfterLop = hra - (lopResult.lop_breakdown?.hra || 0);
        const conveyanceAfterLop = conveyance - (lopResult.lop_breakdown?.conveyance || 0);
        const medicalAfterLop = medical - (lopResult.lop_breakdown?.medical || 0);
        const specialAfterLop = specialAllowance - (lopResult.lop_breakdown?.special_allowance || 0);
        const ltaAfterLop = lta - (lopResult.lop_breakdown?.lta || 0);

        const grossSalary = Math.max(0, basicSalary + hraAfterLop + conveyanceAfterLop + medicalAfterLop + specialAfterLop + ltaAfterLop);

        // Calculate deductions
        const pfDeduction = empSalary.pf_contribution || 0;
        const professionalTax = empSalary.professional_tax || 0;
        const gratuity = empSalary.gratuity || 0;
        
        // ESI calculation (if gross < 21000)
        let esiDeduction = 0;
        if (grossSalary < 21000) {
          esiDeduction = Math.round(grossSalary * 0.0075); // 0.75% employee contribution
        }

        // TDS calculation (simplified)
        let tdsDeduction = 0;
        const annualGross = grossSalary * 12;
        if (annualGross > 250000) {
          const taxableIncome = annualGross - 250000;
          const annualTax = taxableIncome * 0.05; // 5% for first slab
          tdsDeduction = Math.round(annualTax / 12);
        }

        // Loan EMI deduction
        let loanEmiDeduction = 0;
        const empLoans = loans.filter(l => l.user_id === emp.user_id);
        empLoans.forEach(loan => {
          if (loan.emi_amount) {
            loanEmiDeduction += loan.emi_amount;
          }
        });

        const deductions = {
          pf: pfDeduction,
          esi: esiDeduction,
          professional_tax: professionalTax,
          tds: tdsDeduction,
          loan_emi: loanEmiDeduction
        };

        const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + val, 0);
        const netSalary = grossSalary - totalDeductions;

        const payrollData = {
          user_id: emp.user_id,
          month,
          year,
          salary_structure_id: empSalary.id,
          working_days: workingDays,
          present_days: presentDays,
          leave_days: paidLeaveDays,
          paid_leave_days: paidLeaveDays,
          loss_of_pay_days: lossOfPayDays,
          loss_of_pay_amount: lopResult.lop_amount || 0,
          lop_deduction_breakdown: lopResult.lop_breakdown || {},
          lop_overridden: lopResult.lop_overridden || false,
          overtime_hours: 0,
          basic_salary: basicSalary,
          hra: hraAfterLop,
          allowances: {
            conveyance: conveyanceAfterLop,
            medical: medicalAfterLop,
            lta: ltaAfterLop,
            special_allowance: specialAfterLop
          },
          gross_salary: grossSalary,
          deductions,
          reimbursements: 0,
          bonuses: 0,
          arrears: 0,
          net_salary: netSalary,
          status: existingPayrollCheck.length > 0 ? existingPayrollCheck[0].status : 'draft'
        };

        // Re-use the already-fetched existingPayrollCheck
        const existingPayroll = existingPayrollCheck;

        if (existingPayroll.length > 0) {
          await base44.asServiceRole.entities.Payroll.update(existingPayroll[0].id, payrollData);
          results.push({ employee: emp.employee_code, status: 'updated' });
        } else {
          await base44.asServiceRole.entities.Payroll.create(payrollData);
          results.push({ employee: emp.employee_code, status: 'created' });
        }

      } catch (error) {
        console.error(`Error processing payroll for ${emp.employee_code}:`, error);
        results.push({ employee: emp.employee_code, status: 'error', error: error.message });
      }
    }

    return Response.json({ 
      success: true, 
      message: `Processed payroll for ${results.length} employees`,
      results 
    });

  } catch (error) {
    console.error('Error in processPayroll:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});