import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STYLE = {
  critical: { label: 'Critical', box: 'border-red-300 bg-red-50 text-red-900', icon: AlertOctagon, tone: 'text-red-600' },
  warning: { label: 'Warning', box: 'border-amber-300 bg-amber-50 text-amber-900', icon: AlertTriangle, tone: 'text-amber-600' },
  information: { label: 'Information', box: 'border-blue-200 bg-blue-50 text-blue-900', icon: Info, tone: 'text-blue-600' },
};

function Flag({ flag, canOverride, onOverride }) {
  const s = STYLE[flag.severity] || STYLE.information; const Icon = s.icon;
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await onOverride(flag, why.trim()); setOpen(false); setWhy(''); } finally { setBusy(false); } };
  return (
    <div className={`rounded-md border p-2 text-xs ${flag.override ? 'border-green-300 bg-green-50 text-green-900' : s.box}`} role={flag.severity === 'critical' && !flag.override ? 'alert' : undefined}>
      <div className="flex items-start gap-1.5">
        {flag.override ? <ShieldCheck className="w-4 h-4 shrink-0 text-green-600" /> : <Icon className={`w-4 h-4 shrink-0 ${s.tone}`} />}
        <div className="min-w-0 flex-1">
          <p><b>{s.label} · {flag.title}:</b> {flag.message}</p>
          {flag.detail && <p className="opacity-80 mt-0.5">{flag.detail}</p>}
          {flag.override && <p className="mt-0.5">Overridden by <b>{flag.override.by_name}</b>: “{flag.override.justification}”</p>}
        </div>
        {canOverride && !flag.override && flag.severity !== 'information' && !open && (
          <button type="button" className="underline shrink-0 font-medium" onClick={() => setOpen(true)}>Override</button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input autoFocus className="h-8 flex-1 min-w-[200px] bg-white text-foreground" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is this exception acceptable? (at least 10 characters)" aria-label={`Justification for overriding ${flag.title}`} />
          <Button size="sm" className="h-8" disabled={busy || why.trim().length < 10} onClick={save}>Record override</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

/** The anomalies of a requisition (all of them, or those of one form field). */
export default function ValidationFlags({ flags, field, canOverride = false, onOverride, className = '' }) {
  const shown = (flags || []).filter((f) => !field || [].concat(field).includes(f.field));
  if (!shown.length) return null;
  return <div className={`space-y-1.5 ${className}`}>{shown.map((f) => <Flag key={f.key} flag={f} canOverride={canOverride && !!onOverride} onOverride={onOverride} />)}</div>;
}
