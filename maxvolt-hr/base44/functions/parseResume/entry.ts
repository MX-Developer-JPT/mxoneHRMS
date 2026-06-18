import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SKILL_SYNONYMS = {
  'reactjs': 'React', 'react.js': 'React', 'react js': 'React',
  'vuejs': 'Vue.js', 'vue js': 'Vue.js',
  'nodejs': 'Node.js', 'node js': 'Node.js',
  'javascript': 'JavaScript', 'js': 'JavaScript',
  'typescript': 'TypeScript', 'ts': 'TypeScript',
  'python3': 'Python', 'py': 'Python',
  'postgresql': 'PostgreSQL', 'postgres': 'PostgreSQL',
  'mongodb': 'MongoDB', 'mongo': 'MongoDB',
  'aws': 'AWS', 'amazon web services': 'AWS',
  'gcp': 'GCP', 'google cloud': 'GCP',
  'microsoft azure': 'Azure', 'ms azure': 'Azure',
  'ml': 'Machine Learning', 'ai': 'Artificial Intelligence',
  'nlp': 'NLP', 'natural language processing': 'NLP',
  'ci/cd': 'CI/CD', 'cicd': 'CI/CD',
  'digital mktg': 'Digital Marketing', 'performance mktg': 'Performance Marketing',
  'seo specialist': 'SEO', 'search engine optimization': 'SEO',
  'sem': 'SEM', 'search engine marketing': 'SEM',
  'hr': 'Human Resources', 'human resource': 'Human Resources',
  'ta': 'Talent Acquisition',
};

