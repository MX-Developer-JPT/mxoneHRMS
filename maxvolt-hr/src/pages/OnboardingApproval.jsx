import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { UserPlus, CheckCircle, XCircle, FileText, Eye, Clock, Home } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

export default function OnboardingApproval() {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserDocs, setSelectedUserDocs] = useState([]);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [showRejectionDialog, setShowRejectionDialog] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [formData, setFormData] = useState({
    employee_code: '',
    department: '',
    designation: '',
    designation_tier: '',
    status: 'probation',
    date_of_joining: '',
    employee_confirmation_date: '',
    work_location: '',
    shift_id: '',
    reporting_manager_id: '',
    phone: '',
    employment_type: 'full_time',
    overtime_eligible: false,
    wfh_eligible: false,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const usersResponse = await base44.functions.invoke('getAllUsers', {});
      const allUsers = usersResponse.data.users;
      
      const pending = allUsers.filter(u => {
        const userRole = u.custom_role || u.role;
        return userRole === 'onboarding_pending';
      });
      
      const [empRecords, depts, shiftList, locationList] = await Promise.all([
        base44.entities.Employee.list('-created_date', 500),
        base44.entities.Department.list(),
        base44.entities.Shift.list(),
        base44.entities.AppLocation.list(),
      ]);
      
      const managementUsers = allUsers.filter(u => {
        const userRole = u.custom_role || u.role;
        return ['management', 'admin', 'hr'].includes(userRole);
      });

      setPendingUsers(pending);
      setEmployees(empRecords);
      setDepartments(depts);
      setShifts(shiftList);
      setLocations(locationList);
      setManagers(managementUsers);
      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const handleApprove = async (user) => {
    setSelectedUser(user);
    const empRecord = employees.find(e => e.user_id === user.id);
    // Load their submitted documents
    const docs = await base44.entities.Document.filter({ user_id: user.id });
    setSelectedUserDocs(docs);
    setFormData({
      employee_code: empRecord?.employee_code || '',
      department: '',
      designation: '',
      designation_tier: '',
      status: 'probation',
      date_of_joining: '',
      employee_confirmation_date: '',
      work_location: '',
      shift_id: '',
      reporting_manager_id: '',
      phone: empRecord?.phone || '',
      employment_type: 'full_time'
    });
    setShowApprovalDialog(true);
  };

  const handleReject = (user) => {
    setSelectedUser(user);
    setRejectionReason('');
    setShowRejectionDialog(true);
  };

  const handleSubmitRejection = async () => {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    await base44.functions.invoke('rejectUserOnboarding', {
      user_id: selectedUser.id,
      reason: rejectionReason
    });
    toast.success('Rejection sent to employee');
    setShowRejectionDialog(false);
    loadData();
  };

  const handleSubmitApproval = async () => {
    try {
      if (!formData.employee_code || !formData.department || !formData.designation || !formData.date_of_joining) {
        toast.error('Please fill in all required fields');
        return;
      }

      // Auto-calculate confirmation date (6 months from joining) if status is not trainee
      let confirmationDate = formData.employee_confirmation_date;
      if (formData.status !== 'trainee' && formData.date_of_joining) {
        const joiningDate = new Date(formData.date_of_joining);
        const confirmation = new Date(joiningDate);
        confirmation.setMonth(confirmation.getMonth() + 6);
        confirmationDate = confirmation.toISOString().split('T')[0];
      }

      const employeeData = {
        employee_code: formData.employee_code,
        department: formData.department,
        designation: formData.designation,
        designation_tier: formData.designation_tier,
        employee_status: formData.status,
        date_of_joining: formData.date_of_joining,
        employee_confirmation_date: formData.status === 'trainee' ? null : confirmationDate,
        work_location: formData.work_location,
        shift_id: formData.shift_id || null,
        employment_type: formData.employment_type,
        phone: formData.phone,
        reporting_manager_id: formData.reporting_manager_id || null,
        overtime_eligible: formData.overtime_eligible,
        wfh_eligible: formData.wfh_eligible,
      };

      await base44.functions.invoke('approveUserOnboarding', {
        userId: selectedUser.id,
        employeeData: employeeData,
        newUserRole: 'employee'
      });

      toast.success('User approved and onboarded successfully!');
      setShowApprovalDialog(false);
      loadData();
    } catch (error) {
      console.error('Error approving user:', error);
      toast.error(`Approval failed: ${error.message || 'Please try again.'}`);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Onboarding Approval</h1>
          <p className="text-gray-600 mt-1">Review and approve new user registrations</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Pending Approvals ({pendingUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingUsers.length > 0 ? (
              <div className="space-y-4">
                {pendingUsers.map(user => {
                  const empRecord = employees.find(e => e.user_id === user.id);
                  return (
                    <div key={user.id} className="border rounded-lg p-4 flex justify-between items-center">
                      <div>
                        <p className="font-semibold text-lg">
                          {[user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ') || user.full_name || '(Name not set)'}
                        </p>
                        <p className="text-sm text-gray-600">{user.email}</p>
                        {empRecord && (
                          <p className="text-xs text-gray-500 mt-1">
                            Registered: {new Date(empRecord.created_date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {empRecord?.onboarding_submitted && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full self-center">Docs Submitted</span>
                        )}
                        <Button variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => handleReject(user)}>
                          <XCircle className="w-4 h-4 mr-2" />Reject
                        </Button>
                        <Button onClick={() => handleApprove(user)}>
                         <CheckCircle className="w-4 h-4 mr-2" />
                         Approve & Assign
                        </Button>
                        </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <UserPlus className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-500">No pending approvals</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Approve & Onboard: {selectedUser ? (selectedUser.display_name || selectedUser.full_name) : ''}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              {selectedUserDocs.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="font-semibold text-blue-800 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" />Submitted Documents ({selectedUserDocs.length})</p>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedUserDocs.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between bg-white rounded p-2 text-sm">
                        <span className="truncate">{doc.document_name}</span>
                        <Button size="sm" variant="ghost" onClick={() => setViewerDoc({ url: doc.document_url, title: doc.document_name || 'Document' })}>
                          <Eye className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Employee Code *</Label>
                  <Input
                    value={formData.employee_code}
                    onChange={(e) => setFormData({...formData, employee_code: e.target.value})}
                    placeholder="EMP001"
                  />
                </div>

                <div>
                  <Label>Status *</Label>
                  <Select value={formData.status} onValueChange={(value) => setFormData({...formData, status: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="probation">Probation</SelectItem>
                      <SelectItem value="confirmation">Confirmation</SelectItem>
                      <SelectItem value="trainee">Trainee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Date of Joining *</Label>
                  <Input
                    type="date"
                    value={formData.date_of_joining}
                    onChange={(e) => setFormData({...formData, date_of_joining: e.target.value})}
                  />
                </div>

                <div>
                  <Label>Employee Confirmation Due Date {formData.status === 'trainee' && '(N/A for Trainee)'}</Label>
                  <Input
                    type="date"
                    value={formData.employee_confirmation_date}
                    onChange={(e) => setFormData({...formData, employee_confirmation_date: e.target.value})}
                    disabled={formData.status === 'trainee'}
                    placeholder={formData.status !== 'trainee' ? 'Auto-calculated: 6 months from joining' : 'N/A'}
                  />
                </div>

                <div>
                  <Label>Department *</Label>
                  <Select value={formData.department} onValueChange={(value) => setFormData({...formData, department: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map(dept => (
                        <SelectItem key={dept.id} value={dept.code}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Designation *</Label>
                  <Input
                    value={formData.designation}
                    onChange={(e) => setFormData({...formData, designation: e.target.value})}
                    placeholder="Business Analyst"
                  />
                </div>

                <div>
                  <Label>Designation Tier *</Label>
                  <Select value={formData.designation_tier} onValueChange={(value) => setFormData({...formData, designation_tier: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="executive">Executive</SelectItem>
                      <SelectItem value="senior_executive">Senior Executive</SelectItem>
                      <SelectItem value="territory_manager">Territory Manager / Assistant Manager</SelectItem>
                      <SelectItem value="manager">Senior Manager / Manager / Regional Manager</SelectItem>
                      <SelectItem value="general_manager">General Manager / Deputy GM / Assistant GM</SelectItem>
                      <SelectItem value="director">Director / Senior VP / Ex Director / Vice President</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Work Location *</Label>
                  <Select value={formData.work_location} onValueChange={(value) => setFormData({...formData, work_location: value})}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Employment Type</Label>
                  <Select value={formData.employment_type} onValueChange={(value) => setFormData({...formData, employment_type: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full Time</SelectItem>
                      <SelectItem value="part_time">Part Time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="intern">Intern</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Phone</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    placeholder="+91 1234567890"
                  />
                </div>

                <div>
                  <Label>Shift</Label>
                  <Select value={formData.shift_id} onValueChange={(value) => setFormData({...formData, shift_id: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift" />
                    </SelectTrigger>
                    <SelectContent>
                      {shifts.map(shift => (
                        <SelectItem key={shift.id} value={shift.id}>
                          {shift.name} ({shift.start_time} - {shift.end_time})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Reporting Manager</Label>
                  <Select value={formData.reporting_manager_id} onValueChange={(value) => setFormData({...formData, reporting_manager_id: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {managers.map(manager => (
                        <SelectItem key={manager.id} value={manager.id}>
                          {manager.display_name || manager.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block">Overtime Eligibility</Label>
                  <button
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, overtime_eligible: !f.overtime_eligible }))}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 w-full transition-all ${formData.overtime_eligible ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                  >
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${formData.overtime_eligible ? 'bg-purple-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.overtime_eligible ? 'translate-x-5' : ''}`} />
                    </div>
                    <Clock className="w-4 h-4" />
                    <div className="text-left">
                      <p className="font-medium text-sm">{formData.overtime_eligible ? 'Overtime Eligible' : 'Not Eligible for Overtime'}</p>
                      <p className="text-xs opacity-70">{formData.overtime_eligible ? 'Overtime hours in attendance reports and exports' : 'Toggle to enable overtime tracking'}</p>
                    </div>
                  </button>
                </div>

                <div>
                  <Label className="mb-2 block">Work From Home Eligibility</Label>
                  <button
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, wfh_eligible: !f.wfh_eligible }))}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 w-full transition-all ${formData.wfh_eligible ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                  >
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${formData.wfh_eligible ? 'bg-blue-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.wfh_eligible ? 'translate-x-5' : ''}`} />
                    </div>
                    <Home className="w-4 h-4" />
                    <div className="text-left">
                      <p className="font-medium text-sm">{formData.wfh_eligible ? 'WFH Eligible' : 'Not Eligible for WFH'}</p>
                      <p className="text-xs opacity-70">{formData.wfh_eligible ? 'Can apply Work From Home in the Leave module' : 'Toggle to allow WFH requests'}</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <Button variant="outline" onClick={() => setShowApprovalDialog(false)}>Cancel</Button>
                <Button onClick={handleSubmitApproval}>Approve & Onboard</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Rejection Dialog */}
        <Dialog open={showRejectionDialog} onOpenChange={setShowRejectionDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Onboarding: {selectedUser ? (selectedUser.display_name || selectedUser.full_name) : ''}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-gray-600 text-sm">The employee will be notified and asked to re-submit with corrections.</p>
              <div>
                <Label>Rejection Reason *</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="e.g., Aadhaar card image is blurry, please re-upload a clear photo"
                  rows={4}
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowRejectionDialog(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleSubmitRejection}>Send Rejection</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <DocViewerModal
        open={!!viewerDoc}
        url={viewerDoc?.url}
        title={viewerDoc?.title}
        onClose={() => setViewerDoc(null)}
      />
    </div>
  );
}