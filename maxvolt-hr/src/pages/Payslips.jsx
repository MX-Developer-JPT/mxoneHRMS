import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, DollarSign, Printer, TrendingUp, TrendingDown, Download, Loader2, KeyRound } from 'lucide-react';
import { buildPayslipPageHtml } from '../utils/payslipPrint';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';

function base64ToBlobUrl(base64, mime) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

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
  const [downloading, setDownloading] = useState(null);
  // Once a payslip's actual file/HTML is ready, its URL lands here and the
  // "View..." button is replaced by a real, plain <a href> the user taps
  // themselves — deliberately NOT auto-triggered via window.open() or a
  // synthetic .click(). Both of those are script-initiated navigation,
  // which is exactly the category of action a desktop popup blocker exists
  // to stop, and which this app's native Android/iOS shell (Capacitor's
  // default WebView, no window.open()/onCreateWindow support wired up at
  // all) never reliably honors either — two rounds of trying to paper over
  // that with cleverer timing or a different JS API still didn't fix it.
  // An actual rendered <a> the user physically taps is a real link click,
  // handled by the browser/WebView exactly like any other link already
  // working throughout this app (in-app navigation, etc.) — nothing left
  // to silently block.
  const [readyLinks, setReadyLinks] = useState({}); // { [payrollId]: { url, label } }

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
        const url = URL.createObjectURL(new Blob([buildPayslipPageHtml(rd)], { type: 'text/html' }));
        setReadyLinks(prev => ({ ...prev, [payrollId]: { url, label: 'Open Payslip' } }));
      } else {
        toast.error(rd?.error || 'Failed to generate payslip.');
      }
    } catch (error) {
      console.error('Error printing payslip:', error);
      toast.error('Failed to generate payslip: ' + error.message);
    }
    setPrinting(null);
  };

  const handleDownloadOriginal = async (payrollId) => {
    setDownloading(payrollId);
    try {
      const response = await base44.functions.invoke('getPayslipFileUrl', { payroll_id: payrollId });
      const rd = response?.data || response;
      if (rd?.success && rd.url) {
        setReadyLinks(prev => ({ ...prev, [payrollId]: { url: rd.url, label: 'Open Payslip' } }));
      } else if (rd?.success && rd.base64) {
        const url = base64ToBlobUrl(rd.base64, 'application/pdf');
        setReadyLinks(prev => ({ ...prev, [payrollId]: { url, label: 'Open Payslip' } }));
      } else {
        toast.error(rd?.error || 'This payslip is not available to download.');
      }
    } catch (error) {
      console.error('Error downloading original payslip:', error);
      toast.error('Failed to open payslip: ' + error.message);
    }
    setDownloading(null);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const sorted = [...payrolls].sort((a, b) => b.year - a.year || b.month - a.month);

  const netOf = (p) => {
    if (p.net_salary != null) return p.net_salary;
    const td = Object.values(p.deductions || {}).reduce((a, v) => a + (parseFloat(v) || 0), 0);
    return (p.gross_salary || 0) - td + (p.reimbursement_amount || 0);
  };
  const totalNet = payrolls.reduce((s, p) => s + netOf(p), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Payslips</h1>
          <p className="text-gray-600 mt-1">View and print your salary slips</p>
        </div>

        {/* Uploaded (HR bulk-upload) payslip PDFs are the original file HR
            uploaded — still password-protected exactly as HR received it —
            so anyone downloading the original needs to know the password
            before they hit a locked-PDF prompt with no explanation. */}
        {sorted.some(p => p.payslip_source === 'bulk_upload') && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-full shrink-0"><KeyRound className="w-5 h-5 text-amber-600" /></div>
              <div className="text-sm">
                <p className="font-semibold text-amber-900">Password-protected payslip PDF</p>
                <p className="text-amber-800 mt-0.5">
                  The "Download Original PDF" file is locked. The default password is your{' '}
                  <span className="font-semibold">Employee Code</span>
                  {user?.employee_code || sorted.find(p => p.employee_code)?.employee_code
                    ? <> (<span className="font-mono font-semibold">{user?.employee_code || sorted.find(p => p.employee_code)?.employee_code}</span>)</>
                    : null}.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

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
                <div><p className="text-xs text-gray-500">Latest Net Salary</p><p className="font-bold text-purple-600">₹{netOf(sorted[0]).toLocaleString('en-IN')}</p></div>
              </CardContent></Card>
            )}
          </div>
        )}

        {sorted.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sorted.map(payroll => {
              const deductions = payroll.deductions || {};
              const totalDed = payroll.total_deductions != null ? payroll.total_deductions : Object.values(deductions).reduce((s, v) => s + (parseFloat(v) || 0), 0);
              const grossEarned = payroll.gross_salary || 0;
              const netPay = netOf(payroll);
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
                    {payroll.payslip_source === 'bulk_upload' ? (
                      // HR uploaded the employee's real payslip for this month —
                      // show only that original document, not a salary
                      // breakdown or the separately-generated system payslip
                      // (a different document, in this app's own template,
                      // built from the same extracted figures). Per explicit
                      // request: for an uploaded month, the original IS the
                      // payslip — nothing else is shown alongside it.
                      <>
                        {readyLinks[payroll.id] ? (
                          <a
                            href={readyLinks[payroll.id].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-full items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            {readyLinks[payroll.id].label}
                          </a>
                        ) : (
                          <Button
                            onClick={() => handleDownloadOriginal(payroll.id)}
                            className="w-full"
                            disabled={downloading === payroll.id}
                          >
                            {downloading === payroll.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                            {downloading === payroll.id ? 'Preparing...' : 'View Payslip'}
                          </Button>
                        )}
                        <p className="text-xs text-gray-400 flex items-center gap-1 justify-center">
                          <KeyRound className="w-3 h-3" /> Locked with your Employee Code{payroll.employee_code ? ` (${payroll.employee_code})` : ''}
                        </p>
                      </>
                    ) : (
                      <>
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
                        {readyLinks[payroll.id] ? (
                          <a
                            href={readyLinks[payroll.id].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-full items-center justify-center rounded-md border border-input bg-background h-10 px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                          >
                            <Printer className="w-4 h-4 mr-2" />
                            {readyLinks[payroll.id].label}
                          </a>
                        ) : (
                          <Button
                            onClick={() => handlePrint(payroll.id)}
                            className="w-full"
                            variant="outline"
                            disabled={printing === payroll.id}
                          >
                            <Printer className="w-4 h-4 mr-2" />
                            {printing === payroll.id ? 'Generating...' : 'View / Print Payslip'}
                          </Button>
                        )}
                      </>
                    )}
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