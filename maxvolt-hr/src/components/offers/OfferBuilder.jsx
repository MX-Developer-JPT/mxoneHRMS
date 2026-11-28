import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, Send, Eye, Save, FileDown, Download, Copy, CheckCircle2, Plus, X, History, Paperclip, ClipboardList } from 'lucide-react';
import { openPdfBlob } from '@/utils/letterhead';
import { safeDate } from '@/lib/dateUtils';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[\d\s-]{10,15}$/;
const NO_MANAGER = 'No reporting manager';
const SELECT = 'w-full h-9 border rounded-md px-2 text-sm bg-white disabled:bg-gray-100';
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const blank = () => ({
  full_name: '', email: '', phone: '', current_address: '', department: '', designation: '', employment_type: 'Permanent', location: '', reporting_manager_id: '',
  joining_date: '', issue_date: today(), probation_months: 6, notice_period_days: 30, offer_valid_days: 7, working_schedule: '', annual_ctc: '', medical_contribution: 0,
  variable_pay: '', benefits: '', other_terms: '', special_clauses: '', notes: '', signatory_id: '', recipient_email: '', attachments: [],
});
const blankComp = (o) => ({ basic: o?.basic ?? '', hra: o?.hra ?? '', conveyance: o?.conveyance ?? '', bonus: o?.bonus ?? '', pf: o?.pf !== false, gratuity: !!o?.gratuity, allowances: o?.allowances || [], deductions: o?.deductions || [] });
const ACTIONS = { direct_created: 'Direct offer created', edited: 'Offer details edited', generated: 'Letter generated', sent: 'Offer sent', send_failed: 'Sending failed', accepted: 'Accepted by the candidate', declined: 'Marked declined', onboarding_started: 'Onboarding started', onboarding_cancelled: 'Onboarding cancelled', joined: 'Joined', employee_linked: 'Linked to an employee profile' };
const call = async (name, args) => { const r = await base44.functions.invoke(name, args); return r?.data || r; };

const Section = ({ title, children }) => (
  <div className="border rounded-lg p-3 space-y-3"><p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</p>{children}</div>
);

