import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Home, Calendar, Users } from 'lucide-react';

export default function WFHTracking() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));

  useEffect(() => { loadData(); }, [month, year]);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getWFHReport', { month: Number(month), year: Number(year) });
      setData(result.data || result);
    } catch (e) {
      toast.error('Failed to load WFH data');
      setData({ records: [], total_wfh_days: 0, unique_employees: 0, department_summary: [] });
    } finally {
      setLoading(false);
    }
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
  const deptSummary = data?.department_summary || [];
  const maxDeptDays = deptSummary.length > 0 ? Math.max(...deptSummary.map(d => d.total_wfh_days || 0)) : 1;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">WFH Tracking</h1>
        <p className="text-gray-500 text-sm mt-1">Monitor work-from-home usage across the organization</p>
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
              <Home className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total WFH Days</p>
              <p className="text-xl font-bold text-gray-900">{data?.total_wfh_days ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Unique Employees</p>
              <p className="text-xl font-bold text-gray-900">{data?.unique_employees ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg Days / Employee</p>
              <p className="text-xl font-bold text-gray-900">
                {data?.unique_employees ? (data.total_wfh_days / data.unique_employees).toFixed(1) : '0'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {deptSummary.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">WFH by Department</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {deptSummary.map((dept, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 font-medium">{dept.department}</span>
                  <span className="text-gray-500">{dept.total_wfh_days} days</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full"
                    style={{ width: `${maxDeptDays > 0 ? (dept.total_wfh_days / maxDeptDays) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Employee WFH Details</CardTitle></CardHeader>
        <CardContent className="p-0">
          {records.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No WFH records for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">WFH Days</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Dates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.employee_name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.department}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 text-xs font-semibold">
                          {r.wfh_days}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {Array.isArray(r.dates) ? r.dates.join(', ') : (r.dates || '—')}
                      </td>
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
