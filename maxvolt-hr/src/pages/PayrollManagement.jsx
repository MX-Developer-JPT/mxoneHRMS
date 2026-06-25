import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, Users, TrendingUp, Play, Check, Download, FileText, Printer, Loader2, CheckSquare, Square, FileSpreadsheet } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { openPayslipPrintWindow } from '../utils/payslipPrint';

export default function PayrollManagement() {
  const [payrolls, setPayrolls] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showProcessDialog, setShowProcessDialog] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [payrollRecords, empRecords, usersResp] = await Promise.all([
        base44.entities.Payroll.list('-year', 500),
        base44.entities.Employee.filter({ status: 'active' }, '-created_date', 500),
        base44.functions.invoke('getAllUsers', {}),
      ]);
      const users = usersResp.data?.users || [];
      const enrichedEmps = empRecords.map(emp => ({
        ...emp,
        _user: users.find(u => u.id === emp.user_id),
      }));
      setPayrolls(payrollRecords);
      setEmployees(enrichedEmps);
      setLoading(false);
    } catch (error) {
      console.error('Error loading payroll:', error);
      setLoading(false);
    }
  };

  const handleProcessPayroll = async () => {
    try {
      setProcessing(true);
      const response = await base44.functions.invoke('processAdvancedPayroll', {
        month: selectedMonth,
        year: selectedYear
      });

      if (response.data.success) {
        toast.success(`Payroll processed for ${response.data.processed.length} employees`);
        loadData();
        setShowProcessDialog(false);
      } else {
        toast.error('Failed to process payroll');
      }
    } catch (error) {
      toast.error('Error processing payroll: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleApprovePayroll = async (payrollId) => {
    try {
      await base44.entities.Payroll.update(payrollId, { status: 'processed' });
      toast.success('Payroll approved');
      loadData();
    } catch (error) {
      toast.error('Error approving payroll');
    }
  };

  const handleMarkAsPaid = async (payrollId) => {
    try {
      const paymentDate = new Date().toISOString().split('T')[0];
      await base44.entities.Payroll.update(payrollId, { 
        status: 'paid',
        payment_date: paymentDate
      });

      // Create Payslip record for employee portal
      const payroll = payrolls.find(p => p.id === payrollId);
      if (payroll) {
        const deductions = payroll.deductions || {};
        const allowances = payroll.allowances || {};
        const totalDeductions = Object.values(deductions).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        await base44.entities.Payslip.create({
          user_id: payroll.user_id,
          month: payroll.month,
          year: payroll.year,
          basic_salary: payroll.basic_salary || 0,
          hra: payroll.hra || 0,
          conveyance: allowances.conveyance || 0,
          medical: allowances.medical || 0,
          special_allowance: allowances.special_allowance || 0,
          other_allowances: allowances.lta || 0,
          gross_salary: payroll.gross_salary || 0,
          pf_deduction: deductions.pf || 0,
          tds: deductions.tds || 0,
          other_deductions: (deductions.loan_emi || 0) + (deductions.esi || 0),
          total_deductions: totalDeductions,
          net_salary: payroll.net_salary || 0,
          status: 'paid',
          payment_date: paymentDate,
          payment_method: 'bank_transfer',
          notes: `Payroll ID: ${payrollId}`
        });
      }

      toast.success('Marked as paid — payslip created for employee');
      loadData();
    } catch (error) {
      toast.error('Error updating status: ' + error.message);
    }
  };

  const toggleBulkSelect = (payrollId) => {
    setBulkSelected(prev => { const next = new Set(prev); if (next.has(payrollId)) next.delete(payrollId); else next.add(payrollId); return next; });
  };

  const selectAllDraft = () => {
    const drafts = filteredPayrolls.filter(p => p.status === 'draft');
    if (drafts.length === 0) { toast.error('No draft payrolls to select'); return; }
    const allSelected = drafts.every(p => bulkSelected.has(p.id));
    setBulkSelected(new Set(allSelected ? [] : drafts.map(p => p.id)));
  };

  const selectAllProcessed = () => {
    const processed = filteredPayrolls.filter(p => p.status === 'processed');
    if (processed.length === 0) { toast.error('No processed payrolls to select'); return; }
    const allSelected = processed.every(p => bulkSelected.has(p.id));
    setBulkSelected(new Set(allSelected ? [] : processed.map(p => p.id)));
  };

  const handleBulkApprove = async () => {
    const selected = filteredPayrolls.filter(p => bulkSelected.has(p.id) && p.status === 'draft');
    if (selected.length === 0) { toast.error('No draft payrolls selected'); return; }
    if (!confirm(`Approve payroll for ${selected.length} employee(s)?`)) return;
    setBulkProcessing(true);
    try {
      await Promise.all(selected.map(p => base44.entities.Payroll.update(p.id, { status: 'processed' })));
      toast.success(`${selected.length} payroll(s) approved`);
      setBulkSelected(new Set());
      loadData();
    } catch (err) { toast.error('Error approving payrolls'); }
    setBulkProcessing(false);
  };

  const handleBulkMarkPaid = async () => {
    const selected = filteredPayrolls.filter(p => bulkSelected.has(p.id) && p.status === 'processed');
    if (selected.length === 0) { toast.error('No processed payrolls selected'); return; }
    if (!confirm(`Mark ${selected.length} payroll(s) as paid?`)) return;
    setBulkProcessing(true);
    try {
      const paymentDate = new Date().toISOString().split('T')[0];
      await Promise.all(selected.map(async (payroll) => {
        await base44.entities.Payroll.update(payroll.id, { status: 'paid', payment_date: paymentDate });
        const deductions = payroll.deductions || {};
        const allowances = payroll.allowances || {};
        const totalDeductions = Object.values(deductions).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        await base44.entities.Payslip.create({
          user_id: payroll.user_id, month: payroll.month, year: payroll.year,
          basic_salary: payroll.basic_salary || 0, hra: payroll.hra || 0,
          conveyance: allowances.conveyance || 0, medical: allowances.medical || 0,
          special_allowance: allowances.special_allowance || 0, other_allowances: allowances.lta || 0,
          gross_salary: payroll.gross_salary || 0, pf_deduction: deductions.pf || 0,
          tds: deductions.tds || 0, other_deductions: (deductions.loan_emi || 0) + (deductions.esi || 0),
          total_deductions: totalDeductions, net_salary: payroll.net_salary || 0,
          status: 'paid', payment_date: paymentDate, payment_method: 'bank_transfer',
          notes: `Payroll ID: ${payroll.id}`
        });
      }));
      toast.success(`${selected.length} payroll(s) marked as paid`);
      setBulkSelected(new Set());
      loadData();
    } catch (err) { toast.error('Error updating payrolls: ' + err.message); }
    setBulkProcessing(false);
  };

  const handleDownloadPayslip = async (payrollId) => {
    try {
      const response = await base44.functions.invoke('generatePayslip', { payroll_id: payrollId });
      if (response.data?.success) {
        openPayslipPrintWindow(response.data);
        toast.success('Payslip opened for printing');
      } else {
        toast.error(response.data?.error || 'Failed to generate payslip');
      }
    } catch (error) {
      toast.error('Error generating payslip: ' + error.message);
    }
  };

  const handleBulkDownloadPayslips = async () => {
    const eligible = filteredPayrolls.filter(p => p.status === 'processed' || p.status === 'paid');
    if (eligible.length === 0) {
      toast.error('No processed/paid payrolls to download');
      return;
    }
    setBulkDownloading(true);
    try {
      for (const payroll of eligible) {
        const response = await base44.functions.invoke('generatePayslip', { payroll_id: payroll.id });
        if (response.data?.success) {
          openPayslipPrintWindow(response.data);
          // Small delay between windows to avoid browser blocking
          await new Promise(r => setTimeout(r, 400));
        }
      }
      toast.success(`Opened ${eligible.length} payslip(s) for printing`);
    } catch (error) {
      toast.error('Error generating payslips: ' + error.message);
    }
    setBulkDownloading(false);
  };

  const handleExportSalarySheet = async () => {
    try {
      toast.info('Generating salary sheet…');
      const response = await base44.functions.invoke('exportSalarySheet', { month: selectedMonth, year: selectedYear });
      if (response.data?.success) {
        const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url  = window.URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = response.data.filename;
        a.click();
        window.URL.revokeObjectURL(url);
        const t = response.data.totals;
        toast.success(`Salary sheet exported — ${response.data.total_employees} employees, Net ₹${(t?.net||0).toLocaleString('en-IN')}`);
      } else {
        toast.error(response.data?.error || 'Failed to generate salary sheet');
      }
    } catch (error) {
      toast.error('Error: ' + error.message);
    }
  };

  const handleDownloadBankFile = async (bankFormat = 'generic') => {
    try {
      const response = await base44.functions.invoke('generateBankTransferFile', {
        month: selectedMonth,
        year: selectedYear,
        format: bankFormat,
      });
      if (response.data?.success) {
        const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.data.filename || `bank_transfer_${selectedMonth}_${selectedYear}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success(`Bank transfer file downloaded — ${response.data.count} employees, ₹${response.data.total?.toLocaleString('en-IN')}`);
      } else {
        toast.error(response.data?.error || 'No paid payroll records found');
      }
    } catch (error) {
      toast.error('Error downloading file: ' + error.message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const filteredPayrolls = payrolls.filter(p => p.month === selectedMonth && p.year === selectedYear);

  const totalPayroll = filteredPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);
  const processedCount = filteredPayrolls.filter(p => p.status === 'processed' || p.status === 'paid').length;
  const paidCount = filteredPayrolls.filter(p => p.status === 'paid').length;

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800',
    processed: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    on_hold: 'bg-orange-100 text-orange-800'
  };

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Payroll Management</h1>
            <p className="text-gray-600 mt-1">Manage employee payroll and salary disbursement</p>
          </div>
          <div className="flex gap-3">
            <Dialog open={showProcessDialog} onOpenChange={setShowProcessDialog}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Play className="w-4 h-4 mr-2" />
                  Process Payroll
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Process Payroll</DialogTitle>
                  <DialogDescription>
                    Select the month and year to process payroll for all active employees
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Month</label>
                    <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {monthNames.map((name, idx) => (
                          <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Year</label>
                    <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((year) => (
                          <SelectItem key={year} value={year.toString()}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button 
                    onClick={handleProcessPayroll} 
                    disabled={processing}
                    className="w-full"
                  >
                    {processing ? 'Processing...' : 'Process Payroll'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button 
              variant="outline" 
              onClick={handleBulkDownloadPayslips}
              disabled={processedCount === 0 || bulkDownloading}
            >
              {bulkDownloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
              Print All Payslips
            </Button>
            <Button variant="outline" onClick={handleExportSalarySheet} title="Export complete salary sheet with attendance & components">
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Salary Sheet
            </Button>
            <Select value="_none" onValueChange={(v) => { if (v !== '_none') handleDownloadBankFile(v); }}>
              <SelectTrigger className="w-44" disabled={processedCount === 0}>
                <Download className="w-4 h-4 mr-1" />
                <SelectValue placeholder="Bank Transfer File" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Bank Transfer File</SelectItem>
                <SelectItem value="generic">📄 Standard Format</SelectItem>
                <SelectItem value="sbi">🏦 SBI Format</SelectItem>
                <SelectItem value="hdfc">🏦 HDFC Format</SelectItem>
                <SelectItem value="icici">🏦 ICICI Format</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-100 rounded-full">
                  <DollarSign className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Payroll</p>
                  <p className="text-2xl font-bold text-blue-600">₹{totalPayroll.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">{monthNames[selectedMonth - 1]} {selectedYear}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-green-100 rounded-full">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Paid</p>
                  <p className="text-2xl font-bold text-green-600">{paidCount}</p>
                  <p className="text-xs text-gray-500">of {filteredPayrolls.length} employees</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-purple-100 rounded-full">
                  <TrendingUp className="w-8 h-8 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Active Employees</p>
                  <p className="text-2xl font-bold text-purple-600">{employees.filter(e => e.status === 'active').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Payroll Records</CardTitle>
              <div className="flex gap-3">
                <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthNames.map((name, idx) => (
                      <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Bulk Action Bar */}
            {bulkSelected.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <span className="text-sm font-medium">{bulkSelected.size} selected</span>
                <Button size="sm" onClick={handleBulkApprove} disabled={bulkProcessing}>
                  <CheckSquare className="w-3 h-3 mr-1" /> Approve Draft
                </Button>
                <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700" onClick={handleBulkMarkPaid} disabled={bulkProcessing}>
                  <Check className="w-3 h-3 mr-1" /> Mark Paid
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setBulkSelected(new Set())}>Cancel</Button>
              </div>
            )}
            {/* Quick Select Buttons */}
            {bulkSelected.size === 0 && (
              <div className="flex gap-2 mb-3">
                <Button size="xs" variant="outline" className="h-7 text-xs" onClick={selectAllDraft}>
                  <Square className="w-3 h-3 mr-1" /> Select Draft
                </Button>
                <Button size="xs" variant="outline" className="h-7 text-xs" onClick={selectAllProcessed}>
                  <Square className="w-3 h-3 mr-1" /> Select Processed
                </Button>
              </div>
            )}
            <div className="space-y-3">
              {filteredPayrolls.length > 0 ? (
                filteredPayrolls.map(payroll => {
                  const emp = employees.find(e => e.user_id === payroll.user_id);
                  const deductions = payroll.deductions || {};
                  const totalDeductions = payroll.total_deductions
                    ?? Object.values(deductions).reduce((sum, val) => sum + (typeof val === 'number' ? val : 0), 0);
                  
                  const empName = emp?.display_name || emp?._user?.full_name || '—';
                  return (
                    <div key={payroll.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <input type="checkbox" className="w-4 h-4 rounded accent-blue-600 cursor-pointer mt-1" checked={bulkSelected.has(payroll.id)} onChange={() => toggleBulkSelect(payroll.id)} />
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-blue-600 font-semibold">
                              {empName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-semibold">{empName}</p>
                            <p className="text-sm text-gray-600">
                              {emp?.designation || '—'}
                              {emp?.department ? ` · ${emp.department}` : ''}
                            </p>
                            <p className="text-xs text-gray-500">
                              {emp?.employee_code ? `Code: ${emp.employee_code}` : ''}
                              {emp?.date_of_joining ? ` · DOJ: ${new Date(emp.date_of_joining).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}` : ''}
                            </p>
                            <p className="text-xs text-gray-400">
                              Days: {payroll.present_days}/{payroll.working_days}{payroll.overtime_hours > 0 ? ` · OT: ${payroll.overtime_hours}h` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Gross</p>
                            <p className="font-semibold">₹{payroll.gross_salary?.toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Deductions</p>
                            <p className="font-semibold text-red-600">-₹{totalDeductions.toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Net Salary</p>
                            <p className="text-xl font-bold text-green-600">₹{payroll.net_salary?.toLocaleString()}</p>
                          </div>
                          <div className="flex flex-col gap-2">
                            <Badge className={statusColors[payroll.status]}>
                              {payroll.status.replace('_', ' ').toUpperCase()}
                            </Badge>
                            {payroll.status === 'draft' && (
                              <Button 
                                size="sm" 
                                onClick={() => handleApprovePayroll(payroll.id)}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                Approve
                              </Button>
                            )}
                            {payroll.status === 'processed' && (
                              <Button 
                                size="sm" 
                                onClick={() => handleMarkAsPaid(payroll.id)}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                Mark Paid
                              </Button>
                            )}
                            {(payroll.status === 'processed' || payroll.status === 'paid') && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleDownloadPayslip(payroll.id)}
                              >
                                <FileText className="w-3 h-3 mr-1" />
                                Payslip
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-gray-500 py-8">No payroll records for this period</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}