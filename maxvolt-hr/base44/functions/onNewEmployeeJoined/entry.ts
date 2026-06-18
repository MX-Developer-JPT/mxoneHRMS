import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const { data: employee, event } = payload;
    if (!employee || !employee.user_id) {
      return Response.json({ skipped: true });
    }

    // Fetch the user to get full name
    const users = await base44.asServiceRole.entities.User.list();
    const user = users.find(u => u.id === employee.user_id);
    const fullName = user?.full_name || 'New Employee';

    // Generate a greeting using LLM
    const greetingRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `Write a warm, friendly welcome message for a new employee joining a company.
Employee Name: ${fullName}
Designation: ${employee.designation || 'Team Member'}
Department: ${employee.department || 'the company'}
Keep it short (2-3 sentences), enthusiastic and professional. Do not use markdown.`
    });

    const greeting = typeof greetingRes === 'string' ? greetingRes : greetingRes?.text || `Welcome aboard, ${fullName}! We're thrilled to have you join the ${employee.department || 'team'} as ${employee.designation || 'a new team member'}. Wishing you a fantastic journey ahead!`;

    // Create the announcement
    await base44.asServiceRole.entities.NewJoinerAnnouncement.create({
      employee_id: employee.id || '',
      user_id: employee.user_id,
      employee_full_name: fullName,
      employee_designation: employee.designation || '',
      employee_department: employee.department || '',
      date_of_joining: employee.date_of_joining || '',
      greeting_message: greeting,
      profile_picture_url: employee.profile_picture_url || ''
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});