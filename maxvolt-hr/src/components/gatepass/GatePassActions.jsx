// Every gate pass action, each behind one confirmation dialog with a success or error message.
import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { nowIST } from '@/lib/dateUtils';
import { toast } from 'sonner';
import { LogOut, LogIn, CheckCircle2, XCircle, MapPin, Ban, Loader2 } from 'lucide-react';
import { isTravel, outingLabel } from './gpShared';

// Ordinary outings: back within 3 hours = no deduction, longer = half day. Official outings are always a full day.
function lossOfPay(outingType, departureTime, returnTime) {
  if (outingType === 'official_outing' || outingType === 'travelling_to_another_office') return { lopDays: 0, status: 'present' };
  if (!returnTime || !departureTime) return { lopDays: 0.5, status: 'half_day' };
  return (new Date(returnTime) - new Date(departureTime)) / 3600000 <= 3 ? { lopDays: 0, status: 'present' } : { lopDays: 0.5, status: 'half_day' };
}

// Employee came back from an ordinary outing: close the pass and settle the day's attendance.
async function markReturned(pass, note) {
  const now = nowIST();
  const day = pass.request_date || now.slice(0, 10);   // the day the pass belongs to, also for a night shift
  const lop = lossOfPay(pass.outing_type, pass.departure_time, now);
  await base44.entities.GatePass.update(pass.id, { status: 'returned', gate_admin_notes: note, lop_deduction_days: lop.lopDays });
  const fields = { status: lop.status, lop_applicable: lop.lopDays > 0, lop_deduction_days: lop.lopDays, notes: `Gate pass: ${outingLabel(pass.outing_type)} — ${lop.lopDays > 0 ? 'LOP deducted' : 'No LOP'}` };
  const existing = await base44.entities.Attendance.filter({ user_id: pass.employee_user_id, date: day });
  if (existing.length) await base44.entities.Attendance.update(existing[0].id, fields);
  else await base44.entities.Attendance.create({ user_id: pass.employee_user_id, date: day, auto_marked: true, ...fields });
}

const ACTIONS = {
  approve: { label: 'Approve', icon: CheckCircle2, cls: 'bg-green-600 hover:bg-green-700 text-white', note: 'Comment (optional)', done: 'Gate pass approved',
    run: (p, note) => base44.entities.GatePass.update(p.id, { status: 'approved', manager_comment: note }) },
  reject: { label: 'Reject', icon: XCircle, cls: 'bg-red-600 hover:bg-red-700 text-white', note: 'Comment (optional)', done: 'Gate pass rejected',
    run: (p, note) => base44.entities.GatePass.update(p.id, { status: 'rejected', manager_comment: note }) },
  cancel_request: { label: 'Cancel request', icon: Ban, cls: 'border text-red-600 hover:bg-red-50', note: null, done: 'Gate pass request cancelled',
    run: (p) => base44.entities.GatePass.update(p.id, { status: 'cancelled' }) },
  gate_out: { label: 'Mark Out', icon: LogOut, cls: 'bg-orange-600 hover:bg-orange-700 text-white', note: 'Gate notes (optional)', done: 'Gate-Out recorded',
    text: (p) => (isTravel(p) ? `Records the departure from ${p.current_location} now and tells the ${p.destination_location} gate.` : 'Records the departure now.'),
    run: (p, note) => (isTravel(p) ? base44.functions.invoke('gp_gate_out', { id: p.id, remarks: note }) : base44.entities.GatePass.update(p.id, { status: 'departed', gate_admin_notes: note })) },
  gate_in: { label: 'Mark In', icon: LogIn, cls: 'bg-green-600 hover:bg-green-700 text-white', note: 'Gate notes (optional)', done: 'Return recorded', text: () => 'Records the return now.', run: markReturned },
  arrive: { label: 'Mark Arrived', icon: LogIn, cls: 'bg-emerald-600 hover:bg-emerald-700 text-white', note: 'Remarks (optional)', done: 'Arrival recorded — trip completed',
    text: (p) => `Confirms that the employee has reached ${p.destination_location}. The time is recorded now and the gate pass is completed.`,
    run: (p, note) => base44.functions.invoke('gp_arrive', { id: p.id, remarks: note }) },
  change_destination: { label: 'Change destination', icon: MapPin, cls: 'border', note: 'Reason for the change (required)', required: true, pickOffice: true, done: 'Destination changed and gate admins notified',
    run: (p, note, extra) => base44.functions.invoke('gp_change_destination', { id: p.id, destination: extra.destination, reason: note }) },
  cancel_trip: { label: 'Cancel / close trip', icon: Ban, cls: 'border text-red-600 hover:bg-red-50', note: 'Reason (required)', required: true, pickOutcome: true, done: 'Trip closed',
    run: (p, note, extra) => base44.functions.invoke('gp_cancel_trip', { id: p.id, reason: note, outcome: extra.outcome }) },
};

