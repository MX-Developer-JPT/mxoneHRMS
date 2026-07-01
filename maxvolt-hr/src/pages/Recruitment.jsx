import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import { Plus, UserPlus, Briefcase, Mail, Phone, Eye, Sparkles, Loader2, Star, ChevronDown, ChevronUp, SlidersHorizontal, X, BarChart2, ArrowUpDown, FileCheck, Send, CalendarCheck, Copy, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { openLetterheadPrintWindow } from '@/utils/letterhead';
import CandidateDetailDialog from '../components/recruitment/CandidateDetailDialog';
import CandidateScoreCard from '../components/recruitment/CandidateScoreCard';

const TODAY = new Date().toISOString().slice(0, 10);

function calcSalary(annualCTC) {
  if (!annualCTC || annualCTC <= 0) return null;
  const PF_CEIL = 15000, ESI_CEIL = 21000;
  const m = Math.round(annualCTC / 12);
  const basic = Math.round(m * 0.5);
  const hra = Math.round(basic * 0.4);
  const isPF = basic > ESI_CEIL, isESI = basic <= ESI_CEIL;
  let bonus, bonusType;
  if (annualCTC <= 1000000) { bonus = Math.round(basic * 12 * 0.0833 / 12); bonusType = 'Bonus (8.33% of Basic)'; }
  else { const vp = annualCTC <= 1500000 ? 0.05 : annualCTC <= 2000000 ? 0.08 : annualCTC <= 2500000 ? 0.12 : 0.15; bonus = Math.round(annualCTC * vp / 12); bonusType = `VPP (${Math.round(vp * 100)}% of CTC)`; }
  const medical = 330;
  const pfBase = isPF ? Math.min(basic, PF_CEIL) : 0;
  const pfEmp = Math.round(pfBase * 0.12);
  const pfEmployer = Math.round(pfBase * 0.13);
  const contribNoESI = pfEmployer + medical + bonus;
  const grossEst = m - contribNoESI;
  const esiEmp = isESI ? Math.round(grossEst * 0.0075) : 0;
  const esiEmployer = isESI ? Math.round(grossEst * 0.0325) : 0;
  const contrib = contribNoESI + esiEmployer;
  const gross = m - contrib;
  const conv = Math.max(gross - basic - hra, 0);
  const net = gross - pfEmp - esiEmp;
  return {
    monthly_ctc: m, annual_ctc: annualCTC,
    basic_monthly: basic, basic_annual: basic * 12,
    hra_monthly: hra, hra_annual: hra * 12,
    conveyance_monthly: conv, conveyance_annual: conv * 12,
    gross_monthly: gross, gross_annual: gross * 12,
    pf_emp_monthly: pfEmp, pf_emp_annual: pfEmp * 12,
    esi_emp_monthly: esiEmp, esi_emp_annual: esiEmp * 12,
    pf_employer_monthly: pfEmployer, pf_employer_annual: pfEmployer * 12,
    esi_employer_monthly: esiEmployer, esi_employer_annual: esiEmployer * 12,
    medical_monthly: medical, medical_annual: medical * 12,
    bonus_monthly: bonus, bonus_annual: bonus * 12, bonusType,
    contribution_monthly: contrib, contribution_annual: contrib * 12,
    net_monthly: net, net_annual: net * 12,
    isPF, isESI,
  };
}

function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }

