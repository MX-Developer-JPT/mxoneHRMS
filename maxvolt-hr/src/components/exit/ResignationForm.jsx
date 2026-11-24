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

export default function ResignationForm({ user, employee, onClose, onSubmitted }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  // The notice period, the standard last working day and who decides first come from the server (company policy / the employee's contract).
  const [policy, setPolicy] = useState(null);
  const noticeDays = policy?.notice_days ?? 30;
  const defaultLWD = policy?.standard_last_day || format(addDays(new Date(), noticeDays), 'yyyy-MM-dd');

  const [form, setForm] = useState({
    resignation_date: today,
    proposed_last_day: defaultLWD,
    reason_category: '',
    reason_for_leaving: '',
    detailed_comments: '',
    new_employer: '',
    expected_ctc: '',
    willing_to_serve_notice: 'yes',
    waiver_requested: false,
    supporting_documents: [],
    buyout_requested: false,
    buyout_days_requested: '',
  });
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1); // 1=details, 2=preview
  useEffect(() => {
    base44.functions.invoke('ex_get_policy', {}).then(r => {
      const d = r?.data;
      if (d?.success) { setPolicy(d); setForm(p => ({ ...p, resignation_date: d.today, proposed_last_day: d.standard_last_day, ...(d.draft?.form || {}), resignation_date: d.today })); if (d.draft) toast.message('Your saved draft was restored'); }
    }).catch(() => {});
  }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const reasons = policy?.reasons?.length ? policy.reasons.map(r => [r.key, r.label, !!r.remarks_required]) : REASON_CATEGORIES.map(([k, l]) => [k, l, k === 'other']);
  const reasonDef = reasons.find(r => r[0] === form.reason_category);
  const [uploading, setUploading] = useState(false);
  const saveDraft = async () => {
    try { await base44.functions.invoke('ex_save_draft', { form }); toast.success('Draft saved — you can finish it later'); } catch { toast.error('Could not save the draft'); }
  };
  const uploadDoc = async (file) => {
    if (!file) return;
    setUploading(true);
    try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); set('supporting_documents', [...(form.supporting_documents || []), { name: file.name, url: file_url }].slice(0, 5)); }
    catch { toast.error('Upload failed'); }
    setUploading(false);
  };

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
      const res = await base44.functions.invoke('ex_submit_resignation', {
        proposed_last_day: form.proposed_last_day,
        reason_category: form.reason_category,
        reason_for_leaving: form.reason_for_leaving,
        detailed_comments: form.detailed_comments,
        new_employer: form.new_employer,
        expected_ctc: form.expected_ctc,
        willing_to_serve_notice: form.willing_to_serve_notice,
        buyout_requested: noticeDaysShort > 0 && form.willing_to_serve_notice !== 'yes',
        buyout_days_requested: noticeDaysShort,
        waiver_requested: form.waiver_requested,
        supporting_documents: form.supporting_documents,
      });
      if (!res?.data?.success) { toast.error(res?.data?.error || 'Could not submit the resignation'); setSaving(false); return; }
      toast.success(`Resignation submitted — reference ${res.data.reference_no}`);

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
              <div><span className="text-gray-500">ID: </span><strong>{policy?.employee?.code || employee?.employee_code || '—'}</strong></div>
              <div><span className="text-gray-500">Dept: </span><strong>{policy?.employee?.department || employee?.department || '—'}</strong></div>
              <div><span className="text-gray-500">Designation: </span><strong>{policy?.employee?.designation || employee?.designation || '—'}</strong></div>
              <div><span className="text-gray-500">Joined: </span><strong>{policy?.employee?.date_of_joining ? String(policy.employee.date_of_joining).slice(0, 10) : '—'}</strong></div>
              <div><span className="text-gray-500">Type: </span><strong>{policy?.employee?.employment_type || '—'}</strong></div>
              <div><span className="text-gray-500">Location: </span><strong>{policy?.employee?.location || '—'}</strong></div>
              <div><span className="text-gray-500">Email: </span><strong>{policy?.employee?.email || user?.email || '—'}</strong></div>
              <div><span className="text-gray-500">Reporting manager: </span><strong>{policy?.manager?.name || '—'}</strong></div>
              {policy?.chain?.length > 0 && <div className="w-full text-xs text-gray-600">Approval path: {policy.chain.map(c => c.person ? `${c.label} (${c.person})` : c.label).join(' → ')}</div>}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Resignation Date *</Label>
                <Input type="date" value={form.resignation_date} disabled readOnly />
              </div>
              <div>
                <Label>Proposed Last Working Day *</Label>
                <Input type="date" value={form.proposed_last_day} min={form.resignation_date}
                  onChange={e => set('proposed_last_day', e.target.value)} required />
              </div>
            </div>

            {/* Notice period info */}
            <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${noticeDaysShort > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-200'}`}>
              <Info className={`w-4 h-4 mt-0.5 flex-shrink-0 ${noticeDaysShort > 0 ? 'text-orange-500' : 'text-blue-500'}`} />
              <div>
                <p className="font-medium">Notice Period: {noticeDays} days{policy?.notice_source ? ` (${policy.notice_source})` : ''}</p>
                {policy && <p className="text-gray-600">Standard last working day: {policy.standard_last_day}</p>}
                <p className="text-gray-600">Proposed: {proposedNoticeDays} days | LWD: {form.proposed_last_day}</p>
                {noticeDaysShort > 0 && (
                  <p className="text-orange-700 font-medium mt-0.5">{noticeDaysShort} day(s) short — HR decides whether this is allowed; the notice pay for these days is recovered in your full and final settlement unless HR waives it</p>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Reason Category *</Label>
                <Select value={form.reason_category} onValueChange={v => set('reason_category', v)}>
                  <SelectTrigger><SelectValue placeholder="Select reason..." /></SelectTrigger>
                  <SelectContent>
                    {reasons.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
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
              <Label>Detailed reason / remarks * {reasonDef?.[2] ? <span className="text-red-600 text-xs">(mandatory for “{reasonDef[1]}”)</span> : null}</Label>
              <Textarea value={form.reason_for_leaving} onChange={e => set('reason_for_leaving', e.target.value)}
                rows={3} placeholder="Brief reason for your resignation..." required />
            </div>

            <div>
              <Label>Additional comments (optional)</Label>
              <Textarea value={form.detailed_comments} onChange={e => set('detailed_comments', e.target.value)}
                rows={2} placeholder="Any additional details, suggestions, or feedback..." />
            </div>

            {form.willing_to_serve_notice !== 'yes' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Buyout Request
                </p>
                <p className="text-sm text-amber-800">{noticeDaysShort > 0 ? `You are asking to leave ${noticeDaysShort} day(s) before your notice ends. HR decides whether to allow it; the notice pay for those days is recovered in your full and final settlement unless HR waives it.` : 'Move the last working day earlier than the standard date above to request an early release.'}</p>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Request notice period waiver?</Label>
                <Select value={form.waiver_requested ? 'yes' : 'no'} onValueChange={v => set('waiver_requested', v === 'yes')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes — I request a waiver</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>Supporting document (optional)</Label>
                <Input type="file" disabled={uploading} onChange={e => uploadDoc(e.target.files?.[0])} />
                {(form.supporting_documents || []).map((d, i) => <p key={i} className="text-xs text-gray-600 mt-1 truncate">📎 {d.name}</p>)}
              </div>
            </div>

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
              <Button variant="outline" onClick={saveDraft} className="flex-1">Save draft</Button>
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
                  ['Reason', reasonDef?.[1] || form.reason_category],
                  ['Serving Full Notice', form.willing_to_serve_notice === 'yes' ? 'Yes' : 'No (Requesting buyout)'],
                  form.new_employer && ['New Employer', form.new_employer],
                ].filter(Boolean).map(([label, value]) => (
                  <div key={label} className="bg-white rounded p-2.5 min-w-0">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="font-medium break-words">{value}</p>
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
              {policy?.manager ? `Once submitted, your resignation goes to ${policy.manager.name} (your reporting manager) and then to HR.` : 'Once submitted, your resignation goes to HR (no active reporting manager is recorded for you).'} You can withdraw it directly until HR accepts it; after that HR decides on a withdrawal request.
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
