import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const ST = { pending: ['Pending', 'bg-amber-100 text-amber-800'], revoked: ['Revoked', 'bg-green-100 text-green-800'], not_applicable: ['Not applicable', 'bg-gray-100 text-gray-700'] };

// System access revocation, scheduled for the approved last working day. The MaxVolt One account itself is closed by the system when the exit is closed.
export default function ExitAccess({ exit, canAct, onChanged }) {
  const list = exit.access_checklist || [];
  const [busy, setBusy] = useState('');
  const call = async (extra, msg) => {
    setBusy(extra.key);
    try {
      let r = await base44.functions.invoke('ex_access_update', { exit_id: exit.id, ...extra });
      if (r?.data?.needs_confirm && window.confirm(`${r.data.error}`)) r = await base44.functions.invoke('ex_access_update', { exit_id: exit.id, ...extra, early_ok: true });
      if (r?.data?.success) { toast.success(msg); onChanged?.(); } else if (!r?.data?.needs_confirm) toast.error(r?.data?.error || 'Failed');
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  if (!list.length) return <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg text-sm">Access revocation is set up when the resignation is accepted.</div>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Access is revoked on or after the approved last working day ({exit.last_working_date || '—'}) through the IT process — never when the resignation is submitted. Records, attendance, payroll and documents stay after deactivation.</p>
      {list.map(i => { const [lab, cls] = ST[i.status] || ST.pending; return (
        <div key={i.key} className="border rounded-lg p-3 bg-white flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]"><p className="text-sm font-medium">{i.label}</p><p className="text-xs text-gray-500">Scheduled {i.scheduled_for || '—'}{i.done_at ? ` · done ${i.done_at.slice(0, 10)} by ${i.done_by}` : ''}{i.remarks ? ` · ${i.remarks}` : ''}</p></div>
          <Badge className={cls}>{lab}</Badge>
          {canAct && i.key !== 'maxvolt_one' && (
            <div className="flex gap-2 items-center">
              <Input type="date" className="h-8 w-36 text-xs" value={i.scheduled_for || ''} onChange={e => call({ key: i.key, scheduled_for: e.target.value }, 'Schedule updated')} />
              {i.status === 'pending' ? <>
                <Button size="sm" disabled={busy === i.key} onClick={() => call({ key: i.key, status: 'revoked' }, 'Marked revoked')}>Revoked</Button>
                <Button size="sm" variant="outline" disabled={busy === i.key} onClick={() => call({ key: i.key, status: 'not_applicable' }, 'Marked not applicable')}>N/A</Button>
              </> : <Button size="sm" variant="outline" disabled={busy === i.key} onClick={() => call({ key: i.key, status: 'pending' }, 'Re-opened')}>Re-open</Button>}
            </div>)}
          {i.key === 'maxvolt_one' && i.status === 'pending' && <span className="text-xs text-gray-500">Closed automatically when the exit is closed</span>}
        </div>); })}
    </div>
  );
}
