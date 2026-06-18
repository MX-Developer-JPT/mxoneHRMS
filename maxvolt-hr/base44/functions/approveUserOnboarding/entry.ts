import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function withRetry(fn, retries = 4, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if ((e?.status === 429 || e?.message?.includes('429') || e?.message?.includes('Rate limit')) && i < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      } else {
        throw e;
      }
    }
  }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const currentUser = await base44.auth.me();
        const currentUserRole = currentUser.custom_role || currentUser.role;
        if (!currentUser || !['admin', 'hr'].includes(currentUserRole)) {
            return Response.json({ error: 'Forbidden: Admin or HR access required' }, { status: 403 });
        }

        const { userId, employeeData, newUserRole } = await req.json();

        if (!userId || !employeeData || !newUserRole) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Find existing employee record
        const employees = await withRetry(() => base44.asServiceRole.entities.Employee.filter({ user_id: userId }));

        await new Promise(r => setTimeout(r, 300));

        if (employees.length > 0) {
            await withRetry(() => base44.asServiceRole.entities.Employee.update(employees[0].id, {
                ...employeeData,
                status: 'active'
            }));
        } else {
            await withRetry(() => base44.asServiceRole.entities.Employee.create({
                user_id: userId,
                ...employeeData,
                status: 'active'
            }));
        }

        await new Promise(r => setTimeout(r, 300));

        // Update User custom_role
        await withRetry(() => base44.asServiceRole.entities.User.update(userId, { custom_role: newUserRole }));

        return Response.json({ message: 'User approved and onboarded successfully' }, { status: 200 });

    } catch (error) {
        console.error('Error in approveUserOnboarding function:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});