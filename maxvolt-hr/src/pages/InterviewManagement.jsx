import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, Video, Star, Mail, Loader2, User, CheckCircle, XCircle, MessageCircle, Clock, Search, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function InterviewManagement() {
  const [user, setUser] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showFeedback, setShowFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [rescheduleInterview, setRescheduleInterview] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [justScheduled, setJustScheduled] = useState(null);

  const [candOpen, setCandOpen] = useState(false);
  const [interviewerOpen, setInterviewerOpen] = useState(false);
  const [formData, setFormData] = useState({
    candidate_id: '',
    interviewer_id: '',
    round_number: 1,
    round_type: 'screening',
    scheduled_date: '',
    scheduled_time: '',
    duration_minutes: 60,
    interview_mode: 'video',
    meeting_link: '',
    location: ''
  });

  const [feedbackData, setFeedbackData] = useState({
    rating: 3,
    recommendation: 'recommend',
    technical_skills: 3,
    communication: 3,
    problem_solving: 3,
    cultural_fit: 3,
    experience_relevance: 3,
    strengths: '',
    areas_of_improvement: '',
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const [allInterviews, activeCandidates, usersRes, empRecords] = await Promise.all([
        base44.entities.Interview.list('-scheduled_date', 500),
        base44.entities.Candidate.list('-created_date', 500),
        base44.functions.invoke('getAllUsers', {}),
        base44.entities.Employee.filter({ status: 'active' })
      ]);

      setInterviews(allInterviews);
      setCandidates(activeCandidates);
      setEmployees(empRecords);
      const usersArray = Array.isArray(usersRes?.data?.users) ? usersRes.data.users : Array.isArray(usersRes?.data) ? usersRes.data : Array.isArray(usersRes) ? usersRes : [];
      setAllUsers(usersArray);
      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const getEmployeeDetails = (userId) => {
    const emp = employees.find(e => e.user_id === userId);
    const usr = allUsers.find(u => u.id === userId);
    return {
      name: emp?.display_name || usr?.full_name || userId,
      designation: emp?.designation || '',
      department: emp?.department || ''
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setScheduling(true);
    try {
      const scheduledDateTime = `${formData.scheduled_date}T${formData.scheduled_time}:00`;

      const interviewRecord = await base44.entities.Interview.create({
        candidate_id: formData.candidate_id,
        round_number: parseInt(formData.round_number),
        round_type: formData.round_type,
        scheduled_date: scheduledDateTime,
        duration_minutes: parseInt(formData.duration_minutes),
        interview_mode: formData.interview_mode,
        meeting_link: formData.meeting_link,
        location: formData.location,
        interviewer_ids: formData.interviewer_id ? [formData.interviewer_id] : [user.id],
        status: 'scheduled'
      });

      await base44.entities.Candidate.update(formData.candidate_id, {
        status: 'interview_scheduled',
        interview_date: scheduledDateTime,
        interviewer_id: formData.interviewer_id || user.id
      });

      // Send email notifications
      try {
        await base44.functions.invoke('sendInterviewEmail', {
          candidate_id: formData.candidate_id,
          interview_id: interviewRecord.id,
          scheduled_date: scheduledDateTime,
          meeting_link: formData.meeting_link,
          interview_mode: formData.interview_mode,
          location: formData.location,
          round_type: formData.round_type,
          round_number: parseInt(formData.round_number),
          duration_minutes: parseInt(formData.duration_minutes),
          interviewer_id: formData.interviewer_id || user.id
        });
        toast.success('Interview scheduled & email notifications sent!');
        setJustScheduled({ candidate_id: formData.candidate_id, interview_id: interviewRecord.id });
      } catch (emailErr) {
        console.error('Email failed:', emailErr);
        toast.success('Interview scheduled (email notification failed)');
        setJustScheduled({ candidate_id: formData.candidate_id, interview_id: interviewRecord.id });
      }

      setShowForm(false);
      resetForm();
      loadData();
    } catch (error) {
      toast.error('Failed to schedule interview');
    }
    setScheduling(false);
  };

  const handleReschedule = async () => {
    if (!rescheduleInterview || !rescheduleDate || !rescheduleTime) return;
    try {
      const newDateTime = `${rescheduleDate}T${rescheduleTime}:00`;
      await base44.entities.Interview.update(rescheduleInterview.id, {
        scheduled_date: newDateTime,
        status: 'rescheduled'
      });
      await base44.entities.Candidate.update(rescheduleInterview.candidate_id, {
        interview_date: newDateTime
      });
      toast.success('Interview rescheduled');
      setRescheduleInterview(null);
      setRescheduleDate('');
      setRescheduleTime('');
      loadData();
    } catch (error) {
      toast.error('Failed to reschedule interview');
    }
  };

  const handleWhatsAppAck = (candidate) => {
    if (!candidate?.phone) {
      toast.error('Candidate phone number not available');
      return;
    }
    const phone = candidate.phone.replace(/[^+\d]/g, '');
    const msg = encodeURIComponent(
      `Dear ${candidate.full_name},\n\n` +
      `Your interview has been scheduled. Please check your email for the complete details including date, time, and meeting link.\n\n` +
      `Kindly acknowledge receipt of this message.\n\n` +
      `Thank you,\nMaxvolt Energy HR Team`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  const resetForm = () => {
    setFormData({
      candidate_id: '',
      interviewer_id: '',
      round_number: 1,
      round_type: 'screening',
      scheduled_date: '',
      scheduled_time: '',
      duration_minutes: 60,
      interview_mode: 'video',
      meeting_link: '',
      location: ''
    });
  };

  const handleSubmitFeedback = async (e) => {
    e.preventDefault();
    try {
      const overallRating = Math.round(
        (feedbackData.technical_skills + feedbackData.communication + feedbackData.problem_solving + feedbackData.cultural_fit + feedbackData.experience_relevance) / 5
      );
      await base44.entities.Interview.update(showFeedback.id, {
        status: 'completed',
        rating: overallRating,
        recommendation: feedbackData.recommendation,
        notes: feedbackData.notes,
        feedback: {
          interviewer_id: user.id,
          submitted_at: new Date().toISOString(),
          rating: overallRating,
          recommendation: feedbackData.recommendation,
          technical_skills: feedbackData.technical_skills,
          communication: feedbackData.communication,
          problem_solving: feedbackData.problem_solving,
          cultural_fit: feedbackData.cultural_fit,
          experience_relevance: feedbackData.experience_relevance,
          strengths: feedbackData.strengths,
          areas_of_improvement: feedbackData.areas_of_improvement,
          notes: feedbackData.notes
        }
      });

      const candidate = candidates.find(c => c.id === showFeedback.candidate_id);
      if (candidate && feedbackData.recommendation === 'reject') {
        await base44.entities.Candidate.update(candidate.id, { status: 'rejected', interview_feedback: feedbackData.notes });
      } else if (candidate) {
        await base44.entities.Candidate.update(candidate.id, { status: 'interviewed', interview_feedback: feedbackData.notes });
      }

      toast.success('Feedback submitted');
      setShowFeedback(null);
      setFeedbackData({ rating: 3, recommendation: 'recommend', technical_skills: 3, communication: 3, problem_solving: 3, cultural_fit: 3, experience_relevance: 3, strengths: '', areas_of_improvement: '', notes: '' });
      loadData();
    } catch (error) {
      toast.error('Failed to submit feedback');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const statusColors = {
    scheduled: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    rescheduled: 'bg-yellow-100 text-yellow-800',
    no_show: 'bg-orange-100 text-orange-800'
  };

  const upcomingInterviews = interviews.filter(i => i.status === 'scheduled' && new Date(i.scheduled_date) > new Date());
  const completedInterviews = interviews.filter(i => i.status === 'completed');

  const statusFiltered = statusFilter === 'all' ? interviews
    : statusFilter === 'upcoming' ? upcomingInterviews
    : statusFilter === 'completed' ? completedInterviews
    : interviews;

  const displayedInterviews = searchQuery.trim()
    ? statusFiltered.filter(i => {
        const q = searchQuery.toLowerCase();
        const candidate = candidates.find(c => c.id === i.candidate_id);
        const interviewerDet = i.interviewer_ids?.[0] ? getEmployeeDetails(i.interviewer_ids[0]) : null;
        return (
          candidate?.full_name?.toLowerCase().includes(q) ||
          candidate?.position_applied?.toLowerCase().includes(q) ||
          interviewerDet?.name?.toLowerCase().includes(q) ||
          i.round_type?.toLowerCase().includes(q) ||
          i.interview_mode?.toLowerCase().includes(q)
        );
      })
    : statusFiltered;

  // Interviewers: all users (any role can interview)
  const interviewerOptions = allUsers;

  // Candidates eligible for interview scheduling (not yet rejected/selected/joined/offered)
  const schedulableCandidates = candidates.filter(c =>
    !['rejected', 'selected', 'offered', 'joined'].includes(c.status)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Interview Management</h1>
            <p className="text-gray-600 mt-1">Schedule and track candidate interviews</p>
          </div>
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-5 h-5 mr-2" />
                Schedule Interview
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Schedule Interview</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Candidate *</Label>
                  <Popover open={candOpen} onOpenChange={setCandOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                        <span className={formData.candidate_id ? 'text-foreground' : 'text-muted-foreground'}>
                          {formData.candidate_id ? (() => { const c = schedulableCandidates.find(c => c.id === formData.candidate_id); return c ? `${c.full_name} — ${c.position_applied}` : 'Select candidate'; })() : 'Select candidate'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[360px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search candidate..." />
                        <CommandList>
                          <CommandEmpty>No candidate found.</CommandEmpty>
                          <CommandGroup>
                            {schedulableCandidates.map(c => (
                              <CommandItem
                                key={c.id}
                                value={`${c.full_name} ${c.position_applied || ''}`}
                                onSelect={() => { setFormData({ ...formData, candidate_id: c.id }); setCandOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${formData.candidate_id === c.id ? 'opacity-100' : 'opacity-0'}`} />
                                <div>
                                  <p className="font-medium">{c.full_name}</p>
                                  <p className="text-xs text-muted-foreground">{c.position_applied}</p>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Interviewer Selector */}
                <div>
                  <Label className="flex items-center gap-2"><User className="w-4 h-4" /> Interviewer *</Label>
                  <Popover open={interviewerOpen} onOpenChange={setInterviewerOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                        <span className={formData.interviewer_id ? 'text-foreground' : 'text-muted-foreground'}>
                          {formData.interviewer_id ? (() => { const d = getEmployeeDetails(formData.interviewer_id); return `${d.name}${d.designation ? ` — ${d.designation}` : ''}`; })() : 'Select interviewer'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[360px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search interviewer..." />
                        <CommandList>
                          <CommandEmpty>No interviewer found.</CommandEmpty>
                          <CommandGroup>
                            {interviewerOptions.map(u => {
                              const d = getEmployeeDetails(u.id);
                              return (
                                <CommandItem
                                  key={u.id}
                                  value={`${d.name} ${d.designation || ''} ${d.department || ''}`}
                                  onSelect={() => { setFormData({ ...formData, interviewer_id: u.id }); setInterviewerOpen(false); }}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${formData.interviewer_id === u.id ? 'opacity-100' : 'opacity-0'}`} />
                                  <div>
                                    <p className="font-medium">{d.name}</p>
                                    <p className="text-xs text-muted-foreground">{d.designation}{d.department ? ` · ${d.department}` : ''}</p>
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {formData.interviewer_id && (() => {
                    const d = getEmployeeDetails(formData.interviewer_id);
                    return (
                      <p className="text-xs text-gray-500 mt-1">
                        {d.name}{d.designation ? ` · ${d.designation}` : ''}{d.department ? ` · ${d.department}` : ''}
                      </p>
                    );
                  })()}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Round Number</Label>
                    <Input type="number" min="1" value={formData.round_number} onChange={(e) => setFormData({ ...formData, round_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>Round Type</Label>
                    <Select value={formData.round_type} onValueChange={(v) => setFormData({ ...formData, round_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="screening">Screening</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="hr">HR</SelectItem>
                        <SelectItem value="managerial">Managerial</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date *</Label>
                    <Input type="date" value={formData.scheduled_date} onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Time *</Label>
                    <Input type="time" value={formData.scheduled_time} onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Duration (minutes)</Label>
                    <Input type="number" value={formData.duration_minutes} onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value })} />
                  </div>
                  <div>
                    <Label>Interview Mode</Label>
                    <Select value={formData.interview_mode} onValueChange={(v) => setFormData({ ...formData, interview_mode: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="video">Video</SelectItem>
                        <SelectItem value="in_person">In Person</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {formData.interview_mode === 'video' && (
                  <div>
                    <Label>Meeting Link</Label>
                    <Input value={formData.meeting_link} onChange={(e) => setFormData({ ...formData, meeting_link: e.target.value })} placeholder="https://meet.google.com/..." />
                  </div>
                )}
                {formData.interview_mode === 'in_person' && (
                  <div>
                    <Label>Location</Label>
                    <Input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} />
                  </div>
                )}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 flex-shrink-0" />
                  Email notifications will be sent to the candidate and the selected interviewer upon scheduling.
                </div>
                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  <Button type="submit" disabled={scheduling}>
                    {scheduling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scheduling...</> : 'Schedule & Notify'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { key: 'upcoming', label: 'Upcoming', value: upcomingInterviews.length, icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-100' },
            { key: 'completed', label: 'Completed', value: completedInterviews.length, icon: Star, color: 'text-green-600', bg: 'bg-green-100' },
            { key: 'all', label: 'Total Interviews', value: interviews.length, icon: Video, color: 'text-purple-600', bg: 'bg-purple-100' },
          ].map(s => (
            <Card key={s.key} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter(s.key)}>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className={`p-4 ${s.bg} rounded-full`}>
                    <s.icon className={`w-8 h-8 ${s.color}`} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">{s.label}</p>
                    <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle>
                {statusFilter === 'upcoming' ? 'Upcoming Interviews' : statusFilter === 'completed' ? 'Completed Interviews' : 'All Interviews'}
                {statusFilter !== 'all' && <button className="ml-2 text-xs text-blue-500 font-normal" onClick={() => setStatusFilter('all')}>Clear filter ×</button>}
              </CardTitle>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  placeholder="Search by name, position, interviewer…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {displayedInterviews.map(interview => {
                const candidate = candidates.find(c => c.id === interview.candidate_id);
                const primaryInterviewerId = interview.interviewer_ids?.[0];
                const interviewerDetails = primaryInterviewerId ? getEmployeeDetails(primaryInterviewerId) : null;
                return (
                  <div key={interview.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold">{candidate?.full_name || 'Unknown'}</h3>
                          <Badge className={statusColors[interview.status]}>{interview.status.toUpperCase()}</Badge>
                          <Badge variant="outline" className="capitalize">{interview.round_type}</Badge>
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <p>Round {interview.round_number} | {interview.interview_mode} | {interview.duration_minutes} mins</p>
                          <p>Scheduled: {safeDate(interview.scheduled_date, 'PPP p')}</p>
                          {interview.meeting_link && (
                            <p>
                              Link: <a href={interview.meeting_link} target="_blank" rel="noreferrer" className="text-blue-600 underline">{interview.meeting_link}</a>
                            </p>
                          )}
                          {interviewerDetails && (
                            <p className="flex items-center gap-1">
                              <User className="w-3 h-3 text-gray-400" />
                              Interviewer: <strong>{interviewerDetails.name}</strong>
                              {interviewerDetails.designation ? ` · ${interviewerDetails.designation}` : ''}
                              {interviewerDetails.department ? ` · ${interviewerDetails.department}` : ''}
                            </p>
                          )}
                          {interview.rating && (
                            <p className="flex items-center gap-1">
                              Rating: {interview.rating}/5
                              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            </p>
                          )}
                        </div>
                      </div>
                      {interview.status === 'scheduled' && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => setShowFeedback(interview)}>
                            Add Feedback
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => {
                            setRescheduleInterview(interview);
                            const d = new Date(interview.scheduled_date);
                            setRescheduleDate(d.toISOString().split('T')[0]);
                            setRescheduleTime(d.toTimeString().slice(0, 5));
                          }}>
                            <Clock className="w-3 h-3 mr-1" /> Reschedule
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {displayedInterviews.length === 0 && (
                <p className="text-center text-gray-500 py-8">No interviews scheduled</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Acknowledgement Prompt */}
        {justScheduled && (() => {
          const candidate = candidates.find(c => c.id === justScheduled.candidate_id);
          return (
            <Dialog open={!!justScheduled} onOpenChange={() => setJustScheduled(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Interview Scheduled!</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Email notifications have been sent to <strong>{candidate?.full_name}</strong>.
                  </p>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                    <p className="font-medium text-green-800 flex items-center gap-2">
                      <MessageCircle className="w-4 h-4" /> Send WhatsApp Acknowledgement
                    </p>
                    <p className="text-green-700 text-xs mt-1">
                      Opens WhatsApp with a pre-filled message asking the candidate to check their email and acknowledge.
                    </p>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={() => setJustScheduled(null)}>Skip</Button>
                    <Button className="bg-green-600 hover:bg-green-700" onClick={() => {
                      handleWhatsAppAck(candidate);
                      setJustScheduled(null);
                    }}>
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Send on WhatsApp
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          );
        })()}

        {/* Reschedule Dialog */}
        {rescheduleInterview && (
          <Dialog open={!!rescheduleInterview} onOpenChange={() => setRescheduleInterview(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Reschedule Interview</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Rescheduling for <strong>{candidates.find(c => c.id === rescheduleInterview.candidate_id)?.full_name}</strong>
                </p>
                <div>
                  <Label>New Date *</Label>
                  <Input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} />
                </div>
                <div>
                  <Label>New Time *</Label>
                  <Input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} />
                </div>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setRescheduleInterview(null)}>Cancel</Button>
                  <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleReschedule}
                    disabled={!rescheduleDate || !rescheduleTime}>
                    Confirm Reschedule
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {showFeedback && (
          <Dialog open={!!showFeedback} onOpenChange={() => setShowFeedback(null)}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Interview Feedback — {candidates.find(c => c.id === showFeedback.candidate_id)?.full_name}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmitFeedback} className="space-y-5">
                {/* Skill Ratings */}
                <div className="space-y-3">
                  <p className="font-semibold text-sm text-gray-700">Rate the candidate (1 = Poor, 5 = Excellent)</p>
                  {[
                    { key: 'technical_skills', label: 'Technical Skills / Domain Knowledge' },
                    { key: 'communication', label: 'Communication & Presentation' },
                    { key: 'problem_solving', label: 'Problem Solving & Analytical Thinking' },
                    { key: 'cultural_fit', label: 'Cultural Fit & Attitude' },
                    { key: 'experience_relevance', label: 'Relevance of Experience' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-4 p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm flex-1">{label}</span>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setFeedbackData({ ...feedbackData, [key]: n })}
                            className={`w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                              feedbackData[key] >= n
                                ? 'bg-blue-600 text-white'
                                : 'bg-white border border-gray-300 text-gray-500 hover:bg-blue-50'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500 text-right">
                    Overall avg: <strong>{((feedbackData.technical_skills + feedbackData.communication + feedbackData.problem_solving + feedbackData.cultural_fit + feedbackData.experience_relevance) / 5).toFixed(1)}</strong> / 5
                  </p>
                </div>

                {/* Strengths */}
                <div>
                  <Label>Key Strengths Observed</Label>
                  <Textarea
                    rows={2}
                    placeholder="What did the candidate do well? (e.g., strong technical background, excellent communication...)"
                    value={feedbackData.strengths}
                    onChange={(e) => setFeedbackData({ ...feedbackData, strengths: e.target.value })}
                  />
                </div>

                {/* Improvement */}
                <div>
                  <Label>Areas of Improvement / Concerns</Label>
                  <Textarea
                    rows={2}
                    placeholder="What gaps or concerns were identified? (e.g., lacks hands-on experience in X...)"
                    value={feedbackData.areas_of_improvement}
                    onChange={(e) => setFeedbackData({ ...feedbackData, areas_of_improvement: e.target.value })}
                  />
                </div>

                {/* Overall Notes */}
                <div>
                  <Label>Additional Notes / Comments</Label>
                  <Textarea
                    rows={3}
                    placeholder="Any other observations, follow-up questions for next round, salary expectations discussed..."
                    value={feedbackData.notes}
                    onChange={(e) => setFeedbackData({ ...feedbackData, notes: e.target.value })}
                  />
                </div>

                {/* Recommendation */}
                <div>
                  <Label className="mb-2 block">Final Recommendation</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { value: 'strongly_recommend', label: 'Strongly Recommend', color: 'green' },
                      { value: 'recommend', label: 'Recommend', color: 'blue' },
                      { value: 'maybe', label: 'Maybe / On Hold', color: 'yellow' },
                      { value: 'not_recommend', label: 'Not Recommend', color: 'orange' },
                      { value: 'reject', label: 'Reject', color: 'red' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFeedbackData({ ...feedbackData, recommendation: opt.value })}
                        className={`p-3 rounded-lg border-2 text-sm font-medium transition-all text-center ${
                          feedbackData.recommendation === opt.value
                            ? opt.color === 'green' ? 'border-green-500 bg-green-50 text-green-700'
                            : opt.color === 'blue' ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : opt.color === 'yellow' ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                            : opt.color === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-700'
                            : 'border-red-500 bg-red-50 text-red-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowFeedback(null)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Submit Feedback</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}