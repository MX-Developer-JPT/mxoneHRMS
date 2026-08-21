import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { format, differenceInCalendarDays } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import {
  CheckCircle2, XCircle, AlertCircle, ClipboardList, DollarSign, FileText, User,
  Clock, CalendarClock, CalendarX, Star, Save, Plus, Trash2, Package,
  Laptop, Phone, CreditCard, Key, Headphones, Monitor, Printer as PrintIcon,
  RotateCcw, ChevronRight, BookOpen, ShieldCheck, Activity, Info, Loader2,
  Send, Edit3
} from 'lucide-react';
import { openLetterheadPrintWindow } from '@/utils/letterhead';
import { isDirectReport } from '@/lib/hierarchy';

/* ── helpers ─────────────────────────────────────── */
const STATUS_CONFIG = {
  draft:                  { label: 'Draft',              color: 'bg-gray-100 text-gray-700' },
  submitted:              { label: 'Submitted',          color: 'bg-blue-100 text-blue-800' },
  manager_approved:       { label: 'Mgr Approved',       color: 'bg-yellow-100 text-yellow-800' },
  manager_rejected:       { label: 'Mgr Rejected',       color: 'bg-red-100 text-red-800' },
  hr_approved:            { label: 'HR Approved',        color: 'bg-green-100 text-green-800' },
  hr_rejected:            { label: 'HR Rejected',        color: 'bg-red-100 text-red-800' },
  in_notice:              { label: 'In Notice',          color: 'bg-orange-100 text-orange-800' },
  buyout_pending:         { label: 'Buyout Pending',     color: 'bg-amber-100 text-amber-800' },
  clearance_pending:      { label: 'Clearance',          color: 'bg-purple-100 text-purple-800' },
  clearance_done:         { label: 'Clearance Done',     color: 'bg-teal-100 text-teal-800' },
  fnf_prepared:           { label: 'F&F Prepared',       color: 'bg-indigo-100 text-indigo-800' },
  fnf_verified:           { label: 'F&F Verified',       color: 'bg-indigo-100 text-indigo-800' },
  fnf_hr_approved:        { label: 'F&F HR Approved',    color: 'bg-indigo-200 text-indigo-900' },
  fnf_finance_processed:  { label: 'F&F Processed',      color: 'bg-blue-200 text-blue-900' },
  fnf_employee_accepted:  { label: 'F&F Accepted',       color: 'bg-teal-200 text-teal-900' },
  fnf_pending:            { label: 'F&F Pending',        color: 'bg-indigo-100 text-indigo-800' },
  completed:              { label: 'Relieved',           color: 'bg-green-200 text-green-900' },
  withdrawn:              { label: 'Withdrawn',          color: 'bg-gray-200 text-gray-700' },
  cancelled:              { label: 'Cancelled',          color: 'bg-gray-100 text-gray-600' },
};

const CLEARANCE_DEPTS = [
  { key: 'hr',                  label: 'HR Department',                        icon: User },
  { key: 'finance',             label: 'Finance / Accounts',                   icon: DollarSign },
  { key: 'it',                  label: 'IT Department',                        icon: Monitor },
  { key: 'admin',               label: 'Admin/Facilities',                     icon: ClipboardList },
  { key: 'working_department',  label: 'Working Department / Reporting Mgr',   icon: Activity },
];

const DEFAULT_ASSETS = [
  'Laptop/Computer', 'ID Card/Access Card', 'Phone/Tablet', 'Other Equipment/Assets', 'SIM', 'Data/Documents',
].map((name, i) => ({ id: `asset_${i}`, name, serial_no: '', issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '' }));

const FNF_EARN_ROWS = [
  ['Basic Salary', 'basic_salary'], ['HRA', 'hra'], ['Special Allowances', 'special_allowances'],
  ['Conveyance', 'conveyance'], ['GWI', 'gwi'], ['Others', 'others'],
];
const FNF_DED_ROWS = [
  ['EPF', 'epf'], ['ESI', 'esi'], ['Medical Insurance', 'medical_insurance'], ['Tax', 'tax'],
  ['Advance', 'advance'], ['Notice Period', 'notice_period'], ['Paid Amount', 'paid_amount'],
];
const BLANK_FNF = {
  f_f_date: '', for_month: '', total_days_in_month: 30, paid_days: 0,
  earnings: Object.fromEntries(FNF_EARN_ROWS.map(([, k]) => [k, { actual: 0, earned: 0 }])),
  total_earnings_actual: 0, total_earnings_earned: 0,
  deductions: Object.fromEntries(FNF_DED_ROWS.map(([, k]) => [k, 0])),
  total_deductions: 0,
  other_earnings: { bonus: { eligibility_period: '', amount: 0 }, gratuity: { years: 0, amount: 0 }, ot: 0, others: 0 },
  net_payable: 0,
};

const BLANK_HR_INTERVIEW = {
  work_experience_rating: '', management_rating: '', culture_rating: '',
  compensation_rating: '', work_life_balance_rating: '',
  primary_reason: '', things_liked: '', things_disliked: '',
  suggestions: '', would_recommend_company: '', would_rejoin: '',
  hr_notes: '', interviewed_by: '',
};

function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }
function InfoRow({ label, value }) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg min-w-0">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-sm capitalize mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

