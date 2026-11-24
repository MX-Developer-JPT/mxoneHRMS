import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HeartHandshake } from 'lucide-react';

const OUTCOMES = [['', 'Discussion continues'], ['retained', 'Retained'], ['resignation_accepted', 'Resignation accepted'], ['declined_by_employee', 'Retention declined by employee'], ['proposal_rejected', 'Retention proposal rejected']];
const outcomeLabel = (v) => (OUTCOMES.find(o => o[0] === v) || [0, v])[1];
const today = () => new Date().toISOString().slice(0, 10);
const BLANK = { date: today(), concerns: '', proposal: '', revised_compensation: '', revised_designation: '', employee_decision: '', outcome: '', notes: '' };

// Retention discussion before the resignation is accepted: what was said, what was offered, what the employee decided.
export default function ExitRetention({ exit, canRecord, isHR, saving, callExit }) {
  const [form, setForm] = useState(BLANK);
  const [remarks, setRemarks] = useState('');
  const [open, setOpen] = useState(false);
  const ret = exit.retention;
  const list = ret?.discussions || [];
  const before = ['submitted', 'manager_approved'].includes(exit.status);
  if (!before && !list.length) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => { const ok = await callExit('ex_retention_log', { discussion: form }, 'Retention discussion recorded'); if (ok) { setForm(BLANK); setOpen(false); } };
  return (
    <div className="border border-pink-200 bg-pink-50/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-pink-900 flex items-center gap-2"><HeartHandshake className="w-4 h-4" /> Retention discussion {ret?.status === 'open' && <span className="text-xs font-normal bg-pink-100 text-pink-800 rounded-full px-2 py-0.5">open</span>}</p>
        {before && canRecord && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{list.length ? 'Add discussion' : 'Start retention discussion'}</Button>}
      </div>
      {list.map(d => (
        <div key={d.id} className="bg-white rounded border p-3 text-sm space-y-1">
          <p className="text-xs text-gray-500">{d.date} · {d.owner_name}{d.outcome ? ` · ${outcomeLabel(d.outcome)}` : ''}</p>
          {d.concerns && <p><b>Concerns:</b> {d.concerns}</p>}
          {d.proposal && <p><b>Proposal:</b> {d.proposal}</p>}
          {(d.revised_compensation || d.revised_designation) && <p><b>Offered:</b> {[d.revised_compensation && `compensation ${d.revised_compensation}`, d.revised_designation && `designation ${d.revised_designation}`].filter(Boolean).join(', ')}</p>}
          {d.employee_decision && <p><b>Employee decision:</b> {d.employee_decision}</p>}
          {d.notes && <p className="text-gray-600">{d.notes}</p>}
        </div>
      ))}
      {open && (
        <div className="bg-white rounded border p-3 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label className="text-xs">Discussion date</Label><Input type="date" value={form.date} onChange={e => set('date', e.target.value)} /></div>
            <div><Label className="text-xs">Outcome</Label>
              <Select value={form.outcome || 'open'} onValueChange={v => set('outcome', v === 'open' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OUTCOMES.map(([v, l]) => <SelectItem key={v || 'open'} value={v || 'open'}>{l}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          <div><Label className="text-xs">Employee concerns</Label><Textarea rows={2} value={form.concerns} onChange={e => set('concerns', e.target.value)} /></div>
          <div><Label className="text-xs">Retention proposal</Label><Textarea rows={2} value={form.proposal} onChange={e => set('proposal', e.target.value)} /></div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label className="text-xs">Revised compensation (if any)</Label><Input value={form.revised_compensation} onChange={e => set('revised_compensation', e.target.value)} /></div>
            <div><Label className="text-xs">Revised designation (if any)</Label><Input value={form.revised_designation} onChange={e => set('revised_designation', e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Employee's decision</Label><Input value={form.employee_decision} onChange={e => set('employee_decision', e.target.value)} /></div>
          <div className="flex gap-2 justify-end"><Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" disabled={saving} onClick={save}>Save</Button></div>
        </div>
      )}
      {isHR && ret?.last_outcome === 'retained' && ['submitted', 'manager_approved', 'in_notice'].includes(exit.status) && (
        <div className="bg-green-50 border border-green-200 rounded p-3 space-y-2">
          <p className="text-sm text-green-900 font-medium">The employee agreed to stay. Cancel the resignation (the full history is kept):</p>
          <Textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Remarks (required)" />
          <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={saving || remarks.trim().length < 3} onClick={() => callExit('ex_cancel_retained', { remarks }, 'Resignation cancelled — employee retained')}>Cancel resignation</Button>
        </div>
      )}
    </div>
  );
}
