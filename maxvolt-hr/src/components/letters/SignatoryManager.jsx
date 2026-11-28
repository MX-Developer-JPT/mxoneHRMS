import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Trash2, Pencil } from 'lucide-react';

const BLANK = { id: '', name: '', designation: '', signature: undefined, is_default: false };

// The people who sign HR letters: name, designation and (optionally) a picture of their signature.
export default function SignatoryManager({ open, onClose, signatories, onChange }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const pick = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { toast.error('Choose a PNG or JPG image'); return; }
    if (file.size > 400 * 1024) { toast.error('The image must be under 400 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, signature: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await base44.functions.invoke('sg_save', { ...form, id: form.id || undefined });
      onChange((r?.data || r).signatories);
      setForm(BLANK);
      toast.success('Signatory saved');
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const remove = async (s) => {
    if (!window.confirm(`Remove ${s.name} from the signatories? Letters already generated are not changed.`)) return;
    try {
      const r = await base44.functions.invoke('sg_delete', { id: s.id });
      onChange((r?.data || r).signatories);
      toast.success('Signatory removed');
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Authorised signatories</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-500">The default signatory is printed on every letter that has no other choice: company stamp, signature, then name and designation.</p>
        <div className="space-y-2">
          {signatories.map((s) => (
            <div key={s.id} className="border rounded-lg p-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{s.name}{s.is_default && <span className="ml-2 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Default</span>}</p>
                <p className="text-xs text-gray-500">{s.designation}</p>
              </div>
              {s.signature ? <img src={s.signature} alt="Signature" className="h-8 max-w-[100px] object-contain" /> : <span className="text-[11px] text-amber-700">No signature image</span>}
              <button aria-label="Edit" onClick={() => setForm({ ...s, signature: undefined })}><Pencil className="w-4 h-4 text-gray-500" /></button>
              <button aria-label="Remove" onClick={() => remove(s)}><Trash2 className="w-4 h-4 text-red-500" /></button>
            </div>
          ))}
          {!signatories.length && <p className="text-sm text-gray-400 text-center py-3">No signatory added yet.</p>}
        </div>
        <div className="border-t pt-3 space-y-2">
          <p className="text-sm font-medium">{form.id ? 'Edit signatory' : 'Add signatory'}</p>
          <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label className="text-xs">Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
          <div>
            <Label className="text-xs">Signature image (PNG or JPG, transparent background preferred){form.id ? ' — leave empty to keep the current one' : ''}</Label>
            <Input type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
            {form.signature && <img src={form.signature} alt="Selected signature" className="h-12 mt-1 object-contain" />}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />Use as the default signatory</label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.designation.trim()} className="flex-1">{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
            {form.id && <Button variant="ghost" onClick={() => setForm(BLANK)}>Cancel</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
