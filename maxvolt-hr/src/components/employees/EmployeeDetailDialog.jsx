import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { User, Mail, Phone, Briefcase, Calendar, MapPin, Shield, Users, CreditCard, Building2, Heart, ShieldCheck } from 'lucide-react';

const Field = ({ label, value, colSpan }) => (
  <div className={colSpan ? 'col-span-2' : ''}>
    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
    <p className="text-sm font-medium text-gray-800 mt-0.5">{value || <span className="text-gray-400">—</span>}</p>
  </div>
);

const Section = ({ title, icon: Icon, children }) => (
  <div className="border rounded-lg p-4 space-y-3">
    <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
      <Icon className="w-4 h-4 text-blue-600" />
      {title}
    </h3>
    <div className="grid grid-cols-2 gap-3">
      {children}
    </div>
  </div>
);

const statusColors = {
  probation: 'bg-orange-100 text-orange-800',
  confirmation: 'bg-green-100 text-green-800',
  trainee: 'bg-blue-100 text-blue-800',
};

export default function EmployeeDetailDialog({ employee, onClose }) {
  const [managerName, setManagerName] = useState('');
  const [shiftName, setShiftName] = useState('');

  useEffect(() => {
    if (!employee) return;
    const fetchExtra = async () => {
      if (employee.reporting_manager_id) {
        const allUsers = await base44.functions.invoke('getAllUsers', {});
        const mgr = allUsers.data.users.find(u => u.id === employee.reporting_manager_id);
        if (mgr) setManagerName(mgr.display_name || mgr.full_name);
      }
      if (employee.shift_id) {
        const shifts = await base44.entities.Shift.filter({ id: employee.shift_id });
        if (shifts.length > 0) setShiftName(shifts[0].name);
      }
    };
    fetchExtra();
  }, [employee]);

  if (!employee) return null;

  const emp = employee;
  const user = emp.user || {};
  const displayName = user.display_name || user.full_name;

  return (
    <Dialog open={!!employee} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-600 font-bold text-xl">{displayName?.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p className="text-lg font-bold">{displayName}</p>
              <p className="text-sm text-gray-500 font-normal">{emp.designation} · {emp.department}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Badges */}
          <div className="flex gap-2 flex-wrap">
            {emp.employee_status && (
              <Badge className={statusColors[emp.employee_status] || 'bg-gray-100 text-gray-800'}>
                {emp.employee_status?.replace('_', ' ').toUpperCase()}
              </Badge>
            )}
            {emp.employment_type && (
              <Badge variant="outline" className="capitalize">
                {emp.employment_type?.replace('_', ' ')}
              </Badge>
            )}
            {emp.blood_group && (
              <Badge className="bg-red-100 text-red-800">
                🩸 {emp.blood_group}
              </Badge>
            )}
            {emp.is_esi_applicable !== undefined && (
              <Badge className={emp.is_esi_applicable ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                ESI: {emp.is_esi_applicable ? `Applicable${emp.esi_number ? ` · ${emp.esi_number}` : ''}` : 'Not Applicable'}
              </Badge>
            )}
            {emp.insurance_policies?.length > 0 && (
              <Badge className="bg-blue-100 text-blue-800">
                🛡️ {emp.insurance_policies.length} Insurance {emp.insurance_policies.length === 1 ? 'Policy' : 'Policies'}
              </Badge>
            )}
          </div>

          <Section title="Personal Information" icon={User}>
            <Field label="Full Name" value={displayName} />
            <Field label="Employee ID" value={emp.employee_code} />
            <Field label="Date of Birth" value={emp.date_of_birth ? format(new Date(emp.date_of_birth), 'dd MMM yyyy') : null} />
            <Field label="Gender" value={emp.gender ? emp.gender.charAt(0).toUpperCase() + emp.gender.slice(1) : null} />
            <Field label="Father / Spouse Name" value={emp.father_spouse_name} />
            <Field label="Aadhaar Number" value={emp.aadhar_number} />
            <Field label="Address" value={emp.address} colSpan />
          </Section>

          <Section title="Contact Details" icon={Phone}>
            <Field label="Email" value={user.email} />
            <Field label="Phone" value={emp.phone} />
            <Field label="Personal Email" value={emp.personal_email} />
          </Section>

          <Section title="Employment Details" icon={Briefcase}>
            <Field label="Designation" value={emp.designation} />
            <Field label="Department" value={emp.department} />
            <Field label="Date of Joining" value={emp.date_of_joining ? format(new Date(emp.date_of_joining), 'dd MMM yyyy') : null} />
            <Field label="Status" value={emp.employee_status ? emp.employee_status.charAt(0).toUpperCase() + emp.employee_status.slice(1) : null} />
            <Field label="Work Location" value={emp.work_location} />
            <Field label="Shift" value={shiftName} />
            <Field label="Reporting Manager" value={managerName} />
          </Section>

          <Section title="Emergency Contact" icon={Users}>
            <Field label="Name" value={emp.emergency_contact?.name} />
            <Field label="Phone" value={emp.emergency_contact?.phone} />
            <Field label="Relationship" value={emp.emergency_contact?.relationship} />
            <Field label="Address" value={emp.emergency_contact?.address} colSpan />
          </Section>

          <Section title="Statutory & Financial" icon={CreditCard}>
            <Field label="PAN Number" value={emp.pan_number} />
            <Field label="Aadhaar Number" value={emp.aadhar_number} />
            <Field label="UAN Number" value={emp.uan_number} />
            <Field label="PF Account Number" value={emp.pf_account_number} />
            {emp.pf_nominee?.name && (
              <Field label="PF Nominee" value={`${emp.pf_nominee.name} (${emp.pf_nominee.relationship || ''}) · ${emp.pf_nominee.share_percentage || 100}%`} colSpan />
            )}
          </Section>

          {/* ESI & Health */}
          {(emp.is_esi_applicable || emp.health_report_url) && (
            <Section title="ESI & Health" icon={Heart}>
              {emp.is_esi_applicable && <Field label="ESI Applicable" value="Yes" />}
              {emp.esi_number && <Field label="ESI Number" value={emp.esi_number} />}
              {emp.health_report_url && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Health Report</p>
                  <a href={emp.health_report_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">View Document</a>
                </div>
              )}
            </Section>
          )}

          {/* Multiple insurance policies */}
          {emp.insurance_policies && emp.insurance_policies.length > 0 && (
            <div className="space-y-3">
              {emp.insurance_policies.map((pol, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
                    <Shield className="w-4 h-4 text-blue-600" />
                    Insurance Policy {i + 1}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Type" value={pol.insurance_type} />
                    <Field label="Insurer" value={pol.insurer_name} />
                    <Field label="Policy No." value={pol.policy_number} />
                    <Field label="Sum Insured" value={pol.sum_insured ? `₹${Number(pol.sum_insured).toLocaleString('en-IN')}` : null} />
                    <Field label="Valid Until" value={pol.validity_date ? format(new Date(pol.validity_date), 'dd MMM yyyy') : null} />
                    <Field label="Nominee" value={pol.nominee_name ? `${pol.nominee_name} (${pol.nominee_relationship || ''})` : null} />
                    {pol.card_url && (
                      <div className="col-span-2">
                        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Policy Document</p>
                        <a href={pol.card_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">View Document</a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Legacy single insurance fallback */}
          {!emp.insurance_policies?.length && emp.insurance?.has_insurance && (
            <Section title="Insurance Details" icon={Shield}>
              <Field label="Type" value={emp.insurance.insurance_type} />
              <Field label="Insurer" value={emp.insurance.insurer_name} />
              <Field label="Policy No." value={emp.insurance.policy_number} />
              <Field label="Sum Insured" value={emp.insurance.sum_insured ? `₹${Number(emp.insurance.sum_insured).toLocaleString('en-IN')}` : null} />
              <Field label="Valid Until" value={emp.insurance.validity_date ? format(new Date(emp.insurance.validity_date), 'dd MMM yyyy') : null} />
              <Field label="Nominee" value={emp.insurance.nominee_name ? `${emp.insurance.nominee_name} (${emp.insurance.nominee_relationship || ''})` : null} />
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}