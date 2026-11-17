import React from 'react';
import { FileClock, CheckCircle2, XCircle, LogOut, LogIn, Clock, AlertTriangle, UserCheck } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const FMT = 'dd MMM yyyy, hh:mm a';

// created_date comes from the database as REAL UTC text ("2026-11-17 04:20:11.123+00"), while every other time on a pass
// (approval, departure, return) is stored as IST clock digits. Convert it so "Requested" reads in IST like the rest.
export const requestedAt = (p) => {
  if (!p) return null;
  if (p.requested_at) return p.requested_at;
  const raw = String(p.created_date || '').trim();
  if (!raw) return null;
  let iso = raw.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(iso)) iso += ':00';           // "+00" -> "+00:00"
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(iso)) iso += 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + IST_OFFSET_MS).toISOString();
};

const OFFICIAL = ['official_outing', 'travelling_to_another_office'];

function attendanceNote(p) {
  if (!p.departure_time && !p.auto_closed) return null;
  if (OFFICIAL.includes(p.outing_type) && ['departed', 'returned', 'auto_closed'].includes(p.status)) return 'Official outing — the day counts as a full day present, whatever the check-out time.';
  if (p.status === 'auto_closed' && p.departure_time && p.outing_type !== 'half_day') return 'Did not return by shift end — the departure time is used as the check-out and the day is graded by hours worked (half day / short attendance, never absent).';
  if (p.outing_type === 'half_day' && p.departure_time) return 'Half-day outing — the departure time is the check-out; the day is a half day.';
  return null;
}

export default function GatePassTimeline({ pass, approverName, departedBy, returnedBy }) {
  const p = pass;
  const rejected = p.manager_approval_status === 'rejected';
  const decided = !!p.manager_approval_date;
  const noReturn = p.status === 'auto_closed' && p.departure_time && !p.return_time;
  const steps = [
    { key: 'req', label: 'Requested', time: requestedAt(p), icon: FileClock, color: 'text-gray-600' },
    decided
      ? { key: 'dec', label: rejected ? 'Rejected' : 'Approved', time: p.manager_approval_date, by: approverName || 'Reporting manager', note: p.manager_comment, icon: rejected ? XCircle : CheckCircle2, color: rejected ? 'text-red-600' : 'text-blue-600' }
      : { key: 'dec', label: 'Approval', pending: 'Awaiting approval', by: approverName ? `with ${approverName}` : null, icon: UserCheck, color: 'text-amber-600' },
    !rejected && (p.departure_time
      ? { key: 'dep', label: 'Departed', time: p.departure_time, by: departedBy, icon: LogOut, color: 'text-orange-600' }
      : { key: 'dep', label: 'Departed', pending: 'Not left yet', icon: LogOut, color: 'text-gray-400' }),
    !rejected && (p.return_time
      ? { key: 'ret', label: 'Returned', time: p.return_time, by: returnedBy, icon: LogIn, color: 'text-green-600' }
      : noReturn
        ? { key: 'ret', label: 'Did not return', pending: p.auto_closed_reason || 'Auto-closed at shift end', icon: AlertTriangle, color: 'text-purple-600' }
        : { key: 'ret', label: 'Returned', pending: p.departure_time ? 'Still outside' : 'Not returned yet', icon: LogIn, color: 'text-gray-400' }),
  ].filter(Boolean);
  const note = attendanceNote(p);
  const mins = p.departure_time && p.return_time ? Math.round((new Date(p.return_time) - new Date(p.departure_time)) / 60000) : null;

  return (
    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
      <p className="font-semibold text-gray-700">Timeline</p>
      <div className="space-y-3">
        {steps.map((st) => (
          <div key={st.key} className="flex items-start gap-2">
            <st.icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${st.color}`} />
            <div className="min-w-0">
              <p className={`font-medium ${st.color}`}>
                {st.label}
                {st.by && <span className="font-normal text-gray-500"> {st.pending ? st.by : `by ${st.by}`}</span>}
              </p>
              <p className="text-xs text-gray-500">{st.time ? safeDate(st.time, FMT) : st.pending}</p>
              {st.note && <p className="text-xs italic text-gray-500 mt-0.5">"{st.note}"</p>}
            </div>
          </div>
        ))}
      </div>
      {mins !== null && (
        <p className="text-xs text-gray-500 flex items-center gap-1 pl-6"><Clock className="w-3.5 h-3.5" />Time outside: {mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}</p>
      )}
      {p.gate_admin_notes && <p className="text-xs text-gray-500 pl-6"><span className="font-medium">Gate notes:</span> {p.gate_admin_notes}</p>}
      {note && <p className="text-xs text-indigo-700 bg-indigo-50 rounded px-2 py-1.5">{note}</p>}
    </div>
  );
}