function OfferLetterDialog({ candidate, onClose, onRefresh }) {
  const defaultJoining = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    joining_date: defaultJoining,
    designation: candidate?.position_applied || '',
    department: candidate?.department || '',
    location: 'Ghaziabad, Uttar Pradesh',
    reporting_to: '',
    annual_ctc: candidate?.expected_ctc || 0,
    probation_months: 6,
    offer_valid_days: 7,
    notes: '',
  });
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [acceptLink, setAcceptLink] = useState('');

  const sal = calcSalary(Number(form.annual_ctc) || 0);

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await base44.functions.invoke('generateOfferLetter', {
        candidate_id: candidate.id,
        joining_date: form.joining_date,
        designation: form.designation,
        department: form.department,
        location: form.location,
        reporting_to: form.reporting_to,
        ctc: Number(form.annual_ctc),
        probation_months: Number(form.probation_months),
      });
      if (res.data?.success) {
        openLetterheadPrintWindow(`Offer Letter — ${candidate.full_name}`, res.data.html, '', false);
      } else {
        toast.error(res.data?.error || 'Failed to generate preview');
      }
    } catch (e) { toast.error(e.message); }
    setPreviewing(false);
  };

  const handleSend = async () => {
    if (!candidate.email) { toast.error('Candidate has no email address'); return; }
    setSending(true);
    try {
      const res = await base44.functions.invoke('sendOfferLetter', {
        candidate_id: candidate.id,
        joining_date: form.joining_date,
        designation: form.designation,
        department: form.department,
        location: form.location,
        reporting_to: form.reporting_to,
        annual_ctc: Number(form.annual_ctc),
        probation_months: Number(form.probation_months),
        offer_valid_days: Number(form.offer_valid_days),
        notes: form.notes,
      });
      if (res.data?.success) {
        setSent(true);
        setAcceptLink(res.data.accept_link || '');
        if (res.data.email_error) {
          toast.warning(`Offer saved but email failed: ${res.data.email_error}. Check BREVO_API_KEY in Railway.`);
        } else {
          toast.success('Offer letter sent to ' + candidate.email);
        }
        onRefresh();
      } else {
        toast.error(res.data?.error || 'Failed to send offer letter');
      }
    } catch (e) { toast.error(e.message); }
    setSending(false);
  };

  if (sent) return (
    <div className="text-center py-6 space-y-4">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <Send className="w-8 h-8 text-green-600" />
      </div>
      <h3 className="font-semibold text-lg text-gray-800">Offer Letter Sent!</h3>
      <p className="text-sm text-gray-500">Sent to <strong>{candidate.email}</strong></p>
      {acceptLink && (
        <div className="bg-gray-50 rounded-lg p-3 text-left">
          <p className="text-xs text-gray-500 mb-1">Candidate acceptance link:</p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-blue-700 flex-1 truncate">{acceptLink}</code>
            <button onClick={() => { navigator.clipboard.writeText(acceptLink); toast.success('Copied!'); }}
              className="p-1 hover:bg-gray-200 rounded">
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      <Button onClick={onClose} variant="outline">Close</Button>
    </div>
  );

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
      <p className="text-sm text-gray-500">Configure and send offer letter to <strong>{candidate.full_name}</strong> ({candidate.email})</p>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Joining Date *</Label>
          <Input type="date" value={form.joining_date} onChange={e => setF('joining_date', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Probation Period (months)</Label>
          <Input type="number" value={form.probation_months} onChange={e => setF('probation_months', e.target.value)} min="0" max="24" />
        </div>
        <div>
          <Label className="text-xs">Designation</Label>
          <Input value={form.designation} onChange={e => setF('designation', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Department</Label>
          <Input value={form.department} onChange={e => setF('department', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Work Location</Label>
          <Input value={form.location} onChange={e => setF('location', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Reporting To</Label>
          <Input value={form.reporting_to} onChange={e => setF('reporting_to', e.target.value)} placeholder="Manager name" />
        </div>
        <div>
          <Label className="text-xs">Annual CTC (₹)</Label>
          <Input type="number" value={form.annual_ctc} onChange={e => setF('annual_ctc', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Offer Valid for (days)</Label>
          <Input type="number" value={form.offer_valid_days} onChange={e => setF('offer_valid_days', e.target.value)} min="1" max="30" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Additional Notes (optional)</Label>
          <Textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2} placeholder="Any special terms or notes..." />
        </div>
      </div>

      {/* Live Salary Preview */}
      {Number(form.annual_ctc) > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">Salary Structure Preview</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left px-3 py-1.5 border-b">Component</th>
                <th className="text-right px-3 py-1.5 border-b">Annual (₹)</th>
                <th className="text-right px-3 py-1.5 border-b">Monthly (₹)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Basic (50% of CTC)', sal.basic_annual, sal.basic_monthly],
                ['HRA (40% of Basic)', sal.hra_annual, sal.hra_monthly],
                ['Conveyance (Balance)', sal.conveyance_annual, sal.conveyance_monthly],
              ].map(([l, a, m]) => (
                <tr key={l} className="border-b">
                  <td className="px-3 py-1">{l}</td>
                  <td className="px-3 py-1 text-right">{fmt(a)}</td>
                  <td className="px-3 py-1 text-right">{fmt(m)}</td>
                </tr>
              ))}
              <tr className="bg-blue-50 font-semibold border-b">
                <td className="px-3 py-1.5">Total Gross (A)</td>
                <td className="px-3 py-1.5 text-right">{fmt(sal.gross_annual)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(sal.gross_monthly)}</td>
              </tr>
              {sal.isPF && (
                <tr className="border-b text-gray-500">
                  <td className="px-3 py-1">PF Employee 12% (deduction)</td>
                  <td className="px-3 py-1 text-right">-{fmt(sal.pf_emp_annual)}</td>
                  <td className="px-3 py-1 text-right">-{fmt(sal.pf_emp_monthly)}</td>
                </tr>
              )}
              {sal.isESI && (
                <tr className="border-b text-gray-500">
                  <td className="px-3 py-1">ESI Employee 0.75% (deduction)</td>
                  <td className="px-3 py-1 text-right">-{fmt(sal.esi_emp_annual)}</td>
                  <td className="px-3 py-1 text-right">-{fmt(sal.esi_emp_monthly)}</td>
                </tr>
              )}
              <tr className="bg-green-50 font-semibold border-b">
                <td className="px-3 py-1.5">Net Take-Home (A-B)</td>
                <td className="px-3 py-1.5 text-right">{fmt(sal.net_annual)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(sal.net_monthly)}</td>
              </tr>
              <tr className="bg-orange-50 font-bold">
                <td className="px-3 py-1.5">Annual CTC (A+C)</td>
                <td className="px-3 py-1.5 text-right">{fmt(sal.annual_ctc)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(sal.monthly_ctc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={handlePreview} disabled={previewing} className="flex-1">
          {previewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileCheck className="w-4 h-4 mr-2" />}
          Preview Letter
        </Button>
        <Button onClick={handleSend} disabled={sending || !form.joining_date} className="flex-1 bg-green-600 hover:bg-green-700">
          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          Send to Candidate
        </Button>
      </div>
      <p className="text-xs text-gray-400 text-center">
        Sends offer letter + consent form to {candidate.email} with a digital acceptance link
      </p>
    </div>
  );
}

const STATUS_COLORS = {
  applied: 'bg-blue-100 text-blue-800',
  screening: 'bg-yellow-100 text-yellow-800',
  interview_scheduled: 'bg-purple-100 text-purple-800',
  interviewed: 'bg-orange-100 text-orange-800',
  selected: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  offered: 'bg-teal-100 text-teal-800',
  offer_accepted: 'bg-emerald-100 text-emerald-800',
  joined: 'bg-green-200 text-green-900',
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
      const response = await base44.functions.invoke('scoreAndSummariseCv', {
        candidate_id:     candidate.id,
        position_applied: candidate.position_applied,
        department:       candidate.department,
        experience_years: candidate.experience_years,
        current_company:  candidate.current_company,
        current_ctc:      candidate.current_ctc,
        expected_ctc:     candidate.expected_ctc,
        notice_period:    candidate.notice_period,
      });

      if (!response.data?.success) throw new Error(response.data?.error || 'AI scoring failed');

      const d = response.data.result;
      setResult({
        score:              Math.max(1, Math.round((d.score || 0) / 10)),
        summary:            d.summary,
        strengths:          d.key_strengths || [],
        gaps:               d.areas_for_improvement || [],
        score_justification:[d.experience_assessment, d.compensation_analysis].filter(Boolean).join(' '),
        recommendation:     d.recommendation,
      });
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
          <>
            <Badge className={SCORE_COLOR(result.score)}>
              <Star className="w-3 h-3 mr-1" /> AI Score: {result.score}/10
            </Badge>
            {result.recommendation && (
              <Badge variant="outline" className="text-xs">
                {result.recommendation}
              </Badge>
            )}
          </>
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
  const [offerDialogCandidate, setOfferDialogCandidate] = useState(null);
  const [invitingId, setInvitingId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [formData, setFormData] = useState(EMPTY_FORM);

  // Stage 2: JD Scoring
  const [jobRequisitions, setJobRequisitions] = useState([]);
  const [selectedJdId, setSelectedJdId] = useState('');
  const [jdSelectOpen, setJdSelectOpen] = useState(false);
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

  const handleInviteJoiner = async (candidate) => {
    setInvitingId(candidate.id);
    try {
      const res = await base44.functions.invoke('inviteJoinerToApp', { candidate_id: candidate.id });
      if (res.data?.success) {
        toast.success('Invitation email sent to ' + candidate.email);
        loadData();
      } else {
        toast.error(res.data?.error || 'Failed to send invite');
      }
    } catch (e) { toast.error(e.message); }
    setInvitingId(null);
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
                <Popover open={jdSelectOpen} onOpenChange={setJdSelectOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className="flex w-full items-center justify-between rounded-md border border-indigo-200 bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                      <span className={selectedJdId ? 'text-foreground' : 'text-muted-foreground'}>
                        {selectedJdId ? (() => { const j = jobRequisitions.find(j => j.id === selectedJdId); return j ? `${j.position_title} — ${j.department}` : 'Choose a Job Requisition...'; })() : 'Choose a Job Requisition...'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search job requisition..." />
                      <CommandList>
                        <CommandEmpty>No requisition found.</CommandEmpty>
                        <CommandGroup>
                          {jobRequisitions.map(j => (
                            <CommandItem
                              key={j.id}
                              value={`${j.position_title} ${j.department || ''}`}
                              onSelect={() => { handleJdChange(j.id); setJdSelectOpen(false); }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${selectedJdId === j.id ? 'opacity-100' : 'opacity-0'}`} />
                              <div>
                                <p className="font-medium">{j.position_title}</p>
                                <p className="text-xs text-muted-foreground">{j.department}</p>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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
                        <Badge className={STATUS_COLORS[candidate.status] || 'bg-gray-100 text-gray-700'}>
                          {candidate.status.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                        {candidate.joining_date === TODAY && (
                          <Badge className="bg-purple-100 text-purple-800 animate-pulse">
                            Joining Today!
                          </Badge>
                        )}
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
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
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
                      {['selected', 'interview_done', 'offered', 'offer_accepted'].includes(candidate.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setOfferDialogCandidate(candidate)}
                          className="border-green-300 text-green-700 hover:bg-green-50 h-8"
                          title="Create & Send Offer Letter"
                        >
                          <FileCheck className="w-3 h-3 mr-1" /> Offer Letter
                        </Button>
                      )}
                      {candidate.joining_date === TODAY && candidate.status === 'offer_accepted' && (
                        <Button
                          size="sm"
                          onClick={() => handleInviteJoiner(candidate)}
                          disabled={invitingId === candidate.id}
                          className="bg-purple-600 hover:bg-purple-700 text-white h-8"
                          title="Today is joining date! Invite to app"
                        >
                          {invitingId === candidate.id
                            ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            : <CalendarCheck className="w-3 h-3 mr-1" />
                          }
                          Invite to App
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
                          <SelectItem value="interview_done">Interview Done</SelectItem>
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

      {/* Offer Letter Dialog */}
      <Dialog open={!!offerDialogCandidate} onOpenChange={open => { if (!open) setOfferDialogCandidate(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-green-600" />
              Offer Letter — {offerDialogCandidate?.full_name}
            </DialogTitle>
          </DialogHeader>
          {offerDialogCandidate && (
            <OfferLetterDialog
              candidate={offerDialogCandidate}
              onClose={() => setOfferDialogCandidate(null)}
              onRefresh={loadData}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}