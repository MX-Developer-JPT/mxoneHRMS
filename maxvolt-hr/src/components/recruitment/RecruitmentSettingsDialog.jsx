import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { rh } from '@/lib/hiring';

const EVENTS = [
  ['cv_review_sent', 'CV review request sent', ['recruiter']], ['cv_batch_added', 'Additional CV batch submitted', ['recruiter']], ['review_pending', 'Pending review response (reminder)', ['recruiter']],
  ['review_decided', 'Manager / HOD decision recorded', ['recruiter', 'hr']], ['interview_scheduled', 'Interview scheduled', ['candidate', 'interviewer', 'recruiter']],
  ['interview_changed', 'Interview rescheduled / cancelled', ['candidate', 'interviewer', 'recruiter']], ['feedback_pending', 'Interview feedback pending', ['interviewer', 'recruiter']],
  ['candidate_selected', 'Candidate selected', ['recruiter', 'hiring_manager', 'hr']], ['candidate_rejected', 'Candidate rejected', ['recruiter']], ['offer_released', 'Offer released', ['recruiter', 'hiring_manager']], ['candidate_joined', 'Candidate joined', ['recruiter', 'hiring_manager', 'hr']],
];
const WHO = { recruiter: 'Recruiter', hr: 'HR', candidate: 'Candidate', interviewer: 'Interviewer', hiring_manager: 'Hiring Manager', hod: 'HOD' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RecruitmentSettingsDialog({ open, onClose, onSaved }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setCfg(null); rh('rh_config_get').then((d) => setCfg(d.config)).catch((e) => { toast.error(e.message); onClose?.(); }); } }, [open]);
  const save = async () => {
    setSaving(true);
    try { await rh('rh_config_save', cfg); toast.success('Recruitment settings saved'); onSaved?.(); onClose?.(); } catch (e) { toast.error(e.message); }
    setSaving(false);
  };
  const setRound = (i, patch) => setCfg({ ...cfg, rounds: cfg.rounds.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose?.()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Recruitment settings</DialogTitle></DialogHeader>
        {!cfg ? <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : (
          <div className="space-y-5 text-sm">
            <div>
              <p className="font-semibold mb-1">Interview rounds</p>
              <div className="space-y-1.5">
                {cfg.rounds.map((r, i) => (
                  <div key={r.key + i} className="flex items-center gap-2">
                    <input className="h-9 flex-1 rounded-md border border-gray-300 px-2" value={r.label} onChange={(e) => setRound(i, { label: e.target.value })} />
                    <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={r.active !== false} onChange={(e) => setRound(i, { active: e.target.checked })} />In use</label>
                    <Button size="icon" variant="ghost" onClick={() => setCfg({ ...cfg, rounds: cfg.rounds.filter((_, k) => k !== i) })}><Trash2 className="w-4 h-4 text-gray-400" /></Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setCfg({ ...cfg, rounds: [...cfg.rounds, { key: `round_${Date.now()}`, label: '', active: true }] })}><Plus className="w-4 h-4 mr-1" />Add round</Button>
            </div>
            <div>
              <p className="font-semibold mb-1">Business-day calculation (Recruitment MIS)</p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span>Weekly off:</span>{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={cfg.weekly_off.includes(i)} onChange={(e) => setCfg({ ...cfg, weekly_off: e.target.checked ? [...cfg.weekly_off, i] : cfg.weekly_off.filter((x) => x !== i) })} />{d}</label>)}
                <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={cfg.use_holidays} onChange={(e) => setCfg({ ...cfg, use_holidays: e.target.checked })} />Skip company holidays</label>
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-xs">
                <label className="flex items-center gap-1.5">Remind a reviewer after <input type="number" min={1} className="h-8 w-16 rounded-md border border-gray-300 px-2" value={cfg.review_reminder_days} onChange={(e) => setCfg({ ...cfg, review_reminder_days: Number(e.target.value) })} /> days</label>
              </div>
            </div>
            <div>
              <p className="font-semibold mb-1">Who is notified</p>
              <table className="w-full text-xs"><tbody>
                {EVENTS.map(([ev, label, who]) => (
                  <tr key={ev} className="border-t"><td className="py-1.5 pr-2">{label}</td>
                    {who.map((w) => <td key={w} className="px-2"><label className="flex items-center gap-1"><input type="checkbox" checked={(cfg.notify?.[ev]?.[w]) !== false} onChange={(e) => setCfg({ ...cfg, notify: { ...cfg.notify, [ev]: { ...(cfg.notify?.[ev] || {}), [w]: e.target.checked } } })} />{WHO[w]}</label></td>)}
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save settings</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
