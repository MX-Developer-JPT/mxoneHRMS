import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// This function is triggered by an entity automation when a TrainingSession is created
// or when a TrainingProgram is published.
// Payload: { event, data, old_data }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const { event, data } = payload;

    // data is the TrainingSession or TrainingProgram record
    if (!data) {
      return Response.json({ message: 'No data, skipping' });
    }

    const programId = data.training_program_id || data.id;

    // Load the training program
    let program = null;
    if (data.training_program_id) {
      // It's a session — load the program
      const programs = await base44.asServiceRole.entities.TrainingProgram.filter({ id: data.training_program_id });
      program = programs[0];
    } else {
      // It IS the program (published event)
      program = data;
    }

    if (!program) {
      return Response.json({ message: 'Program not found, skipping' });
    }

    const targetDepartment = program.department;

    // Fetch all employees
    const employees = await base44.asServiceRole.entities.Employee.list('-created_date', 500);

    // Filter employees relevant to this training
    let targetEmployees = employees;
    if (targetDepartment) {
      targetEmployees = employees.filter(emp => emp.department === targetDepartment);
    }

    if (targetEmployees.length === 0) {
      return Response.json({ message: 'No matching employees found' });
    }

    // Build notifications
    const isSession = !!data.training_program_id;
    const title = isSession
      ? `New Training Session Scheduled: ${program.title}`
      : `Training Program Available: ${program.title}`;

    const message = isSession
      ? `A new session for "${program.title}" has been scheduled${data.start_date ? ` on ${new Date(data.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}. ${data.location ? `Location: ${data.location}.` : ''} ${data.meeting_link ? `Join: ${data.meeting_link}` : ''}`
      : `A new training program "${program.title}" has been published${targetDepartment ? ` for the ${targetDepartment} department` : ''}. Objective: ${program.objective}`;

    const notifications = targetEmployees.map(emp => ({
      user_id: emp.user_id,
      training_program_id: program.id,
      training_session_id: isSession ? data.id : undefined,
      title,
      message,
      type: isSession ? 'session_scheduled' : 'program_published',
      is_read: false,
    }));

    // Bulk create notifications
    await base44.asServiceRole.entities.TrainingNotification.bulkCreate(notifications);

    return Response.json({ success: true, notified: notifications.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});