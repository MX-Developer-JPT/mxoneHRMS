import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import {
  Users, Search, Clock, CheckCircle2, AlertCircle, TrendingDown, BarChart3,
  Plus, Loader2, XCircle, RotateCcw, Activity, DollarSign, ClipboardList,
  Package, CalendarDays, UserCheck, UserX, ChevronRight, RefreshCw,
  Building2, PieChart, Percent, Timer
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend
} from 'recharts';
import ExitDetailPanel from '../components/exit/ExitDetailPanel';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

const STATUS_CONFIG = {
  submitted:          { label: 'Submitted',        color: 'bg-blue-100 text-blue-800' },
  manager_approved:   { label: 'Mgr Approved',     color: 'bg-yellow-100 text-yellow-800' },
  manager_rejected:   { label: 'Mgr Rejected',     color: 'bg-red-100 text-red-800' },
  hr_approved:        { label: 'HR Approved',       color: 'bg-green-100 text-green-800' },
  hr_rejected:        { label: 'HR Rejected',       color: 'bg-red-100 text-red-800' },
  in_notice:          { label: 'In Notice',         color: 'bg-orange-100 text-orange-800' },
  buyout_pending:     { label: 'Buyout Pending',    color: 'bg-amber-100 text-amber-800' },
  clearance_pending:  { label: 'Clearance',         color: 'bg-purple-100 text-purple-800' },
  clearance_done:     { label: 'Clearance Done',    color: 'bg-teal-100 text-teal-800' },
  fnf_pending:        { label: 'F&F Pending',       color: 'bg-indigo-100 text-indigo-800' },
  completed:          { label: 'Relieved',          color: 'bg-green-200 text-green-900' },
  withdrawn:          { label: 'Withdrawn',         color: 'bg-gray-200 text-gray-700' },
  cancelled:          { label: 'Cancelled',         color: 'bg-gray-100 text-gray-600' },
};

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

const REASON_MAP = {
  better_opportunity: 'Better Opportunity', higher_education: 'Higher Education',
  personal_reasons: 'Personal Reasons', relocation: 'Relocation',
  health_reasons: 'Health Reasons', family_reasons: 'Family Reasons',
  work_life_balance: 'Work-Life Balance', compensation: 'Compensation',
  growth: 'Career Growth', management_issues: 'Management Issues',
  culture_fit: 'Culture / Environment', mutual_separation: 'Mutual Separation',
  contract_end: 'Contract End', retirement: 'Retirement', other: 'Other',
};

