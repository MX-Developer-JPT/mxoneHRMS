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
  { key: 'management_rating', label: 'Management & Leadership' },
  { key: 'culture_rating', label: 'Company Culture' },
  { key: 'compensation_rating', label: 'Compensation & Benefits' },
  { key: 'work_life_balance_rating', label: 'Work-Life Balance' },
];

function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} className="transition-transform hover:scale-110">
          <Star className={`w-7 h-7 ${n <= value ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
        </button>
      ))}
      <span className="ml-2 text-sm text-gray-500 self-center">{value ? `${value}/5` : 'Not rated'}</span>
    </div>
  );
}

export default function ExitInterviewForm({ exitRecord, user, onComplete }) {
  const [form, setForm] = useState({
    primary_reason: exitRecord?.exit_interview?.primary_reason || exitRecord?.reason_for_leaving || '',
    things_liked: exitRecord?.exit_interview?.things_liked || '',
    things_disliked: exitRecord?.exit_interview?.things_disliked || '',
    suggestions: exitRecord?.exit_interview?.suggestions || '',
    would_recommend_company: exitRecord?.exit_interview?.would_recommend_company ?? null,
    would_rejoin: exitRecord?.exit_interview?.would_rejoin ?? null,
    work_experience_rating: exitRecord?.exit_interview?.work_experience_rating || 0,
    management_rating: exitRecord?.exit_interview?.management_rating || 0,
    culture_rating: exitRecord?.exit_interview?.culture_rating || 0,
    compensation_rating: exitRecord?.exit_interview?.compensation_rating || 0,
    work_life_balance_rating: exitRecord?.exit_interview?.work_life_balance_rating || 0,
  });
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
      <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> Exit Interview</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label className="text-base font-semibold">Rate Your Experience</Label>
            <p className="text-sm text-gray-500 mb-4">Your honest feedback helps us improve</p>
            <div className="space-y-4">
              {RATING_CRITERIA.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between flex-wrap gap-3">
                  <Label className="text-sm font-medium text-gray-700 min-w-[180px]">{label}</Label>
                  <StarRating value={form[key]} onChange={v => set(key, v)} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Primary reason for leaving *</Label>
            <Textarea value={form.primary_reason} onChange={e => set('primary_reason', e.target.value)} rows={3} required placeholder="Main reason for your decision to leave..." />
          </div>
          <div>
            <Label>What did you like most about working here?</Label>
            <Textarea value={form.things_liked} onChange={e => set('things_liked', e.target.value)} rows={3} placeholder="Positive aspects, experiences, culture..." />
          </div>
          <div>
            <Label>What could we have done better?</Label>
            <Textarea value={form.things_disliked} onChange={e => set('things_disliked', e.target.value)} rows={3} placeholder="Areas of improvement, challenges..." />
          </div>
          <div>
            <Label>Suggestions for the organization</Label>
            <Textarea value={form.suggestions} onChange={e => set('suggestions', e.target.value)} rows={3} placeholder="Any recommendations or suggestions..." />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <Label className="block mb-3">Would you recommend this company to others?</Label>
              <div className="flex gap-3">
                <button type="button" onClick={() => set('would_recommend_company', true)} className={`flex-1 py-2 rounded-lg border font-medium text-sm transition-colors ${form.would_recommend_company === true ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 hover:bg-gray-50'}`}>Yes</button>
                <button type="button" onClick={() => set('would_recommend_company', false)} className={`flex-1 py-2 rounded-lg border font-medium text-sm transition-colors ${form.would_recommend_company === false ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 hover:bg-gray-50'}`}>No</button>
              </div>
            </div>
            <div>
              <Label className="block mb-3">Would you consider rejoining in the future?</Label>
              <div className="flex gap-3">
                <button type="button" onClick={() => set('would_rejoin', true)} className={`flex-1 py-2 rounded-lg border font-medium text-sm transition-colors ${form.would_rejoin === true ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 hover:bg-gray-50'}`}>Yes</button>
                <button type="button" onClick={() => set('would_rejoin', false)} className={`flex-1 py-2 rounded-lg border font-medium text-sm transition-colors ${form.would_rejoin === false ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 hover:bg-gray-50'}`}>No</button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
              {saving ? 'Submitting...' : 'Submit Exit Interview'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}