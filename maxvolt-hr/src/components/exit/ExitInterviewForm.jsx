import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import { MessageSquare, Star, CheckCircle2 } from 'lucide-react';

const RATING_CRITERIA = [
  { key: 'work_experience_rating', label: 'Overall Work Experience' },
  { key: 'job_profile_rating', label: 'Role Clarity & Job Profile' },
  { key: 'management_rating', label: 'Manager & Leadership' },
  { key: 'team_colleagues_rating', label: 'Team & Colleagues' },
  { key: 'department_rating', label: 'Department Management' },
  { key: 'culture_rating', label: 'Company Culture & Values' },
  { key: 'compensation_rating', label: 'Compensation & Benefits' },
  { key: 'growth_rating', label: 'Growth & Learning Opportunities' },
  { key: 'work_life_balance_rating', label: 'Work-Life Balance' },
  { key: 'office_environment_rating', label: 'Office Environment & Facilities' },
  { key: 'communication_rating', label: 'Internal Communication' },
  { key: 'onboarding_rating', label: 'Onboarding Experience' },
];

const YES_NO_QUESTIONS = [
  { key: 'would_recommend_company', label: 'Would you recommend this company to others?' },
  { key: 'would_rejoin', label: 'Would you consider rejoining in the future?' },
  { key: 'felt_recognized', label: 'Did you feel your contributions were recognized and valued?' },
  { key: 'had_growth_path', label: 'Did you have a clear growth/career path here?' },
  { key: 'manager_was_supportive', label: 'Was your manager supportive and accessible?' },
  { key: 'team_was_collaborative', label: 'Was your team collaborative and professional?' },
];

const TEXT_QUESTIONS = [
  { key: 'primary_reason', label: 'Primary reason for leaving *', required: true, placeholder: 'Main reason for your decision to leave...' },
  { key: 'job_profile_feedback', label: 'How did you find your role and job responsibilities?', required: false, placeholder: 'Was the role as expected? Were responsibilities clear and well-defined?' },
  { key: 'manager_feedback', label: 'How was your relationship and experience with your manager?', required: false, placeholder: 'Communication style, support, feedback, approachability...' },
  { key: 'team_feedback', label: 'How was your experience working with your team and colleagues?', required: false, placeholder: 'Team dynamics, collaboration, support, conflicts...' },
  { key: 'department_feedback', label: 'What are your thoughts on how your department was run?', required: false, placeholder: 'Processes, decisions, workload distribution, communication within department...' },
  { key: 'things_liked', label: 'What did you like most about working here?', required: false, placeholder: 'Positive aspects, experiences, culture, benefits...' },
  { key: 'things_disliked', label: 'What could we have done better?', required: false, placeholder: 'Areas of improvement, challenges, frustrations...' },
  { key: 'growth_feedback', label: 'Did you feel you had sufficient opportunities to learn and grow?', required: false, placeholder: 'Training, promotions, skill development, mentoring...' },
  { key: 'suggestions', label: 'Suggestions for the organization', required: false, placeholder: 'Any recommendations to improve culture, processes, management, or employee experience...' },
];

