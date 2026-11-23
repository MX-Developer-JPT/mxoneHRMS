import React from 'react';
import { FileClock, CheckCircle2, XCircle, Hourglass, Ban } from 'lucide-react';

// Every time stored on a leave is a real instant (ISO "…Z" or the database's "… +00"), so show it in IST.
function instant(v) {
  const raw = String(v || '').trim(); if (!raw) return null;
  let iso = raw.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(iso)) iso += ':00';
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const fmtIst = (v) => {
  const d = instant(v); if (!d) return '—';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};

const levelName = (h, resolveApprover) => {
  if (h.level_label) return h.level_label;
  const who = h.level && resolveApprover ? resolveApprover(h.level) : '';
  return h.level ? `Level ${h.level}${who ? ` (${who})` : ''}` : 'Final approval';
};

/**
 * One line per step of a leave's life, with who did it and exactly when:
 *   applied → approved at each level → final decision, or "awaiting level N: <approver>" while it is still pending.
 * `resolveApprover(level)` names who the given level waits on (the page knows the reporting manager and the workflow).
 */
export default function LeaveTimeline({ leave, resolveApprover, applicantName, compact = false }) {
  if (!leave) return null;
  const hist = (leave.approval_history || []).filter((h) => h && (h.action || h.status));
  const steps = [{ key: 'applied', icon: FileClock, cls: 'text-gray-600', title: 'Applied', who: applicantName || leave.employee_name || '', at: leave.created_date || leave.applied_at }];
  for (const [i, h] of hist.entries()) {
    const action = h.action || h.status;
    const approved = /approv/i.test(action) && !/cancel/i.test(action);
    const cancelled = /cancel/i.test(action);
    steps.push({
      key: `h${i}`, icon: cancelled ? Ban : approved ? CheckCircle2 : XCircle, cls: cancelled ? 'text-gray-600' : approved ? 'text-green-700' : 'text-red-600',
      title: `${levelName(h, resolveApprover)} — ${cancelled ? 'cancelled' : approved ? 'approved' : 'rejected'}`, who: h.by_name || h.approver_name || '', at: h.at || h.timestamp, note: h.note || h.comments,
    });
  }
  // older records that predate the history list
  if (!hist.some((h) => /approv/i.test(h.action || h.status || '')) && leave.status === 'approved' && leave.approved_date) steps.push({ key: 'ap', icon: CheckCircle2, cls: 'text-green-700', title: 'Approved', who: leave.approved_by_name || '', at: leave.approved_date, note: leave.approval_note });
  if (!hist.some((h) => /reject/i.test(h.action || h.status || '')) && leave.status === 'rejected') steps.push({ key: 'rj', icon: XCircle, cls: 'text-red-600', title: 'Rejected', who: leave.rejected_by_name || '', at: leave.rejected_at, note: leave.rejection_reason });
  if (leave.status === 'cancelled' && !hist.some((h) => /cancel/i.test(h.action || ''))) steps.push({ key: 'cn', icon: Ban, cls: 'text-gray-600', title: leave.cancelled_after_approval ? 'Cancelled after approval' : 'Cancelled', who: leave.cancelled_by_name || '', at: leave.cancelled_at, note: leave.cancel_reason });
  if (leave.status === 'pending') {
    const lvl = leave.current_approval_level || 1;
    const who = resolveApprover ? resolveApprover(lvl) : '';
    steps.push({ key: 'wait', icon: Hourglass, cls: 'text-amber-600', title: `Awaiting level ${lvl} approval`, who: who ? `with ${who}` : '', at: null, pending: true });
  }
  return (
    <div className={`${compact ? 'mt-1' : 'mt-2'} rounded-md bg-gray-50 border border-gray-100 px-2.5 py-2 space-y-1.5`} aria-label="Leave timeline">
      {steps.map((s) => (
        <div key={s.key} className="flex items-start gap-2 text-xs">
          <s.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${s.cls}`} />
          <div className="min-w-0">
            <span className={`font-medium ${s.cls}`}>{s.title}</span>
            {s.who && <span className="text-gray-600"> {s.pending ? s.who : `by ${s.who}`}</span>}
            {!s.pending && <span className="text-gray-500"> · {fmtIst(s.at)}</span>}
            {s.note && <span className="block italic text-gray-500">“{s.note}”</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
