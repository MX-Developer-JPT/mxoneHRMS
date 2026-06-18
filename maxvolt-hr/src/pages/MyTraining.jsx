import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, Calendar, Star, FileText, Link2, CheckCircle, Clock, Award, Plus, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';

const enrollStatusColor = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
  attended: 'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
  not_attended: 'bg-gray-100 text-gray-500',
};

export default function MyTraining() {
  const [user, setUser] = useState(null);
  const [myEnrollments, setMyEnrollments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [publishedPrograms, setPublishedPrograms] = useState([]);
  const [loading, setLoading] = useState(true);

  const [feedbackModal, setFeedbackModal] = useState(null);
  const [feedbackForm, setFeedbackForm] = useState({ feedback_rating: 5, feedback_comments: '', pre_assessment_score: '', post_assessment_score: '' });
  const [savingFeedback, setSavingFeedback] = useState(false);

  const [selfEnrollModal, setSelfEnrollModal] = useState(null);
  const [selfEnrollSessionId, setSelfEnrollSessionId] = useState('');
  const [savingSelfEnroll, setSavingSelfEnroll] = useState(false);

  const [needForm, setNeedForm] = useState({ description: '', skill_gap: '', priority: 'medium', source: 'self_request' });
  const [showNeedForm, setShowNeedForm] = useState(false);
  const [savingNeed, setSavingNeed] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const u = await base44.auth.me();
    setUser(u);
    const [enr, sess, progs, mats] = await Promise.all([
      base44.entities.EmployeeTraining.filter({ user_id: u.id }),
      base44.entities.TrainingSession.list('-start_date', 300),
      base44.entities.TrainingProgram.list('-created_date', 100),
      base44.entities.TrainingMaterial.list('-created_date', 200),
    ]);
    setMyEnrollments(enr);
    setSessions(sess);
    setPrograms(progs);
    setMaterials(mats);
    setPublishedPrograms(progs.filter(p => p.status === 'published'));
    setLoading(false);
  };

  const getSession = (id) => sessions.find(s => s.id === id);
  const getProgram = (id) => programs.find(p => p.id === id);
  const getProgramMaterials = (programId) => materials.filter(m => m.training_program_id === programId);

  const selfEnroll = async () => {
    setSavingSelfEnroll(true);
    const sess = sessions.find(s => s.id === selfEnrollSessionId);
    if (!sess) { setSavingSelfEnroll(false); return; }
    const dup = myEnrollments.find(e => e.training_session_id === selfEnrollSessionId);
    if (dup) { alert('Already enrolled.'); setSavingSelfEnroll(false); return; }
    await base44.entities.EmployeeTraining.create({
      user_id: user.id,
      training_session_id: selfEnrollSessionId,
      training_program_id: sess.training_program_id,
      enrollment_type: 'self',
      status: 'pending',
    });
    setSelfEnrollModal(null);
    setSelfEnrollSessionId('');
    setSavingSelfEnroll(false);
    loadData();
  };

  const submitFeedback = async () => {
    setSavingFeedback(true);
    await base44.entities.EmployeeTraining.update(feedbackModal.id, {
      feedback_rating: feedbackForm.feedback_rating,
      feedback_comments: feedbackForm.feedback_comments,
      pre_assessment_score: feedbackForm.pre_assessment_score ? parseFloat(feedbackForm.pre_assessment_score) : undefined,
      post_assessment_score: feedbackForm.post_assessment_score ? parseFloat(feedbackForm.post_assessment_score) : undefined,
    });
    setFeedbackModal(null);
    setSavingFeedback(false);
    loadData();
  };

  const submitNeed = async () => {
    setSavingNeed(true);
    await base44.entities.TrainingNeed.create({ ...needForm, requested_by: user.id, status: 'open' });
    setShowNeedForm(false);
    setSavingNeed(false);
    setNeedForm({ description: '', skill_gap: '', priority: 'medium', source: 'self_request' });
  };

  const stats = {
    enrolled: myEnrollments.length,
    completed: myEnrollments.filter(e => e.status === 'completed').length,
    attended: myEnrollments.filter(e => e.status === 'attended').length,
    pending: myEnrollments.filter(e => e.status === 'pending').length,
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Training</h1>
          <p className="text-sm text-gray-500 mt-1">View your trainings, materials, and track your progress</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowNeedForm(true)}><Plus className="w-4 h-4 mr-2" />Request Training</Button>
          <Button onClick={() => setSelfEnrollModal(true)} className="bg-blue-600 hover:bg-blue-700"><BookOpen className="w-4 h-4 mr-2" />Self Enroll</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Enrolled', value: stats.enrolled, color: 'text-blue-600' },
          { label: 'Completed', value: stats.completed, color: 'text-purple-600' },
          { label: 'Attended', value: stats.attended, color: 'text-green-600' },
          { label: 'Pending Approval', value: stats.pending, color: 'text-yellow-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-sm text-gray-500 mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="my_trainings">
        <TabsList className="mb-4">
          <TabsTrigger value="my_trainings">My Trainings</TabsTrigger>
          <TabsTrigger value="available">Available Programs</TabsTrigger>
          <TabsTrigger value="history">Training History</TabsTrigger>
        </TabsList>

        {/* My Trainings */}
        <TabsContent value="my_trainings">
          <div className="space-y-3">
            {myEnrollments.filter(e => e.status !== 'completed').map(enr => {
              const sess = getSession(enr.training_session_id);
              const prog = getProgram(enr.training_program_id);
              const mats = getProgramMaterials(enr.training_program_id);
              return (
                <Card key={enr.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-sm">{prog?.title}</p>
                          <Badge className={`text-xs ${enrollStatusColor[enr.status]}`}>{enr.status}</Badge>
                        </div>
                        <p className="text-xs text-gray-500">{sess?.batch_name} · {sess?.start_date ? format(new Date(sess.start_date), 'MMM d, yyyy') : 'TBD'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{prog?.mode} · {prog?.trainer_name}</p>
                        {mats.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {mats.slice(0, 3).map(m => (
                              <a key={m.id} href={m.file_url || m.link_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <FileText className="w-3 h-3" />{m.title}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {enr.status === 'attended' && !enr.feedback_rating && (
                          <Button size="sm" className="text-xs bg-yellow-500 hover:bg-yellow-600" onClick={() => { setFeedbackModal(enr); setFeedbackForm({ feedback_rating: 5, feedback_comments: '', pre_assessment_score: enr.pre_assessment_score || '', post_assessment_score: enr.post_assessment_score || '' }); }}>
                            <Star className="w-3 h-3 mr-1" />Feedback
                          </Button>
                        )}
                        {enr.feedback_rating && <span className="text-xs text-yellow-600">⭐ {enr.feedback_rating}/5 rated</span>}
                        {sess?.meeting_link && (
                          <a href={sess.meeting_link} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="text-xs"><ExternalLink className="w-3 h-3 mr-1" />Join</Button>
                          </a>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {myEnrollments.filter(e => e.status !== 'completed').length === 0 && (
              <div className="text-center text-gray-400 py-12">No active trainings. Enroll in a program to get started.</div>
            )}
          </div>
        </TabsContent>

        {/* Available Programs */}
        <TabsContent value="available">
          <div className="grid md:grid-cols-2 gap-4">
            {publishedPrograms.map(prog => {
              const alreadyEnrolled = myEnrollments.some(e => e.training_program_id === prog.id);
              const progSessions = sessions.filter(s => s.training_program_id === prog.id && s.status === 'scheduled');
              const mats = getProgramMaterials(prog.id);
              return (
                <Card key={prog.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{prog.title}</CardTitle>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="text-xs">{prog.mode}</Badge>
                      <Badge variant="outline" className="text-xs">{prog.category?.replace('_', ' ')}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">{prog.objective}</p>
                    <p className="text-xs text-gray-400 mb-2">Trainer: {prog.trainer_name}</p>
                    <p className="text-xs text-gray-400 mb-3">{progSessions.length} upcoming session(s) · {mats.length} materials</p>
                    {alreadyEnrolled ? (
                      <Badge className="bg-green-100 text-green-700">Already Enrolled</Badge>
                    ) : progSessions.length > 0 ? (
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs" onClick={() => { setSelfEnrollModal(true); }}>
                        <BookOpen className="w-3 h-3 mr-1" />Enroll
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-400">No upcoming sessions</span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {publishedPrograms.length === 0 && (
              <div className="col-span-2 text-center text-gray-400 py-12">No published training programs available.</div>
            )}
          </div>
        </TabsContent>

        {/* Training History */}
        <TabsContent value="history">
          <div className="space-y-3">
            {myEnrollments.filter(e => e.status === 'completed').map(enr => {
              const sess = getSession(enr.training_session_id);
              const prog = getProgram(enr.training_program_id);
              return (
                <Card key={enr.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                        <Award className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{prog?.title}</p>
                        <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                          <span>Completed: {enr.completion_date ? format(new Date(enr.completion_date), 'MMM d, yyyy') : '—'}</span>
                          {enr.pre_assessment_score != null && <span>Pre: {enr.pre_assessment_score}%</span>}
                          {enr.post_assessment_score != null && <span>Post: {enr.post_assessment_score}%</span>}
                          {enr.feedback_rating && <span>⭐ {enr.feedback_rating}/5</span>}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {enr.certificate_url ? (
                          <a href={enr.certificate_url} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="text-xs"><Award className="w-3 h-3 mr-1" />Certificate</Button>
                          </a>
                        ) : (
                          <Badge className="bg-purple-100 text-purple-700 text-xs">Completed</Badge>
                        )}
                        {!enr.feedback_rating && (
                          <Button size="sm" className="text-xs ml-2 bg-yellow-500 hover:bg-yellow-600" onClick={() => { setFeedbackModal(enr); setFeedbackForm({ feedback_rating: 5, feedback_comments: '', pre_assessment_score: '', post_assessment_score: '' }); }}>
                            <Star className="w-3 h-3 mr-1" />Feedback
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {myEnrollments.filter(e => e.status === 'completed').length === 0 && (
              <div className="text-center text-gray-400 py-12">No completed trainings yet.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Self Enroll Modal */}
      <Dialog open={!!selfEnrollModal} onOpenChange={() => { setSelfEnrollModal(null); setSelfEnrollSessionId(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Self Enrollment</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium">Select Session</label>
              <Select value={selfEnrollSessionId} onValueChange={setSelfEnrollSessionId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a session" /></SelectTrigger>
                <SelectContent>
                  {sessions.filter(s => s.status === 'scheduled').map(s => {
                    const prog = getProgram(s.training_program_id);
                    return <SelectItem key={s.id} value={s.id}>{prog?.title} – {s.batch_name} ({s.start_date ? format(new Date(s.start_date), 'MMM d') : 'TBD'})</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setSelfEnrollModal(null)}>Cancel</Button>
              <Button onClick={selfEnroll} disabled={savingSelfEnroll || !selfEnrollSessionId} className="bg-blue-600 hover:bg-blue-700">{savingSelfEnroll ? 'Enrolling...' : 'Enroll'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback Modal */}
      <Dialog open={!!feedbackModal} onOpenChange={() => setFeedbackModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Training Feedback</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium">Rating (1-5) *</label>
              <div className="flex gap-2 mt-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setFeedbackForm({ ...feedbackForm, feedback_rating: n })}
                    className={`w-9 h-9 rounded-full text-sm font-bold transition-colors ${feedbackForm.feedback_rating >= n ? 'bg-yellow-400 text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Comments</label>
              <textarea value={feedbackForm.feedback_comments} onChange={e => setFeedbackForm({ ...feedbackForm, feedback_comments: e.target.value })} rows={3} placeholder="Share your experience..." className="mt-1 w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Pre-Assessment Score (%)</label>
                <Input type="number" min={0} max={100} value={feedbackForm.pre_assessment_score} onChange={e => setFeedbackForm({ ...feedbackForm, pre_assessment_score: e.target.value })} className="mt-1" placeholder="0-100" />
              </div>
              <div>
                <label className="text-sm font-medium">Post-Assessment Score (%)</label>
                <Input type="number" min={0} max={100} value={feedbackForm.post_assessment_score} onChange={e => setFeedbackForm({ ...feedbackForm, post_assessment_score: e.target.value })} className="mt-1" placeholder="0-100" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setFeedbackModal(null)}>Cancel</Button>
              <Button onClick={submitFeedback} disabled={savingFeedback} className="bg-yellow-500 hover:bg-yellow-600">{savingFeedback ? 'Submitting...' : 'Submit Feedback'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Training Need Form */}
      <Dialog open={showNeedForm} onOpenChange={setShowNeedForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request Training</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium">What training do you need? *</label>
              <textarea value={needForm.description} onChange={e => setNeedForm({ ...needForm, description: e.target.value })} rows={3} placeholder="Describe the training you'd like..." className="mt-1 w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium">Skill Gap</label>
              <Input value={needForm.skill_gap} onChange={e => setNeedForm({ ...needForm, skill_gap: e.target.value })} placeholder="e.g. Excel, Communication" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <Select value={needForm.priority} onValueChange={v => setNeedForm({ ...needForm, priority: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowNeedForm(false)}>Cancel</Button>
              <Button onClick={submitNeed} disabled={savingNeed || !needForm.description} className="bg-blue-600 hover:bg-blue-700">{savingNeed ? 'Submitting...' : 'Submit Request'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}