function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} className="transition-transform hover:scale-110">
          <Star className={`w-6 h-6 ${n <= value ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
        </button>
      ))}
      <span className="ml-2 text-sm text-gray-500 self-center">{value ? `${value}/5` : 'Not rated'}</span>
    </div>
  );
}

function YesNoButton({ value, trueVal, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg border font-medium text-sm transition-colors ${
        value === trueVal
          ? (trueVal ? 'bg-green-500 text-white border-green-500' : 'bg-red-500 text-white border-red-500')
          : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

const defaultForm = (exitRecord) => {
  const ei = exitRecord?.exit_interview || {};
  return {
    primary_reason: ei.primary_reason || exitRecord?.reason_for_leaving || '',
    job_profile_feedback: ei.job_profile_feedback || '',
    manager_feedback: ei.manager_feedback || '',
    team_feedback: ei.team_feedback || '',
    department_feedback: ei.department_feedback || '',
    things_liked: ei.things_liked || '',
    things_disliked: ei.things_disliked || '',
    growth_feedback: ei.growth_feedback || '',
    suggestions: ei.suggestions || '',
    would_recommend_company: ei.would_recommend_company ?? null,
    would_rejoin: ei.would_rejoin ?? null,
    felt_recognized: ei.felt_recognized ?? null,
    had_growth_path: ei.had_growth_path ?? null,
    manager_was_supportive: ei.manager_was_supportive ?? null,
    team_was_collaborative: ei.team_was_collaborative ?? null,
    work_experience_rating: ei.work_experience_rating || 0,
    job_profile_rating: ei.job_profile_rating || 0,
    management_rating: ei.management_rating || 0,
    team_colleagues_rating: ei.team_colleagues_rating || 0,
    department_rating: ei.department_rating || 0,
    culture_rating: ei.culture_rating || 0,
    compensation_rating: ei.compensation_rating || 0,
    growth_rating: ei.growth_rating || 0,
    work_life_balance_rating: ei.work_life_balance_rating || 0,
    office_environment_rating: ei.office_environment_rating || 0,
    communication_rating: ei.communication_rating || 0,
    onboarding_rating: ei.onboarding_rating || 0,
  };
};

export default function ExitInterviewForm({ exitRecord, user, onComplete }) {
  const [form, setForm] = useState(() => defaultForm(exitRecord));
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (exitRecord?.exit_interview_completed) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-4" />
          <h3 className="text-xl font-semibold text-gray-700">Exit Interview Completed</h3>
          <p className="text-gray-500 mt-2">Thank you for your feedback. It has been recorded.</p>
        </CardContent>
      </Card>
    );
  }

  if (!['in_notice', 'clearance_pending', 'clearance_done', 'hr_approved', 'fnf_pending'].includes(exitRecord?.status)) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p>Exit interview will be available once your resignation is approved.</p>
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.primary_reason.trim()) { toast.error('Please enter your primary reason for leaving'); return; }
    setSaving(true);
    await base44.entities.Exit.update(exitRecord.id, {
      exit_interview_completed: true,
      exit_interview: { ...form, completed_at: new Date().toISOString() },
    });
    toast.success('Exit interview submitted. Thank you for your feedback!');
    setSaving(false);
    onComplete();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> Exit Interview</CardTitle>
        <p className="text-sm text-gray-500">Your honest feedback helps us build a better workplace. All responses are confidential.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-8">

          {/* Ratings Section */}
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">Rate Your Experience</h3>
            <p className="text-sm text-gray-500 mb-4">Please rate each area from 1 (poor) to 5 (excellent)</p>
            <div className="grid gap-4">
              {RATING_CRITERIA.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between flex-wrap gap-3 py-2 border-b border-gray-100 last:border-0">
                  <Label className="text-sm font-medium text-gray-700 min-w-[220px]">{label}</Label>
                  <StarRating value={form[key]} onChange={v => set(key, v)} />
                </div>
              ))}
            </div>
          </div>

          {/* Yes/No Questions */}
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-4">Quick Feedback</h3>
            <div className="grid md:grid-cols-2 gap-5">
              {YES_NO_QUESTIONS.map(({ key, label }) => (
                <div key={key}>
                  <Label className="block mb-3 text-sm font-medium">{label}</Label>
                  <div className="flex gap-3">
                    <YesNoButton value={form[key]} trueVal={true} label="Yes" onClick={() => set(key, form[key] === true ? null : true)} />
                    <YesNoButton value={form[key]} trueVal={false} label="No" onClick={() => set(key, form[key] === false ? null : false)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Text Questions */}
          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-4">Detailed Feedback</h3>
            <div className="space-y-5">
              {TEXT_QUESTIONS.map(({ key, label, required, placeholder }) => (
                <div key={key}>
                  <Label className="mb-1 block">{label}</Label>
                  <Textarea
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                    rows={3}
                    required={required}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700 px-8" disabled={saving}>
              {saving ? 'Submitting...' : 'Submit Exit Interview'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