function normalizeSkills(skills) {
  if (!Array.isArray(skills)) return [];
  const seen = new Set();
  return skills
    .map(s => {
      if (!s) return null;
      const lower = s.toLowerCase().trim();
      const normalized = SKILL_SYNONYMS[lower] || s.trim();
      return normalized;
    })
    .filter(s => {
      if (!s) return false;
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function calcProfileCompleteness(parsed) {
  let score = 0;
  if (parsed.full_name) score += 10;
  if (parsed.email) score += 5;
  if (parsed.phone) score += 5;
  if (parsed.resume_headline) score += 10;
  if (parsed.professional_summary) score += 10;
  if (parsed.primary_skills?.length > 0) score += 15;
  if (parsed.total_experience_years > 0) score += 10;
  if (parsed.current_designation) score += 10;
  if (parsed.degree) score += 10;
  if (parsed.certifications?.length > 0) score += 5;
  if (parsed.portfolio_url || parsed.github_url || parsed.linkedin_url) score += 5;
  if (parsed.projects?.length > 0) score += 5;
  return Math.min(score, 100);
}

function calcAtsScore(parsed, atsIssues) {
  let score = 100;
  for (const issue of atsIssues) {
    if (issue.includes('column')) score -= 20;
    else if (issue.includes('image')) score -= 25;
    else if (issue.includes('graphic') || issue.includes('table')) score -= 15;
    else if (issue.includes('heading')) score -= 10;
    else if (issue.includes('formatting')) score -= 10;
    else score -= 5;
  }
  return Math.max(score, 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { candidate_id, resume_url, auto_triggered } = await req.json();

    if (!candidate_id || !resume_url) {
      return Response.json({ error: 'candidate_id and resume_url are required' }, { status: 400 });
    }

    // Mark candidate as parse triggered
    await base44.asServiceRole.entities.Candidate.update(candidate_id, {
      parse_triggered_at: new Date().toISOString()
    });

    // Create a ParsedResume record in processing state
    const parsedRecord = await base44.asServiceRole.entities.ParsedResume.create({
      candidate_id,
      resume_url,
      parse_status: 'processing'
    });

    // Step 1: Extract raw text from the resume file
    let rawText = '';
    try {
      const extracted = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: resume_url,
        json_schema: {
          type: 'object',
          properties: {
            full_text: { type: 'string', description: 'All text content extracted from the resume document' }
          }
        }
      });
      rawText = extracted?.output?.full_text || JSON.stringify(extracted?.output || '');
    } catch (e) {
      await base44.asServiceRole.entities.ParsedResume.update(parsedRecord.id, {
        parse_status: 'failed',
        parse_error: 'Could not extract text from resume: ' + e.message
      });
      return Response.json({ error: 'Text extraction failed', details: e.message }, { status: 500 });
    }

    // Step 2: Use LLM to parse structured data from the raw text
    const parsed = await base44.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      prompt: `You are an expert resume parser. Extract all structured information from the following resume text. 
      
Be intelligent about:
- Normalizing abbreviations (JS → JavaScript, ReactJS → React, HR → Human Resources)
- Detecting semantic equivalents ("Digital Marketing" = "Performance Marketing", "SEO Specialist" = "Search Engine Optimization")  
- Resolving synonyms in skill names and job titles
- Avoiding duplicate skills (list each skill only once)
- Distinguishing primary skills (core competencies directly used in main roles) from secondary/supporting skills
- Estimating total and relevant experience years accurately from the work history
- Identifying ATS issues like multi-column layouts, tables, text in images, heavy graphics, missing section headings

Resume Text:
---
${rawText.slice(0, 12000)}
---

Return a comprehensive JSON object with all extracted information.`,
      response_json_schema: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          current_location: { type: 'string' },
          preferred_location: { type: 'string' },
          resume_headline: { type: 'string', description: 'A one-line professional headline' },
          professional_summary: { type: 'string' },
          current_designation: { type: 'string' },
          previous_designations: { type: 'array', items: { type: 'string' } },
          total_experience_years: { type: 'number' },
          relevant_experience_years: { type: 'number' },
          current_company: { type: 'string' },
          previous_companies: { type: 'array', items: { type: 'string' } },
          current_salary: { type: 'number', description: 'Annual CTC in INR if mentioned, else 0' },
          expected_salary: { type: 'number', description: 'Expected annual CTC in INR if mentioned, else 0' },
          notice_period_days: { type: 'number', description: 'Notice period in days, 0 if immediate joiner' },
          employment_type: { type: 'string', description: 'full_time, part_time, contract, intern, or freelance' },
          primary_skills: { type: 'array', items: { type: 'string' }, description: 'Core skills directly used in main roles' },
          secondary_skills: { type: 'array', items: { type: 'string' }, description: 'Supporting or supplementary skills' },
          tools_and_platforms: { type: 'array', items: { type: 'string' }, description: 'Tools, software, platforms used' },
          certifications: { type: 'array', items: { type: 'string' } },
          industry_keywords: { type: 'array', items: { type: 'string' }, description: 'Industry-specific keywords and domain terms' },
          degree: { type: 'string' },
          specialization: { type: 'string' },
          university: { type: 'string' },
          passing_year: { type: 'number' },
          gpa_percentage: { type: 'string' },
          projects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                technologies: { type: 'string' }
              }
            }
          },
          achievements: { type: 'array', items: { type: 'string' } },
          languages: { type: 'array', items: { type: 'string' } },
          portfolio_url: { type: 'string' },
          github_url: { type: 'string' },
          linkedin_url: { type: 'string' },
          ats_issues: { type: 'array', items: { type: 'string' }, description: 'List of ATS-unfriendly issues found in the resume format' },
          keyword_density_flag: { type: 'boolean', description: 'True if suspicious keyword stuffing is detected' }
        }
      }
    });

    // Step 3: Normalize skills
    parsed.primary_skills = normalizeSkills(parsed.primary_skills);
    parsed.secondary_skills = normalizeSkills(parsed.secondary_skills);
    parsed.tools_and_platforms = normalizeSkills(parsed.tools_and_platforms);

    // Step 4: Calculate scores
    const profileCompleteness = calcProfileCompleteness(parsed);
    const atsScore = calcAtsScore(parsed, parsed.ats_issues || []);

    // Step 5: Update the ParsedResume record
    const updateData = {
      ...parsed,
      raw_text: rawText.slice(0, 10000),
      parse_status: 'completed',
      profile_completeness_score: profileCompleteness,
      ats_score: atsScore
    };

    await base44.asServiceRole.entities.ParsedResume.update(parsedRecord.id, updateData);

    // Step 6: Update Candidate record with parsed key fields
    const candidateUpdate = {
      resume_parsed: true,
      parsed_resume_id: parsedRecord.id
    };

    // Backfill candidate fields if they are empty from parsed data
    if (parsed.current_company) candidateUpdate.current_company = parsed.current_company;
    if (parsed.total_experience_years) candidateUpdate.experience_years = parsed.total_experience_years;
    if (parsed.notice_period_days !== undefined) candidateUpdate.notice_period = parsed.notice_period_days;
    if (parsed.current_salary) candidateUpdate.current_ctc = parsed.current_salary;
    if (parsed.expected_salary) candidateUpdate.expected_ctc = parsed.expected_salary;

    await base44.asServiceRole.entities.Candidate.update(candidate_id, candidateUpdate);

    return Response.json({
      success: true,
      parsed_resume_id: parsedRecord.id,
      profile_completeness: profileCompleteness,
      ats_score: atsScore,
      skills_extracted: (parsed.primary_skills?.length || 0) + (parsed.secondary_skills?.length || 0),
      summary: parsed.professional_summary?.slice(0, 200)
    });

  } catch (error) {
    console.error('parseResume error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});