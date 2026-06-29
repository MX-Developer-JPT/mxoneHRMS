import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Calendar, FileText, AlertCircle, CheckCircle, Info } from 'lucide-react';
import MobileSelect from '@/components/MobileSelect';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import { toast } from 'sonner';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
  withdrawn: 'bg-gray-100 text-gray-800'
};

const POLICY_COLORS = {
  CL: 'bg-blue-100 text-blue-700',
  EL: 'bg-green-100 text-green-700',
  SL: 'bg-purple-100 text-purple-700'
};

export default function Leave() {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [leavePolicies, setLeavePolicies] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState(null);
  const [documentFile, setDocumentFile] = useState(null);

  const [formData, setFormData] = useState({
    leave_policy_id: '',
    start_date: '',
    end_date: '',
    half_day: false,
    reason: '',
    contact_during_leave: ''
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const empRecords = await base44.entities.Employee.filter({ user_id: currentUser.id, status: 'active' });
      if (empRecords.length > 0) setEmployee(empRecords[0]);

      const policies = await base44.entities.LeavePolicy.filter({ is_active: true });
      setLeavePolicies(policies);

      const currentYear = new Date().getFullYear();
      const balances = await base44.entities.LeaveBalance.filter({ user_id: currentUser.id, year: currentYear });
      setLeaveBalances(balances);

      const requests = await base44.entities.Leave.filter({ user_id: currentUser.id }, '-created_date');
      setLeaveRequests(requests);
    } catch (error) {
      console.error('Error loading leave data:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedPolicy = leavePolicies.find(p => p.id === formData.leave_policy_id);

  // Only show policies where the employee has a balance record with > 0 available days
  const availablePolicies = leavePolicies.filter(p => {
    const balance = leaveBalances.find(b => b.leave_policy_id === p.id);
    // If no balance record exists yet, still show (balance may not have been initialized)
    if (!balance) return true;
    return (balance.available || 0) > 0;
  });

  // Sentinel ID for WFH "leave" — not a real policy, no balance deduction
  const WFH_ID = '__WFH__';
  const isWFH = formData.leave_policy_id === WFH_ID;

  const handleValidate = async () => {
    if (!formData.leave_policy_id || !formData.start_date || !formData.end_date) return;
    setValidating(true);
    setValidation(null);
    try {
      const res = await base44.functions.invoke('validateLeaveApplication', {
        leave_policy_id: formData.leave_policy_id,
        start_date: formData.start_date,
        end_date: formData.end_date,
        half_day: formData.half_day
      });
      setValidation(res.data);
    } catch (e) {
      setValidation({ valid: false, errors: [e.message] });
    }
    setValidating(false);
  };

  // Auto-validate when dates/policy change
  useEffect(() => {
    if (formData.leave_policy_id && formData.leave_policy_id !== WFH_ID && formData.start_date && formData.end_date) {
      handleValidate();
    } else {
      setValidation(null);
    }
  }, [formData.leave_policy_id, formData.start_date, formData.end_date, formData.half_day]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // WFH doesn't need policy validation
    if (!isWFH && !validation?.valid) {
      toast.error('Please fix validation errors before submitting.');
      return;
    }
    if (!formData.start_date || (!isWFH && !formData.end_date)) {
      toast.error('Please fill in all required fields.');
      return;
    }
    setSubmitting(true);

    const totalDays = isWFH ? 1 : validation.adjusted_days;
    const endDate = isWFH ? formData.start_date : formData.end_date;

    // Optimistic update
    const optimisticLeave = {
      id: 'optimistic-' + Date.now(),
      user_id: user.id,
      leave_policy_id: isWFH ? null : formData.leave_policy_id,
      leave_type: isWFH ? 'work_from_home' : undefined,
      is_wfh: isWFH || undefined,
      start_date: formData.start_date,
      end_date: endDate,
      half_day: formData.half_day,
      total_days: totalDays,
      reason: formData.reason,
      status: 'pending',
      current_approval_level: 1,
      created_date: new Date().toISOString(),
    };
    setLeaveRequests(prev => [optimisticLeave, ...prev]);
    setShowForm(false);
    resetForm();

    try {
      let attachmentUrl = null;
      if (documentFile) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: documentFile });
        attachmentUrl = file_url;
      }

      await base44.entities.Leave.create({
        user_id: user.id,
        leave_policy_id: isWFH ? null : formData.leave_policy_id,
        leave_type: isWFH ? 'work_from_home' : undefined,
        is_wfh: isWFH || undefined,
        start_date: formData.start_date,
        end_date: endDate,
        half_day: formData.half_day,
        total_days: totalDays,
        reason: formData.reason,
        contact_during_leave: formData.contact_during_leave,
        attachment_url: attachmentUrl,
        status: 'pending',
        current_approval_level: 1,
        manager_id: employee?.reporting_manager_id || null,
        applied_on: new Date().toISOString(),
        approval_history: []
      });

      // Deduct from pending balance (skip for WFH — no leave balance used)
      if (!isWFH) {
        const currentYear = new Date().getFullYear();
        const balRecs = await base44.entities.LeaveBalance.filter({
          user_id: user.id, leave_policy_id: formData.leave_policy_id, year: currentYear
        });
        if (balRecs.length > 0) {
          const lb = balRecs[0];
          await base44.entities.LeaveBalance.update(lb.id, {
            pending_approval: (lb.pending_approval || 0) + totalDays,
            available: Math.max((lb.available || 0) - totalDays, 0)
          });
        }
      }

      toast.success(isWFH ? 'WFH request submitted for approval!' : 'Leave request submitted successfully!');
      loadData();
    } catch (error) {
      setLeaveRequests(prev => prev.filter(l => l.id !== optimisticLeave.id));
      setShowForm(true);
      toast.error('Failed to submit request: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({ leave_policy_id: '', start_date: '', end_date: '', half_day: false, reason: '', contact_during_leave: '' });
    setValidation(null);
    setDocumentFile(null);
  };

  const handleCancel = async (leave) => {
    if (!window.confirm('Cancel this leave request?')) return;
    await base44.entities.Leave.update(leave.id, { status: 'cancelled' });
    // Restore balance
    const currentYear = new Date().getFullYear();
    const balRecs = await base44.entities.LeaveBalance.filter({
      user_id: user.id, leave_policy_id: leave.leave_policy_id, year: currentYear
    });
    if (balRecs.length > 0) {
      const lb = balRecs[0];
      await base44.entities.LeaveBalance.update(lb.id, {
        pending_approval: Math.max((lb.pending_approval || 0) - leave.total_days, 0),
        available: (lb.available || 0) + leave.total_days
      });
    }
    toast.success('Leave request cancelled');
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const needsDocument = selectedPolicy?.code === 'SL' && validation?.adjusted_days > 2;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Leaves</h1>
            <p className="text-gray-500 text-sm mt-1">Apply and track your leave requests</p>
          </div>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" /> Apply Leave
          </Button>
        </div>

        {/* Employee Status Banner */}
        {employee && employee.employee_status === 'probation' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-800">Probation Period Active</p>
              <p className="text-sm text-amber-700">Earned Leave (EL) will be credited after your confirmation. Casual Leave (CL) is available on pro-rata basis.</p>
            </div>
          </div>
        )}

        {/* Leave Balances */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Leave Balances ({new Date().getFullYear()})</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {leavePolicies.map(policy => {
              const balance = leaveBalances.find(b => b.leave_policy_id === policy.id);
              return (
                <Card key={policy.id} className="border border-gray-200">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-800">{policy.name}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${POLICY_COLORS[policy.code] || 'bg-gray-100 text-gray-700'}`}>{policy.code}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-gray-900">{balance?.available?.toFixed(1) || '0'}</p>
                        <p className="text-xs text-gray-500">available</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-xs text-gray-600 border-t pt-3">
                      <div className="flex justify-between">
                        <span>Total Allocated</span>
                        <span className="font-medium">{balance?.total_allocated?.toFixed(1) || '0'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Used</span>
                        <span className="font-medium text-red-600">{balance?.used?.toFixed(1) || '0'}</span>
                      </div>
                      {(balance?.pending_approval > 0) && (
                        <div className="flex justify-between">
                          <span>Pending Approval</span>
                          <span className="font-medium text-yellow-600">{balance.pending_approval?.toFixed(1)}</span>
                        </div>
                      )}
                      {(balance?.carried_forward > 0) && (
                        <div className="flex justify-between">
                          <span>Carried Forward</span>
                          <span className="font-medium text-blue-600">{balance.carried_forward?.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    {policy.total_leave_per_month && (
                      <p className="text-xs text-blue-500 mt-1">Monthly limit: {policy.total_leave_per_month} days</p>
                    )}
                    {policy.renews_in_days && (
                      <p className="text-xs text-green-600 mt-0.5">Renews every {policy.renews_in_days} days {policy.renewed_leave_balance ? `(+${policy.renewed_leave_balance} days)` : ''}</p>
                    )}
                    {!policy.total_leave_per_month && !policy.renews_in_days && (
                      <>
                        {policy.code === 'CL' && <p className="text-xs text-gray-400 mt-2 italic">Cannot carry forward • Max 3 days consecutive</p>}
                        {policy.code === 'EL' && <p className="text-xs text-gray-400 mt-2 italic">Fully carry forward • Post-confirmation only</p>}
                        {policy.code === 'SL' && <p className="text-xs text-gray-400 mt-2 italic">Max 7 days carry forward • Manager+ only</p>}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Leave History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leave History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {leaveRequests.length > 0 ? leaveRequests.map(leave => {
                const policy = leavePolicies.find(p => p.id === leave.leave_policy_id);
                return (
                  <div key={leave.id} className="border rounded-lg p-4">
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {leave.is_wfh || leave.leave_type === 'work_from_home'
                            ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">WFH</span>
                            : <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${POLICY_COLORS[policy?.code] || 'bg-gray-100'}`}>{policy?.code}</span>
                          }
                          <p className="font-semibold text-sm">{leave.is_wfh || leave.leave_type === 'work_from_home' ? 'Work From Home' : policy?.name}</p>
                          <Badge className={STATUS_COLORS[leave.status]}>{leave.status.toUpperCase()}</Badge>
                          {leave.current_approval_level === 2 && leave.status === 'pending' && (
                            <Badge className="bg-blue-100 text-blue-700">Level 2 Review</Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">
                          {safeDate(leave.start_date, 'MMM d')} – {safeDate(leave.end_date, 'MMM d, yyyy')}
                          <span className="ml-2 font-medium">({leave.total_days} day{leave.total_days !== 1 ? 's' : ''})</span>
                          {leave.half_day && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Half Day</span>}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">{leave.reason}</p>
                        {leave.rejection_reason && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-sm text-red-700">
                            <strong>Rejected:</strong> {leave.rejection_reason}
                          </div>
                        )}
                        {leave.approval_history?.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {leave.approval_history.map((h, i) => (
                              <p key={i} className="text-xs text-gray-500">
                                ✓ {h.approver_name} ({h.level === 1 ? 'Manager' : 'HOD/HR'}) — {h.status} on {safeDate(h.timestamp, 'MMM d, yyyy')}
                                {h.comments && ` — "${h.comments}"`}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-xs text-gray-400">Applied {safeDate(leave.created_date, 'MMM d, yyyy')}</p>
                        {leave.status === 'pending' && (
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => handleCancel(leave)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <p className="text-center text-gray-500 py-8">No leave requests yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Apply Leave Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply for Leave</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <Label>Leave Type</Label>
              <MobileSelect
                value={formData.leave_policy_id}
                onValueChange={(v) => setFormData({ ...formData, leave_policy_id: v })}
                placeholder="Select leave type"
                label="Select Leave Type"
                options={[
                  ...(employee?.wfh_eligible ? [{ value: WFH_ID, label: '🏠 Work From Home (WFH) — No balance deduction' }] : []),
                  ...(availablePolicies.length === 0
                    ? [{ value: '_none', label: 'No leave balance available' }]
                    : availablePolicies.map(p => {
                        const balance = leaveBalances.find(b => b.leave_policy_id === p.id);
                        return { value: p.id, label: `${p.name} (${p.code}) — ${balance?.available?.toFixed(1) || '0'} days left` };
                      }))
                ]}
              />
              {isWFH && (
                <p className="text-xs text-blue-600 mt-1">WFH request — no leave balance deducted. Subject to manager approval.</p>
              )}
              {!isWFH && selectedPolicy && (
                <div className="mt-1 space-y-0.5">
                  {selectedPolicy.code === 'CL' && <p className="text-xs text-gray-500">Max 3 consecutive days • No carry forward • Cannot be clubbed</p>}
                  {selectedPolicy.code === 'EL' && <p className="text-xs text-gray-500">Must apply in advance • Post-confirmation only • Fully carry forward</p>}
                  {selectedPolicy.code === 'SL' && <p className="text-xs text-gray-500">Manager+ only • Medical proof if &gt;2 days • Can club with EL</p>}
                </div>
              )}
            </div>

            {/* Half Day Option */}
            {!isWFH && selectedPolicy?.code === 'CL' && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="half_day" checked={formData.half_day}
                  onChange={(e) => setFormData({ ...formData, half_day: e.target.checked })}
                  className="w-4 h-4" />
                <Label htmlFor="half_day" className="cursor-pointer">Half Day</Label>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} required />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={formData.end_date} min={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  disabled={formData.half_day} required />
              </div>
            </div>

            {/* Validation Result */}
            {validating && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-500">Validating...</div>
            )}
            {validation && !validating && (
              <div className={`rounded-lg p-4 border ${validation.valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {validation.valid
                    ? <CheckCircle className="w-4 h-4 text-green-600" />
                    : <AlertCircle className="w-4 h-4 text-red-600" />}
                  <span className={`font-medium text-sm ${validation.valid ? 'text-green-700' : 'text-red-700'}`}>
                    {validation.valid ? `Valid — ${validation.adjusted_days} day(s) will be deducted (Balance: ${validation.available_balance})` : 'Validation Failed'}
                  </span>
                </div>
                {validation.errors?.map((err, i) => (
                  <p key={i} className="text-sm text-red-700 ml-6">• {err}</p>
                ))}
                {validation.warnings?.map((w, i) => (
                  <p key={i} className="text-sm text-amber-700 ml-6">⚠ {w}</p>
                ))}
              </div>
            )}

            {/* SL Document Upload */}
            {needsDocument && (
              <div>
                <Label>Medical Certificate <span className="text-red-500">*</span></Label>
                <p className="text-xs text-gray-500 mb-1">Required for Sick Leave exceeding 2 days</p>
                <Input type="file" accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setDocumentFile(e.target.files[0])} />
              </div>
            )}

            <div>
              <Label>Reason</Label>
              <Textarea value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Describe the reason for leave" rows={3} required />
            </div>

            <div>
              <Label>Contact During Leave (Optional)</Label>
              <Input value={formData.contact_during_leave}
                onChange={(e) => setFormData({ ...formData, contact_during_leave: e.target.value })}
                placeholder="Phone or email" />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" disabled={submitting || (!isWFH && !validation?.valid) || validating}>
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}