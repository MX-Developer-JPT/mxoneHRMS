import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ob } from '@/lib/onboarding';

export const blankSalary = () => ({ ctc: '', effective_from: '', medical_contribution: '', manual: false, overrides: {}, car_lease: { amount: '', from: '', to: '', note: '' } });

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const GROUPS = [
  ['Earnings', [['basic_salary', 'Basic (50% of CTC)', 'Basic'], ['hra', 'HRA (40% of Basic)', 'HRA'], ['conveyance', 'Conveyance (balance)', 'Conveyance']]],
  ['Employee deductions', [['pf_contribution', 'PF (12%)', 'PF (employee)'], ['esi_contribution', 'ESI (0.75%)', 'ESI (employee)']]],
  ['Employer contributions', [['employer_pf_contribution', 'Employer PF (13%)', 'Employer PF'], ['employer_esi_contribution', 'Employer ESI (3.25%)', 'Employer ESI'], ['performance_bonus', null, 'Bonus / VPP']]],
];

// The optional salary step of "Start onboarding". Every figure comes from the server (ob_salary_preview), the same
// calculation that is saved, so what HR sees is what the Salary Structure page will show.
export default function SalarySection({ title, value, onChange, joiningDate, pfApplicable, esiTicked, onProblem }) {
  const [result, setResult] = useState(null);
  const set = (k, v) => onChange({ ...value, [k]: v });
  const setOverride = (k, v) => onChange({ ...value, overrides: { ...value.overrides, [k]: v } });
  const setLease = (k, v) => onChange({ ...value, car_lease: { ...value.car_lease, [k]: v } });
  const hasCtc = Number(value.ctc) > 0;
  const key = JSON.stringify([value, pfApplicable]);

  useEffect(() => {
    if (!hasCtc) { setResult(null); onProblem(value.ctc ? 'annual CTC' : ''); return undefined; }
    let live = true;
    onProblem('salary calculation');
    const t = setTimeout(() => {
      ob('ob_salary_preview', { salary: value, pf_applicable: pfApplicable })
        .then((d) => { if (live) { setResult(d); onProblem(d.errors?.length ? 'salary structure' : ''); } })
        .catch((e) => { if (live) { setResult({ errors: [e.message] }); onProblem('salary structure'); } });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = result?.values, s = result?.summary;
  const differs = s && value.manual && Math.abs(s.ctc_from_components - v.ctc) > 12;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-gray-500">Optional. Enter the annual CTC and the break-up is calculated. It is saved as the employee’s salary structure and is not shown on their onboarding form.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label className="text-xs text-gray-600">Annual CTC (₹)</Label><Input type="number" min="0" placeholder="e.g. 600000" value={value.ctc} onChange={(e) => set('ctc', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-600">Effective from</Label><Input type="date" value={value.effective_from || joiningDate || ''} onChange={(e) => set('effective_from', e.target.value)} /><p className="text-[11px] text-gray-400">Date of joining unless changed</p></div>
          <div className="space-y-1"><Label className="text-xs text-gray-600">Medical contribution (employer) / month</Label><Input type="number" min="0" value={value.medical_contribution} onChange={(e) => set('medical_contribution', e.target.value)} /></div>
        </div>

        {hasCtc && (
          <>
            <div className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <Switch checked={value.manual} onCheckedChange={(c) => set('manual', c)} />
              <div><p className="text-sm font-medium">Manual component override</p><p className="text-xs text-gray-500">Type your own amounts; a blank field keeps the calculated value</p></div>
            </div>
            {result?.errors?.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.errors.map((e) => <div key={e}>• {e}</div>)}</div>}
            {v && s && (
              <>
                {GROUPS.map(([group, fields]) => (
                  <div key={group}>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">{group} (monthly)</p>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                      {fields.map(([k, label, short]) => (
                        <div key={k} className="rounded-lg border bg-gray-50 p-2.5">
                          <p className="text-[11px] text-gray-500">{value.manual ? short : label || s.bonus_type}</p>
                          {value.manual
                            ? <Input type="number" min="0" className="mt-1 h-8 bg-white text-sm" placeholder={String(Math.round(v[k] * 100) / 100)} value={value.overrides[k] ?? ''} disabled={!pfApplicable && k.includes('pf')} onChange={(e) => setOverride(k, e.target.value)} />
                            : <p className="text-base font-semibold">{money(v[k])}</p>}
                          <p className="text-[11px] text-gray-400">{money(v[k] * 12)} a year</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!pfApplicable && <p className="text-xs text-gray-500">PF is zero because “PF applicable” is unticked above.</p>}
                {s.esi_applies !== esiTicked && <p className="text-xs text-amber-700">By Basic salary ESI {s.esi_applies ? 'applies' : 'does not apply'}, but “ESI applicable” is {esiTicked ? 'ticked' : 'unticked'} above. Check it.</p>}

                <div className="grid sm:grid-cols-4 gap-2 text-xs">
                  <div className="space-y-1"><Label className="text-xs text-gray-600">Car lease deduction / month</Label><Input type="number" min="0" placeholder="Only if applicable" value={value.car_lease.amount} onChange={(e) => setLease('amount', e.target.value)} /></div>
                  {Number(value.car_lease.amount) > 0 && (
                    <>
                      <div className="space-y-1"><Label className="text-xs text-gray-600">From month</Label><Input type="month" value={value.car_lease.from} onChange={(e) => setLease('from', e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-xs text-gray-600">Until month</Label><Input type="month" value={value.car_lease.to} onChange={(e) => setLease('to', e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-xs text-gray-600">Vehicle / reference</Label><Input maxLength={80} value={value.car_lease.note} onChange={(e) => setLease('note', e.target.value)} /></div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-center">
                  {[['Gross monthly', s.gross_monthly], ['Total deductions', s.deductions_monthly], ['Net take-home / month', s.net_monthly], ['Annual CTC', v.ctc]].map(([label, n]) => (
                    <div key={label}><p className="text-xs text-gray-600">{label}</p><p className="text-lg font-bold text-blue-900">{money(n)}</p></div>
                  ))}
                </div>
                {differs && <p className="text-xs text-amber-700">Your components add up to {money(s.ctc_from_components)} a year, not the {money(v.ctc)} CTC entered.</p>}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
