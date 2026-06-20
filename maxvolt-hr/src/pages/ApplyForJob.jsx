import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { Briefcase, MapPin, Clock, CheckCircle2, Upload, Loader2 } from 'lucide-react';

export default function ApplyForJob() {
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    current_city: '',
    experience_years: '',
    current_company: '',
    current_designation: '',
    highest_qualification: '',
    current_ctc: '',
    expected_ctc: '',
    notice_period: '',
    linkedin_url: '',
    portfolio_url: '',
    key_skills: '',
    available_from: '',
    source: 'company_website',
    cover_letter: ''
  });

  useEffect(() => {
    if (jobId) loadJob();
    else setLoading(false);
  }, [jobId]);

  const loadJob = async () => {
    try {
      const res = await base44.functions.invoke('getPublishedJob', { jobId });
      const jobData = res.data?.job || null;
      setJob(jobData);
      // Use the approved JD saved in the entity — never regenerate on the fly
      if (jobData?.ai_job_description) {
        setAiDescription(jobData.ai_job_description);
      }
    } catch (e) {
      console.error(e);
      setJob(null);
    }
    setLoading(false);
  };



  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.email || !form.phone) {
      toast.error('Please fill in all required fields');
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
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          current_city: form.current_city,
          experience_years: parseFloat(form.experience_years) || 0,
          current_company: form.current_company,
          current_designation: form.current_designation,
          highest_qualification: form.highest_qualification,
          current_ctc: parseFloat(form.current_ctc) || 0,
          expected_ctc: parseFloat(form.expected_ctc) || 0,
          notice_period: parseInt(form.notice_period) || 0,
          linkedin_url: form.linkedin_url,
          portfolio_url: form.portfolio_url,
          key_skills: form.key_skills ? form.key_skills.split(',').map(s => s.trim()).filter(Boolean) : [],
          available_from: form.available_from,
          source: form.source,
          resume_url,
          cover_letter: form.cover_letter
        }
      });

      // Auto-trigger resume parsing if resume was uploaded and candidate ID returned
      if (resume_url && submitRes.data?.candidate_id) {
        base44.functions.invoke('parseResume', {
          candidate_id: submitRes.data.candidate_id,
          resume_url,
          auto_triggered: true
        }).catch(e => console.warn('Auto-parse failed silently:', e));
      }

      setSubmitted(true);
      toast.success('Application submitted successfully!');
    } catch (error) {
      toast.error('Failed to submit application: ' + error.message);
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!jobId || !job) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <Briefcase className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Job Not Found</h2>
        <p className="text-gray-500 mb-4">This position may no longer be available.</p>
        <a href="/PublicJobBoard">
          <Button className="bg-orange-500 hover:bg-orange-600">View All Openings</Button>
        </a>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-sm border p-10 max-w-md text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Submitted!</h2>
          <p className="text-gray-500 mb-2">Thank you for applying for <strong>{job.position_title}</strong>.</p>
          <p className="text-gray-400 text-sm mb-6">Our HR team will review your application and get in touch with you shortly.</p>
          <a href="/PublicJobBoard">
            <Button variant="outline">View Other Openings</Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <img src="/maxvolt-logo.jpg" alt="Maxvolt Energy" className="h-10 object-contain" />
          <div>
            <h1 className="font-bold text-gray-900">Apply for a Position</h1>
            <p className="text-sm text-gray-500">Maxvolt Energy Industries Limited</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Job Summary */}
        <Card className="border-l-4 border-l-orange-400">
          <CardContent className="p-5">
            <h2 className="text-xl font-bold text-gray-900 mb-2">{job.position_title}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
              <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />{job.department}</span>
              {job.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{job.location}</span>}
              {job.experience_required && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{job.experience_required}</span>}
            </div>
            {job.required_skills?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {job.required_skills.map((s, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            )}

            {/* Approved Job Description */}
            {aiDescription && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-semibold text-orange-600 mb-3">Job Description</p>
                <div className="prose prose-sm max-w-none text-gray-700">
                  {aiDescription.split('\n').map((line, i) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={i} className="h-2" />;
                    // Section headers (lines ending with : or all caps or starting with **)
                    if (/^[\*#]/.test(trimmed) || (trimmed.endsWith(':') && trimmed.length < 50) || /^[A-Z\s]{4,30}:?$/.test(trimmed)) {
                      return <p key={i} className="font-semibold text-gray-900 mt-3 mb-1">{trimmed.replace(/^[\*#]+\s*/, '')}</p>;
                    }
                    // Bullet points
                    if (/^[-•·]/.test(trimmed)) {
                      return <div key={i} className="flex gap-2 text-sm"><span className="text-orange-400 mt-0.5">•</span><span>{trimmed.replace(/^[-•·]\s*/, '')}</span></div>;
                    }
                    return <p key={i} className="text-sm leading-relaxed">{trimmed}</p>;
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Application Form */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-5">Your Application</h3>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Personal Details */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Personal Details</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Full Name *</Label>
                    <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required placeholder="John Doe" />
                  </div>
                  <div>
                    <Label>Email Address *</Label>
                    <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required placeholder="john@example.com" />
                  </div>
                  <div>
                    <Label>Phone Number *</Label>
                    <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required placeholder="+91 9XXXXXXXXX" />
                  </div>
                  <div>
                    <Label>Current City</Label>
                    <Input value={form.current_city} onChange={e => setForm({ ...form, current_city: e.target.value })} placeholder="e.g., Delhi" />
                  </div>
                </div>
              </div>

              {/* Professional Details */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Professional Details</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Years of Experience</Label>
                    <Input type="number" min="0" step="0.5" value={form.experience_years} onChange={e => setForm({ ...form, experience_years: e.target.value })} placeholder="e.g., 3" />
                  </div>
                  <div>
                    <Label>Highest Qualification</Label>
                    <Select value={form.highest_qualification} onValueChange={v => setForm({ ...form, highest_qualification: v })}>
                      <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10th">10th / SSC</SelectItem>
                        <SelectItem value="12th">12th / HSC</SelectItem>
                        <SelectItem value="diploma">Diploma</SelectItem>
                        <SelectItem value="bachelors">Bachelor's Degree (B.E / B.Tech / B.Sc / B.Com / BA)</SelectItem>
                        <SelectItem value="masters">Master's Degree (M.E / M.Tech / M.Sc / MBA / MA)</SelectItem>
                        <SelectItem value="phd">PhD / Doctorate</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Current Company</Label>
                    <Input value={form.current_company} onChange={e => setForm({ ...form, current_company: e.target.value })} placeholder="Current employer" />
                  </div>
                  <div>
                    <Label>Current Designation</Label>
                    <Input value={form.current_designation} onChange={e => setForm({ ...form, current_designation: e.target.value })} placeholder="e.g., Senior Engineer" />
                  </div>
                  <div>
                    <Label>Key Skills</Label>
                    <Input value={form.key_skills} onChange={e => setForm({ ...form, key_skills: e.target.value })} placeholder="e.g., React, Node.js, SQL (comma separated)" />
                  </div>
                  <div>
                    <Label>Notice Period (days)</Label>
                    <Input type="number" min="0" value={form.notice_period} onChange={e => setForm({ ...form, notice_period: e.target.value })} placeholder="e.g., 30" />
                  </div>
                  <div>
                    <Label>Available From</Label>
                    <Input type="date" value={form.available_from} onChange={e => setForm({ ...form, available_from: e.target.value })} min={new Date().toISOString().split('T')[0]} />
                  </div>
                </div>
              </div>

              {/* Compensation */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Compensation</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Current CTC (₹ per annum)</Label>
                    <Input type="number" min="0" value={form.current_ctc} onChange={e => setForm({ ...form, current_ctc: e.target.value })} placeholder="e.g., 600000" />
                  </div>
                  <div>
                    <Label>Expected CTC (₹ per annum)</Label>
                    <Input type="number" min="0" value={form.expected_ctc} onChange={e => setForm({ ...form, expected_ctc: e.target.value })} placeholder="e.g., 800000" />
                  </div>
                </div>
              </div>

              {/* Links & Source */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Links & Source</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>LinkedIn Profile URL</Label>
                    <Input type="url" value={form.linkedin_url} onChange={e => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/..." />
                  </div>
                  <div>
                    <Label>Portfolio / GitHub URL</Label>
                    <Input type="url" value={form.portfolio_url} onChange={e => setForm({ ...form, portfolio_url: e.target.value })} placeholder="https://github.com/..." />
                  </div>
                  <div>
                    <Label>Resume / CV *</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <label className="flex items-center gap-2 cursor-pointer border rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex-1">
                        <Upload className="w-4 h-4 text-gray-400" />
                        {resumeFile ? resumeFile.name : 'Upload PDF / DOC'}
                        <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={e => setResumeFile(e.target.files[0])} />
                      </label>
                    </div>
                  </div>
                  <div>
                    <Label>How did you hear about us?</Label>
                    <Select value={form.source} onValueChange={v => setForm({ ...form, source: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="job_portal">Job Portal (Naukri / Indeed)</SelectItem>
                        <SelectItem value="referral">Employee Referral</SelectItem>
                        <SelectItem value="company_website">Company Website</SelectItem>
                        <SelectItem value="linkedin">LinkedIn</SelectItem>
                        <SelectItem value="walk_in">Walk-In</SelectItem>
                        <SelectItem value="campus">Campus Recruitment</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div>
                <Label>Cover Letter / Message</Label>
                <Textarea rows={4} value={form.cover_letter} onChange={e => setForm({ ...form, cover_letter: e.target.value })} placeholder="Tell us why you're a great fit for this role..." />
              </div>
              <div className="pt-2 flex gap-3">
                <Button type="submit" disabled={submitting} className="bg-orange-500 hover:bg-orange-600 flex-1 sm:flex-none">
                  {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Submit Application'}
                </Button>
                <a href="/PublicJobBoard">
                  <Button type="button" variant="outline">Back to Jobs</Button>
                </a>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="border-t bg-white py-4 text-center text-xs text-gray-400 mt-10">
        © {new Date().getFullYear()} Maxvolt Energy Industries Limited. All rights reserved.
      </div>
    </div>
  );
}