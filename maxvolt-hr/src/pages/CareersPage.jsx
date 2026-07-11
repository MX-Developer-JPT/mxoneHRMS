import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Briefcase, MapPin, Clock, Users, Search, ChevronRight, Calendar, CheckCircle2, Upload, Loader2, ArrowLeft } from 'lucide-react';
import { format, isPast } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', current_city: '',
  experience_years: '', current_company: '', current_designation: '',
  highest_qualification: '', current_ctc: '', expected_ctc: '',
  notice_period: '', linkedin_url: '', key_skills: '',
  available_from: '', source: 'careers_portal', cover_letter: '',
};

function Header({ onBack }) {
  return (
    <div className="bg-white border-b shadow-sm sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
        {onBack && (
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
        )}
        <img src="/favicon.svg?v=3" alt="Maxvolt Energy" className="h-10 object-contain" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Careers at Maxvolt Energy</h1>
          <p className="text-gray-500 text-xs">Build the future of energy with us</p>
        </div>
      </div>
    </div>
  );
}

function JobListPage({ jobs, loading, onSelect }) {
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const depts = [...new Set(jobs.map(j => j.department).filter(Boolean))];

  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    const matchSearch = !q || j.position_title?.toLowerCase().includes(q) || j.department?.toLowerCase().includes(q);
    const matchDept = filterDept === 'all' || j.department === filterDept;
    return matchSearch && matchDept;
  });

  const empTypeLabel = t => ({ full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Internship' }[t] || t);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Open Positions</h2>
        <p className="text-gray-500 mt-1">Find your next opportunity at Maxvolt Energy Industries Limited</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search positions..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant={filterDept === 'all' ? 'default' : 'outline'}
            onClick={() => setFilterDept('all')} className={filterDept === 'all' ? 'bg-orange-500 hover:bg-orange-600' : ''}>
            All
          </Button>
          {depts.map(d => (
            <Button key={d} size="sm" variant={filterDept === d ? 'default' : 'outline'}
              onClick={() => setFilterDept(d)} className={filterDept === d ? 'bg-orange-500 hover:bg-orange-600' : ''}>
              {d}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-500">{filtered.length} open position{filtered.length !== 1 ? 's' : ''}</p>

      {loading ? (
        <div className="text-center py-20 text-gray-400"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />Loading openings...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No open positions found</p>
          <p className="text-gray-400 text-sm">Check back soon for new opportunities</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(job => (
            <Card key={job.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onSelect(job.id)}>
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h2 className="text-lg font-bold text-gray-900">{job.position_title}</h2>
                      {job.employment_type && <Badge className="bg-orange-100 text-orange-700 border-0">{empTypeLabel(job.employment_type)}</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
                      {job.department && <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />{job.department}</span>}
                      {job.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{job.location}</span>}
                      {job.experience_required && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{job.experience_required}</span>}
                      {job.number_of_positions && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{job.number_of_positions} position(s)</span>}
                    </div>
                    {(job.ai_job_description || job.job_description) && (
                      <p className="text-sm text-gray-600 line-clamp-2">{(job.ai_job_description || job.job_description).slice(0, 200)}</p>
                    )}
                    {job.required_skills?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {job.required_skills.slice(0, 5).map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
                        {job.required_skills.length > 5 && <Badge variant="outline" className="text-xs">+{job.required_skills.length - 5} more</Badge>}
                      </div>
                    )}
                    {job.application_deadline && (
                      <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Apply by: {safeDate(job.application_deadline, 'dd MMM yyyy')}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <Button className="bg-orange-500 hover:bg-orange-600 gap-1">
                      View & Apply <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function JobDetailPage({ jobId, onBack }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resumeFile, setResumeFile] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('getPublishedJob', { jobId });
        setJob(res.data?.job || null);
      } catch (e) { setJob(null); }
      setLoading(false);
    })();
  }, [jobId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.email || !form.phone) {
      toast.error('Name, email and phone are required');
      return;
    }
    setSubmitting(true);
    try {
      let resume_url = '';
      if (resumeFile) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: resumeFile });
        resume_url = file_url;
      }

      const submitRes = await base44.functions.invoke('submitJobApplication', {
        jobId,
        jobTitle: job?.position_title,
        jobDepartment: job?.department,
        currentCandidatesCount: job?.candidates_count || 0,
        candidateData: {
          ...form,
          experience_years: parseFloat(form.experience_years) || 0,
          current_ctc: parseFloat(form.current_ctc) || 0,
          expected_ctc: parseFloat(form.expected_ctc) || 0,
          notice_period: parseInt(form.notice_period) || 0,
          key_skills: form.key_skills ? form.key_skills.split(',').map(s => s.trim()).filter(Boolean) : [],
          resume_url,
        },
      });

      if (resume_url && submitRes.data?.candidate_id) {
        base44.functions.invoke('parseResume', {
          candidate_id: submitRes.data.candidate_id, resume_url, auto_triggered: true
        }).catch(() => {});
      }

      setSubmitted(true);
      toast.success('Application submitted successfully!');
    } catch (err) {
      toast.error('Failed to submit: ' + err.message);
    }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-20 text-center text-gray-400">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />Loading job details...
    </div>
  );

  if (!job) return (
    <div className="max-w-3xl mx-auto px-4 py-20 text-center">
      <Briefcase className="w-14 h-14 text-gray-300 mx-auto mb-4" />
      <h2 className="text-xl font-semibold text-gray-700 mb-2">Job Not Found</h2>
      <p className="text-gray-500 mb-6">This position may no longer be available.</p>
      <Button onClick={onBack} className="bg-orange-500 hover:bg-orange-600">View All Openings</Button>
    </div>
  );

  if (submitted) return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Received!</h2>
      <p className="text-gray-500 mb-2">Thank you for applying for <strong>{job.position_title}</strong>.</p>
      <p className="text-gray-400 text-sm mb-6">Our HR team will review your application and get in touch with you shortly.</p>
      <Button onClick={onBack} variant="outline">View Other Openings</Button>
    </div>
  );

  const jd = job.ai_job_description || job.job_description || '';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Job Header */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap items-start gap-3 justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{job.position_title}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mt-2">
                {job.department && <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />{job.department}</span>}
                {job.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{job.location}</span>}
                {job.experience_required && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{job.experience_required}</span>}
                {job.number_of_positions && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{job.number_of_positions} opening(s)</span>}
              </div>
            </div>
            {job.employment_type && <Badge className="bg-orange-100 text-orange-700 border-0 text-sm">
              {{ full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Internship' }[job.employment_type] || job.employment_type}
            </Badge>}
          </div>
          {job.required_skills?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {job.required_skills.map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
            </div>
          )}
          {job.application_deadline && (
            <p className="text-sm text-red-500 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Apply by {safeDate(job.application_deadline, 'dd MMMM yyyy')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Job Description */}
      {jd && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">About This Role</h2>
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
              {jd}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Application Form */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Apply for This Position</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div><Label className="text-xs font-semibold">Full Name *</Label><Input className="mt-1" value={form.full_name} onChange={e => set('full_name', e.target.value)} required /></div>
              <div><Label className="text-xs font-semibold">Email *</Label><Input className="mt-1" type="email" value={form.email} onChange={e => set('email', e.target.value)} required /></div>
              <div><Label className="text-xs font-semibold">Phone *</Label><Input className="mt-1" value={form.phone} onChange={e => set('phone', e.target.value)} required /></div>
              <div><Label className="text-xs font-semibold">Current City</Label><Input className="mt-1" value={form.current_city} onChange={e => set('current_city', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Experience (years)</Label><Input className="mt-1" type="number" min="0" value={form.experience_years} onChange={e => set('experience_years', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Highest Qualification</Label><Input className="mt-1" value={form.highest_qualification} onChange={e => set('highest_qualification', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Current Company</Label><Input className="mt-1" value={form.current_company} onChange={e => set('current_company', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Current Designation</Label><Input className="mt-1" value={form.current_designation} onChange={e => set('current_designation', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Current CTC (LPA)</Label><Input className="mt-1" type="number" min="0" value={form.current_ctc} onChange={e => set('current_ctc', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Expected CTC (LPA)</Label><Input className="mt-1" type="number" min="0" value={form.expected_ctc} onChange={e => set('expected_ctc', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Notice Period (days)</Label><Input className="mt-1" type="number" min="0" value={form.notice_period} onChange={e => set('notice_period', e.target.value)} /></div>
              <div><Label className="text-xs font-semibold">Available From</Label><Input className="mt-1" type="date" value={form.available_from} onChange={e => set('available_from', e.target.value)} /></div>
            </div>

            <div><Label className="text-xs font-semibold">Key Skills (comma-separated)</Label><Input className="mt-1" value={form.key_skills} onChange={e => set('key_skills', e.target.value)} placeholder="e.g. Python, Project Management, Electrical" /></div>
            <div><Label className="text-xs font-semibold">LinkedIn Profile URL</Label><Input className="mt-1" type="url" value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} /></div>
            <div>
              <Label className="text-xs font-semibold">How did you hear about us?</Label>
              <Select value={form.source} onValueChange={v => set('source', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="careers_portal">Careers Portal</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="naukri">Naukri</SelectItem>
                  <SelectItem value="indeed">Indeed</SelectItem>
                  <SelectItem value="referral">Employee Referral</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Cover Letter / Why do you want to join?</Label>
              <Textarea className="mt-1" rows={4} value={form.cover_letter} onChange={e => set('cover_letter', e.target.value)} placeholder="Tell us why you're a great fit for this role..." />
            </div>
            <div>
              <Label className="text-xs font-semibold">Upload CV / Resume *</Label>
              <div className="mt-1 border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-orange-300 transition-colors">
                <input type="file" id="resume-upload" className="hidden" accept=".pdf,.doc,.docx"
                  onChange={e => setResumeFile(e.target.files?.[0] || null)} />
                <label htmlFor="resume-upload" className="cursor-pointer">
                  <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                  {resumeFile ? (
                    <p className="text-sm text-green-600 font-medium">{resumeFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500">Click to upload or drag and drop</p>
                      <p className="text-xs text-gray-400">PDF, DOC, DOCX (max 5MB)</p>
                    </>
                  )}
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={submitting} className="flex-1 bg-orange-500 hover:bg-orange-600">
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Submit Application'}
              </Button>
              <Button type="button" variant="outline" onClick={onBack}>Back to Jobs</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CareersPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const allJobs = await base44.entities.JobRequisition.list('-published_date', 500);
        const active = allJobs.filter(j => {
          const isPublished = j.is_published === true || j.status === 'published' || j.status === 'approved';
          const notExpired = !j.application_deadline || !isPast(new Date(j.application_deadline));
          const notClosed = !['closed', 'cancelled', 'rejected', 'hr_rejected', 'manager_rejected'].includes(j.status);
          return isPublished && notExpired && notClosed;
        });
        setJobs(active);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const handleSelectJob = (id) => navigate(`/careers/${id}`);
  const handleBack = () => navigate('/careers');

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onBack={jobId ? handleBack : null} />
      {jobId
        ? <JobDetailPage jobId={jobId} onBack={handleBack} />
        : <JobListPage jobs={jobs} loading={loading} onSelect={handleSelectJob} />
      }
      <div className="border-t bg-white py-4 text-center text-xs text-gray-400 mt-10">
        © {new Date().getFullYear()} Maxvolt Energy Industries Limited · All rights reserved
      </div>
    </div>
  );
}
