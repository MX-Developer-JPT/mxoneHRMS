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

  useEffect(() => { loadData().catch(e => { console.error('EmployeeDashboard:', e.message); setLoading(false); }); }, []);

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

    const policyMap = {};
    leavePolicies.forEach(p => { policyMap[p.id] = p.name; });

    const enrichedBalances = leaveBalances.map(lb => ({
      ...lb,
      policyName: policyMap[lb.leave_policy_id] || lb.leave_type_name || 'Leave'
    }));

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
        if (newHours === oldHours && new Date(a.updated_date) > new Date(existing.updated_date)) byDate[a.date] = a;
      }
    }
    const uniqueAtt = Object.values(byDate);

    const presentDays = uniqueAtt.filter(a => ['present', 'half_day', 'on_duty'].includes(a.status)).length;
    const absentDays  = uniqueAtt.filter(a => a.status === 'absent').length;
    const leaveDays   = uniqueAtt.filter(a => a.status === 'leave').length;

    const totalLeaveAvailable = enrichedBalances.reduce((s, lb) => s + (lb.available || 0), 0);

    const employeeRecord = myEmp?.[0];
    const hasInsurance = employeeRecord?.insurance?.has_insurance || employeeRecord?.insurance_policies?.length > 0;

    setData({
      todayAtt: todayAtt[0] || null,
      presentDays, absentDays, leaveDays,
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
      <div className="w-8 h-8 border-[3px] border-indigo-200 dark:border-indigo-900 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
  if (!data) return <div className="p-8 text-center text-gray-400">Could not load dashboard data. Please refresh.</div>;

  const att = data.todayAtt;
  const checkedIn  = att?.check_in_time;
  const checkedOut = att?.check_out_time;

  const leaveStatusColor = {
    pending:   'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
    approved:  'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300',
    rejected:  'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300',
    cancelled: 'bg-muted text-muted-foreground',
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const firstName = (user.display_name || user.full_name)?.split(' ')[0];

  const openModal = (title, content) => setDetailModal({ title, content });

  /* ── attendance card style ─────────────────────────────── */
  const attCardStyle = checkedIn && !checkedOut
    ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30'
    : checkedOut
    ? 'border-blue-400 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30'
    : 'border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30';

  const attIconStyle = checkedIn && !checkedOut
    ? 'bg-emerald-100 dark:bg-emerald-900/60'
    : checkedOut
    ? 'bg-blue-100 dark:bg-blue-900/60'
    : 'bg-amber-100 dark:bg-amber-900/60';

  const attIconColor = checkedIn && !checkedOut
    ? 'text-emerald-600 dark:text-emerald-400'
    : checkedOut
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-amber-500 dark:text-amber-400';

  const attStatus = checkedIn && !checkedOut ? '✅ Checked In' : checkedOut ? '🏁 Day Complete' : '⚠️ Not Marked Yet';

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            {greeting}, {firstName}! 👋
          </h1>
          <p className="text-muted-foreground mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {/* Today's Attendance Status */}
        <Card className={`border-2 ${attCardStyle}`}>
          <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${attIconStyle}`}>
                <Clock className={`w-7 h-7 ${attIconColor}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-medium">Today's Attendance</p>
                <p className="text-xl font-bold text-foreground">{attStatus}</p>
                <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                  {checkedIn && <span>In: <strong className="text-foreground">{format(new Date(att.check_in_time), 'hh:mm a')}</strong></span>}
                  {checkedOut && <span>Out: <strong className="text-foreground">{format(new Date(att.check_out_time), 'hh:mm a')}</strong></span>}
                  {att?.working_hours > 0 && <span>Hours: <strong className="text-foreground">{att.working_hours.toFixed(1)}h</strong></span>}
                </div>
              </div>
            </div>
            {!checkedIn && (
              <Link to={createPageUrl('MarkAttendance')} className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors">
                Mark Attendance →
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Attendance This Month',
              <div className="space-y-2">
                {[
                  { label: 'Present Days',       value: data.presentDays,      color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
                  { label: 'Absent Days',        value: data.absentDays,       color: 'text-red-500 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-950/40' },
                  { label: 'Leave Days',         value: data.leaveDays,        color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-950/40' },
                  { label: 'Total Working Days', value: `${data.uniqueAttCount} days`, color: 'text-muted-foreground', bg: 'bg-muted/50' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`flex justify-between items-center p-3 ${bg} rounded-lg`}>
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className={`text-sm font-bold ${color}`}>{value}</span>
                  </div>
                ))}
                <Link to={createPageUrl('AttendanceHistory')} className="block text-center text-sm text-primary hover:underline pt-2">View full history →</Link>
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/60 rounded-xl flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.presentDays}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Present Days</p>
              <p className="text-xs text-muted-foreground/70 mt-1">This month · click</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Absent Days This Month',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-red-50 dark:bg-red-950/40 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Absent Days</span>
                  <span className="text-sm font-bold text-red-500 dark:text-red-400">{data.absentDays}</span>
                </div>
                <p className="text-xs text-muted-foreground text-center pt-2">Need to regularise? Raise a request.</p>
                <Link to={createPageUrl('AttendanceRegularisation')} className="block text-center text-sm text-primary hover:underline">Raise Regularisation →</Link>
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-950/60 rounded-xl flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.absentDays}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Absent Days</p>
              <p className="text-xs text-muted-foreground/70 mt-1">This month · click</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Leave Balance Breakdown',
              <div className="space-y-2">
                {data.leaveBalances.length === 0
                  ? <p className="text-muted-foreground text-sm text-center py-4">No leave policies assigned</p>
                  : data.leaveBalances.map((lb, i) => (
                    <div key={i} className="p-3 bg-violet-50 dark:bg-violet-950/40 rounded-lg">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-foreground">{lb.policyName}</span>
                        <span className="text-sm font-bold text-violet-700 dark:text-violet-400">{lb.available || 0} / {lb.total_allocated || 0}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div className="bg-violet-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, ((lb.available || 0) / (lb.total_allocated || 1)) * 100)}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Used: {lb.used || 0} · Pending: {lb.pending_approval || 0}</p>
                    </div>
                  ))
                }
                <Link to={createPageUrl('Leave')} className="block text-center text-sm text-primary hover:underline pt-2">Apply Leave →</Link>
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-violet-100 dark:bg-violet-950/60 rounded-xl flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.totalLeaveAvailable}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Leave Balance</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Days available · click</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-all group"
            onClick={() => openModal('Pending Regularisations',
              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-orange-50 dark:bg-orange-950/40 rounded-lg">
                  <span className="text-sm font-medium text-foreground">Pending Requests</span>
                  <span className="text-sm font-bold text-orange-500 dark:text-orange-400">{data.pendingRegularisations}</span>
                </div>
                <p className="text-xs text-muted-foreground text-center pt-1">These are awaiting approval from your manager.</p>
                <Link to={createPageUrl('AttendanceRegularisation')} className="block text-center text-sm text-primary hover:underline">View requests →</Link>
              </div>
            )}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-950/60 rounded-xl flex items-center justify-center">
                  <Clock className="w-5 h-5 text-orange-500 dark:text-orange-400" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-2xl font-bold text-foreground">{data.pendingRegularisations}</p>
              <p className="text-sm text-muted-foreground mt-0.5">Pending Regularisation</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Pending · click</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Leave Balances */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Leave Balances
                <Link to={createPageUrl('Leave')} className="text-sm text-primary font-normal hover:underline">Apply Leave →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.leaveBalances.length > 0 ? (
                <div className="space-y-3">
                  {data.leaveBalances.map((lb, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-foreground">{lb.policyName}</span>
                          <span className="text-sm text-muted-foreground">{lb.available}/{lb.total_allocated}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${Math.min(100, ((lb.available || 0) / (lb.total_allocated || 1)) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-6">No leave policies assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Leave Requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Recent Leave Requests
                <Link to={createPageUrl('Leave')} className="text-sm text-primary font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentLeaves.length > 0 ? (
                <div className="space-y-3">
                  {data.recentLeaves.map(lv => (
                    <div key={lv.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">{format(new Date(lv.start_date), 'MMM d')} – {format(new Date(lv.end_date), 'MMM d, yyyy')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{lv.reason}</p>
                      </div>
                      <Badge className={`text-xs border-0 ${leaveStatusColor[lv.status] || 'bg-muted text-muted-foreground'}`}>{lv.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-6">No recent leave requests</p>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                { label: 'Mark Attendance', icon: Clock,        page: 'MarkAttendance',           bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60' },
                { label: 'Apply Leave',     icon: Calendar,     page: 'Leave',                    bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60' },
                { label: 'Submit Expense',  icon: DollarSign,   page: 'Reimbursements',           bg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950/60' },
                { label: 'Raise Ticket',    icon: HelpCircle,   page: 'Helpdesk',                 bg: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-950/60' },
                { label: 'Regularisation',  icon: Briefcase,    page: 'AttendanceRegularisation', bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/60' },
                { label: 'My Payslips',     icon: FileText,     page: 'Payslips',                 bg: 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-950/60' },
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                <span className="flex items-center gap-2"><Bell className="w-4 h-4" /> Announcements</span>
                <Link to={createPageUrl('Announcements')} className="text-sm text-primary font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.announcements.length > 0 ? (
                <div className="space-y-3">
                  {data.announcements.slice(0, 4).map(a => (
                    <div key={a.id} className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{a.title}</p>
                        <Badge className="text-xs capitalize shrink-0 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-0">{a.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-6">No announcements</p>
              )}
            </CardContent>
          </Card>

          {/* My Assets */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                <span className="flex items-center gap-2"><Briefcase className="w-4 h-4" /> My Assets</span>
                <Link to={createPageUrl('MyAssets')} className="text-sm text-primary font-normal hover:underline">View All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.myAssets.length > 0 ? (
                <div className="space-y-2">
                  {data.myAssets.slice(0, 4).map(a => (
                    <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">{a.asset_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{a.asset_id}</p>
                      </div>
                      <Badge className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-0">{a.condition}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-4">No assets assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Insurance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> Insurance</span>
                <Link to={createPageUrl('MyInsurance')} className="text-sm text-primary font-normal hover:underline">Details →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.hasInsurance ? (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Insurance Active</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400/80">Policy coverage confirmed</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl">
                  <p className="text-sm text-amber-800 dark:text-amber-300">No insurance policy on record</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400/80">Contact HR for details</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Training Notifications */}
          {data.trainingNotifs.length > 0 && (
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between text-foreground">
                  <span className="flex items-center gap-2"><GraduationCap className="w-4 h-4 text-primary" /> Training Updates</span>
                  <Link to={createPageUrl('MyTraining')} className="text-sm text-primary font-normal hover:underline">View My Training →</Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.trainingNotifs.map(notif => (
                    <div key={notif.id} className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/50">
                      <GraduationCap className="w-4 h-4 text-blue-500 dark:text-blue-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{notif.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                      </div>
                      <button
                        onClick={async () => {
                          await base44.entities.TrainingNotification.update(notif.id, { is_read: true });
                          setData(prev => ({ ...prev, trainingNotifs: prev.trainingNotifs.filter(n => n.id !== notif.id) }));
                        }}
                        className="text-xs text-primary hover:underline shrink-0 whitespace-nowrap"
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
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <AlertCircle className="w-4 h-4" /> Pending Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {data.pendingReimbursements > 0 && (
                <Link to={createPageUrl('Reimbursements')} className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 hover:underline">
                  <DollarSign className="w-4 h-4" /> {data.pendingReimbursements} expense(s) pending approval <ChevronRight className="w-4 h-4" />
                </Link>
              )}
              {data.openTickets > 0 && (
                <Link to={createPageUrl('Helpdesk')} className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 hover:underline">
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
