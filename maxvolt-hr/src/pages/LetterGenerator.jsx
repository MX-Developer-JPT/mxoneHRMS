import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileSignature, Search, Sparkles, Printer, Copy, RefreshCw, FileText, Save, CheckCircle2, Send, Users, ChevronDown, ChevronUp, History, ExternalLink, Link2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { openLetterheadPrintWindow } from '../utils/letterhead';
import MobileSelect from '@/components/MobileSelect';
import { safeDate } from '@/lib/dateUtils';

// Letter types and the extra fields each one needs
const LETTER_TYPES = [
  { key: 'appointment',     label: 'Appointment Letter',      fields: [{ k: 'joining_date', label: 'Joining Date', type: 'date' }] },
  { key: 'confirmation',    label: 'Confirmation Letter',     fields: [{ k: 'effective_date', label: 'Confirmation Effective Date', type: 'date' }] },
  { key: 'promotion',       label: 'Promotion Letter',        fields: [{ k: 'new_designation', label: 'New Designation' }, { k: 'effective_date', label: 'Effective Date', type: 'date' }] },
  { key: 'salary_revision', label: 'Salary Revision Letter',  fields: [{ k: 'revised_annual_ctc', label: 'Revised Annual CTC (₹)', type: 'number' }, { k: 'effective_date', label: 'Effective Date', type: 'date' }] },
  { key: 'experience',      label: 'Experience Certificate',  fields: [{ k: 'last_working_day', label: 'Last Working Day (if separated)', type: 'date' }] },
  { key: 'relieving',       label: 'Relieving Letter',        fields: [{ k: 'last_working_day', label: 'Last Working Day', type: 'date' }, { k: 'resignation_date', label: 'Resignation Date', type: 'date' }] },
  { key: 'address_proof',   label: 'Employment / Address Proof', fields: [{ k: 'addressed_to', label: 'Addressed To (e.g., Bank/Embassy)' }, { k: 'purpose', label: 'Purpose' }] },
  { key: 'warning',         label: 'Warning Letter',          fields: [{ k: 'subject', label: 'Subject' }, { k: 'details', label: 'Issue Details', type: 'textarea' }] },
];
const typeMeta = (k) => LETTER_TYPES.find(t => t.key === k);

