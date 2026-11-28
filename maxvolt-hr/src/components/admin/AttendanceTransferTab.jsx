import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, ArrowRight, Plus, X, Eye, ArrowRightLeft, Undo2 } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';

const day = (d) => (d ? safeDate(d, 'dd MMM yyyy') : '—');
const call = async (name, params) => {
  const r = await base44.functions.invoke(name, params);
  const d = r?.data || r;
  if (d?.success === false) throw new Error(d.error || 'Request failed');
  return d;
};
const label = (e) => `${e.code} · ${e.name}${e.department ? ` · ${e.department}` : ''}`;

function Picker({ list, value, onChange, placeholder, id }) {
  const chosen = list.find((e) => e.user_id === value);
  const [text, setText] = useState('');
  useEffect(() => { setText(chosen ? label(chosen) : ''); }, [value, list]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Input list={id} placeholder={placeholder} value={text} onChange={(e) => { setText(e.target.value); const hit = list.find((x) => label(x) === e.target.value); onChange(hit ? hit.user_id : ''); }} />
      <datalist id={id}>{list.map((e) => <option key={e.user_id} value={label(e)}>{e.records} records</option>)}</datalist>
      {chosen && <p className="text-[11px] text-muted-foreground mt-0.5">{chosen.records} attendance records{chosen.last_working_date ? ` · left ${day(chosen.last_working_date)}` : ` · joined ${day(chosen.date_of_joining)}`}{chosen.transferred_to ? ` · already transferred to ${chosen.transferred_to}` : ''}</p>}
    </>
  );
}

