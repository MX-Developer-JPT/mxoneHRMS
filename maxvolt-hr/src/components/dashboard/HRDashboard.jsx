import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Users, Clock, FileText, DollarSign, CheckCircle2, AlertCircle,
  Calendar, UserPlus, BarChart3, Briefcase, HelpCircle,
  ChevronRight, CreditCard, Building2, TrendingDown,
  Gift, Star, Timer, LogIn
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, isBefore, parseISO } from 'date-fns';

export default function HRDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailModal, setDetailModal] = useState(null);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [complianceInsights, setComplianceInsights] = useState([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

    const [
      usersResp, employees, attendanceResp,
      pendingLeaves, pendingReimbursements, pendingRegularisations,
      openTickets, candidates, announcements, payrolls, leavePolicies,
      assets, exits, complianceDeadlines, jobReqs
    ] = await Promise.all([
      base44.functions.invoke('getAllUsers', {}).catch(() => ({ data: { users: [] } })),
      base44.entities.Employee.filter({ status: 'active' }).catch(() => []),
      base44.functions.invoke('getAllAttendance', { date: today }).catch(() => ({ data: { records: [] } })),
      base44.entities.Leave.filter({ status: 'pending' }).catch(() => []),
      base44.entities.Reimbursement.filter({ status: 'pending' }).catch(() => []),
      base44.entities.AttendanceRegularisation.filter({ status: 'manager_approved' }).catch(() => []),
      base44.entities.Ticket.filter({ status: { $in: ['open', 'in_progress'] } }).catch(() => []),
      base44.entities.Candidate.filter({ status: { $in: ['applied', 'screening', 'interview_scheduled'] } }).catch(() => []),
      base44.entities.Announcement.filter({ status: 'published' }, '-created_date', 3).catch(() => []),
      base44.entities.Payroll.filter({ status: 'draft', month: new Date().getMonth() + 1, year: new Date().getFullYear() }).catch(() => []),
      base44.entities.LeavePolicy.filter({ is_active: true }).catch(() => []),
      base44.entities.Asset.list('-created_date', 500).catch(() => []),
      base44.entities.Exit.filter({ status: { $in: ['submitted', 'manager_approved', 'in_notice', 'clearance_pending', 'clearance_done', 'fnf_pending'] } }).catch(() => []),
      base44.entities.ComplianceDeadline.filter({ status: { $ne: 'completed' } }).catch(() => []),
      base44.entities.JobRequisition.filter({ status: { $in: ['approved', 'published'] } }).catch(() => []),
    ]);

    const allUsers = usersResp?.data?.users || [];
    const todayAttendance = attendanceResp?.data?.records || [];

    const userMap = {};
    allUsers.forEach(u => { userMap[u.id] = u; });

    const empMap = {};
    employees.forEach(e => { empMap[e.user_id] = e; });

    const activeEmployeeCount = employees.length;

    const presentRecords = todayAttendance.filter(a =>
      a.check_in_time || ['present', 'half_day', 'on_duty'].includes(a.status)
    );
    const presentToday = presentRecords.length;
    const absentToday = activeEmployeeCount - presentToday;
    const onLeaveToday = todayAttendance.filter(a => a.status === 'leave').length;
    const attendanceRate = activeEmployeeCount > 0 ? Math.round((presentToday / activeEmployeeCount) * 100) : 0;

    const presentDetails = presentRecords.map(a => {
      const emp = empMap[a.user_id];
      const u = userMap[a.user_id];
      return {
        name: emp?.display_name || u?.full_name || a.user_id,
        dept: emp?.department || '—',
        checkIn: a.check_in_time ? format(new Date(a.check_in_time), 'hh:mm a') : '—',
        status: a.status || 'present'
      };
    });

    const presentUserIds = new Set(todayAttendance.map(a => a.user_id));
    const absentDetails = employees
      .filter(e => !presentUserIds.has(e.user_id))
      .map(e => ({ name: e.display_name || userMap[e.user_id]?.full_name || '—', dept: e.department || '—' }));

    const deptMap = {};
    employees.forEach(e => {
      const d = e.department || 'Unknown';
      deptMap[d] = (deptMap[d] || 0) + 1;
    });
    const deptBreakdown = Object.entries(deptMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const policyMap = {};
    leavePolicies.forEach(p => { policyMap[p.id] = p.name; });

    const totalAssets = assets.length;
    const assignedAssets = assets.filter(a => a.status === 'assigned').length;
    const availableAssets = assets.filter(a => a.status === 'available').length;
    const overdueReturns = assets.filter(a => a.status === 'assigned' && a.return_date && isBefore(parseISO(a.return_date), new Date())).length;

    const pendingExits = exits.length;
    const overdueDeadlines = complianceDeadlines.filter(d => d.due_date && isBefore(parseISO(d.due_date), new Date())).length;

    const openPositions = jobReqs.length;
    const openPositionsList = jobReqs.slice(0, 5);

    // Upcoming events & compliance insights in parallel (non-blocking)
    base44.functions.invoke('getUpcomingEvents', {}).then(r => setUpcomingEvents(r?.data?.events || [])).catch(() => {});
    base44.functions.invoke('getComplianceInsights', {}).then(r => setComplianceInsights(r?.data?.insights || [])).catch(() => {});

    setData({
      activeEmployeeCount, presentToday, absentToday, onLeaveToday, attendanceRate,
      presentDetails, absentDetails,
      pendingLeaves: pendingLeaves.length,
      pendingReimbursements: pendingReimbursements.length,
      pendingRegularisations: pendingRegularisations.length,
      openTickets: openTickets.length,
      activeCandidates: candidates.length,
      pendingPayrolls: payrolls.length,
      deptBreakdown, announcements,
      recentLeaves: pendingLeaves.slice(0, 5),
      recentCandidates: candidates.slice(0, 4),
      policyMap,
      totalAssets, assignedAssets, availableAssets, overdueReturns,
      pendingExits, overdueDeadlines,
      openPositions, openPositionsList,
    });
    setLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-[3px] border-indigo-200 dark:border-indigo-900 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );

  const totalPending = data.pendingLeaves + data.pendingReimbursements + data.pendingRegularisations + data.openTickets;
  const openModal = (title, content) => setDetailModal({ title, content });

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">HR Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome, {user.display_name || user.full_name} · {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>

        {/* Alerts */}
        {totalPending > 0 && (
          <Card className="border-destructive/30 bg-destructive/5 dark:bg-destructive/10">
            <CardContent className="p-4">
              <p className="font-semibold text-destructive flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4" /> {totalPending} Items Require Your Attention
              </p>
              <div className="flex flex-wrap gap-4">
                {data.pendingLeaves > 0 && (
                  <Link to={createPageUrl('LeaveManagement')} className="flex items-center gap-1 text-sm text-destructive hover:underline font-medium">
                    <FileText className="w-4 h-4" /> {data.pendingLeaves} leave(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.pendingReimbursements > 0 && (
                  <Link to={createPageUrl('Approvals')} className="flex items-center gap-1 text-sm text-destructive hover:underline font-medium">
                    <DollarSign className="w-4 h-4" /> {data.pendingReimbursements} expense(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.pendingRegularisations > 0 && (
                  <Link to={createPageUrl('RegularisationApproval')} className="flex items-center gap-1 text-sm text-destructive hover:underline font-medium">
                    <Clock className="w-4 h-4" /> {data.pendingRegularisations} regularisation(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.openTickets > 0 && (
                  <Link to={createPageUrl('Helpdesk')} className="flex items-center gap-1 text-sm text-destructive hover:underline font-medium">
                    <HelpCircle className="w-4 h-4" /> {data.openTickets} ticket(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Attendance Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Active Employees */}
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Active Employees by Department',
              <div className="space-y-2">
                {data.deptBreakdown.map(([dept, count]) => (
                  <div key={dept} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                    <span className="text-sm capitalize font-medium text-foreground">{dept}</span>
                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{count} employees</span>
                  </div>
                ))}
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950/60 rounded-xl flex items-center justify-center">
                  <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.activeEmployeeCount}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Active Employees</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Click to see by dept</p>
            </CardContent>
          </Card>

          {/* Present Today */}
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal(`Present Today (${data.presentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.presentDetails.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">No one checked in yet</p>
                  : data.presentDetails.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{e.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{e.dept}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">{e.checkIn}</p>
                        <Badge className="text-xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 capitalize border-0">{e.status}</Badge>
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
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{data.attendanceRate}%</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{data.presentToday}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Present Today</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">Click to see who</p>
            </CardContent>
          </Card>

          {/* Non Attendance Marked */}
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal(`Non Attendance Marked (${data.absentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.absentDetails.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">Everyone is present!</p>
                  : data.absentDetails.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-red-50 dark:bg-red-950/40 rounded-lg">
                      <p className="text-sm font-medium text-foreground">{e.name}</p>
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

          {/* On Leave */}
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Leave Applied Today',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.onLeaveToday} employee(s) are on approved leave today.</p>
                <Link to={createPageUrl('AllAttendance')} className="block text-center text-sm text-primary hover:underline">View full attendance →</Link>
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

        {/* Pending Actions Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className={`cursor-pointer hover:shadow-md transition-all group ${data.pendingLeaves > 0 ? 'ring-1 ring-amber-400 dark:ring-amber-700' : ''}`}
            onClick={() => openModal('Pending Leave Requests',
              <div className="space-y-2">
                {data.recentLeaves.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">No pending leaves</p>
                  : data.recentLeaves.map((lv, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-foreground">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d')}</p>
                        <p className="text-xs text-muted-foreground">{lv.total_days} day(s)</p>
                      </div>
                      <Badge className="bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-xs border-0">Pending</Badge>
                    </div>
                  ))
                }
                <Link to={createPageUrl('LeaveManagement')} className="block text-center text-sm text-primary hover:underline pt-2">Manage all →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/60 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.pendingLeaves}</p>
                <p className="text-xs text-muted-foreground">Pending Leave Request</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Pending Expense Claims',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.pendingReimbursements} expense claim(s) awaiting approval.</p>
                <Link to={createPageUrl('Approvals')} className="block text-center text-sm text-primary hover:underline">Review all →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-100 dark:bg-violet-950/60 rounded-xl flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.pendingReimbursements}</p>
                <p className="text-xs text-muted-foreground">Pending Expense Claims</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Pending Regularisations',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.pendingRegularisations} attendance regularisation(s) pending HR review.</p>
                <Link to={createPageUrl('RegularisationApproval')} className="block text-center text-sm text-primary hover:underline">Review all →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950/60 rounded-xl flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.pendingRegularisations}</p>
                <p className="text-xs text-muted-foreground">Pending Regularisation</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Open Support Tickets',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.openTickets} ticket(s) currently open or in progress.</p>
                <Link to={createPageUrl('Helpdesk')} className="block text-center text-sm text-primary hover:underline">View tickets →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-pink-100 dark:bg-pink-950/60 rounded-xl flex items-center justify-center shrink-0">
                <HelpCircle className="w-5 h-5 text-pink-600 dark:text-pink-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.openTickets}</p>
                <p className="text-xs text-muted-foreground">Open Tickets</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Asset, Exit & Compliance Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Asset Inventory',
              <div className="space-y-3">
                {[
                  { label: 'Total Assets', value: data.totalAssets, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40' },
                  { label: 'Available', value: data.availableAssets, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
                  { label: 'Assigned', value: data.assignedAssets, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/40' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`flex justify-between items-center p-3 ${bg} rounded-lg`}>
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className={`text-sm font-bold ${color}`}>{value}</span>
                  </div>
                ))}
                {data.overdueReturns > 0 && (
                  <div className="flex justify-between items-center p-3 bg-red-50 dark:bg-red-950/40 rounded-lg">
                    <span className="text-sm font-medium text-red-700 dark:text-red-400">Overdue Returns</span>
                    <span className="text-sm font-bold text-red-600 dark:text-red-400">{data.overdueReturns}</span>
                  </div>
                )}
                <Link to={createPageUrl('AssetTracking')} className="block text-center text-sm text-primary hover:underline pt-2">Manage Assets →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/60 rounded-xl flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.totalAssets}</p>
                <p className="text-xs text-muted-foreground">Assets ({data.availableAssets} avail)</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer hover:shadow-md transition-all group ${data.pendingExits > 0 ? 'ring-1 ring-red-300 dark:ring-red-800' : ''}`}
            onClick={() => openModal('Active Exits',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">{data.pendingExits} active exit case(s) in progress.</p>
                <Link to={createPageUrl('ExitManagement')} className="block text-center text-sm text-primary hover:underline">Manage Exits →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-950/60 rounded-xl flex items-center justify-center shrink-0">
                <TrendingDown className="w-5 h-5 text-red-500 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.pendingExits}</p>
                <p className="text-xs text-muted-foreground">Active Exits</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer hover:shadow-md transition-all group ${data.overdueDeadlines > 0 ? 'ring-1 ring-red-300 dark:ring-red-800' : ''}`}
            onClick={() => openModal('Compliance Deadlines',
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center py-4">
                  {data.overdueDeadlines > 0
                    ? `⚠️ ${data.overdueDeadlines} compliance deadline(s) overdue!`
                    : '✓ All compliance deadlines on track'}
                </p>
                <Link to={createPageUrl('ComplianceDashboard')} className="block text-center text-sm text-primary hover:underline">View Compliance →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${data.overdueDeadlines > 0 ? 'bg-red-100 dark:bg-red-950/60' : 'bg-emerald-100 dark:bg-emerald-950/60'}`}>
                <AlertCircle className={`w-5 h-5 ${data.overdueDeadlines > 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-500 dark:text-emerald-400'}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${data.overdueDeadlines > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{data.overdueDeadlines}</p>
                <p className="text-xs text-muted-foreground">Overdue Compliance</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Quick Summary',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Pending Payroll</span>
                  <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{data.pendingPayrolls} records</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Active Candidates</span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{data.activeCandidates}</span>
                </div>
                <Link to={createPageUrl('MISDashboard')} className="block text-center text-sm text-primary hover:underline pt-2">MIS Analytics →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-100 dark:bg-violet-950/60 rounded-xl flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{data.pendingPayrolls + data.activeCandidates}</p>
                <p className="text-xs text-muted-foreground">Pending Actions</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detail Cards Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Today's Attendance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Today's Attendance
                <Link to={createPageUrl('AllAttendance')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Attendance Rate</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{data.attendanceRate}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-3">
                  <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-3 rounded-full transition-all" style={{ width: `${Math.max(data.attendanceRate, 6)}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-emerald-50 dark:bg-emerald-950/40 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{data.presentToday}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Present</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/40 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-red-500 dark:text-red-400">{data.absentToday}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Non-Attend</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{data.onLeaveToday}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Leave</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Department Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Dept. Headcount
                <Link to={createPageUrl('Employees')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.deptBreakdown.length > 0 ? (
                <div className="space-y-3">
                  {data.deptBreakdown.map(([dept, count]) => (
                    <div key={dept} className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-950/60 rounded-lg flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium capitalize text-foreground">{dept}</span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(count / data.activeEmployeeCount) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-6">No data available</p>
              )}
            </CardContent>
          </Card>

          {/* Open Positions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Open Positions
                <Link to={createPageUrl('JobRequisitions')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.openPositionsList?.length > 0 ? (
                <div className="space-y-2">
                  {data.openPositionsList.map(jr => (
                    <div key={jr.id} className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40">
                      <div>
                        <p className="text-sm font-medium text-foreground">{jr.position_title}</p>
                        <p className="text-xs text-muted-foreground">{jr.department} · {jr.number_of_positions || 1} opening(s)</p>
                      </div>
                      <Badge className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 capitalize border-0">{jr.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-center">{data.openPositions} total open</p>
                </div>
              ) : (
                <div className="text-center py-4">
                  <Briefcase className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-muted-foreground text-sm">No open positions</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recruitment Pipeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Recruitment Pipeline
                <Link to={createPageUrl('Recruitment')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentCandidates.length > 0 ? (
                <div className="space-y-3">
                  {data.recentCandidates.map(c => (
                    <div key={c.id} className="flex items-start justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40">
                      <div>
                        <p className="text-sm font-medium text-foreground">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground">{c.position_applied}</p>
                      </div>
                      <Badge className="text-xs capitalize bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shrink-0 border-0">{c.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-center">{data.activeCandidates} total active</p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <UserPlus className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-muted-foreground text-sm">No active candidates</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Leave Requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Pending Leaves
                <Link to={createPageUrl('LeaveManagement')} className="text-sm text-primary font-normal hover:underline">Manage →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentLeaves.length > 0 ? (
                <div className="space-y-2">
                  {data.recentLeaves.map(lv => (
                    <div key={lv.id} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40">
                      <div>
                        <p className="text-sm font-medium text-foreground">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d')}</p>
                        <p className="text-xs text-muted-foreground">{lv.total_days} day(s)</p>
                      </div>
                      <Badge className="bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-xs border-0">Pending</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-300 dark:text-emerald-700 mb-2" />
                  <p className="text-muted-foreground text-sm">All leaves resolved</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: 'Onboarding',     icon: UserPlus,  page: 'OnboardingApproval', bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60' },
                { label: 'Payroll',        icon: CreditCard, page: 'PayrollManagement', bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60' },
                { label: 'All Attendance', icon: BarChart3,  page: 'AllAttendance',     bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/60' },
                { label: 'Shift Mgmt',    icon: Clock,      page: 'ShiftManagement',   bg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950/60' },
                { label: 'Departments',   icon: Building2,  page: 'DepartmentManagement', bg: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-950/60' },
                { label: 'Recruitment',   icon: Briefcase,  page: 'Recruitment',        bg: 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-950/60' },
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
        </div>

        {/* Announcements */}
        {data.announcements.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Latest Announcements
                <Link to={createPageUrl('AnnouncementManagement')} className="text-sm text-primary font-normal hover:underline">Manage →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              {data.announcements.map(a => (
                <div key={a.id} className="p-3 bg-violet-50 dark:bg-violet-950/40 rounded-xl">
                  <Badge className="text-xs capitalize bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 mb-2 border-0">{a.category}</Badge>
                  <p className="text-sm font-semibold text-foreground">{a.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Upcoming Events & Compliance Insights Row */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Upcoming Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-foreground">
                <Calendar className="w-4 h-4 text-indigo-500" /> Upcoming Events
                <span className="ml-auto text-xs font-normal text-muted-foreground">Next 30 days</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No upcoming events in the next 30 days</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {upcomingEvents.slice(0, 10).map((ev, i) => {
                    const icons = { birthday: <Gift className="w-3.5 h-3.5 text-pink-500" />, anniversary: <Star className="w-3.5 h-3.5 text-yellow-500" />, probation: <Timer className="w-3.5 h-3.5 text-orange-500" />, probation_overdue: <AlertCircle className="w-3.5 h-3.5 text-red-500" />, leave_return: <LogIn className="w-3.5 h-3.5 text-green-500" /> };
                    const colors = { birthday: 'bg-pink-50 border-pink-200', anniversary: 'bg-yellow-50 border-yellow-200', probation: 'bg-orange-50 border-orange-200', probation_overdue: 'bg-red-50 border-red-200', leave_return: 'bg-green-50 border-green-200' };
                    return (
                      <div key={i} className={`flex items-center gap-3 p-2 rounded-lg border text-sm ${colors[ev.type] || 'bg-gray-50 border-gray-200'}`}>
                        {icons[ev.type] || <Calendar className="w-3.5 h-3.5 text-gray-400" />}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 truncate">{ev.label}</p>
                          <p className="text-xs text-gray-500">{ev.date}{ev.department ? ` · ${ev.department}` : ''}</p>
                        </div>
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${ev.days_away === 0 ? 'bg-blue-100 text-blue-700' : ev.days_away < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                          {ev.days_away === 0 ? 'Today' : ev.days_away < 0 ? `${Math.abs(ev.days_away)}d ago` : `${ev.days_away}d`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compliance Insights */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-foreground">
                <CheckCircle2 className="w-4 h-4 text-green-500" /> Compliance Insights
                <Link to={createPageUrl('ComplianceDashboard')} className="ml-auto text-xs text-primary font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {complianceInsights.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">All compliance checks passed</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {complianceInsights.map((ins, i) => {
                    const styles = { error: 'bg-red-50 border-red-300 text-red-800', warning: 'bg-orange-50 border-orange-300 text-orange-800', info: 'bg-blue-50 border-blue-200 text-blue-800' };
                    return (
                      <div key={i} className={`p-2.5 rounded-lg border text-sm ${styles[ins.type] || styles.info}`}>
                        <p className="font-semibold">{ins.title}</p>
                        {ins.detail && <p className="text-xs mt-0.5 opacity-80 line-clamp-2">{ins.detail}</p>}
                      </div>
                    );
                  })}
                </div>
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
