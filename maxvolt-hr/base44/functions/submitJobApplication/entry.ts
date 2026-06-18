import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { candidateData, jobId, jobTitle, jobDepartment, currentCandidatesCount } = await req.json();

    if (!candidateData || !jobId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Use service role so unauthenticated (public) users can submit applications
    const candidate = await base44.asServiceRole.entities.Candidate.create({
      ...candidateData,
      position_applied: jobTitle || '',
      department: jobDepartment || '',
      job_requisition_id: jobId,
      status: 'applied'
    });

    // Increment candidates_count
    await base44.asServiceRole.entities.JobRequisition.update(jobId, {
      candidates_count: (currentCandidatesCount || 0) + 1
    });

    return Response.json({ success: true, candidate });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});