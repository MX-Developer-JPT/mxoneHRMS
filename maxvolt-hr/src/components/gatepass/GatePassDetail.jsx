// Detail view used by every gate pass screen: facts, the travel milestones, the activity history and the allowed actions.
import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { safeDate } from '@/lib/dateUtils';
import { Check, Loader2 } from 'lucide-react';
import GatePassTimeline, { requestedAt } from './GatePassTimeline';
import { StageBadge, isTravel, outingLabel } from './gpShared';
import { ActionButton, ConfirmAction, ALL_ACTIONS, actionsFor, withReject } from './GatePassActions';

const FMT = 'dd MMM yyyy, hh:mm a';
const EVENTS = {
  requested: 'Requested', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', gate_out: 'Gate-Out', in_transit: 'In transit', gate_in: 'Gate-In',
  completed: 'Completed', destination_changed: 'Destination changed', arrival_overdue: 'Arrival not confirmed', auto_closed: 'Auto-closed',
  cancelled_before_departure: 'Cancelled before departure', cancelled_in_transit: 'Cancelled after departure', not_arrived: 'Did not arrive',
};

function Milestones({ pass }) {
  const closed = ['rejected', 'cancelled', 'auto_closed'].includes(pass.status);
  const left = !!pass.departure_time, arrived = !!pass.arrival_time;
  const steps = [
    { label: 'Requested', done: true, time: requestedAt(pass) },
    { label: 'Approved', done: !!pass.manager_approval_date && pass.status !== 'rejected', time: pass.manager_approval_date },
    { label: `Gate-Out · ${pass.current_location}`, done: left, time: pass.departure_time, by: pass.departed_by_name },
    { label: `In transit to ${pass.destination_location}`, done: arrived, current: pass.status === 'departed', time: null },
    { label: `Gate-In · ${pass.destination_location}`, done: arrived, time: pass.arrival_time, by: pass.arrived_by_name },
    { label: 'Completed', done: pass.status === 'completed', time: pass.arrival_time },
  ];
  const mins = left && arrived ? Math.round((new Date(pass.arrival_time) - new Date(pass.departure_time)) / 60000) : null;
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
      <p className="font-semibold mb-3">Travel timeline</p>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center border-2 ${s.done ? 'bg-emerald-600 border-emerald-600 text-white' : s.current ? 'border-indigo-600 bg-indigo-100 animate-pulse' : 'border-gray-300 bg-white dark:bg-gray-900'}`}>{s.done && <Check className="w-3 h-3" />}</span>
              {i < steps.length - 1 && <span className={`w-0.5 flex-1 min-h-[14px] ${s.done ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'}`} />}
            </div>
            <div className="pb-3 min-w-0">
              <p className={`text-sm font-medium ${s.done ? '' : s.current ? 'text-indigo-700' : 'text-gray-400'}`}>{s.label}</p>
              <p className="text-xs text-gray-500">{s.time ? safeDate(s.time, FMT) : s.current ? 'On the way' : closed ? '—' : s.done ? '' : 'Pending'}{s.by ? ` · by ${s.by}` : ''}</p>
            </div>
          </li>
        ))}
      </ol>
      {mins !== null && <p className="text-xs text-gray-500">Travel time: {mins >= 60 ? `${Math.floor(mins / 60)} h ` : ''}{mins % 60} min</p>}
      {pass.close_reason && <p className="text-sm text-red-700 mt-1">{EVENTS[pass.travel_outcome] || 'Closed'} — {pass.close_reason} ({pass.closed_by_name})</p>}
    </div>
  );
}

