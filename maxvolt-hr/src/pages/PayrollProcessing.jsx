import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calculator, CheckCircle, Send, FileDown, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

const WORKING_DAYS = 26;

// Calculate one employee's payroll from their salary structure + attendance.
// If is_manual_override, all amounts are 0 — HR fills them in the preview.
function calcFromStructure(structure, presentDays, bonusAmount, loanDeduction) {
  if (structure.is_manual_override) {
    return {
      basic_salary: 0, hra: 0, conveyance: 0,
      performance_bonus: 0, special_allowance: 0, other_allowances: 0,
      gross_salary: 0,
      pf_contribution: 0, esi_contribution: 0,
      deductions: { pf: 0, esi: 0, professional_tax: 0, loan: loanDeduction },
      total_deductions: loanDeduction,
      net_salary: -loanDeduction,
      working_days: WORKING_DAYS,
      present_days: 0,
    };
  }

  const ratio = Math.min(presentDays / WORKING_DAYS, 1);
  const basic  = Math.round((structure.basic_salary       || 0) * ratio);
  const hra    = Math.round((structure.hra                 || 0) * ratio);
  const conv   = Math.round((structure.conveyance          || 0) * ratio);
  const perf   = Math.round((structure.performance_bonus   || 0) * ratio) + bonusAmount;
  const pfEmp  = Math.round((structure.pf_contribution     || 0) * ratio);
  const esiEmp = Math.round((structure.esi_contribution    || 0) * ratio);
  const gross  = basic + hra + conv + perf;
  const totalDed = pfEmp + esiEmp + loanDeduction;
  return {
    basic_salary: basic, hra, conveyance: conv,
    performance_bonus: perf, special_allowance: 0, other_allowances: 0,
    gross_salary: gross,
    pf_contribution: pfEmp, esi_contribution: esiEmp,
    deductions: { pf: pfEmp, esi: esiEmp, professional_tax: 0, loan: loanDeduction },
    total_deductions: totalDed,
    net_salary: gross - totalDed,
    working_days: WORKING_DAYS,
    present_days: presentDays,
  };
}

// Recalculate derived totals after HR edits manual amounts
function recompute(row) {
  const gross = (row.basic_salary || 0) + (row.hra || 0) + (row.conveyance || 0) +
    (row.performance_bonus || 0) + (row.special_allowance || 0) + (row.other_allowances || 0);
  const pfEmp  = row.pf_contribution  || 0;
  const esiEmp = row.esi_contribution || 0;
  const loan   = row.deductions?.loan || 0;
  const pt     = row.deductions?.professional_tax || 0;
  const totalDed = pfEmp + esiEmp + loan + pt;
  return {
    ...row,
    gross_salary: gross,
    total_deductions: totalDed,
    net_salary: gross - totalDed,
    deductions: { pf: pfEmp, esi: esiEmp, professional_tax: pt, loan },
  };
}

