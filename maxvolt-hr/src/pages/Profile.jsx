import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { User, Mail, Phone, MapPin, Briefcase, Calendar, Shield, Building2, UserCheck, CreditCard, AlertTriangle, Edit2, Save, X, Heart, ShieldCheck, ExternalLink, Camera, Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import SalaryBreakdownCard from '../components/salary/SalaryBreakdownCard';
import { format, differenceInMonths, differenceInYears } from 'date-fns';

const roleLabels = {
  admin: { label: 'Administrator', color: 'bg-red-100 text-red-800', access: 'Full system access' },
  hr: { label: 'HR Manager', color: 'bg-purple-100 text-purple-800', access: 'HR, Payroll, Recruitment, Compliance' },
  management: { label: 'Management', color: 'bg-blue-100 text-blue-800', access: 'Team management, Reports, Approvals' },
  employee: { label: 'Employee', color: 'bg-green-100 text-green-800', access: 'Attendance, Leave, Payslips, Helpdesk' },
  user: { label: 'Employee', color: 'bg-green-100 text-green-800', access: 'Attendance, Leave, Payslips, Helpdesk' },
  gate_admin: { label: 'Gate Administrator', color: 'bg-blue-100 text-blue-800', access: 'Gate pass management — mark employee out/in' },
};

const employmentStatusColors = {
  probation: 'bg-yellow-100 text-yellow-800',
  confirmation: 'bg-green-100 text-green-800',
  trainee: 'bg-blue-100 text-blue-800',
};

const tierLabels = {
  executive: 'Executive',
  senior_executive: 'Senior Executive',
  territory_manager: 'Territory Manager',
  manager: 'Manager',
  general_manager: 'General Manager',
  director: 'Director',
};

function InfoRow({ icon: Icon, label, value, badge, badgeClass }) {
  if (!value && !badge) return null;
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="p-2 bg-gray-100 rounded-lg mt-0.5">
        <Icon className="w-4 h-4 text-gray-600" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
        {badge ? (
          <Badge className={`mt-1 ${badgeClass}`}>{value}</Badge>
        ) : (
          <p className="font-medium text-gray-900 mt-0.5">{value}</p>
        )}
      </div>
    </div>
  );
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [manager, setManager] = useState(null);
  const [salaryStructure, setSalaryStructure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [formData, setFormData] = useState({
    phone: '',
    address: '',
    emergency_contact: { name: '', relationship: '', phone: '' }
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const empRecords = await base44.entities.Employee.filter({ user_id: currentUser.id });
      if (empRecords.length > 0) {
        const emp = empRecords[0];
        setEmployee(emp);
        setFormData({
          phone: emp.phone || '',
          address: emp.address || '',
          emergency_contact: emp.emergency_contact || { name: '', relationship: '', phone: '' }
        });

        if (emp.reporting_manager_id) {
          const allUsers = await base44.entities.User.list();
          const mgr = allUsers.find(u => u.id === emp.reporting_manager_id);
          setManager(mgr || null);
        }

        // Load active salary structure
        const structures = await base44.entities.SalaryStructure.filter({ user_id: currentUser.id, status: 'active' }, '-effective_from');
        if (structures.length > 0) setSalaryStructure(structures[0]);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading profile:', error);
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !employee) return;
    setUploadingPhoto(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.entities.Employee.update(employee.id, { profile_picture_url: file_url });
      setEmployee(prev => ({ ...prev, profile_picture_url: file_url }));
      toast.success('Profile picture updated!');
    } catch (err) {
      toast.error('Failed to upload photo');
    }
    setUploadingPhoto(false);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      if (employee) {
        await base44.entities.Employee.update(employee.id, formData);
      }
      toast.success('Profile updated successfully');
      setEditing(false);
      loadData();
    } catch (error) {
      toast.error('Failed to update profile');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const roleInfo = roleLabels[user?.role] || roleLabels['employee'];
  const tenure = employee?.date_of_joining
    ? (() => {
        const months = differenceInMonths(new Date(), new Date(employee.date_of_joining));
        const years = Math.floor(months / 12);
        const rem = months % 12;
        if (years > 0) return `${years}y ${rem}m`;
        return `${months} month${months !== 1 ? 's' : ''}`;
      })()
    : null;

  const nameInitial = (user?.first_name || user?.full_name || '?').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Profile</h1>
          <p className="text-gray-600 mt-1">Your employment details and personal information</p>
        </div>

        {/* Hero Card */}
        <Card className="overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-blue-600 to-indigo-700" />
          <CardContent className="relative pt-0 pb-6 px-6">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10">
              <div className="relative w-20 h-20 group">
                {employee?.profile_picture_url ? (
                  <img
                    src={employee.profile_picture_url}
                    alt={user?.full_name}
                    className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-lg"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-blue-600 border-4 border-white shadow-lg flex items-center justify-center">
                    <span className="text-white text-3xl font-bold">{nameInitial}</span>
                  </div>
                )}
                <label className="absolute inset-0 rounded-full flex items-center justify-center bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                  {uploadingPhoto ? (
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <Camera className="w-6 h-6 text-white" />
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
                </label>
              </div>
              <div className="flex-1 pb-1">
                <h2 className="text-2xl font-bold text-gray-900">{user?.full_name}</h2>
                <p className="text-gray-600">{employee?.designation || 'Employee'}</p>
                {employee?.designation_tier && (
                  <p className="text-sm text-gray-500">{tierLabels[employee.designation_tier]}</p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Badge className={roleInfo.color}>{roleInfo.label}</Badge>
                {employee?.employee_status && (
                  <Badge className={employmentStatusColors[employee.employee_status]}>
                    {employee.employee_status.charAt(0).toUpperCase() + employee.employee_status.slice(1)}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Work Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Briefcase className="w-4 h-4" /> Work Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <InfoRow icon={Mail} label="Email Address" value={user?.email} />
              {employee?.employee_code && (
                <InfoRow icon={Briefcase} label="Employee Code" value={employee.employee_code} />
              )}
              {employee?.department && (
                <InfoRow icon={Building2} label="Department" value={employee.department} />
              )}
              {employee?.designation && (
                <InfoRow icon={UserCheck} label="Designation" value={employee.designation} />
              )}
              {employee?.employment_type && (
                <InfoRow icon={Briefcase} label="Employment Type" value={employee.employment_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} />
              )}
              {employee?.work_location && (
                <InfoRow icon={MapPin} label="Work Location" value={employee.work_location} />
              )}
              {employee?.date_of_joining && (
                <InfoRow
                  icon={Calendar}
                  label="Date of Joining"
                  value={`${format(new Date(employee.date_of_joining), 'MMM d, yyyy')}${tenure ? ` · ${tenure} tenure` : ''}`}
                />
              )}
              {employee?.employee_confirmation_date && (
                <InfoRow
                  icon={Calendar}
                  label="Confirmation Date"
                  value={format(new Date(employee.employee_confirmation_date), 'MMM d, yyyy')}
                />
              )}
            </CardContent>
          </Card>

          {/* Role & Access */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="w-4 h-4" /> Role &amp; Access Level
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="py-3 border-b">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">System Role</p>
                <Badge className={`${roleInfo.color} text-sm px-3 py-1`}>{roleInfo.label}</Badge>
              </div>
              <div className="py-3 border-b">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Access Permissions</p>
                <p className="text-sm text-gray-700">{roleInfo.access}</p>
              </div>
              {employee?.employee_status && (
                <div className="py-3 border-b">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Employment Status</p>
                  <Badge className={employmentStatusColors[employee.employee_status]}>
                    {employee.employee_status.charAt(0).toUpperCase() + employee.employee_status.slice(1)}
                  </Badge>
                </div>
              )}
              {manager && (
                <div className="py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Reporting Manager</p>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-indigo-600 font-semibold text-sm">{manager.full_name?.charAt(0)}</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{manager.full_name}</p>
                      <p className="text-xs text-gray-500">{manager.email}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Personal Information */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="w-4 h-4" /> Personal Information
                </CardTitle>
                <Button onClick={() => setEditing(!editing)} variant="outline" size="sm">
                  {editing ? <><X className="w-3 h-3 mr-1" />Cancel</> : <><Edit2 className="w-3 h-3 mr-1" />Edit</>}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {editing ? (
                <form onSubmit={handleUpdate} className="space-y-4">
                  <div>
                    <Label>Phone Number</Label>
                    <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="Enter phone number" />
                  </div>
                  <div>
                    <Label>Address</Label>
                    <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Enter address" />
                  </div>
                  <div>
                    <Label>Emergency Contact</Label>
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      <Input value={formData.emergency_contact.name} onChange={(e) => setFormData({ ...formData, emergency_contact: { ...formData.emergency_contact, name: e.target.value } })} placeholder="Name" />
                      <Input value={formData.emergency_contact.relationship} onChange={(e) => setFormData({ ...formData, emergency_contact: { ...formData.emergency_contact, relationship: e.target.value } })} placeholder="Relation" />
                      <Input value={formData.emergency_contact.phone} onChange={(e) => setFormData({ ...formData, emergency_contact: { ...formData.emergency_contact, phone: e.target.value } })} placeholder="Phone" />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button type="submit" size="sm"><Save className="w-3 h-3 mr-1" />Save</Button>
                  </div>
                </form>
              ) : (
                <>
                  <InfoRow icon={Phone} label="Phone" value={employee?.phone || 'Not provided'} />
                  {employee?.date_of_birth && (
                    <InfoRow icon={Calendar} label="Date of Birth" value={format(new Date(employee.date_of_birth), 'MMM d, yyyy')} />
                  )}
                  <InfoRow icon={MapPin} label="Address" value={employee?.address || 'Not provided'} />
                  {employee?.emergency_contact?.name && (
                    <InfoRow
                      icon={AlertTriangle}
                      label="Emergency Contact"
                      value={`${employee.emergency_contact.name}${employee.emergency_contact.relationship ? ` (${employee.emergency_contact.relationship})` : ''} · ${employee.emergency_contact.phone || ''}`}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Identity Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="w-4 h-4" /> Identity &amp; Banking
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <InfoRow
                icon={CreditCard}
                label="PAN Number"
                value={employee?.pan_number ? `${employee.pan_number.slice(0, 3)}${'*'.repeat(4)}${employee.pan_number.slice(-3)}` : 'Not on file'}
              />
              <InfoRow
                icon={CreditCard}
                label="Aadhar Number"
                value={employee?.aadhar_number ? `****-****-${employee.aadhar_number.slice(-4)}` : 'Not on file'}
              />
              {employee?.bank_account?.bank_name && (
                <InfoRow icon={CreditCard} label="Bank" value={`${employee.bank_account.bank_name} · ${employee.bank_account.branch || ''}`} />
              )}
              {employee?.bank_account?.account_number && (
                <InfoRow
                  icon={CreditCard}
                  label="Account Number"
                  value={`**** **** ${employee.bank_account.account_number.slice(-4)}`}
                />
              )}
                      {employee?.bank_account?.ifsc_code && (
                <InfoRow icon={CreditCard} label="IFSC Code" value={employee.bank_account.ifsc_code} />
              )}
              {employee?.uan_number && (
                <InfoRow icon={CreditCard} label="UAN Number" value={employee.uan_number} />
              )}
              {employee?.pf_account_number && (
                <InfoRow icon={CreditCard} label="PF Account Number" value={employee.pf_account_number} />
              )}
              {!employee?.bank_account?.bank_name && !employee?.pan_number && !employee?.aadhar_number && (
                <p className="text-sm text-gray-400 py-4 text-center">No identity/banking records on file. Contact HR to update.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Health & Personal Details */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Heart className="w-4 h-4" /> Health &amp; Additional Info
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {employee?.blood_group && (
                <InfoRow icon={Heart} label="Blood Group" value={employee.blood_group} />
              )}
              {employee?.personal_email && (
                <InfoRow icon={Mail} label="Personal Email" value={employee.personal_email} />
              )}
              <div className="flex items-start gap-3 py-3 border-b last:border-0">
                <div className="p-2 bg-gray-100 rounded-lg mt-0.5">
                  <ShieldCheck className="w-4 h-4 text-gray-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">ESI Applicable</p>
                  <p className="font-medium text-gray-900 mt-0.5">
                    {employee?.is_esi_applicable ? '✅ Yes' : '❌ No'}
                  </p>
                </div>
              </div>
              {employee?.pf_nominee?.name && (
                <InfoRow
                  icon={User}
                  label="PF Nominee"
                  value={`${employee.pf_nominee.name} (${employee.pf_nominee.relationship || ''}) · ${employee.pf_nominee.share_percentage || 100}%`}
                />
              )}
            </CardContent>
          </Card>

          {/* Insurance Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="w-4 h-4" /> Insurance Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {employee?.insurance?.has_insurance ? (
                <>
                  {employee.insurance.insurance_type && (
                    <InfoRow icon={Shield} label="Insurance Type" value={employee.insurance.insurance_type} />
                  )}
                  {employee.insurance.insurer_name && (
                    <InfoRow icon={Shield} label="Insurer" value={employee.insurance.insurer_name} />
                  )}
                  {employee.insurance.policy_number && (
                    <InfoRow icon={CreditCard} label="Policy Number" value={employee.insurance.policy_number} />
                  )}
                  {employee.insurance.sum_insured && (
                    <InfoRow icon={CreditCard} label="Sum Insured" value={`₹${Number(employee.insurance.sum_insured).toLocaleString('en-IN')}`} />
                  )}
                  {employee.insurance.validity_date && (
                    <InfoRow icon={Calendar} label="Valid Until" value={format(new Date(employee.insurance.validity_date), 'MMM d, yyyy')} />
                  )}
                  {employee.insurance.nominee_name && (
                    <InfoRow
                      icon={User}
                      label="Insurance Nominee"
                      value={`${employee.insurance.nominee_name} (${employee.insurance.nominee_relationship || ''})`}
                    />
                  )}
                  {employee.insurance.card_url && (
                    <div className="flex items-start gap-3 py-3">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <ExternalLink className="w-4 h-4 text-gray-600" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Insurance Card</p>
                        <a href={employee.insurance.card_url} target="_blank" rel="noreferrer" className="text-blue-600 text-sm hover:underline">View Document</a>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-400 py-4 text-center">No insurance declared</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Salary Breakdown */}
        {salaryStructure && (
          <SalaryBreakdownCard
            structure={salaryStructure}
            employee={employee}
          />
        )}

        {/* Danger Zone */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-700">
              <Trash2 className="w-4 h-4" /> Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-red-200 rounded-lg bg-red-50">
              <div>
                <p className="font-medium text-red-800">Delete Account</p>
                <p className="text-sm text-red-600 mt-0.5">Permanently remove your account and all associated data. This action cannot be undone.</p>
              </div>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="shrink-0 px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Delete Account
              </button>
            </div>
          </CardContent>
        </Card>

        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-700 flex items-center gap-2">
                <Trash2 className="w-5 h-5" /> Confirm Account Deletion
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-gray-700">Are you sure you want to delete your account? This is a permanent action and cannot be reversed.</p>
              <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">To proceed, please contact your HR administrator or raise a Helpdesk ticket requesting account deletion.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 rounded-md border text-sm font-medium hover:bg-gray-50">Cancel</button>
                <button
                  onClick={() => { setShowDeleteDialog(false); toast.info('Please contact HR to complete account deletion.'); }}
                  className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                >
                  I Understand, Contact HR
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}