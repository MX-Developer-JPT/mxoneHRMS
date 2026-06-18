import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import { addDays, format } from 'date-fns';

const REASON_CATEGORIES = [
  ['better_opportunity', 'Better Opportunity'],
  ['personal_reasons', 'Personal Reasons'],
  ['higher_education', 'Higher Education'],
  ['relocation', 'Relocation'],
  ['health', 'Health Issues'],
  ['work_environment', 'Work Environment'],
  ['compensation', 'Compensation/Benefits'],
  ['career_growth', 'Career Growth'],
  ['other', 'Other'],
];

export default function ResignationForm({ user, employee, onClose, onSubmitted }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const noticeDays = employee?.notice_period_days || 30;
  const defaultLWD = format(addDays(new Date(), noticeDays), 'yyyy-MM-dd');

  const [form, setForm] = useState({
    resignation_date: today,
    last_working_date: defaultLWD,
    reason_category: 'other',
    reason_for_leaving: '',
    notice_buyout: false,
  });
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.reason_for_leaving.trim()) { toast.error('Please provide a reason for leaving'); return; }

    setSaving(true);
    const resDate = new Date(form.resignation_date);
    const lwdDate = new Date(form.last_working_date);
    const noticeDaysServed = Math.floor((lwdDate - resDate) / (1000 * 60 * 60 * 24));

    await base44.entities.Exit.create({
      user_id: user.id,
      exit_type: 'resignation',
      resignation_date: form.resignation_date,
      last_working_date: form.last_working_date,
      reason_category: form.reason_category,
      reason_for_leaving: form.reason_for_leaving,
      notice_period_days: noticeDays,
      notice_served_days: noticeDaysServed,
      notice_buyout: form.notice_buyout,
      status: 'submitted',
      manager_id: employee?.reporting_manager_id || null,
      manager_action: 'pending',
      hr_action: 'pending',
      audit_log: [{
        actor_id: user.id,
        actor_name: user.full_name,
        action: 'Resignation submitted',
        comment: '',
        timestamp: new Date().toISOString()
      }],
      clearance_checklist: {
        hr: { status: 'pending' },
        it: { status: 'pending' },
        admin: { status: 'pending' },
        finance: { status: 'pending' },
        reporting_manager: { status: 'pending' }
      }
    });

    // Send email notification
    try {
      await base44.integrations.Core.SendEmail({
        to: user.email,
        subject: 'Resignation Submitted - Confirmation',
        body: `Dear ${user.full_name},\n\nYour resignation has been submitted successfully.\n\nResignation Date: ${form.resignation_date}\nLast Working Day: ${form.last_working_date}\n\nYour request is pending manager approval. You will be notified at each stage.\n\nRegards,\nHR Team`
      });
    } catch (_) {}

    setSaving(false);
    onSubmitted();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-red-700">Submit Resignation</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Resignation Date *</Label>
              <Input type="date" value={form.resignation_date} onChange={e => set('resignation_date', e.target.value)} required />
            </div>
            <div>
              <Label>Last Working Day *</Label>
              <Input type="date" value={form.last_working_date} onChange={e => set('last_working_date', e.target.value)} required />
              <p className="text-xs text-gray-500 mt-1">Notice period: {noticeDays} days</p>
            </div>
          </div>
          <div>
            <Label>Reason Category *</Label>
            <Select value={form.reason_category} onValueChange={v => set('reason_category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASON_CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Detailed Reason *</Label>
            <Textarea
              placeholder="Please provide a detailed reason for your resignation..."
              value={form.reason_for_leaving}
              onChange={e => set('reason_for_leaving', e.target.value)}
              rows={4}
              required
            />
          </div>
          <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg">
            <input type="checkbox" id="buyout" checked={form.notice_buyout} onChange={e => set('notice_buyout', e.target.checked)} className="w-4 h-4" />
            <Label htmlFor="buyout" className="cursor-pointer text-sm">I want to opt for notice period buyout (if applicable)</Label>
          </div>
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-red-600 hover:bg-red-700" disabled={saving}>
              {saving ? 'Submitting...' : 'Submit Resignation'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}