import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Download, Loader2 } from 'lucide-react';
import { downloadBase64 } from '@/lib/mis';
import { toast } from 'sonner';

// Date range + department + (optional) status, then an Excel download from a backend export function.
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';

export default function DataExportBar({ fn, label = 'Export to Excel', initialFrom, initialTo, statuses }) {
  const [from, setFrom] = useState(initialFrom || today().slice(0, 8) + '01');
  const [to, setTo] = useState(initialTo || today());
  const [department, setDepartment] = useState('all');
  const [status, setStatus] = useState('all');
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (initialFrom) setFrom(initialFrom); if (initialTo) setTo(initialTo); }, [initialFrom, initialTo]);
  useEffect(() => { base44.entities.Department.list().then(d => setDepartments((d || []).map(x => x.name).filter(Boolean).sort())).catch(() => {}); }, []);
  const run = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke(fn, { from, to, department, status });
      const d = res?.data || res;
      if (!d?.success) toast.error(d?.error || 'Export failed');
      else { downloadBase64(d.base64, d.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast.success(`${d.filename} downloaded`); }
    } catch (e) { toast.error('Export failed: ' + e.message); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <label className="text-xs text-gray-500 flex flex-col gap-1">From<input type="date" className={cls} value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
      <label className="text-xs text-gray-500 flex flex-col gap-1">To<input type="date" className={cls} value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
      <label className="text-xs text-gray-500 flex flex-col gap-1">Department
        <select className={cls} value={department} onChange={e => setDepartment(e.target.value)}><option value="all">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}</select>
      </label>
      {statuses && <label className="text-xs text-gray-500 flex flex-col gap-1">Status
        <select className={cls} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All</option>{statuses.map(s => <option key={s[0]} value={s[0]}>{s[1]}</option>)}</select>
      </label>}
      <button onClick={run} disabled={busy} className="h-9 inline-flex items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {label}
      </button>
    </div>
  );
}
