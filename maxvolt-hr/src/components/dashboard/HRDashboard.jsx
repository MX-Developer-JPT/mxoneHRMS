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
  ChevronRight, CreditCard, Building2, TrendingDown
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, isBefore, parseISO } from 'date-fns';

export default function HRDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailModal, setDetailModal] = useState(null);

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

    // Build user map: id -> user
    const userMap = {};
    allUsers.forEach(u => { userMap[u.id] = u; });

    // Build employee map: user_id -> employee
    const empMap = {};
    employees.forEach(e => { empMap[e.user_id] = e; });

    const activeEmployeeCount = employees.length;

    // Count present: has check_in_time or status is present/half_day/on_duty
    const presentRecords = todayAttendance.filter(a =>
      a.check_in_time || ['present', 'half_day', 'on_duty'].includes(a.status)
    );
    const presentToday = presentRecords.length;
    const absentToday = activeEmployeeCount - presentToday;
    const onLeaveToday = todayAttendance.filter(a => a.status === 'leave').length;
    const attendanceRate = activeEmployeeCount > 0 ? Math.round((presentToday / activeEmployeeCount) * 100) : 0;

    // Present employee details for modal
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

    // Absent employee details
    const presentUserIds = new Set(todayAttendance.map(a => a.user_id));
    const absentDetails = employees
      .filter(e => !presentUserIds.has(e.user_id))
      .map(e => ({ name: e.display_name || userMap[e.user_id]?.full_name || '—', dept: e.department || '—' }));

    // Department breakdown
    const deptMap = {};
    employees.forEach(e => {
      const d = e.department || 'Unknown';
      deptMap[d] = (deptMap[d] || 0) + 1;
    });
    const deptBreakdown = Object.entries(deptMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Leave policy name map
    const policyMap = {};
    leavePolicies.forEach(p => { policyMap[p.id] = p.name; });

    // Asset stats
    const totalAssets = assets.length;
    const assignedAssets = assets.filter(a => a.status === 'assigned').length;
    const availableAssets = assets.filter(a => a.status === 'available').length;
    const overdueReturns = assets.filter(a => a.status === 'assigned' && a.return_date && isBefore(parseISO(a.return_date), new Date())).length;

    // Exit stats
    const pendingExits = exits.length;
    const overdueDeadlines = complianceDeadlines.filter(d => d.due_date && isBefore(parseISO(d.due_date), new Date())).length;

    // Open positions from job requisitions
    const openPositions = jobReqs.length;
    const openPositionsList = jobReqs.slice(0, 5);

    setData({
      activeEmployeeCount,
      presentToday,
      absentToday,
      onLeaveToday,
      attendanceRate,
      presentDetails,
      absentDetails,
      pendingLeaves: pendingLeaves.length,
      pendingReimbursements: pendingReimbursements.length,
      pendingRegularisations: pendingRegularisations.length,
      openTickets: openTickets.length,
      activeCandidates: candidates.length,
      pendingPayrolls: payrolls.length,
      deptBreakdown,
      announcements,
      recentLeaves: pendingLeaves.slice(0, 5),
      recentCandidates: candidates.slice(0, 4),
      policyMap,
      totalAssets,
      assignedAssets,
      availableAssets,
      overdueReturns,
      pendingExits,
      overdueDeadlines,
      openPositions,
      openPositionsList,
    });
    setLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );

  const totalPending = data.pendingLeaves + data.pendingReimbursements + data.pendingRegularisations + data.openTickets;

  const openModal = (title, content) => setDetailModal({ title, content });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">HR Dashboard</h1>
          <p className="text-gray-500 mt-1">Welcome, {user.display_name || user.full_name} · {format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {/* Alerts */}
        {totalPending > 0 && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="font-semibold text-red-800 flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4" /> {totalPending} Items Require Your Attention
              </p>
              <div className="flex flex-wrap gap-4">
                {data.pendingLeaves > 0 && (
                  <Link to={createPageUrl('LeaveManagement')} className="flex items-center gap-1 text-sm text-red-700 hover:underline font-medium">
                    <FileText className="w-4 h-4" /> {data.pendingLeaves} leave(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.pendingReimbursements > 0 && (
                  <Link to={createPageUrl('Approvals')} className="flex items-center gap-1 text-sm text-red-700 hover:underline font-medium">
                    <DollarSign className="w-4 h-4" /> {data.pendingReimbursements} expense(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.pendingRegularisations > 0 && (
                  <Link to={createPageUrl('RegularisationApproval')} className="flex items-center gap-1 text-sm text-red-700 hover:underline font-medium">
                    <Clock className="w-4 h-4" /> {data.pendingRegularisations} regularisation(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                {data.openTickets > 0 && (
                  <Link to={createPageUrl('Helpdesk')} className="flex items-center gap-1 text-sm text-red-700 hover:underline font-medium">
                    <HelpCircle className="w-4 h-4" /> {data.openTickets} ticket(s) <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Attendance Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow border-indigo-100"
            onClick={() => openModal('Active Employees by Department',
              <div className="space-y-2">
                {data.deptBreakdown.map(([dept, count]) => (
                  <div key={dept} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm capitalize font-medium text-gray-800">{dept}</span>
                    <span className="text-sm font-bold text-indigo-600">{count} employees</span>
                  </div>
                ))}
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-indigo-600">{data.activeEmployeeCount}</p>
              <p className="text-sm text-gray-500 mt-1">Active Employees</p>
              <p className="text-xs text-gray-400">Click to see by dept</p>
            </CardContent>
          </Card>

          <Card className="bg-green-50 cursor-pointer hover:shadow-md transition-shadow border-green-200"
            onClick={() => openModal(`Present Today (${data.presentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.presentDetails.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">No one checked in yet</p>
                  : data.presentDetails.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{e.name}</p>
                        <p className="text-xs text-gray-500 capitalize">{e.dept}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-green-700 font-semibold">{e.checkIn}</p>
                        <Badge className="text-xs bg-green-100 text-green-800 capitalize">{e.status}</Badge>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-green-600">{data.presentToday}</p>
              <p className="text-sm text-gray-500 mt-1">Present Today</p>
              <p className="text-xs text-green-600 font-medium">{data.attendanceRate}% rate · click</p>
            </CardContent>
          </Card>

          <Card className="bg-red-50 cursor-pointer hover:shadow-md transition-shadow border-red-200"
            onClick={() => openModal(`Non Attendance Marked (${data.absentToday})`,
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.absentDetails.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">Everyone is present!</p>
                  : data.absentDetails.map((e, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-800">{e.name}</p>
                      <span className="text-xs text-gray-500 capitalize">{e.dept}</span>
                    </div>
                  ))
                }
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-red-500">{data.absentToday}</p>
              <p className="text-sm text-gray-500 mt-1">Non Attendance Marked</p>
              <p className="text-xs text-red-500 font-medium">Click to see who</p>
            </CardContent>
          </Card>

          <Card className="bg-yellow-50 cursor-pointer hover:shadow-md transition-shadow border-yellow-200"
            onClick={() => openModal('Leave Applied Today',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.onLeaveToday} employee(s) are on approved leave today.</p>
                <Link to={createPageUrl('AllAttendance')} className="block text-center text-sm text-blue-600 hover:underline">View full attendance →</Link>
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600">{data.onLeaveToday}</p>
              <p className="text-sm text-gray-500 mt-1">Leave Applied</p>
              <p className="text-xs text-yellow-600">Today · click</p>
            </CardContent>
          </Card>
        </div>

        {/* Second Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className={`cursor-pointer hover:shadow-md transition-shadow ${data.pendingLeaves > 0 ? 'border-yellow-300' : ''}`}
            onClick={() => openModal('Pending Leave Requests',
              <div className="space-y-2">
                {data.recentLeaves.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">No pending leaves</p>
                  : data.recentLeaves.map((lv, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d')}</p>
                        <p className="text-xs text-gray-500">{lv.total_days} day(s)</p>
                      </div>
                      <Badge className="bg-yellow-100 text-yellow-800 text-xs">Pending</Badge>
                    </div>
                  ))
                }
                <Link to={createPageUrl('LeaveManagement')} className="block text-center text-sm text-blue-600 hover:underline pt-2">Manage all →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.pendingLeaves}</p>
                <p className="text-xs text-gray-500">Pending Leave Request</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Pending Expense Claims',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.pendingReimbursements} expense claim(s) awaiting approval.</p>
                <Link to={createPageUrl('Approvals')} className="block text-center text-sm text-blue-600 hover:underline">Review all →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.pendingReimbursements}</p>
                <p className="text-xs text-gray-500">Pending Expense Claims</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Pending Regularisations',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.pendingRegularisations} attendance regularisation(s) pending HR review.</p>
                <Link to={createPageUrl('RegularisationApproval')} className="block text-center text-sm text-blue-600 hover:underline">Review all →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.pendingRegularisations}</p>
                <p className="text-xs text-gray-500">Pending Regularisation</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Open Support Tickets',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.openTickets} ticket(s) currently open or in progress.</p>
                <Link to={createPageUrl('Helpdesk')} className="block text-center text-sm text-blue-600 hover:underline">View tickets →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center shrink-0">
                <HelpCircle className="w-5 h-5 text-pink-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.openTickets}</p>
                <p className="text-xs text-gray-500">Open Tickets</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Third Row — Asset, Exit & Compliance */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Asset Inventory',
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Total Assets</span>
                  <span className="text-sm font-bold text-blue-600">{data.totalAssets}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Available</span>
                  <span className="text-sm font-bold text-green-600">{data.availableAssets}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Assigned</span>
                  <span className="text-sm font-bold text-blue-600">{data.assignedAssets}</span>
                </div>
                {data.overdueReturns > 0 && (
                  <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                    <span className="text-sm font-medium text-red-700">Overdue Returns</span>
                    <span className="text-sm font-bold text-red-600">{data.overdueReturns}</span>
                  </div>
                )}
                <Link to={createPageUrl('AssetTracking')} className="block text-center text-sm text-blue-600 hover:underline pt-2">Manage Assets →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.totalAssets}</p>
                <p className="text-xs text-gray-500">Assets ({data.availableAssets} avail)</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer hover:shadow-md transition-shadow ${data.pendingExits > 0 ? 'border-red-300' : ''}`}
            onClick={() => openModal('Active Exits',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.pendingExits} active exit case(s) in progress.</p>
                <Link to={createPageUrl('ExitManagement')} className="block text-center text-sm text-blue-600 hover:underline">Manage Exits →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                <TrendingDown className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.pendingExits}</p>
                <p className="text-xs text-gray-500">Active Exits</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`cursor-pointer hover:shadow-md transition-shadow ${data.overdueDeadlines > 0 ? 'border-red-300 bg-red-50' : ''}`}
            onClick={() => openModal('Compliance Deadlines',
              <div className="space-y-2">
                <p className="text-sm text-gray-600 text-center py-4">{data.overdueDeadlines > 0 ? `⚠️ ${data.overdueDeadlines} compliance deadline(s) overdue!` : '✓ All compliance deadlines on track'}</p>
                <Link to={createPageUrl('ComplianceDashboard')} className="block text-center text-sm text-blue-600 hover:underline">View Compliance →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${data.overdueDeadlines > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                <AlertCircle className={`w-5 h-5 ${data.overdueDeadlines > 0 ? 'text-red-500' : 'text-green-500'}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${data.overdueDeadlines > 0 ? 'text-red-600' : 'text-gray-800'}`}>{data.overdueDeadlines}</p>
                <p className="text-xs text-gray-500">Overdue Compliance</p>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Quick Summary',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">Pending Payroll</span>
                  <span className="text-sm font-bold text-orange-600">{data.pendingPayrolls} records</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">Active Candidates</span>
                  <span className="text-sm font-bold text-blue-600">{data.activeCandidates}</span>
                </div>
                <Link to={createPageUrl('MISDashboard')} className="block text-center text-sm text-blue-600 hover:underline pt-2">MIS Analytics →</Link>
              </div>
            )}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-800">{data.pendingPayrolls + data.activeCandidates}</p>
                <p className="text-xs text-gray-500">Pending Actions</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Today's Attendance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Today's Attendance
                <Link to={createPageUrl('AllAttendance')} className="text-sm text-blue-600 font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">Attendance Rate</span>
                  <span className="font-bold text-green-600">{data.attendanceRate}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-4">
                  <div className="bg-green-500 h-4 rounded-full flex items-center justify-end pr-2 text-xs text-white font-semibold transition-all" style={{ width: `${Math.max(data.attendanceRate, 8)}%` }}>
                    {data.attendanceRate}%
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{data.presentToday}</p>
                  <p className="text-xs text-gray-500">Present</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-red-500">{data.absentToday}</p>
                  <p className="text-xs text-gray-500">Non-Attend</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-yellow-600">{data.onLeaveToday}</p>
                  <p className="text-xs text-gray-500">Leave Applied</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Department Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Dept. Headcount
                <Link to={createPageUrl('Employees')} className="text-sm text-blue-600 font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.deptBreakdown.length > 0 ? (
                <div className="space-y-3">
                  {data.deptBreakdown.map(([dept, count]) => (
                    <div key={dept} className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium capitalize">{dept}</span>
                          <span className="text-gray-500">{count}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(count / data.activeEmployeeCount) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">No data available</p>
              )}
            </CardContent>
          </Card>

          {/* Open Positions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Open Positions
                <Link to={createPageUrl('JobRequisitions')} className="text-sm text-blue-600 font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.openPositionsList?.length > 0 ? (
                <div className="space-y-2">
                  {data.openPositionsList.map(jr => (
                    <div key={jr.id} className="flex items-center justify-between p-2 rounded-lg bg-blue-50">
                      <div>
                        <p className="text-sm font-medium">{jr.position_title}</p>
                        <p className="text-xs text-gray-500">{jr.department} · {jr.number_of_positions || 1} opening(s)</p>
                      </div>
                      <Badge className="text-xs bg-blue-100 text-blue-700 capitalize">{jr.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 text-center">{data.openPositions} total open</p>
                </div>
              ) : (
                <div className="text-center py-4">
                  <Briefcase className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-400 text-sm">No open positions</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recruitment Pipeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Recruitment Pipeline
                <Link to={createPageUrl('Recruitment')} className="text-sm text-blue-600 font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentCandidates.length > 0 ? (
                <div className="space-y-3">
                  {data.recentCandidates.map(c => (
                    <div key={c.id} className="flex items-start justify-between p-2 rounded-lg bg-blue-50">
                      <div>
                        <p className="text-sm font-medium">{c.full_name}</p>
                        <p className="text-xs text-gray-500">{c.position_applied}</p>
                      </div>
                      <Badge className="text-xs capitalize bg-blue-100 text-blue-700 shrink-0">{c.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 text-center">{data.activeCandidates} total active</p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <UserPlus className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-400 text-sm">No active candidates</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Leave Requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Pending Leaves
                <Link to={createPageUrl('LeaveManagement')} className="text-sm text-blue-600 font-normal hover:underline">Manage →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentLeaves.length > 0 ? (
                <div className="space-y-2">
                  {data.recentLeaves.map(lv => (
                    <div key={lv.id} className="flex items-center justify-between p-2 rounded-lg bg-yellow-50">
                      <div>
                        <p className="text-sm font-medium">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d')}</p>
                        <p className="text-xs text-gray-400">{lv.total_days} day(s)</p>
                      </div>
                      <Badge className="bg-yellow-100 text-yellow-800 text-xs">Pending</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-green-300 mb-2" />
                  <p className="text-gray-400 text-sm">All leaves resolved</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: 'Onboarding', icon: UserPlus, page: 'OnboardingApproval', color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
                { label: 'Payroll', icon: CreditCard, page: 'PayrollManagement', color: 'bg-green-50 text-green-700 hover:bg-green-100' },
                { label: 'All Attendance', icon: BarChart3, page: 'AllAttendance', color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
                { label: 'Shift Mgmt', icon: Clock, page: 'ShiftManagement', color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
                { label: 'Departments', icon: Building2, page: 'DepartmentManagement', color: 'bg-orange-50 text-orange-700 hover:bg-orange-100' },
                { label: 'Recruitment', icon: Briefcase, page: 'Recruitment', color: 'bg-pink-50 text-pink-700 hover:bg-pink-100' },
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
        </div>

        {/* Announcements */}
        {data.announcements.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Latest Announcements
                <Link to={createPageUrl('AnnouncementManagement')} className="text-sm text-blue-600 font-normal hover:underline">Manage →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              {data.announcements.map(a => (
                <div key={a.id} className="p-3 bg-purple-50 rounded-lg">
                  <Badge className="text-xs capitalize bg-purple-100 text-purple-700 mb-2">{a.category}</Badge>
                  <p className="text-sm font-semibold">{a.title}</p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

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