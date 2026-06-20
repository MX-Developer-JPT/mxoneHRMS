import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Check, X, Clock, Filter, Plus, CheckCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import LeavePolicyManager from '../components/leave/LeavePolicyManager';
import LeaveAllocationPanel from '../components/leave/LeaveAllocationPanel';
import HRApplyOnBehalf from '../components/leave/HRApplyOnBehalf';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800'
};

const POLICY_COLORS = {
  CL: 'bg-blue-100 text-blue-700',
  EL: 'bg-green-100 text-green-700',
  SL: 'bg-purple-100 text-purple-700'
};

export default function LeaveManagement() {
  const [user, setUser] = useState(null);
  const [userEmployee, setUserEmployee] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [leavePolicies, setLeavePolicies] = useState([]);
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [actionType, setActionType] = useState(null); // 'approve' | 'reject'
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [filterPolicy, setFilterPolicy] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const [empRecords, policies] = await Promise.all([
        base44.entities.Employee.list(),
        base44.entities.LeavePolicy.list()
      ]);

      const empUserRec = empRecords.find(e => e.user_id === currentUser.id);
      setUserEmployee(empUserRec);

      // Use display_name directly from Employee — no User.list() needed
      setEmployees(empRecords);

      let requests = await base44.entities.Leave.list('-created_date', 500);

      const isHR = ['hr', 'admin'].includes(currentUser.role) || ['hr', 'admin'].includes(currentUser.custom_role);
      const isManager = ['manager', 'management'].includes(currentUser.role) || ['manager', 'management'].includes(currentUser.custom_role);

      if (isManager && !isHR) {
        // Manager sees only leaves from their direct reports
        const subordinates = empRecords.filter(e => e.reporting_manager_id === currentUser.id);
        const subUserIds = new Set(subordinates.map(e => e.user_id));
        requests = requests.filter(r => subUserIds.has(r.user_id));
      }

      setLeaveRequests(requests);
      setLeavePolicies(policies);
    } catch (error) {
      console.error('Error loading:', error);
    } finally {
      setLoading(false);
    }
  };

  const isHR = user && (['hr', 'admin'].includes(user.role) || ['hr', 'admin'].includes(user.custom_role));
  const isAdmin = user && (user.role === 'admin' || user.custom_role === 'admin');
  const isManagement = user && (['management', 'manager'].includes(user.role) || ['management', 'manager'].includes(user.custom_role));

  const canApproveLevel = (leave) => {
    if (!leave || leave.status !== 'pending') return false;
    // Admin can approve/reject any pending leave at any level
    if (isAdmin) return true;
    // Level 1: Reporting Manager approves first
    if (leave.current_approval_level === 1) {
      const leaveEmp = employees.find(e => e.user_id === leave.user_id);
      return leaveEmp?.reporting_manager_id === user?.id || isHR;
    }
    // Level 2: HR/HOD approves
    if (leave.current_approval_level === 2) {
      return isHR;
    }
    return false;
  };

  const handleAction = async () => {
    if (actionType === 'reject' && !comment.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    try {
      const leave = selectedLeave;
      const history = leave.approval_history || [];
      const newHistoryEntry = {
        level: leave.current_approval_level,
        approver_id: user.id,
        approver_name: user.full_name,
        status: actionType === 'approve' ? 'approved' : 'rejected',
        comments: comment,
        timestamp: new Date().toISOString()
      };

      if (actionType === 'approve') {
        if (leave.current_approval_level === 1 && !isAdmin) {
          // Move to level 2 (HR/HOD approval) — non-admin managers only
          await base44.entities.Leave.update(leave.id, {
            current_approval_level: 2,
            approval_history: [...history, newHistoryEntry]
          });
          toast.success('Level 1 approved. Sent to HR/HOD for final approval.');
        } else {
          // Final approval
          await base44.entities.Leave.update(leave.id, {
            status: 'approved',
            approved_by: user.id,
            approved_date: new Date().toISOString(),
            approval_history: [...history, newHistoryEntry]
          });

          // Update leave balance: move from pending to used, NO salary deduction
          const currentYear = new Date().getFullYear();
          const balRecs = await base44.entities.LeaveBalance.filter({
            user_id: leave.user_id, leave_policy_id: leave.leave_policy_id, year: currentYear
          });
          if (balRecs.length > 0) {
            const lb = balRecs[0];
            await base44.entities.LeaveBalance.update(lb.id, {
              used: (lb.used || 0) + leave.total_days,
              pending_approval: Math.max((lb.pending_approval || 0) - leave.total_days, 0),
              available: lb.available // available stays same — was already decremented at application time
            });
          }

          // Auto-mark attendance as 'present' with leave_applied flag (no LOP deduction)
          const start = new Date(leave.start_date);
          const end = new Date(leave.end_date);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const existing = await base44.entities.Attendance.filter({ user_id: leave.user_id, date: dateStr });
            if (existing.length === 0) {
              await base44.entities.Attendance.create({
                user_id: leave.user_id, date: dateStr,
                status: 'present', // present so no LOP
                lop_applicable: false,
                lop_deduction_days: 0,
                auto_marked: true,
                notes: `Approved leave (${leave.leave_policy_id})`
              });
            } else {
              await base44.entities.Attendance.update(existing[0].id, {
                status: 'present',
                lop_applicable: false,
                lop_deduction_days: 0,
                auto_marked: true,
                notes: `Approved leave (${leave.leave_policy_id})`
              });
            }
          }
          toast.success('Leave fully approved. Days marked as present with leave.');
        }
      } else {
        // Reject
        await base44.entities.Leave.update(leave.id, {
          status: 'rejected',
          rejection_reason: comment,
          approved_by: user.id,
          approved_date: new Date().toISOString(),
          approval_history: [...history, newHistoryEntry]
        });

        // Restore balance (pending → available)
        const currentYear = new Date().getFullYear();
        const balRecs = await base44.entities.LeaveBalance.filter({
          user_id: leave.user_id, leave_policy_id: leave.leave_policy_id, year: currentYear
        });
        if (balRecs.length > 0) {
          const lb = balRecs[0];
          await base44.entities.LeaveBalance.update(lb.id, {
            pending_approval: Math.max((lb.pending_approval || 0) - leave.total_days, 0),
            available: (lb.available || 0) + leave.total_days
          });
        }
        toast.success('Leave rejected and balance restored.');
      }

      setSelectedLeave(null);
      setActionType(null);
      setComment('');
      loadData();
    } catch (error) {
      toast.error('Action failed: ' + error.message);
    }
  };

  const handleBulkAction = async (action) => {
    if (selectedIds.size === 0) return;
    setBulkProcessing(true);
    try {
      const fn = action === 'approve' ? 'bulkApproveLeave' : 'bulkRejectLeave';
      const payload = action === 'approve'
        ? { leave_ids: [...selectedIds], approved_by: user?.id, comment: 'Bulk approved by HR' }
        : { leave_ids: [...selectedIds], rejected_by: user?.id, reason: 'Bulk rejected by HR' };
      const res = await base44.functions.invoke(fn, payload);
      const r = res.data;
      toast.success(`${action === 'approve' ? 'Approved' : 'Rejected'} ${r.approved || r.rejected} leave request(s).`);
      setSelectedIds(new Set());
      loadData();
    } catch (e) { toast.error('Bulk action failed: ' + e.message); }
    setBulkProcessing(false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const filteredRequests = leaveRequests.filter(l => {
    const statusMatch = filterStatus === 'all' || l.status === filterStatus;
    const policyMatch = filterPolicy === 'all' || (leavePolicies.find(p => p.id === l.leave_policy_id)?.code === filterPolicy);
    return statusMatch && policyMatch;
  });

  const pendingL1 = leaveRequests.filter(l => l.status === 'pending' && l.current_approval_level === 1).length;
  const pendingL2 = leaveRequests.filter(l => l.status === 'pending' && l.current_approval_level === 2).length;
  const approvedCount = leaveRequests.filter(l => l.status === 'approved').length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
          <p className="text-gray-500 text-sm mt-1">Review and approve employee leave requests</p>
        </div>

        <Tabs defaultValue="requests" className="space-y-6">
          <TabsList>
            <TabsTrigger value="requests">Leave Requests</TabsTrigger>
            <TabsTrigger value="allocate">Allocate Leaves</TabsTrigger>
            <TabsTrigger value="policies">Leave Policies</TabsTrigger>
            {isHR && <TabsTrigger value="onBehalf">Apply on Behalf</TabsTrigger>}
          </TabsList>

          <TabsContent value="policies">
            <LeavePolicyManager onUpdate={loadData} />
          </TabsContent>

          {isHR && (
            <TabsContent value="onBehalf">
              <HRApplyOnBehalf employees={employees} leavePolicies={leavePolicies} loadData={loadData} user={user} />
            </TabsContent>
          )}

          <TabsContent value="allocate">
            <LeaveAllocationPanel employees={employees} leavePolicies={leavePolicies} />
          </TabsContent>

          <TabsContent value="requests" className="space-y-6">

            {/* Stats */}
            <div className="grid md:grid-cols-4 gap-4">
              {[
                { label: 'Pending (Manager)', value: pendingL1, color: 'text-yellow-600', filterVal: 'pending' },
                { label: 'Pending (HR/HOD)', value: pendingL2, color: 'text-orange-600', filterVal: 'pending' },
                { label: 'Approved', value: approvedCount, color: 'text-green-600', filterVal: 'approved' },
                { label: 'Total', value: leaveRequests.length, color: 'text-blue-600', filterVal: 'all' }
              ].map((s, i) => (
                <Card key={i} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterStatus(s.filterVal)}>
                  <CardContent className="p-5 text-center">
                    <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                    <p className="text-xs text-gray-400">Click to filter</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Bulk Actions */}
            {isHR && selectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
                <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={bulkProcessing} onClick={() => handleBulkAction('approve')}>
                  <CheckCheck className="w-4 h-4 mr-1" /> Bulk Approve
                </Button>
                <Button size="sm" variant="destructive" disabled={bulkProcessing} onClick={() => handleBulkAction('reject')}>
                  <XCircle className="w-4 h-4 mr-1" /> Bulk Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
              </div>
            )}

            {/* Filters */}
            <div className="flex gap-3 items-center flex-wrap">
              <Filter className="w-4 h-4 text-gray-500" />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterPolicy} onValueChange={setFilterPolicy}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Leave Types</SelectItem>
                  {leavePolicies.map(p => <SelectItem key={p.id} value={p.code}>{p.code} – {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Leave Requests */}
            <Card>
              <CardHeader>
                <CardTitle>Leave Requests ({filteredRequests.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isHR && filteredRequests.some(l => l.status === 'pending') && (
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <input type="checkbox" className="w-4 h-4"
                        checked={filteredRequests.filter(l=>l.status==='pending').every(l=>selectedIds.has(l.id))}
                        onChange={e => {
                          const pending = filteredRequests.filter(l=>l.status==='pending').map(l=>l.id);
                          setSelectedIds(e.target.checked ? new Set(pending) : new Set());
                        }} />
                      <span className="text-xs text-gray-500">Select all pending</span>
                    </div>
                  )}

                  {filteredRequests.map(leave => {
                    const emp = employees.find(e => e.user_id === leave.user_id);
                    const policy = leavePolicies.find(p => p.id === leave.leave_policy_id);
                    const canAct = canApproveLevel(leave);

                    return (
                      <div key={leave.id} className={`border rounded-lg p-4 ${selectedIds.has(leave.id) ? 'border-blue-400 bg-blue-50' : canAct ? 'border-blue-200 bg-blue-50/30' : ''}`}>
                        <div className="flex flex-wrap justify-between items-start gap-4">
                          {isHR && leave.status === 'pending' && (
                            <input type="checkbox" className="w-4 h-4 mt-1 flex-shrink-0"
                              checked={selectedIds.has(leave.id)}
                              onChange={e => { const s = new Set(selectedIds); e.target.checked ? s.add(leave.id) : s.delete(leave.id); setSelectedIds(s); }} />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                                 {emp?.display_name?.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold">{emp?.display_name}</p>
                                <p className="text-xs text-gray-500">{emp?.designation} · {emp?.department}</p>
                              </div>
                            </div>

                            <div className="ml-12 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${POLICY_COLORS[policy?.code] || 'bg-gray-100'}`}>{policy?.code}</span>
                                <span className="font-medium text-sm">{policy?.name}</span>
                                <Badge className={STATUS_COLORS[leave.status]}>{leave.status.toUpperCase()}</Badge>
                                {leave.status === 'pending' && (
                                  <Badge className={leave.current_approval_level === 1 ? 'bg-yellow-100 text-yellow-800' : 'bg-orange-100 text-orange-800'}>
                                    <Clock className="w-3 h-3 mr-1 inline" />
                                    {leave.current_approval_level === 1 ? 'Awaiting Manager' : 'Awaiting HR/HOD'}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-gray-600">
                                {format(new Date(leave.start_date), 'MMM d')} – {format(new Date(leave.end_date), 'MMM d, yyyy')}
                                <span className="ml-2 font-medium">{leave.total_days} day(s)</span>
                                {leave.half_day && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 rounded">Half Day</span>}
                              </p>
                              <p className="text-sm text-gray-600">{leave.reason}</p>

                              {/* Approval History */}
                              {leave.approval_history?.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {leave.approval_history.map((h, i) => (
                                    <p key={i} className="text-xs text-gray-500">
                                      ✓ {h.approver_name} ({h.level === 1 ? 'Manager' : 'HOD/HR'}) — {h.status}
                                      {h.comments && ` — "${h.comments}"`}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {leave.rejection_reason && (
                                <div className="p-2 bg-red-50 rounded text-sm text-red-700">
                                  <strong>Rejected:</strong> {leave.rejection_reason}
                                </div>
                              )}
                            </div>
                          </div>

                          {canAct && (
                            <div className="flex gap-2">
                              <Button size="sm" className="bg-green-600 hover:bg-green-700"
                                onClick={() => { setSelectedLeave(leave); setActionType('approve'); }}>
                                <Check className="w-4 h-4 mr-1" />
                                {leave.current_approval_level === 1 ? 'Approve (L1)' : 'Final Approve'}
                              </Button>
                              <Button size="sm" variant="destructive"
                                onClick={() => { setSelectedLeave(leave); setActionType('reject'); }}>
                                <X className="w-4 h-4 mr-1" /> Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {filteredRequests.length === 0 && (
                    <p className="text-center text-gray-500 py-8">No leave requests found</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Action Dialog */}
      <Dialog open={!!selectedLeave} onOpenChange={() => { setSelectedLeave(null); setActionType(null); setComment(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionType === 'approve' ? '✓ Approve Leave Request' : '✗ Reject Leave Request'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedLeave && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p><strong>Employee:</strong> {employees.find(e => e.user_id === selectedLeave.user_id)?.display_name}</p>
                <p><strong>Leave Type:</strong> {leavePolicies.find(p => p.id === selectedLeave.leave_policy_id)?.name}</p>
                <p><strong>Duration:</strong> {selectedLeave.total_days} day(s) — {format(new Date(selectedLeave.start_date), 'MMM d')} to {format(new Date(selectedLeave.end_date), 'MMM d, yyyy')}</p>
                {actionType === 'approve' && selectedLeave.current_approval_level === 1 && (
                  <p className="mt-2 text-blue-600 text-xs">This will move the request to Level 2 (HR/HOD) for final approval.</p>
                )}
              </div>
            )}
            <div>
              <label className="text-sm font-medium">{actionType === 'reject' ? 'Rejection Reason *' : 'Comments (Optional)'}</label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder={actionType === 'reject' ? 'Enter reason for rejection...' : 'Optional comments...'}
                rows={3} className="mt-1" />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { setSelectedLeave(null); setActionType(null); setComment(''); }}>
                Cancel
              </Button>
              <Button
                className={actionType === 'approve' ? 'bg-green-600 hover:bg-green-700' : ''}
                variant={actionType === 'reject' ? 'destructive' : 'default'}
                onClick={handleAction}>
                {actionType === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}