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

/* ── helpers ─────────────────────────────────────── */
const STATUS_CONFIG = {
  draft:              { label: 'Draft',              color: 'bg-gray-100 text-gray-700' },
  submitted:          { label: 'Submitted',          color: 'bg-blue-100 text-blue-800' },
  manager_approved:   { label: 'Mgr Approved',       color: 'bg-yellow-100 text-yellow-800' },
  manager_rejected:   { label: 'Mgr Rejected',       color: 'bg-red-100 text-red-800' },
  hr_approved:        { label: 'HR Approved',        color: 'bg-green-100 text-green-800' },
  hr_rejected:        { label: 'HR Rejected',        color: 'bg-red-100 text-red-800' },
  in_notice:          { label: 'In Notice',          color: 'bg-orange-100 text-orange-800' },
  buyout_pending:     { label: 'Buyout Pending',     color: 'bg-amber-100 text-amber-800' },
  clearance_pending:  { label: 'Clearance',          color: 'bg-purple-100 text-purple-800' },
  clearance_done:     { label: 'Clearance Done',     color: 'bg-teal-100 text-teal-800' },
  fnf_pending:        { label: 'F&F Pending',        color: 'bg-indigo-100 text-indigo-800' },
  completed:          { label: 'Relieved',           color: 'bg-green-200 text-green-900' },
  withdrawn:          { label: 'Withdrawn',          color: 'bg-gray-200 text-gray-700' },
  cancelled:          { label: 'Cancelled',          color: 'bg-gray-100 text-gray-600' },
};

const CLEARANCE_DEPTS = [
  { key: 'hr',               label: 'HR Department',      icon: User },
  { key: 'it',               label: 'IT Department',      icon: Monitor },
  { key: 'admin',            label: 'Administration',     icon: ClipboardList },
  { key: 'finance',          label: 'Finance / Accounts', icon: DollarSign },
  { key: 'security',         label: 'Security',           icon: ShieldCheck },
  { key: 'reporting_manager',label: 'Reporting Manager',  icon: Activity },
  { key: 'project_manager',  label: 'Project Manager',    icon: BookOpen },
];

