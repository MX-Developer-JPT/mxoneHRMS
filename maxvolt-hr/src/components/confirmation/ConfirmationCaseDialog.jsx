import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Send, CheckCircle2, PauseCircle, XCircle, Mail, ShieldAlert, LogOut } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';
import { STATUS_STYLE, CRITERIA } from './confirmationShared';

const day = (d) => (d ? safeDate(d, 'dd MMM yyyy') : '—');
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const call = async (name, params) => {
  const r = await base44.functions.invoke(name, params);
  const d = r?.data || r;
  if (d?.success === false) throw new Error(d.error || 'Request failed');
  return d;
};
const Section = ({ title, children, tone = '' }) => <section className={`border rounded-lg p-3 space-y-2 ${tone}`}><h3 className="text-sm font-semibold text-gray-800">{title}</h3>{children}</section>;

export default function ConfirmationCaseDialog({ userId, canInitiate, isAdmin, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [obs, setObs] = useState({});
  const [form, setForm] = useState({ decision: '', comments: '', remarks: '', review_date: '', scores: {} });
  const [exit, setExit] = useState({ last_working_date: '', note: '' });
  const [fix, setFix] = useState({ open: false, status: '', reason: '', review_date: '', email_employee: false });

  const load = () => call('cf_detail', { user_id: userId }).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); setError(''); load(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key, name, params, done) => {
    setBusy(key);
    try {
      const d = await call(name, { user_id: userId, ...params });
      if (d.mail_status === 'failed') toast.error(`Saved, but the email could not be sent: ${d.mail_error || 'unknown error'}. Use “Resend email”.`);
      else toast.success(done);
      setObs({}); onChanged?.(); await load();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const e = data?.employee, c = data?.case, rec = data?.records;
  const status = e?.status;
  const initiable = canInitiate && ['pending_hr', 'on_hold'].includes(status);
  const spinner = (k, Icon) => (busy === k ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />);

  const decide = () => {
    const word = { confirm: 'CONFIRM', hold: 'put ON HOLD', reject: 'REJECT' }[form.decision];
    if (!window.confirm(`You are about to ${word} the confirmation of ${e.name}. The employee is emailed immediately and HR cannot change this decision. Continue?`)) return;
    act('decide', 'cf_decide', form, 'Decision recorded and communicated');
  };

  const observationInputs = (
    <div className="space-y-2">
      {Object.entries(data?.observation_fields || {}).map(([k, label]) => (
        <div key={k}><Label className="text-xs">{label}</Label><Textarea rows={2} value={obs[k] || ''} onChange={(ev) => setObs({ ...obs, [k]: ev.target.value })} /></div>
      ))}
    </div>
  );

  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Confirmation{e ? ` — ${e.name}` : ''}</DialogTitle></DialogHeader>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
        {!data && !error && <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}
        {data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLE[status]}`}>{e.status_label}</span>
              <span className="text-gray-500">{e.employee_code} · {e.designation} · {e.department}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {[['Date of joining', day(e.date_of_joining)], [status === 'on_hold' ? 'Revised review date' : 'Confirmation due', day(e.due_date)], ['Reporting manager', e.manager_name || 'Not assigned'], ['Round', c ? c.round : '—']].map(([k, v]) => (
                <div key={k} className="bg-gray-50 border rounded-lg p-2"><p className="text-[11px] text-gray-400">{k}</p><p className="font-medium">{v}</p></div>
              ))}
            </div>

            <Section title={`Employee record since ${day(rec.since)}`}>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {[['Absent', rec.attendance.absent], ['Late', rec.attendance.late], ['Half day', rec.attendance.half_day], ['Short hours', rec.attendance.short], ['Regularised', rec.attendance.regularised], ['Leave days', rec.leave_days]].map(([k, v]) => (
                  <div key={k} className="border rounded-md py-1.5"><p className="text-base font-semibold">{v}</p><p className="text-[11px] text-gray-400">{k}</p></div>
                ))}
              </div>
              <p className="text-xs text-gray-500">{rec.attendance.recorded} attendance days recorded · {rec.warning_letters.length} warning letter(s) · {rec.improvement_plans} improvement plan(s)</p>
              {rec.warning_letters.map((w) => <p key={w} className="text-xs text-amber-800">{w}</p>)}
            </Section>

            <Section title="HR observations" tone={c?.observations?.length ? 'border-amber-200 bg-amber-50/50' : ''}>
              {c?.observations?.length ? c.observations.map((o) => (
                <div key={o.at} className="text-sm border-l-2 border-amber-300 pl-3">
                  <p className="text-[11px] text-gray-500">{o.by_name} · {stamp(o.at)}</p>
                  {Object.entries(data.observation_fields).filter(([k]) => o[k]).map(([k, label]) => <p key={k}><b>{label}:</b> {o[k]}</p>)}
                </div>
              )) : <p className="text-xs text-gray-400">No observations recorded.</p>}
              {canInitiate && status === 'pending_manager' && (
                <details><summary className="text-xs text-blue-600 cursor-pointer">Add an observation</summary>
                  <div className="pt-2 space-y-2">{observationInputs}<Button size="sm" disabled={!!busy || !Object.values(obs).some((v) => v?.trim())} onClick={() => act('obs', 'cf_add_observation', { observations: obs }, 'Observation recorded')}>{spinner('obs', Send)}Add observation</Button></div>
                </details>
              )}
            </Section>

            {initiable && (
              <Section title={status === 'on_hold' ? 'Send to the manager again' : 'Initiate confirmation'} tone="border-blue-200">
                <p className="text-xs text-gray-500">Record any concerns the reporting manager should see (optional). The manager takes the decision.</p>
                {observationInputs}
                {!e.manager_id && <p className="text-xs text-red-600">Assign a reporting manager to this employee first.</p>}
                <Button disabled={!!busy || !e.manager_id} onClick={() => act('init', 'cf_initiate', { observations: obs }, `Sent to ${e.manager_name}`)}>{spinner('init', Send)}Send to {e.manager_name || 'manager'}</Button>
              </Section>
            )}

            {e.can_decide && (
              <Section title="Your assessment and final decision" tone="border-green-200">
                <div className="space-y-1.5">
                  {CRITERIA.map(([k, label]) => (
                    <div key={k} className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-sm text-gray-700">{label}</span>
                      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${label}: ${n}`} onClick={() => setForm((f) => ({ ...f, scores: { ...f.scores, [k]: n } }))} className={`w-8 h-8 rounded text-sm font-bold border ${form.scores[k] >= n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-400 border-gray-200'}`}>{n}</button>)}</div>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-400">1 = Poor, 5 = Excellent</p>
                </div>
                <div><Label className="text-xs">Assessment: performance, conduct, productivity and suitability *</Label><Textarea rows={3} value={form.comments} onChange={(ev) => setForm({ ...form, comments: ev.target.value })} /></div>
                <div className="grid sm:grid-cols-3 gap-2">
                  {[['confirm', 'Confirm', CheckCircle2, 'border-green-600 bg-green-600'], ['hold', 'Hold', PauseCircle, 'border-orange-500 bg-orange-500'], ['reject', 'Reject', XCircle, 'border-red-600 bg-red-600']].map(([k, label, Icon, on]) => (
                    <button key={k} type="button" onClick={() => setForm({ ...form, decision: k })} className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium ${form.decision === k ? `${on} text-white` : 'bg-white text-gray-700 hover:bg-gray-50'}`}><Icon className="w-4 h-4" />{label}</button>
                  ))}
                </div>
                {['hold', 'reject'].includes(form.decision) && <div><Label className="text-xs">Reason / remarks (sent to the employee) *</Label><Textarea rows={2} value={form.remarks} onChange={(ev) => setForm({ ...form, remarks: ev.target.value })} /></div>}
                {form.decision === 'hold' && <div><Label className="text-xs">Revised review date *</Label><Input type="date" className="w-48" value={form.review_date} onChange={(ev) => setForm({ ...form, review_date: ev.target.value })} /></div>}
                <Button className="w-full" disabled={!!busy || !form.decision} onClick={decide}>{spinner('decide', Send)}Submit final decision</Button>
              </Section>
            )}

            {c?.decision && (
              <Section title="Decision">
                <p className="text-sm"><b>{e.status_label}</b> by {c.decision.by_name} on {stamp(c.decision.at)}</p>
                {c.decision.comments && <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.decision.comments}</p>}
                {c.decision.remarks && <p className="text-sm"><b>Remarks:</b> {c.decision.remarks}</p>}
                {c.decision.review_date && <p className="text-sm"><b>Revised review date:</b> {day(c.decision.review_date)}</p>}
                {c.decision.scores && <p className="text-xs text-gray-500">{CRITERIA.map(([k, l]) => `${l}: ${c.decision.scores[k]}/5`).join(' · ')}</p>}
              </Section>
            )}

            {status === 'rejected' && canInitiate && (
              <Section title="HR review: exit / separation" tone="border-red-200">
                {c.exit_id ? <p className="text-sm">The exit process has been started. Continue it in <a className="text-blue-600 underline" href="/ExitManagement">Exit Management</a>.</p> : (
                  <>
                    <div className="grid sm:grid-cols-3 gap-2"><div><Label className="text-xs">Last working day *</Label><Input type="date" value={exit.last_working_date} onChange={(ev) => setExit({ ...exit, last_working_date: ev.target.value })} /></div>
                      <div className="sm:col-span-2"><Label className="text-xs">HR review note *</Label><Input value={exit.note} onChange={(ev) => setExit({ ...exit, note: ev.target.value })} /></div></div>
                    <Button variant="destructive" disabled={!!busy || !exit.last_working_date || exit.note.trim().length < 10} onClick={() => window.confirm(`Start the exit process for ${e.name}?`) && act('exit', 'cf_start_exit', exit, 'Exit process started')}>{spinner('exit', LogOut)}Start exit process</Button>
                  </>
                )}
              </Section>
            )}

            {c?.mails?.length > 0 && (
              <Section title="Emails">
                {c.mails.map((m) => (
                  <div key={m.key} className="text-xs flex flex-wrap gap-2 items-center">
                    <span className={`px-2 py-0.5 rounded-full capitalize ${m.status === 'sent' ? 'bg-green-100 text-green-700' : m.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{m.status}</span>
                    <span className="capitalize">{m.kind.replace('_', ' ')}</span><span className="text-gray-500 break-all">to {(m.to || []).join(', ') || '—'}{m.cc?.length ? ` · CC ${m.cc.join(', ')}` : ''} · {stamp(m.at)}{m.error ? ` · ${m.error}` : ''}</span>
                  </div>
                ))}
                {canInitiate && c.mails.some((m) => m.status === 'failed') && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('resend', 'cf_resend', {}, 'Email sent')}>{spinner('resend', Mail)}Resend email</Button>}
              </Section>
            )}

            {c?.history?.length > 0 && (
              <Section title="Audit trail">
                {[...c.history].reverse().map((h, i) => (
                  <div key={`${h.at}-${i}`} className="text-xs border-l-2 border-gray-200 pl-3">
                    <p className="font-medium capitalize">{h.action.replace(/_/g, ' ')} <span className="font-normal text-gray-400">· {h.actor_name} · {stamp(h.at)}</span></p>
                    {h.detail && <p className="text-gray-600 break-words">{h.detail}</p>}
                  </div>
                ))}
              </Section>
            )}

            {data.earlier_reviews?.length > 0 && (
              <Section title="Reviews from the earlier process">
                {data.earlier_reviews.map((r) => <p key={r.id} className="text-xs text-gray-600">{day(r.created_at)} · {String(r.status).replace(/_/g, ' ')} · {r.manager_name}{r.manager_comments ? ` — ${r.manager_comments}` : ''}</p>)}
              </Section>
            )}

            {isAdmin && c && (
              <Section title="Administrative correction">
                {!fix.open ? <Button size="sm" variant="outline" onClick={() => setFix({ ...fix, open: true })}><ShieldAlert className="w-4 h-4 mr-2" />Correct this record</Button> : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Use only to fix a mistake. The previous decision and your reason stay in the audit trail.</p>
                    <div className="flex gap-2 flex-wrap">
                      <select className="h-9 border rounded-md px-2 text-sm bg-white" value={fix.status} onChange={(ev) => setFix({ ...fix, status: ev.target.value })}>
                        <option value="">Correct to…</option>
                        {[['pending_manager', 'Reopen for the manager'], ['confirmed', 'Confirmed'], ['on_hold', 'On Hold'], ['rejected', 'Rejected']].filter(([k]) => k !== status).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      {fix.status === 'on_hold' && <Input type="date" className="w-44" value={fix.review_date} onChange={(ev) => setFix({ ...fix, review_date: ev.target.value })} />}
                    </div>
                    <Textarea rows={2} placeholder="Reason for the correction (required)" value={fix.reason} onChange={(ev) => setFix({ ...fix, reason: ev.target.value })} />
                    {fix.status && fix.status !== 'pending_manager' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={fix.email_employee} onChange={(ev) => setFix({ ...fix, email_employee: ev.target.checked })} />Email the employee about the corrected decision</label>}
                    {c.exit_id && <p className="text-xs text-amber-700">An exit case is open. A correction does not cancel it: cancel it in Exit Management if needed.</p>}
                    <Button size="sm" disabled={!!busy || !fix.status || fix.reason.trim().length < 10} onClick={() => window.confirm('Apply this administrative correction?') && act('fix', 'cf_correct', fix, 'Correction applied').then(() => setFix({ open: false, status: '', reason: '', review_date: '', email_employee: false }))}>{spinner('fix', ShieldAlert)}Apply correction</Button>
                  </div>
                )}
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