export default function PayrollProcessing() {
  const [user, setUser]         = useState(null);
  const [payrolls, setPayrolls] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loans, setLoans]       = useState([]);
  const [bonuses, setBonuses]   = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear]   = useState(new Date().getFullYear());
  const [loading, setLoading]   = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { loadData(); }, [selectedMonth, selectedYear]);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const users = await base44.entities.User.list();
      setEmployees(users.filter(u => u.status === 'active' || !u.status));

      const payrollRecords = await base44.entities.Payroll.filter({ month: selectedMonth, year: selectedYear });
      setPayrolls(payrollRecords);

      const allLoans = await base44.entities.Loan.filter({ status: 'active' });
      setLoans(allLoans);

      const allBonuses = await base44.entities.Bonus.filter({
        month: selectedMonth, year: selectedYear, status: 'approved', included_in_payroll: false,
      });
      setBonuses(allBonuses);

      const pad = n => String(n).padStart(2, '0');
      const dateFrom = `${selectedYear}-${pad(selectedMonth)}-01`;
      const dateTo   = `${selectedYear}-${pad(selectedMonth)}-${pad(new Date(selectedYear, selectedMonth, 0).getDate())}`;
      const attResult = await base44.functions.invoke('getAllAttendance', { date_from: dateFrom, date_to: dateTo });
      setAttendance(attResult.data?.records || []);
    } catch (error) {
      console.error('Error loading payroll:', error);
    }
  };

  const calculatePayroll = async () => {
    try {
      setLoading(true);
      const calculated = [];

      for (const employee of employees) {
        if (payrolls.find(p => p.user_id === employee.id)) continue;

        const structures = await base44.entities.SalaryStructure.filter(
          { user_id: employee.id, status: 'active' },
          '-effective_from',
          1
        );
        if (structures.length === 0) continue;

        const structure   = structures[0];
        const empAtt      = attendance.filter(a => a.user_id === employee.id);
        const presentDays = empAtt.filter(a => a.status === 'present').length;
        const empLoan     = loans.find(l => l.user_id === employee.id);
        const loanDed     = empLoan?.monthly_deduction || 0;
        const empBonus    = bonuses.find(b => b.user_id === employee.id);
        const bonusAmt    = empBonus?.amount || 0;

        const computed = calcFromStructure(structure, presentDays, bonusAmt, loanDed);

        calculated.push({
          user_id:             employee.id,
          employee_name:       employee.full_name,
          department:          employee.department || '',
          month:               selectedMonth,
          year:                selectedYear,
          salary_structure_id: structure.id,
          is_manual_override:  !!structure.is_manual_override,
          ...computed,
          bonuses: bonusAmt,
          status: 'draft',
        });
      }

      if (calculated.length === 0) {
        toast.info('All employees already have payroll for this period, or no salary structures found.');
        setLoading(false);
        return;
      }

      setPreviewData(calculated);
      setShowPreview(true);
      setLoading(false);
      toast.success(`Calculated payroll for ${calculated.length} employee(s). Review before approving.`);
    } catch (error) {
      console.error('Error calculating payroll:', error);
      toast.error('Failed to calculate payroll');
      setLoading(false);
    }
  };

  // HR edits a field on a manual-override row
  const handleManualEdit = (idx, field, rawValue) => {
    const value = parseFloat(rawValue) || 0;
    setPreviewData(prev => {
      const updated = [...prev];
      const row = { ...updated[idx], [field]: value };
      // Keep nested deductions in sync for pf/esi fields
      if (field === 'pf_contribution')  row.deductions = { ...row.deductions, pf: value };
      if (field === 'esi_contribution') row.deductions = { ...row.deductions, esi: value };
      updated[idx] = recompute(row);
      return updated;
    });
  };

  const approvePayroll = async () => {
    if (!user || (user.role !== 'admin' && user.role !== 'management')) {
      toast.error('Only management can approve payroll');
      return;
    }

    // Validate manual override rows have at least a net salary entered
    const incomplete = previewData.filter(d => d.is_manual_override && d.gross_salary === 0);
    if (incomplete.length > 0) {
      toast.error(`Please fill salary components for: ${incomplete.map(d => d.employee_name).join(', ')}`);
      return;
    }

    try {
      setLoading(true);
      for (const data of previewData) {
        const { employee_name, is_manual_override, ...saveData } = data;
        await base44.entities.Payroll.create({ ...saveData, status: 'processed' });
        const bonus = bonuses.find(b => b.user_id === data.user_id);
        if (bonus) await base44.entities.Bonus.update(bonus.id, { included_in_payroll: true });
      }
      toast.success('Payroll approved and processed!');
      setShowPreview(false);
      loadData();
    } catch (error) {
      console.error('Error approving payroll:', error);
      toast.error('Failed to approve payroll');
    } finally {
      setLoading(false);
    }
  };

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800',
    processed: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    on_hold: 'bg-red-100 text-red-800',
  };

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const manualFields = [
    { key: 'basic_salary',       label: 'Basic Salary' },
    { key: 'hra',                label: 'HRA' },
    { key: 'conveyance',         label: 'Conveyance' },
    { key: 'performance_bonus',  label: 'Performance Bonus' },
    { key: 'special_allowance',  label: 'Special Allowance' },
    { key: 'other_allowances',   label: 'Other Allowances' },
    { key: 'pf_contribution',    label: 'PF Deduction (Emp)' },
    { key: 'esi_contribution',   label: 'ESI Deduction (Emp)' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Payroll Processing</h1>
          <p className="text-gray-600 mt-1">Calculate and approve monthly payroll</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={calculatePayroll} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
            <Calculator className="w-4 h-4 mr-2" />
            {loading ? 'Calculating…' : 'Calculate Payroll'}
          </Button>
          {payrolls.length > 0 && (
            <Button variant="outline" disabled>
              <FileDown className="w-4 h-4 mr-2" />
              Generate Payslips
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-4 items-center">
            <Select value={selectedMonth.toString()} onValueChange={v => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m, idx) => (
                  <SelectItem key={idx} value={(idx+1).toString()}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={v => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026].map(y => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {payrolls.length > 0 ? payrolls.map(payroll => {
              const employee = employees.find(e => e.id === payroll.user_id);
              return (
                <div key={payroll.id} className="border rounded-lg p-4 flex justify-between items-center flex-wrap gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{employee?.full_name || 'Employee'}</p>
                    <p className="text-sm text-gray-600">
                      Days: {payroll.present_days}/{payroll.working_days}
                      &nbsp;·&nbsp;Gross: ₹{(payroll.gross_salary||0).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-green-600">₹{(payroll.net_salary||0).toLocaleString('en-IN')}</p>
                    <Badge className={statusColors[payroll.status]}>{payroll.status.toUpperCase()}</Badge>
                  </div>
                </div>
              );
            }) : (
              <p className="text-center text-gray-500 py-8">
                No payroll records for this period. Click "Calculate Payroll" to start.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview / approval dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payroll Preview — {months[selectedMonth-1]} {selectedYear}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewData.map((data, idx) => (
              <Card key={idx} className={data.is_manual_override ? 'border-orange-300 bg-orange-50' : ''}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-base">{data.employee_name}</p>
                      <p className="text-xs text-gray-500">
                        {data.department}
                        {data.is_manual_override
                          ? <span className="ml-2 inline-flex items-center gap-1 text-orange-600 font-medium"><Edit2 className="w-3 h-3" />Manual Override — fill amounts below</span>
                          : ` · ${data.present_days}/${data.working_days} days`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Net Pay</p>
                      <p className="text-xl font-bold text-green-600">₹{data.net_salary.toLocaleString('en-IN')}</p>
                    </div>
                  </div>

                  {data.is_manual_override ? (
                    // Editable fields for manual override employees
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {manualFields.map(({ key, label }) => (
                        <div key={key}>
                          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                          <Input
                            type="number"
                            className="h-8 text-sm"
                            placeholder="0"
                            value={data[key] || ''}
                            onChange={e => handleManualEdit(idx, key, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    // Read-only summary for auto-calculated employees
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Gross</p>
                        <p className="font-semibold">₹{data.gross_salary.toLocaleString('en-IN')}</p>
                        <p className="text-xs text-gray-400">
                          Basic ₹{data.basic_salary.toLocaleString('en-IN')} + HRA ₹{data.hra.toLocaleString('en-IN')} + Conv ₹{data.conveyance.toLocaleString('en-IN')}
                          {data.performance_bonus > 0 ? ` + Bonus ₹${data.performance_bonus.toLocaleString('en-IN')}` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Deductions</p>
                        <p className="font-semibold text-red-500">₹{data.total_deductions.toLocaleString('en-IN')}</p>
                        <p className="text-xs text-gray-400">
                          PF ₹{data.pf_contribution.toLocaleString('en-IN')} + ESI ₹{data.esi_contribution.toLocaleString('en-IN')}
                          {(data.deductions?.loan || 0) > 0 ? ` + Loan ₹${data.deductions.loan.toLocaleString('en-IN')}` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Net Pay</p>
                        <p className="font-semibold text-green-600">₹{data.net_salary.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowPreview(false)}>Cancel</Button>
              <Button onClick={approvePayroll} disabled={loading} className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="w-4 h-4 mr-2" />
                {loading ? 'Processing…' : 'Approve & Process'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
