import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { addDays, format, differenceInCalendarDays } from 'date-fns';
import { CalendarDays, Info, AlertCircle, Loader2, FileText } from 'lucide-react';

const REASON_CATEGORIES = [
  ['better_opportunity', 'Better Opportunity'],
  ['higher_education', 'Higher Education'],
  ['personal_reasons', 'Personal Reasons'],
  ['relocation', 'Relocation'],
  ['health_reasons', 'Health Reasons'],
  ['family_reasons', 'Family Reasons'],
  ['work_life_balance', 'Work-Life Balance'],
  ['compensation', 'Compensation / Benefits'],
  ['growth', 'Career Growth'],
  ['management_issues', 'Management Issues'],
  ['culture_fit', 'Culture / Environment'],
  ['mutual_separation', 'Mutual Separation'],
  ['contract_end', 'Contract End'],
  ['retirement', 'Retirement'],
  ['other', 'Other'],
];

function calcNoticeDays(emp) {
  const grade = (emp?.employee_grade || '').toLowerCase();
  const type  = (emp?.employment_type || '').toLowerCase();
  if (grade.includes('senior') || grade.includes('lead') || grade.includes('manager')) return 90;
  if (type.includes('contract') || type.includes('intern')) return 15;
  return 30;
}

export default function ResignationForm({ user, employee, onClose, onSubmitted }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const noticeDays = calcNoticeDays(employee);
  const defaultLWD = format(addDays(new Date(), noticeDays), 'yyyy-MM-dd');

  const [form, setForm] = useState({
    resignation_date: today,
    proposed_last_day: defaultLWD,
    reason_category: '',
    reason_for_leaving: '',
    detailed_comments: '',
    new_employer: '',
    expected_ctc: '',
    willing_to_serve_notice: 'yes',
    buyout_requested: false,
    buyout_days_requested: '',
  });
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1); // 1=details, 2=preview

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const noticeDaysServed = 0;
  const proposedNoticeDays = form.proposed_last_day
    ? differenceInCalendarDays(new Date(form.proposed_last_day), new Date(form.resignation_date))
    : noticeDays;
  const noticeDaysShort = Math.max(0, noticeDays - proposedNoticeDays);

  const handleSubmit = async () => {
    if (!form.reason_category) { toast.error('Please select a reason category'); return; }
    if (!form.reason_for_leaving.trim()) { toast.error('Please provide reason for leaving'); return; }
    if (!form.proposed_last_day) { toast.error('Please enter proposed last working day'); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      await base44.entities.Exit.create({
        user_id: user.id,
        exit_type: 'resignation',
        resignation_date: form.resignation_date,
        last_working_date: form.proposed_last_day,
        proposed_last_day: form.proposed_last_day,
        reason_category: form.reason_category,
        reason_for_leaving: form.reason_for_leaving,
        detailed_comments: form.detailed_comments,
        new_employer: form.new_employer,
        expected_ctc: form.expected_ctc,
        willing_to_serve_notice: form.willing_to_serve_notice === 'yes',
        buyout_requested: form.buyout_requested,
        buyout_days_requested: form.buyout_requested ? Number(form.buyout_days_requested) || 0 : 0,
        notice_period_days: noticeDays,
        notice_shortfall_days: noticeDaysShort,
        status: 'submitted',
        manager_id: employee?.reporting_manager_id || null,
        approval_stages: [
          { stage: 'manager', status: 'pending', actor_id: null, actor_name: null, comment: '', timestamp: null },
          { stage: 'hr', status: 'pending', actor_id: null, actor_name: null, comment: '', timestamp: null },
        ],
        clearance_checklist: {
          hr:               { status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
          it:               { status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
          admin:            { status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
          finance:          { status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
          security:         { status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
          reporting_manager:{ status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
          project_manager:  { status: 'pending', cleared_by: null, cleared_at: null, notes: '' },
        },
        assets: [],
        kt_items: [],
        exit_interview: null,
        hr_exit_interview: null,
        exit_interview_completed: false,
        hr_interview_completed: false,
        fnf_data: null,
        fnf_calculated: false,
        access_deactivated: false,
        relieving_letter_generated: false,
        experience_letter_generated: false,
        initiated_by_hr: false,
        audit_log: [{
          actor_id: user.id,
          actor_name: user.full_name,
          action: 'Resignation Submitted',
          comment: form.reason_category,
          timestamp: now,
        }],
        created_at: now,
      });

      base44.functions.invoke('notifyExitStatusChange', {
        action: 'submitted',
        employee_id: user.id,
        employee_name: user.full_name,
        manager_id: employee?.reporting_manager_id || null,
      }).catch(() => {});

      try {
        await base44.integrations.Core.SendEmail({
          to: user.email,
          subject: 'Resignation Submitted – Confirmation',
          body: `Dear ${user.full_name},\n\nYour resignation has been submitted successfully.\n\nResignation Date: ${form.resignation_date}\nProposed Last Working Day: ${form.proposed_last_day}\nNotice Period: ${noticeDays} days\n\nYour request is now pending manager approval. You will be notified at each stage.\n\nRegards,\nHR Team\nMaxvolt Energy Industries Limited`
        });
      } catch (_) {}

      onSubmitted?.();
    } catch (err) {
      toast.error('Failed to submit: ' + err.message);
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-red-700 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Submit Resignation
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            {/* Employee Info Banner */}
            <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap gap-4 text-sm">
              <div><span className="text-gray-500">Name: </span><strong>{user?.full_name}</strong></div>
              <div><span className="text-gray-500">ID: </span><strong>{employee?.employee_code || '—'}</strong></div>
              <div><span className="text-gray-500">Dept: </span><strong>{employee?.department || '—'}</strong></div>
              <div><span className="text-gray-500">Designation: </span><strong>{employee?.designation || '—'}</strong></div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Resignation Date *</Label>
                <Input type="date" value={form.resignation_date}
                  onChange={e => { set('resignation_date', e.target.value); set('proposed_last_day', format(addDays(new Date(e.target.value), noticeDays), 'yyyy-MM-dd')); }} required />
              </div>
              <div>
                <Label>Proposed Last Working Day *</Label>
                <Input type="date" value={form.proposed_last_day}
                  onChange={e => set('proposed_last_day', e.target.value)} required />
              </div>
            </div>

            {/* Notice period info */}
            <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${noticeDaysShort > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-200'}`}>
              <Info className={`w-4 h-4 mt-0.5 flex-shrink-0 ${noticeDaysShort > 0 ? 'text-orange-500' : 'text-blue-500'}`} />
              <div>
                <p className="font-medium">Notice Period: {noticeDays} days</p>
                <p className="text-gray-600">Proposed: {proposedNoticeDays} days | LWD: {form.proposed_last_day}</p>
                {noticeDaysShort > 0 && (
                  <p className="text-orange-700 font-medium mt-0.5">{noticeDaysShort} days short — buyout recovery may apply</p>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Reason Category *</Label>
                <Select value={form.reason_category} onValueChange={v => set('reason_category', v)}>
                  <SelectTrigger><SelectValue placeholder="Select reason..." /></SelectTrigger>
                  <SelectContent>
                    {REASON_CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Willing to Serve Full Notice?</Label>
                <Select value={form.willing_to_serve_notice} onValueChange={v => set('willing_to_serve_notice', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes — I will serve full notice</SelectItem>
                    <SelectItem value="no">No — Requesting early release</SelectItem>
                    <SelectItem value="partial">Partial — Requesting buyout for remaining days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Reason for Leaving *</Label>
              <Textarea value={form.reason_for_leaving} onChange={e => set('reason_for_leaving', e.target.value)}
                rows={3} placeholder="Brief reason for your resignation..." required />
            </div>

            <div>
              <Label>Detailed Comments (optional)</Label>
              <Textarea value={form.detailed_comments} onChange={e => set('detailed_comments', e.target.value)}
                rows={2} placeholder="Any additional details, suggestions, or feedback..." />
            </div>

            {form.willing_to_serve_notice !== 'yes' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Buyout Request
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Days Requested for Buyout</Label>
                    <Input type="number" min="1" value={form.buyout_days_requested}
                      onChange={e => { set('buyout_days_requested', e.target.value); set('buyout_requested', true); }}
                      placeholder="e.g. 30" />
                  </div>
                  <div className="flex items-end pb-1">
                    <p className="text-xs text-amber-700">HR/Finance will calculate the buyout amount based on your salary.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>New Employer (optional)</Label>
                <Input value={form.new_employer} onChange={e => set('new_employer', e.target.value)}
                  placeholder="Company name" />
              </div>
              <div>
                <Label>Expected CTC at New Job (optional)</Label>
                <Input type="number" value={form.expected_ctc} onChange={e => set('expected_ctc', e.target.value)}
                  placeholder="Annual CTC in ₹" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button onClick={() => setStep(2)} className="flex-1 bg-red-600 hover:bg-red-700">
                Review & Submit →
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" /> Please review your resignation details
              </p>
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                {[
                  ['Resignation Date', form.resignation_date],
                  ['Last Working Day', form.proposed_last_day],
                  ['Notice Period', `${noticeDays} days (serving ${proposedNoticeDays})`],
                  ['Reason', REASON_CATEGORIES.find(r => r[0] === form.reason_category)?.[1] || form.reason_category],
                  ['Serving Full Notice', form.willing_to_serve_notice === 'yes' ? 'Yes' : 'No (Requesting buyout)'],
                  form.new_employer && ['New Employer', form.new_employer],
                ].filter(Boolean).map(([label, value]) => (
                  <div key={label} className="bg-white rounded p-2.5">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 bg-white rounded p-2.5">
                <p className="text-xs text-gray-500">Reason</p>
                <p className="text-sm">{form.reason_for_leaving}</p>
              </div>
            </div>

            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              Once submitted, your resignation will be sent to your manager for approval. You can withdraw only before HR approval.
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">← Edit</Button>
              <Button onClick={handleSubmit} disabled={saving} className="flex-1 bg-red-600 hover:bg-red-700">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Confirm & Submit Resignation'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
