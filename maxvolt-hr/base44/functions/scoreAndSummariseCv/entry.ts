import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      candidate_id, resume_url, position_applied, department,
      experience_years, current_company, current_ctc, expected_ctc,
      notice_period, source
    } = await req.json();

    if (!resume_url) {
      return Response.json({ error: 'resume_url is required' }, { status: 400 });
    }

    // Extract text from resume
    const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
      file_url: resume_url,
      json_schema: {
        type: 'object',
        properties: {
          full_text: { type: 'string', description: 'All text content from the CV/resume' }
        }
      }
    });

    const cvText = extracted?.output?.full_text || JSON.stringify(extracted?.output || 'Could not extract text');

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a senior HR recruiter at Maxvolt Energy Industries. Analyze the following CV/resume for the position of "${position_applied || 'the applied role'}"${department ? ` in the ${department} department` : ''}.

CANDIDATE DETAILS:
- Experience Claimed: ${experience_years || 0} years
- Current Company: ${current_company || 'Not specified'}
- Current CTC: ${current_ctc ? '₹' + Number(current_ctc).toLocaleString() : 'Not specified'}
- Expected CTC: ${expected_ctc ? '₹' + Number(expected_ctc).toLocaleString() : 'Not specified'}
- Notice Period: ${notice_period || 0} days
- Source: ${source || 'Not specified'}

CV CONTENT:
${cvText.slice(0, 10000)}

Provide your analysis as a JSON object with exactly these fields:
- score: integer from 0 to 100 based on fit for the role
- summary: 2-3 sentence professional summary of the candidate
- strengths: array of 3-4 specific strengths observed from the CV
- concerns: array of 2-3 concerns or gaps observed from the CV
- recommendation: one of exactly these values: "Strongly Recommend", "Recommend", "Maybe", "Not Recommended"

Be specific and accurate. Base your score on skills, experience relevance, and overall fit.`,
      model: 'claude_sonnet_4_6',
      response_json_schema: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          summary: { type: 'string' },
          strengths: { type: 'array', items: { type: 'string' } },
          concerns: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' }
        },
        required: ['score', 'summary', 'strengths', 'concerns', 'recommendation']
      }
    });

    return Response.json({ success: true, result });

  } catch (error) {
    console.error('scoreAndSummariseCv error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});