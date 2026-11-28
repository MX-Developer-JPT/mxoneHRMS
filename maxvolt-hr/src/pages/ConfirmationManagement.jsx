import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, UserCheck, RefreshCw, Download, MailWarning, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { safeDate } from '@/lib/dateUtils';
import ConfirmationCaseDialog from '@/components/confirmation/ConfirmationCaseDialog';
import { STATUS, STATUS_STYLE } from '@/components/confirmation/confirmationShared';

const day = (d) => (d ? safeDate(d, 'dd MMM yyyy') : '—');

// Confirmation tracker. HR initiates and records observations; the reporting manager takes the final decision.
export default function ConfirmationManagement() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');

  const load = async () => {
    setError('');
    try {
      const r = await base44.functions.invoke('cf_tracker', {});
      const d = r?.data || r;
      if (d?.success === false) throw new Error(d.error);
      setData(d);
    } catch (e) { setError(e.message || 'Could not load the tracker'); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => (filter === 'open' ? r.status !== 'confirmed' : filter === 'mine' ? r.can_decide : filter === 'all' ? true : r.status === filter))
    .filter((r) => !q || `${r.name} ${r.employee_code} ${r.department} ${r.designation} ${r.manager_name}`.toLowerCase().includes(q));
  const mine = rows.filter((r) => r.can_decide).length;
  const overdue = rows.filter((r) => ['pending_hr', 'pending_manager', 'on_hold'].includes(r.status) && r.days_left < 0).length;
  const soon = rows.filter((r) => ['pending_hr', 'pending_manager', 'on_hold'].includes(r.status) && r.days_left >= 0 && r.days_left <= 15).length;

  const exportExcel = async () => {
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default || ExcelJSModule;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Confirmation tracker');
      ws.columns = [['Employee ID', 14], ['Name', 26], ['Department', 18], ['Designation', 22], ['Date of joining', 15], ['Due / review date', 17], ['Days left', 10], ['Reporting manager', 24], ['Status', 28], ['Initiated on', 15], ['Decided on', 15]].map(([header, width]) => ({ header, width }));
      ws.getRow(1).font = { bold: true };
      for (const r of visible) ws.addRow([r.employee_code, r.name, r.department, r.designation, r.date_of_joining, r.due_date, r.days_left, r.manager_name, r.status_label, r.initiated_at?.slice(0, 10), r.decided_at?.slice(0, 10)]);
      const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Confirmation_Tracker.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(e.message); }
  };

  if (!data && !error) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin w-6 h-6 text-blue-500" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><UserCheck className="w-6 h-6 text-green-600" />Employee Confirmation</h1>
          <p className="text-sm text-gray-500">HR initiates and records observations. The reporting manager takes the final decision.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          {data?.can_view_all && <Button variant="outline" size="sm" onClick={exportExcel} disabled={!visible.length}><Download className="w-4 h-4 mr-1" />Export</Button>}
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={load}>Try again</Button></div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {STATUS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(filter === k ? 'open' : k)} className="text-left">
                <Card className={filter === k ? 'ring-2 ring-blue-500' : 'hover:shadow-md'}><CardContent className="p-3"><p className="text-2xl font-bold text-gray-900">{data.counts[k]}</p><span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] ${STATUS_STYLE[k]}`}>{label}</span></CardContent></Card>
              </button>
            ))}
          </div>
          {(overdue > 0 || soon > 0) && <p className="text-sm"><span className="text-red-700 font-medium">{overdue} overdue</span> · <span className="text-amber-700 font-medium">{soon} due within 15 days</span></p>}
          {mine > 0 && <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 flex items-center justify-between gap-3 flex-wrap"><span><b>{mine}</b> confirmation(s) are waiting for your assessment and decision.</span><Button size="sm" onClick={() => setFilter('mine')}>Show them</Button></div>}

          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" /><Input className="pl-9" placeholder="Search name, ID, department, manager…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            {[['open', 'Open'], ...(mine ? [['mine', 'Awaiting me']] : []), ['all', 'All']].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-full border text-xs ${filter === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>)}
          </div>

          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr>{['Employee', 'Department', 'Joined', 'Due / review date', 'Reporting manager', 'Status', ''].map((h) => <th key={h} className="text-left px-3 py-2.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {visible.map((r) => {
                  const open = !['confirmed', 'rejected'].includes(r.status);
                  const action = r.can_decide ? 'Assess' : data.can_initiate && r.status === 'pending_hr' ? 'Initiate' : 'View';
                  return (
                    <tr key={r.user_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5"><p className="font-medium text-gray-900">{r.name}</p><p className="text-xs text-gray-400">{r.employee_code}</p></td>
                      <td className="px-3 py-2.5 text-gray-600">{r.department || '—'}<p className="text-xs text-gray-400">{r.designation}</p></td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{day(r.date_of_joining)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{day(r.due_date)}{open && r.days_left != null && <p className={`text-xs ${r.days_left < 0 ? 'text-red-600' : r.days_left <= 15 ? 'text-amber-600' : 'text-gray-400'}`}>{r.days_left < 0 ? `${-r.days_left} days overdue` : `${r.days_left} days left`}</p>}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.manager_name || <span className="text-red-600 text-xs">Not assigned</span>}</td>
                      <td className="px-3 py-2.5"><span className={`px-2 py-1 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_STYLE[r.status]}`}>{r.status_label}</span>
                        {data.can_initiate && r.mail_failed && <p className="text-[11px] text-red-600 flex items-center gap-1 mt-1"><MailWarning className="w-3 h-3" />Email failed</p>}
                        {data.can_initiate && r.exit_review === 'pending' && <p className="text-[11px] text-red-600 flex items-center gap-1 mt-1"><LogOut className="w-3 h-3" />Exit review pending</p>}</td>
                      <td className="px-3 py-2.5 text-right"><Button size="sm" variant={action === 'View' ? 'outline' : 'default'} onClick={() => setSelected(r.user_id)}>{action}</Button></td>
                    </tr>
                  );
                })}
                {!visible.length && <tr><td colSpan={7} className="py-10 text-center text-gray-400">Nothing to show</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </>
      )}

      {selected && <ConfirmationCaseDialog userId={selected} canInitiate={!!data?.can_initiate} isAdmin={!!data?.is_admin} onClose={() => setSelected('')} onChanged={load} />}
    </div>
  );
}
