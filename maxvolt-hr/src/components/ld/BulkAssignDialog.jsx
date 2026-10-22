import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { ld } from '@/lib/ld';
import { useEmployees, EmployeeSelect, Field } from '@/components/ld/shared';

// Assign trainer / HOD / HR contact / buddy to many running inductions at once.
// `ids` = the selected induction ids, or null for "every running induction".
export default function BulkAssignDialog({ open, onClose, ids = null, count, onDone }) {
  const emps = useEmployees();
  const [f, setF] = useState({ trainer: '', hod: '', hod_from_department: false, spoc: '', buddy: '', only_missing: true });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  const submit = async () => {
    if (!f.trainer && !f.hod && !f.hod_from_department && !f.spoc && !f.buddy) { toast.error('Choose at least one person to assign'); return; }
    setBusy(true);
    try {
      const r = await ld('ld_bulkAssignPeople', {
        ...(ids ? { induction_ids: ids } : { scope: 'all_open' }),
        trainer_user_id: f.trainer || undefined, hod_user_id: f.hod || undefined, hod_from_department: f.hod_from_department || undefined,
        hr_spoc_user_id: f.spoc || undefined, buddy_user_id: f.buddy || undefined, only_missing: f.only_missing,
      });
      toast.success(`${r.updated} of ${r.selected} induction(s) updated`);
      if (r.skipped?.length) toast.warning(r.skipped.slice(0, 3).join(' · '), { duration: 9000 });
      onDone?.(); onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign people — {ids ? `${count} selected induction${count === 1 ? '' : 's'}` : 'every running induction'}</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-500">The same person is set on all of them. A buddy is a peer, so assign buddies in smaller groups (for example one team at a time) — the new joiner and their Reporting Manager are skipped automatically.</p>
        <Field label="Trainer"><EmployeeSelect emps={emps} value={f.trainer} onChange={v => set('trainer', v)} placeholder="Leave unchanged" /></Field>
        <Field label="Head of department (HOD)">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.hod_from_department} onChange={e => set('hod_from_department', e.target.checked)} />Use each person&apos;s department head (from Departments)</label>
            {!f.hod_from_department && <EmployeeSelect emps={emps} value={f.hod} onChange={v => set('hod', v)} placeholder="Leave unchanged" />}
          </div>
        </Field>
        <Field label="HR contact (SPOC)"><EmployeeSelect emps={emps} value={f.spoc} onChange={v => set('spoc', v)} placeholder="Leave unchanged" /></Field>
        <Field label="Buddy"><EmployeeSelect emps={emps} value={f.buddy} onChange={v => set('buddy', v)} placeholder="Leave unchanged" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.only_missing} onChange={e => set('only_missing', e.target.checked)} />Only fill where nobody is assigned yet (do not overwrite)</label>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Assign</Button>
      </DialogContent>
    </Dialog>
  );
}
