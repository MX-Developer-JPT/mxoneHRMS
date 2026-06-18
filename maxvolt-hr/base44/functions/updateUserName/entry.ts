import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const first_name = (body.first_name || '').trim();
    const middle_name = (body.middle_name || '').trim();
    const last_name = (body.last_name || '').trim();

    if (!first_name) {
      return Response.json({ error: 'first_name is required' }, { status: 400 });
    }

    // Build full display name from name parts
    const display_name = [first_name, middle_name, last_name].filter(Boolean).join(' ');

    const updated = await base44.asServiceRole.entities.User.update(user.id, {
      first_name,
      middle_name,
      last_name,
      display_name
    });

    return Response.json({ success: true, user: updated });
  } catch (error) {
    console.error('updateUserName error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});