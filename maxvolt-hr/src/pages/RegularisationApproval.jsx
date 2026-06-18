import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RotateCcw, Clock, Filter, Users, Eye, FileText, Calendar, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const REASON_LABELS = {
  missed_punch: 'Missed Punch', biometric_failure: 'Biometric Failure',
  official_duty: 'Official Duty', work_from_home: 'Work from Home',
  emergency: 'Emergency', other: 'Other'
};

const statusConfig = {
  pending: { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
  manager_approved: { color: 'bg-blue-100 text-blue-800', label: 'Manager Approved' },
  hr_approved: { color: 'bg-indigo-100 text-indigo-800', label: 'HR Approved' },
  completed: { color: 'bg-green-100 text-green-800', label: 'Completed' },
  rejected: { color: 'bg-red-100 text-red-800', label: 'Rejected' },
  sent_back: { color: 'bg-orange-100 text-orange-800', label: 'Sent Back' }
};

export default function RegularisationApproval() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('');
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [actionDialog, setActionDialog] = useState(null); // { request, action }
  const [comment, setComment] = useState('');
  const [processing, setProcessing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterDept, setFilterDept] = useState('all');
  const [bulkSelected, setBulkSelected] = useState([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const role = currentUser.custom_role || currentUser.role;
      setUserRole(role);

      const isHR = role === 'hr' || role === 'admin';
      const [allReqs, empRecords] = await Promise.all([
        base44.entities.AttendanceRegularisation.list('-created_date', 500),
        base44.entities.Employee.list(),
      ]);

      let filtered = allReqs;
      if (!isHR) {
        // Manager sees all requests from their direct reports (all statuses)
        const teamUserIds = empRecords.filter(e => e.reporting_manager_id === currentUser.id).map(e => e.user_id);
        filtered = allReqs.filter(r => teamUserIds.includes(r.user_id));
      }

      setRequests(filtered);
      setEmployees(empRecords);
      setUsers([]);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const isHR = userRole === 'hr' || userRole === 'admin';
  const isManager = userRole === 'management' || userRole === 'manager';

  const handleAction = async () => {
    if (!actionDialog) return;
    setProcessing(true);
    try {
      const role = isHR ? 'hr' : 'manager';
      const response = await base44.functions.invoke('processRegularisation', {
        regularisation_id: actionDialog.request.id,
        action: actionDialog.action,
        comment,
        role
      });
      if (response.data?.success) {
        toast.success(`Request ${actionDialog.action} successfully`);
        setActionDialog(null);
        setComment('');
        setBulkSelected([]);
        loadData();
      } else {
        toast.error(response.data?.error || 'Action failed');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setProcessing(false);
  };

  const handleBulkAction = async (action) => {
    if (!bulkSelected.length) { toast.error('Select requests first'); return; }
    setProcessing(true);
    let successCount = 0;
    const role = isHR ? 'hr' : 'manager';
    for (const id of bulkSelected) {
      try {
        const res = await base44.functions.invoke('processRegularisation', { regularisation_id: id, action, comment: 'Bulk action', role });
        if (res.data?.success) successCount++;
      } catch (e) { console.error(e); }
    }
    toast.success(`${successCount}/${bulkSelected.length} requests ${action}d`);
    setBulkSelected([]);
    setProcessing(false);
    loadData();
  };

  const getEmployeeName = (userId) => employees.find(e => e.user_id === userId)?.display_name || 'Unknown';
  const getEmployeeDept = (userId) => employees.find(e => e.user_id === userId)?.department || '';

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];

  const filtered = requests.filter(r => {
    const matchStatus = filterStatus === 'all' || r.status === filterStatus;
    const matchEmp = filterEmployee === 'all' || r.user_id === filterEmployee;
    const dept = getEmployeeDept(r.user_id);
    const matchDept = filterDept === 'all' || dept === filterDept;
    return matchStatus && matchEmp && matchDept;
  });

  const pending = filtered.filter(r => r.status === 'pending' || (isHR && r.status === 'manager_approved'));

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Regularisation Approvals</h1>
            <p className="text-gray-600 mt-1">{isHR ? 'HR Dashboard — all employee requests' : 'Approve or reject team regularisation requests'}</p>
          </div>
          <div className="flex items-center gap-2">
            {bulkSelected.length > 0 && (
              <>
                <span className="text-sm text-gray-600">{bulkSelected.length} selected</span>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 h-8" onClick={() => handleBulkAction('approved')} disabled={processing}>
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Bulk Approve
                </Button>
                <Button size="sm" variant="destructive" className="h-8" onClick={() => handleBulkAction('rejected')} disabled={processing}>
                  <XCircle className="w-3 h-3 mr-1" /> Bulk Reject
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending', count: requests.filter(r => r.status === 'pending').length, color: 'text-yellow-600', filterVal: 'pending' },
            { label: 'Manager Approved', count: requests.filter(r => r.status === 'manager_approved').length, color: 'text-blue-600', filterVal: 'manager_approved' },
            { label: 'Completed', count: requests.filter(r => r.status === 'completed').length, color: 'text-green-600', filterVal: 'completed' },
            { label: 'Rejected', count: requests.filter(r => r.status === 'rejected').length, color: 'text-red-600', filterVal: 'rejected' }
          ].map(s => (
            <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterStatus(s.filterVal)}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-sm text-gray-600">{s.label}</p>
                <p className="text-xs text-gray-400 mt-1">Click to filter</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 bg-white"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {isHR && (
            <>
              <Select value={filterDept} onValueChange={setFilterDept}>
                <SelectTrigger className="w-44 bg-white"><SelectValue placeholder="All Departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger className="w-52 bg-white"><SelectValue placeholder="All Employees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map(e => <SelectItem key={e.user_id} value={e.user_id}>{e.display_name || e.employee_code} ({e.employee_code})</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {/* Request Cards */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Requests ({filtered.length})</CardTitle>
              {pending.length > 0 && (
                <Badge className="bg-yellow-100 text-yellow-800">{pending.length} awaiting action</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filtered.map(req => {
                const cfg = statusConfig[req.status] || statusConfig.pending;
                const empName = getEmployeeName(req.user_id);
                const empDept = getEmployeeDept(req.user_id);
                const canManagerAct = !isHR && (req.status === 'pending' || req.status === 'sent_back');
                const canHRAct = isHR && (req.status === 'manager_approved' || req.status === 'pending');
                const canAct = canManagerAct || canHRAct;
                const isSelected = bulkSelected.includes(req.id);

                return (
                  <div key={req.id} className={`border rounded-xl p-4 transition-colors ${isSelected ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'}`}>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                      <div className="flex items-start gap-3">
                        {canAct && (
                          <input type="checkbox" className="mt-1 rounded" checked={isSelected}
                            onChange={e => setBulkSelected(prev => e.target.checked ? [...prev, req.id] : prev.filter(id => id !== req.id))} />
                        )}
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-700 font-bold text-sm">{empName.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="font-semibold">{empName}</p>
                          <p className="text-xs text-gray-500">{empDept}</p>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{format(new Date(req.attendance_date), 'EEE, MMM d, yyyy')}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{REASON_LABELS[req.reason_category] || req.reason_category}</p>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{req.reason}</p>
                          <div className="flex gap-3 text-xs text-gray-500 mt-1">
                            {req.existing_status && <span>Was: <strong>{req.existing_status}</strong></span>}
                            {req.requested_check_in && <span>Req In: <strong>{req.requested_check_in}</strong></span>}
                            {req.requested_check_out && <span>Req Out: <strong>{req.requested_check_out}</strong></span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={cfg.color}>{cfg.label}</Badge>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedRequest(req)}>
                          <Eye className="w-3 h-3 mr-1" /> Details
                        </Button>
                        {canAct && (
                          <>
                            <Button size="sm" className="bg-green-600 hover:bg-green-700 h-7 text-xs"
                              onClick={() => { setActionDialog({ request: req, action: 'approved' }); setComment(''); }}>
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            {!isHR && (
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => { setActionDialog({ request: req, action: 'sent_back' }); setComment(''); }}>
                                <RotateCcw className="w-3 h-3 mr-1" /> Send Back
                              </Button>
                            )}
                            <Button size="sm" variant="destructive" className="h-7 text-xs"
                              onClick={() => { setActionDialog({ request: req, action: 'rejected' }); setComment(''); }}>
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500">No requests found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={open => { if (!open) { setActionDialog(null); setComment(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionDialog?.action === 'approved' && <CheckCircle2 className="w-5 h-5 text-green-600" />}
              {actionDialog?.action === 'rejected' && <XCircle className="w-5 h-5 text-red-600" />}
              {actionDialog?.action === 'sent_back' && <RotateCcw className="w-5 h-5 text-orange-600" />}
              {actionDialog?.action === 'approved' ? 'Approve' : actionDialog?.action === 'rejected' ? 'Reject' : 'Send Back'} Request
            </DialogTitle>
          </DialogHeader>
          {actionDialog && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p><strong>Employee:</strong> {getEmployeeName(actionDialog.request.user_id)}</p>
                <p><strong>Date:</strong> {format(new Date(actionDialog.request.attendance_date), 'MMM d, yyyy')}</p>
                <p><strong>Reason:</strong> {actionDialog.request.reason}</p>
              </div>
              <div>
                <Label>Comment {actionDialog.action !== 'approved' ? '*' : '(optional)'}</Label>
                <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                  placeholder={actionDialog.action === 'approved' ? 'Optional comment...' : 'Provide a reason...'}
                  required={actionDialog.action !== 'approved'} />
              </div>
              {actionDialog.action === 'approved' && isHR && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>Approval will automatically update the attendance record and recalculate working hours.</p>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => { setActionDialog(null); setComment(''); }}>Cancel</Button>
                <Button
                  onClick={handleAction}
                  disabled={processing || (actionDialog.action !== 'approved' && !comment.trim())}
                  className={actionDialog.action === 'approved' ? 'bg-green-600 hover:bg-green-700' : actionDialog.action === 'rejected' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'}
                >
                  {processing ? 'Processing...' : `Confirm ${actionDialog.action === 'approved' ? 'Approval' : actionDialog.action === 'rejected' ? 'Rejection' : 'Send Back'}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={open => { if (!open) setSelectedRequest(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request Details</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-gray-500">Employee</p><p className="font-medium">{getEmployeeName(selectedRequest.user_id)}</p></div>
                <div><p className="text-xs text-gray-500">Date</p><p className="font-medium">{format(new Date(selectedRequest.attendance_date), 'MMM d, yyyy')}</p></div>
                <div><p className="text-xs text-gray-500">Status</p><Badge className={statusConfig[selectedRequest.status]?.color}>{statusConfig[selectedRequest.status]?.label}</Badge></div>
                <div><p className="text-xs text-gray-500">Reason Category</p><p className="font-medium">{REASON_LABELS[selectedRequest.reason_category]}</p></div>
              </div>
              <div><p className="text-xs text-gray-500">Reason</p><p className="bg-gray-50 rounded p-2">{selectedRequest.reason}</p></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Original</p>
                  <div className="bg-red-50 rounded p-2 text-xs space-y-1">
                    <p>Status: {selectedRequest.existing_status || 'N/A'}</p>
                    <p>In: {selectedRequest.existing_check_in ? format(new Date(selectedRequest.existing_check_in), 'HH:mm') : 'N/A'}</p>
                    <p>Out: {selectedRequest.existing_check_out ? format(new Date(selectedRequest.existing_check_out), 'HH:mm') : 'N/A'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Requested</p>
                  <div className="bg-green-50 rounded p-2 text-xs space-y-1">
                    <p>In: {selectedRequest.requested_check_in || 'N/A'}</p>
                    <p>Out: {selectedRequest.requested_check_out || 'N/A'}</p>
                  </div>
                </div>
              </div>
              {selectedRequest.document_url && (
                <div><a href={selectedRequest.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1"><FileText className="w-4 h-4" /> View Supporting Document</a></div>
              )}
              {/* Audit Log */}
              {selectedRequest.audit_log?.length > 0 && (
                <div>
                  <p className="font-medium mb-2">Audit Trail</p>
                  <div className="space-y-2">
                    {selectedRequest.audit_log.map((log, idx) => (
                      <div key={idx} className="border-l-2 border-blue-300 pl-3 py-1">
                        <p className="text-xs font-medium">{log.actor_name} — <span className="text-gray-500 capitalize">{log.action.replace('_', ' ')}</span></p>
                        {log.comment && <p className="text-xs text-gray-600">{log.comment}</p>}
                        <p className="text-xs text-gray-400">{log.timestamp ? format(new Date(log.timestamp), 'MMM d, yyyy HH:mm') : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}