import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Users, UserCheck, UserX, DollarSign, TrendingDown, TrendingUp, FileText, HelpCircle, RefreshCw, Clock, Coffee, Fingerprint, Laptop, LogOut, Shield, IndianRupee, AlertCircle, CheckCircle2, Sparkles, Loader2, TrendingUp as Trend, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MetricCard from '@/components/mis/MetricCard';
import InsightCard from '@/components/mis/InsightCard';
import { Link } from 'react-router-dom';
import {
  AttendanceTrendChart,
  HeadcountGrowthChart,
  AttritionTrendChart,
  PayrollTrendChart,
  DeptSalaryChart,
  LeaveTrendChart,
  RecruitmentFunnelChart,
  HiringSourceChart,
  PerformanceRatingChart,
  DeptAttendanceChart,
  ExpenseByCategory,
  TicketsByCategoryChart,
} from '@/components/mis/SectionChart';

const TABS = [
  { id: 'overview', label: 'Executive Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'leave', label: 'Leave' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'recruitment', label: 'Recruitment' },
  { id: 'performance', label: 'Performance' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'helpdesk', label: 'Helpdesk' },
  { id: 'assets', label: 'Assets' },
  { id: 'exits', label: 'Exits' },
  { id: 'compliance', label: 'Compliance' },
];

const INSIGHT_COLORS = {
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  positive: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  critical: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};
const INSIGHT_ICONS = {
  warning: '⚠️', positive: '✅', critical: '🚨', info: '💡',
};

function AIInsightsPanel({ data, metrics }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState(null);

  const generateInsights = async () => {
    setLoading(true); setError(null);
    try {
      const res = await base44.functions.invoke('getMISInsights', {
        metrics: {
          totalActive: metrics.totalActive,
          presentToday: metrics.presentToday,
          absentToday: metrics.absentToday,
          attritionRate: metrics.attritionRate,
          totalPayrollCost: metrics.totalPayrollCost,
          pendingLeaveRequests: metrics.pendingLeaveRequests,
          openTickets: metrics.openTickets,
          activeLeaves: metrics.activeLeaves,
        },
        context: {
          exits: data?.exits,
          recruitment: data?.recruitment,
          compliance: { overdueDeadlines: data?.compliance?.overdueDeadlines, kycMissing: data?.compliance?.kycMissing },
          assets: { overdueReturns: data?.assets?.overdueReturns, underRepair: data?.assets?.underRepair },
          tickets: data?.tickets,
        }
      });
      setInsights(res?.data?.insights || res?.insights || []);
    } catch (e) {
      setError('AI analysis unavailable. Check GROQ_API_KEY in Railway settings.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-100">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold text-gray-800">AI-Driven Insights</h3>
          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">Powered by Groq</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={generateInsights} disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {insights ? 'Refresh Analysis' : 'Generate Insights'}
          </Button>
          <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              <p className="text-sm">Analyzing HR data with AI…</p>
            </div>
          )}
          {!loading && !insights && !error && (
            <div className="text-center py-8 text-gray-400">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40 text-purple-300" />
              <p className="text-sm">Click "Generate Insights" to get AI-powered analysis of your HR metrics.</p>
            </div>
          )}
          {insights && !loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((insight, i) => (
                <div key={i} className={`rounded-lg border p-4 ${INSIGHT_COLORS[insight.type] || INSIGHT_COLORS.info}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-lg leading-none mt-0.5">{INSIGHT_ICONS[insight.type] || '💡'}</span>
                    <div>
                      <p className="font-semibold text-sm">{insight.title}</p>
                      <p className="text-sm mt-1 opacity-90">{insight.detail}</p>
                      {insight.action && <p className="text-xs mt-2 font-medium opacity-75">→ {insight.action}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MISDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getMISData', {});
      setData(res?.data || res);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('MIS fetch failed:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const m = data?.metrics || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">MIS Analytics Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString('en-IN')}` : 'Loading...'}
            </p>
          </div>
          <Button onClick={fetchData} disabled={loading} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mt-4 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {loading && !data ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Loading analytics data...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Executive Overview */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Total Employees" value={m.totalActive} subtitle="Active headcount" icon={Users} color="blue" />
                  <MetricCard title="Present Today" value={m.presentToday} subtitle={`${m.totalActive ? ((m.presentToday / m.totalActive) * 100).toFixed(1) : 0}% attendance rate`} icon={UserCheck} color="green" onClick={() => setActiveTab('attendance')} />
                  <MetricCard title="Absent Today" value={m.absentToday} subtitle="Including leaves" icon={UserX} color="red" onClick={() => setActiveTab('attendance')} />
                  <MetricCard title="Active Leaves" value={m.activeLeaves} subtitle="Approved & on leave" icon={FileText} color="yellow" onClick={() => setActiveTab('leave')} />
                  <MetricCard title="Payroll Cost" value={`₹${(m.totalPayrollCost || 0).toLocaleString('en-IN')}`} subtitle="Current month net" icon={DollarSign} color="purple" onClick={() => setActiveTab('payroll')} />
                  <MetricCard title="Attrition Rate" value={`${m.attritionRate || 0}%`} subtitle="Annualized (12 months)" icon={TrendingDown} color="orange" />
                  <MetricCard title="Pending Leaves" value={m.pendingLeaveRequests} subtitle="Awaiting approval" icon={FileText} color="yellow" onClick={() => setActiveTab('leave')} />
                  <MetricCard title="Open Tickets" value={m.openTickets} subtitle="Helpdesk open items" icon={HelpCircle} color="blue" onClick={() => setActiveTab('helpdesk')} />
                </div>

                {/* AI Insights */}
                <AIInsightsPanel data={data} metrics={m} />
                <InsightCard insights={data?.insights || []} />

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AttendanceTrendChart data={data?.attendanceTrends || []} />
                  <HeadcountGrowthChart data={data?.headcountGrowth || []} />
                </div>

                {/* Charts Row 2 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AttritionTrendChart data={data?.attritionTrend || []} />
                  <DeptAttendanceChart data={data?.departmentBreakdown || []} />
                </div>
              </div>
            )}

            {/* Attendance Tab */}
            {activeTab === 'attendance' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="Present Today" value={m.presentToday} subtitle="Marked present" icon={UserCheck} color="green" />
                  <MetricCard title="Absent Today" value={m.absentToday} subtitle="Not marked present" icon={UserX} color="red" />
                  <MetricCard title="Attendance Rate" value={`${m.totalActive ? ((m.presentToday / m.totalActive) * 100).toFixed(1) : 0}%`} subtitle="Today" icon={UserCheck} color="blue" />
                </div>
                {/* Biometric Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Biometric Records" value={m.biometricSyncedCount} subtitle="This month (synced)" icon={Fingerprint} color="purple" />
                  <MetricCard title="Avg Work Hours" value={`${m.avgWorkingHours}h`} subtitle="Per biometric day" icon={Clock} color="blue" />
                  <MetricCard title="Avg Break Hours" value={`${m.avgBreakHours}h`} subtitle="Per biometric day" icon={Coffee} color="orange" />
                  <MetricCard title="Avg Daily Punches" value={m.avgDailyPunches} subtitle="Punches per employee/day" icon={UserCheck} color="green" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AttendanceTrendChart data={data?.attendanceTrends || []} />
                  <DeptAttendanceChart data={data?.departmentBreakdown || []} />
                </div>
              </div>
            )}

            {/* Leave Tab */}
            {activeTab === 'leave' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="Active Leaves" value={m.activeLeaves} subtitle="Currently on leave" icon={FileText} color="yellow" />
                  <MetricCard title="Pending Approvals" value={m.pendingLeaveRequests} subtitle="Awaiting action" icon={FileText} color="orange" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <LeaveTrendChart data={data?.leaveTrend || []} />
                  <DeptAttendanceChart data={data?.departmentBreakdown || []} />
                </div>
              </div>
            )}

            {/* Payroll Tab */}
            {activeTab === 'payroll' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="Monthly Payroll" value={`₹${(m.totalPayrollCost || 0).toLocaleString('en-IN')}`} subtitle="Current month net" icon={DollarSign} color="purple" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <PayrollTrendChart data={data?.payrollTrend || []} />
                  <DeptSalaryChart data={data?.salarByDept || []} />
                </div>
                <div className="flex justify-end">
                  <Link
                    to="/PayrollAnalytics"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    View Detailed Payroll Analytics →
                  </Link>
                </div>
              </div>
            )}

            {/* Recruitment Tab */}
            {activeTab === 'recruitment' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Total Candidates" value={data?.recruitment?.totalCandidates} subtitle="All time" icon={Users} color="blue" />
                  <MetricCard title="Hired" value={data?.recruitment?.hired} subtitle="Joined" icon={UserCheck} color="green" />
                  <MetricCard title="In Pipeline" value={data?.recruitment?.inPipeline} subtitle="Active candidates" icon={Users} color="yellow" />
                  <MetricCard title="Rejected" value={data?.recruitment?.rejected} subtitle="Not selected" icon={UserX} color="red" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <RecruitmentFunnelChart data={data?.recruitment || {}} />
                  <HiringSourceChart data={data?.recruitment?.hiringBySource || []} />
                </div>
              </div>
            )}

            {/* Performance Tab */}
            {activeTab === 'performance' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <PerformanceRatingChart data={data?.ratingDist || []} />
                  <DeptAttendanceChart data={data?.departmentBreakdown || []} />
                </div>
              </div>
            )}

            {/* Expenses Tab */}
            {activeTab === 'expenses' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="Total Claims" value={`₹${(data?.reimbursements?.total || 0).toLocaleString('en-IN')}`} subtitle="All reimbursements" icon={DollarSign} color="blue" />
                  <MetricCard title="Pending" value={`₹${(data?.reimbursements?.pending || 0).toLocaleString('en-IN')}`} subtitle="Awaiting approval" icon={DollarSign} color="yellow" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ExpenseByCategory data={data?.reimbursements?.byCategory || []} />
                </div>
              </div>
            )}

            {/* Helpdesk Tab */}
            {activeTab === 'helpdesk' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="Open Tickets" value={data?.tickets?.openTickets} subtitle="Unresolved" icon={HelpCircle} color="red" />
                  <MetricCard title="Resolved" value={data?.tickets?.resolvedTickets} subtitle="Closed tickets" icon={HelpCircle} color="green" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <TicketsByCategoryChart data={data?.tickets?.byCategory || []} />
                </div>
              </div>
            )}

            {/* Assets Tab */}
            {activeTab === 'assets' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Total Assets" value={data?.assets?.total || 0} subtitle="All time" icon={Laptop} color="blue" />
                  <MetricCard title="Assigned" value={data?.assets?.assigned || 0} subtitle="In use" icon={UserCheck} color="green" />
                  <MetricCard title="Available" value={data?.assets?.available || 0} subtitle="In stock" icon={Laptop} color="purple" />
                  <MetricCard title="Under Repair" value={data?.assets?.underRepair || 0} subtitle="Service needed" icon={Clock} color="orange" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Discarded" value={data?.assets?.discarded || 0} subtitle="Retired" icon={Laptop} color="gray" />
                  <MetricCard title="Overdue Returns" value={data?.assets?.overdueReturns || 0} subtitle="Past deadline" icon={AlertCircle} color="red" />
                  <MetricCard title="Common Assets" value={data?.assets?.commonAssets || 0} subtitle="Shared pool" icon={Users} color="teal" />
                  <MetricCard title="Total Value" value={`₹${((data?.assets?.totalValue || 0) / 100000).toFixed(1)}L`} subtitle="Purchase cost" icon={IndianRupee} color="purple" />
                </div>
                {data?.assets?.byType && data.assets.byType.length > 0 && (
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Assets by Type</h3>
                    <div className="space-y-3">
                      {(data.assets.byType || []).map((t, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-sm font-medium w-24 truncate">{t.name}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-3">
                            <div className="bg-blue-500 h-3 rounded-full" style={{ width: `${Math.min(100, (t.count / (data?.assets?.total || 1)) * 100)}%` }} />
                          </div>
                          <span className="text-sm text-gray-500 w-8 text-right">{t.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Exits Tab */}
            {activeTab === 'exits' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="Total Exits" value={data?.exits?.total || 0} subtitle="All time" icon={LogOut} color="red" />
                  <MetricCard title="In Notice" value={data?.exits?.inNotice || 0} subtitle="Currently serving" icon={Clock} color="orange" />
                  <MetricCard title="Clearance Pending" value={data?.exits?.clearancePending || 0} subtitle="Awaiting sign-off" icon={FileText} color="purple" />
                  <MetricCard title="Completed This Month" value={data?.exits?.completedMonth || 0} subtitle="Successfully closed" icon={CheckCircle2} color="green" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="F&F Pending" value={data?.exits?.fnfPending || 0} subtitle="Settlement due" icon={IndianRupee} color="yellow" />
                  <MetricCard title="Avg Notice Served" value={`${data?.exits?.avgNoticeDays || 0}d`} subtitle="Days per exit" icon={Clock} color="blue" />
                  <MetricCard title="Attrition Rate" value={`${m.attritionRate || 0}%`} subtitle="Annualized" icon={TrendingDown} color="red" />
                </div>
              </div>
            )}

            {/* Compliance Tab */}
            {activeTab === 'compliance' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard title="PF Liability" value={`₹${(data?.compliance?.pfTotal || 0).toLocaleString('en-IN')}`} subtitle="Monthly (EE+ER)" icon={IndianRupee} color="indigo" />
                  <MetricCard title="ESI Liability" value={`₹${(data?.compliance?.esiTotal || 0).toLocaleString('en-IN')}`} subtitle="Monthly (EE+ER)" icon={IndianRupee} color="teal" />
                  <MetricCard title="TDS Deductions" value={`₹${(data?.compliance?.tdsTotal || 0).toLocaleString('en-IN')}`} subtitle="Monthly" icon={IndianRupee} color="purple" />
                  <MetricCard title="Gratuity Provision" value={`₹${(data?.compliance?.gratuityTotal || 0).toLocaleString('en-IN')}`} subtitle="Monthly accrual" icon={TrendingUp} color="amber" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard title="KYC Compliant" value={`${data?.compliance?.kycCompliant || 0}/${(data?.compliance?.kycCompliant || 0) + (data?.compliance?.kycMissing || 0)}`} subtitle="Employees verified" icon={Users} color={data?.compliance?.kycMissing > 0 ? 'orange' : 'green'} />
                  <MetricCard title="Overdue Deadlines" value={data?.compliance?.overdueDeadlines || 0} subtitle="Requires action" icon={AlertCircle} color="red" />
                  <MetricCard title="PT Deductions" value={`₹${(data?.compliance?.ptTotal || 0).toLocaleString('en-IN')}`} subtitle="Professional Tax" icon={IndianRupee} color="blue" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}