/* ── main component ──────────────────────────────── */
export default function ExitDetailPanel({ exitRecord: initialRecord, currentUser, onClose, onRefresh }) {
  const [exit, setExit] = useState(initialRecord);
  const [activeTab, setActiveTab] = useState('overview');
  const [comment, setComment] = useState('');
  const [lwdEdit, setLwdEdit] = useState(initialRecord.last_working_date);
  const [saving, setSaving] = useState(false);
  const [hrInterview, setHrInterview] = useState(initialRecord.hr_exit_interview || { ...BLANK_HR_INTERVIEW });
  const [savingInterview, setSavingInterview] = useState(false);
  const [assets, setAssets] = useState(initialRecord.assets?.length ? initialRecord.assets : []);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [ktItems, setKtItems] = useState(initialRecord.kt_items || []);
  const [employees, setEmployees] = useState([]);
  const [fnfData, setFnfData] = useState(initialRecord.fnf_data || { ...BLANK_FNF });
  const [loadingSalary, setLoadingSalary] = useState(false);
  const [generating, setGenerating] = useState('');
  const [acceptName, setAcceptName] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  useEffect(() => {
    base44.entities.Employee.list().then(list => setEmployees(list || [])).catch(() => {});
  }, []);

  const role = currentUser?.custom_role || currentUser?.role;
  const isHR = role === 'hr' || role === 'admin';
  // A 'manager' may only act (approve/reject) on a DIRECT report's exit —
  // ExitManagement.jsx broadens the list a manager can VIEW to their whole
  // downstream hierarchy, so this check keeps indirect reports' exits
  // visible-but-read-only here.
  const canManagerAct = role === 'manager' && isDirectReport(exit.user_id, currentUser?.id, employees);
  const isManager = currentUser?.id === exit.manager_id || role === 'management' || canManagerAct;
  // Working Department clearance is always actioned by the employee's actual
  // reporting manager — every other dept is HR-gated client-side (the
  // backend independently enforces owner_user_ids/HR via canActOnExitClearance).
  const canActDept = (deptKey) => isHR || (deptKey === 'working_department' && canManagerAct);

  const addAudit = (existing, action, cmt) => ([
    ...(existing || []),
    { actor_id: currentUser.id, actor_name: currentUser.full_name, action, comment: cmt || '', timestamp: new Date().toISOString() }
  ]);

  // Non-workflow bookkeeping (assets before HR review, KT notes, HR
  // interview notes) — direct entity writes are fine here since these
  // aren't security-sensitive status transitions.
  const saveExit = async (updates) => {
    setSaving(true);
    try {
      await base44.entities.Exit.update(exit.id, updates);
      setExit(prev => ({ ...prev, ...updates }));
      onRefresh();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  // Every status-changing workflow action goes through a dedicated,
  // server-enforced backend case instead of a raw entity write — the
  // backend independently re-checks authorization for every one of these.
  const callExit = async (fnName, extra = {}, successMsg) => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke(fnName, { exit_id: exit.id, ...extra });
      const d = res?.data || res;
      if (d?.success) {
        toast.success(successMsg || 'Done');
        onRefresh();
        return d;
      }
      toast.error(d?.error || 'Action failed');
      return null;
    } catch (e) { toast.error(e.message); return null; }
    finally { setSaving(false); }
  };

  /* ── Approval Actions ── */
  const handleManagerAction = async (action) => {
    const ok = await callExit('actionExitApproval', { stage: 'manager', action, comment }, `Resignation ${action}`);
    if (ok) setComment('');
  };

  const handleHRAction = async (action) => {
    const ok = await callExit('actionExitApproval', { stage: 'hr', action, comment, last_working_date: lwdEdit }, `Resignation ${action} by HR`);
    if (ok) setComment('');
  };

  const handleWithdraw = async () => {
    if (!window.confirm('Are you sure you want to withdraw your resignation?')) return;
    await saveExit({ status: 'withdrawn', withdrawal_at: new Date().toISOString(), audit_log: addAudit(exit.audit_log, 'Resignation Withdrawn', '') });
    base44.functions.invoke('notifyExitStatusChange', { action: 'withdrawn', employee_id: exit.user_id, employee_name: exit.user?.full_name || '' }).catch(() => {});
    toast.success('Resignation withdrawn');
  };

  const handleStartClearance = async () => {
    const initAssets = assets.length ? assets : DEFAULT_ASSETS;
    await saveExit({ status: 'clearance_pending', assets: initAssets, audit_log: addAudit(exit.audit_log, 'Clearance initiated', '') });
    base44.functions.invoke('notifyExitStatusChange', { action: 'clearance_started', employee_id: exit.user_id, employee_name: exit.user?.full_name || '' }).catch(() => {});
    toast.success('Clearance process started');
  };

  const handleUpdateClearance = async (deptKey, status, remarks, checklistItems) => {
    const ok = await callExit('updateExitClearance', { dept_key: deptKey, status, remarks, checklist_items: checklistItems }, `${deptKey} clearance updated`);
    if (ok?.all_cleared) toast.success('All clearances done! No Dues Certificate can now be generated.');
  };

  const handleSaveAssets = async () => {
    await saveExit({ assets, audit_log: addAudit(exit.audit_log, 'Assets updated', '') });
    toast.success('Assets saved');
  };

  const handleSaveKT = async () => {
    const pct = ktItems.length ? Math.round(ktItems.filter(k => k.status === 'completed').length / ktItems.length * 100) : 0;
    await saveExit({ kt_items: ktItems, kt_overall_completion: pct, audit_log: addAudit(exit.audit_log, 'Knowledge transfer updated', '') });
    toast.success('KT saved');
  };

  const downloadPdf = (base64, filename) => {
    if (!base64) return;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleGenerateNoDues = async () => {
    setGenerating('no_dues');
    const d = await callExit('generateNoDuesCertificate', {}, 'No Dues Certificate generated');
    if (d) downloadPdf(d.base64, d.filename || 'No_Dues_Certificate.pdf');
    setGenerating('');
  };

  const handleSaveFnF = async () => {
    const ok = await callExit('saveExitFnF', { fnf: fnfData }, 'F&F prepared');
    if (ok?.fnf_data) setFnfData(ok.fnf_data);
  };
  const handleVerifyFnF = () => callExit('verifyExitFnF', {}, 'F&F verified');
  const handleApproveFnF = () => callExit('approveExitFnF', {}, 'F&F approved');
  const handleProcessFinance = async () => {
    setGenerating('fnf_pdf');
    const d = await callExit('processExitFnFFinance', { payment_reference: paymentRef }, 'F&F payment processed');
    if (d) downloadPdf(d.base64, d.filename || 'Full_And_Final_Settlement.pdf');
    setGenerating('');
  };
  const handleCloseCase = () => callExit('closeExitCase', {}, 'Exit case closed');

  const handleSaveHRInterview = async () => {
    setSavingInterview(true);
    const updated = { ...hrInterview, interviewed_by: hrInterview.interviewed_by || currentUser.full_name, completed_at: new Date().toISOString() };
    await base44.entities.Exit.update(exit.id, { hr_exit_interview: updated, hr_interview_completed: true, audit_log: addAudit(exit.audit_log, 'HR exit interview recorded', '') });
    setExit(prev => ({ ...prev, hr_exit_interview: updated, hr_interview_completed: true }));
    onRefresh();
    toast.success('Exit interview saved');
    setSavingInterview(false);
  };

  const handleGenerateDoc = async (docType) => {
    setGenerating(docType);
    try {
      const res = await base44.functions.invoke('generateExitDocument', {
        exit_id: exit.id,
        doc_type: docType,
        employee_name: exit.user?.full_name,
        employee_code: exit.employee?.employee_code,
        designation: exit.employee?.designation,
        department: exit.employee?.department,
        last_working_date: exit.last_working_date,
        resignation_date: exit.resignation_date,
      });
      if (res.data?.html) {
        openLetterheadPrintWindow(`${docType} – ${exit.user?.full_name}`, res.data.html, '', false);
      } else toast.error(res.data?.error || 'Generation failed');
    } catch (e) { toast.error(e.message); }
    setGenerating('');
  };

  /* ── Notice period helpers ── */
  const today = new Date();
  const resignDate = exit.resignation_date ? new Date(exit.resignation_date) : null;
  const lwdDate = exit.last_working_date ? new Date(exit.last_working_date) : null;
  const noticeDays = exit.notice_period_days || 30;
  const daysServed = resignDate ? Math.max(0, differenceInCalendarDays(today, resignDate)) : 0;
  const daysRemaining = lwdDate ? Math.max(0, differenceInCalendarDays(lwdDate, today)) : 0;
  const noticeProgress = Math.min(100, Math.round(daysServed / noticeDays * 100));

  /* ── Tab config ── */
  const tabs = [
    { id: 'overview',   label: 'Overview',          icon: User },
    { id: 'notice',     label: 'Notice Period',      icon: CalendarClock },
    { id: 'interview',  label: 'Exit Interview',     icon: FileText },
    { id: 'kt',         label: 'Knowledge Transfer', icon: BookOpen },
    { id: 'assets',     label: 'Asset Return',       icon: Package },
    { id: 'clearance',  label: 'Clearance',          icon: ClipboardList },
    { id: 'fnf',        label: 'F&F Settlement',     icon: DollarSign },
    { id: 'timeline',   label: 'Timeline',           icon: Activity },
  ];

  const statusCfg = STATUS_CONFIG[exit.status] || { label: exit.status, color: 'bg-gray-100 text-gray-700' };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <span className="text-red-600 font-bold">{exit.user?.full_name?.charAt(0)}</span>
            </div>
            <div>
              <p>{exit.user?.full_name || 'Employee'}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge className={statusCfg.color}>{statusCfg.label}</Badge>
                <span className="text-sm font-normal text-gray-500">{exit.employee?.designation} · {exit.employee?.department}</span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-0.5 border-b overflow-x-auto flex-shrink-0 pb-0">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 px-3 py-2 font-medium text-xs border-b-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <Icon className="w-3.5 h-3.5" />{tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto pt-3 pb-2 px-1">

          {/* ══ OVERVIEW ══ */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3 text-sm">
                <InfoRow label="Resignation Date" value={exit.resignation_date ? safeDate(exit.resignation_date, 'dd MMM yyyy') : null} />
                <InfoRow label="Last Working Day" value={exit.last_working_date ? safeDate(exit.last_working_date, 'dd MMM yyyy') : null} />
                <InfoRow label="Notice Period" value={`${noticeDays} days`} />
                <InfoRow label="Exit Type" value={exit.exit_type?.replace(/_/g, ' ')} />
                <InfoRow label="Reason" value={exit.reason_category?.replace(/_/g, ' ')} />
                <InfoRow label="Notice Buyout" value={exit.buyout_requested ? `${exit.buyout_days_requested || 0} days requested` : 'No'} />
              </div>

              {exit.reason_for_leaving && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Reason for Leaving</p>
                  <p className="text-sm">{exit.reason_for_leaving}</p>
                </div>
              )}
              {exit.detailed_comments && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Detailed Comments</p>
                  <p className="text-sm">{exit.detailed_comments}</p>
                </div>
              )}

              {/* Approval stages */}
              {(exit.approval_stages || []).map(stage => (
                <div key={stage.stage} className={`rounded-lg p-3 border text-sm flex items-start gap-3 ${stage.status === 'approved' ? 'bg-green-50 border-green-200' : stage.status === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${stage.status === 'approved' ? 'bg-green-500' : stage.status === 'rejected' ? 'bg-red-500' : 'bg-gray-300'}`}>
                    {stage.status === 'approved' ? <CheckCircle2 className="w-4 h-4 text-white" /> : stage.status === 'rejected' ? <XCircle className="w-4 h-4 text-white" /> : <Clock className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium capitalize">{stage.stage} Review</p>
                    {stage.actor_name && <p className="text-xs text-gray-500">{stage.actor_name} · {stage.timestamp ? safeDate(stage.timestamp, 'dd MMM yyyy') : ''}</p>}
                    {stage.comment && <p className="text-xs text-gray-600 mt-0.5">{stage.comment}</p>}
                    {stage.status === 'pending' && <Badge className="bg-yellow-100 text-yellow-700 text-xs mt-1">Pending</Badge>}
                  </div>
                </div>
              ))}

              {/* Action panels */}
              {isManager && exit.status === 'submitted' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                  <p className="font-semibold text-yellow-800 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Manager Action Required</p>
                  <div><Label className="text-xs">Comment</Label><Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Optional comment..." /></div>
                  <div className="flex gap-3">
                    <Button className="bg-green-600 hover:bg-green-700 flex-1" disabled={saving} onClick={() => handleManagerAction('approved')}><CheckCircle2 className="w-4 h-4 mr-2" />Approve</Button>
                    <Button className="bg-red-600 hover:bg-red-700 flex-1" disabled={saving} onClick={() => handleManagerAction('rejected')}><XCircle className="w-4 h-4 mr-2" />Reject</Button>
                  </div>
                </div>
              )}

              {isHR && exit.status === 'manager_approved' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                  <p className="font-semibold text-green-800 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> HR Action Required</p>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div><Label className="text-xs">Adjust Last Working Day</Label><Input type="date" value={lwdEdit} onChange={e => setLwdEdit(e.target.value)} /></div>
                    <div><Label className="text-xs">Comment</Label><Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} /></div>
                  </div>
                  <div className="flex gap-3">
                    <Button className="bg-green-600 hover:bg-green-700 flex-1" disabled={saving} onClick={() => handleHRAction('approved')}><CheckCircle2 className="w-4 h-4 mr-2" />Approve & Start Notice</Button>
                    <Button className="bg-red-600 hover:bg-red-700 flex-1" disabled={saving} onClick={() => handleHRAction('rejected')}><XCircle className="w-4 h-4 mr-2" />Reject</Button>
                  </div>
                </div>
              )}

              {isHR && exit.status === 'in_notice' && (
                <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={handleStartClearance} disabled={saving}><ClipboardList className="w-4 h-4 mr-2" />Initiate Clearance Process</Button>
              )}
              {isHR && exit.status === 'clearance_done' && !exit.no_dues_generated && (
                <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={handleGenerateNoDues} disabled={saving || generating === 'no_dues'}>
                  {generating === 'no_dues' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}Generate No Dues Certificate
                </Button>
              )}
              {exit.no_dues_generated && ['clearance_done', 'fnf_prepared', 'fnf_verified', 'fnf_hr_approved', 'fnf_finance_processed', 'fnf_employee_accepted'].includes(exit.status) && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />No Dues Certificate generated — see the F&F Settlement tab to proceed with F&F.</p>
              )}
              {isHR && exit.status === 'fnf_employee_accepted' && (
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleCloseCase} disabled={saving}><CheckCircle2 className="w-4 h-4 mr-2" />Close Exit Case — Mark as Relieved</Button>
              )}

              {/* Employee withdraw option */}
              {currentUser?.id === exit.user_id && ['submitted', 'manager_approved'].includes(exit.status) && (
                <Button variant="outline" className="w-full border-orange-300 text-orange-700 hover:bg-orange-50" onClick={handleWithdraw} disabled={saving}>
                  <RotateCcw className="w-4 h-4 mr-2" />Withdraw Resignation
                </Button>
              )}

              {/* Documents section */}
              {exit.status === 'completed' && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">Generated Documents</div>
                  <div className="divide-y">
                    {[
                      ['relieving_letter', 'Relieving Letter'],
                      ['experience_letter', 'Experience / Service Certificate'],
                    ].map(([type, label]) => (
                      <div key={type} className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="w-4 h-4 text-blue-500" />{label}
                        </div>
                        {isHR && (
                          <Button size="sm" variant="outline" disabled={generating === type} onClick={() => handleGenerateDoc(type)}>
                            {generating === type ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <PrintIcon className="w-3 h-3 mr-1" />}Generate
                          </Button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-teal-500" />No Dues Certificate</div>
                      <Badge className={exit.no_dues_generated ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>{exit.no_dues_generated ? 'Generated' : 'Not generated'}</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-indigo-500" />Full & Final Settlement Statement</div>
                      <Badge className={exit.fnf_document_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>{exit.fnf_document_id ? 'Generated' : 'Not generated'}</Badge>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ NOTICE PERIOD ══ */}
          {activeTab === 'notice' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Notice', value: `${noticeDays} days`, color: 'text-gray-700', bg: 'bg-gray-50' },
                  { label: 'Days Served', value: `${daysServed} days`, color: 'text-blue-700', bg: 'bg-blue-50' },
                  { label: 'Days Remaining', value: `${daysRemaining} days`, color: 'text-orange-700', bg: 'bg-orange-50' },
                  { label: 'Buyout Days', value: `${exit.buyout_days_requested || 0} days`, color: 'text-red-700', bg: 'bg-red-50' },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} p-4 rounded-xl`}>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Notice Progress</span><span>{noticeProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className={`h-3 rounded-full transition-all ${noticeProgress >= 100 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${noticeProgress}%` }} />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <InfoRow label="Resignation Date" value={exit.resignation_date ? safeDate(exit.resignation_date, 'dd MMM yyyy') : null} />
                <InfoRow label="Last Working Day" value={exit.last_working_date ? safeDate(exit.last_working_date, 'dd MMM yyyy') : null} />
                <InfoRow label="Willing to Serve Notice" value={exit.willing_to_serve_notice ? 'Yes' : 'No'} />
                <InfoRow label="Notice Shortfall" value={exit.notice_shortfall_days ? `${exit.notice_shortfall_days} days` : 'None'} />
              </div>

              {exit.buyout_requested && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="font-semibold text-amber-800 mb-3">Buyout Request</p>
                  <div className="grid md:grid-cols-3 gap-3 text-sm">
                    <InfoRow label="Buyout Days Requested" value={`${exit.buyout_days_requested} days`} />
                    <InfoRow label="Buyout Status" value={exit.buyout_approved ? 'Approved' : exit.buyout_rejected ? 'Rejected' : 'Pending'} />
                    <InfoRow label="Approved Days" value={exit.buyout_approved_days ? `${exit.buyout_approved_days} days` : '—'} />
                  </div>
                  {isHR && !exit.buyout_approved && !exit.buyout_rejected && (
                    <div className="mt-3 flex gap-3">
                      <Input type="number" className="w-32" placeholder="Days to approve"
                        onChange={e => { exit._buyoutApproveDays = e.target.value; }} />
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={async () => {
                        const days = Number(exit._buyoutApproveDays || exit.buyout_days_requested || 0);
                        await saveExit({ buyout_approved: true, buyout_approved_days: days, audit_log: addAudit(exit.audit_log, `Buyout approved: ${days} days`, '') });
                        toast.success(`Buyout approved for ${days} days`);
                      }}>Approve Buyout</Button>
                      <Button size="sm" variant="outline" className="border-red-300 text-red-600" onClick={async () => {
                        await saveExit({ buyout_rejected: true, audit_log: addAudit(exit.audit_log, 'Buyout rejected', '') });
                        toast.success('Buyout rejected');
                      }}>Reject</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ EXIT INTERVIEW ══ */}
          {activeTab === 'interview' && (
            <div className="space-y-5">
              {/* Employee interview */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2"><User className="w-4 h-4 text-gray-400" />Employee Self-Interview</p>
                {exit.exit_interview_completed ? (
                  exit.exit_interview?.primary_reason === 'Skipped by manager' ? (
                    <div className="text-center py-6 text-gray-400 bg-gray-50 rounded-lg text-sm"><CalendarX className="w-8 h-8 mx-auto mb-2" />Interview was skipped</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-5 gap-2">
                        {[['Work Exp', 'work_experience_rating'],['Management','management_rating'],['Culture','culture_rating'],['Compensation','compensation_rating'],['Work-Life','work_life_balance_rating']].map(([label, key]) => {
                          const rating = exit.exit_interview?.[key];
                          return (
                            <div key={key} className="bg-gray-50 p-2 rounded text-center">
                              <p className="text-xs text-gray-500">{label}</p>
                              <p className={`text-xl font-bold mt-1 ${rating >= 4 ? 'text-green-600' : rating >= 3 ? 'text-yellow-600' : 'text-red-600'}`}>{rating || '—'}</p>
                              <p className="text-xs text-gray-400">/5</p>
                            </div>
                          );
                        })}
                      </div>
                      {[['Primary Reason', 'primary_reason'],['Things Liked','things_liked'],['Could Improve','things_disliked'],['Suggestions','suggestions']].map(([label, key]) => exit.exit_interview?.[key] && (
                        <div key={key} className="bg-blue-50 p-3 rounded">
                          <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
                          <p className="text-sm">{exit.exit_interview[key]}</p>
                        </div>
                      ))}
                      <div className="flex gap-4 text-sm">
                        <span>Would Recommend: <strong>{exit.exit_interview?.would_recommend_company === true ? 'Yes' : exit.exit_interview?.would_recommend_company === false ? 'No' : '—'}</strong></span>
                        <span>Would Rejoin: <strong>{exit.exit_interview?.would_rejoin === true ? 'Yes' : exit.exit_interview?.would_rejoin === false ? 'No' : '—'}</strong></span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-center py-6 text-gray-400 bg-gray-50 rounded-lg">
                    <FileText className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm mb-2">Employee has not yet submitted the interview</p>
                    {isHR && (
                      <div className="flex gap-2 justify-center">
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={saving} onClick={async () => {
                          await saveExit({ audit_log: addAudit(exit.audit_log, 'Exit interview reminder sent', '') });
                          toast.success('Reminder noted in audit log');
                        }}><CalendarClock className="w-3.5 h-3.5 mr-1" />Remind Employee</Button>
                        <Button size="sm" variant="outline" disabled={saving} onClick={async () => {
                          await saveExit({ exit_interview_completed: true, exit_interview: { primary_reason: 'Skipped by HR', completed_at: new Date().toISOString() }, audit_log: addAudit(exit.audit_log, 'Exit interview skipped', '') });
                          toast.success('Interview skipped');
                        }}><CalendarX className="w-3.5 h-3.5 mr-1" />Skip</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* HR interview */}
              {isHR && (
                <div className="border-t pt-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-500" />HR Exit Interview
                    {exit.hr_interview_completed && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Saved</span>}
                  </p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-5 gap-2">
                      {[['Work Exp','work_experience_rating'],['Management','management_rating'],['Culture','culture_rating'],['Compensation','compensation_rating'],['Work-Life','work_life_balance_rating']].map(([label, key]) => (
                        <div key={key}><Label className="text-xs">{label} /5</Label>
                          <Input type="number" min="1" max="5" value={hrInterview[key]} onChange={e => setHrInterview(p => ({ ...p, [key]: e.target.value }))} className="h-8 text-sm text-center" placeholder="—" /></div>
                      ))}
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div><Label className="text-xs">Primary Reason</Label><Input value={hrInterview.primary_reason} onChange={e => setHrInterview(p => ({ ...p, primary_reason: e.target.value }))} /></div>
                      <div><Label className="text-xs">Interviewed By</Label><Input value={hrInterview.interviewed_by || currentUser?.full_name || ''} onChange={e => setHrInterview(p => ({ ...p, interviewed_by: e.target.value }))} /></div>
                    </div>
                    <div><Label className="text-xs">Things Employee Liked</Label><Textarea rows={2} value={hrInterview.things_liked} onChange={e => setHrInterview(p => ({ ...p, things_liked: e.target.value }))} /></div>
                    <div><Label className="text-xs">Areas for Improvement</Label><Textarea rows={2} value={hrInterview.things_disliked} onChange={e => setHrInterview(p => ({ ...p, things_disliked: e.target.value }))} /></div>
                    <div><Label className="text-xs">HR Notes & Observations</Label><Textarea rows={2} value={hrInterview.hr_notes} onChange={e => setHrInterview(p => ({ ...p, hr_notes: e.target.value }))} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      {[['Would Recommend?','would_recommend_company'],['Would Rejoin?','would_rejoin']].map(([label, key]) => (
                        <div key={key}><Label className="text-xs">{label}</Label>
                          <Select value={hrInterview[key]} onValueChange={v => setHrInterview(p => ({ ...p, [key]: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem><SelectItem value="maybe">Maybe</SelectItem></SelectContent>
                          </Select></div>
                      ))}
                    </div>
                    <Button className="w-full bg-amber-600 hover:bg-amber-700" disabled={savingInterview} onClick={handleSaveHRInterview}>
                      {savingInterview ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save HR Interview
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ KNOWLEDGE TRANSFER ══ */}
          {activeTab === 'kt' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Knowledge Transfer Tasks</p>
                  <p className="text-xs text-gray-500">Track handover of projects, documentation, and credentials</p>
                </div>
                {isHR && (
                  <Button size="sm" onClick={() => setKtItems(p => [...p, { id: Date.now(), task: '', description: '', assignee: '', due_date: '', status: 'pending', completion_pct: 0 }])}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Add Task
                  </Button>
                )}
              </div>

              {ktItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg text-sm">
                  <BookOpen className="w-8 h-8 mx-auto mb-2" />No KT tasks added yet
                </div>
              ) : (
                <div className="space-y-2">
                  {ktItems.map((item, i) => (
                    <div key={item.id || i} className="border rounded-lg p-3 space-y-2">
                      <div className="grid md:grid-cols-3 gap-2">
                        <div><Label className="text-xs">Task / Item</Label>
                          <Input value={item.task} onChange={e => { const c = [...ktItems]; c[i] = { ...c[i], task: e.target.value }; setKtItems(c); }} placeholder="e.g. Handover Project X docs" /></div>
                        <div><Label className="text-xs">Assignee</Label>
                          <Select value={item.assignee_user_id || ''} onValueChange={v => {
                            const emp = employees.find(e => e.user_id === v);
                            const c = [...ktItems]; c[i] = { ...c[i], assignee_user_id: v, assignee: emp?.display_name || emp?.full_name || v }; setKtItems(c);
                          }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select employee..." /></SelectTrigger>
                            <SelectContent>
                              {employees.map(emp => (
                                <SelectItem key={emp.user_id || emp.id} value={emp.user_id || emp.id}>
                                  {emp.display_name || emp.full_name} {emp.designation ? `· ${emp.designation}` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div><Label className="text-xs">Due Date</Label>
                          <Input type="date" value={item.due_date} onChange={e => { const c = [...ktItems]; c[i] = { ...c[i], due_date: e.target.value }; setKtItems(c); }} /></div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-[140px]"><Label className="text-xs">Description</Label>
                          <Input value={item.description} onChange={e => { const c = [...ktItems]; c[i] = { ...c[i], description: e.target.value }; setKtItems(c); }} placeholder="Details..." /></div>
                        <div><Label className="text-xs">Status</Label>
                          <Select value={item.status} onValueChange={v => { const c = [...ktItems]; c[i] = { ...c[i], status: v }; setKtItems(c); }}>
                            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent>
                          </Select></div>
                        <Button size="sm" variant="ghost" className="text-red-400 mt-4" onClick={() => setKtItems(p => p.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {ktItems.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {ktItems.filter(k => k.status === 'completed').length}/{ktItems.length} tasks completed
                    ({Math.round(ktItems.filter(k => k.status === 'completed').length / ktItems.length * 100)}%)
                  </div>
                  <Button onClick={handleSaveKT} disabled={saving}><Save className="w-4 h-4 mr-2" />Save KT</Button>
                </div>
              )}
            </div>
          )}

          {/* ══ ASSET RETURN ══ */}
          {activeTab === 'assets' && (
            <AssetReturnTab
              exit={exit}
              assets={assets}
              setAssets={setAssets}
              loadingAssets={loadingAssets}
              setLoadingAssets={setLoadingAssets}
              saving={saving}
              isHR={isHR}
              currentUser={currentUser}
              onSave={handleSaveAssets}
              onConfirmReturn={async (asset, condition, notes) => {
                const today = new Date().toISOString().slice(0, 10);
                const updatedAssets = assets.map(a =>
                  (a.id === asset.id || a.asset_entity_id === asset.asset_entity_id)
                    ? { ...a, status: condition === 'good' ? 'returned' : condition, returned_date: today, returned_by: currentUser.full_name, condition, notes: notes || a.notes }
                    : a
                );
                setAssets(updatedAssets);
                // Also update the Asset entity so it becomes available again
                if (asset.asset_entity_id) {
                  try {
                    await base44.entities.Asset.update(asset.asset_entity_id, {
                      status: 'available',
                      assigned_to_user_id: '',
                      return_date: today,
                      condition,
                      notes: `Returned by ${exit.user?.full_name || ''} on ${today}. ${notes || ''}`.trim(),
                    });
                  } catch (e) { console.warn('Asset entity update failed:', e.message); }
                }
                await saveExit({ assets: updatedAssets, audit_log: addAudit(exit.audit_log, `Asset returned: ${asset.name}`, condition) });
                toast.success(`${asset.name} marked as returned`);
              }}
            />
          )}

          {/* ══ CLEARANCE ══ */}
          {activeTab === 'clearance' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">All 5 departments must clear every checklist item before a No Dues Certificate can be generated.</p>
              {CLEARANCE_DEPTS.map(dept => {
                const data = exit.clearance_checklist?.[dept.key] || { status: 'pending', checklist_items: [] };
                const Icon = dept.icon;
                return (
                  <div key={dept.key} className={`border rounded-lg p-3 ${data.status === 'cleared' ? 'bg-green-50 border-green-200' : data.status === 'not_cleared' ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Icon className={`w-5 h-5 flex-shrink-0 ${data.status === 'cleared' ? 'text-green-600' : data.status === 'not_cleared' ? 'text-red-600' : 'text-gray-400'}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{dept.label}</p>
                        {data.authorized_by_name && <p className="text-xs text-gray-500">By {data.authorized_by_name} · {data.cleared_at ? safeDate(data.cleared_at, 'dd MMM yyyy') : ''}</p>}
                        {data.remarks && <p className="text-xs text-gray-600">{data.remarks}</p>}
                      </div>
                      <Badge className={data.status === 'cleared' ? 'bg-green-100 text-green-700' : data.status === 'not_cleared' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
                        {data.status === 'cleared' ? 'Cleared' : data.status === 'not_cleared' ? 'Not Cleared' : 'Pending'}
                      </Badge>
                    </div>
                    {canActDept(dept.key) && ['in_notice', 'clearance_pending', 'clearance_done'].includes(exit.status) && (
                      <ClearanceDeptActions dept={dept.key} data={data} onUpdate={handleUpdateClearance} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ F&F SETTLEMENT ══ */}
          {activeTab === 'fnf' && (
            <FnFTab
              exit={exit} isHR={isHR} currentUser={currentUser} saving={saving} generating={generating}
              fnfData={fnfData} setFnfData={setFnfData}
              loadingSalary={loadingSalary} setLoadingSalary={setLoadingSalary}
              onSave={handleSaveFnF} onVerify={handleVerifyFnF} onApprove={handleApproveFnF}
              onProcessFinance={handleProcessFinance} paymentRef={paymentRef} setPaymentRef={setPaymentRef}
              acceptName={acceptName} setAcceptName={setAcceptName}
              onAccept={() => callExit('acceptExitFnF', { typed_name: acceptName }, 'F&F accepted')}
              downloadPdf={downloadPdf}
            />
          )}

          {/* ══ TIMELINE ══ */}
          {activeTab === 'timeline' && (
            <div className="space-y-0 relative">
              <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />
              {(exit.audit_log || []).length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm"><Activity className="w-8 h-8 mx-auto mb-2" />No activity recorded yet</div>
              ) : (
                [...(exit.audit_log || [])].reverse().map((entry, i) => (
                  <div key={i} className="flex items-start gap-3 pb-5 relative">
                    <div className="w-10 h-10 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center flex-shrink-0 z-10">
                      <span className="text-xs font-bold text-blue-600">{entry.actor_name?.charAt(0) || '?'}</span>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 flex-1 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{entry.action}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{entry.timestamp ? safeDate(entry.timestamp, 'dd MMM yyyy, hh:mm a') : ''}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{entry.actor_name}</p>
                      {entry.comment && <p className="text-xs text-gray-600 mt-1 italic">{entry.comment}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Clearance dept actions sub-component — per-item checklist, "cleared"
   only enabled once every item is checked (server independently enforces
   this too). ── */
function ClearanceDeptActions({ dept, data, onUpdate }) {
  const [items, setItems] = useState(data.checklist_items || []);
  const [remarks, setRemarks] = useState(data.remarks || '');
  const [newItem, setNewItem] = useState('');
  const allChecked = items.length > 0 && items.every(it => it.checked);

  const toggleItem = (id) => setItems(p => p.map(it => it.id === id ? { ...it, checked: !it.checked } : it));
  const addItem = () => {
    if (!newItem.trim()) return;
    setItems(p => [...p, { id: `custom_${Date.now()}`, label: newItem.trim(), checked: false, notes: '' }]);
    setNewItem('');
  };
  const removeItem = (id) => setItems(p => p.filter(it => it.id !== id));

  return (
    <div className="mt-2 space-y-2">
      <div className="space-y-1">
        {items.map(it => (
          <label key={it.id} className="flex items-center gap-2 text-xs bg-white/60 rounded px-2 py-1">
            <input type="checkbox" checked={!!it.checked} onChange={() => toggleItem(it.id)} />
            <span className="flex-1">{it.label}</span>
            {it.id.startsWith('custom_') && <button type="button" onClick={() => removeItem(it.id)} className="text-red-400"><Trash2 className="w-3 h-3" /></button>}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Input className="flex-1 h-7 text-xs" placeholder="Add checklist item..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem())} />
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addItem}><Plus className="w-3 h-3" /></Button>
      </div>
      <Input className="h-7 text-xs" placeholder="Remarks..." value={remarks} onChange={e => setRemarks(e.target.value)} />
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40" disabled={!allChecked} title={!allChecked ? 'All checklist items must be checked first' : ''} onClick={() => onUpdate(dept, 'cleared', remarks, items)}><CheckCircle2 className="w-3 h-3 mr-1" />Clear</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs border-red-300 text-red-600" onClick={() => onUpdate(dept, 'not_cleared', remarks, items)}><XCircle className="w-3 h-3 mr-1" />Issue Found</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" onClick={() => onUpdate(dept, 'pending', remarks, items)}>Save Progress</Button>
      </div>
    </div>
  );
}

/* ── F&F Settlement tab — Actual/Earned statement matching the reference
   document, with the full Prepare → Verify → Approve → Process Finance →
   Employee Accept stage pipeline. ── */
function FnFTab({ exit, isHR, currentUser, saving, generating, fnfData, setFnfData, loadingSalary, setLoadingSalary, onSave, onVerify, onApprove, onProcessFinance, paymentRef, setPaymentRef, acceptName, setAcceptName, onAccept, downloadPdf }) {
  const setEarn = (key, actual) => setFnfData(p => ({ ...p, earnings: { ...p.earnings, [key]: { ...p.earnings?.[key], actual: Number(actual) || 0 } } }));
  const setDed = (key, val) => setFnfData(p => ({ ...p, deductions: { ...p.deductions, [key]: Number(val) || 0 } }));
  const canEdit = isHR && exit.status === 'clearance_done' && exit.no_dues_generated;
  const isEmployee = currentUser?.id === exit.user_id;

  const autoFill = async () => {
    setLoadingSalary(true);
    try {
      const res = await base44.functions.invoke('getEmployeeSalaryForFnF', { user_id: exit.user_id });
      const d = res.data;
      if (d?.success) {
        setFnfData(p => ({
          ...p,
          earnings: {
            ...p.earnings,
            basic_salary: { ...p.earnings?.basic_salary, actual: d.earnings_actual?.basic_salary || 0 },
            hra: { ...p.earnings?.hra, actual: d.earnings_actual?.hra || 0 },
            special_allowances: { ...p.earnings?.special_allowances, actual: d.earnings_actual?.special_allowances || 0 },
            conveyance: { ...p.earnings?.conveyance, actual: d.earnings_actual?.conveyance || 0 },
          },
          deductions: { ...p.deductions, epf: d.epf_estimate || 0, esi: d.esi_estimate || 0 },
          other_earnings: { ...p.other_earnings, gratuity: { years: d.years_of_service || 0, amount: d.gratuity_eligible ? (d.gratuity_amount || 0) : 0 } },
        }));
        toast.success(`Loaded salary components · ${d.years_of_service || 0} yrs service · ${d.gratuity_eligible ? 'gratuity eligible' : 'gratuity not eligible'}`);
      } else toast.error(d?.error || 'Could not fetch salary data');
    } catch (e) { toast.error('Failed: ' + e.message); }
    setLoadingSalary(false);
  };

  if (!exit.no_dues_generated) {
    return <div className="text-center py-10 text-gray-400 text-sm"><DollarSign className="w-8 h-8 mx-auto mb-2" />F&F Settlement becomes available once the No Dues Certificate is generated.</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Full & Final Settlement Statement — Actual vs Earned, matching the standard MaxVolt format.</p>
      {canEdit && (
        <Button size="sm" variant="outline" onClick={autoFill} disabled={loadingSalary}>
          {loadingSalary ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Auto-fill from Payroll
        </Button>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div><Label className="text-xs">For the Month</Label><Input disabled={!canEdit} value={fnfData.for_month || ''} onChange={e => setFnfData(p => ({ ...p, for_month: e.target.value }))} placeholder="e.g. February 2026" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Total Days in Month</Label><Input type="number" disabled={!canEdit} value={fnfData.total_days_in_month || ''} onChange={e => setFnfData(p => ({ ...p, total_days_in_month: Number(e.target.value) || 0 }))} /></div>
          <div><Label className="text-xs">Paid Days</Label><Input type="number" disabled={!canEdit} value={fnfData.paid_days || ''} onChange={e => setFnfData(p => ({ ...p, paid_days: Number(e.target.value) || 0 }))} /></div>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Earnings (Actual → Earned)</p>
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500"><span className="flex-1">Component</span><span className="w-24 text-right">Actual</span><span className="w-24 text-right">Earned</span></div>
          {FNF_EARN_ROWS.map(([label, key]) => (
            <div key={key} className="flex items-center gap-3 px-3 py-2 border-t">
              <span className="text-sm flex-1">{label}</span>
              {canEdit ? <Input type="number" className="w-24 h-7 text-sm text-right" value={fnfData.earnings?.[key]?.actual || ''} onChange={e => setEarn(key, e.target.value)} placeholder="0" /> : <span className="w-24 text-right text-sm">₹{fmt(fnfData.earnings?.[key]?.actual)}</span>}
              <span className="w-24 text-right text-sm text-gray-500">₹{fmt(fnfData.earnings?.[key]?.earned)}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-3 py-2 border-t bg-green-50 font-semibold text-sm"><span className="flex-1">Total</span><span className="w-24 text-right">₹{fmt(fnfData.total_earnings_actual)}</span><span className="w-24 text-right">₹{fmt(fnfData.total_earnings_earned)}</span></div>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Less Deductions (-)</p>
        <div className="border rounded-lg overflow-hidden">
          {FNF_DED_ROWS.map(([label, key]) => (
            <div key={key} className="flex items-center gap-3 px-3 py-2 border-b last:border-0">
              <span className="text-sm flex-1">{label}</span>
              {canEdit ? <Input type="number" className="w-28 h-7 text-sm text-right" value={fnfData.deductions?.[key] || ''} onChange={e => setDed(key, e.target.value)} placeholder="0" /> : <span className="w-28 text-right text-sm">₹{fmt(fnfData.deductions?.[key])}</span>}
            </div>
          ))}
          <div className="flex items-center gap-3 px-3 py-2 bg-red-50 font-semibold text-sm"><span className="flex-1">Total Deductions</span><span className="w-28 text-right">₹{fmt(fnfData.total_deductions)}</span></div>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Other Earnings</p>
        <div className="border rounded-lg overflow-hidden divide-y">
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="text-sm w-24">Bonus</span>
            {canEdit ? <Input className="flex-1 h-7 text-xs" placeholder="Eligibility period, e.g. April 2025 to February 2026" value={fnfData.other_earnings?.bonus?.eligibility_period || ''} onChange={e => setFnfData(p => ({ ...p, other_earnings: { ...p.other_earnings, bonus: { ...p.other_earnings?.bonus, eligibility_period: e.target.value } } }))} /> : <span className="flex-1 text-xs text-gray-500">{fnfData.other_earnings?.bonus?.eligibility_period}</span>}
            {canEdit ? <Input type="number" className="w-28 h-7 text-sm text-right" value={fnfData.other_earnings?.bonus?.amount || ''} onChange={e => setFnfData(p => ({ ...p, other_earnings: { ...p.other_earnings, bonus: { ...p.other_earnings?.bonus, amount: Number(e.target.value) || 0 } } }))} /> : <span className="w-28 text-right text-sm">₹{fmt(fnfData.other_earnings?.bonus?.amount)}</span>}
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="text-sm w-24">Gratuity</span>
            {canEdit ? <Input type="number" className="w-20 h-7 text-xs" placeholder="Years" value={fnfData.other_earnings?.gratuity?.years || ''} onChange={e => setFnfData(p => ({ ...p, other_earnings: { ...p.other_earnings, gratuity: { ...p.other_earnings?.gratuity, years: Number(e.target.value) || 0 } } }))} /> : <span className="flex-1 text-xs text-gray-500">{fnfData.other_earnings?.gratuity?.years} yr(s)</span>}
            {canEdit ? <Input type="number" className="w-28 h-7 text-sm text-right" value={fnfData.other_earnings?.gratuity?.amount || ''} onChange={e => setFnfData(p => ({ ...p, other_earnings: { ...p.other_earnings, gratuity: { ...p.other_earnings?.gratuity, amount: Number(e.target.value) || 0 } } }))} /> : <span className="w-28 text-right text-sm">₹{fmt(fnfData.other_earnings?.gratuity?.amount)}</span>}
          </div>
          {[['OT', 'ot'], ['Others', 'others']].map(([label, key]) => (
            <div key={key} className="flex items-center gap-3 px-3 py-2">
              <span className="text-sm flex-1">{label}</span>
              {canEdit ? <Input type="number" className="w-28 h-7 text-sm text-right" value={fnfData.other_earnings?.[key] || ''} onChange={e => setFnfData(p => ({ ...p, other_earnings: { ...p.other_earnings, [key]: Number(e.target.value) || 0 } }))} /> : <span className="w-28 text-right text-sm ml-auto">₹{fmt(fnfData.other_earnings?.[key])}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="border-2 border-gray-900 rounded-lg overflow-hidden">
        <div className="flex justify-between px-4 py-3 font-bold text-base bg-gray-900 text-white"><span>Net Payable</span><span>₹{fmt(fnfData.net_payable)}</span></div>
      </div>

      {canEdit && (
        <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={onSave} disabled={saving}><Save className="w-4 h-4 mr-2" />Prepare F&F</Button>
      )}
      {isHR && exit.status === 'fnf_prepared' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm">
          <p className="font-medium text-indigo-800 mb-2">F&F prepared by {fnfData.prepared_by_name} — needs independent verification.</p>
          <Button size="sm" onClick={onVerify} disabled={saving}>Verify F&F</Button>
        </div>
      )}
      {isHR && exit.status === 'fnf_verified' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm">
          <p className="font-medium text-indigo-800 mb-2">F&F verified by {fnfData.verified_by_name} — awaiting HR/Management approval.</p>
          <Button size="sm" onClick={onApprove} disabled={saving}>Approve F&F</Button>
        </div>
      )}
      {isHR && exit.status === 'fnf_hr_approved' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm space-y-2">
          <p className="font-medium text-blue-800">Approved by {fnfData.hr_approved_by_name} — process the payment in Finance to generate the settlement PDF.</p>
          <Input placeholder="Payment reference / UTR (optional)" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
          <Button size="sm" onClick={onProcessFinance} disabled={saving || generating === 'fnf_pdf'}>{generating === 'fnf_pdf' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Process Payment & Generate PDF</Button>
        </div>
      )}
      {['fnf_finance_processed', 'fnf_employee_accepted', 'completed'].includes(exit.status) && fnfData.finance_processed_by_id && (
        <p className="text-xs text-gray-500 text-center">Processed {fnfData.payment_reference ? `(ref: ${fnfData.payment_reference}) ` : ''}on {fnfData.finance_processed_at ? safeDate(fnfData.finance_processed_at, 'dd MMM yyyy') : ''}</p>
      )}
      {isEmployee && exit.status === 'fnf_finance_processed' && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-2">
          <p className="font-medium text-teal-800 text-sm">Please review the settlement above and type your full name to accept.</p>
          <Input placeholder="Type your full name to accept" value={acceptName} onChange={e => setAcceptName(e.target.value)} />
          <Button className="w-full bg-teal-600 hover:bg-teal-700" disabled={!acceptName.trim() || saving} onClick={onAccept}><CheckCircle2 className="w-4 h-4 mr-2" />I Accept This Settlement</Button>
        </div>
      )}
      {fnfData.employee_accepted && (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">Accepted by {fnfData.employee_accepted_name} on {fnfData.employee_accepted_at ? safeDate(fnfData.employee_accepted_at, 'dd MMM yyyy') : ''}</p>
      )}
    </div>
  );
}

/* ── Asset Return Tab sub-component ── */
function AssetReturnTab({ exit, assets, setAssets, loadingAssets, setLoadingAssets, saving, isHR, currentUser, onSave, onConfirmReturn }) {
  const [confirmDialog, setConfirmDialog] = useState(null); // { asset, index }
  const [confirmCondition, setConfirmCondition] = useState('good');
  const [confirmNotes, setConfirmNotes] = useState('');
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    // Only auto-fetch if no assets saved yet in exit record
    if (assets.length > 0) return;
    setLoadingAssets(true);
    base44.entities.Asset.filter({ assigned_to_user_id: exit.user_id })
      .then(list => {
        if (list && list.length > 0) {
          const mapped = list.map(a => ({
            id: `fetched_${a.id}`,
            asset_entity_id: a.id,
            name: a.asset_name || 'Asset',
            type: a.asset_type_id || 'other',
            serial_no: a.serial_number || a.asset_id || '',
            issued_date: a.assignment_date || '',
            returned_date: '',
            condition: a.condition || '',
            status: 'pending',
            notes: '',
            _source: 'asset_tracking',
          }));
          setAssets(mapped);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAssets(false));
  }, [exit.user_id]);

  const handleAddManual = () => setAssets(p => [...p, {
    id: `manual_${Date.now()}`, name: '', type: 'other', serial_no: '',
    issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '', _source: 'manual',
  }]);

  const returnedCount = assets.filter(a => ['returned', 'damaged', 'missing'].includes(a.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Asset Return Checklist</p>
          <p className="text-xs text-gray-500">Assets assigned to employee from the asset tracking system</p>
        </div>
        <div className="flex gap-2">
          {isHR && (
            <Button size="sm" variant="outline" onClick={handleAddManual}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Manual
            </Button>
          )}
          {isHR && (
            <Button size="sm" variant="outline" onClick={async () => {
              setLoadingAssets(true);
              try {
                const list = await base44.entities.Asset.filter({ assigned_to_user_id: exit.user_id });
                if (list?.length) {
                  const existingEntityIds = new Set(assets.map(a => a.asset_entity_id).filter(Boolean));
                  const newAssets = list
                    .filter(a => !existingEntityIds.has(a.id))
                    .map(a => ({
                      id: `fetched_${a.id}`, asset_entity_id: a.id,
                      name: a.asset_name || 'Asset', type: a.asset_type_id || 'other',
                      serial_no: a.serial_number || a.asset_id || '',
                      issued_date: a.assignment_date || '', returned_date: '',
                      condition: a.condition || '', status: 'pending', notes: '', _source: 'asset_tracking',
                    }));
                  setAssets(p => [...p, ...newAssets]);
                  toast.success(`${list.length} asset(s) loaded from tracking system`);
                } else {
                  toast.info('No assets found assigned to this employee');
                }
              } catch { toast.error('Failed to fetch assets'); }
              setLoadingAssets(false);
            }} disabled={loadingAssets}>
              {loadingAssets ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              {loadingAssets ? '' : ' Sync from Tracking'}
            </Button>
          )}
        </div>
      </div>

      {loadingAssets ? (
        <div className="text-center py-8 text-gray-400"><Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" /><p className="text-sm">Loading assigned assets...</p></div>
      ) : assets.length === 0 ? (
        <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-lg">
          <Package className="w-10 h-10 mx-auto mb-2" />
          <p className="text-sm font-medium">No assets found</p>
          <p className="text-xs mt-1">No assets are assigned to this employee in the tracking system.<br />Use "Add Manual" to add ID card, access card, etc.</p>
          {isHR && <Button size="sm" className="mt-3" onClick={handleAddManual}><Plus className="w-3.5 h-3.5 mr-1" />Add Manual Asset</Button>}
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset, i) => (
            <div key={asset.id || i} className={`border rounded-lg p-3 ${asset.status === 'returned' ? 'bg-green-50 border-green-200' : asset.status === 'damaged' ? 'bg-orange-50 border-orange-200' : asset.status === 'missing' ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
              <div className="flex items-start gap-3">
                <Package className={`w-5 h-5 mt-0.5 flex-shrink-0 ${asset.status === 'returned' ? 'text-green-600' : asset.status === 'damaged' ? 'text-orange-500' : asset.status === 'missing' ? 'text-red-500' : 'text-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  {/* Asset name row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {asset._source === 'manual' ? (
                      <Input className="h-7 text-sm font-medium w-48" value={asset.name} placeholder="Asset name" onChange={e => { const c=[...assets]; c[i]={...c[i],name:e.target.value}; setAssets(c); }} />
                    ) : (
                      <span className="font-medium text-sm">{asset.name}</span>
                    )}
                    {asset.serial_no && <span className="text-xs text-gray-500 bg-white border rounded px-1.5 py-0.5">S/N: {asset.serial_no}</span>}
                    {asset._source === 'asset_tracking' && <span className="text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">Tracked</span>}
                    {asset.issued_date && <span className="text-xs text-gray-400">Issued: {asset.issued_date}</span>}
                  </div>
                  {/* Status row */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge className={asset.status === 'returned' ? 'bg-green-100 text-green-700' : asset.status === 'damaged' ? 'bg-orange-100 text-orange-700' : asset.status === 'missing' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
                      {asset.status === 'returned' ? 'Returned' : asset.status === 'damaged' ? 'Returned (Damaged)' : asset.status === 'missing' ? 'Missing' : 'Pending Return'}
                    </Badge>
                    {asset.returned_date && <span className="text-xs text-gray-500">on {asset.returned_date}</span>}
                    {asset.returned_by && <span className="text-xs text-gray-500">by {asset.returned_by}</span>}
                    {asset.notes && <span className="text-xs text-gray-500 italic">{asset.notes}</span>}
                  </div>
                </div>
                {/* Actions */}
                <div className="flex gap-1.5 flex-shrink-0">
                  {isHR && asset.status === 'pending' && (
                    <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => { setConfirmDialog({ asset, index: i }); setConfirmCondition('good'); setConfirmNotes(''); }}>
                      <CheckCircle2 className="w-3 h-3 mr-1" />Confirm Return
                    </Button>
                  )}
                  {isHR && asset.status === 'pending' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs border-red-300 text-red-600" onClick={() => { setConfirmDialog({ asset, index: i }); setConfirmCondition('missing'); setConfirmNotes(''); }}>
                      <AlertCircle className="w-3 h-3 mr-1" />Mark Missing
                    </Button>
                  )}
                  {isHR && asset.status !== 'pending' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400" onClick={() => { const c=[...assets]; c[i]={...c[i],status:'pending',returned_date:'',returned_by:'',condition:'',notes:''}; setAssets(c); }}>
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                  )}
                  {isHR && asset._source === 'manual' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" onClick={() => setAssets(p => p.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">{returnedCount}/{assets.length} accounted for</span>
        {isHR && <Button onClick={onSave} disabled={saving}><Save className="w-4 h-4 mr-2" />Save Asset Status</Button>}
      </div>

      {/* Confirm return dialog */}
      {confirmDialog && (
        <Dialog open onOpenChange={() => setConfirmDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-sm">Confirm Asset Return — {confirmDialog.asset.name}</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-1">
              <div>
                <Label className="text-xs">Condition on Return</Label>
                <Select value={confirmCondition} onValueChange={setConfirmCondition}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Good — No damage</SelectItem>
                    <SelectItem value="damaged">Damaged — Visible wear / issues</SelectItem>
                    <SelectItem value="missing">Not returned / Missing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Notes (optional)</Label>
                <Input value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)} placeholder="e.g. screen scratch, missing charger..." />
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmDialog(null)}>Cancel</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={async () => {
                  await onConfirmReturn(confirmDialog.asset, confirmCondition, confirmNotes);
                  setConfirmDialog(null);
                }}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />Confirm
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
