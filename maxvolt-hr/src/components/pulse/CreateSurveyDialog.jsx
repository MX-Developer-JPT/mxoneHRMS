import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, X, Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Lock, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ps, Q_TYPES, typeLabel, fileToBase64, saveBase64File } from '@/lib/pulse';

const blankQ = () => ({ text: '', type: 'rating', required: true, optionsText: '' });
const isChoice = (t) => t === 'single' || t === 'multi';

// Upload the Excel template, see every problem with its row number, and load the valid questions into the survey.
function ImportPanel({ onUse }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [fileName, setFileName] = useState('');
  const ref = useRef(null);

  const template = async () => {
    try { const d = await ps('ps_template'); saveBase64File(d.base64, d.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
    catch (e) { toast.error(e.message); }
  };
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { toast.error('Please upload an Excel .xlsx file (use the template)'); return; }
    setBusy(true); setFileName(f.name); setRes(null);
    try { setRes(await ps('ps_import', { file_base64: await fileToBase64(f) })); } catch (err) { toast.error(err.message); }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheet className="w-5 h-5 text-violet-600" />
        <div className="flex-1 min-w-[180px]"><div className="text-sm font-semibold text-gray-800">Import questions from Excel</div><div className="text-xs text-gray-500">Questions, types and options in one file. Every problem is listed by row.</div></div>
        <Button type="button" size="sm" variant="outline" onClick={template}><Download className="w-4 h-4 mr-1" />Template</Button>
        <Button type="button" size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}Upload file</Button>
        <input ref={ref} type="file" accept=".xlsx" className="hidden" onChange={pick} />
      </div>

      {res && !res.valid && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
          <div className="text-sm font-semibold text-red-800 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{fileName}: {res.errors.length} problem{res.errors.length > 1 ? 's' : ''} to fix — nothing was imported</div>
          <div className="max-h-44 overflow-y-auto overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-red-700"><th className="pr-3 py-0.5">Row</th><th className="pr-3">Column</th><th>Problem</th></tr></thead>
            <tbody>{res.errors.map((e, i) => <tr key={i} className="border-t border-red-100"><td className="pr-3 py-1 font-mono">{e.row || '—'}</td><td className="pr-3">{e.field || '—'}</td><td>{e.message}</td></tr>)}</tbody></table></div>
          <div className="text-[11px] text-red-700">Fix these in the Excel file and upload it again.</div>
        </div>
      )}
      {res?.valid && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 space-y-2">
          <div className="text-sm font-semibold text-green-800 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{fileName}: {res.questions.length} question{res.questions.length > 1 ? 's' : ''} ready</div>
          <ol className="text-xs text-gray-700 space-y-0.5 max-h-36 overflow-y-auto list-decimal pl-5">
            {res.questions.map((q, i) => <li key={i}><span className="font-medium">{q.text}</span> <span className="text-gray-400">· {typeLabel(q.type)}{q.options ? ` (${q.options.length} options)` : ''}{q.required ? '' : ' · optional'}</span></li>)}
          </ol>
          {res.warnings.length > 0 && <div className="text-[11px] text-amber-700">{res.warnings.map((w, i) => <div key={i}>Row {w.row}: {w.message}</div>)}</div>}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { onUse(res.questions, 'replace'); setRes(null); toast.success('Questions loaded — review them below'); }}>Use these questions</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { onUse(res.questions, 'append'); setRes(null); toast.success('Questions added'); }}>Add to my questions</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreateSurveyDialog({ onClose, onCreated }) {
  const [type, setType] = useState('pulse');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [closesAt, setClosesAt] = useState('');
  const [questions, setQuestions] = useState([blankQ()]);
  const [saving, setSaving] = useState(false);

  const setQ = (i, patch) => setQuestions(qs => qs.map((x, j) => j === i ? { ...x, ...patch } : x));
  const useImported = (imported, mode) => {
    const rows = imported.map(q => ({ text: q.text, type: q.type, required: q.required !== false, optionsText: (q.options || []).join('\n') }));
    setQuestions(qs => mode === 'append' ? [...qs.filter(q => q.text.trim()), ...rows] : rows);
  };

  const save = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    const qs = questions.filter(q => q.text.trim());
    if (!qs.length && type !== 'enps') { toast.error('Add at least one question'); return; }
    for (const [i, q] of qs.entries()) {
      if (isChoice(q.type) && new Set(q.optionsText.split('\n').map(s => s.trim()).filter(Boolean)).size < 2) { toast.error(`Question ${i + 1} needs at least 2 options (one per line)`); return; }
    }
    setSaving(true);
    try {
      await ps('ps_create', { title, description, type, anonymous, closes_at: closesAt || null, questions: qs.map(q => ({ text: q.text.trim(), type: q.type, required: q.required, options: isChoice(q.type) ? q.optionsText.split('\n').map(s => s.trim()).filter(Boolean) : undefined })) });
      toast.success('Survey launched & employees notified'); onCreated();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New survey</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setType('pulse')} className={`rounded-lg border px-3 py-2 text-sm ${type === 'pulse' ? 'bg-violet-600 text-white border-transparent' : 'bg-white text-gray-700'}`}>Pulse survey</button>
            <button type="button" onClick={() => setType('enps')} className={`rounded-lg border px-3 py-2 text-sm ${type === 'enps' ? 'bg-teal-600 text-white border-transparent' : 'bg-white text-gray-700'}`}>eNPS (0–10 + more)</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Label>Title</Label><Input className="mt-1" value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'enps' ? 'Q4 Employee NPS' : 'Monthly team pulse'} /></div>
            <div><Label>Description <span className="text-gray-400 font-normal">(optional)</span></Label><Input className="mt-1" value={description} onChange={e => setDescription(e.target.value)} /></div>
            <div><Label>Closes on <span className="text-gray-400 font-normal">(optional)</span></Label><Input type="date" className="mt-1" value={closesAt} onChange={e => setClosesAt(e.target.value)} /></div>
          </div>

          <div className="space-y-2">
            <Label>Who sees the answers?</Label>
            <div className="grid sm:grid-cols-2 gap-2">
              <button type="button" onClick={() => setAnonymous(true)} className={`text-left rounded-lg border p-3 ${anonymous ? 'border-violet-500 bg-violet-50' : 'bg-white'}`}>
                <div className="flex items-center gap-1.5 text-sm font-semibold"><Lock className="w-4 h-4 text-violet-600" />Anonymous</div>
                <div className="text-xs text-gray-500 mt-0.5">HR sees totals only. Groups smaller than 5 people are hidden. No employee-wise view.</div>
              </button>
              <button type="button" onClick={() => setAnonymous(false)} className={`text-left rounded-lg border p-3 ${!anonymous ? 'border-amber-500 bg-amber-50' : 'bg-white'}`}>
                <div className="flex items-center gap-1.5 text-sm font-semibold"><Eye className="w-4 h-4 text-amber-600" />Named</div>
                <div className="text-xs text-gray-500 mt-0.5">HR can see each employee&apos;s answers, who has not responded, and export them. Employees are told their name is visible.</div>
              </button>
            </div>
          </div>

          <ImportPanel onUse={useImported} />

          {type === 'enps' && <div className="text-xs bg-teal-50 border border-teal-100 rounded-lg p-2.5 text-teal-700">The standard eNPS question (&quot;How likely are you to recommend Maxvolt as a place to work?&quot;, 0–10) is added automatically.</div>}

          <div>
            <Label>Questions</Label>
            <div className="space-y-2 mt-1">
              {questions.map((q, i) => (
                <div key={i} className="rounded-lg border p-2.5 space-y-2 bg-gray-50/60">
                  <div className="flex flex-wrap gap-2">
                    <Input className="flex-1 min-w-[200px] bg-white" value={q.text} onChange={e => setQ(i, { text: e.target.value })} placeholder={`Question ${i + 1}`} />
                    <select value={q.type} onChange={e => setQ(i, { type: e.target.value, required: e.target.value === 'text' ? false : q.required })} className="border rounded-md text-sm px-2 bg-white h-9">
                      {Q_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {questions.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>}
                  </div>
                  {isChoice(q.type) && <Textarea rows={3} className="bg-white text-sm" placeholder={'One option per line\nOption A\nOption B'} value={q.optionsText} onChange={e => setQ(i, { optionsText: e.target.value })} />}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={q.required} onChange={e => setQ(i, { required: e.target.checked })} />Required</label>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setQuestions(qs => [...qs, blankQ()])}><Plus className="w-4 h-4 mr-1" />Add question</Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">{saving ? 'Launching…' : 'Launch survey'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
