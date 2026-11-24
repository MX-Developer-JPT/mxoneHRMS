import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Mail, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { rh, statusLabel } from '@/lib/hiring';

// Send one or many candidate profiles of ONE requisition to the Hiring Manager / HOD in a single email.
// They answer from the email (Shortlist / Reject / Hold / More information) — nothing is approved inside the app.
export default function CvReviewDialog({ open, onClose, requisitionId, candidates = [], onSent }) {
  const [opts, setOpts] = useState(null);
  const [remarks, setRemarks] = useState({});
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState([]);
  const [users, setUsers] = useState([]);
  const [resend, setResend] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || !requisitionId) return;
    setOpts(null); setResult(null); setRemarks({}); setNote(''); setExtra([]); setResend(false);
    rh('rh_review_options', { requisition_id: requisitionId }).then(setOpts).catch((e) => { toast.error(e.message); onClose?.(); });
    base44.functions.invoke('getAllUsers', {}).then((r) => setUsers(((r?.data || r)?.users || []).filter((u) => u.email && ['management', 'manager', 'hr', 'admin'].includes(u.role)))).catch(() => {});
  }, [open, requisitionId]);

  const send = async () => {
    setSending(true);
    try {
      const d = await rh('rh_review_create', { requisition_id: requisitionId, candidate_ids: candidates.map((c) => c.id), remarks, note, allow_resend: resend, extra_recipients: extra.map((u) => ({ user_id: u })) });
      setResult(d);
      toast.success(`${d.sent} profile(s) sent for review`);
      onSent?.(d);
    } catch (e) { toast.error(e.message); if (e.data?.skipped) setResult({ sent: 0, skipped: e.data.skipped }); }
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose?.(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-600" /> Send CVs for review</DialogTitle></DialogHeader>
        {!opts ? <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div> : result ? (
          <div className="space-y-3">
            <p className="text-sm"><b>{result.sent}</b> profile(s) were sent in one email to each reviewer{result.attachments ? `, with ${result.attachments} CV attachment(s)` : ''}.</p>
            {result.skipped?.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-medium text-amber-900 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Not sent</p><ul className="mt-1 list-disc ml-5 text-amber-800">{result.skipped.map((s, i) => <li key={i}>{s.name || s.id}: {s.reason}</li>)}</ul></div>}
            {result.email_errors?.length > 0 && <p className="text-sm text-red-600">Some emails failed: {result.email_errors.join('; ')}</p>}
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm">
              <p><b>{opts.requisition.id}</b> — {opts.requisition.title} · {opts.requisition.department}</p>
              <p className="text-xs text-gray-600 mt-1">Batch {opts.batches_sent + 1} for this requisition. Earlier batches stay as they are.</p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">Goes to</p>
              {opts.recipients.length === 0 ? <p className="text-sm text-red-600">No Hiring Manager or HOD with an email address is set for this requisition — add a reviewer below.</p> : (
                <ul className="text-sm space-y-1">{opts.recipients.map((r) => <li key={r.user_id} className="flex justify-between border rounded px-3 py-1.5"><span><b>{r.name}</b> · {r.role === 'hod' ? 'HOD' : 'Hiring Manager'}</span><span className="text-gray-500">{r.email || <span className="text-red-600">no email</span>}</span></li>)}</ul>
              )}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <select className="h-9 rounded-md border border-gray-300 px-2 text-sm" value="" onChange={(e) => e.target.value && setExtra((x) => [...new Set([...x, e.target.value])])}>
                  <option value="">+ Add another reviewer (management)…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
                </select>
                {extra.map((id) => <span key={id} className="text-xs bg-gray-100 rounded px-2 py-1">{users.find((u) => u.id === id)?.full_name || id} <button className="ml-1 text-gray-400" onClick={() => setExtra((x) => x.filter((v) => v !== id))}>×</button></span>)}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">{candidates.length} candidate{candidates.length === 1 ? '' : 's'} — add your remarks for each</p>
              <div className="space-y-2">
                {candidates.map((c) => (
                  <div key={c.id} className="border rounded-lg p-3">
                    <div className="flex justify-between text-sm"><b>{c.full_name}</b><span className="text-xs text-gray-500">{statusLabel(c.status)}{c.resume_url ? ' · CV attached' : ' · no CV on file'}</span></div>
                    <div className="text-xs text-gray-500 mt-0.5">{[c.experience_years !== undefined && c.experience_years !== '' ? `${c.experience_years} yrs` : '', c.current_company, c.expected_ctc ? `Expects ₹${Number(c.expected_ctc).toLocaleString('en-IN')}` : '', c.notice_period].filter(Boolean).join(' · ')}</div>
                    <input className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm" placeholder="HR / recruiter remarks (shown in the email)" value={remarks[c.id] || ''} onChange={(e) => setRemarks((r) => ({ ...r, [c.id]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
            <textarea className="w-full rounded-md border border-gray-300 p-2 text-sm" rows={2} placeholder="Note to the reviewers (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {candidates.some((c) => c.status === 'cv_sent') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} /> Send again the ones already awaiting a response</label>}
            <p className="text-xs text-gray-500">Reviewers answer from the email: one button per decision under each candidate. If they reply to the email instead, record the outcome on the candidate.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={send} disabled={sending || !candidates.length}>{sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />} Send for review</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
