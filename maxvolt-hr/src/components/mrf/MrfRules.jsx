import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { mrf } from '@/lib/mrf';
import { selectCls } from './Pickers';

const DH_LABELS = { never: 'Never (Hiring Manager approval, then HR publishes)', always: 'Every requisition', non_budgeted: 'Only Non-Budgeted requisitions', critical_override: 'Only when a critical flag was overridden' };
const ROLE_LABELS = { hr: 'HR', admin: 'Admin', management: 'Management' };
const cell = (v) => (v === null || v === undefined ? '' : v);

/** HR / admin: the thresholds behind every validation flag, who may override, and the allowed time at each hiring stage. */
export default function MrfRules() {
  const [meta, setMeta] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  useEffect(() => { mrf('mrf_rules_get').then((d) => { setMeta(d); setCfg(d.config); }).catch((e) => toast.error(e.message)); }, []);
  if (!cfg) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  // CTC is typed in lakhs per annum and stored in rupees
  const setTier = (tier, key, value) => setCfg((c) => ({ ...c, tiers: { ...c.tiers, [tier]: { ...(c.tiers[tier] || {}), [key]: value === '' ? null : key.startsWith('ctc') ? Math.round(Number(value) * 100000) : Number(value) } } }));
  const tierValue = (tier, key) => { const v = cfg.tiers[tier]?.[key]; return v === null || v === undefined ? '' : key.startsWith('ctc') ? v / 100000 : v; };
  const toggle = (k, v, on) => set(k, on ? [...new Set([...cfg[k], v])] : cfg[k].filter((x) => x !== v));
  const save = async () => {
    setBusy(true); setErrors([]);
    try { const d = await mrf('mrf_rules_save', { config: cfg }); setCfg(d.config); toast.success('Validation rules saved'); }
    catch (e) { setErrors(e.errors?.length ? e.errors : [e.message]); toast.error(e.message); }
    setBusy(false);
  };
  const Num = ({ k, label, hint }) => (
    <label className="text-sm block">{label}<Input type="number" className="mt-1 max-w-[140px]" value={cell(cfg[k])} onChange={(e) => set(k, e.target.value)} />{hint && <span className="text-xs text-muted-foreground block mt-1">{hint}</span>}</label>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <p className="text-sm text-muted-foreground">Changes apply to requisitions checked from now on. <b>Critical</b> flags block submission unless overridden with a justification, <b>warnings</b> are sent to HR for review, and <b>information</b> notes are advice only.</p>

      <Card><CardHeader className="pb-2"><CardTitle className="text-base">CTC and experience by position tier</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <p className="text-xs text-muted-foreground mb-2">CTC in <b>lakhs per annum</b> (5 = ₹5,00,000). A blank box means no limit. No CTC ranges are preset — a CTC mismatch is only raised for tiers you fill in.</p>
          <table className="w-full text-sm min-w-[620px]">
            <thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Position tier</th><th>CTC min (LPA)</th><th>CTC max (LPA)</th><th>Experience min (yrs)</th><th>Experience max (yrs)</th></tr></thead>
            <tbody>
              {meta.tiers.filter((t) => t.value !== 'other_custom').map((t) => (
                <tr key={t.value} className="border-b">
                  <td className="py-1.5 pr-2">{t.label}</td>
                  {['ctc_min', 'ctc_max', 'exp_min', 'exp_max'].map((k) => <td key={k} className="pr-2"><Input type="number" min={0} step={k.startsWith('ctc') ? '0.1' : '1'} className="h-8 max-w-[120px]" aria-label={`${t.label} ${k.replace('_', ' ')}`} value={tierValue(t.value, k)} onChange={(e) => setTier(t.value, k, e.target.value)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Sensitivity</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <Num k="ctc_critical_pct" label="CTC: critical when outside by (%)" hint="A smaller gap is a warning." />
            <Num k="exp_critical_gap" label="Experience: critical when outside by (years)" hint="0 = experience checks only warn." />
            <Num k="history_deviation_pct" label="Existing pay: warn when different by (%)" />
            <Num k="history_min_samples" label="Existing pay: records needed" hint="At least 3, so no single salary is exposed." />
          </CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Checks and approvals</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><p className="font-medium mb-1">Checks switched on</p>
              <div className="grid sm:grid-cols-2 gap-1">{Object.entries(meta.rules).map(([k, r]) => <label key={k} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={!cfg.disabled_rules.includes(k)} onChange={(e) => toggle('disabled_rules', k, !e.target.checked)} />{r.label}</label>)}</div></div>
            <div><p className="font-medium mb-1">Who may override a flag</p>
              <div className="flex flex-wrap gap-3">{Object.entries(ROLE_LABELS).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.override_roles.includes(k)} onChange={(e) => toggle('override_roles', k, e.target.checked)} />{l}</label>)}</div></div>
            <label className="block font-medium">Department Head approval before publication
              <select className={selectCls + ' mt-1 font-normal'} value={cfg.dept_head_approval} onChange={(e) => set('dept_head_approval', e.target.value)}>{meta.dept_head_modes.map((m) => <option key={m} value={m}>{DH_LABELS[m]}</option>)}</select></label>
          </CardContent></Card>
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Allowed time at each stage (days)</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(meta.sla_labels).map(([k, l]) => <label key={k} className="text-sm flex items-center justify-between gap-2"><span>{l}</span><Input type="number" min={0} className="h-8 w-20" value={cell(cfg.sla[k])} onChange={(e) => set('sla', { ...cfg.sla, [k]: e.target.value })} /></label>)}
        </CardContent></Card>

      {errors.length > 0 && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"><ul className="list-disc pl-5">{errors.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}Save rules</Button>
    </div>
  );
}
