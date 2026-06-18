import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, FileText, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

const SCORE_COLOR = (score) => {
  if (score >= 8) return 'bg-green-100 text-green-800';
  if (score >= 6) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
};

function CandidateScoreCard({ candidate, requisition }) {
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const handleScore = async () => {
    setScoring(true);
    try {
      const prompt = `You are an expert HR recruiter. Analyze this candidate's profile against the job requirements and provide a structured evaluation.

JOB REQUIREMENTS:
- Position: ${requisition.position_title}
- Department: ${requisition.department}
- Experience Required: ${requisition.experience_required || 'Not specified'}
- Required Skills: ${Array.isArray(requisition.required_skills) ? requisition.required_skills.join(', ') : requisition.required_skills || 'Not specified'}
- Job Description: ${requisition.job_description || 'Not specified'}

CANDIDATE PROFILE:
- Name: ${candidate.full_name}
- Experience: ${candidate.experience_years} years
- Current Company: ${candidate.current_company || 'Not mentioned'}
- Expected CTC: ₹${candidate.expected_ctc?.toLocaleString() || 'Not mentioned'}
- Cover Letter: ${candidate.cover_letter || 'Not provided'}

${candidate.resume_url ? 'A resume/CV file is attached for analysis.' : 'No resume file provided.'}

Provide a thorough evaluation with:
1. A brief CV summary (2-3 sentences)
2. Key strengths (2-3 bullet points)
3. Potential gaps or concerns (1-2 bullet points)
4. Overall fit score from 1-10 with justification

Be concise and objective.`;

      const fileUrls = candidate.resume_url ? [candidate.resume_url] : undefined;

      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        file_urls: fileUrls,
        response_json_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            strengths: { type: 'array', items: { type: 'string' } },
            gaps: { type: 'array', items: { type: 'string' } },
            score: { type: 'number' },
            score_justification: { type: 'string' }
          }
        }
      });

      setResult(res);
      setExpanded(true);
    } catch (err) {
      toast.error('Failed to score CV: ' + err.message);
    }
    setScoring(false);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center font-semibold text-blue-600 text-sm">
            {candidate.full_name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-sm">{candidate.full_name}</p>
            <p className="text-xs text-gray-500">{candidate.experience_years} yrs exp · {candidate.current_company || 'N/A'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <Badge className={SCORE_COLOR(result.score)}>
              <Star className="w-3 h-3 mr-1" /> {result.score}/10
            </Badge>
          )}
          {!candidate.resume_url && (
            <span className="text-xs text-gray-400 italic">No resume uploaded</span>
          )}
          <Button size="sm" variant="outline" onClick={handleScore} disabled={scoring}>
            {scoring ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
            {result ? 'Re-score' : 'AI Score'}
          </Button>
          {result && (
            <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>

      {result && expanded && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Summary</p>
            <p className="text-gray-700">{result.summary}</p>
          </div>
          {result.strengths?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">Strengths</p>
              <ul className="space-y-1">
                {result.strengths.map((s, i) => (
                  <li key={i} className="text-gray-700 flex items-start gap-1"><span className="text-green-500 mt-0.5">✓</span>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {result.gaps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 mb-1">Gaps / Concerns</p>
              <ul className="space-y-1">
                {result.gaps.map((g, i) => (
                  <li key={i} className="text-gray-700 flex items-start gap-1"><span className="text-red-400 mt-0.5">!</span>{g}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="border-t pt-2">
            <p className="text-xs font-semibold text-gray-600 mb-1">Score Justification</p>
            <p className="text-gray-700">{result.score_justification}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CvScoringPanel({ requisition }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!requisition?.id) return;
    base44.entities.Candidate.filter({ job_requisition_id: requisition.id })
      .then(data => { setCandidates(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [requisition?.id]);

  if (loading) return (
    <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading candidates...
    </div>
  );

  if (candidates.length === 0) return (
    <div className="text-center text-gray-400 py-6 text-sm">
      <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
      No candidates have applied for this position yet.
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-500" />
        <p className="text-sm font-semibold text-gray-700">{candidates.length} Candidate(s) — Click "AI Score" to analyse each CV</p>
      </div>
      {candidates.map(c => (
        <CandidateScoreCard key={c.id} candidate={c} requisition={requisition} />
      ))}
    </div>
  );
}