import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import {
  Users, Clock, FileText, CheckCircle2, AlertCircle,
  Calendar, BarChart3, ChevronRight, GraduationCap, Laptop, RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { safeTime } from '@/lib/dateUtils';

export default function ManagementDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailModal, setDetailModal] = useState(null);

  useEffect(() => { loadData().catch(e => { console.error('ManagementDashboard:', e.message); setLoading(false); }); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await loadData(); } catch (e) { console.error('ManagementDashboard refresh:', e.message); }
    setRefreshing(false);
  };

  const safeFormatDate = (ds, fmt = 'MMM d, yyyy') => {
    if (!ds) return '—';
    try { const d = new Date(ds + 'T00:00:00'); return isNaN(d.getTime()) ? ds : format(d, fmt); } catch { return ds; }
  };

  const loadData = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');

    const [employees, usersResp, leaves, reimbursements, regularisations, announcements, teamAssets, teamTrainings] = await Promise.all([
      base44.entities.Employee.filter({ reporting_manager_email: user.email }).catch(() => []),
      base44.functions.invoke('getAllUsers', {}).catch(() => ({ data: { users: [] } })),
      base44.entities.Leave.filter({ status: 'pending' }).catch(() => []),
      base44.entities.Reimbursement.filter({ status: 'pending' }).catch(() => []),
      base44.entities.AttendanceRegularisation.filter({ manager_id: user.id, status: 'pending' }).catch(() => []),
      base44.entities.Announcement.filter({ status: 'published' }, '-created_date', 4).catch(() => []),
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
        checkIn: safeTime(att?.check_in_time),
        workingHours: att?.working_hours ? `${parseFloat(att.working_hours).toFixed(1)}h` : '—',
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
      <div className="w-8 h-8 border-[3px] border-indigo-200 dark:border-indigo-900 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
  if (!data) return <div className="p-8 text-center text-gray-400">Could not load dashboard data. Please refresh.</div>;

  const attendanceRate = data.teamSize > 0 ? Math.round((data.presentToday / data.teamSize) * 100) : 0;
  const openModal = (title, content) => setDetailModal({ title, content });

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Management Dashboard</h1>
            <p className="text-muted-foreground mt-1">Welcome, {user.display_name || user.full_name} · {format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing} title="Refresh dashboard" className="flex-shrink-0 mt-1">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Alerts */}
        {(data.teamLeaves.length > 0 || data.pendingRegularisations > 0 || data.teamExpenses > 0) && (
          <Card className="border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30">
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-orange-800 dark:text-orange-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Pending Actions from Your Team
              </p>
              <div className="flex flex-wrap gap-4">
                {data.teamLeaves.length > 0 && (
                  <Link to={createPageUrl('LeaveManagement')} className="flex items-center gap-1 text-sm text-orange-800 dark:text-orange-300 hover:underline font-medium">
                    <FileText className="w-4 h-4" /> {data.teamLeaves.length} leave request(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.pendingRegularisations > 0 && (
                  <Link to={createPageUrl('RegularisationApproval')} className="flex items-center gap-1 text-sm text-orange-800 dark:text-orange-300 hover:underline font-medium">
                    <Clock className="w-4 h-4" /> {data.pendingRegularisations} regularisation(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.teamExpenses > 0 && (
                  <Link to={createPageUrl('Approvals')} className="flex items-center gap-1 text-sm text-orange-800 dark:text-orange-300 hover:underline font-medium">
                    <CheckCircle2 className="w-4 h-4" /> {data.teamExpenses} expense claim(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Your Team Members',
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.teamMembers.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">No direct reports found</p>
                  : data.teamMembers.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.designation}</p>
                      </div>
                      <span className="text-xs text-muted-foreground capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950/60 rounded-xl flex items-center justify-center">
                  <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.teamSize}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Team Size</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Click to view team</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal(`Present Today (${data.presentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.presentEmployees.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">No one checked in yet</p>
                  : data.presentEmployees.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.designation} · {e.dept}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">{e.checkIn}</p>
                        <p className="text-xs text-muted-foreground">{e.workingHours}</p>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950/60 rounded-xl flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{attendanceRate}%</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{data.presentToday}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Present Today</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">Click to view</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal(`Non Attendance Marked (${data.absentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.absentEmployees.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">Everyone is present!</p>
                  : data.absentEmployees.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-red-50 dark:bg-red-950/40 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.designation}</p>
                      </div>
                      <span className="text-xs text-muted-foreground capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-950/60 rounded-xl flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.absentToday}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Non Attendance Marked</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">Click to see who</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal(`Leave Applied Today (${data.onLeaveToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.onLeaveEmployees.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">No one on leave today</p>
                  : data.onLeaveEmployees.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg">
                      <p className="text-sm font-medium text-foreground">{e.name}</p>
                      <span className="text-xs text-muted-foreground capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/60 rounded-xl flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.onLeaveToday}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Leave Applied</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">Today · click</p>
            </CardContent>
          </Card>
        </div>

        {/* Team Assets & Training */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Team Assets',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.teamAssetCount} asset(s) assigned to your team members.</p>
                <Link to={createPageUrl('AssetTracking')} className="block text-center text-sm text-primary hover:underline">View Assets →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/60 rounded-xl flex items-center justify-center shrink-0">
                <Laptop className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.teamAssetCount}</p>
                <p className="text-xs text-muted-foreground">Team Assets</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Training Progress',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.teamTrainingCount} training(s) currently in progress by your team.</p>
                <Link to={createPageUrl('TrainingManagement')} className="block text-center text-sm text-primary hover:underline">View Training →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-100 dark:bg-violet-950/60 rounded-xl flex items-center justify-center shrink-0">
                <GraduationCap className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.teamTrainingCount}</p>
                <p className="text-xs text-muted-foreground">In Training</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Team Attendance Today */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Team Attendance Today
                <Link to={createPageUrl('AllAttendance')} className="text-sm text-primary font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Attendance Rate</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{attendanceRate}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-3">
                  <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-3 rounded-full transition-all" style={{ width: `${attendanceRate}%` }} />
                </div>
              </div>
              {data.teamMembers.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {data.teamMembers.slice(0, 10).map((emp, i) => {
                    const isPresent = data.presentEmployees.some(e => e.name === emp.name);
                    const isLeave = data.onLeaveEmployees.some(e => e.name === emp.name);
                    const checkInTime = data.presentEmployees.find(e => e.name === emp.name)?.checkIn;
                    return (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div>
                          <p className="text-sm font-medium text-foreground">{emp.name}</p>
                          <p className="text-xs text-muted-foreground">{emp.designation} · {emp.dept}</p>
                        </div>
                        <div className="text-right">
                          {checkInTime && checkInTime !== '—' && <p className="text-xs text-muted-foreground">{checkInTime}</p>}
                          <Badge className={`text-xs border-0 ${isPresent ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300' : isLeave ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300' : 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300'}`}>
                            {isPresent ? 'Present' : isLeave ? 'Leave Applied' : 'Non-Attend'}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-6">No direct reports found</p>
              )}
            </CardContent>
          </Card>

          {/* Pending Leave Requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Pending Leave Request
                <Link to={createPageUrl('LeaveManagement')} className="text-sm text-primary font-normal hover:underline">Manage →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.teamLeaves.length > 0 ? (
                <div className="space-y-3">
                  {data.teamLeaves.slice(0, 5).map(lv => (
                    <div key={lv.id} className="flex items-start justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">{safeFormatDate(lv.start_date, 'MMM d')} – {safeFormatDate(lv.end_date, 'MMM d')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{lv.reason}</p>
                        <p className="text-xs text-muted-foreground">{lv.total_days} day(s)</p>
                      </div>
                      <Badge className="bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-xs shrink-0 border-0">Pending</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-300 dark:text-emerald-700 mb-2" />
                  <p className="text-muted-foreground text-sm">No pending leave requests</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                { label: 'Dept Attendance',  icon: BarChart3,    page: 'AllAttendance',           bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60' },
                { label: 'Leave Requests',   icon: FileText,     page: 'LeaveManagement',         bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60' },
                { label: 'Regularisations',  icon: Clock,        page: 'RegularisationApproval',  bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/60' },
                { label: 'Expense Approvals',icon: CheckCircle2, page: 'Approvals',               bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60' },
                { label: 'My Team',          icon: Users,        page: 'Employees',               bg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950/60' },
                { label: 'Announcements',    icon: Calendar,     page: 'Announcements',           bg: 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-950/60' },
              ].map(a => {
                const Icon = a.icon;
                return (
                  <Link key={a.page} to={createPageUrl(a.page)}>
                    <div className={`p-3 rounded-xl flex items-center gap-2 cursor-pointer transition-colors ${a.bg}`}>
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
            <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Announcements</CardTitle></CardHeader>
            <CardContent>
              {data.announcements.length > 0 ? (
                <div className="space-y-3">
                  {data.announcements.map(a => (
                    <div key={a.id} className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl">
                      <p className="text-sm font-semibold text-foreground">{a.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-6">No announcements</p>
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