function OfferLetterPanel() {
  const defaultJoining = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [candidates, setCandidates] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ annual_ctc: '', joining_date: defaultJoining, designation: '', department: '', location: 'Ghaziabad, Uttar Pradesh', probation_months: 6, offer_valid_days: 7 });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [acceptLink, setAcceptLink] = useState('');

  useEffect(() => {
    base44.entities.Candidate.filter({}).then(rows => {
      setCandidates(rows.filter(c => ['selected', 'interview_done', 'shortlisted'].includes(c.status) && c.email));
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return candidates.filter(c => !q || (c.full_name || '').toLowerCase().includes(q) || (c.position_applied || '').toLowerCase().includes(q));
  }, [candidates, search]);

  const handleSend = async () => {
    if (!selected) { toast.error('Select a candidate'); return; }
    if (!form.annual_ctc || !form.joining_date) { toast.error('CTC and Joining Date are required'); return; }
    setSending(true);
    try {
      const res = await base44.functions.invoke('sendOfferLetter', {
        candidate_id: selected.id,
        annual_ctc: Number(form.annual_ctc),
        joining_date: form.joining_date,
        designation: form.designation || selected.position_applied,
        department: form.department || selected.department,
        location: form.location,
        probation_months: Number(form.probation_months) || 6,
        offer_valid_days: Number(form.offer_valid_days) || 7,
      });
      if (res.data?.success) {
        setSent(true);
        setAcceptLink(res.data.accept_link || '');
        if (res.data.email_error) {
          toast.warning(`Saved but email failed: ${res.data.email_error}`);
        } else {
          toast.success(`Offer letter sent to ${selected.email}`);
        }
      } else {
        toast.error(res.data?.error || 'Failed to send');
      }
    } catch (e) { toast.error(e.message); }
    setSending(false);
  };

  if (sent) return (
    <Card>
      <CardContent className="p-6 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
        <p className="font-semibold text-gray-800">Offer letter sent to {selected?.email}</p>
        {acceptLink && (
          <div className="flex items-center gap-2 justify-center flex-wrap">
            <span className="text-xs text-gray-500 break-all">{acceptLink}</span>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(acceptLink); toast.success('Link copied'); }}>Copy Link</Button>
          </div>
        )}
        <Button size="sm" onClick={() => { setSent(false); setSelected(null); setAcceptLink(''); setForm({ annual_ctc: '', joining_date: defaultJoining, designation: '', department: '', location: 'Ghaziabad, Uttar Pradesh', probation_months: 6, offer_valid_days: 7 }); }}>New Offer</Button>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-orange-500" />
          <span className="font-semibold text-gray-800">Candidate Offer Letter</span>
        </div>
        {selected ? (
          <div className="flex items-center gap-3 border rounded-lg p-2.5 bg-orange-50">
            <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold">{(selected.full_name || '?')[0]}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selected.full_name}</p>
              <p className="text-xs text-gray-400 truncate">{selected.position_applied} · {selected.email}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Change</Button>
          </div>
        ) : (
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search candidate…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="max-h-44 overflow-y-auto border rounded-lg divide-y">
              {filtered.length === 0
                ? <p className="p-3 text-sm text-gray-400">No eligible candidates (must be selected/interviewed with email)</p>
                : filtered.map(c => (
                  <button key={c.id} onClick={() => { setSelected(c); setForm(f => ({ ...f, designation: c.position_applied || '', department: c.department || '' })); }} className="w-full flex items-center gap-3 p-2.5 hover:bg-orange-50 text-left">
                    <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{(c.full_name || '?')[0]}</div>
                    <div className="min-w-0"><p className="text-sm font-medium truncate">{c.full_name}</p><p className="text-xs text-gray-400 truncate">{c.position_applied} · {c.email}</p></div>
                  </button>
                ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Annual CTC (₹) *</Label><Input type="number" className="mt-1" placeholder="e.g. 500000" value={form.annual_ctc} onChange={e => setForm(f => ({ ...f, annual_ctc: e.target.value }))} /></div>
          <div><Label className="text-xs">Joining Date *</Label><Input type="date" className="mt-1" value={form.joining_date} onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))} /></div>
          <div><Label className="text-xs">Designation</Label><Input className="mt-1" placeholder="As per offer" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} /></div>
          <div><Label className="text-xs">Department</Label><Input className="mt-1" placeholder="Department" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
          <div><Label className="text-xs">Probation (months)</Label><Input type="number" className="mt-1" value={form.probation_months} onChange={e => setForm(f => ({ ...f, probation_months: e.target.value }))} /></div>
          <div><Label className="text-xs">Offer Valid (days)</Label><Input type="number" className="mt-1" value={form.offer_valid_days} onChange={e => setForm(f => ({ ...f, offer_valid_days: e.target.value }))} /></div>
        </div>
        <Button onClick={handleSend} disabled={sending || !selected} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
          {sending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <><Send className="w-4 h-4 mr-2" /> Send Offer Letter</>}
        </Button>
      </CardContent>
    </Card>
  );
}

const LETTER_TYPE_LABELS = LETTER_TYPES.reduce((acc, t) => ({ ...acc, [t.key]: t.label }), {});

