import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, DollarSign, Check, X, Download } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function Approvals() {
  const [user, setUser] = useState(null);
  const [isHR, setIsHR] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewerDoc, setViewerDoc] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const userRole = currentUser.custom_role || currentUser.role;
      const hrRole = userRole === 'hr' || userRole === 'admin';
      setIsHR(hrRole);

      const empRecords = await base44.entities.Employee.list();
      setEmployees(empRecords);

      let leaves = await base44.entities.Leave.filter({ status: 'pending' }, '-created_date');

      // Reimbursements: manager sees pending where manager_id = me, HR sees manager_approved
      let reimburse;
      if (hrRole) {
        reimburse = await base44.entities.Reimbursement.filter({ status: 'manager_approved' }, '-created_date');
      } else {
        reimburse = await base44.entities.Reimbursement.filter({ manager_id: currentUser.id, status: 'pending' }, '-created_date');
      }

      if (!hrRole) {
        const directReportUserIds = empRecords
          .filter(e => e.reporting_manager_id === currentUser.id)
          .map(e => e.user_id);
        leaves = leaves.filter(l => directReportUserIds.includes(l.user_id));
      }

      setLeaveRequests(leaves);
      setReimbursements(reimburse);
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
      if (isHR) {
        // HR final approval/rejection
        await base44.entities.Reimbursement.update(reimbId, {
          status: action === 'approve' ? 'approved' : 'rejected',
          hr_approved_by: user.id,
          approved_date: new Date().toISOString()
        });
        toast.success(`Reimbursement ${action === 'approve' ? 'approved' : 'rejected'} by HR`);
      } else {
        // Manager approval — move to HR queue
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
        r.expense_date ? format(new Date(r.expense_date), 'dd/MM/yyyy') : '',
        r.amount || 0,
        (r.description || '').replace(/,/g, ';'),
        r.status || '',
        r.created_date ? format(new Date(r.created_date), 'dd/MM/yyyy') : ''
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

  const totalPending = leaveRequests.length + reimbursements.length;

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
              <div className="text-right text-sm text-muted-foreground">
                <p>{leaveRequests.length} Leave Requests</p>
                <p>{reimbursements.length} Reimbursements {isHR ? '(awaiting HR)' : '(awaiting you)'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="reimbursements" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="leaves">
              <FileText className="w-4 h-4 mr-2" />
              Leave ({leaveRequests.length})
            </TabsTrigger>
            <TabsTrigger value="reimbursements">
              <DollarSign className="w-4 h-4 mr-2" />
              Reimbursements ({reimbursements.length})
            </TabsTrigger>
          </TabsList>

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
                                {format(new Date(leave.start_date), 'MMM d')} - {format(new Date(leave.end_date), 'MMM d, yyyy')}
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
                  {reimbursements.length > 0 ? (
                    reimbursements.map(reimb => {
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
                              <p className="text-sm text-muted-foreground">{reimb.expense_date ? format(new Date(reimb.expense_date), 'MMM d, yyyy') : ''}</p>
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
                    })
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No reimbursements pending</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <DocViewerModal open={!!viewerDoc} url={viewerDoc?.url} title={viewerDoc?.title} onClose={() => setViewerDoc(null)} />
    </div>
  );
}