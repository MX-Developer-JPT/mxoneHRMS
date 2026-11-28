import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, Download } from 'lucide-react';
import { openPdfBlob } from '@/utils/letterhead';
import { safeDate } from '@/lib/dateUtils';

const SOURCE = { direct: ['Direct', 'bg-purple-100 text-purple-800'], mrf: ['MRF', 'bg-blue-100 text-blue-800'], recruitment: ['Recruitment', 'bg-slate-100 text-slate-700'] };
const STATUS = { sent: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', generated: 'bg-gray-100 text-gray-600' };
const call = async (name, args) => { const r = await base44.functions.invoke(name, args); return r?.data || r; };

// Every offer letter generated or dispatched, newest first.
export default function OfferRegister() {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');

  useEffect(() => { call('of_register', {}).then((d) => setRows(d.rows || [])).catch((e) => { toast.error(e.message); setRows([]); }); }, []);

  const download = async (id) => {
    try { const d = await call('of_download', { id }); openPdfBlob(d.base64, d.filename, { download: true }); } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-green-600" /></div>;
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => (source === 'all' || r.source === source) && (status === 'all' || r.status === status)
    && (!q || `${r.candidate_name} ${r.recipient_email} ${r.candidate_email} ${r.designation} ${r.department} ${r.offer_ref} ${r.requisition_no} ${r.employee_code}`.toLowerCase().includes(q)));
  const select = (value, onChange, label, items) => (
    <select aria-label={label} className="h-9 border rounded-md px-2 text-sm bg-white" value={value} onChange={(e) => onChange(e.target.value)}>{items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Input className="flex-1 min-w-48" placeholder="Search name, email, designation, reference, requisition or employee code" value={search} onChange={(e) => setSearch(e.target.value)} />
          {select(source, setSource, 'Source', [['all', 'All sources'], ['direct', 'Direct'], ['mrf', 'MRF'], ['recruitment', 'Recruitment']])}
          {select(status, setStatus, 'Dispatch status', [['all', 'All dispatch statuses'], ['sent', 'Sent'], ['failed', 'Failed'], ['generated', 'Generated, not sent']])}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left bg-gray-100">{['Issue date', 'Candidate', 'Position', 'Source', 'CTC / year', 'Dispatch', 'Recipient', 'Created by', 'Candidate record', ''].map((h) => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="px-2 py-2 whitespace-nowrap">{safeDate(r.issue_date, 'dd MMM yyyy')}</td>
                  <td className="px-2 py-2"><p className="font-medium">{r.candidate_name}</p><p className="text-gray-400">{r.offer_ref || `Version ${r.version}`}</p></td>
                  <td className="px-2 py-2">{r.designation}<p className="text-gray-400">{r.department}</p></td>
                  <td className="px-2 py-2"><span className={`px-2 py-0.5 rounded-full ${SOURCE[r.source]?.[1]}`}>{SOURCE[r.source]?.[0]}</span>{r.requisition_no && <p className="text-gray-400 mt-0.5 whitespace-nowrap">{r.requisition_no}</p>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">₹{Number(r.annual_ctc || 0).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-2"><span className={`px-2 py-0.5 rounded-full capitalize ${STATUS[r.status] || ''}`}>{r.status}</span><p className="text-gray-400 mt-0.5 whitespace-nowrap">{safeDate(r.created_at, 'dd MMM, h:mm a')}</p>{r.error && <p className="text-red-600">{r.error}</p>}</td>
                  <td className="px-2 py-2 break-all">{r.recipient_email || '—'}</td>
                  <td className="px-2 py-2">{r.by_name}</td>
                  <td className="px-2 py-2 capitalize">{String(r.candidate_status || '').replace(/_/g, ' ')}{r.employee_code && <p className="text-green-700 normal-case">Employee {r.employee_code}</p>}</td>
                  <td className="px-2 py-2">{r.has_pdf && <button type="button" onClick={() => download(r.id)} className="text-blue-600 flex items-center gap-1"><Download className="w-3 h-3" />PDF</button>}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={10} className="py-10 text-center text-gray-400">No offer letters to show.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
