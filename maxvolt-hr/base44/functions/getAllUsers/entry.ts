import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Allow HR, admin, and management roles to fetch all users
    const userRole = user.custom_role || user.role;
    if (!['hr', 'admin', 'management', 'gate_admin'].includes(userRole)) {
      return Response.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    // Use service role to fetch all users
    const users = await base44.asServiceRole.entities.User.list();

    return Response.json({ 
      success: true, 
      users 
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});