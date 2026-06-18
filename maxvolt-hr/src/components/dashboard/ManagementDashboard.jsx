import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Users, Clock, FileText, CheckCircle2, AlertCircle,
  Calendar, BarChart3, ChevronRight, GraduationCap, Laptop
} from 'lucide-react';
import { format } from 'date-fns';

export default function ManagementDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailModal, setDetailModal] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');

    const [employees, usersResp, leaves, reimbursements, regularisations, announcements, teamAssets, teamTrainings] = await Promise.all([
      base44.entities.Employee.filter({ reporting_manager_id: user.id }),
      base44.functions.invoke('getAllUsers', {}),
      base44.entities.Leave.filter({ status: 'pending' }),
      base44.entities.Reimbursement.filter({ status: 'pending' }),
      base44.entities.AttendanceRegularisation.filter({ manager_id: user.id, status: 'pending' }),
      base44.entities.Announcement.filter({ status: 'published' }, '-created_date', 4),
      base44.entities.Asset.filter({ status: 'assigned' }).catch(() => []),
      base44.entities.EmployeeTraining.filter({ status: 'in_progress' }).catch(() => []),
    ]);

    const allUsers = usersResp?.data?.users || [];
    const userMap = {};
    allUsers.forEach(u => { userMap[u.id] = u; });

    const teamIds = employees.map(e => e.user_id);

    // Fetch attendance via service function for accuracy
    let todayTeamAtt = [];
    try {
      const attResp = await base44.functions.invoke('getAllAttendance', { date: today });
      const allAtt = attResp?.data?.records || [];
      todayTeamAtt = allAtt.filter(a => teamIds.includes(a.user_id));
    } catch (_) {
      // Fallback to direct filter (RLS limited)
      todayTeamAtt = await base44.entities.Attendance.filter({ date: today });
      todayTeamAtt = todayTeamAtt.filter(a => teamIds.includes(a.user_id));
    }

    const presentRecords = todayTeamAtt.filter(a =>
      a.check_in_time || ['present', 'half_day', 'on_duty'].includes(a.status)
    );
    const presentUserIds = new Set(presentRecords.map(a => a.user_id));
    const onLeaveIds = new Set(todayTeamAtt.filter(a => a.status === 'leave').map(a => a.user_id));

    const presentToday = presentUserIds.size;
    const onLeaveToday = onLeaveIds.size;
    const absentToday = teamIds.length - presentToday - onLeaveToday;

    // Build detailed employee lists with names
    const presentEmployees = employees.filter(e => presentUserIds.has(e.user_id)).map(e => {
      const att = todayTeamAtt.find(a => a.user_id === e.user_id);
      return {
        name: e.display_name || userMap[e.user_id]?.full_name || '—',
        dept: e.department || '—',
        designation: e.designation || '—',
        checkIn: att?.check_in_time ? format(new Date(att.check_in_time), 'hh:mm a') : '—',
        workingHours: att?.working_hours ? `${att.working_hours.toFixed(1)}h` : '—',
        status: att?.status || 'present'
      };
    });

    const absentEmployees = employees
      .filter(e => !presentUserIds.has(e.user_id) && !onLeaveIds.has(e.user_id))
      .map(e => ({
        name: e.display_name || userMap[e.user_id]?.full_name || '—',
        dept: e.department || '—',
        designation: e.designation || '—'
      }));

    const onLeaveEmployees = employees.filter(e => onLeaveIds.has(e.user_id)).map(e => ({
      name: e.display_name || userMap[e.user_id]?.full_name || '—',
      dept: e.department || '—'
    }));

    const teamLeaves = leaves.filter(l => teamIds.includes(l.user_id));
    const teamExpenses = reimbursements.filter(r => teamIds.includes(r.user_id));

    // Enrich team members list
    const teamMembers = employees.map(e => ({
      name: e.display_name || userMap[e.user_id]?.full_name || '—',
      designation: e.designation || '—',
      dept: e.department || '—'
    }));

    // Team assets
    const teamAssetCount = teamAssets.filter(a => teamIds.includes(a.assigned_to_user_id)).length;
    // Team trainings in progress
    const teamTrainingCount = teamTrainings.filter(t => teamIds.includes(t.user_id)).length;

    setData({
      teamSize: employees.length,
      presentToday,
      absentToday,
      onLeaveToday,
      teamMembers,
      presentEmployees,
      absentEmployees,
      onLeaveEmployees,
      teamLeaves,
      teamExpenses: teamExpenses.length,
      pendingRegularisations: regularisations.length,
      todayTeamAtt,
      announcements,
      teamAssetCount,
      teamTrainingCount,
    });
    setLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );

  const attendanceRate = data.teamSize > 0 ? Math.round((data.presentToday / data.teamSize) * 100) : 0;
  const openModal = (title, content) => setDetailModal({ title, content });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Management Dashboard</h1>
          <p className="text-gray-500 mt-1">Welcome, {user.display_name || user.full_name} · {format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {/* Alerts */}
        {(data.teamLeaves.length > 0 || data.pendingRegularisations > 0 || data.teamExpenses > 0) && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-orange-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Pending Actions from Your Team
              </p>
              <div className="flex flex-wrap gap-4">
                {data.teamLeaves.length > 0 && (
                  <Link to={createPageUrl('LeaveManagement')} className="flex items-center gap-1 text-sm text-orange-800 hover:underline font-medium">
                    <FileText className="w-4 h-4" /> {data.teamLeaves.length} leave request(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.pendingRegularisations > 0 && (
                  <Link to={createPageUrl('RegularisationApproval')} className="flex items-center gap-1 text-sm text-orange-800 hover:underline font-medium">
                    <Clock className="w-4 h-4" /> {data.pendingRegularisations} regularisation(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.teamExpenses > 0 && (
                  <Link to={createPageUrl('Approvals')} className="flex items-center gap-1 text-sm text-orange-800 hover:underline font-medium">
                    <CheckCircle2 className="w-4 h-4" /> {data.teamExpenses} expense claim(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Your Team Members',
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.teamMembers.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">No direct reports found</p>
                  : data.teamMembers.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-indigo-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{e.name}</p>
                        <p className="text-xs text-gray-500">{e.designation}</p>
                      </div>
                      <span className="text-xs text-gray-500 capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-indigo-600">{data.teamSize}</p>
              <p className="text-sm text-gray-500 mt-1">Team Size</p>
              <p className="text-xs text-gray-400">Click to view team</p>
            </CardContent>
          </Card>

          <Card className="bg-green-50 cursor-pointer hover:shadow-md transition-shadow border-green-200"
            onClick={() => openModal(`Present Today (${data.presentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.presentEmployees.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">No one checked in yet</p>
                  : data.presentEmployees.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{e.name}</p>
                        <p className="text-xs text-gray-500">{e.designation} · {e.dept}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-green-700 font-semibold">{e.checkIn}</p>
                        <p className="text-xs text-gray-500">{e.workingHours}</p>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-green-600">{data.presentToday}</p>
              <p className="text-sm text-gray-500 mt-1">Present Today</p>
              <p className="text-xs text-gray-400">{attendanceRate}% · click to view</p>
            </CardContent>
          </Card>

          <Card className="bg-red-50 cursor-pointer hover:shadow-md transition-shadow border-red-200"
            onClick={() => openModal(`Non Attendance Marked (${data.absentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.absentEmployees.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">Everyone is present!</p>
                  : data.absentEmployees.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{e.name}</p>
                        <p className="text-xs text-gray-500">{e.designation}</p>
                      </div>
                      <span className="text-xs text-gray-500 capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-red-500">{data.absentToday}</p>
              <p className="text-sm text-gray-500 mt-1">Non Attendance Marked</p>
              <p className="text-xs text-gray-400">Click to see who</p>
            </CardContent>
          </Card>

          <Card className="bg-yellow-50 cursor-pointer hover:shadow-md transition-shadow border-yellow-200"
            onClick={() => openModal(`Leave Applied Today (${data.onLeaveToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.onLeaveEmployees.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">No one on leave today</p>
                  : data.onLeaveEmployees.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-800">{e.name}</p>
                      <span className="text-xs text-gray-500 capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600">{data.onLeaveToday}</p>
              <p className="text-sm text-gray-500 mt-1">Leave Applied</p>
              <p className="text-xs text-gray-400">Today · click</p>
            </CardContent>
          </Card>
        </div>

        {/* Team Assets & Training */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Team Assets',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.teamAssetCount} asset(s) assigned to your team members.</p>
                <Link to={createPageUrl('AssetTracking')} className="block text-center text-sm text-blue-600 hover:underline">View Assets →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                <Laptop className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.teamAssetCount}</p>
                <p className="text-xs text-gray-500">Team Assets</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Training Progress',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.teamTrainingCount} training(s) currently in progress by your team.</p>
                <Link to={createPageUrl('TrainingManagement')} className="block text-center text-sm text-blue-600 hover:underline">View Training →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                <GraduationCap className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.teamTrainingCount}</p>
                <p className="text-xs text-gray-500">In Training</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Team Attendance Today */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Team Attendance Today
                <Link to={createPageUrl('AllAttendance')} className="text-sm text-blue-600 font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Attendance Rate</span>
                  <span className="font-semibold text-green-600">{attendanceRate}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${attendanceRate}%` }} />
                </div>
              </div>
              {data.teamMembers.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {data.teamMembers.slice(0, 10).map((emp, i) => {
                    const att = data.todayTeamAtt.find(a => {
                      // match by position in employees array from data
                      return false; // we'll use presentUserIds below
                    });
                    const isPresent = data.presentEmployees.some(e => e.name === emp.name);
                    const isLeave = data.onLeaveEmployees.some(e => e.name === emp.name);
                    const checkInTime = data.presentEmployees.find(e => e.name === emp.name)?.checkIn;
                    return (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                        <div>
                          <p className="text-sm font-medium">{emp.name}</p>
                          <p className="text-xs text-gray-400">{emp.designation} · {emp.dept}</p>
                        </div>
                        <div className="text-right">
                          {checkInTime && checkInTime !== '—' && <p className="text-xs text-gray-500">{checkInTime}</p>}
                          <Badge className={`text-xs ${isPresent ? 'bg-green-100 text-green-800' : isLeave ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                            {isPresent ? 'Present' : isLeave ? 'Leave Applied' : 'Non-Attend'}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">No direct reports found</p>
              )}
            </CardContent>
          </Card>

          {/* Pending Leave Requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Pending Leave Request
                <Link to={createPageUrl('LeaveManagement')} className="text-sm text-blue-600 font-normal hover:underline">Manage →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.teamLeaves.length > 0 ? (
                <div className="space-y-3">
                  {data.teamLeaves.slice(0, 5).map(lv => (
                    <div key={lv.id} className="flex items-start justify-between p-3 rounded-lg bg-yellow-50 border border-yellow-100">
                      <div>
                        <p className="text-sm font-medium">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d')}</p>
                        <p className="text-xs text-gray-500 line-clamp-1">{lv.reason}</p>
                        <p className="text-xs text-gray-400">{lv.total_days} day(s)</p>
                      </div>
                      <Badge className="bg-yellow-100 text-yellow-800 text-xs shrink-0">Pending</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-green-300 mb-2" />
                  <p className="text-gray-400 text-sm">No pending leave requests</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                { label: 'Dept Attendance', icon: BarChart3, page: 'AllAttendance', color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
                { label: 'Leave Requests', icon: FileText, page: 'LeaveManagement', color: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' },
                { label: 'Regularisations', icon: Clock, page: 'RegularisationApproval', color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
                { label: 'Expense Approvals', icon: CheckCircle2, page: 'Approvals', color: 'bg-green-50 text-green-700 hover:bg-green-100' },
                { label: 'My Team', icon: Users, page: 'Employees', color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
                { label: 'Announcements', icon: Calendar, page: 'Announcements', color: 'bg-pink-50 text-pink-700 hover:bg-pink-100' },
              ].map(a => {
                const Icon = a.icon;
                return (
                  <Link key={a.page} to={createPageUrl(a.page)}>
                    <div className={`p-3 rounded-xl flex items-center gap-2 cursor-pointer transition-colors ${a.color}`}>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">{a.label}</span>
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          {/* Announcements */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Announcements</CardTitle></CardHeader>
            <CardContent>
              {data.announcements.length > 0 ? (
                <div className="space-y-3">
                  {data.announcements.map(a => (
                    <div key={a.id} className="p-3 bg-indigo-50 rounded-lg">
                      <p className="text-sm font-semibold">{a.title}</p>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">No announcements</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail Modal */}
        <Dialog open={!!detailModal} onOpenChange={() => setDetailModal(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{detailModal?.title}</DialogTitle>
            </DialogHeader>
            <div className="mt-2">{detailModal?.content}</div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}