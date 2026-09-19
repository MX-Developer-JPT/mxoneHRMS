import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { safeDate, nowIST } from '@/lib/dateUtils';
import { Search, LogOut, LogIn, User, Clock, History, CheckCircle2, XCircle, FileClock } from 'lucide-react';
import GatePassHistory from '@/components/gatepass/GatePassHistory';
import { toast } from 'sonner';

const STATUS_COLORS = {
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  departed: 'bg-orange-100 text-orange-800',
  returned: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const STATUS_LABELS = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  departed: 'Departed',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export default function GatePassManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  const [passes, setPasses] = useState([]);
  const [users, setUsers] = useState({});
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('live');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [me, allPasses, allUsers, allEmployees] = await Promise.all([
      base44.auth.me(),
      base44.entities.GatePass.list('-created_date', 500),
      base44.entities.User.list(),
      base44.entities.Employee.list(),
    ]);
    setCurrentUser(me);
    const userMap = {};
    allUsers.forEach(u => { userMap[u.id] = u; });
    const empMap = {};
    allEmployees.forEach(e => { empMap[e.user_id] = e; });
    setUsers(userMap);
    setEmployees(empMap);
    setPasses(allPasses);
    setLoading(false);
  };

  // This page lives only in the HR/admin menu (Layout.jsx hrMenuGroups) —
  // reporting managers and 'management' approve gate passes on the separate
  // GatePassApproval page (scoped to their own downstream hierarchy there).
  // So here, HR/admin can approve/reject any employee's pending pass —
  // GatePass approval never requires the reporting manager to act first
  // (see checkApprovalAuthorization in entities.js), so HR can cover for an
  // unavailable manager.
  const isHR = !!currentUser && ['hr', 'admin'].includes(currentUser.custom_role || currentUser.role);

  const handleAction = async (action) => {
    setActionLoading(true);
    const now = nowIST();
    const isApproved = action === 'approved';
    try {
      await base44.entities.GatePass.update(selected.id, {
        manager_approval_status: action,
        manager_user_id: currentUser.id,
        manager_approval_date: now,
        manager_comment: comment,
        status: isApproved ? 'approved' : 'rejected',
      });
      setSelected(null);
      setComment('');
      await loadData();
    } catch (err) {
      toast.error(err.message || `Failed to ${isApproved ? 'approve' : 'reject'} this request`);
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = passes.filter(p => {
    const u = users[p.employee_user_id];
    const emp = employees[p.employee_user_id];
    const name = (emp?.display_name || u?.full_name || '').toLowerCase();
    const matchesSearch = !search || name.includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || p.status === filter;
    const passDate = p.created_date ? new Date(p.created_date) : null;
    const matchesFrom = !dateFrom || (passDate && passDate >= new Date(dateFrom));
    const matchesTo = !dateTo || (passDate && passDate <= new Date(dateTo + 'T23:59:59'));
    return matchesSearch && matchesFilter && matchesFrom && matchesTo;
  });

  const stats = {
    total: passes.length,
    pending: passes.filter(p => p.status === 'pending_approval').length,
    out: passes.filter(p => p.status === 'departed').length,
    returned: passes.filter(p => p.status === 'returned').length,
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Gate Pass Management</h1>
      <p className="text-gray-500 text-sm mb-5">Track all employee gate passes</p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Passes', value: stats.total, color: 'text-gray-700' },
          { label: 'Pending Approval', value: stats.pending, color: 'text-yellow-700' },
          { label: 'Currently Out', value: stats.out, color: 'text-orange-700' },
          { label: 'Returned', value: stats.returned, color: 'text-green-700' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b pb-2">
        <button
          onClick={() => setActiveTab('live')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'live' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Live View
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <History className="w-4 h-4" /> Full History
        </button>
      </div>

      {activeTab === 'live' && (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="Search by employee name..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2 items-center">
                <Input type="date" className="w-36 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From" />
                <span className="text-gray-400 text-sm">–</span>
                <Input type="date" className="w-36 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To" />
                {(dateFrom || dateTo) && (
                  <Button size="sm" variant="ghost" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</Button>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['all', 'pending_approval', 'approved', 'departed', 'returned', 'rejected'].map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : STATUS_LABELS[f]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-400">No gate passes found.</div>
            )}
            {filtered.map(pass => {
              const u = users[pass.employee_user_id];
              const emp = employees[pass.employee_user_id];
              const displayName = emp?.display_name || u?.full_name || 'Unknown';
              return (
                <Card key={pass.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelected(pass)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700 text-sm">
                          {displayName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{displayName}</p>
                          <p className="text-xs text-gray-400">{emp?.designation} · {emp?.department}</p>
                        </div>
                      </div>
                      <div className="flex-1 px-4 hidden md:block">
                        <p className="text-sm text-gray-700 truncate max-w-xs">{pass.reason}</p>
                        <p className="text-xs text-gray-400">{safeDate(pass.created_date, 'dd MMM yyyy, hh:mm a')}</p>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap">
                        {pass.departure_time && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <LogOut className="w-3 h-3" /> {safeDate(pass.departure_time, 'hh:mm a')}
                          </span>
                        )}
                        {pass.return_time && (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <LogIn className="w-3 h-3" /> {safeDate(pass.return_time, 'hh:mm a')}
                          </span>
                        )}
                        {pass.departure_time && pass.return_time && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {Math.round((new Date(pass.return_time) - new Date(pass.departure_time)) / 60000)}m
                          </span>
                        )}
                        <Badge className={STATUS_COLORS[pass.status]}>{STATUS_LABELS[pass.status]}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'history' && (
        <GatePassHistory showEmployeeName={true} />
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => { setSelected(null); setComment(''); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gate Pass Details</DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const approver = employees[selected.manager_user_id]?.display_name || users[selected.manager_user_id]?.full_name;
            // One row per lifecycle step, in order, each with its own
            // timestamp — only steps that have actually happened are shown.
            const steps = [
              { label: 'Requested', time: selected.created_date, icon: FileClock, color: 'text-gray-600' },
              selected.manager_approval_date && {
                label: selected.manager_approval_status === 'rejected' ? 'Rejected' : 'Approved',
                time: selected.manager_approval_date,
                by: approver,
                note: selected.manager_comment,
                icon: selected.manager_approval_status === 'rejected' ? XCircle : CheckCircle2,
                color: selected.manager_approval_status === 'rejected' ? 'text-red-600' : 'text-blue-600',
              },
              selected.departure_time && { label: 'Departed', time: selected.departure_time, icon: LogOut, color: 'text-orange-600' },
              selected.return_time && { label: 'Returned', time: selected.return_time, icon: LogIn, color: 'text-green-600' },
            ].filter(Boolean);

            return (
              <div className="space-y-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <p><span className="font-medium">Employee:</span> {employees[selected.employee_user_id]?.display_name || users[selected.employee_user_id]?.full_name}</p>
                  <p><span className="font-medium">Department:</span> {employees[selected.employee_user_id]?.department}</p>
                  <p><span className="font-medium">Designation:</span> {employees[selected.employee_user_id]?.designation}</p>
                  <p><span className="font-medium">Reason:</span> {selected.reason}</p>
                  {selected.expected_return_time && (
                    <p><span className="font-medium">Expected Return:</span> {safeDate(selected.expected_return_time, 'dd MMM yyyy, hh:mm a')}</p>
                  )}
                  <p><span className="font-medium">Status:</span> <Badge className={STATUS_COLORS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge></p>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <p className="font-semibold text-gray-700">Timeline</p>
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <step.icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${step.color}`} />
                      <div>
                        <p className={`font-medium ${step.color}`}>
                          {step.label}
                          {step.by && <span className="font-normal text-gray-500"> by {step.by}</span>}
                        </p>
                        <p className="text-xs text-gray-500">{safeDate(step.time, 'dd MMM yyyy, hh:mm a')}</p>
                        {step.note && <p className="text-xs italic text-gray-500 mt-0.5">"{step.note}"</p>}
                      </div>
                    </div>
                  ))}
                  {selected.departure_time && selected.return_time && (
                    <p className="text-xs text-gray-500 flex items-center gap-1 pl-6">
                      <Clock className="w-3.5 h-3.5" />
                      Duration: {Math.round((new Date(selected.return_time) - new Date(selected.departure_time)) / 60000)} minutes
                    </p>
                  )}
                  {selected.gate_admin_notes && (
                    <p className="text-xs text-gray-500 pl-6"><span className="font-medium">Gate Notes:</span> {selected.gate_admin_notes}</p>
                  )}
                </div>

                {isHR && selected.status === 'pending_approval' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Comment (optional)</label>
                      <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment..." rows={2} />
                    </div>
                    <div className="flex gap-3">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => handleAction('approved')}
                        disabled={actionLoading}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                      </Button>
                      <Button
                        className="flex-1"
                        variant="destructive"
                        onClick={() => handleAction('rejected')}
                        disabled={actionLoading}
                      >
                        <XCircle className="w-4 h-4 mr-2" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}