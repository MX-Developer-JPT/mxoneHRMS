import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import {
  ArrowLeft, User, Building2, Calendar, FileText, Clock, DollarSign,
  Package, Star, LogOut, ShieldCheck, Loader2, RotateCcw, Eye, Download,
} from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';
import { deriveOverallExitStatus, OVERALL_STATUS_COLORS } from '@/lib/exitStatus';
import EmployeeDetailDialog from '../components/employees/EmployeeDetailDialog';
import ExitDetailPanel from '../components/exit/ExitDetailPanel';

const TABS = [
  { key: 'attendance', label: 'Attendance', icon: Clock },
  { key: 'leave',      label: 'Leave',      icon: Calendar },
  { key: 'payroll',    label: 'Payroll',    icon: DollarSign },
  { key: 'performance',label: 'Performance',icon: Star },
  { key: 'assets',     label: 'Assets',     icon: Package },
  { key: 'documents',  label: 'Documents',  icon: FileText },
  { key: 'audit',      label: 'Audit Log',  icon: ShieldCheck },
];

// A read-only "viewer" identity — passing this as currentUser to
// EmployeeDetailDialog/ExitDetailPanel naturally suppresses every action
// button in those components (all their approve/edit/generate gates check
// currentUser's role/id), without needing a dedicated readOnly prop on
// either — both components are otherwise reused completely as-is.
const READONLY_VIEWER = {};

