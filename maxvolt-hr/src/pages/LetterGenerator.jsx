import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileSignature, Search, Sparkles, Printer, Copy, RefreshCw, FileText, ChevronLeft
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { openLetterheadPrintWindow } from '../utils/letterhead';

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

function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function LetterGenerator() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [letterType, setLetterType] = useState('');
  const [extra, setExtra] = useState({});
  const [generating, setGenerating] = useState(false);
  const [letter, setLetter] = useState('');
  const [ref, setRef] = useState('');
  const [editMode, setEditMode] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    try {
      const emps = await base44.entities.Employee.list('-display_name', 1000);
      setEmployees(emps.filter(e => e.user_id && e.display_name));
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
        user_id: selectedEmp.user_id, letter_type: letterType, extra,
      });
      const d = res.data || res;
      if (d.success) {
        setLetter(d.letter);
        setRef(d.ref || '');
        setEditMode(false);
      } else toast.error(d.error || 'Generation failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setGenerating(false);
  };

  const printLetter = () => {
    if (!letter) return;
    const html = `<div style="font-size:12px;line-height:1.7;color:#1a1a1a;white-space:pre-wrap;">${
      letter.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')
    }</div>`;
    openLetterheadPrintWindow(`${meta?.label || 'Letter'} - ${selectedEmp?.display_name || ''}`, html, '', false);
  };

  const copyLetter = () => { navigator.clipboard.writeText(letter); toast.success('Letter copied'); };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-indigo-600" /> AI Letter Generator
        </h1>
        <p className="text-gray-500 text-sm mt-1">Draft HR letters in seconds — pre-filled from employee data, editable, and print-ready on company letterhead.</p>
      </div>

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
                    <button key={t.key} onClick={() => { setLetterType(t.key); setExtra({}); }}
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
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditMode(m => !m)}>
                        {editMode ? 'Preview' : 'Edit'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={copyLetter}><Copy className="w-3.5 h-3.5 mr-1" /> Copy</Button>
                      <Button size="sm" onClick={printLetter} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                        <Printer className="w-3.5 h-3.5 mr-1" /> Print / PDF
                      </Button>
                    </div>
                  </div>
                  {editMode ? (
                    <Textarea value={letter} onChange={e => setLetter(e.target.value)} className="font-mono text-xs h-[55vh]" />
                  ) : (
                    <div className="prose prose-sm max-w-none border rounded-lg p-6 bg-white max-h-[60vh] overflow-y-auto">
                      <ReactMarkdown>{letter}</ReactMarkdown>
                    </div>
                  )}
                  <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> AI-drafted — review all details, especially any [____] placeholders, before issuing.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
