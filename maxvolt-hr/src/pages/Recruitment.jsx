import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { Plus, UserPlus, Briefcase, Mail, Phone, Eye, Sparkles, Loader2, Star, ChevronDown, ChevronUp, SlidersHorizontal, X, BarChart2, ArrowUpDown } from 'lucide-react';
import CandidateDetailDialog from '../components/recruitment/CandidateDetailDialog';
import CandidateScoreCard from '../components/recruitment/CandidateScoreCard';

const STATUS_COLORS = {
  applied: 'bg-blue-100 text-blue-800',
  screening: 'bg-yellow-100 text-yellow-800',
  interview_scheduled: 'bg-purple-100 text-purple-800',
  interviewed: 'bg-orange-100 text-orange-800',
  selected: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  offered: 'bg-teal-100 text-teal-800',
  joined: 'bg-green-200 text-green-900'
};

const SCORE_COLOR = (score) => {
  if (score >= 8) return 'bg-green-100 text-green-700';
  if (score >= 6) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
};

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', position_applied: '', department: '',
  experience_years: '', current_company: '', current_ctc: '', expected_ctc: '',
  notice_period: '', source: 'job_portal'
};

function AiScoreSection({ candidate }) {
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const handleScore = async () => {
    setScoring(true);
    try {
      const prompt = `You are an expert HR recruiter. Analyse this candidate's profile and provide a structured evaluation.

CANDIDATE PROFILE:
- Name: ${candidate.full_name}
- Position Applied: ${candidate.position_applied}
- Department: ${candidate.department || 'N/A'}
- Experience: ${candidate.experience_years} years
- Current Company: ${candidate.current_company || 'Not mentioned'}
- Current CTC: ${candidate.current_ctc?.toLocaleString() || 'N/A'}
- Expected CTC: ${candidate.expected_ctc?.toLocaleString() || 'N/A'}
- Notice Period: ${candidate.notice_period ? candidate.notice_period + ' days' : 'N/A'}
- Source: ${candidate.source || 'N/A'}
- Cover Letter: ${candidate.cover_letter || 'Not provided'}
${candidate.resume_url ? '\nA resume/CV file is attached.' : ''}

Provide:
1. A 2-3 sentence CV summary
2. Key strengths (2-3 bullet points)
3. Gaps or concerns (1-2 bullet points)
4. Overall candidate score from 1-10 with justification`;

      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        file_urls: candidate.resume_url ? [candidate.resume_url] : undefined,
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
      toast.error('AI scoring failed: ' + err.message);
    }
    setScoring(false);
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        {result && (
          <Badge className={SCORE_COLOR(result.score)}>
            <Star className="w-3 h-3 mr-1" /> AI Score: {result.score}/10
          </Badge>
        )}
        <Button size="sm" variant="outline" onClick={handleScore} disabled={scoring} className="h-7 text-xs">
          {scoring ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1 text-purple-500" />}
          {result ? 'Re-analyse' : 'AI Score & Summarise'}
        </Button>
        {result && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        )}
      </div>
      {result && expanded && (
        <div className="mt-2 bg-purple-50 border border-purple-100 rounded-lg p-3 space-y-2 text-sm">
          <p className="text-gray-700 italic">{result.summary}</p>
          {result.strengths?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">Strengths</p>
              <ul className="space-y-0.5">
                {result.strengths.map((s, i) => <li key={i} className="text-gray-700 flex gap-1"><span className="text-green-500">✓</span>{s}</li>)}
              </ul>
            </div>
          )}
          {result.gaps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 mb-1">Gaps / Concerns</p>
              <ul className="space-y-0.5">
                {result.gaps.map((g, i) => <li key={i} className="text-gray-700 flex gap-1"><span className="text-red-400">!</span>{g}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-gray-500 border-t pt-2">{result.score_justification}</p>
        </div>
      )}
    </div>
  );
}

const DEFAULT_FILTERS = {
  search: '',
  status: 'all',
  source: 'all',
  minExp: 0,
  maxExp: 30,
  minCtc: '',
  maxCtc: '',
  skills: '',
  position: '',
};

const RECO_ORDER = { 'Strongly Recommend': 0, 'Recommend': 1, 'Maybe': 2, 'Not Recommended': 3 };

export default function Recruitment() {
  const [candidates, setCandidates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [formData, setFormData] = useState(EMPTY_FORM);

  // Stage 2: JD Scoring
  const [jobRequisitions, setJobRequisitions] = useState([]);
  const [selectedJdId, setSelectedJdId] = useState('');
  const [scores, setScores] = useState({}); // keyed by candidate_id
  const [scoringAll, setScoringAll] = useState(false);
  const [scoringIds, setScoringIds] = useState(new Set());
  const [sortByScore, setSortByScore] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [allCandidates, allJds] = await Promise.all([
        base44.entities.Candidate.list('-created_date', 500),
        base44.entities.JobRequisition.list('-created_date', 200),
      ]);
      setCandidates(allCandidates);
      setJobRequisitions(allJds);
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  };

  const loadScoresForJd = async (jdId) => {
    if (!jdId) { setScores({}); return; }
    try {
      const allScores = await base44.entities.CandidateScore.filter({ job_requisition_id: jdId });
      const scoreMap = {};
      allScores.forEach(s => { scoreMap[s.candidate_id] = s; });
      setScores(scoreMap);
    } catch (e) {
      console.error('Failed to load scores:', e);
    }
  };

  const handleJdChange = (jdId) => {
    setSelectedJdId(jdId);
    setSortByScore(false);
    loadScoresForJd(jdId);
  };

  const scoreSingleCandidate = async (candidateId) => {
    if (!selectedJdId) return;
    setScoringIds(prev => new Set([...prev, candidateId]));
    try {
      const res = await base44.functions.invoke('scoreCandidate', {
        candidate_id: candidateId,
        job_requisition_id: selectedJdId
      });
      if (res.data?.success) {
        setScores(prev => ({ ...prev, [candidateId]: res.data.data }));
      } else {
        toast.error('Scoring failed: ' + (res.data?.error || 'Unknown'));
      }
    } catch (e) {
      toast.error('Scoring error: ' + e.message);
    }
    setScoringIds(prev => { const n = new Set(prev); n.delete(candidateId); return n; });
  };

  const scoreAllFiltered = async () => {
    if (!selectedJdId) { toast.error('Please select a Job Requisition first'); return; }
    setScoringAll(true);
    const toScore = filtered.slice(0, 20); // cap at 20 to avoid rate limits
    toast.info(`Scoring ${toScore.length} candidates against selected JD...`);
    for (const c of toScore) {
      await scoreSingleCandidate(c.id);
    }
    setScoringAll(false);
    setSortByScore(true);
    toast.success('Scoring complete! Candidates sorted by match score.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.Candidate.create({
        ...formData,
        experience_years: parseFloat(formData.experience_years) || 0,
        current_ctc: parseFloat(formData.current_ctc) || 0,
        expected_ctc: parseFloat(formData.expected_ctc) || 0,
        notice_period: parseInt(formData.notice_period) || 0,
        status: 'applied'
      });
      toast.success('Candidate added successfully');
      setShowForm(false);
      setFormData(EMPTY_FORM);
      loadData();
    } catch (error) {
      toast.error('Failed to add candidate');
    }
  };

  const updateStatus = async (candidateId, newStatus) => {
    await base44.entities.Candidate.update(candidateId, { status: newStatus });
    toast.success('Status updated');
    loadData();
  };

  const setFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));

  const activeFilterCount = [
    filters.status !== 'all',
    filters.source !== 'all',
    filters.minExp > 0,
    filters.maxExp < 30,
    filters.minCtc !== '',
    filters.maxCtc !== '',
    filters.skills !== '',
    filters.position !== '',
    filters.search !== '',
  ].filter(Boolean).length;

  let filtered = candidates.filter(c => {
    if (filters.search && !c.full_name?.toLowerCase().includes(filters.search.toLowerCase()) &&
        !c.email?.toLowerCase().includes(filters.search.toLowerCase()) &&
        !c.current_company?.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.status !== 'all' && c.status !== filters.status) return false;
    if (filters.source !== 'all' && c.source !== filters.source) return false;
    if (c.experience_years < filters.minExp || c.experience_years > filters.maxExp) return false;
    if (filters.minCtc !== '' && c.expected_ctc < parseFloat(filters.minCtc)) return false;
    if (filters.maxCtc !== '' && c.expected_ctc > parseFloat(filters.maxCtc)) return false;
    if (filters.position && !c.position_applied?.toLowerCase().includes(filters.position.toLowerCase())) return false;
    if (filters.skills) {
      const skillList = filters.skills.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (skillList.length > 0 && !skillList.some(sk =>
        c.position_applied?.toLowerCase().includes(sk) ||
        c.cover_letter?.toLowerCase().includes(sk)
      )) return false;
    }
    return true;
  });

  if (sortByScore && selectedJdId) {
    filtered = [...filtered].sort((a, b) => {
      const sa = scores[a.id]?.overall_score ?? -1;
      const sb = scores[b.id]?.overall_score ?? -1;
      return sb - sa;
    });
  }

  const selectedJd = jobRequisitions.find(j => j.id === selectedJdId);

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  const stats = {
    total: candidates.length,
    screening: candidates.filter(c => c.status === 'screening' || c.status === 'interview_scheduled').length,
    selected: candidates.filter(c => c.status === 'selected' || c.status === 'offered').length
  };

  const handleStatClick = (statKey) => {
    if (statKey === 'total') setFilter('status', 'all');
    else if (statKey === 'screening') setFilter('status', 'screening');
    else if (statKey === 'selected') setFilter('status', 'selected');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Recruitment</h1>
            <p className="text-gray-600 mt-1">Manage candidates and hiring pipeline</p>
          </div>
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-5 h-5 mr-2" /> Add Candidate
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Add New Candidate</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  {[['Full Name *', 'full_name', 'text', true], ['Email *', 'email', 'email', true], ['Phone *', 'phone', 'text', true], ['Position Applied *', 'position_applied', 'text', true], ['Department', 'department', 'text', false], ['Current Company', 'current_company', 'text', false]].map(([label, key, type, req]) => (
                    <div key={key}>
                      <Label>{label}</Label>
                      <Input type={type} value={formData[key]} onChange={e => setFormData({ ...formData, [key]: e.target.value })} required={req} />
                    </div>
                  ))}
                  {[['Experience (Years)', 'experience_years', 'number'], ['Current CTC (₹)', 'current_ctc', 'number'], ['Expected CTC (₹)', 'expected_ctc', 'number'], ['Notice Period (Days)', 'notice_period', 'number']].map(([label, key, type]) => (
                    <div key={key}>
                      <Label>{label}</Label>
                      <Input type={type} step={key === 'experience_years' ? '0.1' : '1'} value={formData[key]} onChange={e => setFormData({ ...formData, [key]: e.target.value })} />
                    </div>
                  ))}
                  <div>
                    <Label>Source</Label>
                    <Select value={formData.source} onValueChange={v => setFormData({ ...formData, source: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['job_portal', 'referral', 'company_website', 'linkedin', 'walk_in', 'other'].map(s => (
                          <SelectItem key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  <Button type="submit">Add Candidate</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {[
            { label: 'Total Candidates', value: stats.total, icon: UserPlus, color: 'text-blue-600', bg: 'bg-blue-100', key: 'total' },
            { label: 'In Pipeline', value: stats.screening, icon: Briefcase, color: 'text-yellow-600', bg: 'bg-yellow-100', key: 'screening' },
            { label: 'Selected/Offered', value: stats.selected, icon: UserPlus, color: 'text-green-600', bg: 'bg-green-100', key: 'selected' },
          ].map(s => (
            <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleStatClick(s.key)}>
              <CardContent className="p-6 flex items-center gap-4">
                <div className={`p-4 ${s.bg} rounded-full`}><s.icon className={`w-8 h-8 ${s.color}`} /></div>
                <div><p className="text-sm text-gray-600">{s.label}</p><p className={`text-3xl font-bold ${s.color}`}>{s.value}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-48">
                <Label className="text-xs">Search</Label>
                <Input placeholder="Name, email, company..." value={filters.search} onChange={e => setFilter('search', e.target.value)} />
              </div>
              <div className="w-44">
                <Label className="text-xs">Status</Label>
                <Select value={filters.status} onValueChange={v => setFilter('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <Label className="text-xs">Source</Label>
                <Select value={filters.source} onValueChange={v => setFilter('source', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    {['job_portal', 'referral', 'company_website', 'linkedin', 'walk_in', 'other'].map(s => (
                      <SelectItem key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2 relative">
                <SlidersHorizontal className="w-4 h-4" />
                Advanced Filters
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
                )}
              </Button>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)} className="text-red-500">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
            {showFilters && (
              <div className="mt-4 pt-4 border-t grid md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Position / Role</Label>
                  <Input placeholder="e.g. Sales Manager" value={filters.position} onChange={e => setFilter('position', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Skills (comma separated)</Label>
                  <Input placeholder="e.g. react, python, sales" value={filters.skills} onChange={e => setFilter('skills', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Min Expected CTC (₹)</Label>
                  <Input type="number" placeholder="e.g. 300000" value={filters.minCtc} onChange={e => setFilter('minCtc', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Max Expected CTC (₹)</Label>
                  <Input type="number" placeholder="e.g. 1000000" value={filters.maxCtc} onChange={e => setFilter('maxCtc', e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Experience Range: {filters.minExp} – {filters.maxExp} years</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Input type="number" min="0" max="30" className="w-20" value={filters.minExp} onChange={e => setFilter('minExp', Number(e.target.value))} />
                    <span className="text-gray-400">to</span>
                    <Input type="number" min="0" max="30" className="w-20" value={filters.maxExp} onChange={e => setFilter('maxExp', Number(e.target.value))} />
                    <span className="text-xs text-gray-400">years</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stage 2: JD Match Scoring Panel */}
        <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50/50 to-purple-50/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-indigo-700">AI Candidate Scoring vs Job Requisition</span>
              <Badge className="bg-indigo-100 text-indigo-700 text-xs">Stage 2</Badge>
            </div>
            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-60">
                <Label className="text-xs text-gray-500">Select Job Requisition to score candidates against</Label>
                <Select value={selectedJdId} onValueChange={handleJdChange}>
                  <SelectTrigger className="border-indigo-200">
                    <SelectValue placeholder="Choose a Job Requisition..." />
                  </SelectTrigger>
                  <SelectContent>
                    {jobRequisitions.map(j => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.position_title} — {j.department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedJdId && (
                <>
                  <Button
                    onClick={scoreAllFiltered}
                    disabled={scoringAll}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    size="sm"
                  >
                    {scoringAll
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scoring...</>
                      : <><Sparkles className="w-4 h-4 mr-2" />Score All ({Math.min(filtered.length, 20)})</>
                    }
                  </Button>
                  {Object.keys(scores).length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSortByScore(!sortByScore)}
                      className="border-indigo-200 text-indigo-700 gap-2"
                    >
                      <ArrowUpDown className="w-4 h-4" />
                      {sortByScore ? 'Unsort' : 'Sort by Score'}
                    </Button>
                  )}
                </>
              )}
              {!selectedJdId && (
                <p className="text-xs text-gray-400 italic">Select a JD above, then score candidates with AI — weighted across skills, experience, salary, notice period, and education.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Candidates
              <span className="ml-2 text-sm font-normal text-gray-500">({filtered.length} of {candidates.length})</span>
              {sortByScore && selectedJd && (
                <span className="ml-2 text-xs font-normal text-indigo-600">Sorted by match for: {selectedJd.position_title}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filtered.length > 0 ? filtered.map(candidate => (
                <div key={candidate.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-600 font-semibold">{candidate.full_name?.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-semibold">{candidate.full_name}</p>
                          <p className="text-sm text-gray-600">{candidate.position_applied}</p>
                        </div>
                        <Badge className={STATUS_COLORS[candidate.status]}>
                          {candidate.status.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                        {candidate.source && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{candidate.source.replace('_', ' ')}</span>
                        )}
                      </div>
                      <div className="grid md:grid-cols-4 gap-3 text-sm text-gray-600 mb-1">
                        <div className="flex items-center gap-1"><Mail className="w-3 h-3" /><span className="truncate">{candidate.email}</span></div>
                        <div className="flex items-center gap-1"><Phone className="w-3 h-3" /><span>{candidate.phone}</span></div>
                        <div>Exp: <strong>{candidate.experience_years}y</strong></div>
                        <div>Exp CTC: <strong>₹{candidate.expected_ctc?.toLocaleString() || '—'}</strong></div>
                      </div>
                      {candidate.current_company && (
                        <p className="text-xs text-gray-500">Current: {candidate.current_company} · Notice: {candidate.notice_period || 0} days</p>
                      )}
                      <AiScoreSection candidate={candidate} />
                      {/* Stage 2: JD Score Card */}
                      {selectedJdId && scores[candidate.id] && (
                        <CandidateScoreCard
                          scoreData={scores[candidate.id]}
                          jobTitle={selectedJd?.position_title}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {selectedJdId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={scoringIds.has(candidate.id) || scoringAll}
                          onClick={() => scoreSingleCandidate(candidate.id)}
                          className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 h-8"
                        >
                          {scoringIds.has(candidate.id)
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <><Sparkles className="w-3 h-3 mr-1" />{scores[candidate.id] ? 'Rescore' : 'Score'}</>
                          }
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setSelectedCandidate(candidate)}>
                        <Eye className="w-3 h-3 mr-1" /> View
                      </Button>
                      <Select value={candidate.status} onValueChange={v => updateStatus(candidate.id, v)}>
                        <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.keys(STATUS_COLORS).map(s => (
                            <SelectItem key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )) : (
                <p className="text-center text-gray-500 py-8">No candidates match the current filters</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <CandidateDetailDialog
        candidate={selectedCandidate}
        open={!!selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}