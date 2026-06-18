import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();

    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const callerRole = caller.custom_role || caller.role;
    if (!['admin', 'hr'].includes(callerRole)) {
      return Response.json({ error: 'Forbidden: Only HR or Admin can update user details' }, { status: 403 });
    }

    const { userId, userUpdates, employeeUpdates } = await req.json();
    if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

    // Only admin can assign admin role
    if (userUpdates?.role === 'admin' && callerRole !== 'admin') {
      return Response.json({ error: 'Only Admin can assign admin role' }, { status: 403 });
    }

    let updatedUser = null;
    if (userUpdates && Object.keys(userUpdates).length > 0) {
      // Sync custom_role and role together if role is being changed
      if (userUpdates.role) userUpdates.custom_role = userUpdates.role;
      updatedUser = await base44.asServiceRole.entities.User.update(userId, userUpdates);
    }

    let updatedEmployee = null;
    // Merge display_name sync into employeeUpdates when full_name changes
    const mergedEmployeeUpdates = { ...(employeeUpdates || {}) };
    if (userUpdates?.full_name) {
      mergedEmployeeUpdates.display_name = userUpdates.full_name;
    }

    if (Object.keys(mergedEmployeeUpdates).length > 0) {
      const empRecords = await base44.asServiceRole.entities.Employee.filter({ user_id: userId });
      if (empRecords.length > 0) {
        updatedEmployee = await base44.asServiceRole.entities.Employee.update(empRecords[0].id, mergedEmployeeUpdates);
      }
    }

    return Response.json({ success: true, user: updatedUser, employee: updatedEmployee });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});