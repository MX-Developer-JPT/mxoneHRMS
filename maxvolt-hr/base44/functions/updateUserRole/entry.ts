import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate caller
    const caller = await base44.auth.me();
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const callerRole = caller.custom_role || caller.role;
    if (!['admin', 'hr'].includes(callerRole)) {
      return Response.json({ error: 'Forbidden: Only HR or Admin can update roles' }, { status: 403 });
    }

    const { userId, newRole } = await req.json();

    if (!userId || !newRole) {
      return Response.json({ error: 'userId and newRole are required' }, { status: 400 });
    }

    // Only admin can assign admin role
    if (newRole === 'admin' && callerRole !== 'admin') {
      return Response.json({ error: 'Forbidden: Only Admin can assign admin role' }, { status: 403 });
    }

    const updatedUser = await base44.asServiceRole.entities.User.update(userId, { custom_role: newRole, role: newRole });

    return Response.json({ success: true, user: updatedUser });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});