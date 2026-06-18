import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, FileText, MapPin, Briefcase, GraduationCap, Wrench, Award, Link2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const COMPLETENESS_COLOR = (score) => {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
};

const ATS_COLOR = (score) => {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
};

function SkillPill({ label, variant = 'primary' }) {
  const cls = variant === 'primary'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : variant === 'secondary'
    ? 'bg-gray-100 text-gray-700 border-gray-200'
    : 'bg-purple-100 text-purple-800 border-purple-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

function SectionBlock({ icon: Icon, title, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

export default function ResumeParsePanel({ candidate, onParsed }) {
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (candidate?.parsed_resume_id) {
      loadParsedData(candidate.parsed_resume_id);
    }
  }, [candidate?.parsed_resume_id]);

  const loadParsedData = async (id) => {
    setLoading(true);
    try {
      const records = await base44.entities.ParsedResume.filter({ id });
      if (records.length > 0) {
        setParsedData(records[0]);
        setExpanded(true);
      }
    } catch (e) {
      console.error('Failed to load parsed resume:', e);
    }
    setLoading(false);
  };

  const handleParse = async () => {
    if (!candidate.resume_url) {
      toast.error('No resume uploaded for this candidate');
      return;
    }
    setParsing(true);
    try {
      const res = await base44.functions.invoke('parseResume', {
        candidate_id: candidate.id,
        resume_url: candidate.resume_url
      });
      if (res.data?.success) {
        toast.success(`Resume parsed! ${res.data.skills_extracted} skills extracted.`);
        await loadParsedData(res.data.parsed_resume_id);
        if (onParsed) onParsed(res.data);
      } else {
        toast.error('Parsing failed: ' + (res.data?.error || 'Unknown error'));
      }
    } catch (e) {
      toast.error('Failed to parse resume: ' + e.message);
    }
    setParsing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading parsed data...
      </div>
    );
  }

  const isParsed = parsedData && parsedData.parse_status === 'completed';
  const isFailed = parsedData && parsedData.parse_status === 'failed';

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">AI Resume Parser</span>
          {isParsed && (
            <Badge className="bg-green-100 text-green-700 text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Parsed
            </Badge>
          )}
          {isFailed && (
            <Badge className="bg-red-100 text-red-700 text-xs">
              <AlertCircle className="w-3 h-3 mr-1" /> Failed
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {candidate?.resume_url && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              onClick={handleParse} disabled={parsing}>
              {parsing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {isParsed ? 'Re-Parse' : 'Parse Resume'}
            </Button>
          )}
          {isParsed && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>

      {/* Scores row */}
      {isParsed && (
        <div className="grid grid-cols-2 divide-x bg-white border-b">
          <div className="px-4 py-2 text-center">
            <p className="text-xs text-gray-500">Profile Completeness</p>
            <p className={`text-xl font-bold ${COMPLETENESS_COLOR(parsedData.profile_completeness_score)}`}>
              {parsedData.profile_completeness_score}%
            </p>
          </div>
          <div className="px-4 py-2 text-center">
            <p className="text-xs text-gray-500">ATS Score</p>
            <p className={`text-xl font-bold ${ATS_COLOR(parsedData.ats_score)}`}>
              {parsedData.ats_score}/100
            </p>
          </div>
        </div>
      )}

      {/* Expanded parsed details */}
      {isParsed && expanded && (
        <div className="bg-white px-4 py-4 space-y-4 text-sm">

          {/* Headline & Summary */}
          {parsedData.resume_headline && (
            <div className="bg-indigo-50 rounded-lg px-3 py-2 text-indigo-800 font-medium text-sm">
              "{parsedData.resume_headline}"
            </div>
          )}
          {parsedData.professional_summary && (
            <p className="text-gray-600 text-xs leading-relaxed italic">{parsedData.professional_summary}</p>
          )}

          {/* Location & Personal */}
          {(parsedData.current_location || parsedData.preferred_location) && (
            <SectionBlock icon={MapPin} title="Location">
              <div className="flex gap-4 text-gray-700 text-xs">
                {parsedData.current_location && <span><span className="text-gray-400">Current:</span> {parsedData.current_location}</span>}
                {parsedData.preferred_location && <span><span className="text-gray-400">Preferred:</span> {parsedData.preferred_location}</span>}
              </div>
            </SectionBlock>
          )}

          {/* Experience */}
          <SectionBlock icon={Briefcase} title="Experience">
            <div className="space-y-1">
              <div className="flex gap-4 text-gray-700 text-xs">
                {parsedData.total_experience_years != null && (
                  <span><span className="text-gray-400">Total:</span> <strong>{parsedData.total_experience_years} yrs</strong></span>
                )}
                {parsedData.relevant_experience_years != null && (
                  <span><span className="text-gray-400">Relevant:</span> <strong>{parsedData.relevant_experience_years} yrs</strong></span>
                )}
                {parsedData.notice_period_days != null && (
                  <span><span className="text-gray-400">Notice:</span> <strong>{parsedData.notice_period_days === 0 ? 'Immediate' : parsedData.notice_period_days + ' days'}</strong></span>
                )}
              </div>
              {parsedData.current_designation && (
                <p className="text-gray-700 text-xs">
                  <span className="text-gray-400">Current Role:</span> {parsedData.current_designation}
                  {parsedData.current_company && <span> @ <strong>{parsedData.current_company}</strong></span>}
                </p>
              )}
              {parsedData.previous_companies?.length > 0 && (
                <p className="text-gray-500 text-xs">
                  <span className="text-gray-400">Previous:</span> {parsedData.previous_companies.join(' → ')}
                </p>
              )}
              {parsedData.previous_designations?.length > 0 && (
                <p className="text-gray-500 text-xs">
                  <span className="text-gray-400">Past Roles:</span> {parsedData.previous_designations.join(', ')}
                </p>
              )}
            </div>
          </SectionBlock>

          {/* Skills */}
          {(parsedData.primary_skills?.length > 0 || parsedData.secondary_skills?.length > 0 || parsedData.tools_and_platforms?.length > 0) && (
            <SectionBlock icon={Wrench} title="Skills & Tech Stack">
              <div className="space-y-2">
                {parsedData.primary_skills?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Primary</p>
                    <div className="flex flex-wrap gap-1">
                      {parsedData.primary_skills.map((s, i) => <SkillPill key={i} label={s} variant="primary" />)}
                    </div>
                  </div>
                )}
                {parsedData.secondary_skills?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Secondary</p>
                    <div className="flex flex-wrap gap-1">
                      {parsedData.secondary_skills.map((s, i) => <SkillPill key={i} label={s} variant="secondary" />)}
                    </div>
                  </div>
                )}
                {parsedData.tools_and_platforms?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Tools & Platforms</p>
                    <div className="flex flex-wrap gap-1">
                      {parsedData.tools_and_platforms.map((s, i) => <SkillPill key={i} label={s} variant="tool" />)}
                    </div>
                  </div>
                )}
                {parsedData.certifications?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Certifications</p>
                    <div className="flex flex-wrap gap-1">
                      {parsedData.certifications.map((c, i) => (
                        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 border border-yellow-200">
                          <Award className="w-2.5 h-2.5 mr-1" />{c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionBlock>
          )}

          {/* Education */}
          {(parsedData.degree || parsedData.university) && (
            <SectionBlock icon={GraduationCap} title="Education">
              <div className="text-gray-700 text-xs space-y-0.5">
                {parsedData.degree && <p><strong>{parsedData.degree}</strong>{parsedData.specialization && ` in ${parsedData.specialization}`}</p>}
                {parsedData.university && <p className="text-gray-500">{parsedData.university}{parsedData.passing_year && ` · ${parsedData.passing_year}`}</p>}
                {parsedData.gpa_percentage && <p className="text-gray-400">GPA/Marks: {parsedData.gpa_percentage}</p>}
              </div>
            </SectionBlock>
          )}

          {/* Projects */}
          {parsedData.projects?.length > 0 && (
            <SectionBlock icon={FileText} title={`Projects (${parsedData.projects.length})`}>
              <div className="space-y-1.5">
                {parsedData.projects.slice(0, 3).map((p, i) => (
                  <div key={i} className="bg-gray-50 rounded px-2 py-1.5 text-xs">
                    <p className="font-medium text-gray-800">{p.name}</p>
                    {p.description && <p className="text-gray-500 mt-0.5 line-clamp-2">{p.description}</p>}
                    {p.technologies && <p className="text-blue-600 mt-0.5">{p.technologies}</p>}
                  </div>
                ))}
              </div>
            </SectionBlock>
          )}

          {/* Achievements */}
          {parsedData.achievements?.length > 0 && (
            <SectionBlock icon={Award} title="Achievements">
              <ul className="space-y-0.5">
                {parsedData.achievements.slice(0, 4).map((a, i) => (
                  <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-yellow-500 mt-0.5">★</span>{a}</li>
                ))}
              </ul>
            </SectionBlock>
          )}

          {/* Links */}
          {(parsedData.linkedin_url || parsedData.github_url || parsedData.portfolio_url) && (
            <SectionBlock icon={Link2} title="Online Profiles">
              <div className="flex flex-wrap gap-2">
                {parsedData.linkedin_url && (
                  <a href={parsedData.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> LinkedIn
                  </a>
                )}
                {parsedData.github_url && (
                  <a href={parsedData.github_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-700 hover:underline flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> GitHub
                  </a>
                )}
                {parsedData.portfolio_url && (
                  <a href={parsedData.portfolio_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-purple-600 hover:underline flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> Portfolio
                  </a>
                )}
              </div>
            </SectionBlock>
          )}

          {/* ATS Issues */}
          {parsedData.ats_issues?.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-700 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" /> ATS Issues Detected
              </div>
              <ul className="space-y-1">
                {parsedData.ats_issues.map((issue, i) => (
                  <li key={i} className="text-xs text-orange-700 flex gap-1.5">
                    <span>•</span>{issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Keyword stuffing flag */}
          {parsedData.keyword_density_flag && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5" />
              <strong>Warning:</strong> Keyword stuffing detected in this resume.
            </div>
          )}
        </div>
      )}

      {/* Not yet parsed */}
      {!isParsed && !isFailed && !parsing && !candidate?.parsed_resume_id && candidate?.resume_url && (
        <div className="bg-white px-4 py-3 text-xs text-gray-500">
          Click "Parse Resume" to extract skills, experience, education, and more using AI.
        </div>
      )}

      {isFailed && (
        <div className="bg-white px-4 py-3 text-xs text-red-600">
          Parsing failed: {parsedData.parse_error}. You can retry parsing.
        </div>
      )}

      {!candidate?.resume_url && (
        <div className="bg-white px-4 py-3 text-xs text-gray-400 italic">
          No resume uploaded — parsing unavailable.
        </div>
      )}
    </div>
  );
}