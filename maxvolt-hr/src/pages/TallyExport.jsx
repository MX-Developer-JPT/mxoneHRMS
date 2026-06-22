import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, FileText, Download, Mail, Calculator } from 'lucide-react';

export default function TallyExport() {
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);

  const months = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
    { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
    { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
    { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
  ];
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

  const handleExport = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('getTallyExport', { month: Number(month), year: Number(year) });
      setResult(res);
      toast.success('Export generated successfully');
    } catch (e) {
      toast.error('Failed to generate export');
    } finally {
      setLoading(false);
    }
  };

  const downloadBlob = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendPayslips = async () => {
    setEmailLoading(true);
    try {
      await base44.functions.invoke('autoSendPayslips', { month: Number(month), year: Number(year) });
      toast.success('Payslips queued for sending');
    } catch (e) {
      toast.error('Failed to send payslips');
    } finally {
      setEmailLoading(false);
    }
  };

  const fmt = (v) => `₹${(v ?? 0).toLocaleString('en-IN')}`;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tally Export</h1>
        <p className="text-gray-500 text-sm mt-1">Export payroll journal entries for Tally accounting software</p>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <div className="w-48">
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <div className="w-32">
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleExport} disabled={loading} className="flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              Generate Export
            </Button>
            <Button
              variant="outline"
              onClick={handleSendPayslips}
              disabled={emailLoading}
              className="flex items-center gap-2"
            >
              {emailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Auto-Send Payslips
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            {[
              { label: 'Gross', value: fmt(result.totals?.gross), color: 'bg-blue-50 text-blue-700' },
              { label: 'PF', value: fmt(result.totals?.pf), color: 'bg-yellow-50 text-yellow-700' },
              { label: 'PT', value: fmt(result.totals?.pt), color: 'bg-orange-50 text-orange-700' },
              { label: 'ESI', value: fmt(result.totals?.esi), color: 'bg-purple-50 text-purple-700' },
              { label: 'LOP', value: fmt(result.totals?.lop), color: 'bg-red-50 text-red-700' },
              { label: 'Net', value: fmt(result.totals?.net), color: 'bg-green-50 text-green-700' },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <CardContent className={`p-4 text-center ${color} rounded-lg`}>
                  <p className="text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                  <p className="text-sm font-bold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Export Files
                </CardTitle>
                <div className="flex gap-3">
                  {result.tally_xml && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadBlob(result.tally_xml, `tally_${year}_${month}.xml`, 'text/xml')}
                      className="flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" /> Download Tally XML
                    </Button>
                  )}
                  {result.csv && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadBlob(result.csv, `payroll_${year}_${month}.csv`, 'text/csv')}
                      className="flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" /> Download CSV
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                Export generated for {months.find(m => m.value === month)?.label} {year}.
                {result.employee_count ? ` Includes ${result.employee_count} employees.` : ''}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
