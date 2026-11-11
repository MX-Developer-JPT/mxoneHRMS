import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { ap, inputCls } from '@/lib/appraisal';

export default function SettingsAdmin() {
  const [s, setS] = useState(null);
  useEffect(() => { ap('ap_get_settings').then(d => setS(d.settings)).catch(e => toast.error(e.message)); }, []);
  if (!s) return <p className="text-sm text-slate-400">Loading…</p>;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const save = async () => { try { const d = await ap('ap_save_settings', s); setS(d.settings); toast.success(d.note || 'Saved'); } catch (e) { toast.error(e.message); } };
  const wsum = s.competencies.filter(c => c.enabled).reduce((a, c) => a + (Number(c.weight) || 0), 0);
  return (<div className="space-y-6 max-w-4xl">
    <p className="text-sm text-slate-500">These apply to cycles published from now on. A published cycle keeps the scale, bands and split it started with, so results never shift underneath employees.</p>
    <section className="space-y-2"><h3 className="font-semibold">Rating scale</h3>
      {s.scale.map((r, i) => <div key={i} className="grid grid-cols-12 gap-2"><input type="number" className={`${inputCls} col-span-2`} value={r.value} onChange={e => set('scale', s.scale.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} /><input className={`${inputCls} col-span-9`} value={r.label} onChange={e => set('scale', s.scale.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /><Button size="sm" variant="ghost" className="col-span-1" onClick={() => set('scale', s.scale.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button></div>)}
      <Button size="sm" variant="outline" onClick={() => set('scale', [...s.scale, { value: (Math.max(0, ...s.scale.map(x => Number(x.value))) + 1), label: '' }])}>+ Rating</Button>
      <p className="text-xs text-slate-500">Weighted score = rating × weightage ÷ highest rating. Changing the highest value (e.g. a 1–10 scale) rescales every calculation automatically.</p></section>
    <section className="space-y-2"><h3 className="font-semibold">Rating bands (minimum score → label)</h3>
      {s.bands.map((b, i) => <div key={i} className="grid grid-cols-12 gap-2"><input type="number" className={`${inputCls} col-span-2`} value={b.min} onChange={e => set('bands', s.bands.map((x, j) => j === i ? { ...x, min: e.target.value } : x))} /><input className={`${inputCls} col-span-9`} value={b.label} onChange={e => set('bands', s.bands.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /><Button size="sm" variant="ghost" className="col-span-1" onClick={() => set('bands', s.bands.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button></div>)}
      <Button size="sm" variant="outline" onClick={() => set('bands', [...s.bands, { min: 0, label: '' }])}>+ Band</Button></section>
    <section className="space-y-2"><h3 className="font-semibold">Score split</h3>
      <div className="flex items-center gap-3 text-sm">KPI/KRA <input type="number" className={`${inputCls} w-24`} value={s.split.kpi} onChange={e => set('split', { ...s.split, kpi: e.target.value })} />% + Competencies <input type="number" className={`${inputCls} w-24`} value={s.split.competency} onChange={e => set('split', { ...s.split, competency: e.target.value })} />% <span className="text-slate-500">(must total 100; applies when a cycle includes competencies)</span></div>
      <div className="text-sm font-medium pt-2">Competencies <span className={wsum === 100 ? 'text-emerald-700' : 'text-red-600'}>(enabled weights total {wsum}%)</span></div>
      {s.competencies.map((c, i) => <div key={c.id} className="grid grid-cols-12 gap-2 items-center"><input type="checkbox" className="col-span-1" checked={c.enabled} onChange={e => set('competencies', s.competencies.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} /><input className={`${inputCls} col-span-8`} value={c.name} onChange={e => set('competencies', s.competencies.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><input type="number" className={`${inputCls} col-span-2`} value={c.weight} onChange={e => set('competencies', s.competencies.map((x, j) => j === i ? { ...x, weight: e.target.value } : x))} /></div>)}</section>
    <section className="grid md:grid-cols-3 gap-3 text-sm"><label>Decimal places<input type="number" min="0" max="4" className={inputCls} value={s.decimals} onChange={e => set('decimals', e.target.value)} /></label>
      <label>Reminder days before deadline<input className={inputCls} value={(s.reminder_days || []).join(', ')} onChange={e => set('reminder_days', e.target.value.split(',').map(x => Number(x.trim())).filter(x => Number.isInteger(x)))} /></label>
      <label>Flag rating gaps of at least<input type="number" className={inputCls} value={s.large_gap} onChange={e => set('large_gap', e.target.value)} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={s.require_meeting !== false} onChange={e => set('require_meeting', e.target.checked)} />Meeting required before HR approval</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={s.allow_late_submission !== false} onChange={e => set('allow_late_submission', e.target.checked)} />Allow late submissions (flagged)</label></section>
    <Button onClick={save}>Save settings</Button>
  </div>);
}
