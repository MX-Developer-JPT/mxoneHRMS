import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Shield, RefreshCw, Download, AlertTriangle, Users, FileText,
  TrendingUp, Clock, CheckCircle, IndianRupee, Calculator, ClipboardList
} from 'lucide-react';
import ComplianceStatCard from '@/components/compliance/ComplianceStatCard';
import DeadlineManager from '@/components/compliance/DeadlineManager';
import ComplianceRecordsTable from '@/components/compliance/ComplianceRecordsTable';
import KYCStatusTable from '@/components/compliance/KYCStatusTable';
import AIInsightsPanel from '@/components/compliance/AIInsightsPanel';
import AuditLogTable from '@/components/compliance/AuditLogTable';
import UnderDevelopmentBanner from '@/components/UnderDevelopmentBanner';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function ComplianceDashboard() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [summary, setSummary] = useState(null);
  const [deadlines, setDeadlines] = useState([]);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  useEffect(() => {
    loadData();
  }, [month, year]);

  const loadData = async () => {
    setLoading(true);
    const [summaryRes, empsRes, usersRes, logsRes] = await Promise.all([
      base44.functions.invoke('getComplianceSummary', { month, year }),
      base44.entities.Employee.filter({ status: 'active' }),
      base44.functions.invoke('getAllUsers', {}),
      base44.entities.ComplianceAuditLog.list('-created_date', 50)
    ]);

    const s = summaryRes.data;
    setSummary(s?.summary || null);
    setDeadlines(s?.deadlines || []);
    setRecords(s?.records || []);
    setEmployees(empsRes || []);
    setUsers(usersRes?.data?.users || []);
    setAuditLogs(logsRes || []);
    setLoading(false);
  };

  const handleCompute = async () => {
    setComputing(true);
    await base44.functions.invoke('computeCompliance', { month, year });
    await loadData();
    setComputing(false);
  };

  const isHR = user?.role === 'admin' || user?.role === 'hr';
  const fmt = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;

  const overdueDl = deadlines.filter(d => d.daysLeft < 0 && d.status !== 'completed').length;
  const dueSoonDl = deadlines.filter(d => d.daysLeft >= 0 && d.daysLeft <= 7 && d.status !== 'completed').length;

  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  return (
    <div className="min-h-screen bg-gray-50">
      <UnderDevelopmentBanner pageName="Compliance Dashboard" />
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Compliance Dashboard</h1>
            <p className="text-xs text-gray-500">Indian Statutory Compliance — PF, ESI, TDS, PT, LWF, Gratuity & Bonus</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          {isHR && (
            <Button onClick={handleCompute} disabled={computing} className="gap-2 bg-blue-600 hover:bg-blue-700">
              {computing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              {computing ? 'Computing...' : 'Compute'}
            </Button>
          )}
          <Button variant="outline" onClick={loadData} disabled={loading} size="icon">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="p-6 max-w-screen-xl mx-auto space-y-6">

        {/* Alert banner */}
        {(overdueDl > 0 || (summary?.minimum_wage_violations > 0) || (summary?.kyc?.missing > 0)) && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div className="flex flex-wrap gap-4 text-sm text-red-700">
              {overdueDl > 0 && <span className="font-semibold">{overdueDl} overdue filing(s)</span>}
              {summary?.minimum_wage_violations > 0 && <span className="font-semibold">{summary.minimum_wage_violations} minimum wage violation(s)</span>}
              {summary?.kyc?.missing > 0 && <span className="font-semibold">{summary.kyc.missing} employee(s) with incomplete KYC</span>}
            </div>
          </div>
        )}

        {/* Key Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ComplianceStatCard
              title="PF Liability (Total)"
              value={fmt((summary.pf?.total_employee || 0) + (summary.pf?.total_employer || 0))}
              sub={`Pending: ${summary.pf?.pending || 0} employees`}
              icon={IndianRupee}
              color={summary.pf?.pending > 0 ? 'orange' : 'green'}
              status={summary.pf?.pending > 0 ? 'warning' : 'ok'}
            />
            <ComplianceStatCard
              title="ESI Liability (Total)"
              value={fmt((summary.esi?.total_employee || 0) + (summary.esi?.total_employer || 0))}
              sub={`Pending: ${summary.esi?.pending || 0} employees`}
              icon={IndianRupee}
              color={summary.esi?.pending > 0 ? 'orange' : 'teal'}
              status={summary.esi?.pending > 0 ? 'warning' : 'ok'}
            />
            <ComplianceStatCard
              title="TDS Deductions"
              value={fmt(summary.tds?.total)}
              sub={`Pending: ${summary.tds?.pending || 0}`}
              icon={IndianRupee}
              color={summary.tds?.pending > 0 ? 'orange' : 'purple'}
              status={summary.tds?.pending > 0 ? 'warning' : 'ok'}
            />
            <ComplianceStatCard
              title="Min Wage Violations"
              value={summary.minimum_wage_violations || 0}
              sub="Employees below minimum wage"
              icon={AlertTriangle}
              color={summary.minimum_wage_violations > 0 ? 'red' : 'green'}
              status={summary.minimum_wage_violations > 0 ? 'risk' : 'ok'}
            />
            <ComplianceStatCard
              title="Professional Tax"
              value={fmt(summary.pt?.total)}
              sub="Monthly PT Deductions"
              icon={FileText}
              color="blue"
            />
            <ComplianceStatCard
              title="Gratuity Provision"
              value={fmt(summary.gratuity?.total_provision)}
              sub="Monthly gratuity accrual"
              icon={TrendingUp}
              color="teal"
            />
            <ComplianceStatCard
              title="KYC Compliance"
              value={`${summary.kyc?.compliant || 0}/${(summary.kyc?.compliant || 0) + (summary.kyc?.missing || 0)}`}
              sub={`${summary.kyc?.missing || 0} employees with missing KYC`}
              icon={Users}
              color={summary.kyc?.missing > 0 ? 'orange' : 'green'}
              status={summary.kyc?.missing > 0 ? 'warning' : 'ok'}
            />
            <ComplianceStatCard
              title="Records Computed"
              value={summary.records_computed || 0}
              sub={`of ${summary.total_employees || 0} active employees`}
              icon={CheckCircle}
              color={summary.records_computed === summary.total_employees ? 'green' : 'orange'}
              status={summary.records_computed === summary.total_employees ? 'ok' : 'warning'}
            />
          </div>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="bg-white border">
            <TabsTrigger value="overview">Overview & Deadlines</TabsTrigger>
            <TabsTrigger value="records">Employee Records</TabsTrigger>
            <TabsTrigger value="kyc">KYC Compliance</TabsTrigger>
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="bg-white rounded-xl border p-5">
              <DeadlineManager
                deadlines={deadlines}
                onRefresh={loadData}
              />
            </div>

            {/* Summary Table */}
            {summary && (
              <div className="bg-white rounded-xl border p-5 mt-4">
                <h3 className="font-semibold text-gray-800 mb-4">Monthly Statutory Summary — {MONTHS[month - 1]} {year}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Statutory Head</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Employee Contribution</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Employer Contribution</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Due By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-indigo-700">Provident Fund (PF)</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.pf?.total_employee)}</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.pf?.total_employer)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt((summary.pf?.total_employee || 0) + (summary.pf?.total_employer || 0))}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">15th of next month</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-teal-700">ESI</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.esi?.total_employee)}</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.esi?.total_employer)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt((summary.esi?.total_employee || 0) + (summary.esi?.total_employer || 0))}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">15th of next month</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-purple-700">TDS</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.tds?.total)}</td>
                        <td className="px-4 py-3 text-right text-gray-400">—</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(summary.tds?.total)}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">7th of next month</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-pink-700">Professional Tax (PT)</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.pt?.total)}</td>
                        <td className="px-4 py-3 text-right text-gray-400">—</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(summary.pt?.total)}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">Varies by state</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-cyan-700">Labour Welfare Fund (LWF)</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.lwf?.total_employee)}</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.lwf?.total_employer)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt((summary.lwf?.total_employee || 0) + (summary.lwf?.total_employer || 0))}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">June & December</td>
                      </tr>
                      <tr className="hover:bg-gray-50 bg-amber-50">
                        <td className="px-4 py-3 font-medium text-amber-700">Gratuity Provision</td>
                        <td className="px-4 py-3 text-right text-gray-400">—</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.gratuity?.total_provision)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(summary.gratuity?.total_provision)}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">On separation</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-green-700">Bonus</td>
                        <td className="px-4 py-3 text-right text-gray-400">—</td>
                        <td className="px-4 py-3 text-right">{fmt(summary.bonus?.total)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(summary.bonus?.total)}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-500">Before Diwali (Oct)</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-semibold">
                        <td className="px-4 py-3">Total Statutory Liability</td>
                        <td className="px-4 py-3 text-right">
                          {fmt((summary.pf?.total_employee || 0) + (summary.esi?.total_employee || 0) + (summary.tds?.total || 0) + (summary.pt?.total || 0) + (summary.lwf?.total_employee || 0))}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {fmt((summary.pf?.total_employer || 0) + (summary.esi?.total_employer || 0) + (summary.gratuity?.total_provision || 0) + (summary.bonus?.total || 0) + (summary.lwf?.total_employer || 0))}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-700">
                          {fmt(
                            (summary.pf?.total_employee || 0) + (summary.pf?.total_employer || 0) +
                            (summary.esi?.total_employee || 0) + (summary.esi?.total_employer || 0) +
                            (summary.tds?.total || 0) + (summary.pt?.total || 0) +
                            (summary.lwf?.total_employee || 0) + (summary.lwf?.total_employer || 0) +
                            (summary.gratuity?.total_provision || 0) + (summary.bonus?.total || 0)
                          )}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="records" className="mt-4">
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">Employee-wise Compliance Records</h3>
                <span className="text-xs text-gray-400">{records.length} records for {MONTHS[month - 1]} {year}</span>
              </div>
              {records.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Calculator className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No records computed yet</p>
                  <p className="text-sm mt-1">Click "Compute" to generate compliance records for this month</p>
                </div>
              ) : (
                <ComplianceRecordsTable records={records} users={users} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="kyc" className="mt-4">
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-800">KYC & Document Compliance</h3>
                  <p className="text-xs text-gray-500 mt-0.5">PAN, Aadhar, Bank Details, UAN & ESI Number tracking</p>
                </div>
                {summary?.kyc?.missing > 0 && (
                  <span className="bg-red-100 text-red-700 text-xs px-3 py-1 rounded-full font-medium">
                    {summary.kyc.missing} Incomplete Records
                  </span>
                )}
              </div>
              <KYCStatusTable employees={employees} users={users} />
            </div>
          </TabsContent>

          <TabsContent value="insights" className="mt-4">
            <AIInsightsPanel month={month} year={year} />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Compliance Audit Trail</h3>
              <AuditLogTable logs={auditLogs} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}