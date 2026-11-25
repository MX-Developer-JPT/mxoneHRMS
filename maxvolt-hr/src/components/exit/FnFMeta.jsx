import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

// Settlement tracking details (the amounts live in the settlement below, which follows the payroll-linked approval path).
export default function FnFMeta({ exit, onChanged }) {
  const m = exit.fnf_meta || {};
  const [date, setDate] = useState(m.tentative_date || '');
  const [hold, setHold] = useState(!!m.on_hold);
  const [why, setWhy] = useState(m.hold_reason || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await base44.functions.invoke('ex_fnf_meta', { exit_id: exit.id, tentative_date: date, on_hold: hold, hold_reason: why }); if (r?.data?.success) { toast.success('Saved'); onChanged?.(); } else toast.error(r?.data?.error || 'Failed'); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const fd = exit.fnf_data || {};
  return (
    <div className="border rounded-lg p-3 bg-gray-50 grid md:grid-cols-4 gap-3 items-end text-sm">
      <div><Label className="text-xs">Initiated</Label><p>{m.initiated_at ? m.initiated_at.slice(0, 10) : '—'}</p></div>
      <div><Label className="text-xs">Tentative settlement date</Label><Input type="date" className="h-8" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div><Label className="text-xs">Actual settlement date</Label><p>{fd.finance_processed_at ? fd.finance_processed_at.slice(0, 10) : '—'}{fd.payment_reference ? ` · ref ${fd.payment_reference}` : ''}</p></div>
      <div className="flex items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={hold} onChange={e => setHold(e.target.checked)} />On hold</label><Button size="sm" variant="outline" disabled={busy} onClick={save}>Save</Button></div>
      {hold && <div className="md:col-span-4"><Label className="text-xs">Reason for hold (required)</Label><Input className="h-8" value={why} onChange={e => setWhy(e.target.value)} /></div>}
    </div>
  );
}
