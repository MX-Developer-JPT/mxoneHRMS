import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Check, X, Undo2, Send, Pause, Play, CheckCircle2, Ban, CalendarClock, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, statusOf, PRIORITY_CLS, STAGES, stageIndex, fmt, labelOf } from '@/lib/mrf';
import JdPanel, { JdText } from './JdPanel';
import { SearchSelect } from './Pickers';

const CHANNELS = ['Careers page', 'LinkedIn', 'Naukri', 'Indeed', 'Employee referral', 'Campus / placement cell'];

function Progress({ status }) {
  const at = stageIndex(status);
  return (
    <ol className="flex items-center gap-1 text-[11px] overflow-x-auto pb-1" aria-label="Workflow progress">
      {STAGES.map(([k, l], i) => (
        <li key={k} className="flex items-center gap-1 shrink-0">
          <span className={`px-2.5 py-1 rounded-full border ${i < at ? 'bg-green-100 border-green-300 text-green-800' : i === at ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`}>{i < at ? '✓ ' : ''}{l}</span>
          {i < STAGES.length - 1 && <span className="text-muted-foreground">›</span>}
        </li>
      ))}
    </ol>
  );
}
const Row = ({ k, v }) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? null : (
  <div className="text-sm"><span className="text-muted-foreground">{k}: </span><span className="font-medium">{Array.isArray(v) ? v.join(', ') : String(v)}</span></div>
));