// Admin Panel → Attendance Transfer: move attendance from a left employee's old code to the same person's new code.
export default function AttendanceTransferTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pairs, setPairs] = useState([{ old_user_id: '', new_user_id: '' }]);
  const [opts, setOpts] = useState({ from: '', to: '', on_clash: 'keep_new', map_old_code: true });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => call('xf_options', {}).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const change = (next) => { setPairs(next); setPreview(null); };
  const option = (k, v) => { setOpts((o) => ({ ...o, [k]: v })); setPreview(null); };
  const ready = pairs.filter((p) => p.old_user_id && p.new_user_id);

  const run = async (name) => {
    setBusy(name);
    try {
      const d = await call(name, { pairs: ready, ...opts });
      if (name === 'xf_preview') setPreview(d.results);
      else {
        const ok = d.results.filter((r) => !r.error), bad = d.results.filter((r) => r.error);
        if (ok.length) toast.success(`Moved ${ok.reduce((s, r) => s + r.move, 0)} attendance day(s) for ${ok.length} employee(s)`);
        bad.forEach((r) => toast.error(`${r.old?.code || ''}: ${r.error}`));
        ok.filter((r) => r.mapping_note).forEach((r) => toast.warning(r.mapping_note));
        setPreview(null); setPairs([{ old_user_id: '', new_user_id: '' }]); await load();
      }
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const transfer = () => {
    const days = preview.reduce((s, r) => s + (r.move || 0), 0);
    if (window.confirm(`Move ${days} attendance day(s) to the new employee codes? You can undo this from the history below.`)) run('xf_transfer');
  };
  const undo = async (h) => {
    if (!window.confirm(`Move the attendance of ${h.new.name} back from ${h.new.code} to ${h.old.code}?`)) return;
    setBusy(h.id);
    try { await call('xf_undo', { batch_id: h.id }); toast.success('Transfer undone'); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (error) return <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>;
  if (!data) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const find = (list, id) => list.find((e) => e.user_id === id);
  const fresh = data.suggestions.filter((s) => !pairs.some((p) => p.old_user_id === s.old_user_id));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Attendance Transfer</h2>
        <p className="text-sm text-muted-foreground">Move attendance, biometric punches and regularisation requests from an old (left) employee code to the same person’s new code. Leave, payroll and gate passes are not moved. Preview first; every transfer can be undone.</p>
      </div>

      {fresh.length > 0 && (
        <div className="border rounded-lg p-3 space-y-2 bg-blue-50/50">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium">Likely the same person ({fresh.length})</p>
            <Button size="sm" variant="outline" onClick={() => change([...pairs.filter((p) => p.old_user_id || p.new_user_id), ...fresh.filter((s) => s.strong).map(({ old_user_id, new_user_id }) => ({ old_user_id, new_user_id }))])} disabled={!fresh.some((s) => s.strong)}>Add all strong matches</Button>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {fresh.map((s) => { const o = find(data.left, s.old_user_id), n = find(data.current, s.new_user_id); if (!o || !n) return null; return (
              <div key={s.old_user_id} className="flex items-center gap-2 text-sm bg-white border rounded-md px-2 py-1.5 flex-wrap">
                <span className="font-medium">{o.code}</span><span>{o.name}</span><ArrowRight className="w-3.5 h-3.5 text-muted-foreground" /><span className="font-medium">{n.code}</span><span>{n.name}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${s.strong ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{s.strong ? 'Strong' : 'Check'}: same {s.matched_on.join(', ').toLowerCase()}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => change([...pairs.filter((p) => p.old_user_id || p.new_user_id), { old_user_id: s.old_user_id, new_user_id: s.new_user_id }])}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
              </div>); })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {pairs.map((p, i) => (
          <div key={`${i}-${p.old_user_id}`} className="grid md:grid-cols-[1fr_auto_1fr_auto] gap-2 items-start">
            <div><Label className="text-xs">Old employee (left)</Label><Picker id={`xf-old-${i}`} list={data.left} value={p.old_user_id} placeholder="Type code or name" onChange={(v) => change(pairs.map((x, j) => (j === i ? { ...x, old_user_id: v } : x)))} /></div>
            <ArrowRight className="w-4 h-4 mt-8 text-muted-foreground hidden md:block" />
            <div><Label className="text-xs">New employee (current)</Label><Picker id={`xf-new-${i}`} list={data.current} value={p.new_user_id} placeholder="Type code or name" onChange={(v) => change(pairs.map((x, j) => (j === i ? { ...x, new_user_id: v } : x)))} /></div>
            <button aria-label="Remove pair" className="mt-7 p-1" onClick={() => change(pairs.length > 1 ? pairs.filter((_, j) => j !== i) : [{ old_user_id: '', new_user_id: '' }])}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => change([...pairs, { old_user_id: '', new_user_id: '' }])}><Plus className="w-4 h-4 mr-1" />Add another pair</Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div><Label className="text-xs">From date (blank = all)</Label><Input type="date" value={opts.from} onChange={(e) => option('from', e.target.value)} /></div>
        <div><Label className="text-xs">To date (blank = all)</Label><Input type="date" value={opts.to} onChange={(e) => option('to', e.target.value)} /></div>
        <div><Label className="text-xs">If both codes have punches on the same day</Label>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={opts.on_clash} onChange={(e) => option('on_clash', e.target.value)}><option value="keep_new">Keep the new code’s record</option><option value="use_old">Use the old code’s record</option></select></div>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={opts.map_old_code} onChange={(e) => option('map_old_code', e.target.checked)} /><span>Also send future punches made under the old biometric code to the new employee<span className="block text-xs text-muted-foreground">Turn off if the machine already uses the new code and the old one will be given to someone else.</span></span></label>

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={() => run('xf_preview')} disabled={!!busy || !ready.length}>{busy === 'xf_preview' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}Preview</Button>
        <Button onClick={transfer} disabled={!!busy || !preview || !preview.some((r) => !r.error && (r.move || r.punches || r.regularisations))}>{busy === 'xf_transfer' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}Transfer</Button>
      </div>

      {preview && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr>{['Old → new', 'Days to move', 'Dates', 'Replaces empty days', 'Stay on old', 'Punches', 'Regularisations'].map((h) => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {preview.map((r) => (
                <React.Fragment key={r.old_user_id}>
                  <tr>
                    <td className="px-3 py-2">{r.old?.code} → {r.new?.code}<span className="block text-xs text-muted-foreground">{r.new?.name}</span></td>
                    {r.error ? <td colSpan={6} className="px-3 py-2 text-red-700">{r.error}</td> : (
                      <><td className="px-3 py-2 font-semibold">{r.move}</td><td className="px-3 py-2 whitespace-nowrap">{r.first ? `${day(r.first)} – ${day(r.last)}` : '—'}</td><td className="px-3 py-2">{r.replace}</td><td className="px-3 py-2">{r.stay}</td><td className="px-3 py-2">{r.punches}</td><td className="px-3 py-2">{r.regularisations}</td></>
                    )}
                  </tr>
                  {r.clashes?.length > 0 && <tr><td colSpan={7} className="px-3 py-2 bg-amber-50 text-xs text-amber-900">{r.clashes.length} day(s) with punches on both codes ({opts.on_clash === 'use_old' ? 'old record will be used' : 'new record is kept'}): {r.clashes.slice(0, 15).map((c) => day(c.date)).join(', ')}{r.clashes.length > 15 ? '…' : ''}</td></tr>}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Transfer history</h3>
        {data.history.length === 0 && <p className="text-sm text-muted-foreground">No transfers yet.</p>}
        {data.history.map((h) => (
          <div key={h.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 flex-wrap">
            <span className="font-medium">{h.old.code} → {h.new.code}</span><span>{h.new.name}</span>
            <span className="text-xs text-muted-foreground">{h.counts.move} day(s), {h.counts.punches} punch(es) · {day(h.created_at.slice(0, 10))} by {h.by_name}{h.status === 'undone' ? ` · undone by ${h.undone_by_name}` : ''}</span>
            {h.mapping_note && <span className="text-xs text-amber-700 basis-full">{h.mapping_note}</span>}
            {h.status === 'done' && <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={!!busy} onClick={() => undo(h)}>{busy === h.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 mr-1" />}Undo</Button>}
          </div>
        ))}
      </div>
    </div>
  );
}
