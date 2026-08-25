import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, UserX } from 'lucide-react';
import { format } from 'date-fns';

const EXIT_TYPES = [
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'retired', label: 'Retired' },
];

export default function MarkEmployeeLeftDialog({ employee, onClose, onSaved }) {
  const [exitType, setExitType] = useState('resigned');
  const [lastWorkingDate, setLastWorkingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke('markEmployeeAsLeft', {
        user_id: employee.user_id, exit_type: exitType, last_working_date: lastWorkingDate, reason: reason.trim(),
      });
      const d = res?.data || res;
      if (d?.success) {
        toast.success(`${employee.user?.full_name || 'Employee'} marked as ${exitType}`);
        onSaved?.();
        onClose();
      } else toast.error(d?.error || 'Failed to mark employee as left');
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  if (!employee) return null;

  return (
    <Dialog open={!!employee} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserX className="w-5 h-5 text-red-600" />Mark as Left — {employee.user?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-sm text-gray-500">
            Use this only as a quick shortcut when the full resignation / clearance / F&F workflow (Exit Management) isn't needed. The employee moves straight to the Left Employees archive with no clearance record.
          </p>
          <div>
            <Label>Exit Type</Label>
            <Select value={exitType} onValueChange={setExitType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Last Working Date</Label>
            <Input type="date" value={lastWorkingDate} onChange={e => setLastWorkingDate(e.target.value)} />
          </div>
          <div>
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Any notes for the record..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserX className="w-4 h-4 mr-2" />}Mark as Left
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
