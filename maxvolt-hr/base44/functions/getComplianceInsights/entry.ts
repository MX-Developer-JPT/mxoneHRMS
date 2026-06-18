import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { month, year } = await req.json();

    const records = await base44.asServiceRole.entities.ComplianceRecord.filter({ month, year });
    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });

    const minWageViolations = records.filter(r => !r.minimum_wage_compliant).length;
    const missingKYC = employees.filter(e =>
      !e.pan_number || !e.aadhar_number || !e.bank_account?.account_number
    ).length;
    const pfPending = records.filter(r => r.pf_applicable && r.pf_status === 'pending').length;
    const esiPending = records.filter(r => r.esi_applicable && r.esi_status === 'pending').length;
    const noUAN = employees.filter(e => !e.uan_number).length;
    const noESI = employees.filter(e => e.is_esi_applicable && !e.esi_number).length;

    const prompt = `You are a compliance expert for Indian labor laws. Analyze this HR compliance data and provide:
1. Top 3 risk areas with severity (high/medium/low)
2. Specific corrective actions for each risk
3. Upcoming compliance priorities

Data for ${month}/${year}:
- Total active employees: ${employees.length}
- Minimum wage violations: ${minWageViolations}
- Missing KYC (PAN/Aadhar/Bank): ${missingKYC} employees
- PF filings pending: ${pfPending}
- ESI filings pending: ${esiPending}
- Employees missing UAN number: ${noUAN}
- ESI applicable employees missing ESI number: ${noESI}

Indian statutory context: PF due by 15th of next month, ESI due by 15th of next month, TDS due by 7th of next month, PT varies by state.

Provide actionable insights in a clear, structured format.`;

    const insights = await base44.integrations.Core.InvokeLLM({
      prompt,
      model: 'gemini_3_flash'
    });

    return Response.json({ insights });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});