export function ActionButton({ action, onClick, size = 'sm', className = '' }) {
  const a = ACTIONS[action];
  return <Button size={size} variant="ghost" className={`${a.cls} ${className}`} onClick={(e) => { e.stopPropagation(); onClick(); }}><a.icon className="w-4 h-4 mr-1.5" />{a.label}</Button>;
}

export const actionsFor = (pass, keys) => keys.filter((k) => pass?.can?.[k]);
// "Cancel request" and "cancel / close trip" do the same job on a pending trip; only one is ever offered.
export const ALL_ACTIONS = ['approve', 'reject', 'gate_out', 'gate_in', 'arrive', 'change_destination', 'cancel_trip', 'cancel_request'];
export const withReject = (pass) => ({ ...pass, can: { ...pass.can, reject: !!pass.can?.approve } });

// request: { action, pass } | null
export function ConfirmAction({ request, offices = [], onClose, onDone }) {
  const [note, setNote] = useState('');
  const [destination, setDestination] = useState('');
  const [outcome, setOutcome] = useState('not_arrived');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setNote(''); setDestination(''); setOutcome('not_arrived'); setError(''); }, [request]);
  if (!request) return null;
  const a = ACTIONS[request.action];
  const p = request.pass;
  const blocked = (a.required && !note.trim()) || (a.pickOffice && !destination);
  const go = async () => {
    setBusy(true); setError('');
    try {
      await a.run(p, note, { destination, outcome });
      toast.success(a.done);
      onClose();
      await onDone?.();
    } catch (e) {
      setError(e.message || 'That did not work');
      onDone?.();   // someone else may have acted first: show the latest state behind the dialog
    }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={() => !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{a.label} — {p.employee?.name}</DialogTitle>
          <DialogDescription>{a.text ? a.text(p) : `${outingLabel(p.outing_type)}${isTravel(p) ? `: ${p.current_location} → ${p.destination_location}` : ''}`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {a.pickOffice && (
            <label className="block text-sm font-medium">New destination
              <select className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm font-normal" value={destination} onChange={(e) => setDestination(e.target.value)}>
                <option value="">Select office…</option>
                {offices.filter((o) => o !== p.destination_location && (p.status === 'departed' || o !== p.current_location)).map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          )}
          {a.pickOutcome && p.status === 'departed' && (
            <label className="block text-sm font-medium">What happened?
              <select className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm font-normal" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="not_arrived">Employee did not arrive</option>
                <option value="cancelled_in_transit">Trip was cancelled after departure</option>
              </select>
            </label>
          )}
          {a.note && <label className="block text-sm font-medium">{a.note}<Textarea className="mt-1 font-normal" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={busy}>Back</Button>
            <Button variant="ghost" className={a.cls} onClick={go} disabled={busy || blocked}>{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <a.icon className="w-4 h-4 mr-1.5" />}Confirm</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
