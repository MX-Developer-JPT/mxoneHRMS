import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Calendar, Clock, MapPin, Users, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths, parseISO } from 'date-fns';

const modeColor = { online: 'bg-blue-100 text-blue-700', offline: 'bg-green-100 text-green-700', hybrid: 'bg-purple-100 text-purple-700' };
const statusColor = { scheduled: 'bg-blue-100 text-blue-700', ongoing: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600', cancelled: 'bg-red-100 text-red-600' };

export default function TrainingCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [sessions, setSessions] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);
  const [daySessions, setDaySessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [u, sess, progs, enr] = await Promise.all([
      base44.auth.me(),
      base44.entities.TrainingSession.list('-start_date', 300),
      base44.entities.TrainingProgram.list('-created_date', 100),
      base44.entities.EmployeeTraining.list('-created_date', 500),
    ]);
    setUser(u);
    setSessions(sess.filter(s => s.start_date));
    setPrograms(progs);
    setEnrollments(enr);
    setLoading(false);
  };

  const getProgram = (id) => programs.find(p => p.id === id);
  const getSessionsForDay = (day) => sessions.filter(s => s.start_date && isSameDay(parseISO(s.start_date), day));

  const handleDayClick = (day) => {
    const daySess = getSessionsForDay(day);
    setSelectedDay(day);
    setDaySessions(daySess);
  };

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startDow = startOfMonth(currentMonth).getDay();

  const upcomingSessions = sessions
    .filter(s => s.start_date && new Date(s.start_date) >= new Date() && s.status !== 'cancelled')
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
    .slice(0, 10);

  const myEnrolledSessionIds = new Set(enrollments.filter(e => e.user_id === user?.id).map(e => e.training_session_id));

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={createPageUrl('TrainingManagement')}>
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Training Calendar</h1>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
                ))}
              </div>
              {/* Days */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startDow }).map((_, i) => <div key={`empty-${i}`} />)}
                {days.map(day => {
                  const daySess = getSessionsForDay(day);
                  const isSelected = selectedDay && isSameDay(day, selectedDay);
                  return (
                    <div
                      key={day.toString()}
                      onClick={() => handleDayClick(day)}
                      className={`min-h-[52px] p-1 rounded-lg cursor-pointer border transition-colors ${isToday(day) ? 'border-blue-400 bg-blue-50' : 'border-transparent hover:border-gray-200 hover:bg-gray-50'} ${isSelected ? 'bg-blue-100 border-blue-400' : ''}`}
                    >
                      <p className={`text-xs font-medium mb-1 ${isToday(day) ? 'text-blue-600' : 'text-gray-700'}`}>{format(day, 'd')}</p>
                      {daySess.slice(0, 2).map(s => {
                        const prog = getProgram(s.training_program_id);
                        return (
                          <div key={s.id} className="text-xs bg-blue-500 text-white rounded px-1 mb-0.5 truncate">{prog?.title?.slice(0, 12) || 'Training'}</div>
                        );
                      })}
                      {daySess.length > 2 && <div className="text-xs text-gray-400">+{daySess.length - 2}</div>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Selected day sessions */}
          {selectedDay && (
            <Card className="mt-4">
              <CardHeader><CardTitle className="text-sm">Sessions on {format(selectedDay, 'MMMM d, yyyy')}</CardTitle></CardHeader>
              <CardContent>
                {daySessions.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-4">No sessions on this day.</p>
                ) : (
                  <div className="space-y-3">
                    {daySessions.map(s => {
                      const prog = getProgram(s.training_program_id);
                      const enrolled = myEnrolledSessionIds.has(s.id);
                      return (
                        <div key={s.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100" onClick={() => setSelectedSession({ ...s, program: prog })}>
                          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                            <Calendar className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{prog?.title || 'Training'}</p>
                            <p className="text-xs text-gray-500">{s.batch_name} · {s.start_date ? format(new Date(s.start_date), 'h:mm a') : ''}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge className={`text-xs ${statusColor[s.status]}`}>{s.status}</Badge>
                              {prog && <Badge className={`text-xs ${modeColor[prog.mode]}`}>{prog.mode}</Badge>}
                              {enrolled && <Badge className="text-xs bg-purple-100 text-purple-700">Enrolled</Badge>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Upcoming Sidebar */}
        <div>
          <Card>
            <CardHeader><CardTitle className="text-sm">Upcoming Sessions</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {upcomingSessions.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No upcoming sessions.</p>}
              {upcomingSessions.map(s => {
                const prog = getProgram(s.training_program_id);
                const enrolled = myEnrolledSessionIds.has(s.id);
                return (
                  <div key={s.id} className="p-3 rounded-lg border hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedSession({ ...s, program: prog })}>
                    <p className="font-semibold text-sm line-clamp-1">{prog?.title}</p>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                      <Clock className="w-3 h-3" />{format(new Date(s.start_date), 'MMM d, h:mm a')}
                    </div>
                    {s.location && <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5"><MapPin className="w-3 h-3" />{s.location}</div>}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1 text-xs text-gray-500"><Users className="w-3 h-3" />{s.enrolled_count || 0}/{s.capacity}</div>
                      {enrolled && <Badge className="text-xs bg-purple-100 text-purple-700">You're enrolled</Badge>}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Session detail dialog */}
      <Dialog open={!!selectedSession} onOpenChange={() => setSelectedSession(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedSession?.program?.title}</DialogTitle>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-3 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 bg-gray-50 rounded"><p className="text-xs text-gray-500">Batch</p><p className="font-medium">{selectedSession.batch_name}</p></div>
                <div className="p-2 bg-gray-50 rounded"><p className="text-xs text-gray-500">Status</p><Badge className={`text-xs ${statusColor[selectedSession.status]}`}>{selectedSession.status}</Badge></div>
                <div className="p-2 bg-gray-50 rounded"><p className="text-xs text-gray-500">Start</p><p className="font-medium">{selectedSession.start_date ? format(new Date(selectedSession.start_date), 'MMM d, h:mm a') : 'TBD'}</p></div>
                <div className="p-2 bg-gray-50 rounded"><p className="text-xs text-gray-500">Duration</p><p className="font-medium">{selectedSession.duration_hours}h</p></div>
                <div className="p-2 bg-gray-50 rounded"><p className="text-xs text-gray-500">Capacity</p><p className="font-medium">{selectedSession.enrolled_count || 0} / {selectedSession.capacity}</p></div>
                <div className="p-2 bg-gray-50 rounded"><p className="text-xs text-gray-500">Trainer</p><p className="font-medium">{selectedSession.trainer_name || selectedSession.program?.trainer_name || '—'}</p></div>
              </div>
              {(selectedSession.location || selectedSession.meeting_link) && (
                <div className="p-2 bg-gray-50 rounded">
                  <p className="text-xs text-gray-500">Location / Link</p>
                  {selectedSession.meeting_link?.startsWith('http') ? (
                    <a href={selectedSession.meeting_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm">{selectedSession.meeting_link}</a>
                  ) : (
                    <p className="font-medium">{selectedSession.location || selectedSession.meeting_link}</p>
                  )}
                </div>
              )}
              <div className="flex justify-end">
                <Link to={`${createPageUrl('TrainingDetail')}?id=${selectedSession.training_program_id}`}>
                  <Button className="bg-blue-600 hover:bg-blue-700 text-sm">View Program →</Button>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}