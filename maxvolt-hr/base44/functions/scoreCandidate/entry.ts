import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { candidate_id, job_requisition_id } = await req.json();
    if (!candidate_id || !job_requisition_id) {
      return Response.json({ error: 'candidate_id and job_requisition_id are required' }, { status: 400 });
    }

    // Load candidate + JD using get() by id
    const [candidate, jd] = await Promise.all([
      base44.asServiceRole.entities.Candidate.get(candidate_id),
      base44.asServiceRole.entities.JobRequisition.get(job_requisition_id),
    ]);

    if (!candidate) return Response.json({ error: 'Candidate not found' }, { status: 404 });
    if (!jd) return Response.json({ error: 'Job Requisition not found' }, { status: 404 });

    // Load parsed resume if available
    let parsedResume = null;
    if (candidate.parsed_resume_id) {
      const pr = await base44.asServiceRole.entities.ParsedResume.filter({ candidate_id });
      if (pr.length > 0 && pr[0].parse_status === 'completed') {
        parsedResume = pr[0];
      }
    }

    // Build rich candidate profile for LLM
    const candidateProfile = parsedResume ? `
CANDIDATE (from AI-parsed resume):
- Name: ${parsedResume.full_name || candidate.full_name}
- Total Experience: ${parsedResume.total_experience_years ?? candidate.experience_years} years
- Relevant Experience: ${parsedResume.relevant_experience_years ?? 'N/A'} years
- Current Role: ${parsedResume.current_designation || 'N/A'} at ${parsedResume.current_company || candidate.current_company || 'N/A'}
- Previous Companies: ${parsedResume.previous_companies?.join(', ') || 'N/A'}
- Past Roles: ${parsedResume.previous_designations?.join(', ') || 'N/A'}
- Primary Skills: ${parsedResume.primary_skills?.join(', ') || 'N/A'}
- Secondary Skills: ${parsedResume.secondary_skills?.join(', ') || 'N/A'}
- Tools & Platforms: ${parsedResume.tools_and_platforms?.join(', ') || 'N/A'}
- Certifications: ${parsedResume.certifications?.join(', ') || 'N/A'}
- Education: ${parsedResume.degree || 'N/A'}${parsedResume.specialization ? ' in ' + parsedResume.specialization : ''} from ${parsedResume.university || 'N/A'}
- Current Salary: ${parsedResume.current_salary ? '₹' + parsedResume.current_salary.toLocaleString() : (candidate.current_ctc ? '₹' + Number(candidate.current_ctc).toLocaleString() : 'N/A')}
- Expected Salary: ${parsedResume.expected_salary ? '₹' + parsedResume.expected_salary.toLocaleString() : (candidate.expected_ctc ? '₹' + Number(candidate.expected_ctc).toLocaleString() : 'N/A')}
- Notice Period: ${parsedResume.notice_period_days != null ? parsedResume.notice_period_days + ' days' : (candidate.notice_period ? candidate.notice_period + ' days' : 'N/A')}
- Location: ${parsedResume.current_location || 'N/A'} (Preferred: ${parsedResume.preferred_location || 'N/A'})
- Achievements: ${parsedResume.achievements?.slice(0, 3).join('; ') || 'N/A'}
- Industry Keywords: ${parsedResume.industry_keywords?.join(', ') || 'N/A'}
` : `
CANDIDATE (from application form):
- Name: ${candidate.full_name}
- Experience: ${candidate.experience_years} years
- Current Company: ${candidate.current_company || 'N/A'}
- Current Salary: ${candidate.current_ctc ? '₹' + Number(candidate.current_ctc).toLocaleString() : 'N/A'}
- Expected Salary: ${candidate.expected_ctc ? '₹' + Number(candidate.expected_ctc).toLocaleString() : 'N/A'}
- Notice Period: ${candidate.notice_period ? candidate.notice_period + ' days' : 'N/A'}
- Source: ${candidate.source || 'N/A'}
- Cover Letter: ${candidate.cover_letter || 'None'}
NOTE: Resume has not been AI-parsed yet. Score based on available data only.
`;

    const jdProfile = `
JOB REQUISITION:
- Position: ${jd.position_title}
- Department: ${jd.department}
- Employment Type: ${jd.employment_type || 'full_time'}
- Required Skills: ${jd.required_skills?.join(', ') || 'Not specified'}
- Experience Required: ${jd.experience_required || 'Not specified'}
- Salary Range: ${jd.salary_range_min ? '₹' + Number(jd.salary_range_min).toLocaleString() : 'N/A'} – ${jd.salary_range_max ? '₹' + Number(jd.salary_range_max).toLocaleString() : 'N/A'}
- Location: ${jd.location || 'N/A'}
- Job Description: ${jd.job_description?.substring(0, 1500) || 'N/A'}
`;

    const prompt = `You are a senior technical recruiter. Score this candidate against the job requisition using weighted multi-factor analysis.

${jdProfile}

${candidateProfile}

SCORING WEIGHTS:
- Skills Match: 35% (how well candidate's skills match required + JD skills)
- Experience Fit: 25% (experience years vs required, role relevance)
- Salary Fit: 15% (expected CTC vs JD salary range; if salary range not provided, give 70/100)
- Notice Period: 10% (immediacy: <30 days = 100, 30-60 = 75, 60-90 = 50, >90 = 25; if not specified, give 50/100)
- Education Fit: 15% (degree/field relevance to the role; if not specified, infer from experience)

IMPORTANT: Even if some data is missing, provide the best estimate based on available information. Do NOT return null or empty values.

Provide a detailed scoring JSON with exactly these fields:
- overall_score: weighted total 0-100 (integer)
- skills_score: 0-100 (integer)
- experience_score: 0-100 (integer)
- salary_score: 0-100 (integer)
- notice_score: 0-100 (integer)
- education_score: 0-100 (integer)
- matched_skills: array of strings (skills from JD requirements that candidate clearly has; empty array if none)
- missing_skills: array of strings (required skills candidate seems to lack; empty array if none)
- bonus_skills: array of strings (additional relevant skills candidate has; empty array if none)
- recommendation: exactly one of "Strongly Recommend", "Recommend", "Maybe", "Not Recommended"
- summary: 2-3 sentence professional assessment of this candidate for this specific role
- strengths: array of 3 specific strengths relevant to this role
- gaps: array of 2 specific gaps or concerns for this role

Be objective and precise. Base scores on actual data, not assumptions.`;

    const fileUrls = candidate.resume_url ? [candidate.resume_url] : undefined;

    const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: 'claude_sonnet_4_6',
      file_urls: fileUrls,
      response_json_schema: {
        type: 'object',
        properties: {
          overall_score: { type: 'number' },
          skills_score: { type: 'number' },
          experience_score: { type: 'number' },
          salary_score: { type: 'number' },
          notice_score: { type: 'number' },
          education_score: { type: 'number' },
          matched_skills: { type: 'array', items: { type: 'string' } },
          missing_skills: { type: 'array', items: { type: 'string' } },
          bonus_skills: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          summary: { type: 'string' },
          strengths: { type: 'array', items: { type: 'string' } },
          gaps: { type: 'array', items: { type: 'string' } }
        },
        required: ['overall_score', 'skills_score', 'experience_score', 'salary_score', 'notice_score', 'education_score', 'recommendation', 'summary']
      }
    });

    // InvokeLLM wraps the JSON schema response under a "response" key
    const result = llmResponse.response || llmResponse;

    // Upsert CandidateScore record
    const existingScores = await base44.asServiceRole.entities.CandidateScore.filter({
      candidate_id,
      job_requisition_id
    }, '-scored_at', 5);

    const scoreData = {
      candidate_id,
      job_requisition_id,
      overall_score: result.overall_score,
      skills_score: result.skills_score,
      experience_score: result.experience_score,
      salary_score: result.salary_score,
      notice_score: result.notice_score,
      education_score: result.education_score,
      matched_skills: result.matched_skills || [],
      missing_skills: result.missing_skills || [],
      bonus_skills: result.bonus_skills || [],
      recommendation: result.recommendation,
      summary: result.summary,
      strengths: result.strengths || [],
      gaps: result.gaps || [],
      scored_at: new Date().toISOString()
    };

    let scoreRecord;
    if (existingScores.length > 0) {
      scoreRecord = await base44.asServiceRole.entities.CandidateScore.update(existingScores[0].id, scoreData);
    } else {
      scoreRecord = await base44.asServiceRole.entities.CandidateScore.create(scoreData);
    }

    return Response.json({
      success: true,
      score_id: scoreRecord.id,
      overall_score: result.overall_score,
      recommendation: result.recommendation,
      data: scoreRecord
    });

  } catch (error) {
    console.error('scoreCandidate error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});