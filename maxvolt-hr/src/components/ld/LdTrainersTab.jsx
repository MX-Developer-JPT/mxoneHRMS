import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus, Star } from 'lucide-react';
import { ld } from '@/lib/ld';
import { useEmployees, EmployeeSelect, Field } from '@/components/ld/shared';

export default function LdTrainersTab() {
  const emps = useEmployees();
  const [rows, setRows] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows((await ld('ld_listTrainers')).trainers); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!dlg.user_id) { toast.error('Select an employee'); return; }
    setBusy(true);
    try { await ld('ld_saveTrainer', { user_id: dlg.user_id, expertise: dlg.expertise.split(',').map(s => s.trim()).filter(Boolean), active: dlg.active, bio: dlg.bio }); toast.success('Trainer saved'); setDlg(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (!rows) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">Trainers can conduct sessions, mark attendance, assess, sign off practical capability, give feedback and request retraining. Assign a trainer to an induction from its detail page.</p>
        <Button size="sm" onClick={() => setDlg({ user_id: '', expertise: '', bio: '', active: true })}><Plus className="w-4 h-4 mr-1" />Add trainer</Button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {rows.length === 0 && <Card><CardContent className="p-6 text-sm text-gray-500">No trainers yet.</CardContent></Card>}
        {rows.map(t => (
          <Card key={t.id}><CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between"><div><div className="font-semibold">{t.name}</div><div className="text-xs text-gray-500">{(t.expertise || []).join(' · ') || 'No expertise listed'}</div></div>{t.active === false && <Badge variant="outline">Inactive</Badge>}</div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-gray-50 p-2"><div className="text-lg font-bold">{t.inductions}</div>Inductions</div>
              <div className="rounded bg-gray-50 p-2"><div className="text-lg font-bold">{t.signoffs}</div>Sign-offs</div>
              <div className="rounded bg-gray-50 p-2"><div className="text-lg font-bold flex items-center justify-center gap-1">{t.avg_rating ?? '—'}{t.avg_rating && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}</div>{t.feedback_count} rating(s)</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDlg({ user_id: t.user_id, expertise: (t.expertise || []).join(', '), bio: t.bio || '', active: t.active !== false })}>Edit</Button>
          </CardContent></Card>
        ))}
      </div>
      <Dialog open={!!dlg} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent><DialogHeader><DialogTitle>Trainer profile</DialogTitle></DialogHeader>
          {dlg && (
            <div className="space-y-3">
              <Field label="Employee"><EmployeeSelect emps={emps} value={dlg.user_id} onChange={v => setDlg(d => ({ ...d, user_id: v }))} /></Field>
              <Field label="Expertise (comma separated)"><Input value={dlg.expertise} onChange={e => setDlg(d => ({ ...d, expertise: e.target.value }))} placeholder="Safety, Maxvolt One, Production SOPs" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dlg.active} onChange={e => setDlg(d => ({ ...d, active: e.target.checked }))} />Active</label>
              <Button disabled={busy} onClick={save}>Save trainer</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