export default function ExitManagement() {
  const [exits, setExits]           = useState([]);
  const [enriched, setEnriched]     = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected]     = useState(null);
  const [activeTab, setActiveTab]   = useState('dashboard');
  const [showInitiate, setShowInitiate] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [empSearch, setEmpSearch]   = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [initForm, setInitForm]     = useState({
    reason_category: '', resignation_date: format(new Date(), 'yyyy-MM-dd'),
    last_working_date: '', exit_type: 'resignation', hr_notes: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setCurrentUser(me);
      const role = me.custom_role || me.role;
      const isHR = role === 'hr' || role === 'admin';

      const [allExits, usersResp, allEmps] = await Promise.all([
        base44.entities.Exit.list('-created_date', 300),
        base44.functions.invoke('getAllUsers', {}),
        base44.entities.Employee.list('-created_date', 500),
      ]);

      const users = usersResp.data?.users || [];
      const myEmpRec = allEmps.filter(e => e.user_id === me.id);
      const myDept = (myEmpRec?.[0]?.department || '').trim().toLowerCase();
      const clearanceDeptKw = ['it', 'information technology', 'finance', 'accounts', 'admin', 'administration', 'security'];
      const isDeptClearance = clearanceDeptKw.some(kw => myDept.includes(kw));

      let filtered = allExits;
      if (!isHR) {
        if (role === 'management' || role === 'manager') {
          const reporteeIds = allEmps.filter(e => e.reporting_manager_id === me.id).map(e => e.user_id);
          filtered = allExits.filter(e => reporteeIds.includes(e.user_id) || ['clearance_pending','clearance_done'].includes(e.status));
        } else if (isDeptClearance) {
          filtered = allExits.filter(e => ['clearance_pending','clearance_done'].includes(e.status));
        } else {
          filtered = [];
        }
      }

      const enrichedData = filtered.map(ex => ({
        ...ex,
        employee: allEmps.find(e => e.user_id === ex.user_id),
        user: users.find(u => u.id === ex.user_id),
      }));

      setExits(allExits);
      setEnriched(enrichedData);
      setAllEmployees(allEmps);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const isHRRole = () => { const r = currentUser?.custom_role || currentUser?.role; return r === 'hr' || r === 'admin'; };

  const handleInitiateExit = async (e) => {
    e.preventDefault();
    if (!selectedEmp || !initForm.reason_category || !initForm.last_working_date) {
      toast.error('Please fill all required fields'); return;
    }
    setInitiating(true);
    try {
      const now = new Date().toISOString();
      await base44.entities.Exit.create({
        user_id: selectedEmp.user_id,
        exit_type: initForm.exit_type,
        reason_category: initForm.reason_category,
        resignation_date: initForm.resignation_date,
        last_working_date: initForm.last_working_date,
        proposed_last_day: initForm.last_working_date,
        hr_notes: initForm.hr_notes,
        status: 'in_notice',
        initiated_by_hr: true,
        hr_actioned_by: currentUser.id,
        hr_actioned_at: now,
        notice_period_days: 30,
        approval_stages: [
          { stage: 'manager', status: 'approved', actor_name: 'HR (initiated)', timestamp: now },
          { stage: 'hr', status: 'approved', actor_id: currentUser.id, actor_name: currentUser.full_name, timestamp: now },
        ],
        clearance_checklist: { hr:{status:'pending'}, it:{status:'pending'}, admin:{status:'pending'}, finance:{status:'pending'}, security:{status:'pending'}, reporting_manager:{status:'pending'}, project_manager:{status:'pending'} },
        assets: [], kt_items: [],
        exit_interview: null, hr_exit_interview: null,
        exit_interview_completed: false, hr_interview_completed: false,
        fnf_data: null, fnf_calculated: false,
        access_deactivated: false, relieving_letter_generated: false, experience_letter_generated: false,
        audit_log: [{ actor_id: currentUser.id, actor_name: currentUser.full_name, action: 'HR Initiated Exit', comment: initForm.hr_notes || '', timestamp: now }],
      });
      base44.functions.invoke('notifyExitStatusChange', {
        action: 'hr_initiated', employee_id: selectedEmp.user_id,
        employee_name: selectedEmp.display_name || '', actor_name: currentUser?.full_name || 'HR',
      }).catch(() => {});
      toast.success('Exit initiated successfully');
      setShowInitiate(false);
      setSelectedEmp(null); setEmpSearch('');
      setInitForm({ reason_category: '', resignation_date: format(new Date(), 'yyyy-MM-dd'), last_working_date: '', exit_type: 'resignation', hr_notes: '' });
      loadData();
    } catch (err) { toast.error('Failed to initiate exit'); }
    setInitiating(false);
  };

  /* ── dashboard stats ── */
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const stats = useMemo(() => {
    const all = enriched;
    const thisMonth = all.filter(e => new Date(e.created_at || e.resignation_date || 0) >= thisMonthStart);
    const pendingApproval = all.filter(e => ['submitted','manager_approved'].includes(e.status)).length;
    const inNotice = all.filter(e => e.status === 'in_notice').length;
    const clearancePending = all.filter(e => ['clearance_pending','clearance_done'].includes(e.status)).length;
    const completedMonth = all.filter(e => e.status === 'completed' && new Date(e.last_working_date || 0) >= thisMonthStart).length;
    const fnfPending = all.filter(e => e.status === 'fnf_pending').length;

    // Dept-wise
    const deptMap = {};
    all.forEach(e => { const d = e.employee?.department || 'Unknown'; deptMap[d] = (deptMap[d] || 0) + 1; });
    const deptChart = Object.entries(deptMap).map(([dept, count]) => ({ dept: dept.length > 15 ? dept.slice(0, 15) + '…' : dept, count })).sort((a, b) => b.count - a.count).slice(0, 8);

    // Monthly trend (last 6 months)
    const monthMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthMap[format(d, 'MMM yy')] = 0;
    }
    all.forEach(e => {
      const d = e.created_at || e.resignation_date;
      if (d) { const key = format(new Date(d), 'MMM yy'); if (key in monthMap) monthMap[key]++; }
    });
    const monthlyChart = Object.entries(monthMap).map(([month, count]) => ({ month, count }));

    // Reason-wise
    const reasonMap = {};
    all.forEach(e => { const r = REASON_MAP[e.reason_category] || e.reason_category || 'Unknown'; reasonMap[r] = (reasonMap[r] || 0) + 1; });
    const reasonChart = Object.entries(reasonMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

    // Voluntary vs Involuntary
    const voluntary = all.filter(e => ['resignation','mutual_separation','retirement'].includes(e.exit_type)).length;
    const involuntary = all.length - voluntary;
    const volChart = [{ name: 'Voluntary', value: voluntary }, { name: 'Involuntary', value: involuntary }];

    // Avg notice (for completed)
    const completed = all.filter(e => e.status === 'completed' && e.notice_period_days);
    const avgNotice = completed.length ? Math.round(completed.reduce((a, e) => a + (e.notice_period_days || 0), 0) / completed.length) : 0;

    return { total: all.length, thisMonth: thisMonth.length, pendingApproval, inNotice, clearancePending, completedMonth, fnfPending, deptChart, monthlyChart, reasonChart, volChart, avgNotice };
  }, [enriched]);

  const filteredExits = useMemo(() => enriched.filter(ex => {
    const q = search.toLowerCase();
    const matchSearch = !q || ex.user?.full_name?.toLowerCase().includes(q) || ex.employee?.employee_code?.toLowerCase().includes(q) || ex.employee?.department?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || ex.status === statusFilter;
    return matchSearch && matchStatus;
  }), [enriched, search, statusFilter]);

  const filteredEmpSearch = empSearch.trim().length > 0
    ? allEmployees.filter(e => (e.display_name || '').toLowerCase().includes(empSearch.toLowerCase()) || (e.employee_code || '').toLowerCase().includes(empSearch.toLowerCase())).slice(0, 6)
    : [];

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-red-50">
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <TrendingDown className="w-8 h-8 text-red-600" /> Exit Management
            </h1>
            <p className="text-gray-600 mt-1">Manage employee exits, approvals, clearances & F&F settlements</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadData} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            {isHRRole() && <Button onClick={() => setShowInitiate(true)} className="bg-red-600 hover:bg-red-700"><Plus className="w-4 h-4 mr-1" />Initiate Exit</Button>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {[{ id: 'dashboard', label: 'Dashboard', icon: BarChart3 }, { id: 'cases', label: 'Exit Cases', icon: Users }].map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>

        {/* ══ DASHBOARD TAB ══ */}
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'This Month',         value: stats.thisMonth,      color: 'text-red-700',    bg: 'bg-red-50',    icon: TrendingDown,    action: () => { setActiveTab('cases'); setStatusFilter('all'); } },
                { label: 'Pending Approval',   value: stats.pendingApproval,color: 'text-blue-700',   bg: 'bg-blue-50',   icon: Clock,           action: () => { setActiveTab('cases'); setStatusFilter('submitted'); } },
                { label: 'In Notice Period',   value: stats.inNotice,       color: 'text-orange-700', bg: 'bg-orange-50', icon: CalendarDays,    action: () => { setActiveTab('cases'); setStatusFilter('in_notice'); } },
                { label: 'Clearance Pending',  value: stats.clearancePending,color:'text-purple-700', bg: 'bg-purple-50', icon: ClipboardList,   action: () => { setActiveTab('cases'); setStatusFilter('clearance_pending'); } },
                { label: 'F&F Pending',        value: stats.fnfPending,     color: 'text-indigo-700', bg: 'bg-indigo-50', icon: DollarSign,      action: () => { setActiveTab('cases'); setStatusFilter('fnf_pending'); } },
                { label: 'Relieved (Month)',   value: stats.completedMonth, color: 'text-green-700',  bg: 'bg-green-50',  icon: UserCheck,       action: () => { setActiveTab('cases'); setStatusFilter('completed'); } },
                { label: 'Avg Notice (days)',  value: stats.avgNotice,      color: 'text-gray-700',   bg: 'bg-gray-50',   icon: Timer,           action: null },
                { label: 'Total Exits',        value: stats.total,          color: 'text-gray-700',   bg: 'bg-gray-100',  icon: Users,           action: () => { setActiveTab('cases'); setStatusFilter('all'); } },
              ].map(s => {
                const Icon = s.icon;
                return (
                  <Card key={s.label} className={`cursor-pointer hover:shadow-md transition-shadow ${s.action ? '' : 'cursor-default'}`} onClick={() => s.action?.()}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={`p-2 rounded-full ${s.bg}`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                      <div>
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-gray-500">{s.label}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Charts row 1 */}
            <div className="grid md:grid-cols-2 gap-5">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-600">Monthly Exit Trend</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.monthlyChart} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#ef4444" radius={[3, 3, 0, 0]} name="Exits" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-600">Department-wise Exits</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.deptChart} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis dataKey="dept" type="category" tick={{ fontSize: 10 }} width={100} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[0, 3, 3, 0]} name="Exits" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Charts row 2 */}
            <div className="grid md:grid-cols-2 gap-5">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-600">Reason-wise Analysis</CardTitle></CardHeader>
                <CardContent>
                  {stats.reasonChart.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <RechartsPie>
                        <Pie data={stats.reasonChart} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false} fontSize={10}>
                          {stats.reasonChart.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </RechartsPie>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No data</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-600">Voluntary vs Involuntary</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="60%" height={180}>
                      <RechartsPie>
                        <Pie data={stats.volChart} cx="50%" cy="50%" outerRadius={70} dataKey="value" >
                          <Cell fill="#ef4444" /><Cell fill="#3b82f6" />
                        </Pie>
                        <Tooltip />
                      </RechartsPie>
                    </ResponsiveContainer>
                    <div className="space-y-2 text-sm">
                      {stats.volChart.map((item, i) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: i === 0 ? '#ef4444' : '#3b82f6' }} />
                          <span className="text-gray-600">{item.name}: <strong>{item.value}</strong></span>
                        </div>
                      ))}
                      {stats.total > 0 && <p className="text-xs text-gray-400 mt-2">Total: {stats.total}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Status summary table */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-gray-600">Status Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                    const count = enriched.filter(e => e.status === key).length;
                    if (!count) return null;
                    return (
                      <button key={key} onClick={() => { setActiveTab('cases'); setStatusFilter(key); }}
                        className="flex items-center justify-between p-2 rounded-lg border hover:bg-gray-50 text-sm">
                        <Badge className={`${cfg.color} text-xs`}>{cfg.label}</Badge>
                        <span className="font-bold text-gray-700">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ══ CASES TAB ══ */}
        {activeTab === 'cases' && (
          <>
            {/* Filters */}
            <Card>
              <CardContent className="p-4 flex gap-3 flex-wrap">
                <div className="flex-1 min-w-48 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input placeholder="Name, code, department..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Filter by status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses ({enriched.length})</SelectItem>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => {
                      const count = enriched.filter(e => e.status === k).length;
                      return count > 0 ? <SelectItem key={k} value={k}>{v.label} ({count})</SelectItem> : null;
                    })}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {filteredExits.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No exit cases found</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredExits.map(ex => {
                      const sc = STATUS_CONFIG[ex.status] || { label: ex.status, color: 'bg-gray-100 text-gray-700' };
                      const lwdDate = ex.last_working_date ? new Date(ex.last_working_date) : null;
                      const daysToLWD = lwdDate ? Math.ceil((lwdDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
                      const isUrgent = daysToLWD !== null && daysToLWD <= 7 && daysToLWD >= 0;

                      return (
                        <div key={ex.id} className={`p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors cursor-pointer ${isUrgent ? 'border-l-4 border-orange-400' : ''}`}
                          onClick={() => setSelected(ex)}>
                          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-red-600 font-semibold">{ex.user?.full_name?.charAt(0)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold">{ex.user?.full_name}</p>
                              <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                              {isUrgent && <Badge className="text-xs bg-orange-100 text-orange-700 animate-pulse">LWD in {daysToLWD} days!</Badge>}
                            </div>
                            <p className="text-sm text-gray-500">{ex.employee?.designation} · {ex.employee?.department} · {ex.employee?.employee_code}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                              <span>Resigned: {ex.resignation_date ? safeDate(ex.resignation_date, 'dd MMM yyyy') : '—'}</span>
                              <span>LWD: {ex.last_working_date ? safeDate(ex.last_working_date, 'dd MMM yyyy') : '—'}</span>
                              <span className="capitalize">{REASON_MAP[ex.reason_category] || ex.reason_category?.replace(/_/g, ' ') || '—'}</span>
                              {ex.exit_type === 'termination' && <Badge className="bg-red-100 text-red-700 text-xs">Termination</Badge>}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ══ INITIATE EXIT DIALOG ══ */}
        <Dialog open={showInitiate} onOpenChange={open => { if (!open) { setShowInitiate(false); setSelectedEmp(null); setEmpSearch(''); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Initiate Exit Process</DialogTitle></DialogHeader>
            <form onSubmit={handleInitiateExit} className="space-y-4">
              <div>
                <Label>Search Employee *</Label>
                <Input value={empSearch} onChange={e => { setEmpSearch(e.target.value); setSelectedEmp(null); }} placeholder="Name or employee code..." />
                {filteredEmpSearch.length > 0 && !selectedEmp && (
                  <div className="border rounded-lg mt-1 divide-y max-h-48 overflow-y-auto shadow-sm">
                    {filteredEmpSearch.map(emp => (
                      <button type="button" key={emp.id} className="w-full text-left p-2 hover:bg-gray-50 text-sm"
                        onClick={() => { setSelectedEmp(emp); setEmpSearch(emp.display_name || ''); }}>
                        <p className="font-medium">{emp.display_name}</p>
                        <p className="text-xs text-gray-500">{emp.employee_code} · {emp.department} · {emp.designation}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedEmp && <div className="mt-1 p-2 bg-green-50 rounded text-xs text-green-700">Selected: {selectedEmp.display_name} ({selectedEmp.employee_code})</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Exit Type *</Label>
                  <Select value={initForm.exit_type} onValueChange={v => setInitForm(p => ({ ...p, exit_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resignation">Resignation</SelectItem>
                      <SelectItem value="termination">Termination</SelectItem>
                      <SelectItem value="retirement">Retirement</SelectItem>
                      <SelectItem value="contract_end">Contract End</SelectItem>
                      <SelectItem value="mutual_separation">Mutual Separation</SelectItem>
                      <SelectItem value="absconding">Absconding</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Reason Category *</Label>
                  <Select value={initForm.reason_category} onValueChange={v => setInitForm(p => ({ ...p, reason_category: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(REASON_MAP).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Resignation / Effective Date *</Label>
                  <Input type="date" value={initForm.resignation_date} onChange={e => setInitForm(p => ({ ...p, resignation_date: e.target.value }))} />
                </div>
                <div>
                  <Label>Last Working Day *</Label>
                  <Input type="date" value={initForm.last_working_date} onChange={e => setInitForm(p => ({ ...p, last_working_date: e.target.value }))} />
                </div>
              </div>

              <div>
                <Label>HR Notes (optional)</Label>
                <Textarea value={initForm.hr_notes} onChange={e => setInitForm(p => ({ ...p, hr_notes: e.target.value }))} rows={2} />
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowInitiate(false)}>Cancel</Button>
                <Button type="submit" className="flex-1 bg-red-600 hover:bg-red-700" disabled={initiating}>
                  {initiating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Initiate Exit
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ══ DETAIL PANEL ══ */}
        {selected && (
          <ExitDetailPanel
            exitRecord={selected}
            currentUser={currentUser}
            onClose={() => setSelected(null)}
            onRefresh={() => { loadData(); setSelected(null); }}
          />
        )}
      </div>
    </div>
  );
}
