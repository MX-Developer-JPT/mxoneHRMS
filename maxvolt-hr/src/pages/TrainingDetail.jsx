import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ArrowLeft, Users, Calendar, FileText, Link2, Upload, Check, X, UserPlus, Star } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function TrainingDetail() {
  const params = new URLSearchParams(window.location.search);
  const programId = params.get('id');

  const [user, setUser] = useState(null);
  const [program, setProgram] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showSessionForm, setShowSessionForm] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const [sessionForm, setSessionForm] = useState({ batch_name: '', start_date: '', end_date: '', duration_hours: '', location: '', meeting_link: '', capacity: 20, trainer_name: '', notes: '' });
  const [savingSession, setSavingSession] = useState(false);

  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [materialForm, setMaterialForm] = useState({ title: '', description: '', type: 'document', link_url: '', is_visible_before_session: true });
  const [materialFile, setMaterialFile] = useState(null);
  const [savingMaterial, setSavingMaterial] = useState(false);

  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [enrollSessionId, setEnrollSessionId] = useState('');
  const [enrollUserId, setEnrollUserId] = useState('');
  const [enrollType, setEnrollType] = useState('assigned');
  const [savingEnroll, setSavingEnroll] = useState(false);

  const [attendanceSession, setAttendanceSession] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null);

  useEffect(() => {
    loadData();
  }, [programId]);

  const loadData = async () => {
    setLoading(true);
    const [u, prog, sess, enr, mats, users, emps] = await Promise.all([
      base44.auth.me(),
      base44.entities.TrainingProgram.filter({ id: programId }),
      base44.entities.TrainingSession.filter({ training_program_id: programId }),
      base44.entities.EmployeeTraining.filter({ training_program_id: programId }),
      base44.entities.TrainingMaterial.filter({ training_program_id: programId }),
      base44.entities.User.list(),
      base44.entities.Employee.list(),
    ]);
    setUser(u);
    setProgram(prog?.[0] || null);
    setSessions(sess);
    setEnrollments(enr);
    setMaterials(mats);
    setAllUsers(users);
    setAllEmployees(emps);
    setLoading(false);
  };

  const getUserName = (userId) => {
    const u = allUsers.find(u => u.id === userId);
    return u ? (u.display_name || u.full_name) : userId;
  };

  // Sessions
  const openSessionForm = (sess = null) => {
    setEditSession(sess);
    setSessionForm(sess ? { ...sess, start_date: sess.start_date ? sess.start_date.slice(0, 16) : '', end_date: sess.end_date ? sess.end_date.slice(0, 16) : '' } : { batch_name: '', start_date: '', end_date: '', duration_hours: '', location: '', meeting_link: '', capacity: 20, trainer_name: program?.trainer_name || '', notes: '' });
    setShowSessionForm(true);
  };

  const saveSession = async () => {
    if (!programId) return;
    setSavingSession(true);
    // Strip empty strings from optional fields to avoid validation errors
    const raw = { ...sessionForm, training_program_id: programId };
    const data = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v !== null && v !== undefined));
    if (editSession) {
      await base44.entities.TrainingSession.update(editSession.id, data);
    } else {
      await base44.entities.TrainingSession.create(data);
    }
    setShowSessionForm(false);
    setSavingSession(false);
    loadData();
  };

  // Materials
  const saveMaterial = async () => {
    if (!programId) return;
    setSavingMaterial(true);
    let file_url = materialForm.file_url || '';
    if (materialFile) {
      const res = await base44.integrations.Core.UploadFile({ file: materialFile });
      file_url = res.file_url;
    }
    await base44.entities.TrainingMaterial.create({ ...materialForm, file_url, training_program_id: programId, uploaded_by: user.id });
    setShowMaterialForm(false);
    setSavingMaterial(false);
    setMaterialFile(null);
    setMaterialForm({ title: '', description: '', type: 'document', link_url: '', is_visible_before_session: true });
    loadData();
  };

  // Enrollments
  const saveEnrollment = async () => {
    setSavingEnroll(true);
    const session = sessions.find(s => s.id === enrollSessionId);
    const existingCount = enrollments.filter(e => e.training_session_id === enrollSessionId).length;
    if (session && existingCount >= (session.capacity || 20)) {
      alert('Session is at full capacity.');
      setSavingEnroll(false);
      return;
    }
    // check duplicate
    const dup = enrollments.find(e => e.training_session_id === enrollSessionId && e.user_id === enrollUserId);
    if (dup) { alert('Employee already enrolled in this session.'); setSavingEnroll(false); return; }
    await base44.entities.EmployeeTraining.create({ user_id: enrollUserId, training_session_id: enrollSessionId, training_program_id: programId, enrollment_type: enrollType, nominated_by: user.id, status: 'approved' });
    // update enrolled count
    await base44.entities.TrainingSession.update(enrollSessionId, { enrolled_count: existingCount + 1 });
    setShowEnrollForm(false);
    setSavingEnroll(false);
    setEnrollUserId('');
    loadData();
  };

  const markAttendance = async (enrollId, present) => {
    await base44.entities.EmployeeTraining.update(enrollId, { attendance_marked: true, status: present ? 'attended' : 'not_attended' });
    loadData();
  };

  const completeTraining = async (enrollId) => {
    await base44.entities.EmployeeTraining.update(enrollId, { status: 'completed', completion_date: new Date().toISOString().slice(0, 10) });
    loadData();
  };

  if (!programId) return <div className="p-8 text-center text-gray-400">No program selected. <a href="/TrainingManagement" className="text-blue-600 underline">Go back</a></div>;
  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;
  if (!program) return <div className="p-8 text-center text-gray-400">Program not found.</div>;

  const statusColor = { scheduled: 'bg-blue-100 text-blue-700', ongoing: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600', cancelled: 'bg-red-100 text-red-600' };
  const enrollStatusColor = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600', attended: 'bg-blue-100 text-blue-700', completed: 'bg-purple-100 text-purple-700', not_attended: 'bg-gray-100 text-gray-500' };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={createPageUrl('TrainingManagement')}>
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{program.title}</h1>
          <p className="text-sm text-gray-500">{program.category?.replace('_', ' ')} · {program.mode} · {program.trainer_name}</p>
        </div>
        <Badge className={program.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>{program.status}</Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments ({enrollments.length})</TabsTrigger>
          <TabsTrigger value="materials">Materials ({materials.length})</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm text-gray-600">Objective</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-gray-800">{program.objective}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-gray-600">Description</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-gray-800">{program.description || 'No description added.'}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-gray-600">Trainer Details</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p><span className="text-gray-500">Name:</span> {program.trainer_name || 'TBD'}</p>
                <p><span className="text-gray-500">Type:</span> {program.trainer_type}</p>
                <p><span className="text-gray-500">Contact:</span> {program.trainer_contact || '—'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-gray-600">Stats</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-center p-2 bg-blue-50 rounded-lg"><p className="text-2xl font-bold text-blue-600">{sessions.length}</p><p className="text-gray-500">Sessions</p></div>
                <div className="text-center p-2 bg-purple-50 rounded-lg"><p className="text-2xl font-bold text-purple-600">{enrollments.length}</p><p className="text-gray-500">Enrolled</p></div>
                <div className="text-center p-2 bg-green-50 rounded-lg"><p className="text-2xl font-bold text-green-600">{enrollments.filter(e => e.status === 'completed').length}</p><p className="text-gray-500">Completed</p></div>
                <div className="text-center p-2 bg-orange-50 rounded-lg"><p className="text-2xl font-bold text-orange-600">{materials.length}</p><p className="text-gray-500">Materials</p></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Sessions */}
        <TabsContent value="sessions">
          <div className="flex justify-end mb-4">
            <Button onClick={() => openSessionForm()} className="bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2" />Add Session / Batch</Button>
          </div>
          <div className="space-y-3">
            {sessions.map(sess => (
              <Card key={sess.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{sess.batch_name || 'Batch'}</span>
                        <Badge className={`text-xs ${statusColor[sess.status]}`}>{sess.status}</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-500">
                        <span>📅 {sess.start_date ? safeDate(sess.start_date, 'MMM d, yyyy h:mm a') : 'TBD'}</span>
                        <span>⏱ {sess.duration_hours}h</span>
                        <span>👥 {enrollments.filter(e => e.training_session_id === sess.id).length} / {sess.capacity}</span>
                        <span>📍 {sess.location || sess.meeting_link || '—'}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => openSessionForm(sess)}>Edit</Button>
                      <Button size="sm" className="text-xs bg-purple-600 hover:bg-purple-700" onClick={() => { setEnrollSessionId(sess.id); setShowEnrollForm(true); }}>
                        <UserPlus className="w-3 h-3 mr-1" />Enroll
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => setAttendanceSession(sess)}>
                        <Check className="w-3 h-3 mr-1" />Attendance
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {sessions.length === 0 && <p className="text-center text-gray-400 py-10">No sessions yet. Create a batch to get started.</p>}
          </div>
        </TabsContent>

        {/* Enrollments */}
        <TabsContent value="enrollments">
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-2 px-3 text-xs font-semibold text-gray-500 uppercase">
              <span>Employee</span><span>Session</span><span>Type</span><span>Status</span><span>Actions</span>
            </div>
            {enrollments.map(enr => {
              const sess = sessions.find(s => s.id === enr.training_session_id);
              return (
                <Card key={enr.id}>
                  <CardContent className="p-3">
                    <div className="grid grid-cols-5 gap-2 items-center text-sm">
                      <span className="font-medium truncate min-w-0">{getUserName(enr.user_id)}</span>
                      <span className="text-gray-500 text-xs truncate min-w-0">{sess?.batch_name || 'Batch'}</span>
                      <Badge variant="outline" className="text-xs w-fit">{enr.enrollment_type}</Badge>
                      <Badge className={`text-xs w-fit ${enrollStatusColor[enr.status]}`}>{enr.status}</Badge>
                      <div className="flex gap-1">
                        {enr.status === 'approved' && (
                          <>
                            <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700" onClick={() => markAttendance(enr.id, true)}>Present</Button>
                            <Button size="sm" variant="outline" className="text-xs h-7 text-red-500" onClick={() => markAttendance(enr.id, false)}>Absent</Button>
                          </>
                        )}
                        {enr.status === 'attended' && (
                          <Button size="sm" className="text-xs h-7 bg-purple-600 hover:bg-purple-700" onClick={() => completeTraining(enr.id)}>Complete</Button>
                        )}
                        {enr.status === 'completed' && <span className="text-green-600 text-xs">✓ Done</span>}
                      </div>
                    </div>
                    {(enr.pre_assessment_score != null || enr.post_assessment_score != null || enr.feedback_rating) && (
                      <div className="mt-2 flex gap-4 text-xs text-gray-500">
                        {enr.pre_assessment_score != null && <span>Pre: {enr.pre_assessment_score}%</span>}
                        {enr.post_assessment_score != null && <span>Post: {enr.post_assessment_score}%</span>}
                        {enr.feedback_rating && <span>⭐ {enr.feedback_rating}/5</span>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {enrollments.length === 0 && <p className="text-center text-gray-400 py-10">No enrollments yet.</p>}
          </div>
        </TabsContent>

        {/* Materials */}
        <TabsContent value="materials">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowMaterialForm(true)} className="bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2" />Add Material</Button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {materials.map(mat => (
              <Card key={mat.id}>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    {mat.type === 'link' ? <Link2 className="w-5 h-5 text-blue-600" /> : <FileText className="w-5 h-5 text-blue-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{mat.title}</p>
                    <p className="text-xs text-gray-500">{mat.description}</p>
                    <Badge variant="outline" className="text-xs mt-1">{mat.type}</Badge>
                    {(mat.file_url || mat.link_url) && (
                      mat.type === 'link'
                        ? <a href={mat.link_url} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-600 hover:underline mt-1">Open →</a>
                        : <button onClick={() => setViewerDoc({ url: mat.file_url, title: mat.title })} className="block text-xs text-blue-600 hover:underline mt-1 text-left">Open →</button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {materials.length === 0 && <p className="col-span-2 text-center text-gray-400 py-10">No materials uploaded yet.</p>}
          </div>
        </TabsContent>
      </Tabs>

      {/* Session Form Dialog */}
      <Dialog open={showSessionForm} onOpenChange={setShowSessionForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editSession ? 'Edit Session' : 'New Session / Batch'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Batch Name</label>
                <Input value={sessionForm.batch_name} onChange={e => setSessionForm({ ...sessionForm, batch_name: e.target.value })} placeholder="e.g. Batch 1" className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Duration (hours)</label>
                <Input type="number" value={sessionForm.duration_hours} onChange={e => setSessionForm({ ...sessionForm, duration_hours: e.target.value })} placeholder="e.g. 8" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Start Date & Time</label>
                <Input type="datetime-local" value={sessionForm.start_date} onChange={e => setSessionForm({ ...sessionForm, start_date: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">End Date & Time</label>
                <Input type="datetime-local" value={sessionForm.end_date} onChange={e => setSessionForm({ ...sessionForm, end_date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Capacity</label>
                <Input type="number" value={sessionForm.capacity} onChange={e => setSessionForm({ ...sessionForm, capacity: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Trainer Name</label>
                <Input value={sessionForm.trainer_name} onChange={e => setSessionForm({ ...sessionForm, trainer_name: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Location / Meeting Link</label>
              <Input value={sessionForm.location || sessionForm.meeting_link} onChange={e => setSessionForm({ ...sessionForm, location: e.target.value, meeting_link: e.target.value })} placeholder="Room no. or https://..." className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select value={sessionForm.status || 'scheduled'} onValueChange={v => setSessionForm({ ...sessionForm, status: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowSessionForm(false)}>Cancel</Button>
              <Button onClick={saveSession} disabled={savingSession} className="bg-blue-600 hover:bg-blue-700">{savingSession ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Material Form Dialog */}
      <Dialog open={showMaterialForm} onOpenChange={setShowMaterialForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Training Material</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input value={materialForm.title} onChange={e => setMaterialForm({ ...materialForm, title: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={materialForm.type} onValueChange={v => setMaterialForm({ ...materialForm, type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="link">Link</SelectItem>
                  <SelectItem value="presentation">Presentation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {materialForm.type === 'link' ? (
              <div>
                <label className="text-sm font-medium">URL</label>
                <Input value={materialForm.link_url} onChange={e => setMaterialForm({ ...materialForm, link_url: e.target.value })} placeholder="https://..." className="mt-1" />
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium">Upload File</label>
                <input type="file" onChange={e => setMaterialFile(e.target.files[0])} className="mt-1 w-full text-sm" />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input value={materialForm.description} onChange={e => setMaterialForm({ ...materialForm, description: e.target.value })} className="mt-1" />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowMaterialForm(false)}>Cancel</Button>
              <Button onClick={saveMaterial} disabled={savingMaterial} className="bg-blue-600 hover:bg-blue-700">{savingMaterial ? 'Uploading...' : 'Save'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DocViewerModal
        open={!!viewerDoc}
        url={viewerDoc?.url}
        title={viewerDoc?.title}
        onClose={() => setViewerDoc(null)}
      />

      {/* Enroll Dialog */}
      <Dialog open={showEnrollForm} onOpenChange={setShowEnrollForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Enroll Employee</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium">Session</label>
              <Select value={enrollSessionId} onValueChange={setEnrollSessionId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select session" /></SelectTrigger>
                <SelectContent>
                  {sessions.map(s => <SelectItem key={s.id} value={s.id}>{s.batch_name || 'Batch'} – {s.start_date ? safeDate(s.start_date, 'MMM d') : 'TBD'}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Employee</label>
              <Select value={enrollUserId} onValueChange={setEnrollUserId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.display_name || u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Enrollment Type</label>
              <Select value={enrollType} onValueChange={setEnrollType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="assigned">Assigned by HR</SelectItem>
                  <SelectItem value="nominated">Nominated by Manager</SelectItem>
                  <SelectItem value="self">Self Enrolled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowEnrollForm(false)}>Cancel</Button>
              <Button onClick={saveEnrollment} disabled={savingEnroll || !enrollSessionId || !enrollUserId} className="bg-purple-600 hover:bg-purple-700">{savingEnroll ? 'Enrolling...' : 'Enroll'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}