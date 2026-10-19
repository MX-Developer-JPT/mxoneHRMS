import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, Upload, CheckCircle2, FileText, Plus, Trash2, ArrowLeft, ArrowRight, AlertCircle, ExternalLink, ShieldCheck, Lock, Printer, ClipboardList } from 'lucide-react';
import { ob, BLOOD_GROUPS, RELATIONS, PAN_RE, IFSC_RE, digits, employmentLabel } from '@/lib/onboarding';

const STEPS = ['Your details', 'About you', 'Education', 'Experience', 'Documents', 'Review & submit'];
const MAX_MB = 40;
const INSURANCE_TYPES = ['Health Insurance', 'Life Insurance', 'Term Insurance', 'Group Mediclaim', 'Personal Accident', 'Other'];
const eduRow = (level = '') => ({ level, institution: '', board_university: '', year: '', percentage: '', certificate_url: '' });
const jobRow = () => ({ company: '', designation: '', from: '', to: '', location: '', last_salary: '', reason_for_leaving: '', experience_letter_url: '', relieving_letter_url: '', payslips_url: '' });
const policyRow = () => ({ insurance_type: '', insurer_name: '', policy_number: '', sum_insured: '', validity_date: '', nominee_name: '', nominee_relationship: '', nominee_date_of_birth: '', card_url: '' });
const fmt = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };

const initialForm = (emp, draft) => ({
  gender: emp.gender || '', blood_group: '', marital_status: '', current_address: '', permanent_same_as_current: true, permanent_address: '',
  aadhar_number: emp.aadhar_number || '', pan_number: '', uan_number: '', esi_number: '', pf_account_number: '',
  bank_account: { account_holder_name: emp.display_name || '', account_number: '', ifsc_code: '', bank_name: '', branch: '' },
  pf_nominee: { name: '', relationship: '', date_of_birth: '', share_percentage: 100 },
  education: [eduRow('10th'), eduRow('12th')], is_fresher: false, previous_employment: [],
  documents: {}, insurance_policies: [], correction_note: '', declaration: false, signature_name: '', _names: {},
  ...(draft || {}),
});

function Field({ label, req, hint, children, className = '' }) {
  return <div className={`space-y-1 ${className}`}><Label className="text-xs text-gray-600">{label}{req && <span className="text-red-500"> *</span>}</Label>{children}{hint && <div className="text-[11px] text-gray-400">{hint}</div>}</div>;
}
const Sel = ({ value, onChange, children }) => <select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={value} onChange={e => onChange(e.target.value)}>{children}</select>;
function Ro({ label, value }) { return <div className="text-sm"><div className="text-[11px] text-gray-500">{label}</div><div className="font-medium text-gray-900 break-words">{value || '—'}</div></div>; }

// Uploads a picked file right away (so a flaky connection or a closed tab never loses it) and reports the stored URL.
function useUploader() {
  const isNet = (e) => /failed to fetch|networkerror|load failed|network request failed|timed out|aborted|\(5\d\d\)|\(429\)/i.test(e?.message || '');
  return async (picked) => {
    if (picked.size > MAX_MB * 1024 * 1024) throw new Error(`"${picked.name}" is ${(picked.size / 1048576).toFixed(1)} MB — files must be under ${MAX_MB} MB.`);
    let file = picked;
    try { const buf = await picked.arrayBuffer(); file = new File([buf], picked.name, { type: picked.type || (/\.pdf$/i.test(picked.name) ? 'application/pdf' : ''), lastModified: picked.lastModified }); }
    catch { throw new Error(`Could not read "${picked.name}" — pick it again (save it to Downloads first if it came from a scanner or cloud app).`); }
    let last;
    for (let i = 0; i < 4; i++) {
      try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); return file_url; }
      catch (e) { last = e; if (!isNet(e) || i === 3) break; await new Promise(r => setTimeout(r, 1000 * 2 ** i)); }
    }
    throw last;
  };
}

