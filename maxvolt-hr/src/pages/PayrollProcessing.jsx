import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calculator, CheckCircle, Send, FileDown, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

export default function PayrollProcessing() {
  const [user, setUser] = useState(null);
  const [payrolls, setPayrolls] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loans, setLoans] = useState([]);
  const [bonuses, setBonuses] = useState([]);
  const [config, setConfig] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedMonth, selectedYear]);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const configs = await base44.entities.PayrollConfiguration.filter({ is_active: true });
      setConfig(configs[0] || null);

      const users = await base44.entities.User.list();
      setEmployees(users.filter(u => u.status === 'active' || !u.status));

      const payrollRecords = await base44.entities.Payroll.filter({
        month: selectedMonth,
        year: selectedYear
      });
      setPayrolls(payrollRecords);

      const allLoans = await base44.entities.Loan.filter({ status: 'active' });
      setLoans(allLoans);

      const allBonuses = await base44.entities.Bonus.filter({
        month: selectedMonth,
        year: selectedYear,
        status: 'approved',
        included_in_payroll: false
      });
      setBonuses(allBonuses);

      const pad = (n) => String(n).padStart(2, '0');
      const dateFrom = `${selectedYear}-${pad(selectedMonth)}-01`;
      const dateTo = `${selectedYear}-${pad(selectedMonth)}-${pad(new Date(selectedYear, selectedMonth, 0).getDate())}`;
      const attResult = await base44.functions.invoke('getAllAttendance', { date_from: dateFrom, date_to: dateTo });
      setAttendance(attResult.data?.records || []);
    } catch (error) {
      console.error('Error loading payroll:', error);
    }
  };

  const calculatePayroll = async () => {
    if (!config) {
      toast.error('Please configure payroll settings first');
      return;
    }

    try {
      setLoading(true);
      const calculated = [];

      for (const employee of employees) {
        const existing = payrolls.find(p => p.user_id === employee.id);
        if (existing) continue;

        const salaryStructures = await base44.entities.SalaryStructure.filter(
          { user_id: employee.id },
          '-effective_from',
          1
        );
        if (salaryStructures.length === 0) continue;

        const structure = salaryStructures[0];
        const empAttendance = attendance.filter(a => a.user_id === employee.id);
        const presentDays = empAttendance.filter(a => a.status === 'present').length;
        const workingDays = 26;

        const empLoan = loans.find(l => l.user_id === employee.id);
        const loanDeduction = empLoan?.monthly_deduction || 0;

        const empBonus = bonuses.find(b => b.user_id === employee.id);
        const bonusAmount = empBonus?.amount || 0;

        const basicSalary = (structure.basic_salary / workingDays) * presentDays;
        const hra = (structure.hra / workingDays) * presentDays;
        const allowances = ((structure.special_allowance || 0) + (structure.transport_allowance || 0) + (structure.medical_allowance || 0)) / workingDays * presentDays;

        const grossSalary = basicSalary + hra + allowances + bonusAmount;
        const pfDeduction = basicSalary * (config.pf_employee_rate / 100);
        const esiDeduction = structure.ctc <= config.esi_wage_limit ? grossSalary * (config.esi_employee_rate / 100) : 0;
        const totalDeductions = pfDeduction + esiDeduction + config.professional_tax + loanDeduction;
        const netSalary = grossSalary - totalDeductions;

        calculated.push({
          user_id: employee.id,
          employee_name: employee.full_name,
          month: selectedMonth,
          year: selectedYear,
          salary_structure_id: structure.id,
          working_days: workingDays,
          present_days: presentDays,
          basic_salary: Math.round(basicSalary),
          hra: Math.round(hra),
          allowances: { special: Math.round(allowances), bonus: bonusAmount },
          gross_salary: Math.round(grossSalary),
          deductions: {
            pf: Math.round(pfDeduction),
            esi: Math.round(esiDeduction),
            professional_tax: config.professional_tax,
            loan: loanDeduction
          },
          bonuses: bonusAmount,
          net_salary: Math.round(netSalary),
          status: 'draft'
        });
      }

      setPreviewData(calculated);
      setShowPreview(true);
      setLoading(false);
      toast.success('Payroll calculated successfully!');
    } catch (error) {
      console.error('Error calculating payroll:', error);
      toast.error('Failed to calculate payroll');
      setLoading(false);
    }
  };

  const approvePayroll = async () => {
    if (!user || (user.role !== 'admin' && user.role !== 'management')) {
      toast.error('Only management can approve payroll');
      return;
    }

    try {
      setLoading(true);
      for (const data of previewData) {
        await base44.entities.Payroll.create({
          ...data,
          status: 'processed',
          employee_name: undefined
        });

        const bonus = bonuses.find(b => b.user_id === data.user_id);
        if (bonus) {
          await base44.entities.Bonus.update(bonus.id, { included_in_payroll: true });
        }
      }
      toast.success('Payroll approved and processed!');
      setShowPreview(false);
      loadData();
      setLoading(false);
    } catch (error) {
      console.error('Error approving payroll:', error);
      toast.error('Failed to approve payroll');
      setLoading(false);
    }
  };

  const generatePayslips = async () => {
    toast.info('Payslips generation started');
  };

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800',
    processed: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    on_hold: 'bg-red-100 text-red-800'
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
            Calculate Payroll
          </Button>
          {payrolls.length > 0 && (
            <Button onClick={generatePayslips} variant="outline">
              <FileDown className="w-4 h-4 mr-2" />
              Generate Payslips
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-4 items-center">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m, idx) => (
                  <SelectItem key={idx} value={(idx + 1).toString()}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
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
            {payrolls.length > 0 ? (
              payrolls.map(payroll => {
                const employee = employees.find(e => e.id === payroll.user_id);
                return (
                  <div key={payroll.id} className="border rounded-lg p-4 flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{employee?.full_name || 'Employee'}</p>
                      <p className="text-sm text-gray-600">Days: {payroll.present_days}/{payroll.working_days}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-green-600">₹{payroll.net_salary?.toLocaleString()}</p>
                      <Badge className={statusColors[payroll.status]}>
                        {payroll.status.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-center text-gray-500 py-8">No payroll records. Click Calculate Payroll to start.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payroll Preview - {months[selectedMonth - 1]} {selectedYear}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {previewData.map((data, idx) => (
              <Card key={idx}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <p className="font-semibold text-lg">{data.employee_name}</p>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-gray-600">Gross</p>
                          <p className="font-semibold">₹{data.gross_salary.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Deductions</p>
                          <p className="font-semibold text-red-600">
                            ₹{Object.values(data.deductions).reduce((a, b) => a + b, 0).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-600">Net</p>
                          <p className="font-semibold text-green-600">₹{data.net_salary.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowPreview(false)}>Cancel</Button>
              <Button onClick={approvePayroll} disabled={loading} className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="w-4 h-4 mr-2" />
                Approve & Process
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}