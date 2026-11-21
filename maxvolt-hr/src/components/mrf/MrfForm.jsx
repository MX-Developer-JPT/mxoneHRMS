import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Check, Save, Send, Sparkles, AlertTriangle, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, timelineHint, today } from '@/lib/mrf';
import { SearchSelect, TagInput, Field, selectCls } from './Pickers';
import JdPanel from './JdPanel';

const STEPS = ['Requisition', 'Position', 'Compensation', 'Location & timeline', 'Job brief', 'Job Description'];
const DEFAULTS = {
  requisition_type: 'new_position', department: '', designation: '', position_tier: '', position_tier_custom: '', number_of_positions: 1, hiring_manager_id: '', reports_to_user_id: '',
  employment_type: 'full_time', priority: 'medium', hiring_reason: '', replaced_employee_user_id: '', replaced_employee_name: '', replaced_employee_code: '', replacement_reason: '', expected_relieving_date: '',
  exp_mode: 'range', exp_min: '', exp_max: '', qualification: [], specialisation: [], required_skills: [], technical_skills: [], industry_experience: [], certifications: [], gender_preference: '', age_criteria: '',
  ctc_min: '', ctc_max: '', ctc_frequency: 'annual', budget_approved: false, budget_reference: '', compensation_remarks: '', disclose_ctc: false,
  work_location_type: 'office', work_location: '', work_state: '', work_city: '', work_country: 'India', is_remote: false, work_arrangement: 'on_site', remote_region: '', remote_region_detail: '',
  target_hire_date: '', expected_joining_timeline: '', timeline_justification: '',
  position_overview: '', purpose_of_hiring: '', key_responsibilities: [], key_deliverables: [], preferred_skills: [], experience_expectations: '', department_requirements: '', additional_notes: '',
};
const fromRec = (r) => { const o = { ...DEFAULTS }; for (const k of Object.keys(DEFAULTS)) if (r && r[k] !== undefined && r[k] !== null) o[k] = r[k]; return o; };
const REQUIRED = { 0: ['requisition_type', 'department', 'designation', 'position_tier', 'hiring_manager_id', 'employment_type', 'priority'] };

