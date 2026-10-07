import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { ld, downloadBase64, downloadCsv, printHtmlTable } from '@/lib/ld';

const REPORTS = [
  ['new_joiner_induction', 'New Joiner Induction'], ['new_joiner_completion', 'New Joiner Completion'], ['mandatory_compliance', 'Mandatory Training Compliance'],
  ['overdue_training', 'Overdue Training'], ['training_history', 'Employee Training History'], ['assessment_results', 'Assessment Results'],
  ['practical_capability', 'Practical Capability'], ['department_training', 'Department Training'], ['skill_gap', 'Skill Gap'],
  ['certification', 'Certification'], ['training_hours', 'Training Hours'], ['training_effectiveness', 'Training Effectiveness'],
  ['review_30_60_90', '30/60/90 Review'], ['trainer_performance', 'Trainer Performance'],
];

export default function LdReportsTab() {
  const [key, setKey] = useState('new_joiner_induction');
  const [dept, setDept] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try { const r = await ld('ld_getReport', { report: key, filters: dept ? { department: dept } : {} }); if (!cancelled) setData(r); }
      catch (e) { toast.error(e.message); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [key, dept]);

  const exportXlsx = async () => {
    setExporting(true);
    try { const r = await ld('ld_exportReport', { report: key, filters: dept ? { department: dept } : {} }); downloadBase64(r.base64, r.filename); toast.success('Excel downloaded'); } catch (e) { toast.error(e.message); }
    setExporting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500 flex flex-col gap-1">Report
          <select className="h-9 rounded-md border bg-white px-2 text-sm min-w-[260px]" value={key} onChange={e => setKey(e.target.value)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">Department (optional)
          <input className="h-9 rounded-md border bg-white px-2 text-sm" placeholder="exact department name" value={dept} onChange={e => setDept(e.target.value)} />
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={!data || exporting} onClick={exportXlsx}>{exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}Excel</Button>
        <Button size="sm" variant="outline" disabled={!data} onClick={() => downloadCsv(data.columns, data.rows, `${data.title.replace(/\W+/g, '_')}.csv`)}><FileText className="w-4 h-4 mr-1" />CSV</Button>
        <Button size="sm" variant="outline" disabled={!data} onClick={() => printHtmlTable(data.title, data.columns, data.rows)}><Printer className="w-4 h-4 mr-1" />PDF / Print</Button>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        {loading && <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>}
        {!loading && data && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">{data.columns.map(c => <th key={c.key} className="p-2 whitespace-nowrap">{c.label}</th>)}</tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="p-6 text-center text-gray-500">No data for this report yet.</td></tr>}
              {data.rows.slice(0, 500).map((r, i) => <tr key={i} className="border-b last:border-0">{data.columns.map(c => <td key={c.key} className="p-2 align-top">{String(r[c.key] ?? '')}</td>)}</tr>)}
            </tbody>
          </table>
        )}
      </CardContent></Card>
      {data && data.rows.length > 500 && <p className="text-xs text-gray-500">Showing the first 500 of {data.rows.length} rows — export for the full list.</p>}
    </div>
  );
}
