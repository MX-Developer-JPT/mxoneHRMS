import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, CheckCircle2, Undo2, Trash2, Loader2 } from 'lucide-react';

const TYPES = [['project', 'Project'], ['responsibility', 'Responsibility'], ['document', 'Documents / files'], ['process', 'Process documentation'], ['pending', 'Pending activity'], ['client_vendor', 'Client / vendor']];
const STATUS = { assigned: ['Assigned', 'bg-gray-100 text-gray-700'], in_progress: ['In progress', 'bg-blue-100 text-blue-800'], handed_over: ['Awaiting verification', 'bg-amber-100 text-amber-800'], verified: ['Verified', 'bg-green-100 text-green-800'], sent_back: ['Sent back', 'bg-red-100 text-red-800'] };

// Knowledge transfer: the manager assigns what is handed over and to whom, the leaving employee reports progress, the manager verifies.
export default function ExitKT({ exit, currentUser, canManage, employees = [], onChanged }) {
  const items = (exit.kt_items || []);
  const v2 = items.filter(i => i.v === 2), legacy = items.filter(i => i.v !== 2);
  const isEmployee = currentUser?.id === exit.user_id;
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'project', details: '', recipient_id: '', due_date: exit.last_working_date || '' });
  const [notes, setNotes] = useState({});
  const call = async (fn, extra, msg, key = fn) => {
    setBusy(key);
    try {
      const r = await base44.functions.invoke(fn, { exit_id: exit.id, ...extra });
      if (r?.data?.success) { toast.success(msg); onChanged?.(); return true; }
      toast.error(r?.data?.error || 'Action failed');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
    return false;
  };
  const done = v2.filter(i => i.status === 'verified').length;
  const accepted = ['in_notice', 'clearance_pending', 'clearance_done'].includes(exit.status);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><p className="font-semibold text-sm">Knowledge transfer</p><p className="text-xs text-gray-500">Handover of projects, responsibilities, documents and pending work — verified by the reporting manager before the department clears the employee.</p></div>
        {canManage && accepted && !open && <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Assign handover</Button>}
      </div>
      {open && (
        <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><Label className="text-xs">What is being handed over *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Dealer onboarding project — documents and pending orders" /></div>
            <div><Label className="text-xs">Type</Label><select className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><Label className="text-xs">Hand over to</Label><select className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={form.recipient_id} onChange={e => setForm(f => ({ ...f, recipient_id: e.target.value }))}><option value="">— choose a colleague —</option>{employees.filter(e => e.user_id && e.user_id !== exit.user_id && (!e.status || e.status === 'active')).map(e => <option key={e.user_id} value={e.user_id}>{e.display_name || e.full_name}{e.designation ? ` · ${e.designation}` : ''}</option>)}</select></div>
            <div><Label className="text-xs">Complete by</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Details / documents to hand over</Label><Textarea rows={2} value={form.details} onChange={e => setForm(f => ({ ...f, details: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" disabled={busy === 'ex_kt_assign'} onClick={async () => { if (await call('ex_kt_assign', { item: form }, 'Handover assigned')) { setOpen(false); setForm(f => ({ ...f, title: '', details: '' })); } }}>{busy === 'ex_kt_assign' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Assign'}</Button></div>
        </div>
      )}
      {v2.length > 0 && <p className="text-sm text-gray-600">{done} of {v2.length} handover(s) verified ({Math.round((done / v2.length) * 100)}%)</p>}
      {v2.length === 0 && legacy.length === 0 && <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg text-sm">{accepted ? 'No handover assigned yet.' : 'Knowledge transfer opens once the resignation is accepted.'}</div>}
      {v2.map(i => {
        const [lab, cls] = STATUS[i.status] || STATUS.assigned;
        return (
          <div key={i.id} className="border rounded-lg p-3 space-y-2 bg-white">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="font-medium text-sm">{i.title}</p><p className="text-xs text-gray-500">{(TYPES.find(t => t[0] === i.type) || [0, i.type])[1]}{i.recipient_name ? ` · to ${i.recipient_name}` : ''}{i.due_date ? ` · due ${i.due_date}` : ''}</p></div>
              <Badge className={cls}>{lab}</Badge>
            </div>
            {i.details && <p className="text-xs text-gray-600">{i.details}</p>}
            {i.employee_note && <p className="text-xs bg-gray-50 rounded p-2"><b>Employee note:</b> {i.employee_note}</p>}
            {i.review_comment && <p className="text-xs bg-amber-50 rounded p-2"><b>Reviewer:</b> {i.review_comment}</p>}
            {i.status === 'verified' && <p className="text-xs text-green-700">Verified by {i.verified_by}{i.verified_at ? ` on ${i.verified_at.slice(0, 10)}` : ''}</p>}
            {isEmployee && i.status !== 'verified' && i.status !== 'handed_over' && (
              <div className="flex gap-2 items-center flex-wrap">
                <Input className="h-8 flex-1 min-w-[160px] text-xs" placeholder="Progress note" value={notes[i.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [i.id]: e.target.value }))} />
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('ex_kt_update', { item_id: i.id, status: 'in_progress', progress: 50, note: notes[i.id] || '' }, 'Progress saved', i.id)}>Save progress</Button>
                <Button size="sm" disabled={!!busy} onClick={() => call('ex_kt_update', { item_id: i.id, status: 'handed_over', note: notes[i.id] || '' }, 'Marked as handed over', i.id)}>Mark handed over</Button>
              </div>)}
            {canManage && i.status === 'handed_over' && (
              <div className="flex gap-2 items-center flex-wrap">
                <Input className="h-8 flex-1 min-w-[160px] text-xs" placeholder="Comment (required if sending back)" value={notes[i.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [i.id]: e.target.value }))} />
                <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => call('ex_kt_verify', { item_id: i.id, action: 'verified', comment: notes[i.id] || '' }, 'Handover verified', i.id)}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Verify</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('ex_kt_verify', { item_id: i.id, action: 'sent_back', comment: notes[i.id] || '' }, 'Sent back', i.id)}><Undo2 className="w-3.5 h-3.5 mr-1" />Send back</Button>
              </div>)}
            {canManage && i.status !== 'verified' && <button className="text-xs text-red-600 flex items-center gap-1" onClick={() => window.confirm('Remove this handover item?') && call('ex_kt_remove', { item_id: i.id }, 'Removed', 'rm' + i.id)}><Trash2 className="w-3 h-3" />Remove</button>}
          </div>);
      })}
      {legacy.length > 0 && (
        <div className="border rounded-lg p-3 bg-gray-50"><p className="text-xs font-semibold text-gray-600 mb-1">Earlier notes (kept for the record)</p>
          {legacy.map((i, n) => <p key={n} className="text-xs text-gray-600">• {i.task || i.title} {i.assignee ? `— ${i.assignee}` : ''} ({i.status || 'pending'})</p>)}</div>)}
    </div>
  );
}
