import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { jobId } = await req.json();

    if (!jobId) {
      return Response.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Use service role so unauthenticated (public) users can fetch the job
    const jobs = await base44.asServiceRole.entities.JobRequisition.list();
    const job = jobs.find(j => j.id === jobId && j.status === 'published');

    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    return Response.json({ job });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});