import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin' && user?.role !== 'hr') {
      return Response.json({ error: 'Forbidden: Admin/HR access required' }, { status: 403 });
    }

    const { user_id, exit_date } = await req.json();

    const employee = await base44.asServiceRole.entities.Employee.filter({ user_id });
    if (!employee.length) {
      return Response.json({ error: 'Employee not found' }, { status: 404 });
    }

    const emp = employee[0];
    const exitDateObj = new Date(exit_date);
    const joiningDate = new Date(emp.date_of_joining);
    
    const salaryStructures = await base44.asServiceRole.entities.SalaryStructure.filter({ 
      user_id, 
      status: 'active' 
    });
    
    if (!salaryStructures.length) {
      return Response.json({ error: 'No active salary structure found' }, { status: 404 });
    }

    const empSalary = salaryStructures[0];
    
    // Calculate service years
    const serviceYears = (exitDateObj - joiningDate) / (1000 * 60 * 60 * 24 * 365.25);

    // Get leave balances
    const leaveBalances = await base44.asServiceRole.entities.LeaveBalance.filter({ user_id });
    
    // Get leave policies
    const leavePolicies = await base44.asServiceRole.entities.LeavePolicy.list();
    
    // Calculate days in final month
    const finalMonth = exitDateObj.getMonth() + 1;
    const finalYear = exitDateObj.getFullYear();
    const daysInMonth = new Date(finalYear, finalMonth, 0).getDate();
    const workedDaysInMonth = exitDateObj.getDate();
    
    // Pro-rated salary for final month
    const perDaySalary = empSalary.basic_salary / daysInMonth;
    const basicSalary = perDaySalary * workedDaysInMonth;
    const hra = (empSalary.hra || 0) * (workedDaysInMonth / daysInMonth);
    const allowances = {
      conveyance: (empSalary.conveyance || 0) * (workedDaysInMonth / daysInMonth),
      medical: (empSalary.medical || 0) * (workedDaysInMonth / daysInMonth),
      special_allowance: (empSalary.special_allowance || 0) * (workedDaysInMonth / daysInMonth)
    };
    
    const grossSalary = basicSalary + hra + Object.values(allowances).reduce((sum, val) => sum + val, 0);

    // Gratuity calculation (if service > 5 years)
    let gratuity = 0;
    if (serviceYears >= 5) {
      const lastDrawnSalary = empSalary.basic_salary + (empSalary.hra || 0);
      gratuity = (lastDrawnSalary * 15 * serviceYears) / 26;
    }

    // Leave encashment
    let leaveEncashment = 0;
    leaveBalances.forEach(balance => {
      const policy = leavePolicies.find(p => p.id === balance.leave_policy_id);
      if (policy?.encashable && balance.available > 0) {
        const maxEncashable = policy.max_encashment_days || balance.available;
        const encashableDays = Math.min(balance.available, maxEncashable);
        leaveEncashment += encashableDays * perDaySalary;
      }
    });

    // Notice period recovery/payment
    let noticePay = 0;
    const exitRecord = await base44.asServiceRole.entities.Exit.filter({ user_id });
    if (exitRecord.length > 0) {
      const notice = exitRecord[0];
      if (notice.notice_period_days && notice.notice_served_days) {
        const shortfall = notice.notice_period_days - notice.notice_served_days;
        if (shortfall > 0) {
          noticePay = -1 * (shortfall * perDaySalary); // Deduction
        } else if (shortfall < 0) {
          noticePay = Math.abs(shortfall) * perDaySalary; // Payment
        }
      }
    }

    // Pending reimbursements
    const pendingReimbursements = await base44.asServiceRole.entities.Reimbursement.filter({
      user_id,
      status: 'approved',
      payment_date: null
    });
    const totalReimbursements = pendingReimbursements.reduce((sum, r) => sum + (r.amount || 0), 0);

    // Outstanding loans
    const outstandingLoans = await base44.asServiceRole.entities.Loan.filter({
      user_id,
      status: { $in: ['active', 'disbursed'] }
    });
    const totalLoanDeduction = outstandingLoans.reduce((sum, l) => sum + (l.outstanding_amount || 0), 0);

    // Standard deductions
    const deductions = {
      pf: (empSalary.pf_contribution || 0) * (workedDaysInMonth / daysInMonth),
      professional_tax: (empSalary.professional_tax || 0) * (workedDaysInMonth / daysInMonth),
      outstanding_loans: totalLoanDeduction,
      notice_pay_recovery: noticePay < 0 ? Math.abs(noticePay) : 0
    };

    const fnfComponents = {
      pro_rated_salary: grossSalary,
      gratuity,
      leave_encashment: leaveEncashment,
      notice_pay: noticePay > 0 ? noticePay : 0,
      pending_reimbursements: totalReimbursements,
      arrears: 0
    };

    const totalEarnings = Object.values(fnfComponents).reduce((sum, val) => sum + val, 0);
    const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + val, 0);
    const netPayable = totalEarnings - totalDeductions;

    const payrollData = {
      user_id,
      month: finalMonth,
      year: finalYear,
      salary_structure_id: empSalary.id,
      working_days: daysInMonth,
      present_days: workedDaysInMonth,
      leave_days: 0,
      paid_leave_days: 0,
      loss_of_pay_days: 0,
      overtime_hours: 0,
      basic_salary: basicSalary,
      hra,
      allowances,
      gross_salary: grossSalary,
      deductions,
      reimbursements: totalReimbursements,
      bonuses: 0,
      arrears: 0,
      net_salary: netPayable,
      status: 'processed',
      is_full_and_final: true,
      fnf_components: fnfComponents,
      processed_by: user.id
    };

    const existingPayroll = await base44.asServiceRole.entities.Payroll.filter({
      user_id,
      month: finalMonth,
      year: finalYear
    });

    let result;
    if (existingPayroll.length > 0) {
      result = await base44.asServiceRole.entities.Payroll.update(existingPayroll[0].id, payrollData);
    } else {
      result = await base44.asServiceRole.entities.Payroll.create(payrollData);
    }

    return Response.json({ 
      success: true, 
      message: 'Full and Final settlement processed successfully',
      payroll: result,
      breakdown: {
        service_years: serviceYears.toFixed(2),
        fnf_components: fnfComponents,
        deductions,
        net_payable: netPayable
      }
    });

  } catch (error) {
    console.error('Error in processFnFSettlement:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});