function LetterHistoryPanel() {
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('listHrLetters', {
        ...(typeFilter ? { letter_type: typeFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      const d = res.data || res;
      setLetters(d.success ? d.letters : []);
    } catch (e) { toast.error('Failed to load letter history: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [typeFilter]);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-gray-800">Generated Letters Record</span>
            <span className="text-xs text-gray-400">({letters.length})</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input className="pl-8 h-8 text-sm w-48" placeholder="Search employee/ref…" value={search}
                onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
            </div>
            <select className="h-8 text-sm border rounded-md px-2 bg-white" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {LETTER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
        ) : letters.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No letters generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Letter Type</th>
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Linked PMS Review</th>
                  <th className="px-3 py-2 font-medium text-right">Document</th>
                </tr>
              </thead>
              <tbody>
                {letters.map(l => (
                  <tr key={l.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">{l.employee_name || l.user_id}</td>
                    <td className="px-3 py-2 text-gray-600">{LETTER_TYPE_LABELS[l.letter_type] || l.letter_type}</td>
                    <td className="px-3 py-2 text-gray-500">{l.ref || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{safeDate(l.created_at, 'dd MMM yyyy')}</td>
                    <td className="px-3 py-2">
                      {l.performance_review_id
                        ? <span className="inline-flex items-center gap-1 text-indigo-600"><Link2 className="w-3 h-3" /> Linked</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {l.document_url
                        ? <a href={l.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline"><ExternalLink className="w-3 h-3" /> View</a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

const CTC_FIELDS = [
  { k: 'basic', label: 'Basic Pay' },
  { k: 'hra', label: 'HRA' },
  { k: 'conveyance', label: 'Conveyance Allowance' },
  { k: 'special_allowance', label: 'Special Allowance' },
  { k: 'other_allowance', label: 'Other Allowance' },
];

function CTCBreakdownPanel({ value, onChange, employee }) {
  const [open, setOpen] = useState(false);

  const fmt = n => n ? '₹' + Number(n).toLocaleString('en-IN') : '';
  const computedGross = CTC_FIELDS.reduce((s, f) => s + (Number(value[f.k]) || 0), 0);
  const pf = value.basic ? Math.round(Number(value.basic) * 0.12) : 0;
  const net = computedGross ? computedGross - pf : 0;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 hover:bg-amber-100 text-sm font-medium text-amber-800">
        <span>CTC Breakdown (Optional Override)</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-white">
          <p className="text-xs text-gray-500">Leave blank to use salary structure on file. Fill to override for this letter.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">Annual CTC (₹)</Label>
              <Input type="number" className="mt-1 h-8 text-sm" placeholder="e.g. 600000"
                value={value.annual_ctc || ''} onChange={e => onChange({ ...value, annual_ctc: e.target.value })} />
            </div>
            {CTC_FIELDS.map(f => (
              <div key={f.k}>
                <Label className="text-xs">{f.label} / month</Label>
                <Input type="number" className="mt-1 h-8 text-sm" placeholder="monthly"
                  value={value[f.k] || ''} onChange={e => onChange({ ...value, [f.k]: e.target.value })} />
              </div>
            ))}
          </div>
          {computedGross > 0 && (
            <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 space-y-0.5">
              <div className="flex justify-between"><span>Gross Monthly</span><span className="font-medium">{fmt(computedGross)}</span></div>
              <div className="flex justify-between"><span>Less: PF (12%)</span><span>{fmt(pf)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-0.5 mt-0.5"><span>Net Take-Home</span><span>{fmt(net)}</span></div>
            </div>
          )}
          <Button type="button" size="sm" variant="ghost" className="text-xs text-red-500 h-7"
            onClick={() => onChange({})}>Clear overrides</Button>
        </div>
      )}
    </div>
  );
}

export default function LetterGenerator() {
  const urlParams = new URLSearchParams(window.location.search);
  const presetUserId = urlParams.get('user_id') || '';
  const presetLetterType = urlParams.get('letter_type') || '';
  const presetReviewId = urlParams.get('review_id') || '';

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [letterType, setLetterType] = useState(presetLetterType);
  const [extra, setExtra] = useState({});
  const [signatory, setSignatory] = useState('');
  const [customSignatoryName, setCustomSignatoryName] = useState('');
  const [cc, setCc] = useState('');
  const [ctcOverride, setCtcOverride] = useState({});
  const [generating, setGenerating] = useState(false);
  const [letter, setLetter] = useState('');
  const [isHtml, setIsHtml] = useState(false);
  const [ref, setRef] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [performanceReviewId] = useState(presetReviewId);
  const [activeTab, setActiveTab] = useState('generate');

  const stripHtml = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.innerText || tmp.textContent || '';
  };

  const enterEditMode = () => {
    const plain = isHtml ? stripHtml(letter) : letter;
    setEditText(plain);
    setEditMode(true);
  };

  const exitEditMode = () => {
    setLetter(editText);
    setIsHtml(false);
    setEditMode(false);
  };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [approveSending, setApproveSending] = useState(false);
  const [approveSent, setApproveSent] = useState(false);

  // HR/Manager employees for signatory selection
  const managers = useMemo(() =>
    employees.filter(e => ['hr', 'manager', 'admin', 'director', 'head'].some(k => (e.designation || '').toLowerCase().includes(k) || (e.department || '').toLowerCase().includes('hr'))).slice(0, 30),
    [employees]
  );

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    try {
      const emps = await base44.entities.Employee.list('-display_name', 1000);
      const filtered = emps.filter(e => e.user_id && e.display_name);
      setEmployees(filtered);
      // Deep-linked from a PMS review ("Generate Letter") — pre-select the employee.
      if (presetUserId) {
        const match = filtered.find(e => e.user_id === presetUserId);
        if (match) setSelectedEmp(match);
      }
    } catch (e) { toast.error('Failed to load employees'); }
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return employees
      .filter(e => !q || e.display_name?.toLowerCase().includes(q) || e.employee_code?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q))
      .slice(0, 40);
  }, [employees, search]);

  const meta = typeMeta(letterType);

  const generate = async () => {
    if (!selectedEmp || !letterType) { toast.error('Select an employee and a letter type'); return; }
    setGenerating(true);
    setLetter('');
    try {
      const res = await base44.functions.invoke('generateEmployeeLetter', {
        user_id: selectedEmp.user_id, letter_type: letterType,
        extra: {
          ...extra,
          signatory: signatory === '__custom' ? customSignatoryName : signatory,
          ...(Object.keys(ctcOverride).some(k => ctcOverride[k]) ? { ctc_override: ctcOverride } : {}),
        },
      });
      const d = res.data || res;
      if (d.success) {
        setLetter(d.letter);
        setIsHtml(!!d.isHtml);
        setRef(d.ref || '');
        setEditMode(false);
        setSaved(false);
        setApproveSent(false);
      } else toast.error(d.error || 'Generation failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setGenerating(false);
  };

  const printLetter = () => {
    if (!letter) return;
    const html = isHtml ? letter : `<div style="font-size:11px;line-height:1.8;color:#1a1a1a;white-space:pre-wrap;">${
      letter.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')
    }</div>`;
    openLetterheadPrintWindow(`${meta?.label || 'Letter'} - ${selectedEmp?.display_name || ''}`, html, '', false);
  };

  const copyLetter = () => { navigator.clipboard.writeText(letter); toast.success('Letter copied'); };

  const saveToDocuments = async () => {
    if (!letter || !selectedEmp) return;
    setSaving(true);
    try {
      await base44.functions.invoke('saveLetterAsDocument', {
        user_id: selectedEmp.user_id,
        letter_type: letterType,
        letter_content: letter,
        ref,
        employee_name: selectedEmp.display_name,
        ...(performanceReviewId ? { performance_review_id: performanceReviewId } : {}),
      });
      setSaved(true);
      toast.success('Letter saved to employee Documents');
    } catch (e) {
      toast.error('Failed to save: ' + e.message);
    }
    setSaving(false);
  };

  const approveAndSend = async () => {
    if (!letter || !selectedEmp) return;
    setApproveSending(true);
    try {
      const res = await base44.functions.invoke('approveAndSendLetter', {
        user_id: selectedEmp.user_id,
        letter_type: letterType,
        letter_content: letter,
        ref,
        employee_name: selectedEmp.display_name,
        ...(cc.trim() ? { cc: cc.trim() } : {}),
        ...(performanceReviewId ? { performance_review_id: performanceReviewId } : {}),
      });
      if (res.data?.success) {
        setApproveSent(true);
        setSaved(true);
        if (res.data.email_error) {
          toast.warning(`Saved to Documents, but email failed: ${res.data.email_error}`);
        } else {
          toast.success(`Letter approved, saved to Documents, and emailed to ${selectedEmp.display_name}`);
        }
      } else {
        toast.error(res.data?.error || 'Failed');
      }
    } catch (e) { toast.error(e.message); }
    setApproveSending(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-indigo-600" /> AI Letter Generator
        </h1>
        <p className="text-gray-500 text-sm mt-1">Draft HR letters in seconds — pre-filled from employee data, editable, and print-ready on company letterhead.</p>
      </div>

      {performanceReviewId && (
        <div className="flex items-center gap-2 text-sm bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg px-3 py-2">
          <Link2 className="w-4 h-4 flex-shrink-0" />
          This letter will be linked to the employee's PMS performance review it was generated from.
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border">
          <TabsTrigger value="generate">Generate Letter</TabsTrigger>
          <TabsTrigger value="history"><History className="w-3.5 h-3.5 mr-1" /> Letter History</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-4 space-y-6">
      <OfferLetterPanel />

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Config panel */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              {/* Employee picker */}
              <div>
                <Label>Employee</Label>
                {selectedEmp ? (
                  <div className="mt-1 flex items-center gap-3 border rounded-lg p-2.5 bg-gray-50">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                      {initials(selectedEmp.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{selectedEmp.display_name}</p>
                      <p className="text-xs text-gray-400 truncate">{selectedEmp.designation} · {selectedEmp.department}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedEmp(null)}>Change</Button>
                  </div>
                ) : (
                  <>
                    <div className="relative mt-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input className="pl-9" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                    <div className="mt-2 max-h-52 overflow-y-auto border rounded-lg divide-y">
                      {loading ? <p className="p-3 text-sm text-gray-400">Loading…</p>
                        : filtered.length === 0 ? <p className="p-3 text-sm text-gray-400">No employees found</p>
                        : filtered.map(e => (
                          <button key={e.user_id} onClick={() => setSelectedEmp(e)}
                            className="w-full flex items-center gap-3 p-2.5 hover:bg-indigo-50 text-left transition-colors">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {initials(e.display_name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{e.display_name}</p>
                              <p className="text-xs text-gray-400 truncate">{e.employee_code} · {e.department}</p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>

              {/* Letter type */}
              <div>
                <Label>Letter Type</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {LETTER_TYPES.map(t => (
                    <button key={t.key} onClick={() => { setLetterType(t.key); setExtra({}); setCtcOverride({}); }}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-left transition-all ${letterType === t.key ? 'bg-indigo-600 text-white border-transparent shadow' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" /> {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extra fields */}
              {meta?.fields?.length > 0 && (
                <div className="space-y-3 pt-1">
                  {meta.fields.map(f => (
                    <div key={f.k}>
                      <Label className="text-xs">{f.label}</Label>
                      {f.type === 'textarea' ? (
                        <Textarea rows={3} className="mt-1" value={extra[f.k] || ''} onChange={e => setExtra(p => ({ ...p, [f.k]: e.target.value }))} />
                      ) : (
                        <Input type={f.type || 'text'} className="mt-1" value={extra[f.k] || ''} onChange={e => setExtra(p => ({ ...p, [f.k]: e.target.value }))} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Signatory selector */}
              <div>
                <Label className="text-xs">Authorised Signatory</Label>
                <div className="mt-1">
                  <MobileSelect
                    label="Authorised Signatory"
                    placeholder="— Default (Authorised Signatory) —"
                    value={signatory}
                    onValueChange={setSignatory}
                    options={[
                      { value: '', label: '— Default (Authorised Signatory) —' },
                      ...managers.map(m => ({ value: m.display_name, label: `${m.display_name} · ${m.designation || m.department}` })),
                      { value: '__custom', label: 'Enter custom name…' },
                    ]}
                  />
                </div>
                {signatory === '__custom' && (
                  <Input
                    className="mt-1 text-sm"
                    placeholder="Full name of signatory"
                    value={customSignatoryName}
                    onChange={e => setCustomSignatoryName(e.target.value)}
                    autoFocus
                  />
                )}
              </div>

              {/* CTC Breakdown for relevant letter types */}
              {['appointment', 'promotion', 'salary_revision'].includes(letterType) && (
                <CTCBreakdownPanel value={ctcOverride} onChange={setCtcOverride} employee={selectedEmp} />
              )}

              {/* CC recipients */}
              <div>
                <Label className="text-xs">CC (comma-separated emails)</Label>
                <Input
                  className="mt-1 text-sm"
                  placeholder="hr@company.com, manager@company.com"
                  value={cc}
                  onChange={e => setCc(e.target.value)}
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Added to email CC when sending the letter</p>
              </div>

              <Button onClick={generate} disabled={generating || !selectedEmp || !letterType}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                {generating ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4 mr-2" /> Generate Letter</>}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Preview panel */}
        <div className="lg:col-span-3">
          <Card className="min-h-[60vh]">
            <CardContent className="p-5">
              {!letter ? (
                <div className="h-[55vh] flex flex-col items-center justify-center text-gray-300">
                  <FileSignature className="w-14 h-14 mb-3" />
                  <p className="text-sm text-gray-400">Your generated letter will appear here.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div className="text-xs text-gray-400">{ref && `Ref: ${ref}`}</div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => editMode ? exitEditMode() : enterEditMode()}>
                        {editMode ? 'Done Editing' : 'Edit'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={copyLetter}><Copy className="w-3.5 h-3.5 mr-1" /> Copy</Button>
                      <Button size="sm" onClick={saveToDocuments} disabled={saving || saved}
                        className={saved ? 'bg-green-600 hover:bg-green-600 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}>
                        {saving ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                        {saved ? 'Saved' : 'Save to Docs'}
                      </Button>
                      <Button size="sm" onClick={approveAndSend} disabled={approveSending || approveSent}
                        className={approveSent ? 'bg-green-700 hover:bg-green-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}>
                        {approveSending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : approveSent ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                        {approveSent ? 'Sent' : 'Approve & Send'}
                      </Button>
                      <Button size="sm" onClick={printLetter} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                        <Printer className="w-3.5 h-3.5 mr-1" /> Print / PDF
                      </Button>
                    </div>
                  </div>
                  {editMode ? (
                    <Textarea value={editText} onChange={e => setEditText(e.target.value)} className="font-mono text-xs h-[55vh]" placeholder="Edit letter content as plain text..." />
                  ) : (
                    <div className="border rounded-lg p-6 bg-white max-h-[60vh] overflow-y-auto">
                      {isHtml
                        ? <div dangerouslySetInnerHTML={{ __html: letter }} />
                        : <div className="prose prose-sm max-w-none"><ReactMarkdown>{letter}</ReactMarkdown></div>
                      }
                    </div>
                  )}
                  <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Review all details and fill any [____] placeholders before issuing.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <LetterHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
