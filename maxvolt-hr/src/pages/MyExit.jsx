import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { differenceInCalendarDays, format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import {
  LogOut, ClipboardList, MessageSquare, FileText, CheckCircle2, Clock, AlertCircle,
  Package, Activity, DollarSign, User, CalendarDays, ChevronRight, Star,
  RotateCcw, Loader2, BookOpen, Save, ShieldCheck, Monitor, Building2
} from 'lucide-react';
import ResignationForm from '../components/exit/ResignationForm';

const STATUS_STEPS = [
  { status: 'submitted',        label: 'Submitted',      desc: 'Awaiting manager approval' },
  { status: 'manager_approved', label: 'Mgr Approved',   desc: 'Awaiting HR review' },
  { status: 'in_notice',        label: 'Notice Period',  desc: 'Serving notice period' },
  { status: 'clearance_pending',label: 'Clearance',      desc: 'Dept clearances in progress' },
  { status: 'fnf_pending',      label: 'F&F Settlement', desc: 'Final settlement processing' },
  { status: 'completed',        label: 'Relieved',       desc: 'Exit process complete' },
];

const STATUS_LABELS = {
  submitted:          { label: 'Submitted',        color: 'bg-blue-100 text-blue-800' },
  manager_approved:   { label: 'Mgr Approved',     color: 'bg-yellow-100 text-yellow-800' },
  manager_rejected:   { label: 'Mgr Rejected',     color: 'bg-red-100 text-red-800' },
  hr_approved:        { label: 'HR Approved',       color: 'bg-green-100 text-green-800' },
  hr_rejected:        { label: 'HR Rejected',       color: 'bg-red-100 text-red-800' },
  in_notice:          { label: 'In Notice Period',  color: 'bg-orange-100 text-orange-800' },
  clearance_pending:  { label: 'Clearance Pending', color: 'bg-purple-100 text-purple-800' },
  clearance_done:     { label: 'Clearance Done',    color: 'bg-teal-100 text-teal-800' },
  fnf_pending:        { label: 'F&F Pending',       color: 'bg-indigo-100 text-indigo-800' },
  completed:          { label: 'Relieved',          color: 'bg-green-200 text-green-900' },
  withdrawn:          { label: 'Withdrawn',         color: 'bg-gray-200 text-gray-700' },
  cancelled:          { label: 'Cancelled',         color: 'bg-gray-100 text-gray-600' },
};

const CLEARANCE_DEPTS = [
  { key: 'hr',                label: 'HR Department',      icon: User },
  { key: 'it',                label: 'IT Department',      icon: Monitor },
  { key: 'admin',             label: 'Administration',     icon: Building2 },
  { key: 'finance',           label: 'Finance / Accounts', icon: DollarSign },
  { key: 'security',          label: 'Security',           icon: ShieldCheck },
  { key: 'reporting_manager', label: 'Reporting Manager',  icon: Activity },
  { key: 'project_manager',   label: 'Project Manager',    icon: BookOpen },
];

const INTERVIEW_QUESTIONS = [
  { key: 'work_experience_rating',   label: 'Work Experience',   type: 'rating' },
  { key: 'management_rating',        label: 'Management',        type: 'rating' },
  { key: 'culture_rating',           label: 'Culture',           type: 'rating' },
  { key: 'compensation_rating',      label: 'Compensation',      type: 'rating' },
  { key: 'work_life_balance_rating', label: 'Work-Life Balance', type: 'rating' },
  { key: 'primary_reason',   label: 'Primary reason for leaving?', type: 'text' },
  { key: 'things_liked',     label: 'What did you like most about working here?', type: 'textarea' },
  { key: 'things_disliked',  label: 'What could we have done better?', type: 'textarea' },
  { key: 'suggestions',      label: 'Any suggestions for the company?', type: 'textarea' },
];

function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }

export default function MyExit() {
  const [user, setUser]             = useState(null);
  const [exitRecord, setExitRecord] = useState(null);
  const [employee, setEmployee]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState('status');
  const [showResignForm, setShowResignForm] = useState(false);
  const [interview, setInterview]   = useState({});
  const [savingInterview, setSavingInterview] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const me = await base44.auth.me();
      setUser(me);
      const [exits, emps] = await Promise.all([
        base44.entities.Exit.filter({ user_id: me.id }),
        base44.entities.Employee.filter({ user_id: me.id }),
      ]);
      const ex = exits[0] || null;
      setExitRecord(ex);
      if (ex?.exit_interview) setInterview(ex.exit_interview);
      setEmployee(emps[0] || null);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" /></div>;

  const statusCfg = exitRecord ? (STATUS_LABELS[exitRecord.status] || { label: exitRecord.status, color: 'bg-gray-100' }) : null;

  // Notice period calculations
  const today = new Date();
  const resignDate  = exitRecord?.resignation_date ? new Date(exitRecord.resignation_date) : null;
  const lwdDate     = exitRecord?.last_working_date ? new Date(exitRecord.last_working_date) : null;
  const noticeDays  = exitRecord?.notice_period_days || 30;
  const daysServed  = resignDate ? Math.max(0, differenceInCalendarDays(today, resignDate)) : 0;
  const daysRemaining = lwdDate ? Math.max(0, differenceInCalendarDays(lwdDate, today)) : 0;
  const noticeProgress = Math.min(100, Math.round(daysServed / noticeDays * 100));

  const currentStepIdx = STATUS_STEPS.findIndex(s => s.status === exitRecord?.status);
  const effectiveStep = currentStepIdx >= 0 ? currentStepIdx : (['manager_rejected','hr_rejected'].includes(exitRecord?.status) ? -1 : 0);

  const handleWithdraw = async () => {
    if (!window.confirm('Are you sure you want to withdraw your resignation? This cannot be undone.')) return;
    try {
      await base44.entities.Exit.update(exitRecord.id, {
        status: 'withdrawn',
        withdrawal_at: new Date().toISOString(),
        audit_log: [...(exitRecord.audit_log || []), { actor_id: user.id, actor_name: user.full_name, action: 'Resignation Withdrawn', comment: '', timestamp: new Date().toISOString() }]
      });
      base44.functions.invoke('notifyExitStatusChange', { action: 'withdrawn', employee_id: user.id, employee_name: user.full_name }).catch(() => {});
      toast.success('Resignation withdrawn');
      loadData();
    } catch { toast.error('Failed to withdraw'); }
  };

  const handleSubmitInterview = async () => {
    const required = ['work_experience_rating','management_rating','culture_rating','compensation_rating','work_life_balance_rating','primary_reason'];
    for (const k of required) {
      if (!interview[k]) { toast.error('Please complete all required fields (ratings + primary reason)'); return; }
    }
    setSavingInterview(true);
    try {
      await base44.entities.Exit.update(exitRecord.id, {
        exit_interview: { ...interview, completed_at: new Date().toISOString() },
        exit_interview_completed: true,
        audit_log: [...(exitRecord.audit_log || []), { actor_id: user.id, actor_name: user.full_name, action: 'Exit interview submitted', comment: '', timestamp: new Date().toISOString() }]
      });
      toast.success('Exit interview submitted');
      loadData();
    } catch { toast.error('Failed to submit interview'); }
    setSavingInterview(false);
  };

  const tabs = [
    { id: 'status',    label: 'My Status',      icon: Clock,        show: true },
    { id: 'notice',    label: 'Notice Period',  icon: CalendarDays, show: !!exitRecord },
    { id: 'clearance', label: 'Clearance',      icon: ClipboardList,show: !!exitRecord },
    { id: 'interview', label: 'Exit Interview', icon: MessageSquare,show: !!exitRecord },
    { id: 'assets',    label: 'My Assets',      icon: Package,      show: !!exitRecord && ['clearance_pending','clearance_done','fnf_pending','completed'].includes(exitRecord?.status) },
    { id: 'documents', label: 'Documents',      icon: FileText,     show: !!exitRecord },
  ].filter(t => t.show);

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><LogOut className="w-8 h-8 text-red-600" />My Exit</h1>
            <p className="text-gray-600 mt-1">Manage your exit process and track your resignation</p>
          </div>
          {!exitRecord || ['withdrawn','cancelled'].includes(exitRecord?.status) ? (
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => setShowResignForm(true)}>
              <LogOut className="w-4 h-4 mr-2" />Submit Resignation
            </Button>
          ) : (
            <Badge className={`text-sm px-3 py-1 ${statusCfg?.color}`}>{statusCfg?.label}</Badge>
          )}
        </div>

        {/* No record state */}
        {(!exitRecord || ['withdrawn','cancelled'].includes(exitRecord?.status)) && (
          <Card className="border-2 border-dashed border-red-200">
            <CardContent className="py-16 text-center">
              <LogOut className="w-16 h-16 mx-auto text-red-300 mb-4" />
              <h3 className="text-xl font-semibold text-gray-700">No Active Exit Request</h3>
              <p className="text-gray-500 mt-2 mb-6">If you wish to resign, please submit your resignation below.<br/>Your request will be routed to your manager and HR for approval.</p>
              <Button className="bg-red-600 hover:bg-red-700" onClick={() => setShowResignForm(true)}>Submit Resignation</Button>
            </CardContent>
          </Card>
        )}

        {/* Rejected state */}
        {exitRecord && ['manager_rejected','hr_rejected'].includes(exitRecord.status) && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">Resignation Rejected</p>
                <p className="text-sm text-red-700 mt-1">
                  {exitRecord.status === 'manager_rejected' ? 'Your manager has rejected your resignation.' : 'HR has rejected your resignation.'}
                  {' '}Please contact HR for further assistance.
                </p>
                {(exitRecord.manager_comment || exitRecord.hr_comment) && (
                  <p className="text-xs text-red-600 mt-1">Reason: {exitRecord.manager_comment || exitRecord.hr_comment}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {exitRecord && !['withdrawn','cancelled'].includes(exitRecord.status) && (
          <>
            {/* Status stepper */}
            {!['manager_rejected','hr_rejected'].includes(exitRecord.status) && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between overflow-x-auto pb-2">
                    {STATUS_STEPS.map((step, i) => {
                      const done = effectiveStep > i;
                      const active = effectiveStep === i;
                      return (
                        <React.Fragment key={step.status}>
                          <div className={`flex flex-col items-center min-w-[60px] ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-40'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${done ? 'bg-green-500 text-white' : active ? 'bg-red-600 text-white ring-4 ring-red-100' : 'bg-gray-200 text-gray-500'}`}>
                              {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                            </div>
                            <p className={`text-xs mt-1 text-center leading-tight ${active ? 'font-bold text-red-700' : done ? 'text-green-700' : 'text-gray-400'}`}>{step.label}</p>
                          </div>
                          {i < STATUS_STEPS.length - 1 && (
                            <div className={`flex-1 h-0.5 mx-1 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b overflow-x-auto pb-0">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 font-medium text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                    <Icon className="w-4 h-4" />{tab.label}
                  </button>
                );
              })}
            </div>

            {/* ── MY STATUS ── */}
            {activeTab === 'status' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Resignation Date</p><p className="font-medium">{exitRecord.resignation_date ? safeDate(exitRecord.resignation_date, 'dd MMM yyyy') : '—'}</p></div>
                  <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Last Working Day</p><p className="font-medium">{exitRecord.last_working_date ? safeDate(exitRecord.last_working_date, 'dd MMM yyyy') : '—'}</p></div>
                  <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Notice Period</p><p className="font-medium">{noticeDays} days</p></div>
                  <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Exit Type</p><p className="font-medium capitalize">{exitRecord.exit_type?.replace(/_/g, ' ') || '—'}</p></div>
                </div>

                {exitRecord.reason_for_leaving && (
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <p className="text-xs font-semibold text-gray-600 mb-1">Your Reason</p>
                    <p className="text-sm">{exitRecord.reason_for_leaving}</p>
                  </div>
                )}

                {/* Approval stages */}
                {(exitRecord.approval_stages || []).map(stage => (
                  <div key={stage.stage} className={`rounded-lg p-3 border text-sm flex items-start gap-3 ${stage.status === 'approved' ? 'bg-green-50 border-green-200' : stage.status === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${stage.status === 'approved' ? 'bg-green-500' : stage.status === 'rejected' ? 'bg-red-500' : 'bg-gray-300'}`}>
                      {stage.status === 'approved' ? <CheckCircle2 className="w-4 h-4 text-white" /> : stage.status === 'rejected' ? <AlertCircle className="w-4 h-4 text-white" /> : <Clock className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium capitalize">{stage.stage} Review</p>
                      {stage.actor_name && <p className="text-xs text-gray-500">{stage.actor_name} · {stage.timestamp ? safeDate(stage.timestamp, 'dd MMM yyyy') : ''}</p>}
                      {stage.comment && <p className="text-xs text-gray-600 mt-0.5">{stage.comment}</p>}
                      {stage.status === 'pending' && <Badge className="bg-yellow-100 text-yellow-700 text-xs mt-1">Pending</Badge>}
                    </div>
                  </div>
                ))}

                {['submitted','manager_approved'].includes(exitRecord.status) && (
                  <Button variant="outline" className="w-full border-orange-300 text-orange-700 hover:bg-orange-50" onClick={handleWithdraw}>
                    <RotateCcw className="w-4 h-4 mr-2" />Withdraw Resignation
                  </Button>
                )}
              </div>
            )}

            {/* ── NOTICE PERIOD ── */}
            {activeTab === 'notice' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Notice', value: `${noticeDays} days`, color: 'text-gray-700', bg: 'bg-gray-50' },
                    { label: 'Days Served',  value: `${daysServed} days`, color: 'text-blue-700',  bg: 'bg-blue-50' },
                    { label: 'Remaining',    value: `${daysRemaining} days`, color: 'text-orange-700', bg: 'bg-orange-50' },
                    { label: 'Progress',     value: `${noticeProgress}%`,  color: 'text-green-700',  bg: 'bg-green-50' },
                  ].map(s => (
                    <div key={s.label} className={`${s.bg} p-4 rounded-xl`}>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Notice completion</span><span>{noticeProgress}%</span></div>
                  <div className="w-full bg-gray-200 rounded-full h-3"><div className={`h-3 rounded-full ${noticeProgress >= 100 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${noticeProgress}%` }} /></div>
                </div>
                {exitRecord.last_working_date && (
                  <div className={`rounded-lg p-4 text-center ${daysRemaining === 0 ? 'bg-green-50 border border-green-200' : daysRemaining <= 7 ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-200'}`}>
                    <CalendarDays className={`w-8 h-8 mx-auto mb-2 ${daysRemaining === 0 ? 'text-green-600' : daysRemaining <= 7 ? 'text-orange-600' : 'text-blue-600'}`} />
                    <p className="font-semibold">{daysRemaining === 0 ? 'Last Working Day Today!' : `${daysRemaining} days until Last Working Day`}</p>
                    <p className="text-sm text-gray-600 mt-1">{exitRecord.last_working_date ? safeDate(exitRecord.last_working_date, 'EEEE, dd MMMM yyyy') : ''}</p>
                  </div>
                )}
                {exitRecord.buyout_requested && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                    <p className="font-semibold text-amber-800">Buyout Request: {exitRecord.buyout_days_requested} days</p>
                    <p className="text-amber-700 mt-1">Status: {exitRecord.buyout_approved ? <span className="text-green-700 font-medium">Approved ({exitRecord.buyout_approved_days} days)</span> : exitRecord.buyout_rejected ? <span className="text-red-700 font-medium">Rejected</span> : <span className="text-yellow-700">Pending HR approval</span>}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── CLEARANCE ── */}
            {activeTab === 'clearance' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">Clearance is required from all departments before your F&F can be processed.</p>
                {CLEARANCE_DEPTS.map(dept => {
                  const data = exitRecord.clearance_checklist?.[dept.key] || { status: 'pending' };
                  const Icon = dept.icon;
                  return (
                    <div key={dept.key} className={`border rounded-lg p-3 flex items-center gap-3 ${data.status === 'cleared' ? 'bg-green-50 border-green-200' : data.status === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                      <Icon className={`w-5 h-5 ${data.status === 'cleared' ? 'text-green-600' : data.status === 'rejected' ? 'text-red-600' : 'text-gray-400'}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{dept.label}</p>
                        {data.cleared_by && <p className="text-xs text-gray-500">Cleared by {data.cleared_by}</p>}
                        {data.notes && <p className="text-xs text-gray-600">{data.notes}</p>}
                      </div>
                      <Badge className={data.status === 'cleared' ? 'bg-green-100 text-green-700' : data.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
                        {data.status === 'cleared' ? 'Cleared' : data.status === 'rejected' ? 'Issue Found' : 'Pending'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── EXIT INTERVIEW ── */}
            {activeTab === 'interview' && (
              <div className="space-y-4">
                {exitRecord.exit_interview_completed ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <p className="font-semibold text-green-700">Exit interview submitted</p>
                    </div>
                    {/* Ratings display */}
                    <div className="grid grid-cols-5 gap-2 mb-4">
                      {[['Work Exp','work_experience_rating'],['Management','management_rating'],['Culture','culture_rating'],['Compensation','compensation_rating'],['Work-Life','work_life_balance_rating']].map(([label, key]) => {
                        const rating = exitRecord.exit_interview?.[key];
                        return (
                          <div key={key} className="bg-gray-50 p-2 rounded text-center">
                            <p className="text-xs text-gray-500">{label}</p>
                            <p className={`text-xl font-bold mt-1 ${rating >= 4 ? 'text-green-600' : rating >= 3 ? 'text-yellow-600' : 'text-red-600'}`}>{rating || '—'}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  ['in_notice','clearance_pending','clearance_done','fnf_pending'].includes(exitRecord.status) ? (
                    <div className="space-y-4">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                        <p className="font-semibold text-amber-800">Please complete your exit interview</p>
                        <p className="text-amber-700 mt-1">Your feedback helps us improve. Ratings and comments are kept confidential.</p>
                      </div>

                      {/* Ratings */}
                      <div className="grid grid-cols-5 gap-2">
                        {[['Work Exp','work_experience_rating'],['Management','management_rating'],['Culture','culture_rating'],['Compensation','compensation_rating'],['Work-Life','work_life_balance_rating']].map(([label, key]) => (
                          <div key={key}>
                            <Label className="text-xs">{label}</Label>
                            <Select value={interview[key] || ''} onValueChange={v => setInterview(p => ({ ...p, [key]: v }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}/5 {n===1?'😞':n===2?'😕':n===3?'😐':n===4?'😊':'😍'}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>

                      {/* Text fields */}
                      {[['Primary Reason *','primary_reason','text'],['What did you like most?','things_liked','textarea'],['What could be improved?','things_disliked','textarea'],['Any suggestions?','suggestions','textarea']].map(([label, key, type]) => (
                        <div key={key}>
                          <Label className="text-xs">{label}</Label>
                          {type === 'textarea' ? (
                            <Textarea value={interview[key] || ''} onChange={e => setInterview(p => ({ ...p, [key]: e.target.value }))} rows={2} />
                          ) : (
                            <Input value={interview[key] || ''} onChange={e => setInterview(p => ({ ...p, [key]: e.target.value }))} />
                          )}
                        </div>
                      ))}

                      <div className="grid grid-cols-2 gap-3">
                        {[['Would you recommend us?','would_recommend_company'],['Would you rejoin?','would_rejoin']].map(([label, key]) => (
                          <div key={key}>
                            <Label className="text-xs">{label}</Label>
                            <Select value={String(interview[key] ?? '')} onValueChange={v => setInterview(p => ({ ...p, [key]: v === 'true' }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>

                      <Button className="w-full bg-red-600 hover:bg-red-700" disabled={savingInterview} onClick={handleSubmitInterview}>
                        {savingInterview ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Submit Exit Interview
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-gray-400">
                      <MessageSquare className="w-10 h-10 mx-auto mb-2" />
                      <p className="text-sm">Exit interview will be available once your notice period starts.</p>
                    </div>
                  )
                )}
              </div>
            )}

            {/* ── MY ASSETS ── */}
            {activeTab === 'assets' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">Assets you need to return before your last working day.</p>
                {(exitRecord.assets || []).length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    <Package className="w-8 h-8 mx-auto mb-2" />HR will update your asset list
                  </div>
                ) : (
                  (exitRecord.assets || []).map((asset, i) => (
                    <div key={i} className={`border rounded-lg p-3 flex items-center gap-3 ${asset.status === 'returned' ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                      <Package className={`w-5 h-5 ${asset.status === 'returned' ? 'text-green-600' : 'text-gray-400'}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{asset.name}</p>
                        {asset.serial_no && <p className="text-xs text-gray-500">S/N: {asset.serial_no}</p>}
                        {asset.notes && <p className="text-xs text-gray-600">{asset.notes}</p>}
                      </div>
                      <Badge className={asset.status === 'returned' ? 'bg-green-100 text-green-700' : asset.status === 'damaged' ? 'bg-orange-100 text-orange-700' : asset.status === 'missing' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
                        {asset.status === 'returned' ? 'Returned' : asset.status === 'damaged' ? 'Damaged' : asset.status === 'missing' ? 'Missing' : 'Pending'}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── DOCUMENTS ── */}
            {activeTab === 'documents' && (
              <div className="space-y-3">
                {['completed','fnf_pending'].includes(exitRecord.status) ? (
                  [
                    { label: 'Relieving Letter', available: exitRecord.relieving_letter_generated, desc: 'Official relieving from the organization' },
                    { label: 'Experience Letter', available: exitRecord.experience_letter_generated, desc: 'Certificate of employment and experience' },
                    { label: 'F&F Settlement Letter', available: exitRecord.fnf_calculated, desc: 'Full & final settlement details' },
                  ].map(doc => (
                    <div key={doc.label} className={`flex items-center justify-between p-4 rounded-lg border ${doc.available ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        {doc.available ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Clock className="w-5 h-5 text-gray-400" />}
                        <div>
                          <p className="font-medium text-sm">{doc.label}</p>
                          <p className="text-xs text-gray-500">{doc.desc}</p>
                        </div>
                      </div>
                      {doc.available ? (
                        <Badge className="bg-green-100 text-green-700">Ready</Badge>
                      ) : (
                        <Badge className="bg-yellow-100 text-yellow-700">Pending</Badge>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-gray-400">
                    <FileText className="w-10 h-10 mx-auto mb-2" />
                    <p className="text-sm">Documents will be available after your exit is completed.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Resignation form dialog */}
        {showResignForm && (
          <ResignationForm
            user={user}
            employee={employee}
            onClose={() => setShowResignForm(false)}
            onSubmitted={() => { setShowResignForm(false); loadData(); toast.success('Resignation submitted successfully'); }}
          />
        )}
      </div>
    </div>
  );
}