export default function LeftEmployeeProfile() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const userId = params.get('user_id');

  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState(null);
  const [exitRecord, setExitRecord] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [leave, setLeave] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [assets, setAssets] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activeTab, setActiveTab] = useState('attendance');
  const [showProfile, setShowProfile] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => { if (userId) load(); }, [userId]);

  const load = async () => {
    setLoading(true);
    try {
      const [empRows, usersRes, exits, att, lv, pay, perf, asst, docs] = await Promise.all([
        base44.entities.Employee.filter({ user_id: userId }),
        base44.functions.invoke('getAllUsers', {}),
        base44.entities.Exit.filter({ user_id: userId }),
        base44.entities.Attendance.filter({ user_id: userId }, '-date', 500).catch(() => []),
        base44.entities.Leave.filter({ user_id: userId }, '-created_date', 200).catch(() => []),
        base44.entities.Payroll.filter({ user_id: userId }, '-year', 100).catch(() => []),
        base44.entities.PerformanceReview.filter({ user_id: userId }).catch(() => []),
        base44.entities.Asset.filter({ assigned_to_user_id: userId }).catch(() => []),
        base44.entities.Document.filter({ user_id: userId }).catch(() => []),
      ]);
      const users = usersRes?.data?.users || usersRes?.users || [];
      const user = users.find(u => u.id === userId);
      const emp = empRows?.[0];
      setEmployee(emp ? { ...emp, user } : null);
      const ex = (exits || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
      setExitRecord(ex || null);
      setAttendance(att || []);
      setLeave(lv || []);
      setPayroll(pay || []);
      setPerformance(perf || []);
      setAssets(asst || []);
      setDocuments(docs || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleRestore = async () => {
    if (!window.confirm(`Reactivate ${employee?.user?.full_name}'s profile? Their status will be set back to Active.`)) return;
    setRestoring(true);
    try {
      const res = await base44.functions.invoke('restoreLeftEmployee', { user_id: userId });
      const d = res?.data || res;
      if (d?.success) { toast.success(`${d.employee_name || 'Employee'} reactivated`); navigate('/Employees'); }
      else toast.error(d?.error || 'Restore failed');
    } catch (e) { toast.error(e.message); }
    setRestoring(false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!employee) return (
    <div className="p-6 text-center text-gray-400">
      <p>Employee record not found.</p>
      <Button variant="outline" className="mt-3" onClick={() => navigate('/LeftEmployees')}><ArrowLeft className="w-4 h-4 mr-1.5" />Back to Left Employees</Button>
    </div>
  );

  const overall = exitRecord ? deriveOverallExitStatus(exitRecord) : null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/LeftEmployees')}><ArrowLeft className="w-4 h-4 mr-1.5" />Back to Left Employees</Button>

      <Card>
        <CardContent className="p-5 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-500">
              {(employee.user?.full_name || '?')[0]}
            </div>
            <div>
              <h1 className="text-xl font-bold">{employee.user?.full_name}</h1>
              <p className="text-sm text-gray-500">{employee.designation} · {employee.department} · {employee.employee_code}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-gray-200 text-gray-700 capitalize">{employee.status}</Badge>
                {overall && <Badge className={OVERALL_STATUS_COLORS[overall] || 'bg-gray-100 text-gray-600'}>{overall}</Badge>}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setShowProfile(true)}><Eye className="w-3.5 h-3.5 mr-1.5" />View Full Profile</Button>
            {exitRecord && <Button variant="outline" size="sm" onClick={() => setShowExit(true)}><LogOut className="w-3.5 h-3.5 mr-1.5" />Exit / Clearance / F&F</Button>}
            <Button variant="outline" size="sm" disabled={restoring} onClick={handleRestore}>
              {restoring ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}Restore / Rehire
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div className="bg-white border rounded-lg p-3"><p className="text-xs text-gray-400">Date of Joining</p><p className="font-medium">{employee.date_of_joining ? safeDate(employee.date_of_joining, 'dd MMM yyyy') : '—'}</p></div>
        <div className="bg-white border rounded-lg p-3"><p className="text-xs text-gray-400">Resignation Date</p><p className="font-medium">{exitRecord?.resignation_date ? safeDate(exitRecord.resignation_date, 'dd MMM yyyy') : '—'}</p></div>
        <div className="bg-white border rounded-lg p-3"><p className="text-xs text-gray-400">Last Working Day</p><p className="font-medium">{(exitRecord?.last_working_date || employee.exit_date) ? safeDate(exitRecord?.last_working_date || employee.exit_date, 'dd MMM yyyy') : '—'}</p></div>
        <div className="bg-white border rounded-lg p-3"><p className="text-xs text-gray-400">Reporting Manager</p><p className="font-medium">{employee.reporting_manager_name || '—'}</p></div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex overflow-x-auto border-b">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} className={`flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap border-b-2 ${activeTab === t.key ? 'border-red-600 text-red-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <t.icon className="w-3.5 h-3.5" />{t.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {activeTab === 'attendance' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 uppercase"><tr><th className="text-left py-1.5">Date</th><th className="text-left py-1.5">Status</th><th className="text-left py-1.5">Check In</th><th className="text-left py-1.5">Check Out</th></tr></thead>
                  <tbody className="divide-y">
                    {attendance.slice(0, 100).map(a => (
                      <tr key={a.id}><td className="py-1.5">{a.date}</td><td className="py-1.5 capitalize">{a.status}</td><td className="py-1.5">{a.check_in_time || '—'}</td><td className="py-1.5">{a.check_out_time || '—'}</td></tr>
                    ))}
                    {!attendance.length && <tr><td colSpan={4} className="py-8 text-center text-gray-400">No attendance records</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'leave' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 uppercase"><tr><th className="text-left py-1.5">Type</th><th className="text-left py-1.5">From</th><th className="text-left py-1.5">To</th><th className="text-left py-1.5">Status</th></tr></thead>
                  <tbody className="divide-y">
                    {leave.map(l => (
                      <tr key={l.id}><td className="py-1.5 capitalize">{l.leave_type}</td><td className="py-1.5">{l.start_date}</td><td className="py-1.5">{l.end_date}</td><td className="py-1.5 capitalize">{l.status}</td></tr>
                    ))}
                    {!leave.length && <tr><td colSpan={4} className="py-8 text-center text-gray-400">No leave records</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'payroll' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 uppercase"><tr><th className="text-left py-1.5">Month/Year</th><th className="text-left py-1.5">Gross</th><th className="text-left py-1.5">Net Pay</th><th className="text-left py-1.5">Status</th></tr></thead>
                  <tbody className="divide-y">
                    {payroll.map(p => (
                      <tr key={p.id}><td className="py-1.5">{p.month}/{p.year}</td><td className="py-1.5">₹{Number(p.gross_salary || 0).toLocaleString('en-IN')}</td><td className="py-1.5">₹{Number(p.net_salary || 0).toLocaleString('en-IN')}</td><td className="py-1.5 capitalize">{p.status}</td></tr>
                    ))}
                    {!payroll.length && <tr><td colSpan={4} className="py-8 text-center text-gray-400">No payroll records</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="space-y-2">
                {performance.map(p => (
                  <div key={p.id} className="border rounded-lg p-3 text-sm flex items-center justify-between">
                    <span>{p.review_period || p.cycle_name || 'Review'}</span>
                    <Badge className="bg-gray-100 text-gray-700 capitalize">{p.status}</Badge>
                  </div>
                ))}
                {!performance.length && <p className="py-8 text-center text-gray-400 text-sm">No performance records</p>}
              </div>
            )}

            {activeTab === 'assets' && (
              <div className="space-y-2">
                {assets.map(a => (
                  <div key={a.id} className="border rounded-lg p-3 text-sm flex items-center justify-between">
                    <div><p className="font-medium">{a.name}</p><p className="text-xs text-gray-400">{a.serial_no || '—'}</p></div>
                    <Badge className="bg-gray-100 text-gray-700 capitalize">{a.status}</Badge>
                  </div>
                ))}
                {!assets.length && <p className="py-8 text-center text-gray-400 text-sm">No asset records</p>}
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-2">
                {documents.map(d => (
                  <div key={d.id} className="border rounded-lg p-3 text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-gray-400" />{d.document_name || d.document_type}</span>
                    {d.document_url && <a href={d.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 text-xs"><Download className="w-3 h-3" />Download</a>}
                  </div>
                ))}
                {!documents.length && <p className="py-8 text-center text-gray-400 text-sm">No documents on file</p>}
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="space-y-2">
                {(exitRecord?.audit_log || []).slice().reverse().map((a, i) => (
                  <div key={i} className="border-l-2 border-gray-200 pl-3 py-1 text-sm">
                    <p className="font-medium">{a.action}</p>
                    <p className="text-xs text-gray-400">{a.actor_name} · {a.timestamp ? safeDate(a.timestamp, 'dd MMM yyyy, hh:mm a') : ''}</p>
                    {a.comment && <p className="text-xs text-gray-600 mt-0.5">{a.comment}</p>}
                  </div>
                ))}
                {!(exitRecord?.audit_log || []).length && <p className="py-8 text-center text-gray-400 text-sm">No audit trail available</p>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {showProfile && <EmployeeDetailDialog employee={employee} onClose={() => setShowProfile(false)} />}
      {showExit && exitRecord && (
        <ExitDetailPanel exitRecord={exitRecord} currentUser={READONLY_VIEWER} onClose={() => setShowExit(false)} onRefresh={load} />
      )}
    </div>
  );
}
