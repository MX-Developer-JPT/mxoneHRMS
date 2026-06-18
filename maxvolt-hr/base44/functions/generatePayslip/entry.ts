import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { payroll_id } = await req.json();

        if (!payroll_id) {
            return Response.json({ error: 'Payroll ID is required' }, { status: 400 });
        }

        const payrolls = await base44.asServiceRole.entities.Payroll.filter({ id: payroll_id });
        if (payrolls.length === 0) {
            return Response.json({ error: 'Payroll not found' }, { status: 404 });
        }

        const payroll = payrolls[0];

        const [employees, users, salaryStructures, bonuses] = await Promise.all([
            base44.asServiceRole.entities.Employee.filter({ user_id: payroll.user_id }),
            base44.asServiceRole.entities.User.filter({ id: payroll.user_id }),
            base44.asServiceRole.entities.SalaryStructure.filter({ user_id: payroll.user_id, status: 'active' }),
            base44.asServiceRole.entities.Bonus.filter({ payroll_id: payroll_id }),
        ]);

        const employee = employees[0] || {};
        const empUser = users[0] || {};
        const salaryStructure = salaryStructures[0] || {};

        return Response.json({
            success: true,
            payroll,
            employee,
            empUser,
            salaryStructure,
            bonuses
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});