const DEFAULT_ASSETS = [
  { name: 'Laptop', type: 'laptop', serial_no: '', issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '' },
  { name: 'Mouse', type: 'mouse', serial_no: '', issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '' },
  { name: 'Keyboard', type: 'keyboard', serial_no: '', issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '' },
  { name: 'ID Card', type: 'id_card', serial_no: '', issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '' },
  { name: 'Access Card', type: 'access_card', serial_no: '', issued_date: '', returned_date: '', condition: '', status: 'pending', notes: '' },
];

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
    <div className="bg-gray-50 p-3 rounded-lg">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-sm capitalize mt-0.5">{value || '—'}</p>
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
  const [fnfData, setFnfData] = useState(initialRecord.fnf_data || {
    monthly_gross: '', leave_days: '', leave_encash: '',
    gratuity_amount: '', bonus: '', incentives: '', reimbursements: '',
    loan_recovery: '', advance_recovery: '', notice_recovery: '',
    buyout_recovery: '', other_deductions: '', gross_settlement: '', net_settlement: '',
  });
  const [loadingSalary, setLoadingSalary] = useState(false);
  const [generating, setGenerating] = useState('');

  useEffect(() => {
    base44.entities.Employee.list().then(list => setEmployees(list || [])).catch(() => {});
  }, []);

  const role = currentUser?.custom_role || currentUser?.role;
  const isHR = role === 'hr' || role === 'admin';
  const isManager = currentUser?.id === exit.manager_id || role === 'management' || role === 'manager';

  const addAudit = (existing, action, cmt) => ([
    ...(existing || []),
    { actor_id: currentUser.id, actor_name: currentUser.full_name, action, comment: cmt || '', timestamp: new Date().toISOString() }
  ]);

  const notifyExit = (action) => {
    base44.functions.invoke('notifyExitStatusChange', {
      action, exit_id: exit.id,
      employee_id: exit.user_id,
      employee_name: exit.user?.full_name || '',
      actor_name: currentUser?.full_name || 'HR',
    }).catch(() => {});
  };

  const saveExit = async (updates) => {
    setSaving(true);
    try {
      await base44.entities.Exit.update(exit.id, updates);
      setExit(prev => ({ ...prev, ...updates }));
      onRefresh();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  /* ── Approval Actions ── */
  const handleManagerAction = async (action) => {
    const newStatus = action === 'approved' ? 'manager_approved' : 'manager_rejected';
    const stages = (exit.approval_stages || []).map(s =>
      s.stage === 'manager' ? { ...s, status: action, actor_id: currentUser.id, actor_name: currentUser.full_name, comment, timestamp: new Date().toISOString() } : s
    );
    await saveExit({ status: newStatus, approval_stages: stages, manager_action: action, manager_comment: comment, manager_actioned_at: new Date().toISOString(), audit_log: addAudit(exit.audit_log, `Manager ${action}`, comment) });
    notifyExit(action === 'approved' ? 'manager_approved' : 'manager_rejected');
    toast.success(`Resignation ${action}`);
    setComment('');
  };

  const handleHRAction = async (action) => {
    const newStatus = action === 'approved' ? 'in_notice' : 'hr_rejected';
    const stages = (exit.approval_stages || []).map(s =>
      s.stage === 'hr' ? { ...s, status: action, actor_id: currentUser.id, actor_name: currentUser.full_name, comment, timestamp: new Date().toISOString() } : s
    );
    await saveExit({ status: newStatus, approval_stages: stages, hr_action: action, hr_comment: comment, hr_actioned_by: currentUser.id, hr_actioned_at: new Date().toISOString(), last_working_date: lwdEdit, audit_log: addAudit(exit.audit_log, `HR ${action}`, comment) });
    notifyExit(action === 'approved' ? 'hr_approved' : 'hr_rejected');
    toast.success(`Resignation ${action} by HR`);
    setComment('');
  };

  const handleWithdraw = async () => {
    if (!window.confirm('Are you sure you want to withdraw your resignation?')) return;
    await saveExit({ status: 'withdrawn', withdrawal_at: new Date().toISOString(), audit_log: addAudit(exit.audit_log, 'Resignation Withdrawn', '') });
    notifyExit('withdrawn');
    toast.success('Resignation withdrawn');
  };

  const handleStartClearance = async () => {
    const initAssets = assets.length ? assets : DEFAULT_ASSETS;
    await saveExit({ status: 'clearance_pending', assets: initAssets, audit_log: addAudit(exit.audit_log, 'Clearance initiated', '') });
    notifyExit('clearance_started');
    toast.success('Clearance process started');
  };

  const handleUpdateClearance = async (deptKey, status, notes) => {
    const updated = { ...(exit.clearance_checklist || {}), [deptKey]: { status, cleared_by: currentUser.full_name, cleared_at: new Date().toISOString(), notes } };
    const allCleared = CLEARANCE_DEPTS.every(d => updated[d.key]?.status === 'cleared');
    await saveExit({ clearance_checklist: updated, status: allCleared ? 'clearance_done' : 'clearance_pending', audit_log: addAudit(exit.audit_log, `${deptKey} clearance: ${status}`, notes) });
    if (allCleared) { notifyExit('clearance_done'); toast.success('All clearances done! Proceeding to F&F.'); }
    else toast.success(`${deptKey} clearance updated`);
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

  const handleProceedFnF = async () => {
    await saveExit({ status: 'fnf_pending', audit_log: addAudit(exit.audit_log, 'Proceeded to F&F settlement', '') });
    notifyExit('fnf_pending');
    toast.success('Moved to F&F settlement');
  };

  const handleSaveFnF = async () => {
    const gross = (Number(fnfData.leave_encash) || 0) + (Number(fnfData.gratuity_amount) || 0) +
      (Number(fnfData.bonus) || 0) + (Number(fnfData.incentives) || 0) + (Number(fnfData.reimbursements) || 0);
    const deductions = (Number(fnfData.loan_recovery) || 0) + (Number(fnfData.advance_recovery) || 0) +
      (Number(fnfData.notice_recovery) || 0) + (Number(fnfData.buyout_recovery) || 0) + (Number(fnfData.other_deductions) || 0);
    const net = gross - deductions;
    const updated = { ...fnfData, gross_settlement: gross, net_settlement: net, calculated_by: currentUser.full_name, calculated_at: new Date().toISOString() };
    setFnfData(updated);
    await saveExit({ fnf_data: updated, fnf_calculated: true, audit_log: addAudit(exit.audit_log, `F&F calculated: Net ₹${fmt(net)}`, '') });
    toast.success('F&F settlement saved');
  };

  const handleMarkCompleted = async () => {
    await saveExit({ status: 'completed', access_deactivated: true, relieving_letter_generated: true, experience_letter_generated: true, audit_log: addAudit(exit.audit_log, 'Exit completed. Access deactivated.', '') });
    const emps = await base44.entities.Employee.filter({ user_id: exit.user_id });
    if (emps.length > 0) await base44.entities.Employee.update(emps[0].id, { status: 'resigned', exit_date: exit.last_working_date });
    notifyExit('completed');
    toast.success('Employee relieved. Exit process completed.');
  };

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
              {isHR && exit.status === 'clearance_done' && (
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={handleProceedFnF} disabled={saving}><DollarSign className="w-4 h-4 mr-2" />Proceed to F&F Settlement</Button>
              )}
              {isHR && exit.status === 'fnf_pending' && exit.fnf_calculated && (
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleMarkCompleted} disabled={saving}><CheckCircle2 className="w-4 h-4 mr-2" />Mark as Relieved</Button>
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
                      ['fnf_letter', 'Full & Final Settlement Letter'],
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
                      <div className="flex items-center gap-3">
                        <div className="flex-1"><Label className="text-xs">Description</Label>
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
              <p className="text-sm text-gray-500">All departments must clear the employee before F&F settlement can proceed.</p>
              {CLEARANCE_DEPTS.map(dept => {
                const status = exit.clearance_checklist?.[dept.key]?.status || 'pending';
                const data = exit.clearance_checklist?.[dept.key] || {};
                const Icon = dept.icon;
                return (
                  <div key={dept.key} className={`border rounded-lg p-3 ${status === 'cleared' ? 'bg-green-50 border-green-200' : status === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Icon className={`w-5 h-5 flex-shrink-0 ${status === 'cleared' ? 'text-green-600' : status === 'rejected' ? 'text-red-600' : 'text-gray-400'}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{dept.label}</p>
                        {data.cleared_by && <p className="text-xs text-gray-500">By {data.cleared_by} · {data.cleared_at ? safeDate(data.cleared_at, 'dd MMM yyyy') : ''}</p>}
                        {data.notes && <p className="text-xs text-gray-600">{data.notes}</p>}
                      </div>
                      <Badge className={status === 'cleared' ? 'bg-green-100 text-green-700' : status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
                        {status === 'cleared' ? 'Cleared' : status === 'rejected' ? 'Issues Found' : 'Pending'}
                      </Badge>
                    </div>
                    {isHR && ['clearance_pending', 'clearance_done'].includes(exit.status) && (
                      <ClearanceDeptActions dept={dept.key} data={data} onUpdate={handleUpdateClearance} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ F&F SETTLEMENT ══ */}
          {activeTab === 'fnf' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Calculate the full & final settlement amount for the employee.</p>
              {isHR && (
                <Button size="sm" variant="outline" onClick={async () => {
                  setLoadingSalary(true);
                  try {
                    const res = await base44.functions.invoke('getEmployeeSalaryForFnF', { user_id: exit.user_id });
                    const d = res.data;
                    if (d?.success) {
                      const perDay = d.per_day_salary || (d.monthly_gross ? Math.round(d.monthly_gross / 26) : 0);
                      const leaveDays = d.leave_balance || 0;
                      const leaveEncash = Math.round(leaveDays * perDay);
                      setFnfData(p => ({
                        ...p,
                        monthly_gross: d.monthly_gross || '',
                        leave_days: leaveDays,
                        leave_encash: leaveEncash,
                        gratuity_amount: d.gratuity_eligible ? (d.gratuity_amount || '') : '',
                        loan_recovery: d.loan_outstanding > 0 ? String(d.loan_outstanding) : p.loan_recovery,
                        _per_day: perDay,
                      }));
                      toast.success(`Loaded: ₹${(d.monthly_gross||0).toLocaleString('en-IN')}/mo · ${leaveDays} leave days · ${d.gratuity_eligible ? 'gratuity eligible' : 'gratuity not eligible'}${d.loan_outstanding > 0 ? ` · loan due ₹${d.loan_outstanding.toLocaleString('en-IN')}` : ''}`);
                    } else {
                      toast.error(d?.error || 'Could not fetch salary data');
                    }
                  } catch (e) { toast.error('Failed: ' + e.message); }
                  setLoadingSalary(false);
                }} disabled={loadingSalary}>
                  {loadingSalary ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Auto-fill from Payroll
                </Button>
              )}

              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Earnings</p>
                <div className="border rounded-lg overflow-hidden">
                  {[
                    ['Monthly Gross (₹)', 'monthly_gross', 'Reference only'],
                    ['Leave Balance (days)', 'leave_days', 'Available earned leaves'],
                    ['Leave Encashment (₹)', 'leave_encash', 'leave_days × (gross/26)'],
                    ['Gratuity (₹)', 'gratuity_amount', '(basic×15×years)/26 if tenure ≥5 yrs'],
                    ['Bonus / Arrears (₹)', 'bonus', ''],
                    ['Incentives (₹)', 'incentives', ''],
                    ['Reimbursements (₹)', 'reimbursements', ''],
                  ].map(([label, key, hint]) => (
                    <div key={key} className="flex items-center gap-3 px-3 py-2 border-b last:border-0">
                      <span className="text-sm flex-1">{label}</span>
                      {hint && <span className="text-xs text-gray-400 hidden md:block">{hint}</span>}
                      {isHR ? (
                        <Input type="number" className="w-32 h-7 text-sm text-right" value={fnfData[key]} onChange={e => setFnfData(p => ({ ...p, [key]: e.target.value }))} placeholder="0" />
                      ) : (
                        <span className="text-sm font-medium w-32 text-right">₹{fmt(fnfData[key])}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Deductions / Recoveries</p>
                <div className="border rounded-lg overflow-hidden">
                  {[
                    ['Loan Recovery (₹)', 'loan_recovery'],
                    ['Advance Recovery (₹)', 'advance_recovery'],
                    ['Notice Period Recovery (₹)', 'notice_recovery'],
                    ['Buyout Recovery (₹)', 'buyout_recovery'],
                    ['Other Deductions (₹)', 'other_deductions'],
                  ].map(([label, key]) => (
                    <div key={key} className="flex items-center gap-3 px-3 py-2 border-b last:border-0">
                      <span className="text-sm flex-1">{label}</span>
                      {isHR ? (
                        <Input type="number" className="w-32 h-7 text-sm text-right" value={fnfData[key]} onChange={e => setFnfData(p => ({ ...p, [key]: e.target.value }))} placeholder="0" />
                      ) : (
                        <span className="text-sm font-medium w-32 text-right">₹{fmt(fnfData[key])}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              {(fnfData.gross_settlement || isHR) && (
                <div className="border-2 border-gray-900 rounded-lg overflow-hidden">
                  <div className="bg-gray-900 text-white px-4 py-2 text-sm font-semibold">Settlement Summary</div>
                  <div className="divide-y">
                    {[
                      ['Total Earnings', (Number(fnfData.leave_encash)||0)+(Number(fnfData.gratuity_amount)||0)+(Number(fnfData.bonus)||0)+(Number(fnfData.incentives)||0)+(Number(fnfData.reimbursements)||0), 'text-green-700'],
                      ['Total Deductions', (Number(fnfData.loan_recovery)||0)+(Number(fnfData.advance_recovery)||0)+(Number(fnfData.notice_recovery)||0)+(Number(fnfData.buyout_recovery)||0)+(Number(fnfData.other_deductions)||0), 'text-red-700'],
                    ].map(([label, val, color]) => (
                      <div key={label} className="flex justify-between px-4 py-2 text-sm">
                        <span>{label}</span><span className={`font-semibold ${color}`}>₹{fmt(val)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-4 py-3 font-bold text-base bg-gray-50">
                      <span>Net Settlement</span>
                      <span className="text-blue-700">₹{fmt(fnfData.net_settlement || (
                        (Number(fnfData.leave_encash)||0)+(Number(fnfData.gratuity_amount)||0)+(Number(fnfData.bonus)||0)+(Number(fnfData.incentives)||0)+(Number(fnfData.reimbursements)||0) -
                        (Number(fnfData.loan_recovery)||0)-(Number(fnfData.advance_recovery)||0)-(Number(fnfData.notice_recovery)||0)-(Number(fnfData.buyout_recovery)||0)-(Number(fnfData.other_deductions)||0)
                      ))}</span>
                    </div>
                  </div>
                </div>
              )}

              {isHR && (
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={handleSaveFnF} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />Calculate & Save F&F
                </Button>
              )}
              {fnfData.calculated_by && <p className="text-xs text-gray-400 text-center">Calculated by {fnfData.calculated_by} · {fnfData.calculated_at ? safeDate(fnfData.calculated_at, 'dd MMM yyyy') : ''}</p>}
            </div>
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

/* ── Clearance dept actions sub-component ── */
function ClearanceDeptActions({ dept, data, onUpdate }) {
  const [notes, setNotes] = useState(data.notes || '');
  return (
    <div className="mt-2 flex gap-2 flex-wrap">
      <Input className="flex-1 h-7 text-xs" placeholder="Remarks..." value={notes} onChange={e => setNotes(e.target.value)} />
      <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => onUpdate(dept, 'cleared', notes)}><CheckCircle2 className="w-3 h-3 mr-1" />Clear</Button>
      <Button size="sm" variant="outline" className="h-7 text-xs border-red-300 text-red-600" onClick={() => onUpdate(dept, 'rejected', notes)}><XCircle className="w-3 h-3 mr-1" />Issue Found</Button>
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
