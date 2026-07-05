import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, DollarSign, Check, X, Download, LogOut, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { safeDate, safeTime } from '@/lib/dateUtils';

export default function Approvals() {
  const [user, setUser] = useState(null);
  const [isHR, setIsHR] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [reimbursementHistory, setReimbursementHistory] = useState([]);
  const [showReimbHistory, setShowReimbHistory] = useState(false);
  const [gatePasses, setGatePasses] = useState([]);
  const [regularisations, setRegularisations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [processing, setProcessing] = useState({});
  const [workflows, setWorkflows] = useState({});

  useEffect(() => { loadData(); }, []);

  // Does the current user match a workflow step for the given employee record?
  const matchesStep = (step, empRecord, currentUser, hrRole) => {
    if (!step) return false;
    if (step.approver_type === 'reporting_manager')
      return (empRecord?.reporting_manager_email || '').toLowerCase() === (currentUser?.email || '').toLowerCase() || empRecord?.reporting_manager_id === currentUser?.id;
    if (step.approver_type === 'hr') return hrRole;
    if (step.approver_type === 'admin') return (currentUser?.custom_role || currentUser?.role) === 'admin';
    if (step.approver_type === 'specific_user') return step.specific_user_id === currentUser?.id;
    return false;
  };

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const userRole = currentUser.custom_role || currentUser.role;
      const hrRole = ['hr', 'admin', 'management'].includes(userRole);
      setIsHR(hrRole);

      const empRecords = await base44.entities.Employee.list();
      setEmployees(empRecords);

      // Configurable approval chains (Workflow Builder)
      let wfMap = {};
      try {
        const wfRes = await base44.functions.invoke('getApprovalWorkflows', {});
        const wfData = wfRes.data || wfRes;
        if (wfData.success) wfMap = Object.fromEntries((wfData.workflows || []).filter(w => w.is_active !== false).map(w => [w.module, w]));
      } catch { /* workflows unavailable — use built-in flows */ }
      setWorkflows(wfMap);

      // Employees store reporting_manager_email (not reporting_manager_id), so match by email
      const directReportUserIds = empRecords
        .filter(e => e.reporting_manager_email && e.reporting_manager_email.toLowerCase() === (currentUser.email || '').toLowerCase())
        .map(e => e.user_id);

      let leaves = await base44.entities.Leave.filter({ status: 'pending' }, '-created_date');
      if (!hrRole) leaves = leaves.filter(l => directReportUserIds.includes(l.user_id));

      let reimburse;
      let reimbHistory = [];
      if (hrRole) {
        // Management/HR see both pending (no manager yet) and manager_approved (awaiting final approval)
        const [pendingReimb, mgrApprovedReimb, approvedReimb, rejectedReimb] = await Promise.all([
          base44.entities.Reimbursement.filter({ status: 'pending' }, '-created_date'),
          base44.entities.Reimbursement.filter({ status: 'manager_approved' }, '-created_date'),
          base44.entities.Reimbursement.filter({ status: 'approved' }, '-created_date'),
          base44.entities.Reimbursement.filter({ status: 'rejected' }, '-created_date'),
        ]);
        reimburse = [...pendingReimb, ...mgrApprovedReimb];
        reimbHistory = [...approvedReimb, ...rejectedReimb].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      } else {
        // Filter all pending by user_id membership (manager_id field may not be set reliably)
        const allPendingReimb = await base44.entities.Reimbursement.filter({ status: 'pending' }, '-created_date');
        reimburse = allPendingReimb.filter(r => directReportUserIds.includes(r.user_id));
      }

      // Gate passes pending manager approval
      const allGatePasses = await base44.entities.GatePass.filter({ status: 'pending_approval' }, '-created_date');
      const pendingGatePasses = hrRole
        ? allGatePasses
        : allGatePasses.filter(gp => directReportUserIds.includes(gp.employee_user_id));

      // Regularisation requests
      const allRegs = await base44.entities.AttendanceRegularisation.list('-created_date', 300);
      const pendingRegs = hrRole
        ? allRegs.filter(r => r.status === 'pending' || r.status === 'manager_approved')
        : allRegs.filter(r => r.status === 'pending' && directReportUserIds.includes(r.user_id));

      setLeaveRequests(leaves);
      setReimbursements(reimburse);
      setReimbursementHistory(reimbHistory);
      setGatePasses(pendingGatePasses);
      setRegularisations(pendingRegs);
      setLoading(false);
    } catch (error) {
      console.error('Error loading approvals:', error);
      setLoading(false);
    }
  };

  const handleLeaveApproval = async (leaveId, status) => {
    try {
      await base44.entities.Leave.update(leaveId, {
        status,
        approved_by: user.id,
        approved_date: new Date().toISOString()
      });
      toast.success(`Leave ${status}`);
      loadData();
    } catch (error) {
      toast.error('Failed to update leave');
    }
  };

  const handleReimbursementApproval = async (reimbId, action) => {
    try {
      const wf = workflows.expense;
      const reimb = reimbursements.find(r => r.id === reimbId);
      if (wf?.steps?.length && reimb) {
        // ── Configurable chain from Workflow Builder ──
        const lvl = reimb.wf_level || 0;
        const step = wf.steps[lvl];
        const empRecord = employees.find(e => e.user_id === reimb.user_id);
        const isAdminUser = (user.custom_role || user.role) === 'admin';
        if (!isAdminUser && !matchesStep(step, empRecord, user, isHR)) {
          toast.error(`This claim is at level ${lvl + 1} of ${wf.steps.length} — the assigned approver for this step must act on it`);
          return;
        }
        const history = [...(reimb.wf_history || []), { level: lvl + 1, approver_id: user.id, action, at: new Date().toISOString() }];
        if (action === 'reject') {
          await base44.entities.Reimbursement.update(reimbId, { status: 'rejected', wf_history: history, hr_approved_by: user.id, approved_date: new Date().toISOString() });
          toast.success('Reimbursement rejected');
        } else if (lvl < wf.steps.length - 1) {
          await base44.entities.Reimbursement.update(reimbId, { wf_level: lvl + 1, wf_history: history });
          toast.success(`Approved at level ${lvl + 1} — moved to level ${lvl + 2} of ${wf.steps.length}`);
        } else {
          await base44.entities.Reimbursement.update(reimbId, { status: 'approved', wf_level: lvl, wf_history: history, hr_approved_by: user.id, approved_date: new Date().toISOString() });
          toast.success('Reimbursement fully approved');
        }
      } else if (isHR) {
        // Built-in flow: HR final approval/rejection
        await base44.entities.Reimbursement.update(reimbId, {
          status: action === 'approve' ? 'approved' : 'rejected',
          hr_approved_by: user.id,
          approved_date: new Date().toISOString()
        });
        toast.success(`Reimbursement ${action === 'approve' ? 'approved' : 'rejected'} by HR`);
      } else {
        // Built-in flow: manager approval — move to HR queue
        await base44.entities.Reimbursement.update(reimbId, {
          status: action === 'approve' ? 'manager_approved' : 'rejected',
          manager_approved_by: user.id,
          manager_approved_date: new Date().toISOString()
        });
        toast.success(action === 'approve' ? 'Approved & sent to HR for final approval' : 'Reimbursement rejected');
      }
      loadData();
    } catch (error) {
      toast.error('Failed to update reimbursement');
    }
  };

  const handleGatePassAction = async (gatePassId, action) => {
    setProcessing(p => ({ ...p, [gatePassId]: true }));
    try {
      await base44.entities.GatePass.update(gatePassId, {
        status: action === 'approve' ? 'approved' : 'rejected',
        manager_action_at: new Date().toISOString(),
        manager_id: user.id,
      });
      toast.success(`Gate pass ${action === 'approve' ? 'approved' : 'rejected'}`);
      loadData();
    } catch {
      toast.error('Failed to update gate pass');
    }
    setProcessing(p => ({ ...p, [gatePassId]: false }));
  };

  const handleRegAction = async (regId, action) => {
    setProcessing(p => ({ ...p, [regId]: true }));
    try {
      const role = isHR ? 'management' : 'manager';
      const res = await base44.functions.invoke('processRegularisation', { regularisation_id: regId, action, role });
      if (res.data?.success) {
        toast.success(`Regularisation ${action}d`);
        loadData();
      } else {
        toast.error(res.data?.error || 'Action failed');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setProcessing(p => ({ ...p, [regId]: false }));
  };

  const downloadExcel = () => {
    // Build CSV with all reimbursement details
    const headers = ['Employee Name', 'Employee Code', 'Department', 'Designation', 'Expense Type', 'Expense Date', 'Amount (₹)', 'Description', 'Status', 'Applied On'];
    const rows = reimbursements.map(r => {
      const emp = employees.find(e => e.user_id === r.user_id);
      return [
        emp?.display_name || '',
        emp?.employee_code || '',
        emp?.department || '',
        emp?.designation || '',
        r.expense_type?.replace(/_/g, ' ') || '',
        r.expense_date ? safeDate(r.expense_date, 'dd/MM/yyyy') : '',
        r.amount || 0,
        (r.description || '').replace(/,/g, ';'),
        r.status || '',
        r.created_date ? safeDate(r.created_date, 'dd/MM/yyyy') : ''
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reimbursements_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Excel file downloaded');
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const totalPending = leaveRequests.length + reimbursements.length + gatePasses.length + regularisations.length;

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    manager_approved: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    paid: 'bg-purple-100 text-purple-800'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pending Approvals</h1>
          <p className="text-muted-foreground mt-1">
            {isHR ? 'HR view — final approval for reimbursements' : 'Review and approve requests from your team'}
          </p>
        </div>

        <Card className="bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-4xl font-bold text-orange-600">{totalPending}</p>
                <p className="text-muted-foreground mt-1">Total Pending Approvals</p>
              </div>
              <div className="text-right text-sm text-muted-foreground space-y-0.5">
                <p>{leaveRequests.length} Leave Requests</p>
                <p>{reimbursements.length} Reimbursements</p>
                <p>{gatePasses.length} Gate Passes</p>
                <p>{regularisations.length} Regularisations {isHR ? '(awaiting HR)' : ''}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="leaves" className="space-y-6">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="leaves" className="flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              Leave {leaveRequests.length > 0 && <Badge className="bg-yellow-500 text-white h-4 min-w-4 px-1 text-xs">{leaveRequests.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="gate_passes" className="flex items-center gap-1.5">
              <LogOut className="w-4 h-4" />
              Gate Pass {gatePasses.length > 0 && <Badge className="bg-orange-500 text-white h-4 min-w-4 px-1 text-xs">{gatePasses.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="regularisations" className="flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" />
              Regularisation {regularisations.length > 0 && <Badge className="bg-blue-500 text-white h-4 min-w-4 px-1 text-xs">{regularisations.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="reimbursements" className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              Expense {reimbursements.length > 0 && <Badge className="bg-green-500 text-white h-4 min-w-4 px-1 text-xs">{reimbursements.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Gate Passes ──────────────────────────────────── */}
          <TabsContent value="gate_passes">
            <Card>
              <CardHeader>
                <CardTitle>Gate Passes Pending Approval</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {gatePasses.length > 0 ? gatePasses.map(gp => {
                    const emp = employees.find(e => e.user_id === gp.employee_user_id);
                    const outingLabels = { official_outing: 'Official Outing', unofficial_outing: 'Unofficial Outing', half_day: 'Half Day', short_break: 'Short Break', early_leave: 'Early Leave' };
                    return (
                      <div key={gp.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start gap-4 flex-wrap">
                          <div>
                            <p className="font-semibold">{emp?.display_name || '—'}</p>
                            <p className="text-sm text-muted-foreground">{emp?.designation} · {emp?.department}</p>
                            <p className="text-sm mt-2">
                              <span className="font-medium">{outingLabels[gp.outing_type] || gp.outing_type}</span>
                              {gp.expected_return_time && <> · Back by {safeTime(gp.expected_return_time)}</>}
                            </p>
                            {gp.reason && <p className="text-sm text-muted-foreground mt-1">{gp.reason}</p>}
                            <p className="text-xs text-muted-foreground mt-1">{gp.created_date ? safeDate(gp.created_date, 'dd MMM yyyy h:mm a') : ''}</p>
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => handleGatePassAction(gp.id, 'approve')} size="sm" className="bg-green-600 hover:bg-green-700" disabled={processing[gp.id]}>
                              <Check className="w-4 h-4 mr-1" /> Approve
                            </Button>
                            <Button onClick={() => handleGatePassAction(gp.id, 'reject')} size="sm" variant="destructive" disabled={processing[gp.id]}>
                              <X className="w-4 h-4 mr-1" /> Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-center text-muted-foreground py-8">No pending gate pass requests</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Regularisations ─────────────────────────────── */}
          <TabsContent value="regularisations">
            <Card>
              <CardHeader>
                <CardTitle>{isHR ? 'Regularisations Awaiting HR Approval' : 'Regularisation Requests from Your Team'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {regularisations.length > 0 ? regularisations.map(reg => {
                    const emp = employees.find(e => e.user_id === reg.user_id);
                    const reasonLabels = { missed_punch: 'Missed Punch', biometric_failure: 'Biometric Failure', official_duty: 'Official Duty', work_from_home: 'Work from Home', emergency: 'Emergency', other: 'Other' };
                    return (
                      <div key={reg.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start gap-4 flex-wrap">
                          <div>
                            <p className="font-semibold">{emp?.display_name || '—'}</p>
                            <p className="text-sm text-muted-foreground">{emp?.designation} · {emp?.department}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                              <span className="font-medium">{reg.date}</span>
                              {reg.reason && <span className="text-muted-foreground">{reasonLabels[reg.reason] || reg.reason}</span>}
                            </div>
                            {reg.requested_check_in && (
                              <p className="text-sm text-muted-foreground">
                                Requested: {reg.requested_check_in} – {reg.requested_check_out || '?'}
                              </p>
                            )}
                            {reg.remarks && <p className="text-sm mt-1 italic text-muted-foreground">"{reg.remarks}"</p>}
                            {isHR && reg.status === 'manager_approved' && (
                              <Badge className="mt-1 bg-blue-100 text-blue-800">Manager Approved</Badge>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => handleRegAction(reg.id, 'approve')} size="sm" className="bg-green-600 hover:bg-green-700" disabled={processing[reg.id]}>
                              <Check className="w-4 h-4 mr-1" /> {isHR ? 'HR Approve' : 'Approve'}
                            </Button>
                            <Button onClick={() => handleRegAction(reg.id, 'reject')} size="sm" variant="destructive" disabled={processing[reg.id]}>
                              <X className="w-4 h-4 mr-1" /> Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-center text-muted-foreground py-8">No pending regularisation requests</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaves">
            <Card>
              <CardHeader>
                <CardTitle>Pending Leave Requests</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {leaveRequests.length > 0 ? (
                    leaveRequests.map(leave => {
                      const emp = employees.find(e => e.user_id === leave.user_id);
                      return (
                        <div key={leave.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start gap-4">
                            <div>
                              <p className="font-semibold">{emp?.display_name || '—'}</p>
                              <p className="text-sm text-muted-foreground">{emp?.designation} · {emp?.department}</p>
                              <p className="text-sm mt-2">
                                {safeDate(leave.start_date, 'MMM d')} - {safeDate(leave.end_date, 'MMM d, yyyy')}
                              </p>
                              <p className="text-sm text-muted-foreground">{leave.total_days} day(s)</p>
                              <p className="text-sm mt-2">{leave.reason}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button onClick={() => handleLeaveApproval(leave.id, 'approved')} size="sm" className="bg-green-600 hover:bg-green-700">
                                <Check className="w-4 h-4 mr-1" /> Approve
                              </Button>
                              <Button onClick={() => handleLeaveApproval(leave.id, 'rejected')} size="sm" variant="destructive">
                                <X className="w-4 h-4 mr-1" /> Reject
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No pending leave requests</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reimbursements">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {isHR ? 'Reimbursements Awaiting HR Approval' : 'Reimbursements Awaiting Your Approval'}
                  </CardTitle>
                  {isHR && reimbursements.length > 0 && (
                    <Button variant="outline" size="sm" onClick={downloadExcel}>
                      <Download className="w-4 h-4 mr-2" /> Download Excel
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {reimbursements.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">No reimbursements pending</p>
                  )}
                  {reimbursements.length > 0 && reimbursements.map(reimb => {
                      const emp = employees.find(e => e.user_id === reimb.user_id);
                      return (
                        <div key={reimb.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <p className="font-semibold">{emp?.display_name || '—'}</p>
                                  <p className="text-sm text-muted-foreground">{emp?.designation} · {emp?.department} · {emp?.employee_code}</p>
                                </div>
                                <p className="text-2xl font-bold text-blue-600">₹{reimb.amount?.toLocaleString()}</p>
                              </div>
                              <p className="text-sm capitalize font-medium">{reimb.expense_type?.replace(/_/g, ' ')}</p>
                              <p className="text-sm text-muted-foreground">{reimb.expense_date ? safeDate(reimb.expense_date, 'MMM d, yyyy') : ''}</p>
                              <p className="text-sm mt-2">{reimb.description}</p>
                              {reimb.status && (
                                <Badge className={`mt-1 ${statusColors[reimb.status]}`}>{reimb.status.replace(/_/g, ' ').toUpperCase()}</Badge>
                              )}
                              {reimb.receipt_url && (
                                <Button variant="link" onClick={() => setViewerDoc({ url: reimb.receipt_url, title: 'Receipt' })} className="px-0 mt-1" size="sm">
                                  View Receipt
                                </Button>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button onClick={() => handleReimbursementApproval(reimb.id, 'approve')} size="sm" className="bg-green-600 hover:bg-green-700">
                                <Check className="w-4 h-4 mr-1" /> {isHR ? 'Final Approve' : 'Approve'}
                              </Button>
                              <Button onClick={() => handleReimbursementApproval(reimb.id, 'reject')} size="sm" variant="destructive">
                                <X className="w-4 h-4 mr-1" /> Reject
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>

            {isHR && (
              <Card className="mt-4">
                <CardHeader className="pb-2">
                  <button
                    className="flex items-center justify-between w-full text-left"
                    onClick={() => setShowReimbHistory(h => !h)}
                  >
                    <CardTitle className="text-base">
                      Expense History
                      <Badge variant="outline" className="ml-2 text-xs">{reimbursementHistory.length}</Badge>
                    </CardTitle>
                    {showReimbHistory ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CardHeader>
                {showReimbHistory && (
                  <CardContent>
                    {reimbursementHistory.length === 0 ? (
                      <p className="text-center text-muted-foreground py-6">No expense history</p>
                    ) : (
                      <div className="space-y-3">
                        {reimbursementHistory.map(reimb => {
                          const emp = employees.find(e => e.user_id === reimb.user_id);
                          return (
                            <div key={reimb.id} className="border rounded-lg p-4 opacity-80">
                              <div className="flex justify-between items-start gap-4">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="font-medium">{emp?.full_name || 'Unknown'}</p>
                                      <p className="text-sm text-muted-foreground">{emp?.designation} · {emp?.department} · {emp?.employee_code}</p>
                                    </div>
                                    <p className="text-2xl font-bold text-blue-600">₹{reimb.amount?.toLocaleString()}</p>
                                  </div>
                                  <p className="text-sm capitalize font-medium mt-1">{reimb.expense_type?.replace(/_/g, ' ')}</p>
                                  <p className="text-sm text-muted-foreground">{reimb.expense_date ? safeDate(reimb.expense_date, 'MMM d, yyyy') : ''}</p>
                                  <p className="text-sm mt-1">{reimb.description}</p>
                                  <div className="flex items-center gap-3 mt-2">
                                    <Badge className={statusColors[reimb.status]}>{reimb.status.replace(/_/g, ' ').toUpperCase()}</Badge>
                                    {reimb.receipt_url && (
                                      <Button variant="link" onClick={() => setViewerDoc({ url: reimb.receipt_url, title: 'Receipt' })} className="px-0 h-auto text-xs" size="sm">
                                        View Receipt
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <DocViewerModal open={!!viewerDoc} url={viewerDoc?.url} title={viewerDoc?.title} onClose={() => setViewerDoc(null)} />
    </div>
  );
}