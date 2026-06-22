import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Clock, DollarSign, Users, Download } from 'lucide-react';

export default function OvertimeManagement() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));

  useEffect(() => { loadData(); }, [month, year]);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getOvertimeData', { month: Number(month), year: Number(year) });
      setData(result);
    } catch (e) {
      toast.error('Failed to load overtime data');
      setData({ records: [], total_ot_hours: 0, total_ot_amount: 0, employees_with_ot: 0 });
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    const records = data?.records || [];
    if (!records.length) { toast.error('No data to export'); return; }
    const header = ['Employee Name', 'Code', 'Department', 'OT Hours', 'OT Amount (₹)'];
    const rows = records.map(r => [r.employee_name, r.employee_code, r.department, r.ot_hours, r.ot_amount]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overtime_${year}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const months = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
    { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
    { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
    { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
  ];
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  const records = data?.records || [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overtime Management</h1>
          <p className="text-gray-500 text-sm mt-1">Track and review overtime hours and amounts</p>
        </div>
        <Button onClick={downloadCSV} variant="outline" className="flex items-center gap-2">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="w-48">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total OT Hours</p>
              <p className="text-xl font-bold text-gray-900">{data?.total_ot_hours ?? 0} hrs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total OT Amount</p>
              <p className="text-xl font-bold text-gray-900">₹{(data?.total_ot_amount ?? 0).toLocaleString('en-IN')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Employees with OT</p>
              <p className="text-xl font-bold text-gray-900">{data?.employees_with_ot ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Overtime Records</CardTitle></CardHeader>
        <CardContent className="p-0">
          {records.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No overtime records for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Employee Name</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Code</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">OT Hours</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">OT Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.employee_name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.employee_code}</td>
                      <td className="px-4 py-3 text-gray-600">{r.department}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{r.ot_hours}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">₹{(r.ot_amount ?? 0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
