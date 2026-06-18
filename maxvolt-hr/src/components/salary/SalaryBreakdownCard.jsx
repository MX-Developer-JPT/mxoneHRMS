import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Building, Printer } from 'lucide-react';

const fmt = (val) => (val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

function Row({ label, monthly, annual, highlight }) {
  return (
    <tr className={highlight ? 'font-bold bg-gray-50' : ''}>
      <td className="py-2 px-3 text-sm">{label}</td>
      <td className="py-2 px-3 text-sm text-right">₹{fmt(monthly)}</td>
      <td className="py-2 px-3 text-sm text-right">₹{fmt(annual)}</td>
    </tr>
  );
}

function SectionHeader({ label, color }) {
  return (
    <tr>
      <td colSpan={3} className={`py-2 px-3 text-xs font-bold uppercase tracking-wider text-white ${color}`}>{label}</td>
    </tr>
  );
}

export default function SalaryBreakdownCard({ structure, employee, onPrint }) {
  const [view, setView] = useState('monthly');

  if (!structure) return null;

  const m = (annual) => annual / 12;
  const basic = structure.basic_salary || 0;
  const hra = structure.hra || 0;
  const conveyance = structure.conveyance || 0;
  const bonus = structure.performance_bonus || 0;

  const grossMonthly = basic + hra + conveyance;

  const employeePF = structure.pf_contribution || 0;
  const employeeESI = structure.esi_contribution || 0;
  const otherDed = typeof structure.deductions === 'object' && structure.deductions
    ? Object.values(structure.deductions).reduce((s, v) => s + (parseFloat(v) || 0), 0)
    : 0;
  const totalDeductions = employeePF + employeeESI + otherDed;
  const netMonthly = grossMonthly - totalDeductions;

  const employerPF = structure.employer_pf_contribution || 0;
  const employerESI = structure.employer_esi_contribution || 0;
  const gratuity = structure.gratuity || 0;

  const mult = view === 'monthly' ? 1 : 12;
  const base = view === 'monthly';

  const otherAllowances = structure.other_allowances
    ? Object.entries(structure.other_allowances).filter(([, v]) => v?.enabled)
    : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            Salary Structure
            <Badge className="bg-green-100 text-green-800 ml-1">Active</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex border rounded-md overflow-hidden text-xs">
              <button
                className={`px-3 py-1.5 ${view === 'monthly' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                onClick={() => setView('monthly')}
              >Monthly</button>
              <button
                className={`px-3 py-1.5 ${view === 'annual' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                onClick={() => setView('annual')}
              >Annual</button>
            </div>
            {onPrint && (
              <Button size="sm" variant="outline" onClick={onPrint}>
                <Printer className="w-3 h-3 mr-1" /> Print
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Annual CTC: <strong>₹{(structure.ctc || 0).toLocaleString('en-IN')}</strong>
          {structure.effective_from && ` · Effective: ${new Date(structure.effective_from).toLocaleDateString('en-IN')}`}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide">Component</th>
                <th className="py-2 px-3 text-right text-xs font-semibold uppercase tracking-wide">Monthly (₹)</th>
                <th className="py-2 px-3 text-right text-xs font-semibold uppercase tracking-wide">Annual (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <SectionHeader label="Earnings" color="bg-green-600" />
              <Row label="Basic Salary (50% of CTC)" monthly={basic} annual={basic * 12} />
              <Row label="House Rent Allowance — HRA (40% of Basic)" monthly={hra} annual={hra * 12} />
              <Row label="Conveyance Allowance (Balance)" monthly={conveyance} annual={conveyance * 12} />
              <Row label="Gross Salary" monthly={grossMonthly} annual={grossMonthly * 12} highlight />

              {bonus > 0 && <>
                <SectionHeader label="Variable Pay / Bonus" color="bg-yellow-500" />
                <Row label="Performance Bonus / VPP" monthly={bonus} annual={bonus * 12} />
              </>}

              <SectionHeader label="Employee Deductions" color="bg-red-500" />
              <Row label="PF (Employee Contribution - 12%)" monthly={employeePF} annual={employeePF * 12} />
              {employeeESI > 0 && <Row label="ESI (Employee - 0.75%)" monthly={employeeESI} annual={employeeESI * 12} />}
              <Row label="Total Deductions" monthly={totalDeductions} annual={totalDeductions * 12} highlight />

              <SectionHeader label="Employer Contributions" color="bg-blue-500" />
              <Row label="PF (Employer Contribution - 13%)" monthly={employerPF} annual={employerPF * 12} />
              {employerESI > 0 && <Row label="ESI (Employer - 3.25%)" monthly={employerESI} annual={employerESI * 12} />}
              {gratuity > 0 && <Row label="Gratuity (4.81% of Basic)" monthly={gratuity} annual={gratuity * 12} />}
            </tbody>
            <tfoot>
              <tr className="bg-green-50 font-bold text-green-800 border-t-2 border-green-200">
                <td className="py-3 px-3 text-sm">Net Take-Home Salary</td>
                <td className="py-3 px-3 text-sm text-right">₹{fmt(netMonthly)}</td>
                <td className="py-3 px-3 text-sm text-right">₹{fmt(netMonthly * 12)}</td>
              </tr>
              <tr className="bg-blue-50 font-bold text-blue-900 border-t border-blue-200">
                <td className="py-3 px-3 text-sm">Total CTC</td>
                <td className="py-3 px-3 text-sm text-right">₹{fmt((structure.ctc || 0) / 12)}</td>
                <td className="py-3 px-3 text-sm text-right">₹{fmt(structure.ctc || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}