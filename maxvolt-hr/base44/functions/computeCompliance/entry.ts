import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Indian statutory constants
const PF_WAGE_CEILING = 15000;
const PF_EMPLOYEE_RATE = 0.12;
const PF_EMPLOYER_RATE = 0.12;
const ESI_WAGE_CEILING = 21000;
const ESI_EMPLOYEE_RATE = 0.0075;
const ESI_EMPLOYER_RATE = 0.0325;
const GRATUITY_RATE = 15 / 26;
const BONUS_MIN_RATE = 0.0833;
const BONUS_MAX_RATE = 0.20;
const BONUS_WAGE_CEILING = 21000;
const MINIMUM_WAGE = 10000; // configurable per state

function getProfessionalTax(grossSalary) {
  // Maharashtra PT slabs (most common)
  if (grossSalary <= 7500) return 0;
  if (grossSalary <= 10000) return 175;
  return 200;
}

function getLWF(month) {
  // LWF typically deducted in June and December
  if (month === 6 || month === 12) return { employee: 6, employer: 12 };
  return { employee: 0, employer: 0 };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { month, year } = await req.json();
    if (!month || !year) {
      return Response.json({ error: 'month and year are required' }, { status: 400 });
    }

    // Fetch all active employees
    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });
    const salaryStructures = await base44.asServiceRole.entities.SalaryStructure.list();

    const salaryMap = {};
    for (const s of salaryStructures) {
      salaryMap[s.user_id] = s;
    }

    const results = [];
    const errors = [];

    for (const emp of employees) {
      const ss = salaryMap[emp.user_id];
      if (!ss) {
        errors.push({ user_id: emp.user_id, error: 'No salary structure found' });
        continue;
      }

      const grossSalary = ss.gross_salary || 0;
      const pfWage = Math.min(grossSalary, PF_WAGE_CEILING);
      const pfApplicable = !emp.is_attendance_exempt && grossSalary > 0;

      const esiApplicable = grossSalary <= ESI_WAGE_CEILING;
      const lwf = getLWF(month);

      // Calculate years of service for gratuity
      const doj = emp.date_of_joining ? new Date(emp.date_of_joining) : null;
      const yearsOfService = doj ? (new Date().getFullYear() - doj.getFullYear()) : 0;
      const gratuityEligible = yearsOfService >= 5;
      const monthlyBasic = ss.basic_salary || grossSalary * 0.4;
      const gratuityProvision = gratuityEligible ? (monthlyBasic * GRATUITY_RATE) : 0;

      // Bonus (applicable if gross <= BONUS_WAGE_CEILING, October typically)
      const bonusApplicable = grossSalary <= BONUS_WAGE_CEILING;
      const bonusAmount = bonusApplicable && month === 10
        ? Math.min(grossSalary, BONUS_WAGE_CEILING) * BONUS_MIN_RATE
        : 0;

      const pt = getProfessionalTax(grossSalary);

      const record = {
        user_id: emp.user_id,
        month,
        year,
        pf_applicable: pfApplicable,
        pf_employee_contribution: pfApplicable ? Math.round(pfWage * PF_EMPLOYEE_RATE) : 0,
        pf_employer_contribution: pfApplicable ? Math.round(pfWage * PF_EMPLOYER_RATE) : 0,
        pf_status: 'pending',
        esi_applicable: esiApplicable,
        esi_employee_contribution: esiApplicable ? Math.round(grossSalary * ESI_EMPLOYEE_RATE) : 0,
        esi_employer_contribution: esiApplicable ? Math.round(grossSalary * ESI_EMPLOYER_RATE) : 0,
        esi_status: 'pending',
        tds_amount: ss.tds_monthly || 0,
        tds_status: 'pending',
        pt_applicable: grossSalary > 7500,
        pt_amount: pt,
        pt_status: 'pending',
        lwf_applicable: lwf.employee > 0,
        lwf_employee_contribution: lwf.employee,
        lwf_employer_contribution: lwf.employer,
        lwf_status: 'pending',
        gratuity_eligible: gratuityEligible,
        gratuity_provision: Math.round(gratuityProvision),
        bonus_applicable: bonusApplicable,
        bonus_amount: Math.round(bonusAmount),
        minimum_wage_compliant: grossSalary >= MINIMUM_WAGE,
        gross_salary: grossSalary,
        net_salary: ss.net_salary || 0,
        calculated_by: user.email
      };

      // Check if record already exists for this month/year/user
      const existing = await base44.asServiceRole.entities.ComplianceRecord.filter({
        user_id: emp.user_id, month, year
      });

      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.ComplianceRecord.update(existing[0].id, record);
      } else {
        await base44.asServiceRole.entities.ComplianceRecord.create(record);
      }

      results.push({ user_id: emp.user_id, status: 'computed' });
    }

    // Log audit
    await base44.asServiceRole.entities.ComplianceAuditLog.create({
      action: 'COMPUTE_COMPLIANCE',
      module: 'ComplianceRecord',
      actor_id: user.id,
      actor_name: user.full_name,
      new_value: `Computed for ${month}/${year} — ${results.length} employees`,
      remarks: errors.length > 0 ? `${errors.length} errors` : 'All computed successfully'
    });

    return Response.json({ success: true, computed: results.length, errors });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});