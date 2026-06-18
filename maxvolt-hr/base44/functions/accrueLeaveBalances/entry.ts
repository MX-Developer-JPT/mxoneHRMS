import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Manager-level designation tiers eligible for SL
const SL_ELIGIBLE_TIERS = ['manager', 'general_manager', 'director'];
const SL_ELIGIBLE_ROLES = ['management', 'admin', 'hr'];

function isManagerLevel(emp, user) {
  return SL_ELIGIBLE_TIERS.includes(emp.designation_tier) ||
    SL_ELIGIBLE_ROLES.includes(user?.role) ||
    SL_ELIGIBLE_ROLES.includes(user?.custom_role);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });
    const leavePolicies = await base44.asServiceRole.entities.LeavePolicy.filter({ is_active: true });
    const users = await base44.asServiceRole.entities.User.list();

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const results = [];

    for (const emp of employees) {
      const user = users.find(u => u.id === emp.user_id);
      if (!user) continue;

      const joiningDate = new Date(emp.date_of_joining);
      const serviceDays = Math.floor((currentDate - joiningDate) / (1000 * 60 * 60 * 24));

      for (const policy of leavePolicies) {
        // ---- ELIGIBILITY CHECKS ----
        if (policy.code === 'SL' && !isManagerLevel(emp, user)) continue;
        if (policy.code === 'EL') {
          // EL only after confirmation
          if (emp.employee_status === 'probation' || emp.employee_status === 'trainee') continue;
          if (!emp.employee_confirmation_date) continue;
        }

        if (serviceDays < (policy.min_service_days || 0)) continue;

        // Get or create balance record
        let balanceRecords = await base44.asServiceRole.entities.LeaveBalance.filter({
          user_id: emp.user_id,
          leave_policy_id: policy.id,
          year: currentYear
        });

        let balance;
        if (balanceRecords.length === 0) {
          balance = await base44.asServiceRole.entities.LeaveBalance.create({
            user_id: emp.user_id,
            leave_policy_id: policy.id,
            year: currentYear,
            total_allocated: 0,
            accrued_this_year: 0,
            used: 0,
            pending_approval: 0,
            available: 0,
            carried_forward: 0,
            last_accrual_month: 0,
            last_accrual_year: currentYear
          });
        } else {
          balance = balanceRecords[0];
        }

        // Prevent double-accrual for same month
        if (balance.last_accrual_month === currentMonth && balance.last_accrual_year === currentYear) {
          continue;
        }

        let accrualAmount = 0;

        if (policy.code === 'CL') {
          // CL: 7 days/year, pro-rata monthly (7/12 ≈ 0.583/month)
          // Cap at total_days for the year
          const maxAccruable = policy.total_days || 7;
          const alreadyAccrued = balance.accrued_this_year || 0;
          const monthlyRate = maxAccruable / 12;
          accrualAmount = Math.min(monthlyRate, maxAccruable - alreadyAccrued);
          accrualAmount = Math.round(accrualAmount * 4) / 4; // Round to nearest 0.25
        } else if (policy.code === 'EL') {
          // EL: 1 day per month after confirmation
          const confirmDate = new Date(emp.employee_confirmation_date);
          const monthsSinceConfirmation = (currentYear - confirmDate.getFullYear()) * 12 + (currentMonth - (confirmDate.getMonth() + 1));
          if (monthsSinceConfirmation >= 0) {
            const maxAccruable = policy.total_days || 15;
            const alreadyAccrued = balance.accrued_this_year || 0;
            accrualAmount = alreadyAccrued < maxAccruable ? 1 : 0;
          }
        } else if (policy.code === 'SL') {
          // SL: 7 days/year, pro-rata monthly
          const maxAccruable = policy.total_days || 7;
          const alreadyAccrued = balance.accrued_this_year || 0;
          const monthlyRate = maxAccruable / 12;
          accrualAmount = Math.min(monthlyRate, maxAccruable - alreadyAccrued);
          accrualAmount = Math.round(accrualAmount * 4) / 4;
        } else if (policy.accrual_type === 'monthly') {
          accrualAmount = policy.accrual_rate || (policy.total_days / 12);
        } else if (policy.accrual_type === 'yearly') {
          // Credit all at once at year start (only if not yet accrued this year)
          if ((balance.accrued_this_year || 0) === 0) {
            accrualAmount = policy.total_days;
          }
        }

        if (accrualAmount > 0) {
          const newAccrued = (balance.accrued_this_year || 0) + accrualAmount;
          const newAllocated = (balance.carried_forward || 0) + newAccrued;
          const newAvailable = (balance.available || 0) + accrualAmount;

          await base44.asServiceRole.entities.LeaveBalance.update(balance.id, {
            total_allocated: newAllocated,
            accrued_this_year: newAccrued,
            available: newAvailable,
            last_accrual_month: currentMonth,
            last_accrual_year: currentYear
          });

          results.push({ employee: emp.employee_code, policy: policy.code, accrued: accrualAmount });
        }
      }

      // ---- CARRY FORWARD (Run on December 31) ----
      if (currentMonth === 12 && currentDate.getDate() === 31) {
        const allBalances = await base44.asServiceRole.entities.LeaveBalance.filter({
          user_id: emp.user_id, year: currentYear
        });

        for (const bal of allBalances) {
          const pol = leavePolicies.find(p => p.id === bal.leave_policy_id);
          if (!pol) continue;

          let carryAmt = 0;
          if (pol.code === 'CL') {
            carryAmt = 0; // CL does not carry forward
          } else if (pol.code === 'EL') {
            carryAmt = bal.available || 0; // EL fully carries forward
          } else if (pol.code === 'SL') {
            carryAmt = Math.min(bal.available || 0, 7); // SL max 7 carry forward
          } else if (pol.carry_forward) {
            carryAmt = pol.carry_forward_limit
              ? Math.min(bal.available || 0, pol.carry_forward_limit)
              : (bal.available || 0);
          }

          if (carryAmt > 0) {
            const nextYearBals = await base44.asServiceRole.entities.LeaveBalance.filter({
              user_id: emp.user_id, leave_policy_id: pol.id, year: currentYear + 1
            });

            if (nextYearBals.length === 0) {
              await base44.asServiceRole.entities.LeaveBalance.create({
                user_id: emp.user_id, leave_policy_id: pol.id, year: currentYear + 1,
                total_allocated: carryAmt, accrued_this_year: 0,
                used: 0, pending_approval: 0, available: carryAmt, carried_forward: carryAmt,
                last_accrual_month: 0, last_accrual_year: currentYear + 1
              });
            } else {
              await base44.asServiceRole.entities.LeaveBalance.update(nextYearBals[0].id, {
                carried_forward: carryAmt,
                total_allocated: (nextYearBals[0].total_allocated || 0) + carryAmt,
                available: (nextYearBals[0].available || 0) + carryAmt
              });
            }
            results.push({ employee: emp.employee_code, policy: pol.code, carried_forward: carryAmt, to_year: currentYear + 1 });
          }
        }
      }
    }

    return Response.json({
      success: true,
      message: `Processed ${employees.length} employees`,
      results
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});