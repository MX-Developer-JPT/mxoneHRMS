import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Archive, Search, Download, Loader2, Building2, Calendar } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';
import { downloadBase64 } from '@/lib/download';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import LeftAttendanceHistory from '@/components/attendance/LeftAttendanceHistory';
import { deriveOverallExitStatus, OVERALL_STATUS_COLORS } from '@/lib/exitStatus';

const REASON_MAP = {
  better_opportunity: 'Better Opportunity', higher_education: 'Higher Education',
  personal_reasons: 'Personal Reasons', relocation: 'Relocation',
  health_reasons: 'Health Reasons', family_reasons: 'Family Reasons',
  work_life_balance: 'Work-Life Balance', compensation: 'Compensation',
  growth: 'Career Growth', management_issues: 'Management Issues', other: 'Other',
};

export default function LeftEmployees() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportingAtt, setExportingAtt] = useState(false);
  const [error, setError] = useState('');
  const [attendanceOf, setAttendanceOf] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await base44.functions.invoke('le_list', {});
      const list = (res?.data || res)?.employees || [];
      setRows(list.map(r => ({ ...r, id: r.employee_id, user: { full_name: r.name } })));
    } catch (e) { setError(e.message || 'Could not load left employees'); }
    setLoading(false);
  };

  const downloadAttendance = async () => {
    setExportingAtt(true);
    try {
      const res = await base44.functions.invoke('le_export', { user_ids: filtered.map(r => r.user_id) });
      const d = res?.data || res;
      downloadBase64(d.base64, d.filename);
      toast.success(`Attendance of ${filtered.length} employee(s) downloaded`);
    } catch (e) { toast.error(e.message || 'Download failed'); }
    setExportingAtt(false);
  };

  const departments = useMemo(() => Array.from(new Set(rows.map(r => r.department).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (deptFilter !== 'all' && r.department !== deptFilter) return false;
      if (reasonFilter !== 'all' && r.exit?.reason_category !== reasonFilter) return false;
      if (!q) return true;
      return (r.user?.full_name || '').toLowerCase().includes(q)
        || (r.employee_code || '').toLowerCase().includes(q)
        || (r.designation || '').toLowerCase().includes(q)
        || (r.department || '').toLowerCase().includes(q);
    });
  }, [rows, search, deptFilter, reasonFilter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default || ExcelJSModule;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Left Employees');
      ws.columns = [
        { header: 'Employee Name', key: 'name', width: 24 },
        { header: 'Employee ID', key: 'code', width: 14 },
        { header: 'Department', key: 'dept', width: 18 },
        { header: 'Designation', key: 'desig', width: 20 },
        { header: 'Date of Joining', key: 'doj', width: 14 },
        { header: 'Resignation Date', key: 'resign', width: 16 },
        { header: 'Last Working Day', key: 'lwd', width: 16 },
        { header: 'Exit Type', key: 'exitType', width: 14 },
        { header: 'Reason', key: 'reason', width: 18 },
        { header: 'Clearance Status', key: 'clearance', width: 24 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of filtered) {
        ws.addRow({
          name: r.user?.full_name || '', code: r.employee_code || '', dept: r.department || '',
          desig: r.designation || '', doj: r.date_of_joining || '', resign: r.resignation_date || '',
          lwd: r.last_working_date || '', exitType: r.exit_type || '',
          reason: REASON_MAP[r.exit?.reason_category] || r.exit?.reason_category || '',
          clearance: r.exit ? deriveOverallExitStatus(r.exit) : '',
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Left_Employees.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(e.message || 'Export failed'); }
    setExporting(false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Archive className="w-6 h-6 text-gray-600" />Left Employees</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={downloadAttendance} disabled={exportingAtt || !filtered.length}>
            {exportingAtt ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}Attendance (Excel)
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting || !filtered.length}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}Export list
          </Button>
        </div>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={load}>Try again</Button></div>}
      <p className="text-sm text-gray-500">{rows.length} employee(s) marked as left (resigned, terminated or retired). All historical HRMS records — attendance, leave, payroll, documents, and exit/clearance history — are permanently retained and remain viewable here.</p>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search by name, ID, designation, department..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Reason" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            {Object.entries(REASON_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Designation</th>
                <th className="px-3 py-2 text-left">Resignation Date</th>
                <th className="px-3 py-2 text-left">Last Working Day</th>
                <th className="px-3 py-2 text-left">Exit Reason</th>
                <th className="px-3 py-2 text-left">Clearance / F&F Status</th>
                <th className="px-3 py-2 text-left">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/LeftEmployeeProfile?user_id=${r.user_id}`)}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{r.user?.full_name || '—'}</p>
                    <p className="text-xs text-gray-400">{r.employee_code}</p>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600"><Building2 className="w-3.5 h-3.5 inline mr-1 text-gray-400" />{r.department || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.designation || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.resignation_date ? safeDate(r.resignation_date, 'dd MMM yyyy') : '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.last_working_date ? safeDate(r.last_working_date, 'dd MMM yyyy') : '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{REASON_MAP[r.exit?.reason_category] || r.reason || <span className="capitalize">{r.exit_type || '—'}</span>}</td>
                  <td className="px-3 py-2.5">
                    {r.exit ? (
                      <Badge className={OVERALL_STATUS_COLORS[deriveOverallExitStatus(r.exit)] || 'bg-gray-100 text-gray-600'}>{deriveOverallExitStatus(r.exit)}</Badge>
                    ) : <span className="text-gray-400 text-xs">No exit case</span>}
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => setAttendanceOf(r)}><Calendar className="w-3.5 h-3.5 mr-1.5" />History ({r.attendance_days})</Button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No left employees match these filters</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!attendanceOf} onOpenChange={(o) => !o && setAttendanceOf(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Attendance history · {attendanceOf?.name} <span className="text-sm font-normal text-gray-400">{attendanceOf?.employee_code}</span></DialogTitle></DialogHeader>
          {attendanceOf && <LeftAttendanceHistory userId={attendanceOf.user_id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
