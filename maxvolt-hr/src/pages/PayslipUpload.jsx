import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  UploadCloud, FileText, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Users, FileWarning, Copy, KeyRound, FileX2, Send, History, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const STATUS_META = {
  mapped:               { label: 'Mapped',              color: 'bg-green-100 text-green-800',   icon: CheckCircle2 },
  mapped_needs_review:  { label: 'Mapped (Review)',     color: 'bg-amber-100 text-amber-800',    icon: AlertTriangle },
  unmapped:             { label: 'Unmapped',             color: 'bg-slate-200 text-slate-700',    icon: Users },
  duplicate:            { label: 'Duplicate',            color: 'bg-blue-100 text-blue-800',      icon: Copy },
  invalid:              { label: 'Invalid PDF',          color: 'bg-red-100 text-red-800',        icon: FileX2 },
  password_failed:      { label: 'Password Failed',      color: 'bg-red-100 text-red-800',        icon: KeyRound },
  extraction_failed:    { label: 'Extraction Failed',    color: 'bg-orange-100 text-orange-800',  icon: FileWarning },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-100 text-slate-700', icon: FileText };
  const Icon = meta.icon;
  return (
    <Badge className={`${meta.color} border-0 gap-1 font-normal`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </Badge>
  );
}

export default function PayslipUpload() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [files, setFiles] = useState([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { counts, files } for the just-completed upload
  const [dragOver, setDragOver] = useState(false);
  const [selectedForRelease, setSelectedForRelease] = useState(new Set());
  const [releasing, setReleasing] = useState(false);
  const [batches, setBatches] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { loadBatches(); }, []);

  const loadBatches = async () => {
    try {
      const res = await base44.functions.invoke('getPayslipUploadBatches', {});
      const d = res?.data || res;
      if (d?.success) setBatches(d.batches || []);
    } catch (e) { /* non-fatal — history is a convenience view */ }
  };

  const handleFilesPicked = (fileList) => {
    const picked = Array.from(fileList || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (picked.length !== (fileList?.length || 0)) toast.warning('Non-PDF files were skipped');
    setFiles(picked);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!files.length) { toast.error('Select at least one payslip PDF'); return; }
    setUploading(true);
    setResult(null);
    try {
      const data = await base44.integrations.Core.UploadPayslips({ files, month, year, replace_existing: replaceExisting });
      setResult(data);
      setSelectedForRelease(new Set());
      const mappedOk = (data.files || []).filter(f => f.status === 'mapped' || f.status === 'mapped_needs_review');
      toast.success(`Processed ${data.counts.total} file(s) — ${mappedOk.length} mapped`);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadBatches();
    } catch (e) {
      toast.error('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const toggleRelease = (payrollId) => {
    setSelectedForRelease(prev => {
      const next = new Set(prev);
      if (next.has(payrollId)) next.delete(payrollId); else next.add(payrollId);
      return next;
    });
  };

  const mappedFiles = (result?.files || []).filter(f => f.status === 'mapped' || f.status === 'mapped_needs_review');

  const selectAllMapped = () => {
    if (selectedForRelease.size === mappedFiles.length) setSelectedForRelease(new Set());
    else setSelectedForRelease(new Set(mappedFiles.map(f => f.payroll_id)));
  };

  const handleRelease = async () => {
    if (!selectedForRelease.size) { toast.error('Select at least one employee to release'); return; }
    setReleasing(true);
    try {
      const res = await base44.functions.invoke('releasePayslips', { payroll_ids: Array.from(selectedForRelease) });
      const d = res?.data || res;
      if (d?.success) {
        toast.success(`Released ${d.released} payslip(s) to employees`);
        setSelectedForRelease(new Set());
      } else {
        toast.error(d?.error || 'Failed to release payslips');
      }
    } catch (e) {
      toast.error('Error releasing payslips: ' + e.message);
    } finally {
      setReleasing(false);
    }
  };

  const counts = result?.counts;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Bulk Payslip Upload</h1>
        <p className="text-slate-500 text-sm mt-1">
          Upload a month's password-protected payslip PDFs (filename = Employee Code). They're auto-decrypted, mapped to employees, and fed into Payroll — review, then release to employees when ready.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose Payroll Month & Files</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Month</label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Year</label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1.5">
              <Switch checked={replaceExisting} onCheckedChange={setReplaceExisting} id="replace-existing" />
              <label htmlFor="replace-existing" className="text-sm text-slate-600">Replace existing payroll records for this month</label>
            </div>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFilesPicked(e.dataTransfer.files); }}
          >
            <UploadCloud className="w-8 h-8 mx-auto text-slate-400 mb-2" />
            <p className="text-sm text-slate-600">
              {files.length ? `${files.length} PDF(s) selected` : 'Drag & drop payslip PDFs here, or click to browse'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Each filename should be the Employee Code, e.g. EMP001.pdf</p>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
              onChange={(e) => handleFilesPicked(e.target.files)} />
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.slice(0, 30).map((f, i) => (
                <Badge key={i} variant="outline" className="font-normal">{f.name}</Badge>
              ))}
              {files.length > 30 && <Badge variant="outline">+{files.length - 30} more</Badge>}
            </div>
          )}

          <Button onClick={handleUpload} disabled={uploading || !files.length} className="w-full sm:w-auto">
            {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing…</> : <><UploadCloud className="w-4 h-4 mr-2" />Upload & Process</>}
          </Button>
        </CardContent>
      </Card>

      {counts && (
        <Card>
          <CardHeader><CardTitle className="text-base">2. Upload Processing Dashboard</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
              <StatCard label="Total Files" value={counts.total} />
              <StatCard label="Mapped" value={counts.mapped} color="text-green-600" />
              <StatCard label="Unmapped" value={counts.unmapped} color="text-slate-600" />
              <StatCard label="Duplicate" value={counts.duplicate} color="text-blue-600" />
              <StatCard label="Invalid PDF" value={counts.invalid} color="text-red-600" />
              <StatCard label="Password Failed" value={counts.password_failed} color="text-red-600" />
              <StatCard label="Extraction Failed" value={counts.extraction_failed} color="text-orange-600" />
              <StatCard label="Needs Review" value={(result.files || []).filter(f => f.status === 'mapped_needs_review').length} color="text-amber-600" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-2 pr-3 font-medium">Employee Code</th>
                    <th className="py-2 pr-3 font-medium">Employee</th>
                    <th className="py-2 pr-3 font-medium">Filename</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.files || []).map(f => (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">{f.employee_code}</td>
                      <td className="py-2 pr-3">{f.employee_name || '—'}</td>
                      <td className="py-2 pr-3 text-slate-500 max-w-[180px] truncate" title={f.filename}>{f.filename}</td>
                      <td className="py-2 pr-3"><StatusBadge status={f.status} /></td>
                      <td className="py-2 pr-3 text-slate-500 text-xs max-w-xs">
                        {f.error && <div className="text-red-600">{f.error}</div>}
                        {(f.warnings || []).map((w, i) => <div key={i} className="text-amber-600">⚠ {w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {mappedFiles.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">3. Release Payslips to Employees</CardTitle>
            <Button variant="outline" size="sm" onClick={selectAllMapped}>
              {selectedForRelease.size === mappedFiles.length ? 'Deselect All' : 'Select All'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">
              Choose which employees should be able to see and download their payslip now. Unselected employees' payslips stay hidden until you release them.
            </p>
            <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
              {mappedFiles.map(f => (
                <label key={f.payroll_id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <Checkbox checked={selectedForRelease.has(f.payroll_id)} onCheckedChange={() => toggleRelease(f.payroll_id)} />
                  <span className="font-mono text-xs text-slate-500 w-20">{f.employee_code}</span>
                  <span className="flex-1 text-sm">{f.employee_name}</span>
                  <StatusBadge status={f.status} />
                </label>
              ))}
            </div>
            <Button onClick={handleRelease} disabled={releasing || !selectedForRelease.size}>
              {releasing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Releasing…</> : <><Send className="w-4 h-4 mr-2" />Release {selectedForRelease.size || ''} Payslip(s)</>}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between cursor-pointer" onClick={() => setHistoryOpen(o => !o)}>
          <CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" /> Past Upload Batches</CardTitle>
          {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </CardHeader>
        {historyOpen && (
          <CardContent>
            {batches.length === 0 ? (
              <p className="text-sm text-slate-400">No past batches yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b">
                      <th className="py-2 pr-3 font-medium">Month/Year</th>
                      <th className="py-2 pr-3 font-medium">Uploaded</th>
                      <th className="py-2 pr-3 font-medium">Total</th>
                      <th className="py-2 pr-3 font-medium">Mapped</th>
                      <th className="py-2 pr-3 font-medium">Unmapped</th>
                      <th className="py-2 pr-3 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">{MONTHS[(b.month || 1) - 1]} {b.year}</td>
                        <td className="py-2 pr-3 text-slate-500">{new Date(b.uploaded_at).toLocaleString()}</td>
                        <td className="py-2 pr-3">{b.counts?.total ?? '—'}</td>
                        <td className="py-2 pr-3 text-green-600">{b.counts?.mapped ?? 0}</td>
                        <td className="py-2 pr-3">{b.counts?.unmapped ?? 0}</td>
                        <td className="py-2 pr-3 text-red-600">{(b.counts?.invalid || 0) + (b.counts?.password_failed || 0) + (b.counts?.extraction_failed || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, color = 'text-slate-900' }) {
  return (
    <div className="border rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value ?? 0}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
