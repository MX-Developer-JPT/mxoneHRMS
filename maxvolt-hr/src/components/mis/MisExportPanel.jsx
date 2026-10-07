import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Download, Loader2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';

// Export the MIS workbook (attendance, joinings, visitors, gate passes, recruitment,
// reimbursements, leave) for a day / week / month — whole company, one department, or
// department-wise (a summary plus one sheet per department).
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

export default function MisExportPanel() {
  const [period, setPeriod] = useState('daily');
  const [date, setDate] = useState(todayIST());
  const [department, setDepartment] = useState('all');
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    base44.entities.Department.list()
      .then(d => setDepartments((d || []).map(x => x.name).filter(Boolean).sort()))
      .catch(() => {});
  }, []);

  const run = async (departmentWise) => {
    setBusy(departmentWise ? 'dw' : 'main');
    try {
      toast.info('Preparing MIS report…');
      const res = await base44.functions.invoke('exportMIS', { period, date, department: departmentWise ? 'all' : department, department_wise: departmentWise });
      const d = res?.data || res;
      if (!d?.success) { toast.error(d?.error || 'MIS export failed'); return; }
      const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = d.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${d.title} downloaded`);
    } catch (e) { toast.error('MIS export error: ' + e.message); }
    setBusy('');
  };

  const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mr-2">
          <FileSpreadsheet className="w-4 h-4 text-green-600" /> Export MIS
        </div>
        <label className="text-xs text-gray-500 flex flex-col gap-1">Report
          <select className={cls} value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (Mon–Sun)</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">{period === 'daily' ? 'Date' : period === 'weekly' ? 'Any date in the week' : 'Any date in the month'}
          <input type="date" className={cls} value={date} max={todayIST()} onChange={e => setDate(e.target.value)} />
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">Department
          <select className={cls} value={department} onChange={e => setDepartment(e.target.value)}>
            <option value="all">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <Button size="sm" onClick={() => run(false)} disabled={!!busy} className="gap-2 bg-green-600 hover:bg-green-700 text-white">
          {busy === 'main' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export MIS
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(true)} disabled={!!busy} className="gap-2">
          {busy === 'dw' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Department-wise MIS
        </Button>
      </div>
    </div>
  );
}