export default function MrfForm({ open, onClose, options, initial, onSaved }) {
  const masters = options?.masters || {};
  const me = options?.me || {};
  const locked = !!me.locked_to_self;
  const [step, setStep] = useState(0);
  const [f, setF] = useState(DEFAULTS);
  const [rec, setRec] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [hms, setHms] = useState([]);
  const [kw, setKw] = useState(null);
  const [kwBusy, setKwBusy] = useState(false);
  const fRef = useRef(f); fRef.current = f;
  const recRef = useRef(rec); recRef.current = rec;

  useEffect(() => {
    if (!open) return;
    const base = fromRec(initial);
    if (!initial && locked) { base.department = me.department || ''; base.hiring_manager_id = me.user_id; base.reports_to_user_id = me.user_id; }
    setF(base); setRec(initial || null); setDirty(false); setStep(0); setErrors([]); setKw(null);
  }, [open, initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); };
  const setMany = (o) => { setF((p) => ({ ...p, ...o })); setDirty(true); };

  // Hiring manager choices follow the department (department head and reporting managers first).
  useEffect(() => {
    if (!open || !f.department || locked) { setHms([]); return; }
    let live = true;
    mrf('mrf_hiring_managers', { department: f.department }).then((d) => { if (live) setHms(d.managers || []); }).catch(() => {});
    return () => { live = false; };
  }, [open, f.department, locked]);

  const persist = useCallback(async () => {
    const cur = fRef.current;
    setSaving(true);
    try {
      const d = await mrf('mrf_save', { id: recRef.current?.id, form: { ...cur, ctc_min: cur.ctc_min === '' ? null : cur.ctc_min, ctc_max: cur.ctc_max === '' ? null : cur.ctc_max } });
      setRec(d.requisition); setDirty(false);
      return d.requisition;
    } catch (e) { toast.error(e.message); return null; }
    finally { setSaving(false); }
  }, []);

  // autosave a couple of seconds after the last change, once there is enough to save
  useEffect(() => {
    if (!open || !dirty || !(rec?.id || (f.department && f.designation))) return undefined;
    const t = setTimeout(() => { persist(); }, 2500);
    return () => clearTimeout(t);
  }, [open, dirty, f, rec?.id, persist]);

  // never lose unsaved work to an accidental tab close
  useEffect(() => {
    if (!open || !dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [open, dirty]);

  // contextual keyword suggestions, refreshed when the position changes
  const kwKey = [f.department, f.designation, f.position_tier, f.exp_min, f.exp_max, f.employment_type, f.ctc_min, f.ctc_max, f.work_location, f.requisition_type, f.required_skills.join('|')].join('~');
  useEffect(() => {
    if (!open || !(f.department && f.designation)) { setKw(null); return undefined; }
    const t = setTimeout(async () => {
      setKwBusy(true);
      try { setKw(await mrf('mrf_ai_keywords', { form: fRef.current })); } catch { setKw(null); }
      setKwBusy(false);
    }, 900);
    return () => clearTimeout(t);
  }, [open, kwKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const opt = (kind) => (masters[kind] || []).map((m) => ({ value: m.value, label: m.label }));
  const sel = (kind, key, props = {}) => (
    <select className={selectCls} value={f[key] || ''} onChange={(e) => set(key, e.target.value)} {...props}>
      <option value="">Select…</option>
      {opt(kind).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const hint = useMemo(() => timelineHint(rec?.requisition_date || today(), f.target_hire_date), [rec?.requisition_date, f.target_hire_date]);
  const hmOptions = locked
    ? [{ value: me.user_id, label: `${me.name} (you)`, sub: me.designation }]
    : hms.map((m) => ({ value: m.user_id, label: m.name, sub: [m.designation, m.code].filter(Boolean).join(' · '), badge: m.is_head ? 'Dept head' : m.direct_reports > 0 ? 'Manager' : '' }));
  const empOptions = (options?.employees || []).map((e) => ({ value: e.user_id, label: e.name, sub: [e.designation, e.department].filter(Boolean).join(' · ') }));
  const hmChosen = f.hiring_manager_id;

  const close = () => {
    if (dirty && !window.confirm('You have unsaved changes. Close anyway? (A draft is saved automatically once the department and designation are filled.)')) return;
    onClose();
  };
  const saveDraft = async () => { const r = await persist(); if (r) { toast.success('Draft saved'); onSaved?.(r); } };
  const ensureSaved = async () => { if (!dirty && recRef.current?.id) return recRef.current.id; const r = await persist(); return r?.id || null; };

  const stepMissing = REQUIRED[step]?.filter((k) => !String(f[k] ?? '').trim());
  const next = () => {
    if (stepMissing?.length) { toast.error('Please fill the required fields (marked *) before continuing'); return; }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    setSubmitting(true); setErrors([]);
    try {
      const saved = await persist(); if (!saved) { setSubmitting(false); return; }
      const d = await mrf('mrf_submit', { id: saved.id });
      toast.success(d.requisition.hiring_manager_id === me.user_id ? 'Submitted — review and approve the JD yourself as Hiring Manager' : 'Submitted to the Hiring Manager for JD approval');
      onSaved?.(d.requisition); setDirty(false); onClose();
    } catch (e) { setErrors(e.errors?.length ? e.errors : [e.message]); }
    setSubmitting(false);
  };

  const addTo = (key, v) => set(key, [...new Set([...(f[key] || []), v])]);
  const KwChips = ({ items, target, label }) => (items?.length ? (
    <div className="mt-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.filter((s) => !(f[target] || []).some((x) => x.toLowerCase() === s.toLowerCase())).map((s) => (
          <button key={s} type="button" onClick={() => addTo(target, s)} className="rounded-full border border-dashed border-primary/50 text-primary text-xs px-2 py-0.5 hover:bg-primary/10">+ {s}</button>
        ))}
      </div>
    </div>
  ) : null);
  const KeywordPanel = () => (f.department && f.designation ? (
    <div className="rounded-lg border bg-amber-50/60 p-3">
      <p className="text-sm font-medium flex items-center gap-1.5"><Lightbulb className="w-4 h-4 text-amber-600" /> Suggested for {f.designation}, {f.department} {kwBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}</p>
      {kw?.ai_consent_required && <p className="text-xs text-muted-foreground mt-1">Showing standard suggestions. Enable AI Features in Settings for suggestions tailored to this exact role.</p>}
      {kw?.source === 'ai' && <p className="text-xs text-muted-foreground mt-1"><Sparkles className="w-3 h-3 inline" /> AI suggestions — click to add; they refresh when the position changes.</p>}
      <KwChips items={kw?.skills} target="required_skills" label="Skills → required skills" />
      <KwChips items={kw?.technical} target="technical_skills" label="Technical / functional → technical skills" />
      <KwChips items={kw?.responsibilities} target="key_responsibilities" label="Responsibilities → key responsibilities" />
      <KwChips items={kw?.deliverables} target="key_deliverables" label="Deliverables → key deliverables" />
      <KwChips items={kw?.qualifications} target="qualification" label="Qualifications → education" />
    </div>
  ) : <p className="text-xs text-muted-foreground">Choose the department and designation to see suggestions.</p>);

  const perms = { can_generate: true, can_edit: !!rec && rec.hiring_manager_id === me.user_id };
  const inputP = (k, extra = {}) => ({ value: f[k] ?? '', onChange: (e) => set(k, e.target.value), ...extra });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-5xl w-[96vw] max-h-[94vh] overflow-y-auto" onInteractOutside={(e) => { if (dirty) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Manpower Requisition {rec?.requisition_id && <span className="font-mono text-sm text-muted-foreground">{rec.requisition_id}</span>}
            <span className="ml-auto text-xs font-normal text-muted-foreground flex items-center gap-1">{saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : dirty ? 'Unsaved changes' : rec ? <><Check className="w-3 h-3 text-green-600" /> Saved</> : ''}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5 border-b pb-3">
          {STEPS.map((s, i) => (
            <button key={s} type="button" onClick={() => setStep(i)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${i === step ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}>{i + 1}. {s}</button>
          ))}
        </div>

        {step === 0 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Requisition type" required>{sel('requisition_type', 'requisition_type')}</Field>
            <Field label="Department" required hint={locked ? 'Taken from your profile.' : 'The Hiring Manager list follows this choice.'}>
              <SearchSelect value={f.department} disabled={locked} options={(options?.departments || []).map((d) => ({ value: d.name, label: d.name }))} onChange={(v) => setMany({ department: v, hiring_manager_id: '', reports_to_user_id: '' })} placeholder="Select department" />
            </Field>
            <Field label="Designation" required hint="Pick an existing designation or type a new one.">
              <SearchSelect value={f.designation} allowCustom options={(options?.designations || []).map((d) => ({ value: d, label: d }))} onChange={(v) => set('designation', v)} placeholder="e.g., Software Developer" />
            </Field>
            <Field label="Position tier" required>
              <SearchSelect value={f.position_tier} options={opt('position_tier')} onChange={(v) => set('position_tier', v)} placeholder="Select tier" />
            </Field>
            {f.position_tier === 'other_custom' && <Field label="Custom position tier / designation" required><Input {...inputP('position_tier_custom')} /></Field>}
            <Field label="Number of vacancies" required><Input type="number" min={1} {...inputP('number_of_positions')} /></Field>
            <Field label="Hiring Manager" required hint={locked ? 'You are the Hiring Manager and approve the Job Description.' : 'The Hiring Manager alone reviews and approves the Job Description. Department head and reporting managers are listed first.'}>
              <SearchSelect value={hmChosen} disabled={locked || !f.department} options={hmOptions} placeholder={f.department ? 'Select Hiring Manager' : 'Choose a department first'}
                onChange={(v) => setMany({ hiring_manager_id: v, reports_to_user_id: f.reports_to_user_id && f.reports_to_user_id !== f.hiring_manager_id ? f.reports_to_user_id : v })} />
            </Field>
            <Field label="Reporting to" hint="Defaults to the Hiring Manager.">
              <SearchSelect value={f.reports_to_user_id} options={empOptions} onChange={(v) => set('reports_to_user_id', v)} placeholder="Select" />
            </Field>
            <Field label="Employment type" required>{sel('employment_type', 'employment_type')}</Field>
            <Field label="Priority" required>{sel('priority', 'priority')}</Field>
            <Field label="Reason for hiring">{sel('hiring_reason', 'hiring_reason')}</Field>
            {f.requisition_type === 'replacement' && (
              <div className="sm:col-span-2 rounded-lg border bg-muted/30 p-3 grid sm:grid-cols-2 gap-3">
                <p className="sm:col-span-2 text-sm font-medium">Replacement details</p>
                <Field label="Employee being replaced" required>
                  <SearchSelect value={f.replaced_employee_user_id} allowCustom options={empOptions}
                    onChange={(v) => { const e = (options?.employees || []).find((x) => x.user_id === v); setMany(e ? { replaced_employee_user_id: v, replaced_employee_name: e.name, replaced_employee_code: e.code || '' } : { replaced_employee_user_id: '', replaced_employee_name: v }); }} placeholder="Search employee or type a name" />
                </Field>
                <Field label="Employee ID"><Input {...inputP('replaced_employee_code')} /></Field>
                <Field label="Reason for replacement" required><Input {...inputP('replacement_reason')} /></Field>
                <Field label="Expected relieving date"><Input type="date" {...inputP('expected_relieving_date')} /></Field>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Experience selection" className="sm:col-span-2">
              <div className="inline-flex rounded-md border overflow-hidden text-xs">
                {[['range', 'Minimum & maximum'], ['single', 'Single range']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setMany({ exp_mode: k, ...(k === 'single' ? { exp_max: f.exp_min } : {}) })} className={`px-3 py-1.5 ${f.exp_mode === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label={f.exp_mode === 'single' ? 'Experience required' : 'Minimum experience'}>
              <select className={selectCls} value={f.exp_min} onChange={(e) => setMany({ exp_min: e.target.value, ...(f.exp_mode === 'single' ? { exp_max: e.target.value } : {}) })}><option value="">Select…</option>{opt('experience_range').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </Field>
            {f.exp_mode !== 'single' && <Field label="Maximum experience">{sel('experience_range', 'exp_max')}</Field>}
            <Field label="Educational qualification"><TagInput value={f.qualification} onChange={(v) => set('qualification', v)} suggestions={[...opt('qualification').map((o) => o.label), ...(kw?.qualifications || [])]} placeholder="Add qualification" /></Field>
            <Field label="Preferred specialisation"><TagInput value={f.specialisation} onChange={(v) => set('specialisation', v)} placeholder="e.g., Electronics" /></Field>
            <Field label="Required skills" className="sm:col-span-2"><TagInput value={f.required_skills} onChange={(v) => set('required_skills', v)} suggestions={[...(kw?.skills || []), ...opt('skill').map((o) => o.label)]} placeholder="Add a skill" /></Field>
            <Field label="Technical skills" className="sm:col-span-2"><TagInput value={f.technical_skills} onChange={(v) => set('technical_skills', v)} suggestions={kw?.technical || []} placeholder="Add a technical skill" /></Field>
            <Field label="Industry experience"><TagInput value={f.industry_experience} onChange={(v) => set('industry_experience', v)} placeholder="e.g., Automotive, EV" /></Field>
            <Field label="Certifications (optional)"><TagInput value={f.certifications} onChange={(v) => set('certifications', v)} placeholder="e.g., PMP" /></Field>
            <Field label="Gender preference (optional)" hint="Use only where permitted by employment policy and law."><Input {...inputP('gender_preference')} /></Field>
            <Field label="Age criteria (optional)" hint="Use only where permitted by employment policy and law."><Input {...inputP('age_criteria')} /></Field>
            <div className="sm:col-span-2"><KeywordPanel /></div>
          </div>
        )}

        {step === 2 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Minimum CTC (₹)"><Input type="number" min={0} {...inputP('ctc_min')} /></Field>
            <Field label="Maximum CTC (₹)"><Input type="number" min={0} {...inputP('ctc_max')} /></Field>
            <Field label="CTC frequency">{sel('ctc_frequency', 'ctc_frequency')}</Field>
            <Field label="Budget approved?">
              <select className={selectCls} value={f.budget_approved ? 'yes' : 'no'} onChange={(e) => set('budget_approved', e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes</option></select>
            </Field>
            <Field label="Budget approval reference"><Input {...inputP('budget_reference')} /></Field>
            <Field label="Compensation remarks"><Input {...inputP('compensation_remarks')} /></Field>
            <label className="sm:col-span-2 flex items-start gap-2 text-sm rounded-lg border p-3 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={f.disclose_ctc} onChange={(e) => set('disclose_ctc', e.target.checked)} />
              <span><span className="font-medium">Show the CTC range in the Job Description and on job portals</span><br /><span className="text-xs text-muted-foreground">Off by default — the range stays internal unless you tick this.</span></span>
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Work location type">{sel('work_location_type', 'work_location_type')}</Field>
            <Field label="Work arrangement" required>
              <select className={selectCls} value={f.work_arrangement} onChange={(e) => setMany({ work_arrangement: e.target.value, is_remote: e.target.value === 'remote' })}>
                <option value="">Select…</option>{opt('work_arrangement').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Work location" hint="Pick an existing office or type any new city, dealer location, project site, warehouse or regional office. The location master is not changed.">
              <SearchSelect value={f.work_location} allowCustom options={(options?.locations || []).map((l) => ({ value: l.name, label: l.name, sub: [l.city, l.state].filter(Boolean).join(', ') }))} onChange={(v) => { const l = (options?.locations || []).find((x) => x.name === v); setMany({ work_location: v, ...(l?.city ? { work_city: l.city } : {}), ...(l?.state ? { work_state: l.state } : {}) }); }} placeholder="Search or type a location" />
            </Field>
            <Field label="City"><Input {...inputP('work_city')} /></Field>
            <Field label="State"><Input {...inputP('work_state')} /></Field>
            <Field label="Country"><Input {...inputP('work_country')} /></Field>
            {(f.is_remote || f.work_arrangement === 'remote') && (
              <>
                <Field label="Remote — eligible region">{sel('remote_region', 'remote_region')}</Field>
                <Field label="Region details" hint="State, city or custom area, if applicable."><Input {...inputP('remote_region_detail')} /></Field>
              </>
            )}
            <Field label="Target hiring date" className="sm:col-span-2" hint="">
              <Input type="date" {...inputP('target_hire_date')} className="max-w-[220px]" />
              <p className={`text-xs mt-1.5 ${hint.state === 'aggressive' ? 'text-amber-700' : hint.state === 'extended' ? 'text-blue-700' : hint.state === 'ideal' ? 'text-green-700' : 'text-muted-foreground'}`}>
                {hint.state === 'aggressive' && <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}{hint.message}
              </p>
            </Field>
            <Field label="Expected joining timeline"><Input {...inputP('expected_joining_timeline')} placeholder="e.g., Within 30 days of offer" /></Field>
            {(hint.state === 'aggressive' || hint.state === 'extended') && (
              <Field label="Justification for this timeline (optional)"><Input {...inputP('timeline_justification')} placeholder="Why is this date needed?" /></Field>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Position overview" className="sm:col-span-2"><textarea className="w-full rounded-md border border-input bg-background p-2 text-sm min-h-[80px]" {...inputP('position_overview')} /></Field>
            <Field label="Purpose of hiring" className="sm:col-span-2"><textarea className="w-full rounded-md border border-input bg-background p-2 text-sm min-h-[60px]" {...inputP('purpose_of_hiring')} /></Field>
            <Field label="Key responsibilities" className="sm:col-span-2"><TagInput value={f.key_responsibilities} onChange={(v) => set('key_responsibilities', v)} suggestions={kw?.responsibilities || []} placeholder="Add a responsibility and press Enter" /></Field>
            <Field label="Key deliverables" className="sm:col-span-2"><TagInput value={f.key_deliverables} onChange={(v) => set('key_deliverables', v)} suggestions={kw?.deliverables || []} placeholder="Add a deliverable" /></Field>
            <Field label="Preferred skills" className="sm:col-span-2"><TagInput value={f.preferred_skills} onChange={(v) => set('preferred_skills', v)} suggestions={kw?.skills || []} placeholder="Add a preferred skill" /></Field>
            <Field label="Experience expectations"><Input {...inputP('experience_expectations')} /></Field>
            <Field label="Department-specific requirements"><Input {...inputP('department_requirements')} /></Field>
            <Field label="Additional hiring notes" className="sm:col-span-2"><textarea className="w-full rounded-md border border-input bg-background p-2 text-sm min-h-[60px]" {...inputP('additional_notes')} /></Field>
            <div className="sm:col-span-2"><KeywordPanel /></div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">The AI drafts the Job Description from the details you entered. {rec?.hiring_manager_id === me.user_id ? 'As Hiring Manager you can edit and refine it, then approve it after submitting.' : 'It is sent to the Hiring Manager, who alone edits and approves it.'}</p>
            <JdPanel rec={rec} ensureSaved={ensureSaved} perms={perms} onUpdated={(r) => { setRec(r); }} />
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">Please fix before submitting:</p><ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
          {step < STEPS.length - 1 && <Button variant="outline" onClick={next}>Next<ChevronRight className="w-4 h-4 ml-1" /></Button>}
          <Button variant="ghost" onClick={saveDraft} disabled={saving || !(f.department && f.designation)}><Save className="w-4 h-4 mr-1.5" />Save draft</Button>
          <Button className="ml-auto" onClick={submit} disabled={submitting || saving}>
            {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}Submit for JD approval
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
