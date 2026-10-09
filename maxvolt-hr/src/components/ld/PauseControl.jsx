import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';

// Banner shown to employees / reviewers while HR has paused induction training.
export function PausedBanner({ paused }) {
  if (!paused) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm flex items-start gap-2">
      <PauseCircle className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold">Induction training is paused</div>
        <div>Paused by HR{paused.since ? ` on ${fmtDate(paused.since)}` : ''}{paused.reason ? ` — ${paused.reason}` : ''}. Nothing can be completed or signed off until it resumes; due dates will move forward by the number of days paused.</div>
      </div>
    </div>
  );
}

// HR / L&D admin control: pause or resume induction training for everyone.
export default function PauseControl() {
  const [cfg, setCfg] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCfg((await ld('ld_getConfig')).config); } catch { /* not an L&D admin */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!cfg) return null;

  const paused = !!cfg.paused;
  const queued = (cfg.queued_user_ids || []).length;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await ld('ld_setPause', { paused: !paused, reason });
      if (paused) toast.success(`Resumed — ${r.shifted || 0} induction(s) shifted by ${r.days || 0} day(s)${r.started ? `, ${r.started} queued joiner(s) started` : ''}`);
      else toast.success('Induction training paused for all employees');
      setDlg(false); setReason(''); await load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${paused ? 'border-amber-300 bg-amber-50' : 'bg-white'}`}>
        {paused ? <PauseCircle className="w-5 h-5 text-amber-600" /> : <PlayCircle className="w-5 h-5 text-green-600" />}
        <div className="text-sm flex-1 min-w-[200px]">
          {paused
            ? <><b>Induction training is PAUSED</b> since {fmtDate(cfg.paused_at)}{cfg.pause_reason ? ` — ${cfg.pause_reason}` : ''}. {queued > 0 && <span>{queued} new joiner(s) waiting to start on resume.</span>}</>
            : <><b>Induction training is running.</b> <span className="text-gray-500">Pause it to freeze all inductions (due dates shift on resume).</span></>}
        </div>
        <Button size="sm" variant={paused ? 'default' : 'outline'} onClick={() => setDlg(true)}>{paused ? 'Resume for all' : 'Pause for all'}</Button>
      </div>
      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>{paused ? 'Resume induction training?' : 'Pause induction training for all employees?'}</DialogTitle></DialogHeader>
          {paused
            ? <p className="text-sm text-gray-600">All open due dates move forward by the days paused, overdue flags are cleared where the new date allows, and {queued} queued new joiner(s) are started with due dates counted from today.</p>
            : <p className="text-sm text-gray-600">Every in-progress induction is frozen: nothing can be completed, submitted or signed off, no reminders or escalations go out, and new joiners approved meanwhile wait until you resume. You can still start an induction manually for any employee.</p>}
          {!paused && <Textarea placeholder="Reason (optional, shown to employees)" value={reason} onChange={e => setReason(e.target.value)} />}
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{paused ? 'Resume now' : 'Pause now'}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
