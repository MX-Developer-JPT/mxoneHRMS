import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle, XCircle, Loader2, FileSpreadsheet, PlusCircle, RefreshCw, MinusCircle } from 'lucide-react';

const DEFAULT_COMPANY = 'Maxvolt Energy Industries Limited';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 7);
}

// "Job Title / Designation *" -> "job_title_designation"
const normHeader = (h) => String(h || '').toLowerCase().replace(/\*/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const FIELD_OF = {
  card_id: 'id', id: 'id',
  full_name: 'name', name: 'name',
  job_title_designation: 'job_title', job_title: 'job_title', designation: 'job_title', title: 'job_title',
  company: 'company',
  phone_number: 'phone_number', phone: 'phone_number', mobile: 'phone_number',
  email: 'email', email_address: 'email',
  whatsapp_number: 'whatsapp_number', whatsapp: 'whatsapp_number',
  website: 'website',
  linkedin_url: 'linkedin_url', linkedin: 'linkedin_url',
  address: 'address',
  profile_picture_url: 'profile_picture_url', photo: 'profile_picture_url',
};
const FIELDS = ['name', 'job_title', 'company', 'phone_number', 'email', 'whatsapp_number', 'website', 'linkedin_url', 'address', 'profile_picture_url'];

function downloadBase64Xlsx(base64, filename) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Reads .xlsx / .xls / .csv into [{ rowNumber, data }] using the template's header row.
async function readRows(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets['Business Cards'] || wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const headerIdx = aoa.findIndex(r => r.some(c => ['full_name', 'name'].includes(normHeader(c))));
  if (headerIdx < 0) throw new Error('Could not find the "Full Name" column. Please use the downloaded template.');
  const map = aoa[headerIdx].map(h => FIELD_OF[normHeader(h)] || null);
  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const data = {};
    map.forEach((f, ci) => { if (f) data[f] = String(aoa[i][ci] ?? '').trim(); });
    if (FIELDS.some(f => data[f])) rows.push({ rowNumber: i + 1, data }); // ignore fully blank rows
  }
  return rows;
}

