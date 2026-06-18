import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

export default function HREmployeeEditPanel({ employee, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    uan_number: employee?.uan_number || '',
    pf_account_number: employee?.pf_account_number || '',
    pf_nominee: {
      name: employee?.pf_nominee?.name || '',
      relationship: employee?.pf_nominee?.relationship || '',
      date_of_birth: employee?.pf_nominee?.date_of_birth || '',
      share_percentage: employee?.pf_nominee?.share_percentage || 100,
    }
  });

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.Employee.update(employee.id, {
      uan_number: data.uan_number,
      pf_account_number: data.pf_account_number,
      pf_nominee: data.pf_nominee,
    });
    toast.success('UAN & PF details updated');
    setSaving(false);
    onSave?.();
    onClose();
  };

  if (!employee) return null;

  return (
    <Dialog open={!!employee} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit UAN & PF Details — {employee.user?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>UAN Number</Label>
              <Input value={data.uan_number} onChange={e => setData(p => ({ ...p, uan_number: e.target.value }))} placeholder="UAN Number" />
            </div>
            <div>
              <Label>PF Account Number</Label>
              <Input value={data.pf_account_number} onChange={e => setData(p => ({ ...p, pf_account_number: e.target.value }))} placeholder="PF Account Number" />
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold text-sm mb-3 text-gray-700">PF Nominee Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nominee Name</Label>
                <Input value={data.pf_nominee.name} onChange={e => setData(p => ({ ...p, pf_nominee: { ...p.pf_nominee, name: e.target.value } }))} placeholder="Full name" />
              </div>
              <div>
                <Label>Relationship</Label>
                <Input value={data.pf_nominee.relationship} onChange={e => setData(p => ({ ...p, pf_nominee: { ...p.pf_nominee, relationship: e.target.value } }))} placeholder="e.g. Spouse" />
              </div>
              <div>
                <Label>Date of Birth</Label>
                <Input type="date" value={data.pf_nominee.date_of_birth} onChange={e => setData(p => ({ ...p, pf_nominee: { ...p.pf_nominee, date_of_birth: e.target.value } }))} />
              </div>
              <div>
                <Label>Share %</Label>
                <Input type="number" min={1} max={100} value={data.pf_nominee.share_percentage} onChange={e => setData(p => ({ ...p, pf_nominee: { ...p.pf_nominee, share_percentage: e.target.value } }))} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}