function History({ items }) {
  if (!items?.length) return <p className="text-xs text-gray-400">No activity history was recorded for this older gate pass.</p>;
  return (
    <div>
      <p className="font-semibold mb-2">Activity history</p>
      <ul className="divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-lg">
        {items.map((h, i) => (
          <li key={`${h.at}-${i}`} className="px-3 py-2">
            <p className="flex flex-wrap justify-between gap-x-2"><span className="font-medium">{EVENTS[h.action] || h.action}{h.office ? ` · ${h.office}` : ''}</span><span className="text-xs text-gray-500">{safeDate(h.at, FMT)}</span></p>
            <p className="text-xs text-gray-500">{h.by_name}{h.by_code ? ` (${h.by_code})` : ''}{h.by_role ? ` · ${h.by_role.replace(/_/g, ' ')}` : ''}{h.from_status && h.from_status !== h.to_status ? ` · ${h.from_status.replace(/_/g, ' ')} → ${String(h.to_status).replace(/_/g, ' ')}` : ''}</p>
            {h.remarks && <p className="text-xs italic text-gray-600 dark:text-gray-300">{h.remarks}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Row = ({ label, children }) => (children ? <><dt className="text-gray-500">{label}</dt><dd className="min-w-0 break-words">{children}</dd></> : null);

export default function GatePassDetail({ passId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(null);
  const load = useCallback(async () => {
    if (!passId) return;
    try { const r = await base44.functions.invoke('gp_detail', { id: passId }); setData(r.data); setError(''); }
    catch (e) { setError(e.message || 'Could not load this gate pass'); }
  }, [passId]);
  useEffect(() => { setData(null); setError(''); load(); }, [load]);
  if (!passId) return null;
  const pass = data?.pass?.id === passId ? data.pass : null;
  const keys = pass ? actionsFor(withReject(pass), ALL_ACTIONS).filter((k) => !(k === 'cancel_request' && pass.can.cancel_trip)) : [];
  return (
    <>
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2 pr-6">Gate pass {pass?.pass_no} {pass && <StageBadge pass={pass} />}</DialogTitle></DialogHeader>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {!pass && !error && <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
          {pass && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
                <Row label="Employee">{pass.employee.name}{pass.employee.code ? ` (${pass.employee.code})` : ''}</Row>
                <Row label="Role">{[pass.employee.designation, pass.employee.department].filter(Boolean).join(' · ')}</Row>
                <Row label="Type">{outingLabel(pass.outing_type)}</Row>
                {isTravel(pass) ? <><Row label="Origin">{pass.current_location}</Row><Row label="Destination">{pass.destination_location}</Row></> : <Row label="Office">{pass.current_location}</Row>}
                <Row label="Date">{safeDate(pass.request_date, 'dd MMM yyyy')}</Row>
                <Row label="Reason">{pass.reason || '—'}</Row>
                <Row label="Vehicle">{pass.vehicle_type?.replace(/_/g, ' ')}</Row>
                <Row label="Expected arrival">{pass.expected_arrival_time && safeDate(pass.expected_arrival_time, FMT)}</Row>
                <Row label="Expected return">{pass.expected_return_time && safeDate(pass.expected_return_time, FMT)}</Row>
                <Row label="Approver">{pass.approver_name}</Row>
                <Row label="Approver comment">{pass.manager_comment}</Row>
                <Row label="Gate notes">{pass.gate_admin_notes || pass.arrival_remarks}</Row>
                <Row label="Loss of pay">{pass.lop_deduction_days > 0 ? `${pass.lop_deduction_days} day(s)` : ''}</Row>
              </dl>
              {isTravel(pass) ? <Milestones pass={pass} /> : <GatePassTimeline pass={pass} approverName={pass.approver_name} departedBy={pass.departed_by_name} returnedBy={pass.returned_by_name} />}
              <History items={pass.history} />
              {keys.length > 0 && <div className="flex flex-wrap gap-2 sticky bottom-0 bg-background pt-2">{keys.map((k) => <ActionButton key={k} action={k} onClick={() => setRequest({ action: k, pass })} />)}</div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmAction request={request} offices={data?.offices} onClose={() => setRequest(null)} onDone={async () => { await load(); await onChanged?.(); }} />
    </>
  );
}
