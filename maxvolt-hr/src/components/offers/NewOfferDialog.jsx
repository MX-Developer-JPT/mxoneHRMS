import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

// First step of a direct offer: pick someone already in recruitment, or add a new person (their recruitment record is
// created so the offer history has a home).
export default function NewOfferDialog({ open, candidates, onClose, onPick }) {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', designation: '', department: '' });
  const [saving, setSaving] = useState(false);
  const q = search.trim().toLowerCase();
  const matches = q ? candidates.filter((c) => `${c.full_name} ${c.email} ${c.phone || ''}`.toLowerCase().includes(q)).slice(0, 8) : [];

  const add = async () => {
    setSaving(true);
    try {
      const r = await base44.functions.invoke('of_create_candidate', form);
      const d = r?.data || r;
      if (d.existing) toast.info('This email is already in recruitment, so that record is used');
      setForm({ full_name: '', email: '', phone: '', designation: '', department: '' });
      onPick(d.candidate);
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create offer letter</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Existing candidate</Label>
            <Input placeholder="Search by name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
            {q && (
              <div className="border rounded-lg divide-y mt-2">
                {matches.map((c) => <button key={c.id} type="button" onClick={() => onPick(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-green-50"><span className="font-medium">{c.full_name}</span><span className="text-gray-400"> · {c.email} · {String(c.status || '').replace(/_/g, ' ')}</span></button>)}
                {!matches.length && <p className="p-3 text-sm text-gray-400">No candidate matches. Add them below.</p>}
              </div>
            )}
          </div>
          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">New candidate</p>
            {[['Full name', 'full_name'], ['Email', 'email'], ['Phone', 'phone'], ['Designation', 'designation'], ['Department', 'department']].map(([l, k]) => (
              <div key={k}><Label className="text-xs">{l}</Label><Input type={k === 'email' ? 'email' : 'text'} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
            ))}
            <Button onClick={add} disabled={saving || !form.full_name || !form.email || !form.phone} className="w-full bg-green-600 hover:bg-green-700">{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Continue to offer details</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
