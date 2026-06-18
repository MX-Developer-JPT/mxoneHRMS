import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Triggered by automation when a new User is created
// Links user_id to Employee, SalaryStructure, LeaveBalance records by email
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json();
  const eventType = body?.event?.type;
  const entityName = body?.event?.entity_name;

  if (entityName !== 'User' || eventType !== 'create') {
    return Response.json({ skipped: true });
  }

  const newUser = body?.data;
  if (!newUser?.id || !newUser?.email) {
    return Response.json({ error: 'Missing user data' }, { status: 400 });
  }

  const userId = newUser.id;
  const email = newUser.email;
  const linked = [];

  // 1. Find Employee by personal_email
  const employees = await base44.asServiceRole.entities.Employee.filter({ personal_email: email });
  for (const emp of employees) {
    if (!emp.user_id) {
      await base44.asServiceRole.entities.Employee.update(emp.id, { user_id: userId });
      linked.push(`Employee:${emp.id}`);

      // Also set reporting_manager_id if reporting_manager_email was stored (not standard field, handled during import)
    }
  }

  // 2. Find SalaryStructure by _pending_email
  const salStructures = await base44.asServiceRole.entities.SalaryStructure.filter({ _pending_email: email });
  for (const ss of salStructures) {
    if (!ss.user_id) {
      await base44.asServiceRole.entities.SalaryStructure.update(ss.id, { user_id: userId, _pending_email: null });
      linked.push(`SalaryStructure:${ss.id}`);
    }
  }

  // 3. Find LeaveBalance by _pending_email
  const leaveBalances = await base44.asServiceRole.entities.LeaveBalance.filter({ _pending_email: email });
  for (const lb of leaveBalances) {
    if (!lb.user_id) {
      await base44.asServiceRole.entities.LeaveBalance.update(lb.id, { user_id: userId, _pending_email: null });
      linked.push(`LeaveBalance:${lb.id}`);
    }
  }

  return Response.json({ success: true, user: email, linked });
});