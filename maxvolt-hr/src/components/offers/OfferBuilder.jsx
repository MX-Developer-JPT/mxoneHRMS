import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, Send, Eye, Save, Download, Copy, CheckCircle2, Plus, X, History } from 'lucide-react';
import { openPdfBlob } from '@/utils/letterhead';
import { safeDate } from '@/lib/dateUtils';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const EMPLOYMENT_TYPES = ['Full time', 'Probationary', 'Fixed term contract', 'Internship', 'Trainee', 'Consultant', 'Part time'];

// Everything an offer letter needs, with the salary break-up worked out by the server (of_calculate), so what HR sees is
// exactly what is printed and sent.
export default function OfferBuilder({ candidate, departments = [], canOverride, onClose, onRefresh }) {
  const last = candidate?.salary || {};
  const [form, setForm] = useState({
    joining_date: candidate?.joining_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    designation: candidate?.designation || candidate?.position_applied || '',
    department: candidate?.department || '',
    employment_type: candidate?.employment_type || 'Full time',
    location: candidate?.location || 'Ghaziabad, Uttar Pradesh',
    reporting_to: candidate?.reporting_to || '',
    annual_ctc: candidate?.offer_ctc_annual || candidate?.expected_ctc || '',
    probation_months: candidate?.probation_months ?? 6,
    notice_period_days: candidate?.notice_period_days || 30,
    offer_valid_days: 7,
    medical_contribution: last.medical_monthly || 0,
    benefits: '', other_terms: '', notes: '', signatory_id: '', override_reason: '',
  });
  const [comp, setComp] = useState({ basic: '', hra: '', conveyance: '', bonus: '', pf: true, gratuity: !!last.gratuity_monthly, allowances: last.allowances || [], deductions: last.other_deductions || [] });
  const [salary, setSalary] = useState(null);
  const [calcError, setCalcError] = useState('');
  const [signatories, setSignatories] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(null);
  const [mrf, setMrf] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setC = (k, v) => setComp((c) => ({ ...c, [k]: v }));
  const verified = candidate.doc_collection_status === 'verified';
  const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  const overrides = { basic: num(comp.basic), hra: num(comp.hra), conveyance: num(comp.conveyance), bonus: num(comp.bonus), pf: comp.pf, gratuity: comp.gratuity, allowances: comp.allowances, deductions: comp.deductions };
  const payload = () => ({
    ...form, candidate_id: candidate.id,
    annual_ctc: Number(form.annual_ctc), probation_months: Number(form.probation_months), notice_period_days: Number(form.notice_period_days),
    offer_valid_days: Number(form.offer_valid_days), medical_contribution: Number(form.medical_contribution) || 0, salary_overrides: overrides,
  });

  const loadHistory = () => base44.functions.invoke('of_history', { candidate_id: candidate.id }).then((r) => setHistory((r?.data || r).history || [])).catch(() => {});
  useEffect(() => {
    loadHistory();
    base44.functions.invoke('sg_list', {}).then((r) => setSignatories((r?.data || r).signatories || [])).catch(() => {});
    // the manpower requisition this candidate was hired against fills blanks and shows the approved CTC range
    const rid = candidate.requisition_id || candidate.job_id;
    if (rid) base44.entities.JobRequisition.get(rid).then((r) => {
      if (!r || r.mrf_version !== 2) return;
      setMrf(r);
      setForm((f) => ({ ...f, designation: f.designation || r.designation || '', department: f.department || r.department || '', location: candidate.location || r.work_location || r.location || f.location, reporting_to: f.reporting_to || r.reports_to_name || r.hiring_manager_name || '' }));
    }).catch(() => {});
  }, [candidate.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcKey = JSON.stringify([form.annual_ctc, form.medical_contribution, overrides]);
  useEffect(() => {
    if (!(Number(form.annual_ctc) > 0)) { setSalary(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      base44.functions.invoke('of_calculate', { annual_ctc: Number(form.annual_ctc), medical_contribution: Number(form.medical_contribution) || 0, salary_overrides: overrides })
        .then((r) => { if (live) { setSalary((r?.data || r).salary); setCalcError(''); } })
        .catch((e) => { if (live) { setSalary(null); setCalcError(e.message); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [calcKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = [!form.designation && 'designation', !form.department && 'department', !form.joining_date && 'date of joining', !(Number(form.annual_ctc) > 0) && 'annual CTC'].filter(Boolean);
  const blocked = missing.length > 0 || !salary || salary.problems.length > 0;

  const make = async (record) => {
    setBusy(record ? 'generate' : 'preview');
    try {
      const r = await base44.functions.invoke('previewOfferLetterPdf', { ...payload(), record });
      const d = r?.data || r;
      if (!d.success) toast.error(d.error || 'Could not generate the letter');
      else {
        openPdfBlob(d.base64, d.filename, { download: record });
        if (record) { toast.success('Offer letter generated and saved to the history'); loadHistory(); }
      }
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const send = async () => {
    if (!window.confirm(`Send this offer letter to ${candidate.email}?`)) return;
    setBusy('send');
    try {
      const r = await base44.functions.invoke('sendOfferLetter', payload());
      const d = r?.data || r;
      if (!d.success) toast.error(d.error || 'Failed to send');
      else {
        if (d.email_error) toast.error(`The email could not be sent: ${d.email_error}`);
        else toast.success(`Offer letter sent to ${candidate.email}`);
        setSent(d);
        onRefresh?.();
      }
      loadHistory();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const download = async (id) => {
    try {
      const r = await base44.functions.invoke('of_download', { id });
      const d = r?.data || r;
      openPdfBlob(d.base64, d.filename, { download: true });
    } catch (e) { toast.error(e.message); }
  };

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
  const field = (label, key, type = 'text', extra = {}) => (
    <div key={key}><Label className="text-xs">{label}</Label><Input type={type} value={form[key]} onChange={(e) => set(key, e.target.value)} {...extra} /></div>
  );
  const rows = (items) => items.map(([l, a, m]) => <tr key={l} className="border-b"><td className="px-3 py-1">{l}</td><td className="px-3 py-1 text-right">{fmt(a)}</td><td className="px-3 py-1 text-right">{fmt(m)}</td></tr>);
  const total = (label, a, m, cls) => <tr className={`font-semibold border-b ${cls}`}><td className="px-3 py-1.5">{label}</td><td className="px-3 py-1.5 text-right">{fmt(a)}</td><td className="px-3 py-1.5 text-right">{fmt(m)}</td></tr>;

  const lo = mrf?.ctc_min != null ? Number(mrf.ctc_min) * (mrf.ctc_frequency === 'monthly' ? 12 : 1) : null;
  const hi = mrf?.ctc_max != null ? Number(mrf.ctc_max) * (mrf.ctc_frequency === 'monthly' ? 12 : 1) : null;
  const over = hi != null && Number(form.annual_ctc) > hi;

  return (
    <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1">
      <p className="text-sm text-gray-500"><strong>{candidate.full_name}</strong> · {candidate.email}{candidate.phone ? ` · ${candidate.phone}` : ''}</p>
      {sent && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm space-y-1">
          <p className="flex items-center gap-2 text-green-800 font-medium"><CheckCircle2 className="w-4 h-4" />Offer {sent.offer_ref} {sent.email_error ? 'saved, but the email failed' : 'sent'}</p>
          {sent.accept_link && <p className="flex items-center gap-2 text-xs"><code className="truncate text-blue-700">{sent.accept_link}</code><button onClick={() => { navigator.clipboard.writeText(sent.accept_link); toast.success('Copied'); }}><Copy className="w-3 h-3" /></button></p>}
        </div>
      )}
      {mrf && (
        <div className={`rounded-md border p-2.5 text-xs ${over ? 'border-red-300 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
          Hiring against <b>{mrf.requisition_id}</b>. {lo != null || hi != null ? <>Approved CTC range: <b>₹{fmt(lo ?? 0)} – ₹{fmt(hi ?? lo)}</b> a year.</> : 'No CTC range was set on the requisition.'}
          {over && <b> This offer is above the approved range.</b>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {field('Designation *', 'designation')}
        <div><Label className="text-xs">Department *</Label><Input list="offer-departments" value={form.department} onChange={(e) => set('department', e.target.value)} /><datalist id="offer-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist></div>
        <div><Label className="text-xs">Employment type</Label><select className="w-full h-9 border rounded-md px-2 text-sm bg-white" value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}>{EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        {field('Work location', 'location')}
        {field('Date of joining *', 'joining_date', 'date')}
        {field('Reporting manager', 'reporting_to')}
        {field('Probation period (months)', 'probation_months', 'number', { min: 0 })}
        {field('Notice period (days)', 'notice_period_days', 'number', { min: 0 })}
        {field('Annual CTC (₹) *', 'annual_ctc', 'number', { min: 0 })}
        {field('Offer valid for (days)', 'offer_valid_days', 'number', { min: 1 })}
        <div className="md:col-span-2"><Label className="text-xs">Authorised signatory</Label>
          <select className="w-full h-9 border rounded-md px-2 text-sm bg-white" value={form.signatory_id} onChange={(e) => set('signatory_id', e.target.value)}>
            <option value="">Default signatory</option>{signatories.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.designation}</option>)}
          </select>
          {!signatories.length && <p className="text-xs text-amber-700 mt-1">No signatory is set up yet. Add one under Letter Generator → Signatories.</p>}
        </div>
      </div>

      <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
        <p className="text-xs font-semibold text-gray-600">Salary components (monthly ₹; leave blank for the automatic value)</p>
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
      </div>

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
        <div><Label className="text-xs">Benefits (one per line)</Label><Textarea rows={3} value={form.benefits} onChange={(e) => set('benefits', e.target.value)} /></div>
        <div><Label className="text-xs">Other terms and conditions (one per line)</Label><Textarea rows={3} value={form.other_terms} onChange={(e) => set('other_terms', e.target.value)} /></div>
        <div className="md:col-span-2"><Label className="text-xs">Additional note</Label><Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>

      {!verified && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-xs text-amber-900 space-y-2">
          <p>The candidate’s mandatory documents are not verified. {canOverride ? 'To send anyway, give a reason; it is recorded with the offer.' : 'Only HR or admin can send before they are verified. You can still preview and generate the letter.'}</p>
          {canOverride && <Input placeholder="Reason for sending without verified documents" value={form.override_reason} onChange={(e) => set('override_reason', e.target.value)} />}
        </div>
      )}
      {missing.length > 0 && <p className="text-xs text-gray-500">Still needed: {missing.join(', ')}.</p>}

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={() => make(false)} disabled={!!busy || blocked} className="flex-1">{busy === 'preview' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}Preview</Button>
        <Button variant="outline" onClick={() => make(true)} disabled={!!busy || blocked} className="flex-1">{busy === 'generate' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Generate PDF</Button>
        <Button onClick={send} disabled={!!busy || blocked || candidate.status === 'joined' || (!verified && (!canOverride || form.override_reason.trim().length < 10))} className="flex-1 bg-green-600 hover:bg-green-700">{busy === 'send' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Send to candidate</Button>
      </div>

      <div className="border rounded-lg">
        <p className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 flex items-center gap-1.5"><History className="w-3.5 h-3.5" />Offer letter history</p>
        {history.length === 0 ? <p className="p-3 text-xs text-gray-400">Nothing generated or sent yet.</p> : history.map((h) => (
          <div key={h.id} className="px-3 py-2 border-t flex items-center gap-3 text-xs">
            <span className={`px-2 py-0.5 rounded-full capitalize ${h.status === 'sent' ? 'bg-green-100 text-green-700' : h.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{h.status}</span>
            <span className="flex-1 min-w-0">v{h.version} · {safeDate(h.created_at, 'dd MMM yyyy, h:mm a')} · ₹{fmt(h.annual_ctc)} · {h.by_name}{h.recipient_email ? ` · to ${h.recipient_email}` : ''}{h.error ? ` · ${h.error}` : ''}</span>
            {h.has_pdf && <button onClick={() => download(h.id)} className="text-blue-600 flex items-center gap-1"><Download className="w-3 h-3" />PDF</button>}
          </div>
        ))}
      </div>
      <div className="text-right"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </div>
  );
}