/** Everything about one requisition and the actions the signed-in person may take on it (the server re-checks every one). */
export default function MrfDetail({ id, onClose, masters, onChanged, onEdit }) {
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState(null);          // { title, needsReason, run(reason) }
  const [reason, setReason] = useState('');
  const [pub, setPub] = useState(null);          // publish dialog state
  const [extend, setExtend] = useState(null);
  const [reassign, setReassign] = useState(null);   // { hms, to, reason }

  const load = async () => { try { const d = await mrf('mrf_get', { id }); setRec(d.requisition); } catch (e) { toast.error(e.message); onClose(); } };
  useEffect(() => { if (id) { setRec(null); load(); } }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try { const d = await fn(); if (d?.requisition) setRec((p) => ({ ...p, ...d.requisition, permissions: p?.permissions })); await load(); onChanged?.(); if (okMsg) toast.success(okMsg); }
    catch (e) { toast.error(e.message); }
    setBusy('');
  };
  if (!id) return null;
  const p = rec?.permissions || {};
  const st = rec ? statusOf(rec) : null;
  const L = (kind, v) => labelOf(masters, kind, v);
  const status = rec?.status;
  const jdPerms = { can_generate: !!p.can_generate_jd, can_edit: !!p.can_edit_jd };
  const needAsk = (title, needsReason, run, label = 'Confirm', placeholder) => { setReason(''); setAsk({ title, needsReason, run, label, placeholder }); };
  const openReassign = async () => { try { const d = await mrf('mrf_hiring_managers', { department: rec.department }); setReassign({ hms: d.managers || [], to: '', reason: '' }); } catch (e) { toast.error(e.message); } };
  const openVacancies = Math.max(0, (Number(rec?.number_of_positions) || 1) - (Number(rec?.positions_filled) || 0));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[96vw] max-h-[94vh] overflow-y-auto">
        {!rec ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {rec.designation} <span className="font-mono text-sm font-normal text-muted-foreground">{rec.requisition_id}</span>
                <Badge className={st.cls}>{st.label}</Badge><Badge className={PRIORITY_CLS[rec.priority] || ''}>{L('priority', rec.priority)}</Badge>
              </DialogTitle>
            </DialogHeader>
            <Progress status={status} />

            {rec.changes_request && status === 'changes_requested' && (
              <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm"><b>{rec.changes_request.by_name}</b> ({rec.changes_request.from === 'hr' ? 'HR' : 'Hiring Manager'}) asked for changes: “{rec.changes_request.comment}”</div>
            )}
            {rec.rejection_reason && status === 'rejected' && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm">Rejected: {rec.rejection_reason}</div>}
            {rec.unpublished_reason && status === 'pending_hm_approval' && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">{rec.unpublished_reason}</div>}

            <div className="grid md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs font-bold uppercase text-muted-foreground mb-1">Requisition</p>
                <Row k="Department" v={rec.department} /><Row k="Type" v={L('requisition_type', rec.requisition_type)} /><Row k="Tier" v={rec.position_tier === 'other_custom' ? rec.position_tier_custom : L('position_tier', rec.position_tier)} />
                <Row k="Vacancies" v={`${rec.number_of_positions}${rec.positions_filled ? ` (${rec.positions_filled} filled)` : ''}`} /><Row k="Applications received" v={rec.applications || ''} /><Row k="Employment" v={L('employment_type', rec.employment_type)} /><Row k="Raised by" v={rec.requested_by_name} />
                <Row k="Hiring Manager" v={rec.hiring_manager_name} /><Row k="Reports to" v={rec.reports_to_name} /><Row k="Date" v={fmt(rec.requisition_date)} />
                <Row k="Replacing" v={rec.replaced_employee_name ? `${rec.replaced_employee_name}${rec.replaced_employee_code ? ` (${rec.replaced_employee_code})` : ''} — ${rec.replacement_reason || ''}` : ''} />
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs font-bold uppercase text-muted-foreground mb-1">Requirements</p>
                <Row k="Experience" v={rec.experience_required} /><Row k="Education" v={rec.qualification} /><Row k="Specialisation" v={rec.specialisation} />
                <Row k="Required skills" v={rec.required_skills} /><Row k="Technical" v={rec.technical_skills} /><Row k="Preferred" v={rec.preferred_skills} /><Row k="Industry" v={rec.industry_experience} /><Row k="Certifications" v={rec.certifications} />
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs font-bold uppercase text-muted-foreground mb-1">Compensation, location & timeline</p>
                <Row k="CTC" v={rec.ctc_min != null || rec.ctc_max != null ? `₹${Number(rec.ctc_min || 0).toLocaleString('en-IN')} – ₹${Number(rec.ctc_max || 0).toLocaleString('en-IN')} ${rec.ctc_frequency === 'monthly' ? '/ month' : 'p.a.'}${rec.disclose_ctc ? ' (public)' : ' (internal)'}` : ''} />
                <Row k="Budget approved" v={rec.budget_approved ? `Yes${rec.budget_reference ? ` — ${rec.budget_reference}` : ''}` : 'No'} />
                <Row k="Location" v={rec.location} /><Row k="Arrangement" v={L('work_arrangement', rec.work_arrangement)} /><Row k="Target hiring date" v={rec.target_hire_date ? fmt(rec.target_hire_date) : ''} /><Row k="Timeline note" v={rec.timeline_justification} />
                <Row k="Channels" v={rec.publish_channels} /><Row k="Published" v={rec.published_date ? fmt(rec.published_date) : ''} />
              </div>
            </div>
            {(rec.position_overview || rec.purpose_of_hiring || (rec.key_responsibilities || []).length > 0) && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="text-xs font-bold uppercase text-muted-foreground">Job brief</p>
                {rec.position_overview && <p>{rec.position_overview}</p>}{rec.purpose_of_hiring && <p><b>Purpose:</b> {rec.purpose_of_hiring}</p>}
                {(rec.key_responsibilities || []).length > 0 && <ul className="list-disc pl-5">{rec.key_responsibilities.map((x) => <li key={x}>{x}</li>)}</ul>}
                {rec.additional_notes && <p><b>Notes:</b> {rec.additional_notes}</p>}
              </div>
            )}

            <div>
              <p className="text-sm font-semibold mb-2">Job Description</p>
              {status === 'pending_hr_publication' || status === 'published' || status === 'on_hold'
                ? <div className="rounded-lg border bg-white p-5 max-h-[420px] overflow-y-auto"><JdText text={rec.approved_jd?.text || rec.jd_current_text} /><p className="text-xs text-green-700 mt-3">🔒 Approved version {rec.approved_jd?.version} — locked. Only the Hiring Manager can change it (which voids the approval).</p></div>
                : null}
              {(p.can_edit_jd || ['draft', 'changes_requested', 'pending_hm_approval'].includes(status)) && (
                <JdPanel rec={rec} ensureSaved={async () => rec.id} perms={jdPerms} onUpdated={(r) => { setRec((x) => ({ ...x, ...r, permissions: x.permissions })); load(); onChanged?.(); }} />
              )}
              {!p.can_edit_jd && ['closed', 'cancelled', 'rejected'].includes(status) && <div className="rounded-lg border bg-white p-5 max-h-[420px] overflow-y-auto"><JdText text={rec.approved_jd?.text || rec.jd_current_text} /></div>}
            </div>

            {/* actions */}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {p.can_reassign_hm && <Button variant="outline" onClick={openReassign}>Change Hiring Manager</Button>}
              {p.can_edit_details && <Button variant="outline" onClick={() => onEdit?.(rec)}><Pencil className="w-4 h-4 mr-1.5" />Edit details{status === 'changes_requested' ? ' & resubmit' : ''}</Button>}
              {p.can_decide && (
                <>
                  <Button className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => act('approve', () => mrf('mrf_hm_decide', { id, action: 'approve', version: (rec.jd_versions || []).length }), 'Job Description approved — sent to HR for publication')}>
                    {busy === 'approve' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}Approve JD
                  </Button>
                  <Button variant="outline" onClick={() => needAsk('Request changes to the requisition details', true, (r) => mrf('mrf_hm_decide', { id, action: 'request_changes', comment: r }), 'Send back')}><Undo2 className="w-4 h-4 mr-1.5" />Request changes</Button>
                  <Button variant="destructive" onClick={() => needAsk('Reject this requisition', true, (r) => mrf('mrf_hm_decide', { id, action: 'reject', comment: r }), 'Reject')}><X className="w-4 h-4 mr-1.5" />Reject</Button>
                </>
              )}
              {p.publisher && status === 'pending_hr_publication' && (
                <>
                  <Button disabled={!!busy} onClick={() => setPub({ channels: ['Careers page'], deadline: '', notes: rec.hr_notes || '' })}><Send className="w-4 h-4 mr-1.5" />Publish</Button>
                  <Button variant="outline" onClick={() => needAsk('Return for corrections (to the creator)', true, (r) => mrf('mrf_hr_action', { id, action: 'return', to: 'creator', comment: r }), 'Return')}><Undo2 className="w-4 h-4 mr-1.5" />Return to creator</Button>
                  <Button variant="outline" onClick={() => needAsk('Send a JD change request to the Hiring Manager (the approval is voided)', true, (r) => mrf('mrf_hr_action', { id, action: 'return', to: 'hiring_manager', comment: r }), 'Send')}>Propose JD change</Button>
                </>
              )}
              {p.publisher && ['published', 'pending_hr_publication'].includes(status) && <Button variant="outline" onClick={() => needAsk('Put this requisition on hold', false, (r) => mrf('mrf_status', { id, to: 'on_hold', reason: r }), 'Put on hold')}><Pause className="w-4 h-4 mr-1.5" />Hold</Button>}
              {p.publisher && status === 'on_hold' && <Button variant="outline" onClick={() => act('resume', () => mrf('mrf_status', { id, to: 'resume' }), 'Resumed')}><Play className="w-4 h-4 mr-1.5" />Resume</Button>}
              {p.publisher && ['published', 'on_hold', 'pending_hr_publication'].includes(status) && (
                <>
                  <Button variant="outline" className="text-emerald-700" onClick={() => (rec.number_of_positions > 1
                    ? needAsk(`How many of the ${openVacancies} open positions were filled?`, true, (r) => mrf('mrf_status', { id, to: 'filled', count: Number(r) || 0 }), 'Save', 'Number filled (e.g. 1)')
                    : needAsk('Mark this requisition as filled', false, (r) => mrf('mrf_status', { id, to: 'filled', reason: r }), 'Mark filled'))}><CheckCircle2 className="w-4 h-4 mr-1.5" />Filled</Button>
                  <Button variant="outline" onClick={() => needAsk('Close this requisition without filling', false, (r) => mrf('mrf_status', { id, to: 'closed', reason: r }), 'Close')}>Close</Button>
                  <Button variant="outline" onClick={() => setExtend({ date: rec.target_hire_date || '', note: '' })}><CalendarClock className="w-4 h-4 mr-1.5" />Target date</Button>
                </>
              )}
              {(p.publisher || (p.creator && ['draft', 'pending_hm_approval', 'changes_requested'].includes(status))) && !['closed', 'cancelled', 'rejected'].includes(status) && (
                <Button variant="ghost" className="text-red-600" onClick={() => needAsk('Cancel this requisition', true, (r) => mrf('mrf_status', { id, to: 'cancelled', reason: r }), 'Cancel requisition')}><Ban className="w-4 h-4 mr-1.5" />Cancel</Button>
              )}
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer font-medium">Audit trail ({(rec.audit || []).length})</summary>
              <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                {[...(rec.audit || [])].reverse().map((a, i) => (
                  <li key={i} className="border-l-2 pl-2"><span className="text-muted-foreground">{fmt(a.at, true)}</span> · <b>{a.by_name}</b> · {a.action.replace(/_/g, ' ')}{a.detail ? ` — ${a.detail}` : ''}
                    {(a.changes || []).slice(0, 12).map((c, j) => <div key={j} className="pl-3 text-muted-foreground">{c.field}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</div>)}</li>
                ))}
              </ul>
            </details>
          </>
        )}

        {/* reason / confirm dialog */}
        <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{ask?.title}</DialogTitle></DialogHeader>
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ask?.placeholder || (ask?.needsReason ? 'Reason / comment (required)' : 'Note (optional)')} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsk(null)}>Back</Button>
              <Button disabled={!!busy || (ask?.needsReason && reason.trim().length < 3)} onClick={async () => { const a = ask; setAsk(null); await act('ask', () => a.run(reason.trim()), 'Done'); }}>{ask?.label}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* publish dialog */}
        <Dialog open={!!pub} onOpenChange={(o) => !o && setPub(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Publish requisition</DialogTitle></DialogHeader>
            {pub && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">The approved Job Description is published exactly as approved. HR cannot change it here.</p>
                <div className="grid grid-cols-2 gap-1.5">{CHANNELS.map((c) => (
                  <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={pub.channels.includes(c)} onChange={(e) => setPub({ ...pub, channels: e.target.checked ? [...pub.channels, c] : pub.channels.filter((x) => x !== c) })} />{c}</label>
                ))}</div>
                <div><label className="text-xs font-medium">Application deadline (optional)</label><Input type="date" value={pub.deadline} onChange={(e) => setPub({ ...pub, deadline: e.target.value })} /></div>
                <div><label className="text-xs font-medium">Publication notes</label><Input value={pub.notes} onChange={(e) => setPub({ ...pub, notes: e.target.value })} /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => act('save_unpub', () => mrf('mrf_hr_action', { id, action: 'save_unpublished', channels: pub.channels, notes: pub.notes }), 'Saved without publishing').then(() => setPub(null))}>Save unpublished</Button>
              <Button disabled={!!busy || !pub?.channels.length} onClick={async () => { const x = pub; setPub(null); await act('publish', () => mrf('mrf_hr_action', { id, action: 'publish', channels: x.channels, application_deadline: x.deadline, notes: x.notes }), 'Published'); }}>Publish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!reassign} onOpenChange={(o) => !o && setReassign(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Change Hiring Manager</DialogTitle></DialogHeader>
            {reassign && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Only possible before the Job Description is approved. The new Hiring Manager must belong to {rec?.department}.</p>
                <SearchSelect value={reassign.to} onChange={(v) => setReassign({ ...reassign, to: v })} placeholder="Select the new Hiring Manager"
                  options={reassign.hms.filter((m) => m.user_id !== rec?.hiring_manager_id).map((m) => ({ value: m.user_id, label: m.name, sub: m.designation, badge: m.is_head ? 'Dept head' : m.direct_reports > 0 ? 'Manager' : '' }))} />
                <Input placeholder="Reason (required)" value={reassign.reason} onChange={(e) => setReassign({ ...reassign, reason: e.target.value })} />
              </div>
            )}
            <DialogFooter><Button disabled={!reassign?.to || (reassign?.reason || '').trim().length < 3} onClick={async () => { const x = reassign; setReassign(null); await act('reassign', () => mrf('mrf_reassign_hm', { id, hiring_manager_id: x.to, reason: x.reason }), 'Hiring Manager changed'); }}>Change</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!extend} onOpenChange={(o) => !o && setExtend(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Change target hiring date</DialogTitle></DialogHeader>
            {extend && <div className="space-y-2"><Input type="date" value={extend.date} onChange={(e) => setExtend({ ...extend, date: e.target.value })} /><Input placeholder="Note (optional)" value={extend.note} onChange={(e) => setExtend({ ...extend, note: e.target.value })} /></div>}
            <DialogFooter><Button disabled={!extend?.date} onClick={async () => { const x = extend; setExtend(null); await act('extend', () => mrf('mrf_extend_target', { id, date: x.date, note: x.note }), 'Target date updated'); }}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
