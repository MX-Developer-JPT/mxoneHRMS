import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, DollarSign, Printer, TrendingUp, TrendingDown } from 'lucide-react';
import { openPayslipPrintWindow } from '../utils/payslipPrint';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import { Badge } from "@/components/ui/badge";

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const statusColors = {
  draft: 'bg-gray-100 text-gray-800',
  processed: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800'
};

export default function Payslips() {
  const [user, setUser] = useState(null);
  const [payrolls, setPayrolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const payrollRecords = await base44.entities.Payroll.filter({ user_id: currentUser.id, status: 'paid' }, '-year');
      setPayrolls(payrollRecords);
    } catch (error) {
      console.error('Error loading payslips:', error);
    }
    setLoading(false);
  };

  const handlePrint = async (payrollId) => {
    setPrinting(payrollId);
    try {
      const response = await base44.functions.invoke('generatePayslip', { payroll_id: payrollId });
      const rd = response?.data || response;
      if (rd?.success) {
        openPayslipPrintWindow(rd);
      }
    } catch (error) {
      console.error('Error printing payslip:', error);
    }
    setPrinting(null);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const sorted = [...payrolls].sort((a, b) => b.year - a.year || b.month - a.month);

  const totalNet = payrolls.reduce((s, p) => {
    const td = Object.values(p.deductions || {}).reduce((a, v) => a + (parseFloat(v) || 0), 0);
    return s + ((p.gross_salary || 0) - td);
  }, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Payslips</h1>
          <p className="text-gray-600 mt-1">View and print your salary slips</p>
        </div>

        {/* Summary */}
        {payrolls.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card><CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-full"><DollarSign className="w-5 h-5 text-green-600" /></div>
              <div><p className="text-xs text-gray-500">Total Earnings (YTD)</p><p className="font-bold text-green-600">₹{totalNet.toLocaleString('en-IN')}</p></div>
            </CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-full"><FileText className="w-5 h-5 text-blue-600" /></div>
              <div><p className="text-xs text-gray-500">Payslips Available</p><p className="font-bold text-blue-600">{payrolls.length}</p></div>
            </CardContent></Card>
            {payrolls[0] && (
              <Card><CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-full"><TrendingUp className="w-5 h-5 text-purple-600" /></div>
                <div><p className="text-xs text-gray-500">Latest Net Salary</p><p className="font-bold text-purple-600">₹{(() => { const d = payrolls[0]?.deductions || {}; const td = Object.values(d).reduce((s,v)=>s+(parseFloat(v)||0),0); return ((payrolls[0]?.gross_salary||0)-td).toLocaleString('en-IN'); })()}</p></div>
              </CardContent></Card>
            )}
          </div>
        )}

        {sorted.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sorted.map(payroll => {
              const deductions = payroll.deductions || {};
              const totalDed = Object.values(deductions).reduce((s, v) => s + (parseFloat(v) || 0), 0);
              const grossEarned = payroll.gross_salary || 0;
              const netPay = grossEarned - totalDed;
              return (
                <Card key={payroll.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-100 rounded-full">
                          <FileText className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{monthNames[(payroll.month || 1) - 1]} {payroll.year}</CardTitle>
                          <Badge className={statusColors[payroll.status] || statusColors.paid}>
                            {(payroll.status || 'paid').toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Gross Salary</span>
                        <span className="font-semibold">₹{(payroll.gross_salary || 0).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Deductions</span>
                        <span className="font-semibold text-red-600">-₹{totalDed.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Days Present</span>
                        <span className="font-semibold">{payroll.present_days || 0}/{payroll.working_days || 0}</span>
                      </div>
                      <div className="pt-2 border-t flex justify-between">
                        <span className="font-bold">Net Take-Home</span>
                        <span className="font-bold text-green-600 text-base">₹{netPay.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                    {payroll.payment_date && (
                      <p className="text-xs text-gray-400">Paid on {safeDate(payroll.payment_date, 'MMM d, yyyy')}</p>
                    )}
                    <Button
                      onClick={() => handlePrint(payroll.id)}
                      className="w-full"
                      variant="outline"
                      disabled={printing === payroll.id}
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      {printing === payroll.id ? 'Generating...' : 'View / Print Payslip'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <DollarSign className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500 font-medium">No payslips available yet</p>
              <p className="text-gray-400 text-sm mt-1">Your payslips will appear here once HR processes and pays your salary.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}