export default function BulkImportModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);       // { create:[], update:[], unchanged:n, errors:[] }
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [readError, setReadError] = useState('');

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const res = await base44.functions.invoke('exportBusinessCardTemplate', {});
      const d = res?.data || res;
      if (!d?.success || !d.base64) throw new Error(d?.error || 'Could not build the template');
      downloadBase64Xlsx(d.base64, d.filename);
    } catch (e) {
      setReadError(e.message || 'Could not download the template');
    }
    setDownloading(false);
  };

  const handleFileChange = async (e) => {
    const f = e.target.files?.[0];
    setFile(f || null); setResults(null); setPlan(null); setReadError('');
    if (!f) return;
    setBusy(true);
    try {
      const [rows, existing] = await Promise.all([readRows(f), base44.entities.DigitalBusinessCard.list('-created_date', 2000)]);
      const byId = new Map(existing.map(c => [c.id, c]));
      const byEmail = new Map(existing.map(c => [String(c.email || '').toLowerCase(), c]));
      const seenEmails = new Map();
      const out = { create: [], update: [], unchanged: 0, errors: [] };
      for (const { rowNumber, data } of rows) {
        const label = `Row ${rowNumber}${data.name ? ` (${data.name})` : ''}`;
        const email = data.email.toLowerCase();
        const missing = [!data.name && 'Full Name', !data.job_title && 'Job Title', !data.phone_number && 'Phone', !data.email && 'Email'].filter(Boolean);
        if (missing.length) { out.errors.push(`${label}: missing ${missing.join(', ')}`); continue; }
        if (!EMAIL_RE.test(data.email)) { out.errors.push(`${label}: "${data.email}" is not a valid email`); continue; }
        if (seenEmails.has(email)) { out.errors.push(`${label}: same email as row ${seenEmails.get(email)} — each person once`); continue; }
        seenEmails.set(email, rowNumber);

        const payload = {};
        FIELDS.forEach(f => { payload[f] = data[f] || ''; });
        if (!payload.company) payload.company = DEFAULT_COMPANY;

        const match = (data.id && byId.get(data.id)) || byEmail.get(email);
        if (match) {
          const changed = FIELDS.some(f => String(match[f] || '') !== payload[f]);
          if (changed) out.update.push({ label, id: match.id, payload });
          else out.unchanged++;
        } else {
          out.create.push({ label, payload });
        }
      }
      setPlan(out);
    } catch (err) {
      setReadError(err.message || 'Could not read this file');
    }
    setBusy(false);
  };

  const handleImport = async () => {
    if (!plan) return;
    setBusy(true);
    const res = { created: 0, updated: 0, failed: 0, errors: [] };
    for (const item of plan.create) {
      try {
        await base44.entities.DigitalBusinessCard.create({ ...item.payload, unique_slug: generateSlug(item.payload.name) });
        res.created++;
      } catch (e) { res.failed++; res.errors.push(`${item.label}: ${e.message}`); }
    }
    for (const item of plan.update) {
      try {
        await base44.entities.DigitalBusinessCard.update(item.id, item.payload);
        res.updated++;
      } catch (e) { res.failed++; res.errors.push(`${item.label}: ${e.message}`); }
    }
    setResults(res);
    setBusy(false);
    if (res.created + res.updated > 0) setTimeout(onImported, 1800);
  };

  const hasWork = plan && (plan.create.length + plan.update.length) > 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Business Cards</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> How it works</p>
            <ol className="list-decimal pl-5 text-xs space-y-0.5 text-amber-800">
              <li>Download the Excel template — it already lists every existing card.</li>
              <li>Edit cards in place to update them, or add new people in the empty rows.</li>
              <li>Upload it here, review the preview, then import.</li>
            </ol>
          </div>

          <Button variant="outline" className="w-full gap-2" onClick={handleDownloadTemplate} disabled={downloading}>
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {downloading ? 'Preparing template…' : 'Download Excel Template (with existing cards)'}
          </Button>

          <label className="block border-2 border-dashed border-gray-200 rounded-xl p-5 text-center cursor-pointer hover:border-amber-300 hover:bg-amber-50/30 transition-colors">
            <Upload className="w-7 h-7 text-gray-400 mx-auto mb-1.5" />
            <p className="text-sm text-gray-600 font-medium break-all">{file ? file.name : 'Click to upload the filled template'}</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx, .xls or .csv</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" />
          </label>

          {readError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{readError}</p>}

          {busy && !results && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Working…</p>}

          {plan && !results && (
            <div className="rounded-xl border p-3 space-y-2 text-sm">
              <p className="font-semibold text-gray-800">Preview</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-green-50 text-green-700 p-2"><PlusCircle className="w-4 h-4 mx-auto mb-0.5" /><p className="font-bold text-lg leading-none">{plan.create.length}</p><p className="text-[11px]">to create</p></div>
                <div className="rounded-lg bg-blue-50 text-blue-700 p-2"><RefreshCw className="w-4 h-4 mx-auto mb-0.5" /><p className="font-bold text-lg leading-none">{plan.update.length}</p><p className="text-[11px]">to update</p></div>
                <div className="rounded-lg bg-gray-50 text-gray-600 p-2"><MinusCircle className="w-4 h-4 mx-auto mb-0.5" /><p className="font-bold text-lg leading-none">{plan.unchanged}</p><p className="text-[11px]">unchanged</p></div>
              </div>
              {plan.errors.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2">
                  <p className="text-xs font-semibold text-red-700 mb-1">{plan.errors.length} row{plan.errors.length > 1 ? 's' : ''} need attention (will be skipped)</p>
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-28 overflow-y-auto">{plan.errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
                </div>
              )}
              {!hasWork && plan.errors.length === 0 && <p className="text-xs text-gray-500">Nothing to import — every row matches an existing card.</p>}
            </div>
          )}

          {results && (
            <div className="rounded-lg border p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-green-700 text-sm"><CheckCircle className="w-4 h-4" /><span>{results.created} created, {results.updated} updated</span></div>
              {results.failed > 0 && <div className="flex items-center gap-2 text-red-600 text-sm"><XCircle className="w-4 h-4" /><span>{results.failed} failed</span></div>}
              {results.errors.map((e, i) => <p key={i} className="text-xs text-red-500 pl-6">{e}</p>)}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">{results ? 'Close' : 'Cancel'}</Button>
            {!results && (
              <Button onClick={handleImport} disabled={!hasWork || busy} className="flex-1">
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {hasWork ? `Import ${plan.create.length + plan.update.length} card${plan.create.length + plan.update.length > 1 ? 's' : ''}` : 'Import'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
