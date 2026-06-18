import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from 'sonner';
import { CheckCircle2, XCircle, AlertCircle, ClipboardList, DollarSign, FileText, User, Calendar, Clock, CalendarClock, CalendarX } from 'lucide-react';
import ClearanceStatus from './ClearanceStatus';
import FnFSummary from './FnFSummary';
import { format } from 'date-fns';

const STATUS_CONFIG = {
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  manager_approved: { label: 'Mgr Approved', color: 'bg-yellow-100 text-yellow-800' },
  manager_rejected: { label: 'Mgr Rejected', color: 'bg-red-100 text-red-800' },
  hr_approved: { label: 'HR Approved', color: 'bg-green-100 text-green-800' },
  hr_rejected: { label: 'HR Rejected', color: 'bg-red-100 text-red-800' },
  in_notice: { label: 'In Notice', color: 'bg-orange-100 text-orange-800' },
  clearance_pending: { label: 'Clearance Pending', color: 'bg-purple-100 text-purple-800' },
  clearance_done: { label: 'Clearance Done', color: 'bg-teal-100 text-teal-800' },
  fnf_pending: { label: 'F&F Pending', color: 'bg-indigo-100 text-indigo-800' },
  completed: { label: 'Completed', color: 'bg-green-200 text-green-900' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-600' },
};

const CLEARANCE_DEPTS = ['hr', 'it', 'admin', 'finance', 'reporting_manager'];
const DEPT_LABELS = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', reporting_manager: 'Reporting Mgr' };

export default function ExitDetailPanel({ exitRecord, currentUser, onClose, onRefresh }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [comment, setComment] = useState('');
  const [lwdEdit, setLwdEdit] = useState(exitRecord.last_working_date);
  const [saving, setSaving] = useState(false);
  const role = currentUser?.custom_role || currentUser?.role;
  const isHR = role === 'hr' || role === 'admin';
  const isManager = currentUser?.id === exitRecord.manager_id || role === 'management';

  const addAuditLog = (existing, action, comment) => ([
    ...(existing || []),
    { actor_id: currentUser.id, actor_name: currentUser.full_name, action, comment: comment || '', timestamp: new Date().toISOString() }
  ]);

  const handleManagerAction = async (action) => {
    setSaving(true);
    const newStatus = action === 'approved' ? 'manager_approved' : 'manager_rejected';
    await base44.entities.Exit.update(exitRecord.id, {
      status: newStatus,
      manager_action: action,
      manager_comment: comment,
      manager_actioned_at: new Date().toISOString(),
      audit_log: addAuditLog(exitRecord.audit_log, `Manager ${action}`, comment)
    });
    toast.success(`Resignation ${action}`);
    setSaving(false);
    onRefresh();
  };

  const handleHRAction = async (action) => {
    setSaving(true);
    let newStatus = action === 'approved' ? 'hr_approved' : 'hr_rejected';
    if (action === 'approved') newStatus = 'in_notice';
    await base44.entities.Exit.update(exitRecord.id, {
      status: newStatus,
      hr_action: action,
      hr_comment: comment,
      hr_actioned_by: currentUser.id,
      hr_actioned_at: new Date().toISOString(),
      last_working_date: lwdEdit,
      audit_log: addAuditLog(exitRecord.audit_log, `HR ${action}`, comment)
    });
    toast.success(`Resignation ${action} by HR`);
    setSaving(false);
    onRefresh();
  };

  const handleStartClearance = async () => {
    setSaving(true);
    await base44.entities.Exit.update(exitRecord.id, {
      status: 'clearance_pending',
      audit_log: addAuditLog(exitRecord.audit_log, 'Clearance process initiated', '')
    });
    setSaving(false);
    onRefresh();
  };

  const handleUpdateClearance = async (dept, status, notes) => {
    const updated = {
      ...exitRecord.clearance_checklist,
      [dept]: { status, cleared_by: currentUser.full_name, cleared_at: new Date().toISOString(), notes }
    };
    const allCleared = CLEARANCE_DEPTS.every(d => updated[d]?.status === 'cleared');
    await base44.entities.Exit.update(exitRecord.id, {
      clearance_checklist: updated,
      status: allCleared ? 'clearance_done' : 'clearance_pending',
      audit_log: addAuditLog(exitRecord.audit_log, `${DEPT_LABELS[dept]} clearance marked as ${status}`, notes)
    });
    toast.success('Clearance updated');
    onRefresh();
  };

  const handleScheduleExitInterview = async (skip = false) => {
    setSaving(true);
    await base44.entities.Exit.update(exitRecord.id, {
      exit_interview_completed: skip ? true : exitRecord.exit_interview_completed,
      exit_interview: skip
        ? { ...exitRecord.exit_interview, primary_reason: 'Skipped by manager', completed_at: new Date().toISOString() }
        : exitRecord.exit_interview,
      audit_log: addAuditLog(exitRecord.audit_log, skip ? 'Exit interview skipped by manager' : 'Exit interview scheduled by manager', comment)
    });
    toast.success(skip ? 'Exit interview skipped' : 'Exit interview scheduled — employee will be notified');
    setSaving(false);
    onRefresh();
  };

  const handleMarkFnFPending = async () => {
    setSaving(true);
    await base44.entities.Exit.update(exitRecord.id, {
      status: 'fnf_pending',
      audit_log: addAuditLog(exitRecord.audit_log, 'F&F settlement initiated', '')
    });
    setSaving(false);
    onRefresh();
  };

  const handleMarkCompleted = async () => {
    setSaving(true);
    await base44.entities.Exit.update(exitRecord.id, {
      status: 'completed',
      access_deactivated: true,
      relieving_letter_generated: true,
      experience_letter_generated: true,
      audit_log: addAuditLog(exitRecord.audit_log, 'Exit completed. Access deactivated.', '')
    });
    // Mark employee as resigned
    const emps = await base44.entities.Employee.filter({ user_id: exitRecord.user_id });
    if (emps.length > 0) {
      await base44.entities.Employee.update(emps[0].id, { status: 'resigned', exit_date: exitRecord.last_working_date });
    }
    toast.success('Exit process completed');
    setSaving(false);
    onRefresh();
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: User },
    { id: 'clearance', label: 'Clearance', icon: ClipboardList },
    { id: 'fnf', label: 'F&F Settlement', icon: DollarSign },
    { id: 'interview', label: 'Exit Interview', icon: FileText },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <span className="text-red-600 font-bold">{exitRecord.user?.full_name?.charAt(0)}</span>
            </div>
            <div>
              <p>{exitRecord.user?.full_name || 'Employee'}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge className={STATUS_CONFIG[exitRecord.status]?.color || 'bg-gray-100'}>{STATUS_CONFIG[exitRecord.status]?.label || exitRecord.status}</Badge>
                <span className="text-sm font-normal text-gray-500">{exitRecord.employee?.designation} · {exitRecord.employee?.department}</span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 px-3 py-2 font-medium text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <Icon className="w-3.5 h-3.5" />{tab.label}
              </button>
            );
          })}
        </div>

        <div className="pt-2">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                {[
                  ['Resignation Date', exitRecord.resignation_date ? format(new Date(exitRecord.resignation_date), 'MMM d, yyyy') : '—'],
                  ['Last Working Day', exitRecord.last_working_date ? format(new Date(exitRecord.last_working_date), 'MMM d, yyyy') : '—'],
                  ['Exit Type', exitRecord.exit_type?.replace('_', ' ')],
                  ['Notice Period', `${exitRecord.notice_period_days || 0} days`],
                  ['Reason Category', exitRecord.reason_category?.replace(/_/g, ' ')],
                  ['Notice Buyout', exitRecord.notice_buyout ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <div key={label} className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-gray-500 text-xs">{label}</p>
                    <p className="font-medium capitalize mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm font-semibold text-gray-700 mb-1">Reason for Leaving</p>
                <p className="text-sm text-gray-600">{exitRecord.reason_for_leaving}</p>
              </div>

              {/* Manager Approval Section */}
              {isManager && exitRecord.status === 'submitted' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                  <p className="font-semibold text-yellow-800 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Manager Action Required</p>
                  <div>
                    <Label className="text-xs">Comment (optional)</Label>
                    <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Add comments..." />
                  </div>
                  {isHR && (
                    <div>
                      <Label className="text-xs">Adjust Last Working Day (if needed)</Label>
                      <Input type="date" value={lwdEdit} onChange={e => setLwdEdit(e.target.value)} />
                    </div>
                  )}
                  <div className="flex gap-3">
                    <Button className="bg-green-600 hover:bg-green-700 flex-1" disabled={saving} onClick={() => handleManagerAction('approved')}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                    </Button>
                    <Button className="bg-red-600 hover:bg-red-700 flex-1" disabled={saving} onClick={() => handleManagerAction('rejected')}>
                      <XCircle className="w-4 h-4 mr-2" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {/* HR Approval Section */}
              {isHR && exitRecord.status === 'manager_approved' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                  <p className="font-semibold text-green-800 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> HR Action Required</p>
                  <div>
                    <Label className="text-xs">Adjust Last Working Day (if needed)</Label>
                    <Input type="date" value={lwdEdit} onChange={e => setLwdEdit(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Comment (optional)</Label>
                    <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Add HR comments..." />
                  </div>
                  <div className="flex gap-3">
                    <Button className="bg-green-600 hover:bg-green-700 flex-1" disabled={saving} onClick={() => handleHRAction('approved')}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Approve & Start Notice
                    </Button>
                    <Button className="bg-red-600 hover:bg-red-700 flex-1" disabled={saving} onClick={() => handleHRAction('rejected')}>
                      <XCircle className="w-4 h-4 mr-2" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {/* Start Clearance */}
              {isHR && exitRecord.status === 'in_notice' && (
                <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={handleStartClearance} disabled={saving}>
                  <ClipboardList className="w-4 h-4 mr-2" /> Initiate Clearance Process
                </Button>
              )}

              {/* Mark F&F */}
              {isHR && exitRecord.status === 'clearance_done' && (
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={handleMarkFnFPending} disabled={saving}>
                  <DollarSign className="w-4 h-4 mr-2" /> Proceed to F&F Settlement
                </Button>
              )}

              {/* Complete Exit */}
              {isHR && exitRecord.status === 'fnf_pending' && exitRecord.fnf_calculated && (
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleMarkCompleted} disabled={saving}>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Mark Exit as Completed
                </Button>
              )}
            </div>
          )}

          {activeTab === 'clearance' && (
            <div className="space-y-4">
              <ClearanceStatus
                exitRecord={exitRecord}
                isEmployee={false}
                currentUser={currentUser}
                isHR={isHR}
                onUpdate={['clearance_pending', 'clearance_done'].includes(exitRecord.status) ? handleUpdateClearance : null}
              />
            </div>
          )}

          {activeTab === 'fnf' && (
            <FnFSummary exitRecord={exitRecord} currentUser={currentUser} isHR={isHR} onRefresh={onRefresh} />
          )}

          {activeTab === 'interview' && (
            <div className="space-y-4">
              {/* Manager / HR controls for exit interview */}
              {(isManager || isHR) && ['in_notice', 'clearance_pending', 'clearance_done', 'fnf_pending'].includes(exitRecord.status) && !exitRecord.exit_interview_completed && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <p className="font-semibold text-amber-800 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Exit Interview Management</p>
                  <p className="text-sm text-amber-700">The employee has not yet completed the exit interview. You can schedule a reminder or skip it.</p>
                  <div className="flex gap-3">
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 gap-2" disabled={saving} onClick={() => handleScheduleExitInterview(false)}>
                      <CalendarClock className="w-3.5 h-3.5" /> Schedule / Remind Employee
                    </Button>
                    <Button size="sm" variant="outline" className="border-gray-300 gap-2" disabled={saving} onClick={() => handleScheduleExitInterview(true)}>
                      <CalendarX className="w-3.5 h-3.5" /> Skip Interview
                    </Button>
                  </div>
                </div>
              )}

              {exitRecord.exit_interview_completed ? (
                <div className="space-y-4">
                  {exitRecord.exit_interview?.primary_reason === 'Skipped by manager' ? (
                    <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                      <CalendarX className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                      <p className="font-medium">Exit interview was skipped by manager</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid md:grid-cols-5 gap-3">
                        {[
                          ['Work Experience', exitRecord.exit_interview?.work_experience_rating],
                          ['Management', exitRecord.exit_interview?.management_rating],
                          ['Culture', exitRecord.exit_interview?.culture_rating],
                          ['Compensation', exitRecord.exit_interview?.compensation_rating],
                          ['Work-Life Balance', exitRecord.exit_interview?.work_life_balance_rating],
                        ].map(([label, rating]) => (
                          <div key={label} className="bg-gray-50 p-3 rounded-lg text-center">
                            <p className="text-xs text-gray-500">{label}</p>
                            <p className={`text-2xl font-bold mt-1 ${rating >= 4 ? 'text-green-600' : rating >= 3 ? 'text-yellow-600' : 'text-red-600'}`}>{rating || '—'}</p>
                            <p className="text-xs text-gray-400">/5</p>
                          </div>
                        ))}
                      </div>
                      {[
                        ['Primary Reason', exitRecord.exit_interview?.primary_reason],
                        ['Liked Most', exitRecord.exit_interview?.things_liked],
                        ['Could Improve', exitRecord.exit_interview?.things_disliked],
                        ['Suggestions', exitRecord.exit_interview?.suggestions],
                      ].map(([label, val]) => val && (
                        <div key={label} className="bg-blue-50 p-3 rounded-lg">
                          <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
                          <p className="text-sm text-gray-700">{val}</p>
                        </div>
                      ))}
                      <div className="flex gap-4 text-sm">
                        <span>Would Recommend: <strong>{exitRecord.exit_interview?.would_recommend_company === true ? 'Yes' : exitRecord.exit_interview?.would_recommend_company === false ? 'No' : '—'}</strong></span>
                        <span>Would Rejoin: <strong>{exitRecord.exit_interview?.would_rejoin === true ? 'Yes' : exitRecord.exit_interview?.would_rejoin === false ? 'No' : '—'}</strong></span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <FileText className="w-12 h-12 mx-auto mb-3" />
                  <p>Exit interview not yet completed by the employee.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClearanceUpdatePanel({ exitRecord, onUpdate }) {
  const DEPTS = [
    { key: 'hr', label: 'HR Department' },
    { key: 'it', label: 'IT Department' },
    { key: 'admin', label: 'Admin Department' },
    { key: 'finance', label: 'Finance Department' },
    { key: 'reporting_manager', label: 'Reporting Manager' },
  ];
  const [notes, setNotes] = useState({});

  return (
    <div className="border-t pt-4 space-y-3">
      <p className="font-semibold text-sm text-gray-700">Update Clearance Status</p>
      {DEPTS.map(dept => {
        const current = exitRecord.clearance_checklist?.[dept.key]?.status || 'pending';
        return (
          <div key={dept.key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg flex-wrap">
            <span className="text-sm font-medium flex-1">{dept.label}</span>
            <Input
              className="text-xs h-7 w-48"
              placeholder="Notes..."
              value={notes[dept.key] || ''}
              onChange={e => setNotes(prev => ({ ...prev, [dept.key]: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button size="sm" variant={current === 'cleared' ? 'default' : 'outline'}
                className={current === 'cleared' ? 'bg-green-600 hover:bg-green-700 h-7 text-xs' : 'h-7 text-xs'}
                onClick={() => onUpdate(dept.key, 'cleared', notes[dept.key])}>
                <CheckCircle2 className="w-3 h-3 mr-1" /> Clear
              </Button>
              <Button size="sm" variant={current === 'rejected' ? 'destructive' : 'outline'}
                className="h-7 text-xs"
                onClick={() => onUpdate(dept.key, 'rejected', notes[dept.key])}>
                <XCircle className="w-3 h-3 mr-1" /> Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}