import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Check, Save, Send, Sparkles, AlertTriangle, ChevronLeft, ChevronRight, Lightbulb, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, timelineHint, today, suggestTier, plusDays } from '@/lib/mrf';
import { SearchSelect, TagInput, Field, selectCls } from './Pickers';
import JdPanel from './JdPanel';

// Three short steps: the essentials, optional role detail (with one-click suggestions), then the Job Description + submit.
const STEPS = ['1. Basics', '2. Role details', '3. Job Description'];
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
// what must be filled before moving on (label shown if missing)
const REQUIRED = [['requisition_type', 'Requisition type'], ['department', 'Department'], ['designation', 'Designation'], ['position_tier', 'Position tier'], ['hiring_manager_id', 'Hiring Manager'], ['employment_type', 'Employment type'], ['priority', 'Priority'], ['work_arrangement', 'Work arrangement']];

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
  const [missing, setMissing] = useState([]);
  const [hms, setHms] = useState([]);
  const [kw, setKw] = useState(null);
  const [kwBusy, setKwBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [more2, setMore2] = useState(false);
  const [autoGen, setAutoGen] = useState(false);
  const tierTouched = useRef(false);
  const fRef = useRef(f); fRef.current = f;
  const recRef = useRef(rec); recRef.current = rec;
  const autoTried = useRef(false);

  useEffect(() => {
    if (!open) return;
    const base = fromRec(initial);
    if (!initial) {
      base.target_hire_date = plusDays(30);                         // inside the recommended 15–45 day window
      if (locked) { base.department = me.department || ''; base.hiring_manager_id = me.user_id; base.reports_to_user_id = me.user_id; }
      if ((options?.locations || []).length === 1) base.work_location = options.locations[0].name;
    }
    tierTouched.current = !!initial?.position_tier;
    autoTried.current = false;
    setF(base); setRec(initial || null); setDirty(false); setStep(0); setErrors([]); setMissing([]); setKw(null); setMore(false); setMore2(false);
  }, [open, initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); setMissing((m) => m.filter((x) => x !== k)); };
  const setMany = (o) => { setF((p) => ({ ...p, ...o })); setDirty(true); setMissing((m) => m.filter((x) => !(x in o))); };

  // the tier follows the designation until the user picks one themselves
  const onDesignation = (v) => {
    const t = tierTouched.current ? null : suggestTier(v, masters);
    setMany({ designation: v, ...(t ? { position_tier: t } : {}) });
  };

  useEffect(() => {
    if (!open || !f.department || locked) { setHms([]); return undefined; }
    let live = true;
    mrf('mrf_hiring_managers', { department: f.department }).then((d) => {
      if (!live) return;
      setHms(d.managers || []);
      // one obvious choice? take it: the department head
      if (!fRef.current.hiring_manager_id && d.department_head && (d.managers || []).some((m) => m.user_id === d.department_head)) setMany({ hiring_manager_id: d.department_head, reports_to_user_id: d.department_head });
    }).catch(() => {});
    return () => { live = false; };
  }, [open, f.department, locked]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (!open || !dirty || !(rec?.id || (f.department && f.designation))) return undefined;
    const t = setTimeout(() => { persist(); }, 2500);
    return () => clearTimeout(t);
  }, [open, dirty, f, rec?.id, persist]);

  useEffect(() => {
    if (!open || !dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [open, dirty]);

  // suggestions for the role, refreshed when the position changes
  const kwKey = [f.department, f.designation, f.position_tier, f.exp_min, f.exp_max, f.employment_type, f.work_location].join('~');
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
  const sel = (kind, key) => (
    <select className={selectCls} value={f[key] || ''} onChange={(e) => set(key, e.target.value)}>
      <option value="">Select…</option>
      {opt(kind).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const hint = useMemo(() => timelineHint(rec?.requisition_date || today(), f.target_hire_date), [rec?.requisition_date, f.target_hire_date]);
  const hmOptions = locked
    ? [{ value: me.user_id, label: `${me.name} (you)`, sub: me.designation }]
    : hms.map((m) => ({ value: m.user_id, label: m.name, sub: [m.designation, m.code].filter(Boolean).join(' · '), badge: m.is_head ? 'Dept head' : m.direct_reports > 0 ? 'Manager' : '' }));
  const empOptions = (options?.employees || []).map((e) => ({ value: e.user_id, label: e.name, sub: [e.designation, e.department].filter(Boolean).join(' · ') }));
  const bad = (k) => missing.includes(k);

  const close = () => {
    if (dirty && !window.confirm('You have unsaved changes. Close anyway? (A draft is saved automatically once the department and designation are filled.)')) return;
    onClose();
  };
  const saveDraft = async () => { const r = await persist(); if (r) { toast.success('Draft saved'); onSaved?.(r); } };
  const ensureSaved = async () => { if (!dirty && recRef.current?.id) return recRef.current.id; const r = await persist(); return r?.id || null; };

  const checkBasics = () => {
    const m = REQUIRED.filter(([k]) => !String(f[k] ?? '').trim()).map(([k]) => k);
    if (f.position_tier === 'other_custom' && !f.position_tier_custom.trim()) m.push('position_tier_custom');
    if (f.requisition_type === 'replacement') { if (!f.replaced_employee_name.trim()) m.push('replaced_employee_name'); if (!f.replacement_reason.trim()) m.push('replacement_reason'); }
    if (!(Number(f.number_of_positions) >= 1)) m.push('number_of_positions');
    if (!f.work_location.trim() && !f.work_city.trim() && !(f.is_remote && (f.remote_region || f.remote_region_detail))) m.push('work_location');
    setMissing(m);
    if (m.length) {
      const names = Object.fromEntries(REQUIRED); names.work_location = 'Work location'; names.number_of_positions = 'Vacancies'; names.replaced_employee_name = 'Employee being replaced'; names.replacement_reason = 'Reason for replacement'; names.position_tier_custom = 'Custom tier';
      toast.error(`Still needed: ${m.slice(0, 4).map((k) => names[k]).join(', ')}${m.length > 4 ? '…' : ''}`);
      setTimeout(() => document.querySelector('[data-bad="1"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return false;
    }
    return true;
  };
  const go = (to) => {
    if (to > 0 && step === 0 && !checkBasics()) return;
    setStep(to);
  };

  // entering the JD step for the first time writes the draft automatically
  useEffect(() => {
    if (!open || step !== 2 || autoTried.current) return;
    autoTried.current = true;
    if (recRef.current?.jd_current_text) return;
    (async () => {
      setAutoGen(true);
      try {
        const id = await ensureSaved(); if (!id) return;
        const d = await mrf('mrf_jd_generate', { id, action: 'generate' });
        setRec(d.requisition);
      } catch (e) { toast.error(e.message); }
      setAutoGen(false);
    })();
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!checkBasics()) { setStep(0); return; }
    setSubmitting(true); setErrors([]);
    try {
      const saved = await persist(); if (!saved) { setSubmitting(false); return; }
      const d = await mrf('mrf_submit', { id: saved.id });
      toast.success(d.requisition.hiring_manager_id === me.user_id ? 'Submitted — now review and approve the JD as Hiring Manager' : 'Submitted to the Hiring Manager for JD approval');
      onSaved?.(d.requisition); setDirty(false); onClose();
    } catch (e) { setErrors(e.errors?.length ? e.errors : [e.message]); }
    setSubmitting(false);
  };

  const addTo = (key, items) => set(key, [...new Set([...(f[key] || []), ...items])]);
  const useAll = () => {
    if (!kw) return;
    setMany({
      required_skills: [...new Set([...(f.required_skills || []), ...(kw.skills || []).slice(0, 8)])],
      technical_skills: [...new Set([...(f.technical_skills || []), ...(kw.technical || []).slice(0, 5)])],
      key_responsibilities: [...new Set([...(f.key_responsibilities || []), ...(kw.responsibilities || []).slice(0, 6)])],
      qualification: f.qualification.length ? f.qualification : (kw.qualifications || []).slice(0, 2),
    });
    toast.success('Suggestions added — remove anything that does not fit');
  };
  const Suggest = ({ items, target, label }) => {
    const left = (items || []).filter((s) => !(f[target] || []).some((x) => x.toLowerCase() === s.toLowerCase()));
    if (!left.length) return null;
    return (
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-1"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><button type="button" className="text-[11px] text-primary underline" onClick={() => addTo(target, left)}>add all</button></div>
        <div className="flex flex-wrap gap-1.5">{left.map((s) => <button key={s} type="button" onClick={() => addTo(target, [s])} className="rounded-full border border-dashed border-primary/50 text-primary text-xs px-2 py-0.5 hover:bg-primary/10">+ {s}</button>)}</div>
      </div>
    );
  };

  const perms = { can_generate: true, can_edit: !!rec && rec.hiring_manager_id === me.user_id };
  const inputP = (k, extra = {}) => ({ value: f[k] ?? '', onChange: (e) => set(k, e.target.value), ...extra });
  const wrap = (k, node) => <div data-bad={bad(k) ? '1' : undefined}>{node}</div>;
  const Toggle = ({ open: o, onClick, children }) => (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-sm text-primary hover:underline">{<ChevronDown className={`w-4 h-4 transition-transform ${o ? 'rotate-180' : ''}`} />}{children}</button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-4xl w-[96vw] max-h-[94vh] overflow-y-auto" onInteractOutside={(e) => { if (dirty) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            New Manpower Requisition {rec?.requisition_id && <span className="font-mono text-sm text-muted-foreground">{rec.requisition_id}</span>}
            <span className="ml-auto text-xs font-normal text-muted-foreground flex items-center gap-1">{saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : dirty ? 'Unsaved changes' : rec ? <><Check className="w-3 h-3 text-green-600" /> Draft saved</> : ''}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1.5 border-b pb-3">
          {STEPS.map((s, i) => <button key={s} type="button" onClick={() => go(i)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${i === step ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}>{s}</button>)}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Fill these few fields — everything else is optional and the Job Description is written for you.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {wrap('requisition_type', <Field label="What kind of requisition?" required error={bad('requisition_type')}>{sel('requisition_type', 'requisition_type')}</Field>)}
              {wrap('department', <Field label="Department" required error={bad('department')} hint={locked ? 'From your profile.' : undefined}>
                <SearchSelect value={f.department} disabled={locked} options={(options?.departments || []).map((d) => ({ value: d.name, label: d.name }))} onChange={(v) => setMany({ department: v, hiring_manager_id: locked ? f.hiring_manager_id : '', reports_to_user_id: locked ? f.reports_to_user_id : '' })} placeholder="Select department" /></Field>)}
              {wrap('designation', <Field label="Designation" required error={bad('designation')} hint="Pick from the list or type your own.">
                <SearchSelect value={f.designation} allowCustom options={(options?.designations || []).map((d) => ({ value: d, label: d }))} onChange={onDesignation} placeholder="e.g., Software Developer" /></Field>)}
              {wrap('position_tier', <Field label="Level / position tier" required error={bad('position_tier')} hint={f.position_tier && !tierTouched.current ? 'Suggested from the designation — change it if needed.' : undefined}>
                <SearchSelect value={f.position_tier} options={opt('position_tier')} onChange={(v) => { tierTouched.current = true; set('position_tier', v); }} placeholder="Select level" /></Field>)}
              {f.position_tier === 'other_custom' && wrap('position_tier_custom', <Field label="Your level / designation name" required error={bad('position_tier_custom')}><Input {...inputP('position_tier_custom')} /></Field>)}
              {wrap('number_of_positions', <Field label="Vacancies" required error={bad('number_of_positions')}><Input type="number" min={1} {...inputP('number_of_positions')} className="max-w-[120px]" /></Field>)}
              {wrap('hiring_manager_id', <Field label="Hiring Manager" required error={bad('hiring_manager_id')} hint={locked ? 'You — you will approve the Job Description.' : 'Reviews and approves the Job Description. Department head and managers are listed first.'}>
                <SearchSelect value={f.hiring_manager_id} disabled={locked || !f.department} options={hmOptions} placeholder={f.department ? 'Select Hiring Manager' : 'Choose a department first'} onChange={(v) => setMany({ hiring_manager_id: v, reports_to_user_id: !f.reports_to_user_id || f.reports_to_user_id === f.hiring_manager_id ? v : f.reports_to_user_id })} /></Field>)}
              {wrap('employment_type', <Field label="Employment type" required error={bad('employment_type')}>{sel('employment_type', 'employment_type')}</Field>)}
              {wrap('priority', <Field label="Priority" required error={bad('priority')}>{sel('priority', 'priority')}</Field>)}
              <Field label="Experience needed" hint="Optional.">
                <div className="flex items-center gap-2">
                  <select className={selectCls} value={f.exp_min} onChange={(e) => setMany({ exp_min: e.target.value, ...(f.exp_mode === 'single' ? { exp_max: e.target.value } : {}) })}><option value="">From…</option>{opt('experience_range').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  <span className="text-xs text-muted-foreground">to</span>
                  <select className={selectCls} value={f.exp_max} onChange={(e) => set('exp_max', e.target.value)}><option value="">To…</option>{opt('experience_range').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </div>
              </Field>
              {wrap('work_arrangement', <Field label="Work arrangement" required error={bad('work_arrangement')}>
                <select className={selectCls} value={f.work_arrangement} onChange={(e) => setMany({ work_arrangement: e.target.value, is_remote: e.target.value === 'remote' })}><option value="">Select…</option>{opt('work_arrangement').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>)}
              {wrap('work_location', <Field label="Work location" required error={bad('work_location')} hint="Pick an office or type any city, dealer location or project site.">
                <SearchSelect value={f.work_location} allowCustom options={(options?.locations || []).map((l) => ({ value: l.name, label: l.name, sub: [l.city, l.state].filter(Boolean).join(', ') }))}
                  onChange={(v) => { const l = (options?.locations || []).find((x) => x.name === v); setMany({ work_location: v, ...(l?.city ? { work_city: l.city } : {}), ...(l?.state ? { work_state: l.state } : {}) }); }} placeholder="Search or type a location" /></Field>)}
              <Field label="Target hiring date" hint="">
                <Input type="date" {...inputP('target_hire_date')} className="max-w-[200px]" />
                <p className={`text-xs mt-1.5 ${hint.state === 'aggressive' ? 'text-amber-700' : hint.state === 'extended' ? 'text-blue-700' : hint.state === 'ideal' ? 'text-green-700' : 'text-muted-foreground'}`}>{hint.state === 'aggressive' && <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}{hint.message}</p>
              </Field>
              <Field label="CTC range (₹, optional)">
                <div className="flex items-center gap-2"><Input type="number" min={0} placeholder="Min" {...inputP('ctc_min')} /><span className="text-xs text-muted-foreground">to</span><Input type="number" min={0} placeholder="Max" {...inputP('ctc_max')} />
                  <select className={selectCls + ' max-w-[110px]'} value={f.ctc_frequency} onChange={(e) => set('ctc_frequency', e.target.value)}>{opt('ctc_frequency').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <label className="flex items-center gap-2 text-xs mt-1.5"><input type="checkbox" checked={f.disclose_ctc} onChange={(e) => set('disclose_ctc', e.target.checked)} />Show this range in the Job Description / on job portals</label>
              </Field>
            </div>

            {f.requisition_type === 'replacement' && (
              <div className="rounded-lg border bg-muted/30 p-3 grid sm:grid-cols-2 gap-3">
                <p className="sm:col-span-2 text-sm font-medium">Who is being replaced?</p>
                {wrap('replaced_employee_name', <Field label="Employee" required error={bad('replaced_employee_name')}>
                  <SearchSelect value={f.replaced_employee_user_id || f.replaced_employee_name} allowCustom options={empOptions}
                    onChange={(v) => { const e = (options?.employees || []).find((x) => x.user_id === v); setMany(e ? { replaced_employee_user_id: v, replaced_employee_name: e.name, replaced_employee_code: e.code || '' } : { replaced_employee_user_id: '', replaced_employee_name: v }); }} placeholder="Search employee or type a name" /></Field>)}
                {wrap('replacement_reason', <Field label="Reason" required error={bad('replacement_reason')}><Input {...inputP('replacement_reason')} placeholder="e.g., Resigned" /></Field>)}
                <Field label="Expected relieving date"><Input type="date" {...inputP('expected_relieving_date')} className="max-w-[200px]" /></Field>
              </div>
            )}

            <Toggle open={more} onClick={() => setMore((v) => !v)}>More options (all optional)</Toggle>
            {more && (
              <div className="grid sm:grid-cols-2 gap-4 rounded-lg border p-3">
                <Field label="New joiner reports to" hint="Defaults to the Hiring Manager."><SearchSelect value={f.reports_to_user_id} options={empOptions} onChange={(v) => set('reports_to_user_id', v)} placeholder="Select" /></Field>
                <Field label="Reason for hiring">{sel('hiring_reason', 'hiring_reason')}</Field>
                <Field label="City"><Input {...inputP('work_city')} /></Field><Field label="State"><Input {...inputP('work_state')} /></Field>
                {(f.is_remote || f.work_arrangement === 'remote') && <><Field label="Remote — eligible region">{sel('remote_region', 'remote_region')}</Field><Field label="Region details"><Input {...inputP('remote_region_detail')} /></Field></>}
                <Field label="Budget approved?"><select className={selectCls} value={f.budget_approved ? 'yes' : 'no'} onChange={(e) => set('budget_approved', e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes</option></select></Field>
                <Field label="Budget reference"><Input {...inputP('budget_reference')} /></Field>
                <Field label="Expected joining timeline"><Input {...inputP('expected_joining_timeline')} placeholder="e.g., Within 30 days of offer" /></Field>
                {(hint.state === 'aggressive' || hint.state === 'extended') && <Field label="Why this timeline?"><Input {...inputP('timeline_justification')} /></Field>}
                <Field label="Gender preference" hint="Only where permitted by policy and law."><Input {...inputP('gender_preference')} /></Field>
                <Field label="Age criteria" hint="Only where permitted by policy and law."><Input {...inputP('age_criteria')} /></Field>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-amber-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium flex items-center gap-1.5"><Lightbulb className="w-4 h-4 text-amber-600" /> Suggestions for {f.designation || 'this role'} {kwBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}</p>
                {kw && <Button size="sm" className="ml-auto" onClick={useAll}><Sparkles className="w-4 h-4 mr-1.5" />Use all suggestions</Button>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Click a suggestion to add it, or use them all and remove what does not fit. You can skip this step — the Job Description will still be complete.</p>
              <Suggest items={kw?.skills} target="required_skills" label="Skills" />
              <Suggest items={kw?.responsibilities} target="key_responsibilities" label="Responsibilities" />
              <Suggest items={kw?.qualifications} target="qualification" label="Qualifications" />
              <Suggest items={kw?.technical} target="technical_skills" label="Technical / functional" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Required skills" className="sm:col-span-2"><TagInput value={f.required_skills} onChange={(v) => set('required_skills', v)} placeholder="Type a skill and press Enter" /></Field>
              <Field label="Key responsibilities" className="sm:col-span-2"><TagInput value={f.key_responsibilities} onChange={(v) => set('key_responsibilities', v)} placeholder="Type a responsibility and press Enter" /></Field>
              <Field label="Education / qualification"><TagInput value={f.qualification} onChange={(v) => set('qualification', v)} suggestions={opt('qualification').map((o) => o.label)} placeholder="Add qualification" /></Field>
              <Field label="Anything else to tell candidates? (optional)"><textarea className="w-full rounded-md border border-input bg-background p-2 text-sm min-h-[70px]" {...inputP('additional_notes')} /></Field>
              <Field label="Short note on the role (optional)" hint="Leave blank — the Job Description’s “About the role” is written for you." className="sm:col-span-2"><textarea className="w-full rounded-md border border-input bg-background p-2 text-sm min-h-[70px]" {...inputP('position_overview')} /></Field>
            </div>
            <Toggle open={more2} onClick={() => setMore2((v) => !v)}>More role details (optional)</Toggle>
            {more2 && (
              <div className="grid sm:grid-cols-2 gap-4 rounded-lg border p-3">
                <Field label="Technical skills"><TagInput value={f.technical_skills} onChange={(v) => set('technical_skills', v)} placeholder="Add" /></Field>
                <Field label="Preferred skills"><TagInput value={f.preferred_skills} onChange={(v) => set('preferred_skills', v)} placeholder="Add" /></Field>
                <Field label="Key deliverables"><TagInput value={f.key_deliverables} onChange={(v) => set('key_deliverables', v)} placeholder="Add" /></Field>
                <Field label="Industry experience"><TagInput value={f.industry_experience} onChange={(v) => set('industry_experience', v)} placeholder="e.g., EV, Solar" /></Field>
                <Field label="Specialisation"><TagInput value={f.specialisation} onChange={(v) => set('specialisation', v)} placeholder="e.g., Electronics" /></Field>
                <Field label="Certifications"><TagInput value={f.certifications} onChange={(v) => set('certifications', v)} placeholder="e.g., PMP" /></Field>
                <Field label="Purpose of hiring"><Input {...inputP('purpose_of_hiring')} /></Field>
                <Field label="Experience expectations"><Input {...inputP('experience_expectations')} /></Field>
                <Field label="Department-specific requirements" className="sm:col-span-2"><Input {...inputP('department_requirements')} /></Field>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{autoGen ? 'Writing the Job Description from your details…' : rec?.hiring_manager_id === me.user_id ? 'Check the Job Description, edit it if you like, then submit. As Hiring Manager you will approve it next.' : 'This is the draft sent to the Hiring Manager, who reviews, edits and approves it.'}</p>
            {autoGen && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>}
            {!autoGen && <JdPanel rec={rec} ensureSaved={ensureSaved} perms={perms} onUpdated={(r) => setRec(r)} />}
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"><p className="font-medium">Please fix before submitting:</p><ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
          {step < 2 && <Button onClick={() => go(step + 1)}>{step === 0 ? 'Next' : 'Write the Job Description'}<ChevronRight className="w-4 h-4 ml-1" /></Button>}
          <Button variant="ghost" onClick={saveDraft} disabled={saving || !(f.department && f.designation)}><Save className="w-4 h-4 mr-1.5" />Save draft</Button>
          {step === 2 && <Button className="ml-auto" onClick={submit} disabled={submitting || saving || autoGen || !rec?.jd_current_text}>{submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}Submit for JD approval</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
