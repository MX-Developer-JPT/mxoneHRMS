import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Clock, Calendar, FileText, DollarSign, HelpCircle, Bell, CheckCircle2,
  AlertCircle, ChevronRight, Briefcase, GraduationCap, Shield
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';

export default function EmployeeDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailModal, setDetailModal] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');
    const currentYear = new Date().getFullYear();

    const [todayAtt, monthlyAtt, leaveBalances, leavePolicies, myLeaves, myReimbursements, myTickets, announcements, regularisations, trainingNotifs, myAssets, myEmp] = await Promise.all([
      base44.entities.Attendance.filter({ user_id: user.id, date: today }),
      base44.entities.Attendance.filter({ user_id: user.id, date: { $gte: monthStart, $lte: monthEnd } }),
      base44.entities.LeaveBalance.filter({ user_id: user.id, year: currentYear }),
      base44.entities.LeavePolicy.filter({ is_active: true }),
      base44.entities.Leave.filter({ user_id: user.id }, '-created_date', 5),
      base44.entities.Reimbursement.filter({ user_id: user.id, status: 'pending' }),
      base44.entities.Ticket.filter({ user_id: user.id, status: { $in: ['open', 'in_progress'] } }),
      base44.entities.Announcement.filter({ status: 'published' }, '-created_date', 5),
      base44.entities.AttendanceRegularisation.filter({ user_id: user.id, status: 'pending' }),
      base44.entities.TrainingNotification.filter({ user_id: user.id, is_read: false }, '-created_date', 10),
      base44.entities.Asset.filter({ assigned_to_user_id: user.id, status: 'assigned' }).catch(() => []),
      base44.entities.Employee.filter({ user_id: user.id }).catch(() => []),
    ]);

    // Build policy map id -> name
    const policyMap = {};
    leavePolicies.forEach(p => { policyMap[p.id] = p.name; });

    // Enrich leave balances with policy name
    const enrichedBalances = leaveBalances.map(lb => ({
      ...lb,
      policyName: policyMap[lb.leave_policy_id] || lb.leave_type_name || 'Leave'
    }));

    // Deduplicate by date — keep the record with the most punch_sessions,
    // then most working_hours, then latest updated_date
    const byDate = {};
    for (const a of monthlyAtt) {
      const existing = byDate[a.date];
      if (!existing) { byDate[a.date] = a; continue; }
      const newPunches = a.punch_sessions?.length || a.total_punches || 0;
      const oldPunches = existing.punch_sessions?.length || existing.total_punches || 0;
      if (newPunches > oldPunches) { byDate[a.date] = a; continue; }
      if (newPunches === oldPunches) {
        const newHours = a.working_hours || 0;
        const oldHours = existing.working_hours || 0;
        if (newHours > oldHours) { byDate[a.date] = a; continue; }
        if (newHours === oldHours) {
          // final tiebreaker: latest updated_date
          if (new Date(a.updated_date) > new Date(existing.updated_date)) byDate[a.date] = a;
        }
      }
    }
    const uniqueAtt = Object.values(byDate);

    // Count present days from unique records only
    const presentDays = uniqueAtt.filter(a =>
      ['present', 'half_day', 'on_duty'].includes(a.status)
    ).length;
    const absentDays = uniqueAtt.filter(a => a.status === 'absent').length;
    const leaveDays = uniqueAtt.filter(a => a.status === 'leave').length;

    const totalLeaveAvailable = enrichedBalances.reduce((s, lb) => s + (lb.available || 0), 0);

    const employeeRecord = myEmp?.[0];
    const hasInsurance = employeeRecord?.insurance?.has_insurance || employeeRecord?.insurance_policies?.length > 0;

    setData({
      todayAtt: todayAtt[0] || null,
      presentDays,
      absentDays,
      leaveDays,
      uniqueAttCount: uniqueAtt.length,
      monthlyAtt,
      leaveBalances: enrichedBalances,
      totalLeaveAvailable,
      recentLeaves: myLeaves,
      pendingReimbursements: myReimbursements.length,
      openTickets: myTickets.length,
      announcements,
      pendingRegularisations: regularisations.length,
      trainingNotifs,
      myAssets,
      hasInsurance,
      employeeRecord,
    });
    setLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );

  const att = data.todayAtt;
  const checkedIn = att?.check_in_time;
  const checkedOut = att?.check_out_time;
  const leaveStatusColor = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600'
  };

  const openModal = (title, content) => setDetailModal({ title, content });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {(user.display_name || user.full_name)?.split(' ')[0]}! 👋
          </h1>
          <p className="text-gray-500 mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {/* Today's Attendance Status */}
        <Card className={`border-2 ${checkedIn && !checkedOut ? 'border-green-400 bg-green-50' : checkedOut ? 'border-blue-400 bg-blue-50' : 'border-orange-300 bg-orange-50'}`}>
          <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${checkedIn && !checkedOut ? 'bg-green-100' : checkedOut ? 'bg-blue-100' : 'bg-orange-100'}`}>
                <Clock className={`w-7 h-7 ${checkedIn && !checkedOut ? 'text-green-600' : checkedOut ? 'text-blue-600' : 'text-orange-500'}`} />
              </div>
              <div>
                <p className="text-sm text-gray-500 font-medium">Today's Attendance</p>
                <p className="text-xl font-bold text-gray-800">
                  {checkedIn && !checkedOut ? '✅ Checked In' : checkedOut ? '🏁 Day Complete' : '⚠️ Not Marked Yet'}
                </p>
                <div className="flex gap-4 mt-1 text-sm text-gray-600">
                  {checkedIn && <span>In: <strong>{format(new Date(att.check_in_time), 'hh:mm a')}</strong></span>}
                  {checkedOut && <span>Out: <strong>{format(new Date(att.check_out_time), 'hh:mm a')}</strong></span>}
                  {att?.working_hours > 0 && <span>Hours: <strong>{att.working_hours.toFixed(1)}h</strong></span>}
                </div>
              </div>
            </div>
            {!checkedIn && (
              <Link to={createPageUrl('MarkAttendance')} className="shrink-0 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors">
                Mark Attendance →
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Attendance This Month',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Present Days</span>
                  <span className="text-sm font-bold text-green-600">{data.presentDays}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Absent Days</span>
                  <span className="text-sm font-bold text-red-500">{data.absentDays}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Leave Days</span>
                  <span className="text-sm font-bold text-yellow-600">{data.leaveDays}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Total Working Days</span>
                  <span className="text-sm font-bold text-gray-600">{data.uniqueAttCount} days</span>
                </div>
                <Link to={createPageUrl('AttendanceHistory')} className="block text-center text-sm text-blue-600 hover:underline pt-2">View full history →</Link>
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-blue-600">{data.presentDays}</p>
              <p className="text-sm text-gray-500 mt-1">Present Days</p>
              <p className="text-xs text-gray-400">This month · click</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Absent Days This Month',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Absent Days</span>
                  <span className="text-sm font-bold text-red-500">{data.absentDays}</span>
                </div>
                <p className="text-xs text-gray-500 text-center pt-2">Need to regularise? Raise a request.</p>
                <Link to={createPageUrl('AttendanceRegularisation')} className="block text-center text-sm text-blue-600 hover:underline">Raise Regularisation →</Link>
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-red-500">{data.absentDays}</p>
              <p className="text-sm text-gray-500 mt-1">Absent Days</p>
              <p className="text-xs text-gray-400">This month · click</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Leave Balance Breakdown',
              <div className="space-y-2">
                {data.leaveBalances.length === 0
                  ? <p className="text-gray-400 text-sm text-center py-4">No leave policies assigned</p>
                  : data.leaveBalances.map((lb, i) => (
                    <div key={i} className="p-3 bg-purple-50 rounded-lg">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-gray-800">{lb.policyName}</span>
                        <span className="text-sm font-bold text-purple-700">{lb.available || 0} / {lb.total_allocated || 0}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, ((lb.available || 0) / (lb.total_allocated || 1)) * 100)}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Used: {lb.used || 0} · Pending: {lb.pending_approval || 0}</p>
                    </div>
                  ))
                }
                <Link to={createPageUrl('Leave')} className="block text-center text-sm text-blue-600 hover:underline pt-2">Apply Leave →</Link>
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-purple-600">{data.totalLeaveAvailable}</p>
              <p className="text-sm text-gray-500 mt-1">Leave Balance</p>
              <p className="text-xs text-gray-400">Days available · click</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => openModal('Pending Regularisations',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Pending Requests</span>
                  <span className="text-sm font-bold text-orange-500">{data.pendingRegularisations}</span>
                </div>
                <p className="text-xs text-gray-500 text-center pt-1">These are awaiting approval from your manager.</p>
                <Link to={createPageUrl('AttendanceRegularisation')} className="block text-center text-sm text-blue-600 hover:underline">View requests →</Link>
              </div>
            )}>
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-orange-500">{data.pendingRegularisations}</p>
              <p className="text-sm text-gray-500 mt-1">Pending Regularisation</p>
              <p className="text-xs text-gray-400">Pending · click</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Leave Balances */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Leave Balances
                <Link to={createPageUrl('Leave')} className="text-sm text-blue-600 font-normal hover:underline">Apply Leave →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.leaveBalances.length > 0 ? (
                <div className="space-y-3">
                  {data.leaveBalances.map((lb, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium">{lb.policyName}</span>
                          <span className="text-sm text-gray-500">{lb.available}/{lb.total_allocated}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(100, ((lb.available || 0) / (lb.total_allocated || 1)) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">No leave policies assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Leave Requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Recent Leave Requests
                <Link to={createPageUrl('Leave')} className="text-sm text-blue-600 font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentLeaves.length > 0 ? (
                <div className="space-y-3">
                  {data.recentLeaves.map(lv => (
                    <div key={lv.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                      <div>
                        <p className="text-sm font-medium">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d, yyyy')}</p>
                        <p className="text-xs text-gray-500 line-clamp-1">{lv.reason}</p>
                      </div>
                      <Badge className={`text-xs ${leaveStatusColor[lv.status] || 'bg-gray-100 text-gray-600'}`}>{lv.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">No recent leave requests</p>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                { label: 'Mark Attendance', icon: Clock, page: 'MarkAttendance', color: 'bg-green-50 text-green-700 hover:bg-green-100' },
                { label: 'Apply Leave', icon: Calendar, page: 'Leave', color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
                { label: 'Submit Expense', icon: DollarSign, page: 'Reimbursements', color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
                { label: 'Raise Ticket', icon: HelpCircle, page: 'Helpdesk', color: 'bg-orange-50 text-orange-700 hover:bg-orange-100' },
                { label: 'Regularisation', icon: Briefcase, page: 'AttendanceRegularisation', color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
                { label: 'My Payslips', icon: FileText, page: 'Payslips', color: 'bg-pink-50 text-pink-700 hover:bg-pink-100' },
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Bell className="w-4 h-4" /> Announcements</span>
                <Link to={createPageUrl('Announcements')} className="text-sm text-blue-600 font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.announcements.length > 0 ? (
                <div className="space-y-3">
                  {data.announcements.slice(0, 4).map(a => (
                    <div key={a.id} className="p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">{a.title}</p>
                        <Badge className="text-xs capitalize shrink-0 bg-blue-100 text-blue-700">{a.category}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-6">No announcements</p>
              )}
            </CardContent>
          </Card>

          {/* My Assets */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Briefcase className="w-4 h-4" /> My Assets</span>
                <Link to={createPageUrl('MyAssets')} className="text-sm text-blue-600 font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.myAssets.length > 0 ? (
                <div className="space-y-2">
                  {data.myAssets.slice(0, 4).map(a => (
                    <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                      <div>
                        <p className="text-sm font-medium">{a.asset_name}</p>
                        <p className="text-xs text-gray-400 font-mono">{a.asset_id}</p>
                      </div>
                      <Badge className="text-xs bg-blue-100 text-blue-700">{a.condition}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-4">No assets assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Insurance Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> Insurance</span>
                <Link to={createPageUrl('MyInsurance')} className="text-sm text-blue-600 font-normal hover:underline">Details →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.hasInsurance ? (
                <div className="p-3 bg-green-50 rounded-lg flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Insurance Active</p>
                    <p className="text-xs text-green-600">Policy coverage confirmed</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-yellow-50 rounded-lg">
                  <p className="text-sm text-yellow-800">No insurance policy on record</p>
                  <p className="text-xs text-yellow-600">Contact HR for details</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Training Notifications */}
          {data.trainingNotifs.length > 0 && (
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><GraduationCap className="w-4 h-4 text-blue-600" /> Training Updates</span>
                  <Link to={createPageUrl('MyTraining')} className="text-sm text-blue-600 font-normal hover:underline">View My Training →</Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.trainingNotifs.map(notif => (
                    <div key={notif.id} className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                      <GraduationCap className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{notif.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                      </div>
                      <button
                        onClick={async () => {
                          await base44.entities.TrainingNotification.update(notif.id, { is_read: true });
                          setData(prev => ({ ...prev, trainingNotifs: prev.trainingNotifs.filter(n => n.id !== notif.id) }));
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700 shrink-0 whitespace-nowrap"
                      >
                        Dismiss
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Pending Alerts */}
        {(data.pendingReimbursements > 0 || data.openTickets > 0) && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-yellow-800">
                <AlertCircle className="w-4 h-4" /> Pending Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {data.pendingReimbursements > 0 && (
                <Link to={createPageUrl('Reimbursements')} className="flex items-center gap-2 text-sm font-medium text-yellow-800 hover:underline">
                  <DollarSign className="w-4 h-4" /> {data.pendingReimbursements} expense(s) pending approval <ChevronRight className="w-4 h-4" />
                </Link>
              )}
              {data.openTickets > 0 && (
                <Link to={createPageUrl('Helpdesk')} className="flex items-center gap-2 text-sm font-medium text-yellow-800 hover:underline">
                  <HelpCircle className="w-4 h-4" /> {data.openTickets} open ticket(s) <ChevronRight className="w-4 h-4" />
                </Link>
              )}
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