import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Sparkles, CheckCircle2, XCircle, PlusCircle, ChevronDown, ChevronUp, FileText, FileWarning } from 'lucide-react';
import { useState } from 'react';

const SCORE_COLOR = (score) => {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  return 'text-red-600';
};

const SCORE_BG = (score) => {
  if (score >= 75) return 'bg-green-100 text-green-800';
  if (score >= 50) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
};

const RECO_COLOR = (rec) => {
  if (!rec) return 'bg-gray-100 text-gray-700';
  const r = rec.toLowerCase();
  if (r.includes('strongly')) return 'bg-green-100 text-green-800 border-green-300';
  if (r.includes('recommend') && !r.includes('not')) return 'bg-blue-100 text-blue-800 border-blue-300';
  if (r.includes('maybe')) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  return 'bg-red-100 text-red-800 border-red-300';
};

const ScoreBar = ({ label, score, weight }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="text-gray-500 w-28 flex-shrink-0">{label} <span className="text-gray-400">({weight}%)</span></span>
    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full ${score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-400'}`}
        style={{ width: `${score}%` }}
      />
    </div>
    <span className={`font-semibold w-8 text-right ${SCORE_COLOR(score)}`}>{score}</span>
  </div>
);

export default function CandidateScoreCard({ scoreData, jobTitle }) {
  const [expanded, setExpanded] = useState(false);

  if (!scoreData) return null;

  return (
    <div className="mt-2 border border-indigo-100 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-indigo-50 to-purple-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-xs font-semibold text-indigo-700">JD Match Score</span>
          {jobTitle && <span className="text-xs text-gray-500">— {jobTitle}</span>}
          <span className={`text-sm font-bold ${SCORE_COLOR(scoreData.overall_score)}`}>
            {scoreData.overall_score}/100
          </span>
          <Badge className={`text-xs border ${RECO_COLOR(scoreData.recommendation)}`}>
            {scoreData.recommendation}
          </Badge>
          {scoreData.resume_grounded ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5" title="This score was generated from the candidate's actual resume text">
              <FileText className="w-3 h-3" /> Read from resume
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5" title="No readable resume file was found — this score is based on the application form only">
              <FileWarning className="w-3 h-3" /> Form only — no CV read
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </div>

      {expanded && (
        <div className="px-3 py-3 space-y-3 text-sm">
          {/* Summary */}
          {scoreData.summary && (
            <p className="text-xs text-gray-600 italic">{scoreData.summary}</p>
          )}

          {/* Score Breakdown */}
          {Array.isArray(scoreData.criteria) && scoreData.criteria.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score breakdown</p>
                <span className="text-[10px] text-gray-400">calculated from the CV and the requisition — {scoreData.method === 'rules+ai' ? 'AI wrote the notes' : 'no AI used'}{scoreData.confidence ? ` · confidence ${scoreData.confidence}` : ''}</span>
              </div>
              {scoreData.criteria.map((c) => (
                <div key={c.key}>
                  <ScoreBar label={c.label} score={c.score} weight={c.weight} />
                  <p className="text-[11px] text-gray-500 pl-[7.5rem]">{c.detail}</p>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">Facts the CV or form did not state are left out and the other weights share the total — they are never scored as zero.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score Breakdown</p>
              <ScoreBar label="Skills Match" score={scoreData.skills_score ?? 0} weight={35} />
              <ScoreBar label="Experience" score={scoreData.experience_score} weight={25} />
              <ScoreBar label="Salary Fit" score={scoreData.salary_score} weight={15} />
              <ScoreBar label="Notice Period" score={scoreData.notice_score} weight={10} />
              <ScoreBar label="Education" score={scoreData.education_score} weight={15} />
            </div>
          )}
          {scoreData.knockouts?.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              <p className="font-semibold">Knock-out criteria not met (score capped at 49)</p>
              <ul className="list-disc pl-4">{scoreData.knockouts.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          )}
          {scoreData.cv_flags?.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <ul className="list-disc pl-4">{scoreData.cv_flags.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          )}

          {/* Skills */}
          <div className="grid grid-cols-1 gap-2">
            {scoreData.matched_skills?.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-xs font-semibold text-green-700 mb-1">
                  <CheckCircle2 className="w-3 h-3" /> Matched Skills
                </div>
                <div className="flex flex-wrap gap-1">
                  {scoreData.matched_skills.map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {scoreData.missing_skills?.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-xs font-semibold text-red-600 mb-1">
                  <XCircle className="w-3 h-3" /> Missing Skills
                </div>
                <div className="flex flex-wrap gap-1">
                  {scoreData.missing_skills.map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded-full">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {scoreData.bonus_skills?.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-xs font-semibold text-blue-600 mb-1">
                  <PlusCircle className="w-3 h-3" /> Bonus Skills
                </div>
                <div className="flex flex-wrap gap-1">
                  {scoreData.bonus_skills.map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Strengths & Gaps */}
          <div className="grid grid-cols-2 gap-3">
            {scoreData.strengths?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">Strengths</p>
                <ul className="space-y-0.5">
                  {scoreData.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-gray-700 flex gap-1"><span className="text-green-500">✓</span>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {scoreData.gaps?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-600 mb-1">Gaps</p>
                <ul className="space-y-0.5">
                  {scoreData.gaps.map((g, i) => (
                    <li key={i} className="text-xs text-gray-700 flex gap-1"><span className="text-red-400">!</span>{g}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {scoreData.interview_questions?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-indigo-700 mb-1">Suggested interview questions</p>
              <ol className="list-decimal pl-4 space-y-0.5">{scoreData.interview_questions.map((q, i) => <li key={i} className="text-xs text-gray-700">{q}</li>)}</ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}