import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { month, year } = await req.json();

    const records = await base44.asServiceRole.entities.ComplianceRecord.filter({ month, year });
    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });
    const deadlines = await base44.asServiceRole.entities.ComplianceDeadline.list();

    const today = new Date();
    const enrichedDeadlines = deadlines.map(d => {
      const due = new Date(d.due_date);
      const daysLeft = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
      return { ...d, daysLeft };
    });

    // KYC compliance
    let kyc_missing = 0;
    let kyc_ok = 0;
    for (const emp of employees) {
      const missing = !emp.pan_number || !emp.aadhar_number ||
        !emp.bank_account?.account_number || !emp.bank_account?.ifsc_code;
      if (missing) kyc_missing++;
      else kyc_ok++;
    }

    const totalPFEmployee = records.reduce((s, r) => s + (r.pf_employee_contribution || 0), 0);
    const totalPFEmployer = records.reduce((s, r) => s + (r.pf_employer_contribution || 0), 0);
    const totalESIEmployee = records.reduce((s, r) => s + (r.esi_employee_contribution || 0), 0);
    const totalESIEmployer = records.reduce((s, r) => s + (r.esi_employer_contribution || 0), 0);
    const totalTDS = records.reduce((s, r) => s + (r.tds_amount || 0), 0);
    const totalPT = records.reduce((s, r) => s + (r.pt_amount || 0), 0);
    const totalLWFEmployee = records.reduce((s, r) => s + (r.lwf_employee_contribution || 0), 0);
    const totalLWFEmployer = records.reduce((s, r) => s + (r.lwf_employer_contribution || 0), 0);
    const totalGratuity = records.reduce((s, r) => s + (r.gratuity_provision || 0), 0);
    const totalBonus = records.reduce((s, r) => s + (r.bonus_amount || 0), 0);
    const minWageViolations = records.filter(r => !r.minimum_wage_compliant).length;

    const pfPending = records.filter(r => r.pf_applicable && r.pf_status === 'pending').length;
    const esiPending = records.filter(r => r.esi_applicable && r.esi_status === 'pending').length;
    const tdsPending = records.filter(r => r.tds_amount > 0 && r.tds_status === 'pending').length;

    return Response.json({
      summary: {
        total_employees: employees.length,
        records_computed: records.length,
        pf: { total_employee: totalPFEmployee, total_employer: totalPFEmployer, pending: pfPending },
        esi: { total_employee: totalESIEmployee, total_employer: totalESIEmployer, pending: esiPending },
        tds: { total: totalTDS, pending: tdsPending },
        pt: { total: totalPT },
        lwf: { total_employee: totalLWFEmployee, total_employer: totalLWFEmployer },
        gratuity: { total_provision: totalGratuity },
        bonus: { total: totalBonus },
        minimum_wage_violations: minWageViolations,
        kyc: { compliant: kyc_ok, missing: kyc_missing }
      },
      deadlines: enrichedDeadlines,
      records
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});