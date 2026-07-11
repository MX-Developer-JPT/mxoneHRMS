import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import { User, Mail, Phone, Briefcase, Calendar, MapPin, Shield, Users, CreditCard, Building2, Heart, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';

const Field = ({ label, value, colSpan }) => (
  <div className={`min-w-0 ${colSpan ? 'col-span-2' : ''}`}>
    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
    <p className="text-sm font-medium text-gray-800 mt-0.5 break-words">{value || <span className="text-gray-400">—</span>}</p>
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

const ATT_COLORS = {
  present:       { bg: 'bg-green-500',  text: 'text-white',      label: 'P' },
  late:          { bg: 'bg-yellow-400', text: 'text-white',      label: 'L' },
  on_duty:       { bg: 'bg-blue-400',   text: 'text-white',      label: 'OD' },
  work_from_home:{ bg: 'bg-cyan-400',   text: 'text-white',      label: 'WFH' },
  half_day:      { bg: 'bg-amber-300',  text: 'text-gray-800',   label: 'HD' },
  absent:        { bg: 'bg-red-500',    text: 'text-white',      label: 'A' },
  lop:           { bg: 'bg-red-700',    text: 'text-white',      label: 'LOP' },
  week_off:      { bg: 'bg-gray-200',   text: 'text-gray-500',   label: 'WO' },
  holiday:       { bg: 'bg-purple-200', text: 'text-purple-800', label: 'H' },
  leave:         { bg: 'bg-indigo-300', text: 'text-white',      label: 'LV' },
  approved_leave:{ bg: 'bg-indigo-400', text: 'text-white',      label: 'AL' },
  sunday:        { bg: 'bg-gray-100',   text: 'text-gray-400',   label: 'S' },
  no_record:     { bg: 'bg-gray-50',    text: 'text-gray-300',   label: '' },
};

function fmtDate(y, m, d) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function AttendanceCalendar({ userId }) {
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(false);

  const loadAttendance = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const startDate = fmtDate(calYear, calMonth, 1);
      const endDate   = fmtDate(calYear, calMonth, new Date(calYear, calMonth, 0).getDate());
      const recs = await base44.entities.Attendance.filter({ user_id: userId });
      const byDate = {};
      for (const r of recs) {
        if (r.date >= startDate && r.date <= endDate) byDate[r.date] = r;
      }
      setRecords(byDate);
    } catch (e) {
      console.error('Failed to load attendance:', e);
    }
    setLoading(false);
  }, [userId, calYear, calMonth]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  const navigate = (delta) => {
    const d = new Date(calYear, calMonth - 1 + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth() + 1);
  };

  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const firstDow = new Date(calYear, calMonth - 1, 1).getDay(); // 0=Sun
  const monthName = new Date(calYear, calMonth - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Tally summary
  let present = 0, absent = 0, halfDay = 0, lop = 0, leave = 0, other = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(calYear, calMonth, d);
    const dow = new Date(calYear, calMonth - 1, d).getDay();
    if (dow === 0) continue;
    const r = records[ds];
    if (!r) { absent++; continue; }
    const s = r.status;
    if (['present','late','on_duty','work_from_home'].includes(s)) present++;
    else if (s === 'half_day') halfDay++;
    else if (['absent','lop'].includes(s)) { absent++; if (s === 'lop') lop++; }
    else if (['leave','approved_leave'].includes(s)) leave++;
    else if (!s && r.check_in_time) present++;
    else other++;
  }

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="font-semibold text-gray-700">{monthName}</span>
        <Button variant="ghost" size="sm" onClick={() => navigate(1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 font-medium">Present: {present}</span>
        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">Half Day: {halfDay}</span>
        <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-medium">Absent: {absent}</span>
        {lop > 0 && <span className="px-2 py-0.5 rounded bg-red-200 text-red-900 font-medium">LOP: {lop}</span>}
        {leave > 0 && <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-medium">Leave: {leave}</span>}
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 text-center">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-xs font-semibold text-gray-500 py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="text-center text-sm text-gray-400 py-8">Loading attendance…</div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {/* Empty leading cells */}
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}

          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const ds  = fmtDate(calYear, calMonth, day);
            const dow = new Date(calYear, calMonth - 1, day).getDay();
            const isSun = dow === 0;
            const rec  = records[ds];
            let style  = ATT_COLORS.no_record;

            if (isSun) {
              style = ATT_COLORS.sunday;
            } else if (rec) {
              const s = rec.status;
              if (ATT_COLORS[s]) style = ATT_COLORS[s];
              else if (!s && rec.check_in_time) style = ATT_COLORS.present;
            }

            const today = fmtDate(now.getFullYear(), now.getMonth()+1, now.getDate());
            const isToday = ds === today;

            return (
              <div
                key={ds}
                title={rec?.status ? rec.status.replace(/_/g,' ') : (isSun ? 'Sunday' : 'No record')}
                className={`rounded-lg aspect-square flex flex-col items-center justify-center text-center cursor-default ${style.bg} ${style.text} ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
              >
                <span className="text-xs font-bold leading-none">{day}</span>
                {style.label && <span className="text-[9px] leading-tight mt-0.5 opacity-90">{style.label}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500 pt-1 border-t">
        {Object.entries(ATT_COLORS).filter(([k]) => k !== 'no_record').map(([key, s]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded ${s.bg} inline-block`} />
            {s.label || key.replace(/_/g,' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              {emp.blood_group}
            </Badge>
          )}
          {emp.is_esi_applicable !== undefined && (
            <Badge className={emp.is_esi_applicable ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
              ESI: {emp.is_esi_applicable ? `Applicable${emp.esi_number ? ` · ${emp.esi_number}` : ''}` : 'Not Applicable'}
            </Badge>
          )}
          {emp.insurance_policies?.length > 0 && (
            <Badge className="bg-blue-100 text-blue-800">
              {emp.insurance_policies.length} Insurance {emp.insurance_policies.length === 1 ? 'Policy' : 'Policies'}
            </Badge>
          )}
        </div>

        <Tabs defaultValue="info" className="mt-1">
          <TabsList className="w-full">
            <TabsTrigger value="info" className="flex-1">Profile</TabsTrigger>
            <TabsTrigger value="attendance" className="flex-1">Attendance</TabsTrigger>
          </TabsList>

          {/* ── Profile tab ── */}
          <TabsContent value="info" className="space-y-4 mt-3">
            <Section title="Personal Information" icon={User}>
              <Field label="Full Name" value={displayName} />
              <Field label="Employee ID" value={emp.employee_code} />
              <Field label="Date of Birth" value={emp.date_of_birth ? safeDate(emp.date_of_birth, 'dd MMM yyyy') : null} />
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
              <Field label="Date of Joining" value={emp.date_of_joining ? safeDate(emp.date_of_joining, 'dd MMM yyyy') : null} />
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
                      <Field label="Valid Until" value={pol.validity_date ? safeDate(pol.validity_date, 'dd MMM yyyy') : null} />
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

            {!emp.insurance_policies?.length && emp.insurance?.has_insurance && (
              <Section title="Insurance Details" icon={Shield}>
                <Field label="Type" value={emp.insurance.insurance_type} />
                <Field label="Insurer" value={emp.insurance.insurer_name} />
                <Field label="Policy No." value={emp.insurance.policy_number} />
                <Field label="Sum Insured" value={emp.insurance.sum_insured ? `₹${Number(emp.insurance.sum_insured).toLocaleString('en-IN')}` : null} />
                <Field label="Valid Until" value={emp.insurance.validity_date ? safeDate(emp.insurance.validity_date, 'dd MMM yyyy') : null} />
                <Field label="Nominee" value={emp.insurance.nominee_name ? `${emp.insurance.nominee_name} (${emp.insurance.nominee_relationship || ''})` : null} />
              </Section>
            )}
          </TabsContent>

          {/* ── Attendance tab ── */}
          <TabsContent value="attendance" className="mt-3">
            <AttendanceCalendar userId={emp.user_id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
