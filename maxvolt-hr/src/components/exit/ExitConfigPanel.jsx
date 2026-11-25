import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';

const DOC_NAMES = { resignation_acknowledgement: 'Resignation acknowledgement', resignation_acceptance: 'Resignation acceptance letter', notice_waiver: 'Notice period waiver letter', relieving_letter: 'Relieving letter', experience_certificate: 'Experience certificate' };
const PLACEHOLDERS = '{{employee_name}} {{employee_code}} {{designation}} {{department_clause}} {{date_of_joining}} {{resignation_date}} {{proposed_last_day}} {{last_working_date}} {{today}} {{reference_no}} {{notice_days}} {{waived_days}} {{prefix}} {{pronoun_sub}} {{pronoun_obj}} {{pronoun_pos}}';
const Num = ({ label, k, c, set, hint }) => <div><Label className="text-xs">{label}</Label><Input type="number" className="h-9" value={c[k] ?? ''} onChange={e => set(k, e.target.value)} />{hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}</div>;
const Tog = ({ label, k, c, set }) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c[k]} onChange={e => set(k, e.target.checked)} />{label}</label>;

// Masters: notice rules, approval path, reasons, access items, letter templates and the on/off rules — changed here, no code change needed.
export default function ExitConfigPanel() {
  const [c, setC] = useState(null);
  const [tpl, setTpl] = useState({});
  const [defaults, setDefaults] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { base44.functions.invoke('ex_config_get', {}).then(r => { const d = r?.data; if (d?.success) { setC(d.config); setTpl(d.templates); setDefaults(d.defaults.templates); } else toast.error(d?.error || 'Could not load settings'); }).catch(e => toast.error(e.message)); }, []);
  if (!c) return <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const set = (k, v) => setC(p => ({ ...p, [k]: v }));
  const editList = (k, i, f, v) => set(k, c[k].map((x, n) => n === i ? { ...x, [f]: v } : x));
  const save = async () => {
    setSaving(true);
    try {
      const r = await base44.functions.invoke('ex_config_save', { config: { ...c, doc_templates: Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, { title: v.title, body: v.body }])) } });
      if (r?.data?.success) toast.success('Exit settings saved'); else toast.error(r?.data?.error || 'Could not save');
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };
  const ListEditor = ({ k, title, withRemarks }) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      {c[k].map((x, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input className="h-8 flex-1" value={x.label} onChange={e => editList(k, i, 'label', e.target.value)} />
          <Input className="h-8 w-44 text-xs text-gray-500" value={x.key} onChange={e => editList(k, i, 'key', e.target.value)} title="Internal key" />
          {withRemarks && <label className="text-xs flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={!!x.remarks_required} onChange={e => editList(k, i, 'remarks_required', e.target.checked)} />remarks required</label>}
          <button onClick={() => set(k, c[k].filter((_, n) => n !== i))} className="text-red-600"><Trash2 className="w-4 h-4" /></button>
        </div>))}
      <Button size="sm" variant="outline" onClick={() => set(k, [...c[k], { key: `item_${c[k].length + 1}`, label: '' }])}><Plus className="w-3 h-3 mr-1" />Add</Button>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center"><p className="text-sm text-gray-600">Changes apply to new resignations straight away. Department clearance owners and checklists are kept under Admin Panel → Exit Clearance Owners.</p><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}Save settings</Button></div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Notice period</CardTitle></CardHeader><CardContent className="grid md:grid-cols-5 gap-3">
        <Num label="Regular staff (days)" k="notice_default_days" c={c} set={set} hint="Used when the employee record has no notice period" />
        <Num label="Senior grades (days)" k="notice_senior_days" c={c} set={set} /><Num label="Contract / intern (days)" k="notice_contract_days" c={c} set={set} /><Num label="Longest accepted (days)" k="max_notice_days" c={c} set={set} />
        <div><Label className="text-xs">Count notice in</Label><select className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={c.notice_day_mode} onChange={e => set('notice_day_mode', e.target.value)}><option value="calendar">Calendar days</option><option value="working">Working days (skip weekly off + holidays)</option></select></div>
      </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Approval path & escalation</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap gap-6"><Tog label="Include the HOD (department head) step" k="approval_hod_enabled" c={c} set={set} /><Tog label="Allow retention discussions" k="retention_enabled" c={c} set={set} /></div>
        <p className="text-xs text-gray-500">Management approval is added only when one of these matches (comma separated; leave empty for none):</p>
        <div className="grid md:grid-cols-3 gap-3">
          <div><Label className="text-xs">Grades</Label><Input value={c.management_grades || ''} onChange={e => set('management_grades', e.target.value)} placeholder="e.g. G7, G8" /></div>
          <div><Label className="text-xs">Departments</Label><Input value={c.management_departments || ''} onChange={e => set('management_departments', e.target.value)} placeholder="e.g. Finance & Accounts" /></div>
          <div><Label className="text-xs">Designations containing</Label><Input value={c.management_designations || ''} onChange={e => set('management_designations', e.target.value)} placeholder="e.g. head, director, vp" /></div>
        </div>
        <div className="grid md:grid-cols-2 gap-3"><Num label="Manager / HOD may take (days) before HR is told" k="manager_decision_days" c={c} set={set} /><Num label="HR / management may take (days) before a reminder" k="hr_decision_days" c={c} set={set} /></div>
      </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Rules</CardTitle></CardHeader><CardContent className="grid md:grid-cols-2 gap-3">
        <Tog label="Exit interview must be done (or skipped by HR) before closing" k="require_exit_interview" c={c} set={set} />
        <Tog label="Employee must sign the exit declaration" k="require_employee_declaration" c={c} set={set} />
        <Tog label="Knowledge transfer must be verified before the department clears" k="require_kra_handover" c={c} set={set} />
        <Tog label="Settlement: preparer, verifier and approver must be different people" k="enforce_fnf_segregation" c={c} set={set} />
        <Tog label="Encash earned leave in the settlement" k="leave_encashment_enabled" c={c} set={set} />
        <Num label="Gratuity eligibility (years)" k="gratuity_min_years" c={c} set={set} />
      </CardContent></Card>
      <Card><CardContent className="pt-4 grid md:grid-cols-2 gap-6"><ListEditor k="reasons" title="Resignation reasons" withRemarks /><ListEditor k="access_items" title="System access to revoke" /></CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Letter templates</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-xs text-gray-500">Use these placeholders: <span className="font-mono">{PLACEHOLDERS}</span></p>
        {Object.keys(DOC_NAMES).map(k => tpl[k] && (
          <div key={k} className="space-y-1"><div className="flex items-center justify-between"><Label className="text-sm font-semibold">{DOC_NAMES[k]}{tpl[k].custom ? ' (customised)' : ''}</Label><button className="text-xs text-blue-700" onClick={() => setTpl(t => ({ ...t, [k]: { ...t[k], body: defaults[k].body, custom: false } }))}>Reset to standard wording</button></div>
            <Textarea rows={7} className="font-mono text-xs" value={tpl[k].body} onChange={e => setTpl(t => ({ ...t, [k]: { ...t[k], body: e.target.value } }))} /></div>))}
      </CardContent></Card>
    </div>
  );
}
