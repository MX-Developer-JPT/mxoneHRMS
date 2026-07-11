import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Star, Users, MessageSquare, Award, Target, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const COMPETENCIES = [
  { key: 'communication', label: 'Communication' },
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'technical', label: 'Technical Skills' },
  { key: 'leadership', label: 'Leadership' },
  { key: 'reliability', label: 'Reliability' },
];

const RELATIONSHIPS = [
  { value: 'peer', label: 'Peer' },
  { value: 'manager', label: 'Manager' },
  { value: 'direct_report', label: 'Direct Report' },
];

function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="focus:outline-none"
        >
          <Star
            className={`w-6 h-6 transition-colors ${
              n <= (hover || value) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
            }`}
          />
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-sm text-gray-500 self-center">{value}/5</span>}
    </div>
  );
}

function ScoreBar({ score, max = 5 }) {
  const pct = Math.round((score / max) * 100);
  const color = score >= 4 ? 'bg-green-500' : score >= 3 ? 'bg-blue-500' : score >= 2 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function FeedbackSystem() {
  const [activeTab, setActiveTab] = useState('give');
  const [user, setUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [feedbackData, setFeedbackData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [colleagueOpen, setColleagueOpen] = useState(false);
  const [form, setForm] = useState({
    subject_user_id: '',
    relationship: '',
    answers: { communication: 0, collaboration: 0, technical: 0, leadership: 0, reliability: 0, comments: '' },
  });

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);
      const emps = await base44.entities.Employee.list();
      setEmployees(emps || []);
      // load my feedback
      const fd = await base44.functions.invoke('get360FeedbackData', { subject_user_id: me.id });
      setFeedbackData(fd?.data || fd);
    } catch (e) {
      // non-fatal; employees or feedback may be empty
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject_user_id) { toast.error('Please select a colleague'); return; }
    if (!form.relationship) { toast.error('Please select your relationship'); return; }
    const zeroRatings = COMPETENCIES.filter(c => form.answers[c.key] === 0);
    if (zeroRatings.length > 0) { toast.error(`Please rate all competencies`); return; }

    setSubmitting(true);
    try {
      await base44.functions.invoke('submit360Feedback', {
        subject_user_id: form.subject_user_id,
        relationship: form.relationship,
        answers: form.answers,
        period: 'current',
      });
      toast.success('Feedback submitted anonymously');
      setForm({
        subject_user_id: '',
        relationship: '',
        answers: { communication: 0, collaboration: 0, technical: 0, leadership: 0, reliability: 0, comments: '' },
      });
    } catch (e) {
      toast.error('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const setRating = (key, val) => {
    setForm(f => ({ ...f, answers: { ...f.answers, [key]: val } }));
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  const scores = feedbackData?.aggregate || {};
  const reviewerCount = feedbackData?.total_reviewers ?? 0;

  // filter out current user and unlinked employees from colleague list
  const colleagues = employees.filter(emp => emp.user_id && emp.user_id !== user?.id);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">360° Feedback</h1>
        <p className="text-gray-500 text-sm mt-1">Give and receive anonymous multi-rater feedback</p>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {[{ key: 'give', label: 'Give Feedback', icon: MessageSquare }, { key: 'my', label: 'My Feedback', icon: Award }].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'give' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Submit Anonymous Feedback</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Colleague *</label>
                  <Popover open={colleagueOpen} onOpenChange={setColleagueOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                        <span className={`truncate min-w-0 ${form.subject_user_id ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {form.subject_user_id ? (() => { const e = colleagues.find(e => (e.user_id || e.id) === form.subject_user_id); return e ? (e.display_name || e.full_name || e.email) : 'Select colleague'; })() : 'Select colleague'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search colleague..." />
                        <CommandList>
                          <CommandEmpty>No colleagues found.</CommandEmpty>
                          <CommandGroup>
                            {colleagues.map(emp => (
                              <CommandItem
                                key={emp.id}
                                value={`${emp.display_name || emp.full_name || emp.email || ''}`}
                                onSelect={() => { setForm(f => ({ ...f, subject_user_id: emp.user_id || emp.id })); setColleagueOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${form.subject_user_id === (emp.user_id || emp.id) ? 'opacity-100' : 'opacity-0'}`} />
                                {emp.display_name || emp.full_name || emp.email}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Relationship *</label>
                  <Select value={form.relationship} onValueChange={v => setForm(f => ({ ...f, relationship: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select relationship" /></SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIPS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Target className="w-4 h-4" /> Rate Competencies (1–5 stars)
                </h3>
                {COMPETENCIES.map(comp => (
                  <div key={comp.key} className="flex items-center gap-4">
                    <span className="w-36 text-sm text-gray-700 shrink-0">{comp.label}</span>
                    <StarRating
                      value={form.answers[comp.key]}
                      onChange={val => setRating(comp.key, val)}
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Comments (optional)</label>
                <textarea
                  value={form.answers.comments}
                  onChange={e => setForm(f => ({ ...f, answers: { ...f.answers, comments: e.target.value } }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Additional feedback or suggestions..."
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <p className="text-xs text-gray-400">Your response is completely anonymous.</p>
                <Button type="submit" disabled={submitting} className="flex items-center gap-2">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                  Submit Feedback
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {activeTab === 'my' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Based on <span className="font-semibold text-gray-700">{reviewerCount}</span> anonymous reviewer{reviewerCount !== 1 ? 's' : ''}
            </p>
          </div>

          {reviewerCount === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Award className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No feedback received yet. Ask colleagues to rate you.
            </div>
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4" /> Your Competency Scores</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {COMPETENCIES.map(comp => {
                  const score = scores[comp.key] ?? 0;
                  return (
                    <div key={comp.key}>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-700">{comp.label}</span>
                        <span className="text-sm text-gray-500">{score.toFixed(1)} / 5</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  );
                })}
                {scores.comments && (
                  <div className="pt-4 border-t">
                    <p className="text-sm font-medium text-gray-700 mb-1">Collected Comments</p>
                    <p className="text-sm text-gray-600 italic">{scores.comments}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
