import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      candidate_id,
      interview_id,
      scheduled_date,
      meeting_link,
      interview_mode,
      location,
      round_type,
      round_number,
      duration_minutes,
      interviewer_id
    } = await req.json();

    // Fetch candidate
    const candidates = await base44.asServiceRole.entities.Candidate.filter({ id: candidate_id });
    const candidate = candidates[0];
    if (!candidate) return Response.json({ error: 'Candidate not found' }, { status: 404 });

    // Fetch interviewer employee record for name/designation/department
    let interviewerName = 'To be confirmed';
    let interviewerDesignation = '';
    let interviewerDepartment = '';
    let interviewerEmail = '';

    if (interviewer_id) {
      const allUsersRes = await base44.asServiceRole.functions.invoke('getAllUsers', {});
      const allUsers = Array.isArray(allUsersRes?.data) ? allUsersRes.data : [];
      const interviewerUser = allUsers.find(u => u.id === interviewer_id);
      if (interviewerUser) {
        interviewerName = interviewerUser.full_name || interviewerUser.email;
        interviewerEmail = interviewerUser.email;
      }

      // Get employee record for designation & department
      const empRecords = await base44.asServiceRole.entities.Employee.filter({ user_id: interviewer_id });
      if (empRecords.length > 0) {
        const emp = empRecords[0];
        interviewerDesignation = emp.designation || '';
        interviewerDepartment = emp.department || '';
        if (emp.display_name) interviewerName = emp.display_name;
      }
    }

    const dateStr = new Date(scheduled_date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });

    const modeLabel = interview_mode === 'video' ? 'Video Call' : interview_mode === 'phone' ? 'Phone Call' : 'In Person';
    const roundLabel = round_type ? round_type.charAt(0).toUpperCase() + round_type.slice(1).replace('_', ' ') : 'Interview';

    // Email to candidate
    const candidateEmailBody = `
Dear ${candidate.full_name},

We are pleased to inform you that your interview for the position of <strong>${candidate.position_applied}</strong> at Maxvolt Energy Industries Limited has been scheduled.

<strong>Interview Details:</strong>
<ul>
  <li><strong>Round:</strong> Round ${round_number} – ${roundLabel}</li>
  <li><strong>Date & Time:</strong> ${dateStr} (IST)</li>
  <li><strong>Mode:</strong> ${modeLabel}</li>
  ${meeting_link ? `<li><strong>Meeting Link:</strong> <a href="${meeting_link}">${meeting_link}</a></li>` : ''}
  ${location && interview_mode === 'in_person' ? `<li><strong>Location:</strong> ${location}</li>` : ''}
  <li><strong>Duration:</strong> Approximately ${duration_minutes} minutes</li>
</ul>

<strong>Your Interviewer:</strong>
<ul>
  <li><strong>Name:</strong> ${interviewerName}</li>
  ${interviewerDesignation ? `<li><strong>Designation:</strong> ${interviewerDesignation}</li>` : ''}
  ${interviewerDepartment ? `<li><strong>Department:</strong> ${interviewerDepartment}</li>` : ''}
</ul>

Please ensure you are available at the scheduled time. If you have any queries or need to reschedule, please contact our HR team.

We look forward to speaking with you!

Best regards,
HR Team
Maxvolt Energy Industries Limited
    `.trim();

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: candidate.email,
      subject: `Interview Scheduled – ${candidate.position_applied} | Round ${round_number} | Maxvolt Energy`,
      body: candidateEmailBody
    });

    // Email to interviewer if email is available
    if (interviewerEmail) {
      const interviewerEmailBody = `
Dear ${interviewerName},

You have been assigned as the interviewer for the following scheduled interview.

<strong>Interview Details:</strong>
<ul>
  <li><strong>Candidate:</strong> ${candidate.full_name}</li>
  <li><strong>Position:</strong> ${candidate.position_applied}</li>
  <li><strong>Round:</strong> Round ${round_number} – ${roundLabel}</li>
  <li><strong>Date & Time:</strong> ${dateStr} (IST)</li>
  <li><strong>Mode:</strong> ${modeLabel}</li>
  ${meeting_link ? `<li><strong>Meeting Link:</strong> <a href="${meeting_link}">${meeting_link}</a></li>` : ''}
  ${location && interview_mode === 'in_person' ? `<li><strong>Location:</strong> ${location}</li>` : ''}
  <li><strong>Duration:</strong> Approximately ${duration_minutes} minutes</li>
</ul>

Please be prepared and reach out to HR if you have any questions.

Best regards,
HR Team
Maxvolt Energy Industries Limited
      `.trim();

      await base44.asServiceRole.integrations.Core.SendEmail({
        to: interviewerEmail,
        subject: `Interview Assignment – ${candidate.full_name} | ${candidate.position_applied} | Round ${round_number}`,
        body: interviewerEmailBody
      });
    }

    return Response.json({ success: true, candidate_email: candidate.email, interviewer_email: interviewerEmail });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});