// The one offer form, used for direct offers and for candidates from recruitment. The salary break-up is worked out by the
// server, and the letter is built by the same template for both.
export default function OfferBuilder({ candidateId = null, canOverride, onClose, onRefresh }) {
  const [id, setId] = useState(candidateId);
  const [candidate, setCandidate] = useState(null);
  const [source, setSource] = useState(candidateId ? '' : 'direct');
  const [requisition, setRequisition] = useState(null);
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(blank);
  const [comp, setComp] = useState(blankComp);
  const [manager, setManager] = useState('');
  const [salary, setSalary] = useState(null);
  const [calcError, setCalcError] = useState('');
  const [history, setHistory] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(null);
  const [problems, setProblems] = useState([]);
  const [loadError, setLoadError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setC = (k, v) => setComp((c) => ({ ...c, [k]: v }));
  const direct = source === 'direct';
  const verified = candidate?.doc_collection_status === 'verified';
  const managerLabel = (m) => `${m.name}${m.code ? ` (${m.code})` : ''}`;

  const loadTrail = (cid) => {
    if (!cid) return;
    call('of_history', { candidate_id: cid }).then((d) => setHistory(d.history || [])).catch(() => {});
    call('of_audit', { candidate_id: cid }).then((d) => setAudit(d.audit || [])).catch(() => {});
  };

  useEffect(() => {
    (async () => {
      try {
        const opts = await call('of_options', {});
        setOptions(opts);
        if (!candidateId) return;
        const d = await call('of_context', { candidate_id: candidateId });
        setCandidate(d.candidate); setSource(d.source); setRequisition(d.requisition);
        const next = { ...blank(), ...d.form };
        setForm(next); setComp(blankComp(d.form.salary_overrides));
        const m = opts.managers.find((x) => x.id === next.reporting_manager_id);
        setManager(next.reporting_manager_id === 'none' ? NO_MANAGER : m ? managerLabel(m) : '');
        loadTrail(candidateId);
      } catch (e) { setLoadError(e.message); }
    })();
  }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickManager = (text) => {
    setManager(text);
    const m = options?.managers.find((x) => managerLabel(x) === text);
    set('reporting_manager_id', text === NO_MANAGER ? 'none' : m?.id || '');
  };

  const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  const overrides = { basic: num(comp.basic), hra: num(comp.hra), conveyance: num(comp.conveyance), bonus: num(comp.bonus), pf: comp.pf, gratuity: comp.gratuity, allowances: comp.allowances, deductions: comp.deductions };
  const payload = (cid) => ({
    ...form, candidate_id: cid || undefined,
    annual_ctc: Number(form.annual_ctc) || 0, probation_months: Number(form.probation_months), notice_period_days: Number(form.notice_period_days),
    offer_valid_days: Number(form.offer_valid_days), medical_contribution: Number(form.medical_contribution) || 0, salary_overrides: overrides,
  });

  const calcKey = JSON.stringify([form.annual_ctc, form.medical_contribution, overrides]);
  useEffect(() => {
    if (!(Number(form.annual_ctc) > 0)) { setSalary(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      call('of_calculate', { annual_ctc: Number(form.annual_ctc), medical_contribution: Number(form.medical_contribution) || 0, salary_overrides: overrides })
        .then((d) => { if (live) { setSalary(d.salary); setCalcError(''); } })
        .catch((e) => { if (live) { setSalary(null); setCalcError(e.message); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [calcKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = [
    !form.full_name.trim() && 'full name', !EMAIL.test(form.email.trim()) && 'a valid personal email', !PHONE.test(String(form.phone).trim()) && 'a valid contact number',
    !form.department && 'department', !form.designation.trim() && 'designation', !form.location && 'office / location', !form.employment_type && 'employment type',
    !form.reporting_manager_id && 'reporting manager (pick from the list)', !form.joining_date && 'date of joining', !(Number(form.annual_ctc) > 0) && 'annual CTC',
  ].filter(Boolean);
  const badRecipient = !!form.recipient_email.trim() && !EMAIL.test(form.recipient_email.trim());
  const blocked = !options || missing.length > 0 || badRecipient || !salary || salary.problems.length > 0;
  const joined = candidate?.status === 'joined';

  // A new direct offer gets its record the first time it is saved, previewed or sent.
  const ensureRecord = async () => {
    if (id) return id;
    const d = await call('of_save', payload());
    if (d.existing) {
      toast.error(`${d.candidate.full_name} already has a record with this email. Open it from the list to make the offer there.`);
      onRefresh?.();
      return null;
    }
    setId(d.candidate.id); setCandidate(d.candidate); onRefresh?.();
    return d.candidate.id;
  };

  const run = async (what, fn) => {
    setBusy(what); setProblems([]);
    try { await fn(); }
    catch (e) { setProblems(e.data?.problems || []); toast.error(e.message); }
    setBusy('');
  };

  const save = () => run('save', async () => {
    let cid = id;
    if (!cid) { cid = await ensureRecord(); if (!cid) return; } else { const d = await call('of_save', payload(cid)); setCandidate(d.candidate); onRefresh?.(); }
    toast.success('Offer details saved'); loadTrail(cid);
  });

  const make = (record) => run(record ? 'generate' : 'preview', async () => {
    const cid = await ensureRecord(); if (!cid) return;
    const d = await call('previewOfferLetterPdf', { ...payload(cid), record });
    if (!d.success) { setProblems(d.problems || []); toast.error(d.error || 'Could not generate the letter'); return; }
    openPdfBlob(d.base64, d.filename, { download: record });
    if (record) { toast.success('Offer letter generated and saved to the history'); loadTrail(cid); onRefresh?.(); }
  });

  const send = () => {
    const to = form.recipient_email.trim() || form.email.trim();
    if (!window.confirm(`Send this offer letter to ${to}?`)) return;
    run('send', async () => {
      const cid = await ensureRecord(); if (!cid) return;
      const d = await call('sendOfferLetter', payload(cid));
      if (!d.success) { setProblems(d.problems || []); toast.error(d.error || 'Failed to send'); }
      else {
        if (d.email_error) toast.error(`The email could not be sent: ${d.email_error}`);
        else toast.success(`Offer letter sent to ${d.recipient_email || to}`);
        setSent(d); setCandidate((c) => ({ ...c, status: 'offered' })); onRefresh?.();
      }
      loadTrail(cid);
    });
  };

  const download = async (dispatchId) => {
    try { const d = await call('of_download', { id: dispatchId }); openPdfBlob(d.base64, d.filename, { download: true }); }
    catch (e) { toast.error(e.message); }
  };

  const attach = (files) => run('attach', async () => {
    const room = 5 - form.attachments.length;
    if (files.length > room) toast.error('At most 5 attachments');
    for (const file of Array.from(files).slice(0, room)) {
      if (file.size > 7 * 1024 * 1024) { toast.error(`${file.name} is larger than 7 MB`); continue; }
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm((f) => ({ ...f, attachments: [...f.attachments, { url: file_url, name: file.name }] }));
    }
  });

  const field = (label, key, type = 'text', extra = {}) => (
    <div><Label className="text-xs">{label}</Label><Input type={type} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} {...extra} /></div>
  );
  const choose = (label, key, list, empty = 'Select…') => (
    <div><Label className="text-xs">{label}</Label>
      <select className={SELECT} value={form[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">{empty}</option>
        {list.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
  const area = (label, key, rows = 3, hint = '') => (
    <div><Label className="text-xs">{label}</Label><Textarea rows={rows} placeholder={hint} value={form[key]} onChange={(e) => set(key, e.target.value)} /></div>
  );
  const list = (key, title) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><Label className="text-xs">{title}</Label>
        <button type="button" className="text-xs text-blue-600 flex items-center gap-1" onClick={() => setC(key, [...comp[key], { name: '', monthly: '' }])}><Plus className="w-3 h-3" />Add</button></div>
      {comp[key].map((x, i) => (
        <div key={i} className="flex gap-2">
          <Input className="h-8 text-xs" placeholder="Name" value={x.name} onChange={(e) => setC(key, comp[key].map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
          <Input className="h-8 text-xs w-32" type="number" min="0" placeholder="₹ / month" value={x.monthly} onChange={(e) => setC(key, comp[key].map((y, j) => (j === i ? { ...y, monthly: e.target.value } : y)))} />
          <button type="button" aria-label="Remove" onClick={() => setC(key, comp[key].filter((_, j) => j !== i))}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
      ))}
    </div>
  );
  const rows = (items) => items.map(([l, a, m]) => <tr key={l} className="border-b"><td className="px-3 py-1">{l}</td><td className="px-3 py-1 text-right">{fmt(a)}</td><td className="px-3 py-1 text-right">{fmt(m)}</td></tr>);
  const total = (label, a, m, cls) => <tr className={`font-semibold border-b ${cls}`}><td className="px-3 py-1.5">{label}</td><td className="px-3 py-1.5 text-right">{fmt(a)}</td><td className="px-3 py-1.5 text-right">{fmt(m)}</td></tr>;
  const spin = (what, Icon) => (busy === what ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />);

  if (loadError) return <p className="p-6 text-sm text-red-600">{loadError}</p>;
  if (!options || (candidateId && !candidate)) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-green-600" /></div>;

  const over = requisition?.ctc_max != null && Number(form.annual_ctc) > requisition.ctc_max;

  return (
    <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className={`px-2 py-0.5 rounded-full font-medium ${direct ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>{direct ? 'Direct offer' : source === 'mrf' ? `MRF ${requisition?.requisition_id || ''}` : 'Recruitment'}</span>
        <span className="text-gray-500">{direct ? 'Not linked to any requisition.' : 'Pre-filled from the recruitment record. Name and email are changed in Recruitment.'}</span>
      </div>
      {sent && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm space-y-1">
          <p className="flex items-center gap-2 text-green-800 font-medium"><CheckCircle2 className="w-4 h-4" />Offer {sent.offer_ref} {sent.email_error ? 'saved, but the email failed' : `sent to ${sent.recipient_email}`}</p>
          {sent.accept_link && <p className="flex items-center gap-2 text-xs"><code className="truncate text-blue-700">{sent.accept_link}</code><button type="button" aria-label="Copy link" onClick={() => { navigator.clipboard.writeText(sent.accept_link); toast.success('Copied'); }}><Copy className="w-3 h-3" /></button></p>}
        </div>
      )}
      {requisition && (
        <div className={`rounded-md border p-2.5 text-xs ${over ? 'border-red-300 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
          Hiring against <b>{requisition.requisition_id}</b>. {requisition.ctc_min != null || requisition.ctc_max != null ? <>Approved CTC range: <b>₹{fmt(requisition.ctc_min ?? 0)} – ₹{fmt(requisition.ctc_max ?? requisition.ctc_min)}</b> a year.</> : 'No CTC range was set on the requisition.'}
          {over && <b> This offer is above the approved range.</b>}
        </div>
      )}

      <Section title="A. Personal details">
        <div className="grid md:grid-cols-3 gap-3">
          {field('Candidate’s full name *', 'full_name', 'text', { disabled: !direct })}
          {field('Personal email address *', 'email', 'email', { disabled: !direct })}
          {field('Contact number *', 'phone', 'tel')}
          <div className="md:col-span-3">{area('Current address (printed on the letter when filled)', 'current_address', 2)}</div>
        </div>
      </Section>

      <Section title="B. Employment details">
        <div className="grid md:grid-cols-3 gap-3">
          {choose('Department *', 'department', options.departments)}
          <div><Label className="text-xs">Designation *</Label><Input list="offer-designations" placeholder="Type to search" value={form.designation} onChange={(e) => set('designation', e.target.value)} /><datalist id="offer-designations">{options.designations.map((d) => <option key={d} value={d} />)}</datalist></div>
          {choose('Employment type *', 'employment_type', options.employment_types)}
          {choose('Office / location *', 'location', options.offices)}
          <div><Label className="text-xs">Reporting manager *</Label><Input list="offer-managers" placeholder="Type a name or code" value={manager} onChange={(e) => pickManager(e.target.value)} />
            <datalist id="offer-managers"><option value={NO_MANAGER} />{options.managers.map((m) => <option key={m.id} value={managerLabel(m)}>{m.designation}</option>)}</datalist>
            {manager && !form.reporting_manager_id && <p className="text-xs text-amber-700 mt-0.5">Pick a name from the list.</p>}</div>
          {field('Date of joining *', 'joining_date', 'date')}
          {field('Offer issue date', 'issue_date', 'date')}
          {field('Offer valid for (days)', 'offer_valid_days', 'number', { min: 1, max: 180 })}
          {field('Probation period (months)', 'probation_months', 'number', { min: 0 })}
          {field('Notice period (days)', 'notice_period_days', 'number', { min: 0 })}
          <div className="md:col-span-2"><Label className="text-xs">Working days / work schedule</Label><Input list="offer-schedules" placeholder="e.g. Monday to Saturday, 9:00 – 18:00" value={form.working_schedule} onChange={(e) => set('working_schedule', e.target.value)} /><datalist id="offer-schedules">{options.schedules.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="md:col-span-3"><Label className="text-xs">Authorised signatory</Label>
            <select className={SELECT} value={form.signatory_id} onChange={(e) => set('signatory_id', e.target.value)}>
              <option value="">Default signatory</option>{options.signatories.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.designation}</option>)}
            </select>
            {!options.signatories.length && <p className="text-xs text-amber-700 mt-1">No signatory is set up yet. Add one under Letter Generator → Signatories.</p>}
          </div>
        </div>
      </Section>

      <Section title="C. Compensation">
        <div className="grid md:grid-cols-2 gap-3">
          {field('Annual CTC (₹) *', 'annual_ctc', 'number', { min: 0 })}
          <div><Label className="text-xs">Monthly gross salary (₹, worked out from the break-up)</Label><Input readOnly className="bg-gray-100" value={salary ? fmt(salary.gross_monthly) : ''} /></div>
        </div>
        <p className="text-xs text-gray-500">Salary components (monthly ₹; leave blank for the automatic value)</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[['Basic', 'basic', salary?.basic_monthly], ['HRA', 'hra', salary?.hra_monthly], ['Conveyance', 'conveyance', salary?.conveyance_monthly], ['Bonus / VPP', 'bonus', salary?.bonus_monthly]].map(([l, k, ph]) => (
            <div key={k}><Label className="text-xs">{l}</Label><Input type="number" min="0" className="h-8 text-xs" placeholder={ph != null ? String(ph) : ''} value={comp[k]} onChange={(e) => setC(k, e.target.value)} /></div>
          ))}
          <div><Label className="text-xs">Medical</Label><Input type="number" min="0" className="h-8 text-xs" value={form.medical_contribution} onChange={(e) => set('medical_contribution', e.target.value)} /></div>
        </div>
        <div className="flex gap-4 flex-wrap text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={comp.pf} onChange={(e) => setC('pf', e.target.checked)} />Provident fund applies</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={comp.gratuity} onChange={(e) => setC('gratuity', e.target.checked)} />Include gratuity (4.81% of Basic) in CTC</label>
        </div>
        <div className="grid md:grid-cols-2 gap-3">{list('allowances', 'Other allowances')}{list('deductions', 'Other deductions')}</div>
        {calcError && <p className="text-sm text-red-600">{calcError}</p>}
        {salary && (
          <div className="border rounded-lg overflow-x-auto">
            {salary.problems.length > 0 && <p className="bg-red-50 text-red-700 text-xs p-2">{salary.problems.join(' ')}</p>}
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-100"><th className="text-left px-3 py-1.5">Component</th><th className="text-right px-3 py-1.5">Annual (₹)</th><th className="text-right px-3 py-1.5">Monthly (₹)</th></tr></thead>
              <tbody>
                {rows(salary.rows.earnings)}{total('Gross salary (A)', salary.gross_annual, salary.gross_monthly, 'bg-blue-50')}
                {rows(salary.rows.deductions)}{total('Total deductions (B)', salary.deduction_annual, salary.deduction_monthly, '')}
                {total('Net salary (A − B)', salary.net_annual, salary.net_monthly, 'bg-green-50')}
                {rows(salary.rows.contributions)}{total('Employer contributions (C)', salary.contribution_annual, salary.contribution_monthly, '')}
                {total('CTC (A + C)', salary.gross_annual + salary.contribution_annual, salary.monthly_ctc, 'bg-orange-50')}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          {area('Variable pay or incentives', 'variable_pay', 2, 'e.g. Quarterly sales incentive as per policy')}
          {area('Other benefits and allowances (one per line)', 'benefits', 2)}
        </div>
      </Section>

      <Section title="D. Additional details">
        <div className="grid md:grid-cols-2 gap-3">
          {area('Specific terms and conditions (one per line)', 'other_terms')}
          {area('Special clauses (one per line)', 'special_clauses')}
          <div className="md:col-span-2">{area('Special instructions / note printed on the letter', 'notes', 2)}</div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Documents to attach to the email (up to 5, 7 MB together)</Label>
          {form.attachments.map((a, i) => (
            <div key={a.url} className="flex items-center gap-2 text-xs"><Paperclip className="w-3 h-3 text-gray-400" /><a href={a.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 truncate">{a.name}</a>
              <button type="button" aria-label="Remove attachment" onClick={() => set('attachments', form.attachments.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5 text-gray-400" /></button></div>
          ))}
          {form.attachments.length < 5 && <input type="file" multiple className="text-xs" disabled={busy === 'attach'} onChange={(e) => { if (e.target.files?.length) attach(e.target.files); e.target.value = ''; }} />}
          {busy === 'attach' && <Loader2 className="w-4 h-4 animate-spin text-green-600" />}
        </div>
      </Section>

      <Section title="Send">
        <div><Label className="text-xs">Recipient email address</Label>
          <Input type="email" placeholder={form.email || 'Candidate’s email'} value={form.recipient_email} onChange={(e) => set('recipient_email', e.target.value)} />
          <p className={`text-xs mt-0.5 ${badRecipient ? 'text-red-600' : 'text-gray-500'}`}>{badRecipient ? 'This is not a valid email address.' : 'Leave blank to send to the candidate’s email.'}</p></div>
        {!verified && (
          <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-xs text-amber-900 space-y-2">
            <p>The mandatory pre-offer documents are not verified. {canOverride ? 'To send anyway, give a reason; it is recorded with the offer.' : 'Only HR or admin can send before they are verified. You can still preview and generate the letter.'}</p>
            {canOverride && <Input placeholder="Reason for sending without verified documents (at least 10 characters)" value={form.override_reason || ''} onChange={(e) => set('override_reason', e.target.value)} />}
          </div>
        )}
      </Section>

      {joined && <p className="text-xs text-gray-500">This candidate has joined, so the offer can no longer be changed or sent.</p>}
      {missing.length > 0 && <p className="text-xs text-gray-500">Still needed: {missing.join(', ')}.</p>}
      {problems.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{problems.map((x) => <p key={x}>• {x}</p>)}</div>}

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={save} disabled={!!busy || joined || (!id && (!form.full_name.trim() || !EMAIL.test(form.email.trim()) || !PHONE.test(String(form.phone).trim())))} className="flex-1">{spin('save', Save)}Save</Button>
        <Button variant="outline" onClick={() => make(false)} disabled={!!busy || blocked} className="flex-1">{spin('preview', Eye)}Preview</Button>
        <Button variant="outline" onClick={() => make(true)} disabled={!!busy || blocked} className="flex-1">{spin('generate', FileDown)}Generate PDF</Button>
        <Button onClick={send} disabled={!!busy || blocked || joined || (!verified && (!canOverride || String(form.override_reason || '').trim().length < 10))} className="flex-1 bg-green-600 hover:bg-green-700">{spin('send', Send)}Send to candidate</Button>
      </div>

      <div className="border rounded-lg">
        <p className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 flex items-center gap-1.5"><History className="w-3.5 h-3.5" />Offer letter history</p>
        {history.length === 0 ? <p className="p-3 text-xs text-gray-400">Nothing generated or sent yet.</p> : history.map((h) => (
          <div key={h.id} className="px-3 py-2 border-t flex items-center gap-3 text-xs">
            <span className={`px-2 py-0.5 rounded-full capitalize ${h.status === 'sent' ? 'bg-green-100 text-green-700' : h.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{h.status}</span>
            <span className="flex-1 min-w-0">v{h.version} · {safeDate(h.created_at, 'dd MMM yyyy, h:mm a')} · ₹{fmt(h.annual_ctc)} · {h.by_name}{h.recipient_email ? ` · to ${h.recipient_email}` : ''}{h.error ? ` · ${h.error}` : ''}</span>
            {h.has_pdf && <button type="button" onClick={() => download(h.id)} className="text-blue-600 flex items-center gap-1"><Download className="w-3 h-3" />PDF</button>}
          </div>
        ))}
      </div>
      {audit.length > 0 && (
        <details className="border rounded-lg">
          <summary className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 cursor-pointer"><ClipboardList className="w-3.5 h-3.5 inline mr-1.5" />Audit trail ({audit.length})</summary>
          {audit.map((a) => (
            <p key={a.id} className="px-3 py-1.5 border-t text-xs text-gray-600"><b>{ACTIONS[a.action] || a.action}</b> · {a.by_name || '—'} · {safeDate(a.at, 'dd MMM yyyy, h:mm a')}
              {a.fields?.length ? ` · changed: ${a.fields.map((f) => f.replace(/_/g, ' ')).join(', ')}` : ''}{a.recipient_email ? ` · to ${a.recipient_email}` : ''}{a.employee_code ? ` · ${a.employee_code}` : ''}{a.override_reason ? ` · documents not verified: ${a.override_reason}` : ''}{a.reason ? ` · ${a.reason}` : ''}{a.error ? ` · ${a.error}` : ''}</p>
          ))}
        </details>
      )}
      <div className="text-right"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </div>
  );
}