function FileBox({ label, hint, required, accept = 'image/*,application/pdf', url, name, onPicked, uploader, compact }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { onPicked(await uploader(f), f.name); } catch (err) { toast.error(err.message, { duration: 8000 }); }
    setBusy(false);
  };
  return (
    <div className={`rounded-lg border p-3 ${url ? 'border-green-300 bg-green-50/50' : required ? 'border-dashed border-orange-300' : 'border-dashed'} ${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0"><div className="font-medium text-gray-900">{label}{required && <span className="text-red-500"> *</span>}</div>{hint && <div className="text-[11px] text-gray-500">{hint}</div>}</div>
        <div className="flex items-center gap-2 shrink-0">
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-blue-600" title="Open"><ExternalLink className="w-4 h-4" /></a>}
          <Button type="button" size="sm" variant={url ? 'outline' : 'default'} disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}{url ? 'Replace' : 'Upload'}</Button>
        </div>
      </div>
      {url && <div className="mt-1.5 flex items-center gap-1.5 text-green-700 text-[11px]"><CheckCircle2 className="w-3.5 h-3.5" /><span className="truncate">{name || 'Uploaded'}</span></div>}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={pick} />
    </div>
  );
}

export default function OnboardingPortal({ data }) {
  const emp = data.employee;
  const [form, setForm] = useState(() => initialForm(emp, data.draft));
  const startCp = data.checkpoint || { step: 0, completed: [], started: false };
  const [cp, setCp] = useState({ step: startCp.step || 0, completed: startCp.completed || [], started: !!startCp.started });
  const [step, setStepRaw] = useState(startCp.step || 0);
  const [welcomeBack] = useState(!!(startCp.started && (startCp.step > 0 || (startCp.completed || []).length)));
  const [showErr, setShowErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [done, setDone] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const uploader = useUploader();
  const dirty = useRef(false);

  const set = (k, v) => { dirty.current = true; setForm(f => ({ ...f, [k]: v })); };
  const setIn = (g, k, v) => { dirty.current = true; setForm(f => ({ ...f, [g]: { ...f[g], [k]: v } })); };
  const setRow = (g, i, patch) => { dirty.current = true; setForm(f => ({ ...f, [g]: f[g].map((r, n) => n === i ? { ...r, ...patch } : r) })); };
  const addRow = (g, row) => { dirty.current = true; setForm(f => ({ ...f, [g]: [...f[g], row] })); };
  const delRow = (g, i) => { dirty.current = true; setForm(f => ({ ...f, [g]: f[g].filter((_, n) => n !== i) })); };
  const setDoc = (key, url, name) => { dirty.current = true; setForm(f => ({ ...f, documents: { ...f.documents, [key]: url }, _names: { ...f._names, [url]: name } })); };
  const nameOf = (url) => form._names?.[url];
  const picked = (patchFn) => (url, name) => { dirty.current = true; setForm(f => ({ ...f, _names: { ...f._names, [url]: name } })); patchFn(url); };

  // autosave a draft shortly after any change
  const saveDraft = async (silent = true, nextCp = cp) => {
    try { const r = await ob('ob_saveDraft', { draft: form, checkpoint: nextCp }); setSavedAt(r.saved_at); dirty.current = false; if (!silent) toast.success('Progress saved — you can continue any time with the same login'); return true; }
    catch (e) { if (!silent) toast.error(e.message); return false; }
  };
  const setStep = (n) => { setStepRaw(n); window.scrollTo({ top: 0 }); };
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => saveDraft(true), 2500);
    return () => clearTimeout(t);
  });

  const needPan = !emp.pan_number, needBank = !emp.bank_account?.account_number, needEsi = emp.is_esi_applicable && !emp.esi_number;

  const problems = useMemo(() => {
    const p = [];
    const add = (msg, s) => p.push({ msg, step: s });
    if (!form.gender) add('Gender', 1);
    if (!form.blood_group) add('Blood group', 1);
    if ((form.current_address || '').trim().length < 8) add('Current address', 1);
    if (!form.permanent_same_as_current && (form.permanent_address || '').trim().length < 8) add('Permanent address', 1);
    if (digits(form.aadhar_number).length !== 12) add('Aadhaar number (12 digits)', 1);
    if (needPan && !PAN_RE.test((form.pan_number || '').toUpperCase())) add('PAN number', 1);
    if (form.uan_number && digits(form.uan_number).length !== 12) add('UAN must be 12 digits (or leave it empty)', 1);
    if (needEsi && !digits(form.esi_number)) add('ESI number', 1);
    if (needBank) {
      const b = form.bank_account;
      if (!/^\d{6,20}$/.test(digits(b.account_number))) add('Bank account number', 1);
      if (!IFSC_RE.test((b.ifsc_code || '').toUpperCase())) add('Bank IFSC code', 1);
      if (!(b.bank_name || '').trim()) add('Bank name', 1);
    }
    const edu = form.education.filter(r => r.level || r.institution);
    if (edu.length < 1) add('At least one education record', 2);
    edu.forEach((r, i) => { if (!r.level || !r.institution || !/^\d{4}$/.test(r.year || '')) add(`Education ${i + 1}: level, institution, passing year`, 2); if (!r.certificate_url) add(`Education ${i + 1}: certificate / marksheet`, 2); });
    if (!form.is_fresher) {
      const prev = form.previous_employment.filter(r => r.company);
      if (prev.length < 1) add('Previous employment (or tick "I am a fresher")', 3);
      prev.forEach((r, i) => { if (!r.designation || !r.from || !r.to) add(`Previous employment ${i + 1}: designation and dates`, 3); else if (r.to < r.from) add(`Previous employment ${i + 1}: end date before start date`, 3); });
    }
    for (const s of data.doc_slots) if (s.required && !form.documents[s.key]) add(s.label, 4);
    if (!form.declaration) add('Accept the declaration', 5);
    if ((form.signature_name || '').trim().length < 3) add('Type your name as signature', 5);
    return p;
  }, [form, needPan, needBank, needEsi, data.doc_slots]);

  const stepProblems = (n) => problems.filter(p => p.step === n);
  const reach = (cp.completed.length ? Math.max(...cp.completed) : -1) + 1;   // furthest step the person may open

  const begin = async () => {
    const next = { ...cp, started: true };
    setCp(next); setSaving(true); await saveDraft(false, next); setSaving(false);
  };
  // every step is a checkpoint: it is validated, marked done and saved before the next one opens
  const goNext = async () => {
    if (step >= 1 && stepProblems(step).length) { setShowErr(true); toast.error('Please complete the items listed below to continue'); return; }
    const completed = [...new Set([...cp.completed, step])].sort((a, b) => a - b);
    const next = { started: true, step: step + 1, completed };
    setSaving(true); setCp(next);
    const ok = await saveDraft(true, next);
    setSaving(false);
    if (!ok) toast.warning('Could not save just now — your answers are still on this screen. Keep going, we will retry.');
    setShowErr(false); setStep(step + 1);
  };
  const goTo = (n) => { if (n > reach && n !== step) { toast.info('Finish the earlier steps first — each one is saved as you go'); return; } setShowErr(false); setStep(n); const next = { ...cp, step: n }; setCp(next); saveDraft(true, next); };

  const submit = async () => {
    setBusy(true); setServerErrors([]);
    try {
      const r = await ob('ob_submit', { form });
      base44.auth.setToken(r.access_token);
      setDone(true);
      setTimeout(() => window.location.replace('/'), 2500);
    } catch (e) { setServerErrors(e.errors || [e.message]); toast.error(e.message); }
    setBusy(false);
  };

  if (done || data.submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-white p-4">
        <Card className="max-w-md w-full"><CardContent className="p-8 text-center space-y-3">
          <CheckCircle2 className="w-14 h-14 text-green-600 mx-auto" />
          <h1 className="text-xl font-bold">You&apos;re all set, {emp.first_name || emp.display_name}!</h1>
          <p className="text-sm text-gray-600">Your onboarding has been submitted and your Maxvolt One account is now active. HR will verify your documents — if anything needs to be re-uploaded you will be notified.</p>
          <Button onClick={() => window.location.replace('/')}>Open Maxvolt One</Button>
        </CardContent></Card>
      </div>
    );
  }

  if (!cp.started) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-slate-100 p-4 md:p-8">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="text-center space-y-1 pt-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center"><ClipboardList className="w-6 h-6 text-orange-600" /></div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome, {emp.first_name || emp.display_name}</h1>
            <p className="text-sm text-gray-600">Before you begin, keep these documents and details ready. It takes about 15–20 minutes.</p>
          </div>
          <Card><CardContent className="p-5 space-y-4">
            {(data.checklist || []).map(g => (
              <div key={g.group}>
                <div className="flex items-center gap-2 mb-1"><h2 className="text-sm font-semibold text-gray-900">{g.group}</h2><span className={`text-[10px] px-1.5 py-0.5 rounded ${g.required ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{g.required ? 'Required' : 'If applicable'}</span></div>
                <ul className="space-y-1">{g.items.map(i => <li key={i} className="flex items-start gap-2 text-sm text-gray-700"><span className="mt-1 w-3.5 h-3.5 rounded border border-gray-300 shrink-0" />{i}</li>)}</ul>
              </div>
            ))}
          </CardContent></Card>
          <Card><CardContent className="p-4 text-sm text-gray-600 space-y-1.5">
            <div className="font-semibold text-gray-900">How this works</div>
            <div>• There are 6 short steps. <b>Each step is saved</b> when you press Next — you can stop at any time and continue later from the same step, using the same login.</div>
            <div>• Files can be photos or PDFs, up to {MAX_MB} MB each, and upload as soon as you pick them.</div>
            <div>• Your app opens as soon as you submit the last step. HR verifies your documents afterwards.</div>
          </CardContent></Card>
          <div className="flex flex-wrap justify-center gap-3 pb-8">
            <Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />Print this list</Button>
            <Button size="lg" onClick={begin} disabled={saving} className="gap-2">{saving && <Loader2 className="w-4 h-4 animate-spin" />}I have these ready — start<ArrowRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-orange-600" /><div><div className="font-semibold text-gray-900 leading-tight">Welcome, {emp.first_name || emp.display_name}</div><div className="text-[11px] text-gray-500">Complete your onboarding to open the app</div></div></div>
            <div className="text-[11px] text-gray-400 text-right">Step {step + 1} of {STEPS.length}<br />{saving ? 'Saving…' : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Progress is saved as you go'}</div>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
          <div className="flex gap-1 overflow-x-auto pb-1">
            {STEPS.map((name, i) => {
              const done = cp.completed.includes(i);
              const locked = i > reach && i !== step;
              return (
                <button key={name} onClick={() => goTo(i)} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap border flex items-center gap-1 ${i === step ? 'bg-orange-600 text-white border-orange-600' : done ? 'bg-green-50 text-green-700 border-green-200' : locked ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-600'}`}>
                  {done && i !== step ? <CheckCircle2 className="w-3 h-3" /> : locked ? <Lock className="w-3 h-3" /> : null}{i + 1}. {name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {welcomeBack && step === startCp.step && cp.completed.length > 0 && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Welcome back — everything you finished is saved. You are continuing from step {step + 1}: <b>{STEPS[step]}</b>.</div>}
        {data.rejection_reason && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">HR asked for a correction: {data.rejection_reason}</div>}

        {step === 0 && (
          <Card><CardContent className="p-5 space-y-5">
            <div><h2 className="font-semibold text-gray-900">Details entered by HR</h2><p className="text-xs text-gray-500">Please check these. If anything is wrong, tell HR in the box at the bottom — you do not need to change them yourself.</p></div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Ro label="Name" value={emp.display_name} /><Ro label="Employee code" value={emp.employee_code} />
              <Ro label="Date of birth" value={fmt(emp.date_of_birth)} /><Ro label="Father's name" value={emp.father_spouse_name} />
              <Ro label="Designation" value={emp.designation} /><Ro label="Department" value={emp.department} />
              <Ro label="Employment type" value={employmentLabel(emp.employment_type)} /><Ro label="Date of joining" value={fmt(emp.date_of_joining)} />
              <Ro label="Work location" value={emp.work_location} /><Ro label="Shift" value={emp.shift_name} />
              <Ro label="Reporting manager" value={emp.reporting_manager_name} /><Ro label="Personal email" value={emp.personal_email} />
              <Ro label="Official email" value={emp.official_email} /><Ro label="Personal mobile" value={emp.phone} />
              <Ro label="Official number" value={emp.official_phone} />
              <Ro label="Emergency contact" value={emp.emergency_contact?.name ? `${emp.emergency_contact.name} (${emp.emergency_contact.relationship}) · ${emp.emergency_contact.phone}` : ''} />
              <Ro label="PAN" value={emp.pan_number} /><Ro label="UAN" value={emp.uan_number} />
              {emp.is_esi_applicable && <Ro label="ESI number" value={emp.esi_number} />}
              <Ro label="Bank" value={emp.bank_account?.account_number ? `${emp.bank_account.bank_name} · ••••${String(emp.bank_account.account_number).slice(-4)} · ${emp.bank_account.ifsc_code}` : ''} />
            </div>
            <Field label="Something wrong or missing? (optional — sent to HR with your submission)"><Textarea rows={2} value={form.correction_note} onChange={e => set('correction_note', e.target.value)} placeholder="e.g. My date of birth is 12 April 2001" /></Field>
          </CardContent></Card>
        )}

        {step === 1 && (
          <Card><CardContent className="p-5 space-y-5">
            <h2 className="font-semibold text-gray-900">About you</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Gender" req><Sel value={form.gender} onChange={v => set('gender', v)}><option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option></Sel></Field>
              <Field label="Blood group" req><Sel value={form.blood_group} onChange={v => set('blood_group', v)}><option value="">Select…</option>{BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}</Sel></Field>
              <Field label="Marital status"><Sel value={form.marital_status} onChange={v => set('marital_status', v)}><option value="">Select…</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option></Sel></Field>
              <Field label="Aadhaar number" req><Input inputMode="numeric" value={form.aadhar_number} onChange={e => set('aadhar_number', e.target.value)} placeholder="12 digits" /></Field>
            </div>
            <div className="grid gap-3">
              <Field label="Current address" req><Textarea rows={2} value={form.current_address} onChange={e => set('current_address', e.target.value)} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.permanent_same_as_current} onChange={e => set('permanent_same_as_current', e.target.checked)} />Permanent address is the same</label>
              {!form.permanent_same_as_current && <Field label="Permanent address" req><Textarea rows={2} value={form.permanent_address} onChange={e => set('permanent_address', e.target.value)} /></Field>}
            </div>

            <div className="border-t pt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Statutory & bank</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {needPan ? <Field label="PAN number" req><Input value={form.pan_number} maxLength={10} onChange={e => set('pan_number', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></Field> : <Ro label="PAN (from HR)" value={emp.pan_number} />}
                {!emp.uan_number && <Field label="UAN" hint="Leave empty if you have never had a PF account"><Input inputMode="numeric" value={form.uan_number} onChange={e => set('uan_number', e.target.value)} placeholder="12 digits" /></Field>}
                {needEsi && <Field label="ESI number" req><Input value={form.esi_number} onChange={e => set('esi_number', e.target.value)} /></Field>}
                {!emp.pf_account_number && <Field label="PF account number" hint="If you already have one"><Input value={form.pf_account_number} onChange={e => set('pf_account_number', e.target.value)} /></Field>}
              </div>
              {needBank ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Account holder name" req><Input value={form.bank_account.account_holder_name} onChange={e => setIn('bank_account', 'account_holder_name', e.target.value)} /></Field>
                  <Field label="Account number" req><Input inputMode="numeric" value={form.bank_account.account_number} onChange={e => setIn('bank_account', 'account_number', e.target.value)} /></Field>
                  <Field label="IFSC code" req><Input maxLength={11} value={form.bank_account.ifsc_code} onChange={e => setIn('bank_account', 'ifsc_code', e.target.value.toUpperCase())} /></Field>
                  <Field label="Bank name" req><Input value={form.bank_account.bank_name} onChange={e => setIn('bank_account', 'bank_name', e.target.value)} /></Field>
                  <Field label="Branch"><Input value={form.bank_account.branch} onChange={e => setIn('bank_account', 'branch', e.target.value)} /></Field>
                </div>
              ) : <p className="text-xs text-gray-500">Your bank details were entered by HR (shown on the first step).</p>}
            </div>

            <div className="border-t pt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">PF nominee <span className="text-xs font-normal text-gray-500">(optional now)</span></h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Nominee name"><Input value={form.pf_nominee.name} onChange={e => setIn('pf_nominee', 'name', e.target.value)} /></Field>
                <Field label="Relationship"><Sel value={form.pf_nominee.relationship} onChange={v => setIn('pf_nominee', 'relationship', v)}><option value="">Select…</option>{RELATIONS.map(r => <option key={r}>{r}</option>)}</Sel></Field>
                <Field label="Nominee date of birth"><Input type="date" value={form.pf_nominee.date_of_birth} onChange={e => setIn('pf_nominee', 'date_of_birth', e.target.value)} /></Field>
                <Field label="Share %"><Input type="number" value={form.pf_nominee.share_percentage} onChange={e => setIn('pf_nominee', 'share_percentage', e.target.value)} /></Field>
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-800">Insurance policies you already hold <span className="text-xs font-normal text-gray-500">(optional)</span></h3><Button type="button" size="sm" variant="outline" onClick={() => addRow('insurance_policies', policyRow())}><Plus className="w-4 h-4 mr-1" />Add</Button></div>
              {form.insurance_policies.map((pol, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2 bg-gray-50">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Field label="Type"><Sel value={pol.insurance_type} onChange={v => setRow('insurance_policies', i, { insurance_type: v })}><option value="">Select…</option>{INSURANCE_TYPES.map(t => <option key={t}>{t}</option>)}</Sel></Field>
                    <Field label="Insurer"><Input value={pol.insurer_name} onChange={e => setRow('insurance_policies', i, { insurer_name: e.target.value })} /></Field>
                    <Field label="Policy number"><Input value={pol.policy_number} onChange={e => setRow('insurance_policies', i, { policy_number: e.target.value })} /></Field>
                    <Field label="Sum insured"><Input value={pol.sum_insured} onChange={e => setRow('insurance_policies', i, { sum_insured: e.target.value })} /></Field>
                    <Field label="Valid until"><Input type="date" value={pol.validity_date} onChange={e => setRow('insurance_policies', i, { validity_date: e.target.value })} /></Field>
                    <Field label="Nominee"><Input value={pol.nominee_name} onChange={e => setRow('insurance_policies', i, { nominee_name: e.target.value })} /></Field>
                  </div>
                  <FileBox compact label="Policy card / document" url={pol.card_url} name={nameOf(pol.card_url)} uploader={uploader} onPicked={picked(u => setRow('insurance_policies', i, { card_url: u }))} />
                  <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => delRow('insurance_policies', i)}><Trash2 className="w-4 h-4 mr-1" />Remove</Button>
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}

        {step === 2 && (
          <Card><CardContent className="p-5 space-y-4">
            <div><h2 className="font-semibold text-gray-900">Education</h2><p className="text-xs text-gray-500">Add your qualifications with the certificate or marksheet for each. Remove the rows that do not apply to you.</p></div>
            {form.education.map((r, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2 bg-gray-50">
                <div className="grid sm:grid-cols-2 gap-2">
                  <Field label="Level" req><Sel value={r.level} onChange={v => setRow('education', i, { level: v })}><option value="">Select…</option>{data.education_levels.map(l => <option key={l}>{l}</option>)}</Sel></Field>
                  <Field label="School / college / institute" req><Input value={r.institution} onChange={e => setRow('education', i, { institution: e.target.value })} /></Field>
                  <Field label="Board / university"><Input value={r.board_university} onChange={e => setRow('education', i, { board_university: e.target.value })} /></Field>
                  <div className="grid grid-cols-2 gap-2"><Field label="Passing year" req><Input inputMode="numeric" maxLength={4} value={r.year} onChange={e => setRow('education', i, { year: e.target.value })} /></Field><Field label="% / CGPA"><Input value={r.percentage} onChange={e => setRow('education', i, { percentage: e.target.value })} /></Field></div>
                </div>
                <FileBox compact required label="Certificate / marksheet" url={r.certificate_url} name={nameOf(r.certificate_url)} uploader={uploader} onPicked={picked(u => setRow('education', i, { certificate_url: u }))} />
                <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => delRow('education', i)}><Trash2 className="w-4 h-4 mr-1" />Remove</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => addRow('education', eduRow())}><Plus className="w-4 h-4 mr-1" />Add qualification</Button>
          </CardContent></Card>
        )}

        {step === 3 && (
          <Card><CardContent className="p-5 space-y-4">
            <div><h2 className="font-semibold text-gray-900">Previous employment</h2><p className="text-xs text-gray-500">Most recent first. Experience / relieving letters and payslips are optional but speed up verification.</p></div>
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.is_fresher} onChange={e => set('is_fresher', e.target.checked)} />I am a fresher — I have no previous employment</label>
            {!form.is_fresher && <>
              {form.previous_employment.map((r, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2 bg-gray-50">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Field label="Company" req><Input value={r.company} onChange={e => setRow('previous_employment', i, { company: e.target.value })} /></Field>
                    <Field label="Designation" req><Input value={r.designation} onChange={e => setRow('previous_employment', i, { designation: e.target.value })} /></Field>
                    <Field label="From" req><Input type="date" value={r.from} onChange={e => setRow('previous_employment', i, { from: e.target.value })} /></Field>
                    <Field label="To" req><Input type="date" value={r.to} onChange={e => setRow('previous_employment', i, { to: e.target.value })} /></Field>
                    <Field label="Location"><Input value={r.location} onChange={e => setRow('previous_employment', i, { location: e.target.value })} /></Field>
                    <Field label="Last drawn salary (monthly)"><Input value={r.last_salary} onChange={e => setRow('previous_employment', i, { last_salary: e.target.value })} /></Field>
                    <Field label="Reason for leaving" className="sm:col-span-2"><Input value={r.reason_for_leaving} onChange={e => setRow('previous_employment', i, { reason_for_leaving: e.target.value })} /></Field>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    <FileBox compact label="Experience letter" url={r.experience_letter_url} name={nameOf(r.experience_letter_url)} uploader={uploader} onPicked={picked(u => setRow('previous_employment', i, { experience_letter_url: u }))} />
                    <FileBox compact label="Relieving letter" url={r.relieving_letter_url} name={nameOf(r.relieving_letter_url)} uploader={uploader} onPicked={picked(u => setRow('previous_employment', i, { relieving_letter_url: u }))} />
                    <FileBox compact label="Last payslips" url={r.payslips_url} name={nameOf(r.payslips_url)} uploader={uploader} onPicked={picked(u => setRow('previous_employment', i, { payslips_url: u }))} />
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => delRow('previous_employment', i)}><Trash2 className="w-4 h-4 mr-1" />Remove</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addRow('previous_employment', jobRow())}><Plus className="w-4 h-4 mr-1" />Add employer</Button>
            </>}
          </CardContent></Card>
        )}

        {step === 4 && (
          <Card><CardContent className="p-5 space-y-3">
            <div><h2 className="font-semibold text-gray-900">Documents</h2><p className="text-xs text-gray-500">Clear photos or PDFs, each under {MAX_MB} MB. They upload as soon as you pick them.</p></div>
            {data.doc_slots.map(s => (
              <FileBox key={s.key} label={s.label} hint={s.note} required={s.required} accept={s.key === 'photo' ? 'image/*' : undefined} url={form.documents[s.key]} name={nameOf(form.documents[s.key])} uploader={uploader} onPicked={(u, n) => setDoc(s.key, u, n)} />
            ))}
          </CardContent></Card>
        )}

        {step === 5 && (
          <Card><CardContent className="p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Review &amp; submit</h2>
            {problems.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                <div className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />Still to complete ({problems.length})</div>
                {problems.map((p, i) => <button key={i} type="button" onClick={() => setStep(p.step)} className="block text-left text-xs text-amber-900 underline-offset-2 hover:underline">• {p.msg} <span className="text-amber-600">— step {p.step + 1}</span></button>)}
              </div>
            ) : <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Everything is filled in. Read the declaration and submit.</div>}
            <div className="rounded-lg border p-3 text-sm text-gray-700 space-y-2 bg-gray-50">
              <p>I declare that the information and documents I have provided are true and complete to the best of my knowledge. I understand that false information can lead to disciplinary action, including termination. I consent to Maxvolt Energy Industries Limited processing my personal data (including Aadhaar, PAN and bank details) for employment, payroll and statutory compliance.</p>
              <label className="flex items-start gap-2 font-medium"><input type="checkbox" className="mt-1" checked={form.declaration} onChange={e => set('declaration', e.target.checked)} />I agree to the declaration above</label>
            </div>
            <Field label="Type your full name as signature" req><Input value={form.signature_name} onChange={e => set('signature_name', e.target.value)} placeholder={emp.display_name} /></Field>
            {serverErrors.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-0.5">{serverErrors.map((e, i) => <div key={i}>• {e}</div>)}</div>}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" disabled={busy || problems.length > 0} onClick={submit} className="gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}Submit &amp; open the app</Button>
              <span className="text-xs text-gray-500">The app opens as soon as you submit. HR verifies your documents afterwards.</span>
            </div>
          </CardContent></Card>
        )}

        {showErr && step >= 1 && step <= 4 && stepProblems(step).length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-0.5">
            <div className="text-sm font-semibold text-amber-900">To continue, please complete:</div>
            {stepProblems(step).map((p, i) => <div key={i} className="text-xs text-amber-900">• {p.msg}</div>)}
          </div>
        )}

        <div className="flex items-center justify-between pb-10">
          <Button variant="outline" disabled={step === 0} onClick={() => goTo(step - 1)}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Button variant="ghost" size="sm" onClick={() => saveDraft(false)}>Save &amp; continue later</Button>
          {step < STEPS.length - 1 && <Button onClick={goNext} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}Save &amp; next<ArrowRight className="w-4 h-4 ml-1" /></Button>}
          {step === STEPS.length - 1 && <span className="w-20" />}
        </div>
      </div>
    </div>
  );
}
