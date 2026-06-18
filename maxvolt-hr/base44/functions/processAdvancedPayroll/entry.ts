import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin' && user?.role !== 'hr') {
      return Response.json({ error: 'Forbidden: Admin/HR access required' }, { status: 403 });
    }

    const { month, year } = await req.json();

    // Load PayrollConfiguration for settings
    const configs = await base44.asServiceRole.entities.PayrollConfiguration.list();
    const cfg = configs[0] || {};
    const PF_CEILING = cfg.pf_ceiling || 15000;
    const PF_EMPLOYEE_RATE = (cfg.pf_employee_rate || 12) / 100;
    const PF_EMPLOYER_RATE = (cfg.pf_employer_rate || 13) / 100;
    const ESI_EMPLOYEE_RATE = (cfg.esi_employee_rate || 0.75) / 100;
    const ESI_EMPLOYER_RATE = (cfg.esi_employer_rate || 3.25) / 100;
    const ESI_CEILING = cfg.esi_wage_ceiling || 21000;
    const OT_MULTIPLIER = cfg.overtime_multiplier || 2;
    const tdsSlabs = cfg.tds_slabs || [
      { min: 0, max: 250000, rate: 0 },
      { min: 250001, max: 500000, rate: 5 },
      { min: 500001, max: 1000000, rate: 20 },
      { min: 1000001, max: 999999999, rate: 30 }
    ];

    const calcTDS = (annualGross) => {
      let tax = 0;
      for (const slab of tdsSlabs) {
        if (annualGross > slab.min) {
          const taxable = Math.min(annualGross, slab.max) - slab.min + 1;
          tax += taxable * (slab.rate / 100);
        }
      }
      return Math.round(tax / 12);
    };

    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });
    const salaryStructures = await base44.asServiceRole.entities.SalaryStructure.list();
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const attendanceRecords = await base44.asServiceRole.entities.Attendance.list('-date', 10000);
    const approvedLeaves = await base44.asServiceRole.entities.Leave.filter({ status: 'approved' });
    const loans = await base44.asServiceRole.entities.Loan.filter({ status: { $in: ['active', 'disbursed'] } });
    const reimbursements = await base44.asServiceRole.entities.Reimbursement.filter({ status: 'approved' });
    const bonuses = await base44.asServiceRole.entities.Bonus.filter({ month, year, status: 'approved' });

    const results = [];

    for (const emp of employees) {
      try {
        const empSalary = salaryStructures.find(s => s.user_id === emp.user_id && s.status === 'active');
        if (!empSalary) continue;

        // Attendance-exempt employees get full salary without any attendance deductions
        if (emp.is_attendance_exempt) {
          const grossSalary = (empSalary.basic_salary || 0) + (empSalary.hra || 0) + (empSalary.conveyance || 0) +
            (empSalary.medical || 0) + (empSalary.special_allowance || 0) + (empSalary.lta || 0);
          const pfBase = Math.min(empSalary.basic_salary || 0, PF_CEILING);
          const pfDeduction = pfBase * PF_EMPLOYEE_RATE;
          const esiDeduction = grossSalary <= ESI_CEILING ? grossSalary * ESI_EMPLOYEE_RATE : 0;
          const professionalTax = empSalary.professional_tax || 0;
          const tdsDeduction = calcTDS(grossSalary * 12);
          let loanEmiDeduction = 0;
          loans.filter(l => l.user_id === emp.user_id).forEach(loan => { if (loan.emi_amount) loanEmiDeduction += loan.emi_amount; });
          const deductions = { pf: Math.round(pfDeduction * 100) / 100, esi: Math.round(esiDeduction * 100) / 100, professional_tax: professionalTax, tds: tdsDeduction, loan_emi: loanEmiDeduction };
          const totalDeductions = Object.values(deductions).reduce((s, v) => s + v, 0);
          const netSalary = grossSalary - totalDeductions;
          const employerPF = pfBase * PF_EMPLOYER_RATE;
          const employerESI = grossSalary <= ESI_CEILING ? grossSalary * ESI_EMPLOYER_RATE : 0;
          const employerContributions = { pf: Math.round(employerPF * 100) / 100, esi: Math.round(employerESI * 100) / 100 };
          if (empSalary.gratuity_eligible !== false && empSalary.gratuity) employerContributions.gratuity = empSalary.gratuity;
          const existingPayroll = await base44.asServiceRole.entities.Payroll.filter({ user_id: emp.user_id, month, year });
          const payrollData = {
            user_id: emp.user_id, month, year, salary_structure_id: empSalary.id,
            working_days: endDate.getDate(), present_days: endDate.getDate(), leave_days: 0, paid_leave_days: 0,
            loss_of_pay_days: 0, overtime_hours: 0, overtime_amount: 0,
            basic_salary: Math.round((empSalary.basic_salary || 0) * 100) / 100,
            hra: Math.round((empSalary.hra || 0) * 100) / 100,
            allowances: { conveyance: empSalary.conveyance || 0, medical: empSalary.medical || 0, special_allowance: empSalary.special_allowance || 0, lta: empSalary.lta || 0 },
            gross_salary: Math.round(grossSalary * 100) / 100, deductions,
            reimbursements: 0, bonuses: 0, arrears: 0, loan_emi_deduction: loanEmiDeduction,
            net_salary: Math.round(netSalary * 100) / 100, employer_contributions: employerContributions,
            total_cost_to_company: Math.round((grossSalary + Object.values(employerContributions).reduce((s, v) => s + v, 0)) * 100) / 100,
            status: 'processed', processed_by: user.id
          };
          if (existingPayroll.length > 0) {
            await base44.asServiceRole.entities.Payroll.update(existingPayroll[0].id, payrollData);
            results.push({ employee: emp.employee_code, status: 'updated', exempt: true });
          } else {
            await base44.asServiceRole.entities.Payroll.create(payrollData);
            results.push({ employee: emp.employee_code, status: 'created', exempt: true });
          }
          continue;
        }

        const empShiftArr = emp.shift_id
          ? await base44.asServiceRole.entities.Shift.filter({ id: emp.shift_id })
          : await base44.asServiceRole.entities.Shift.filter({ is_default: true });
        const shift = empShiftArr[0];
        const expectedWorkingHours = shift?.working_hours || 8;

        const workingDays = endDate.getDate();

        // Filter this employee's attendance for the month (both biometric AND selfie check-ins)
        const empAttendance = attendanceRecords.filter(a => {
          const d = new Date(a.date);
          return a.user_id === emp.user_id && d >= startDate && d <= endDate;
        });

        // Approved leave dates for this employee
        const empLeaves = approvedLeaves.filter(l =>
          l.user_id === emp.user_id &&
          new Date(l.start_date) <= endDate &&
          new Date(l.end_date) >= startDate
        );
        const leaveDates = new Set();
        let paidLeaveDays = 0;
        empLeaves.forEach(leave => {
          const s = new Date(Math.max(new Date(leave.start_date), startDate));
          const e = new Date(Math.min(new Date(leave.end_date), endDate));
          for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            const ds = d.toISOString().split('T')[0];
            leaveDates.add(ds);
          }
          paidLeaveDays += leave.total_days || 0;
        });

        let presentDays = 0;
        let halfDays = 0;
        let overtimeHours = 0;

        empAttendance.forEach(att => {
          const dateStr = String(att.date).split('T')[0];
          if (leaveDates.has(dateStr)) return;
          // Count any record with check-in (selfie) OR biometric_synced OR status=present/on_duty
          const hasAttended = att.biometric_synced || att.check_in_time || att.check_in_selfie_url;
          if (!hasAttended && att.status !== 'present' && att.status !== 'on_duty' && att.status !== 'half_day') return;
          if (att.status === 'present' || att.status === 'on_duty') {
            const wh = att.working_hours || 0;
            if (wh >= expectedWorkingHours) {
              presentDays++;
              if (att.overtime_hours) overtimeHours += att.overtime_hours;
            } else if (wh >= expectedWorkingHours / 2) {
              halfDays++;
            } else if (wh > 0) {
              // Very short hours — count as half day for pay purposes
              halfDays++;
            } else {
              // No working_hours recorded (e.g. checked in but no checkout yet) — count as present
              presentDays++;
            }
          } else if (att.status === 'half_day') {
            halfDays++;
          }
        });

        const totalPresent = presentDays + halfDays * 0.5 + paidLeaveDays;
        const lossOfPayDays = Math.max(0, workingDays - totalPresent);
        const perDaySalary = empSalary.basic_salary / workingDays;
        const deductionForAbsence = lossOfPayDays * perDaySalary;

        // Earnings — medical is an EARNING (part of gross)
        const basicSalary = Math.max(0, empSalary.basic_salary - deductionForAbsence);
        const ratio = empSalary.basic_salary > 0 ? basicSalary / empSalary.basic_salary : 1;
        const hra = Math.max(0, (empSalary.hra || 0) * ratio);
        const conveyance = empSalary.conveyance || 0;
        const medical = empSalary.medical || 0;          // EARNING, not deduction
        const specialAllowance = empSalary.special_allowance || 0;
        const lta = empSalary.lta || 0;

        let grossSalary = basicSalary + hra + conveyance + medical + specialAllowance + lta;

        // Overtime
        const overtimeRate = (empSalary.basic_salary / workingDays / expectedWorkingHours) * OT_MULTIPLIER;
        const overtimeAmount = overtimeHours * overtimeRate;
        grossSalary += overtimeAmount;

        // Reimbursements
        const empReimbursements = reimbursements.filter(r =>
          r.user_id === emp.user_id &&
          new Date(r.expense_date) >= startDate &&
          new Date(r.expense_date) <= endDate
        );
        const totalReimbursements = empReimbursements.reduce((s, r) => s + (r.amount || 0), 0);

        // Bonuses (approved off-cycle payments for this month)
        const empBonuses = bonuses.filter(b => b.user_id === emp.user_id);
        const totalBonuses = empBonuses.reduce((s, b) => s + (b.amount || 0), 0);
        grossSalary += totalReimbursements + totalBonuses;
        const empBonusIds = empBonuses.map(b => b.id);

        // Deductions (using PayrollConfiguration rates)
        const pfBase = Math.min(basicSalary, PF_CEILING);
        const pfDeduction = pfBase * PF_EMPLOYEE_RATE;
        const esiDeduction = grossSalary <= ESI_CEILING ? grossSalary * ESI_EMPLOYEE_RATE : 0;
        const professionalTax = empSalary.professional_tax || 0;
        const tdsDeduction = calcTDS(grossSalary * 12);

        let loanEmiDeduction = 0;
        const empLoans = loans.filter(l => l.user_id === emp.user_id);
        empLoans.forEach(loan => { if (loan.emi_amount) loanEmiDeduction += loan.emi_amount; });

        const deductions = {
          pf: Math.round(pfDeduction * 100) / 100,
          esi: Math.round(esiDeduction * 100) / 100,
          professional_tax: professionalTax,
          tds: tdsDeduction,
          loan_emi: loanEmiDeduction
        };

        const totalDeductions = Object.values(deductions).reduce((s, v) => s + v, 0);
        const netSalary = grossSalary - totalDeductions;

        // Employer contributions
        const employerPF = pfBase * PF_EMPLOYER_RATE;
        const employerESI = grossSalary <= ESI_CEILING ? grossSalary * ESI_EMPLOYER_RATE : 0;
        const employerContributions = {
          pf: Math.round(employerPF * 100) / 100,
          esi: Math.round(employerESI * 100) / 100
        };
        if (empSalary.gratuity_eligible !== false && empSalary.gratuity) {
          employerContributions.gratuity = empSalary.gratuity;
        }

        const totalCTC = grossSalary + Object.values(employerContributions).reduce((s, v) => s + v, 0);

        const existingPayroll = await base44.asServiceRole.entities.Payroll.filter({ user_id: emp.user_id, month, year });

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
          overtime_hours: overtimeHours,
          overtime_amount: Math.round(overtimeAmount * 100) / 100,
          basic_salary: Math.round(basicSalary * 100) / 100,
          hra: Math.round(hra * 100) / 100,
          allowances: { conveyance, medical, special_allowance: specialAllowance, lta },
          gross_salary: Math.round(grossSalary * 100) / 100,
          deductions,
          reimbursements: totalReimbursements,
          bonuses: totalBonuses,
          arrears: 0,
          loan_emi_deduction: loanEmiDeduction,
          net_salary: Math.round(netSalary * 100) / 100,
          employer_contributions: employerContributions,
          total_cost_to_company: Math.round(totalCTC * 100) / 100,
          status: 'processed',
          processed_by: user.id
        };

        let savedPayrollId;
        if (existingPayroll.length > 0) {
          await base44.asServiceRole.entities.Payroll.update(existingPayroll[0].id, payrollData);
          savedPayrollId = existingPayroll[0].id;
          results.push({ employee: emp.employee_code, status: 'updated' });
        } else {
          const newPayroll = await base44.asServiceRole.entities.Payroll.create(payrollData);
          savedPayrollId = newPayroll.id;
          results.push({ employee: emp.employee_code, status: 'created' });
        }
        // Link bonus records back to this payroll
        for (const bonusId of empBonusIds) {
          await base44.asServiceRole.entities.Bonus.update(bonusId, {
            payroll_id: savedPayrollId,
            included_in_payroll: true,
            status: 'paid'
          });
        }
      } catch (error) {
        console.error(`Error processing ${emp.employee_code}:`, error);
        results.push({ employee: emp.employee_code, status: 'error', error: error.message });
      }
    }

    return Response.json({
      success: true,
      processed: results.filter(r => r.status !== 'error'),
      errors: results.filter(r => r.status === 'error'),
      message: `Processed payroll for ${results.length} employees`
    });

  } catch (error) {
    console.error('Error in processAdvancedPayroll:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});