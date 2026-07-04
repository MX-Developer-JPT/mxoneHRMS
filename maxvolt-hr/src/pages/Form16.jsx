import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MobileSelect from '@/components/MobileSelect';
import {
  Receipt, IndianRupee, Users, FileText, Search, Download, RefreshCw,
  Printer, AlertCircle, CheckCircle2, Zap, Edit2, LayoutGrid
} from 'lucide-react';
import { toast } from 'sonner';
import { openLetterheadPrintWindow } from '../utils/letterhead';

const fmt = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

function fyOptions() {
  const now = new Date();
  const base = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const arr = [];
  for (let i = 0; i < 4; i++) arr.push(`${base - i}-${base - i + 1}`);
  return arr.map(v => ({ value: v, label: `FY ${v}` }));
}

export default function Form16() {
  const [fy, setFy] = useState(fyOptions()[0].value);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [worksheetOpen, setWorksheetOpen] = useState(false);
  const [worksheetHtml, setWorksheetHtml] = useState('');
  const [worksheetLoading, setWorksheetLoading] = useState(false);

  const [integrateOpen, setIntegrateOpen] = useState(false);
  const [intMonth, setIntMonth] = useState(String(new Date().getMonth() + 1));
  const [intYear, setIntYear] = useState(String(new Date().getFullYear()));
  const [integrating, setIntegrating] = useState(false);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overridePayrollId, setOverridePayrollId] = useState('');
  const [overrideTDSAmt, setOverrideTDSAmt] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [overrideRow, setOverrideRow] = useState(null);

  useEffect(() => { load(); }, [fy]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getTDSSummary', { financial_year: fy });
      const d = res.data || res;
      if (d.success) { setSummary(d.summary || {}); setRows(d.employees || []); }
      else toast.error(d.error || 'Failed to load TDS summary');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const openDetail = async (row) => {
    setDetail({ loading: true, row });
    setDetailLoading(true);
    try {
      const res = await base44.functions.invoke('getForm16Data', { user_id: row.user_id, financial_year: fy });
      const d = res.data || res;
      if (d.success) setDetail(d);
      else { toast.error(d.error || 'Failed'); setDetail(null); }
    } catch (e) { toast.error('Error: ' + e.message); setDetail(null); }
    setDetailLoading(false);
  };

  const filtered = rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.name?.toLowerCase().includes(q) || r.employee_code?.toLowerCase().includes(q) || r.pan?.toLowerCase().includes(q);
  });

  const openWorksheet = async (row) => {
    setWorksheetOpen(true);
    setWorksheetHtml('');
    setWorksheetLoading(true);
    try {
      const now = new Date();
      const res = await base44.functions.invoke('getTaxWorksheet', {
        user_id: row.user_id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      });
      const d = res.data || res;
      if (d.success) setWorksheetHtml(d.html);
      else toast.error(d.error || 'Failed to load worksheet');
    } catch (e) { toast.error('Error: ' + e.message); }
    setWorksheetLoading(false);
  };

  const doIntegrate = async () => {
    setIntegrating(true);
    try {
      const res = await base44.functions.invoke('bulkIntegrateTDS', { month: parseInt(intMonth), year: parseInt(intYear) });
      const d = res.data || res;
      if (d.success) { toast.success(`TDS integrated for ${d.updated} / ${d.total} payroll records`); setIntegrateOpen(false); load(); }
      else toast.error(d.error || 'Integration failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setIntegrating(false);
  };

  const doOverride = async () => {
    if (!overridePayrollId || overrideTDSAmt === '') return;
    setOverriding(true);
    try {
      const res = await base44.functions.invoke('overrideTDS', { payroll_id: overridePayrollId, tds_amount: Number(overrideTDSAmt), reason: overrideReason });
      const d = res.data || res;
      if (d.success) { toast.success(`TDS updated: ${fmt(d.old_tds)} → ${fmt(d.new_tds)}`); setOverrideOpen(false); setOverridePayrollId(''); setOverrideTDSAmt(''); setOverrideReason(''); setOverrideRow(null); }
      else toast.error(d.error || 'Override failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setOverriding(false);
  };

  const exportCSV = () => {
    const headers = ['Employee Code', 'Name', 'PAN', 'Department', 'Gross Salary', 'Regime', 'Annual Tax (TDS)', 'Monthly TDS', 'Declared'];
    const lines = filtered.map(r => [r.employee_code, r.name, r.pan, r.department, r.gross_salary, r.regime, r.annual_tax, r.monthly_tds, r.declared ? 'Yes' : 'No']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tds-summary-${fy}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const printForm16 = (d) => {
    const chosen = d.chosen_regime === 'new' ? d.new_regime : d.old_regime;
    const row = (label, val, bold) => `<tr><td style="padding:5px 8px;border:1px solid #ddd;${bold ? 'font-weight:bold;' : ''}">${label}</td><td style="padding:5px 8px;border:1px solid #ddd;text-align:right;${bold ? 'font-weight:bold;' : ''}">${val}</td></tr>`;
    const html = `
    <div style="font-size:12px;color:#1a1a1a;">
      <h2 style="text-align:center;margin:0 0 4px;font-size:16px;">Form No. 16 — Part B</h2>
      <p style="text-align:center;margin:0 0 12px;color:#666;font-size:11px;">Certificate of tax deducted at source on salary · FY ${d.financial_year} (AY ${d.assessment_year})</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px;">
        <tr><td style="padding:4px 8px;"><strong>Employee:</strong> ${d.employee.name}</td><td style="padding:4px 8px;"><strong>PAN:</strong> ${d.employee.pan || '[____]'}</td></tr>
        <tr><td style="padding:4px 8px;"><strong>Designation:</strong> ${d.employee.designation || '-'}</td><td style="padding:4px 8px;"><strong>Emp Code:</strong> ${d.employee.employee_code || '-'}</td></tr>
        <tr><td style="padding:4px 8px;"><strong>Tax Regime:</strong> ${d.chosen_regime === 'new' ? 'New' : 'Old'}</td><td style="padding:4px 8px;"><strong>Department:</strong> ${d.employee.department || '-'}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;">
        ${row('1. Gross Salary', fmt(d.income.gross_salary), true)}
        ${d.chosen_regime === 'old' ? row('2. HRA Exemption u/s 10(13A)', fmt(d.deductions.hra_exemption)) : ''}
        ${row('3. Standard Deduction u/s 16(ia)', fmt(chosen.standard_deduction))}
        ${d.chosen_regime === 'old' ? row('4. Professional Tax u/s 16(iii)', fmt(chosen.professional_tax)) : ''}
        ${d.chosen_regime === 'old' ? row('5. Deductions under Chapter VI-A', fmt(chosen.chapter_via)) : ''}
        ${row('6. Total Taxable Income', fmt(chosen.taxable_income), true)}
        ${row('7. Tax on Total Income', fmt(chosen.tax_before_rebate))}
        ${row('8. Rebate u/s 87A', fmt(chosen.rebate_87a))}
        ${row('9. Surcharge', fmt(chosen.surcharge))}
        ${row('10. Health & Education Cess (4%)', fmt(chosen.cess))}
        ${row('11. Total Tax Payable (TDS)', fmt(chosen.total_tax), true)}
        ${row('12. Average Monthly TDS', fmt(d.monthly_tds))}
      </table>
      ${d.chosen_regime === 'old' ? `<p style="font-size:10px;color:#666;margin-top:8px;">Chapter VI-A: 80C ${fmt(d.deductions.sec80C)} · 80D ${fmt(d.deductions.sec80D)} · 80CCD(1B) ${fmt(d.deductions.sec80CCD1B)} · 80E ${fmt(d.deductions.sec80E)} · 80G ${fmt(d.deductions.sec80G)}</p>` : ''}
      <p style="font-size:10px;color:#888;margin-top:14px;">Computed by Maxvolt HR. This is a system-generated working sheet and not a substitute for the TRACES-generated Form 16 Part A.</p>
    </div>`;
    openLetterheadPrintWindow(`Form 16 - ${d.employee.name} - FY ${d.financial_year}`, html, '', false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-teal-600" /> Form 16 & TDS Engine
          </h1>
          <p className="text-gray-500 text-sm mt-1">Annual income-tax computation (old vs new regime), TDS projection, and Form 16 Part-B — FY {fy}.</p>
        </div>
        <div className="flex gap-2 items-center">
          <MobileSelect value={fy} onValueChange={setFy} label="Financial Year" className="w-36" options={fyOptions()} />
          <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => setIntegrateOpen(true)}>
            <Zap className="w-4 h-4 mr-2" /> Integrate TDS
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}><Download className="w-4 h-4 mr-2" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Users} color="blue" label="Employees" value={summary.employees || 0} />
        <Stat icon={IndianRupee} color="teal" label="Total annual TDS" value={fmt(summary.total_annual_tds)} />
        <Stat icon={IndianRupee} color="indigo" label="Total monthly TDS" value={fmt(summary.total_monthly_tds)} />
        <Stat icon={AlertCircle} color="amber" label="No declaration filed" value={summary.not_declared || 0} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search name, code, PAN…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} employees</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">PAN</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-right">Gross Salary</th>
              <th className="px-4 py-3 text-center">Regime</th>
              <th className="px-4 py-3 text-right">Annual TDS</th>
              <th className="px-4 py-3 text-right">Monthly TDS</th>
              <th className="px-4 py-3 text-center">Worksheet</th>
              <th className="px-4 py-3 text-center">Form 16</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400"><RefreshCw className="w-5 h-5 mx-auto animate-spin" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" /> No employees with a salary structure for this FY.
              </td></tr>
            ) : filtered.map(r => (
              <tr key={r.user_id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800">{r.name}</p>
                  <p className="text-xs text-gray-400">{r.employee_code}</p>
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.pan || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{r.department || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(r.gross_salary)}</td>
                <td className="px-4 py-3 text-center">
                  <Badge className={r.regime === 'new' ? 'bg-teal-100 text-teal-700' : 'bg-indigo-100 text-indigo-700'}>{r.regime === 'new' ? 'New' : 'Old'}</Badge>
                </td>
                <td className="px-4 py-3 text-right font-medium text-teal-700">{fmt(r.annual_tax)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(r.monthly_tds)}</td>
                <td className="px-4 py-3 text-center">
                  <Button size="sm" variant="outline" onClick={() => openWorksheet(r)}>
                    <LayoutGrid className="w-3.5 h-3.5 mr-1" /> WS
                  </Button>
                </td>
                <td className="px-4 py-3 text-center">
                  <Button size="sm" variant="outline" onClick={() => openDetail(r)}>
                    <FileText className="w-3.5 h-3.5 mr-1" /> View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Worksheet dialog */}
      <Dialog open={worksheetOpen} onOpenChange={() => setWorksheetOpen(false)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-teal-600" /> Income Tax Worksheet
              {worksheetHtml && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => { const w = window.open('','_blank'); w.document.write(worksheetHtml); w.document.close(); setTimeout(()=>w.print(),500); }}>
                  <Printer className="w-4 h-4 mr-1" /> Print
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {worksheetLoading ? (
            <div className="py-12 text-center text-gray-400"><RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" /> Loading…</div>
          ) : worksheetHtml ? (
            <div className="flex-1 overflow-auto">
              <iframe srcDoc={worksheetHtml} style={{ width: '100%', minHeight: '520px', border: 'none' }} title="Tax Worksheet" />
            </div>
          ) : (
            <div className="py-8 text-center text-gray-400">No worksheet data</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Integrate TDS dialog */}
      <Dialog open={integrateOpen} onOpenChange={() => setIntegrateOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-teal-600" /> Integrate TDS to Payroll</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">This will compute and write TDS into all processed payroll records for the selected month. Existing TDS values will be updated.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Month</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1" value={intMonth} onChange={e => setIntMonth(e.target.value)}>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                    <option key={i} value={String(i+1)}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Year</Label>
                <Input type="number" className="mt-1 h-8 text-sm" value={intYear} onChange={e => setIntYear(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setIntegrateOpen(false)}>Cancel</Button>
              <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white" onClick={doIntegrate} disabled={integrating}>
                {integrating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                {integrating ? 'Integrating…' : 'Integrate Now'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Override TDS dialog */}
      <Dialog open={overrideOpen} onOpenChange={() => setOverrideOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Edit2 className="w-5 h-5 text-amber-600" /> Override TDS Amount</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">Enter the Payroll record ID and the corrected TDS amount. An audit trail will be saved.</p>
            <div>
              <Label className="text-xs text-gray-500">Payroll Record ID</Label>
              <Input className="mt-1 h-8 text-sm font-mono" placeholder="payroll entity id" value={overridePayrollId} onChange={e => setOverridePayrollId(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-gray-500">New TDS Amount (₹)</Label>
              <Input type="number" className="mt-1 h-8 text-sm" placeholder="0" value={overrideTDSAmt} onChange={e => setOverrideTDSAmt(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Reason</Label>
              <Input className="mt-1 h-8 text-sm" placeholder="e.g. Previous employer TDS adjustment" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setOverrideOpen(false)}>Cancel</Button>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={doOverride} disabled={overriding || !overridePayrollId || overrideTDSAmt === ''}>
                {overriding ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Edit2 className="w-4 h-4 mr-2" />}
                {overriding ? 'Saving…' : 'Override'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-teal-600" /> Form 16 — {detail?.employee?.name || detail?.row?.name}</DialogTitle>
          </DialogHeader>
          {detailLoading || detail?.loading ? (
            <div className="py-12 text-center text-gray-400"><RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" /> Computing…</div>
          ) : detail?.income ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">PAN: {detail.employee.pan || '[not on file]'}</Badge>
                <Badge variant="outline">AY {detail.assessment_year}</Badge>
                <Badge className={detail.chosen_regime === 'new' ? 'bg-teal-100 text-teal-700' : 'bg-indigo-100 text-indigo-700'}>
                  {detail.chosen_regime === 'new' ? 'New' : 'Old'} regime {detail.chosen_regime === detail.recommended_regime ? '(recommended)' : ''}
                </Badge>
                <Badge className={detail.declaration_status === 'approved' ? 'bg-green-100 text-green-700' : detail.declaration_status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}>
                  Declaration: {detail.declaration_status}
                </Badge>
              </div>

              {/* Regime comparison */}
              <div className="grid grid-cols-2 gap-3">
                <RegimeCard title="Old Regime" calc={detail.old_regime} active={detail.chosen_regime === 'old'} recommended={detail.recommended_regime === 'old'} />
                <RegimeCard title="New Regime" calc={detail.new_regime} active={detail.chosen_regime === 'new'} recommended={detail.recommended_regime === 'new'} />
              </div>

              {/* Income + deductions */}
              <div className="border rounded-lg divide-y">
                <Line label="Gross Salary" value={fmt(detail.income.gross_salary)} bold />
                <Line label="HRA Exemption (old regime)" value={fmt(detail.deductions.hra_exemption)} />
                <Line label="80C" value={fmt(detail.deductions.sec80C)} />
                <Line label="80D (Health)" value={fmt(detail.deductions.sec80D)} />
                <Line label="80CCD(1B) NPS" value={fmt(detail.deductions.sec80CCD1B)} />
                <Line label="80E (Edu loan)" value={fmt(detail.deductions.sec80E)} />
                <Line label="80G (Donations)" value={fmt(detail.deductions.sec80G)} />
                <Line label="Chapter VI-A total" value={fmt(detail.deductions.chapter_via_total)} />
                <Line label="Annual Tax Payable (TDS)" value={fmt(detail.annual_tax)} bold highlight />
                <Line label="Average Monthly TDS" value={fmt(detail.monthly_tds)} />
              </div>

              <div className="flex justify-end gap-2 flex-wrap">
                <Button variant="outline" onClick={() => { setOverrideRow(detail?.row || null); setOverrideOpen(true); }}>
                  <Edit2 className="w-4 h-4 mr-2" /> Override TDS
                </Button>
                <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
                <Button onClick={() => printForm16(detail)} className="bg-teal-600 hover:bg-teal-700 text-white">
                  <Printer className="w-4 h-4 mr-2" /> Print Form 16 Part-B
                </Button>
              </div>
              <p className="text-xs text-gray-400">Computation uses FY 2025-26 slabs. Verify against TRACES before issuing the official certificate.</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon: Icon, color, label, value }) {
  const colors = { blue: 'bg-blue-100 text-blue-600', teal: 'bg-teal-100 text-teal-600', indigo: 'bg-indigo-100 text-indigo-600', amber: 'bg-amber-100 text-amber-600' };
  return (
    <Card><CardContent className="pt-5 flex items-center gap-4">
      <div className={`p-3 rounded-full ${colors[color]}`}><Icon className="w-6 h-6" /></div>
      <div className="min-w-0"><p className="text-sm text-gray-500">{label}</p><p className="text-xl font-bold text-gray-800 truncate">{value}</p></div>
    </CardContent></Card>
  );
}

function RegimeCard({ title, calc, active, recommended }) {
  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-teal-400 bg-teal-50' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-gray-700">{title}</p>
        {recommended && <CheckCircle2 className="w-4 h-4 text-green-500" />}
      </div>
      <p className="text-xs text-gray-500">Taxable: {fmt(calc.taxable_income)}</p>
      <p className="text-lg font-bold text-gray-800">{fmt(calc.total_tax)}</p>
    </div>
  );
}

function Line({ label, value, bold, highlight }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${highlight ? 'bg-teal-50' : ''}`}>
      <span className={`${bold ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{label}</span>
      <span className={`${bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{value}</span>
    </div>
  );
}
