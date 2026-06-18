import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Users, Search, Clock, CheckCircle2, AlertCircle, Eye, TrendingDown, BarChart3 } from 'lucide-react';
import ExitDetailPanel from '../components/exit/ExitDetailPanel';
import ExitReportsPanel from '../components/exit/ExitReportsPanel';
import UnderDevelopmentBanner from '@/components/UnderDevelopmentBanner';
import { format } from 'date-fns';

const STATUS_CONFIG = {
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  manager_approved: { label: 'Mgr Approved', color: 'bg-yellow-100 text-yellow-800' },
  manager_rejected: { label: 'Mgr Rejected', color: 'bg-red-100 text-red-800' },
  hr_approved: { label: 'HR Approved', color: 'bg-green-100 text-green-800' },
  hr_rejected: { label: 'HR Rejected', color: 'bg-red-100 text-red-800' },
  in_notice: { label: 'In Notice', color: 'bg-orange-100 text-orange-800' },
  clearance_pending: { label: 'Clearance', color: 'bg-purple-100 text-purple-800' },
  clearance_done: { label: 'Clearance Done', color: 'bg-teal-100 text-teal-800' },
  fnf_pending: { label: 'F&F Pending', color: 'bg-indigo-100 text-indigo-800' },
  completed: { label: 'Completed', color: 'bg-green-200 text-green-900' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-600' },
};

export default function ExitManagement() {
  const [exits, setExits] = useState([]);
  const [enriched, setEnriched] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('list');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const me = await base44.auth.me();
      setCurrentUser(me);
      const role = me.custom_role || me.role;
      const isHR = role === 'hr' || role === 'admin';

      const [allExits, usersResp, allEmps, myEmpRec] = await Promise.all([
        base44.entities.Exit.list('-created_date', 200),
        base44.functions.invoke('getAllUsers', {}),
        base44.entities.Employee.list('-created_date', 500),
        base44.entities.Employee.filter({ user_id: me.id }),
      ]);

      const users = usersResp.data?.users || [];
      const myDept = (myEmpRec?.[0]?.department || '').trim().toLowerCase();

      // Determine if this user is a dept clearance approver (IT, Finance/Accounts, Admin)
      const clearanceDeptKeywords = ['it', 'information technology', 'finance', 'accounts', 'account', 'admin', 'administration'];
      const isDeptClearanceUser = clearanceDeptKeywords.some(kw => myDept.includes(kw));

      let filtered = allExits;
      if (!isHR) {
        if (role === 'management') {
          // Managers see their reportees' exits AND clearance-stage exits
          const reporteeIds = allEmps.filter(e => e.reporting_manager_id === me.id).map(e => e.user_id);
          filtered = allExits.filter(e =>
            reporteeIds.includes(e.user_id) ||
            ['clearance_pending', 'clearance_done'].includes(e.status)
          );
        } else if (isDeptClearanceUser) {
          // IT, Finance, Admin dept users see exits in clearance stage
          filtered = allExits.filter(e => ['clearance_pending', 'clearance_done'].includes(e.status));
        } else {
          filtered = [];
        }
      }

      const rawMyDept = myEmpRec?.[0]?.department || '';
      const enrichedData = filtered.map(ex => ({
        ...ex,
        employee: allEmps.find(e => e.user_id === ex.user_id),
        user: users.find(u => u.id === ex.user_id),
        myDept: rawMyDept,
      }));

      setExits(allExits);
      setEnriched(enrichedData);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const filteredExits = enriched.filter(ex => {
    const matchSearch = !search ||
      ex.user?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      ex.employee?.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
      ex.employee?.department?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || ex.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: enriched.length,
    pending_approval: enriched.filter(e => ['submitted', 'manager_approved'].includes(e.status)).length,
    in_notice: enriched.filter(e => e.status === 'in_notice').length,
    clearance_pending: enriched.filter(e => ['clearance_pending', 'clearance_done', 'fnf_pending'].includes(e.status)).length,
    completed_this_month: enriched.filter(e => {
      if (e.status !== 'completed') return false;
      const d = new Date(e.last_working_date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-red-50">
      <UnderDevelopmentBanner pageName="Exit Management" />
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><TrendingDown className="w-8 h-8 text-red-600" /> Exit Management</h1>
          <p className="text-gray-600 mt-1">Manage employee exits, approvals, clearances & F&F settlements</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Exits', value: stats.total, color: 'text-gray-700', bg: 'bg-gray-100', icon: Users, filterVal: 'all' },
            { label: 'Pending Approval', value: stats.pending_approval, color: 'text-blue-700', bg: 'bg-blue-100', icon: Clock, filterVal: 'submitted' },
            { label: 'In Notice Period', value: stats.in_notice, color: 'text-orange-700', bg: 'bg-orange-100', icon: AlertCircle, filterVal: 'in_notice' },
            { label: 'Clearance/F&F', value: stats.clearance_pending, color: 'text-purple-700', bg: 'bg-purple-100', icon: CheckCircle2, filterVal: 'clearance_pending' },
            { label: 'Completed This Month', value: stats.completed_this_month, color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle2, filterVal: 'completed' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter(s.filterVal)}>
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

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          {[{ id: 'list', label: 'Exit Cases', icon: Users }, { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 }].map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'list' && (
          <>
            {enriched.length > 0 && (() => {
              const role2 = currentUser ? (currentUser.custom_role || currentUser.role) : '';
              const isHR2 = role2 === 'hr' || role2 === 'admin';
              if (!isHR2 && role2 !== 'management') {
                return (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    Showing exits pending your department's clearance. Click <strong className="mx-1">Manage</strong> to review and clear your section.
                  </div>
                );
              }
              return null;
            })()}
            <Card>
              <CardContent className="p-4 flex gap-3 flex-wrap">
                <div className="flex-1 min-w-48 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input placeholder="Search by name, code, department..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Filter by status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {filteredExits.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Users className="w-12 h-12 mx-auto mb-3" />
                    <p>No exit cases found</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredExits.map(ex => (
                      <div key={ex.id} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-red-600 font-semibold">{ex.user?.full_name?.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{ex.user?.full_name}</p>
                          <p className="text-sm text-gray-500">{ex.employee?.designation} · {ex.employee?.department} · {ex.employee?.employee_code}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                            <span>Resigned: {ex.resignation_date ? format(new Date(ex.resignation_date), 'MMM d, yyyy') : '—'}</span>
                            <span>LWD: {ex.last_working_date ? format(new Date(ex.last_working_date), 'MMM d, yyyy') : '—'}</span>
                            <span className="capitalize">{ex.reason_category?.replace(/_/g, ' ')}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className={STATUS_CONFIG[ex.status]?.color || 'bg-gray-100 text-gray-600'}>
                            {STATUS_CONFIG[ex.status]?.label || ex.status}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => setSelected(ex)}>
                            <Eye className="w-3 h-3 mr-1" /> Manage
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === 'reports' && <ExitReportsPanel exits={enriched} />}
      </div>

      {selected && (
        <ExitDetailPanel
          exitRecord={selected}
          currentUser={currentUser ? { ...currentUser, department: enriched.find(e => e.id === selected.id)?.myDept || '' } : currentUser}
          onClose={() => setSelected(null)}
          onRefresh={() => { setSelected(null); loadData(); }}
        />
      )}
    </div>
  );
}