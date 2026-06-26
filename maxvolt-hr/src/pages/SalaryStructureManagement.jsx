import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Users, Plus, Edit, Printer, Search, TrendingUp, Building, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { openLetterheadPrintWindow } from '../utils/letterhead';
import SalaryBreakdownCard from '../components/salary/SalaryBreakdownCard';

// Defaults — overridden by PayrollConfiguration loaded from DB
let PF_CEILING = 15000;
let ESI_CEILING_MONTHLY = 21000;

const fmt = (val) => (val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

// Bonus/VPP calculation as per policy
function calcBonus(annualCTC, basicAnnual) {
  if (annualCTC <= 1000000) {
    return { amount: Math.round(basicAnnual * 0.0833 / 12), type: 'Bonus (8.33% of Basic)' };
  }
  let vppPct = 0;
  if (annualCTC <= 1500000) vppPct = 0.05;
  else if (annualCTC <= 2000000) vppPct = 0.08;
  else if (annualCTC <= 2500000) vppPct = 0.12;
  else if (annualCTC <= 3000000) vppPct = 0.15;
  else vppPct = 0.15;
  const slab = annualCTC <= 1500000 ? '10-15L' : annualCTC <= 2000000 ? '15-20L' : annualCTC <= 2500000 ? '20-25L' : '25-30L';
  return { amount: Math.round(annualCTC * vppPct / 12), type: `VPP (${Math.round(vppPct * 100)}% of CTC – ${slab} slab)` };
}

// Salary structure:
// Earnings: Basic (50% of CTC), HRA (40% of Basic), Conveyance (balance to complete gross)
// Gross = CTC - employer contributions
// PF: employee 12% on min(basic, ₹15,000) — ALL employees including ESI
// ESI: employee 0.75% on basic — only when basic ≤ ₹21,000
// Employer: PF 13%, ESI 3.25%, Medical (0 if not configured), Bonus/VPP
function calcStructure(annualCTC, medicalContribution = 0) {
  if (!annualCTC || annualCTC <= 0) return null;

  const basicAnnual = annualCTC * 0.5;
  const hraAnnual = basicAnnual * 0.4;
  const basicM = basicAnnual / 12;

  const bonus = calcBonus(annualCTC, basicAnnual);
  const bonusAnnual = bonus.amount * 12;

  // PF: 12% on min(basic, ₹15,000) — applicable to ALL employees
  const pfBase = Math.min(basicM, PF_CEILING);
  const employeePF = Math.round(pfBase * 0.12);
  const employerPF = Math.round(pfBase * 0.13);

  // ESI: on basic salary, only when basic ≤ ESI ceiling
  const isESIApplicable = basicM <= ESI_CEILING_MONTHLY;
  const employeeESI = isESIApplicable ? Math.round(basicM * 0.0075) : 0;
  const employerESI = isESIApplicable ? Math.round(basicM * 0.0325) : 0;

  const medContribM = medicalContribution;
  const totalContribAnnual = (employerPF * 12) + (employerESI * 12) + bonusAnnual + (medContribM * 12);
  const grossAnnual = annualCTC - totalContribAnnual;
  const grossM = grossAnnual / 12;

  // Conveyance = balance (Gross - Basic - HRA)
  const conveyanceM = Math.max(grossM - basicM - (hraAnnual / 12), 0);

  const gratuity = Math.round(basicM * 0.0481);
  const totalDeductions = employeePF + employeeESI;
  const netMonthly = grossM - totalDeductions;

  return {
    basic_salary: basicM,
    hra: hraAnnual / 12,
    conveyance: conveyanceM,
    lta: 0,
    special_allowance: 0,
    performance_bonus: bonus.amount,
    bonusVPPType: bonus.type,
    grossMonthly: grossM,
    pf_contribution: employeePF,
    employer_pf_contribution: employerPF,
    esi_contribution: employeeESI,
    employer_esi_contribution: employerESI,
    medical_contribution: medContribM,
    gratuity,
    totalDeductions,
    netMonthly,
    annualCTC,
    isESIApplicable,
  };
}

function ComponentField({ label, hint, value, onChange, prefix = '₹' }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{prefix}</span>
        <Input
          type="number"
          className="pl-7"
          value={value || ''}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
        />
      </div>
    </div>
  );
}

function printSalaryStructure(structure, emp) {
  const basicM = structure.basic_salary || 0;
  const hraM = structure.hra || 0;
  const convM = structure.conveyance || 0;
  const grossM = basicM + hraM + convM;
  const pfM = structure.pf_contribution || 0;
  const esiM = structure.esi_contribution || 0;
  const totalDed = pfM + esiM;
  const netM = grossM - totalDed;

  const L = (v) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const row = (label, monthly, annual) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0e0d0;font-size:11px;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #f0e0d0;text-align:right;font-size:11px;">${L(annual)}</td><td style="padding:6px 10px;border-bottom:1px solid #f0e0d0;text-align:right;font-size:11px;">${L(monthly)}</td></tr>`;

  const sectionRow = (label, color) =>
    `<tr><td colspan="3" style="background:${color};color:white;padding:5px 10px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">${label}</td></tr>`;

  const contentHtml = `
    <div style="margin-bottom:8px;">
      <div style="text-align:center;font-size:17px;font-weight:bold;text-decoration:underline;text-underline-offset:4px;color:#1a1a1a;margin:4px 0 12px;">SALARY STRUCTURE</div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px;">
        <tr>
          <td style="padding:4px 6px;width:150px;"><b>Employee Name:</b></td><td style="padding:4px 6px;">${emp?.display_name || emp?.user?.full_name || 'N/A'}</td>
          <td style="padding:4px 6px;width:150px;"><b>Employee Code:</b></td><td style="padding:4px 6px;">${emp?.employee_code || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding:4px 6px;"><b>Designation:</b></td><td style="padding:4px 6px;">${emp?.designation || 'N/A'}</td>
          <td style="padding:4px 6px;"><b>Department:</b></td><td style="padding:4px 6px;">${emp?.department || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding:4px 6px;"><b>Date of Joining:</b></td><td style="padding:4px 6px;">${emp?.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en-IN') : 'N/A'}</td>
          <td style="padding:4px 6px;"><b>Effective From:</b></td><td style="padding:4px 6px;">${new Date(structure.effective_from).toLocaleDateString('en-IN')}</td>
        </tr>
        <tr>
          <td style="padding:4px 6px;"><b>Annual CTC:</b></td>
          <td colspan="3" style="padding:4px 6px;"><b style="color:#e87722;font-size:13px;">&#8377;${(structure.ctc || 0).toLocaleString('en-IN')}</b></td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;border:1px solid #ccc;">
        <thead>
          <tr style="background:#d9d9d9;">
            <th style="padding:6px 10px;text-align:left;font-size:11px;border:1px solid #ccc;">Salary Head</th>
            <th style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">Annually</th>
            <th style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">Monthly</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="3" style="padding:5px 10px;font-size:11px;font-weight:bold;text-decoration:underline;border:1px solid #ccc;">Earnings</td></tr>
          ${row('Basic (50% of CTC)', basicM, basicM * 12)}
          ${row('HRA (40% of Basic)', hraM, hraM * 12)}
          ${row('Conveyance Allowance (Balance)', convM, convM * 12)}
          <tr style="background:#d9d9d9;font-weight:bold;">
            <td style="padding:6px 10px;font-size:11px;border:1px solid #ccc;">Total Gross Salary (A)</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(grossM * 12)}</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(grossM)}</td>
          </tr>
          <tr><td colspan="3" style="padding:5px 10px;font-size:11px;font-weight:bold;text-decoration:underline;border:1px solid #ccc;">Deduction</td></tr>
          ${row('PF Employee Contribution (12% on Basic, max ₹15,000)', pfM, pfM * 12)}
          ${esiM > 0 ? row('ESI Employee Contribution (0.75% on Basic)', esiM, esiM * 12) : ''}
          <tr style="background:#d9d9d9;font-weight:bold;">
            <td style="padding:6px 10px;font-size:11px;border:1px solid #ccc;">Total Deduction (B)</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(totalDed * 12)}</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(totalDed)}</td>
          </tr>
          <tr style="background:#d9d9d9;font-weight:bold;">
            <td style="padding:6px 10px;font-size:11px;border:1px solid #ccc;">Total Net Salary (A-B)</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(netM * 12)}</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(netM)}</td>
          </tr>
          <tr><td colspan="3" style="padding:5px 10px;font-size:11px;font-weight:bold;text-decoration:underline;border:1px solid #ccc;">Contribution</td></tr>
          ${row('PF Employer Contribution', structure.employer_pf_contribution || 0, (structure.employer_pf_contribution || 0) * 12)}
          ${(structure.employer_esi_contribution || 0) > 0 ? row('ESI Employer Contribution (3.25% on Basic)', structure.employer_esi_contribution, structure.employer_esi_contribution * 12) : ''}
          ${(structure.medical_contribution || 0) > 0 ? row('Medical Contribution', structure.medical_contribution, structure.medical_contribution * 12) : ''}
          ${row('Bonus / VPP', structure.performance_bonus || 0, (structure.performance_bonus || 0) * 12)}
          <tr style="background:#d9d9d9;font-weight:bold;">
            <td style="padding:6px 10px;font-size:11px;border:1px solid #ccc;">Total Contribution (C)</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L(((structure.employer_pf_contribution||0)+(structure.employer_esi_contribution||0)+(structure.medical_contribution||0)+(structure.performance_bonus||0))*12)}</td>
            <td style="padding:6px 10px;text-align:right;font-size:11px;border:1px solid #ccc;">${L((structure.employer_pf_contribution||0)+(structure.employer_esi_contribution||0)+(structure.medical_contribution||0)+(structure.performance_bonus||0))}</td>
          </tr>
          <tr style="background:#d9d9d9;font-weight:bold;">
            <td style="padding:6px 10px;font-size:12px;border:1px solid #ccc;">Annually CTC (A+C)</td>
            <td style="padding:6px 10px;text-align:right;font-size:12px;border:1px solid #ccc;color:#1d4ed8;">${L(structure.ctc || 0)}</td>
            <td style="padding:6px 10px;text-align:right;font-size:12px;border:1px solid #ccc;color:#1d4ed8;">${L((structure.ctc || 0) / 12)}</td>
          </tr>
        </tbody>
      </table>

      <p style="font-size:9px;color:#888;margin-top:8px;"><b>Note:</b> This salary structure is subject to statutory deductions and applicable tax regulations.</p>

      <div style="margin-top:44px;display:flex;justify-content:space-between;font-size:10px;">
        <div style="text-align:center;">
          <div style="margin-bottom:22px;">_________________________</div>
          <b>HR Manager</b><br>Maxvolt Energy Industries Limited
        </div>
        <div style="text-align:center;">
          <div style="margin-bottom:22px;">_________________________</div>
          <b>Employee Signature</b><br>${emp?.display_name || emp?.user?.full_name || ''}
        </div>
      </div>
    </div>
  `;

  openLetterheadPrintWindow(`Salary Structure - ${emp?.display_name || emp?.user?.full_name || ''}`, contentHtml);
}

export default function SalaryStructureManagement() {
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingStructure, setEditingStructure] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');

  // Form state
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [revisionReason, setRevisionReason] = useState('');
  const [ctc, setCtc] = useState('');
  const [reimbursements, setReimbursements] = useState({});
  const [computed, setComputed] = useState(null);

  const [medicalContrib, setMedicalContrib] = useState(0);

  // Manual overrides (monthly values)
  const [overrides, setOverrides] = useState({
    basic_salary: '', hra: '', conveyance: '', performance_bonus: '',
    pf_contribution: '', esi_contribution: '',
    employer_pf_contribution: '', employer_esi_contribution: '', gratuity: ''
  });
  const [gratuityEligible, setGratuityEligible] = useState(true);
  const [useOverrides, setUseOverrides] = useState(false);

  // Expanded view
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (ctc && !useOverrides) {
      setComputed(calcStructure(parseFloat(ctc), medicalContrib));
    }
  }, [ctc, useOverrides, medicalContrib]);

  const loadData = async () => {
    try {
      const [structures, empRecords, users, configs, deptRecords] = await Promise.all([
        base44.entities.SalaryStructure.filter({ status: 'active' }, '-effective_from'),
        base44.entities.Employee.list(),
        base44.entities.User.list(),
        base44.entities.PayrollConfiguration.list(),
        base44.entities.Department.list(),
      ]);
      // Apply payroll config settings to calc constants
      if (configs.length > 0) {
        const cfg = configs[0];
        PF_CEILING = cfg.pf_ceiling || 15000;
        ESI_CEILING_MONTHLY = cfg.esi_wage_ceiling || 21000;
      }
      const enriched = empRecords.map(e => ({ ...e, user: users.find(u => u.id === e.user_id) }));
      setSalaryStructures(structures);
      setEmployees(enriched);
      setDepartments(deptRecords);
    } catch (error) {
      console.error('Error loading:', error);
    }
    setLoading(false);
  };

  const getEffectiveValues = () => {
    if (useOverrides) {
      const ovr = (key) => parseFloat(overrides[key]) || 0;
      const basic = ovr('basic_salary');
      const hra = ovr('hra');
      const conveyance = ovr('conveyance');
      const grossM = basic + hra + conveyance;
      // PF: all employees; ESI: only when basic ≤ ESI ceiling, calculated on basic
      const pfBase = Math.min(basic, PF_CEILING);
      const isESIApplicable = basic <= ESI_CEILING_MONTHLY;
      return {
        basic_salary: basic,
        hra, conveyance, lta: 0, special_allowance: 0,
        performance_bonus: ovr('performance_bonus'),
        pf_contribution: ovr('pf_contribution') || Math.round(pfBase * 0.12),
        employer_pf_contribution: ovr('employer_pf_contribution') || Math.round(pfBase * 0.13),
        esi_contribution: ovr('esi_contribution') || (isESIApplicable ? Math.round(basic * 0.0075) : 0),
        employer_esi_contribution: ovr('employer_esi_contribution') || (isESIApplicable ? Math.round(basic * 0.0325) : 0),
        gratuity: ovr('gratuity') || Math.round(basic * 0.0481),
        medical_contribution: medicalContrib,
        grossMonthly: grossM,
        isESIApplicable,
        annualCTC: parseFloat(ctc) || grossM * 12
      };
    }
    return computed;
  };

  const handleOpenCreate = () => {
    setEditingStructure(null);
    setSelectedEmployee('');
    setEffectiveFrom(new Date().toISOString().split('T')[0]);
    setRevisionReason('');
    setCtc('');
    setReimbursements({});
    setComputed(null);
    setUseOverrides(false);
    setGratuityEligible(true);
    setMedicalContrib(0);
    setOverrides({ basic_salary: '', hra: '', conveyance: '', performance_bonus: '', pf_contribution: '', esi_contribution: '', employer_pf_contribution: '', employer_esi_contribution: '', gratuity: '' });
    setShowDialog(true);
  };

  const handleEdit = (structure) => {
    const emp = employees.find(e => e.user_id === structure.user_id);
    setEditingStructure(structure);
    setSelectedEmployee(structure.user_id);
    setEffectiveFrom(new Date().toISOString().split('T')[0]);
    setRevisionReason('');
    setCtc(structure.ctc?.toString() || '');
    setReimbursements(structure.other_allowances || {});
    setGratuityEligible(structure.gratuity_eligible !== false);
    setMedicalContrib(structure.medical_contribution ?? 0);
    setUseOverrides(true);
    setOverrides({
      basic_salary: structure.basic_salary || '',
      hra: structure.hra || '',
      conveyance: structure.conveyance || '',
      performance_bonus: structure.performance_bonus || '',
      pf_contribution: structure.pf_contribution || '',
      esi_contribution: structure.esi_contribution || '',
      employer_pf_contribution: structure.employer_pf_contribution || '',
      employer_esi_contribution: structure.employer_esi_contribution || '',
      gratuity: structure.gratuity || ''
    });
    setComputed(null);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!selectedEmployee || !ctc) { toast.error('Please select an employee and enter CTC'); return; }
    const vals = getEffectiveValues();
    if (!vals) { toast.error('Please calculate or enter salary components'); return; }

    try {
      const user = await base44.auth.me();

      // Mark existing structures as inactive
      if (editingStructure) {
        await base44.entities.SalaryStructure.update(editingStructure.id, { status: 'inactive', effective_to: new Date().toISOString().split('T')[0] });
      } else {
        const existing = salaryStructures.filter(s => s.user_id === selectedEmployee);
        for (const s of existing) {
          await base44.entities.SalaryStructure.update(s.id, { status: 'inactive', effective_to: effectiveFrom });
        }
      }

      await base44.entities.SalaryStructure.create({
        user_id: selectedEmployee,
        effective_from: effectiveFrom,
        ctc: parseFloat(ctc),
        basic_salary: vals.basic_salary,
        hra: vals.hra,
        conveyance: vals.conveyance,
        lta: 0,
        special_allowance: 0,
        performance_bonus: vals.performance_bonus,
        pf_contribution: vals.pf_contribution,
        employer_pf_contribution: vals.employer_pf_contribution,
        esi_contribution: vals.esi_contribution,
        employer_esi_contribution: vals.employer_esi_contribution,
        gratuity: gratuityEligible ? vals.gratuity : 0,
        gratuity_eligible: gratuityEligible,
        medical_contribution: vals.medical_contribution ?? 0,
        status: 'active',
        approved_by: user.id,
        revision_reason: revisionReason || (editingStructure ? 'Salary revision' : 'Initial setup')
      });

      toast.success(editingStructure ? 'Salary structure revised successfully' : 'Salary structure created successfully');
      setShowDialog(false);
      loadData();
    } catch (error) {
      toast.error('Error saving salary structure');
    }
  };

  const totalCTC = salaryStructures.reduce((s, st) => s + (st.ctc || 0), 0);

  const filteredStructures = salaryStructures.filter(s => {
    const emp = employees.find(e => e.user_id === s.user_id);
    const name = (emp?.display_name || emp?.user?.full_name || '').toLowerCase();
    const dept = emp?.department || '';
    const code = emp?.employee_code?.toLowerCase() || '';
    const q = search.toLowerCase();
    const matchSearch = !search || name.includes(q) || code.includes(q) || dept.toLowerCase().includes(q);
    const matchDept = filterDept === 'all' || dept === filterDept;
    return matchSearch && matchDept;
  });

  const vals = getEffectiveValues();

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold">Salary Structure Management</h1>
            <p className="text-gray-600 mt-1">CTC-based salary structures with auto-calculated components</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" /> Create Salary Structure
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-full"><DollarSign className="w-5 h-5 text-blue-600" /></div>
            <div><p className="text-xs text-gray-500">Total Annual CTC</p><p className="text-lg font-bold text-blue-600">₹{(totalCTC / 100000).toFixed(1)}L</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-full"><Users className="w-5 h-5 text-green-600" /></div>
            <div><p className="text-xs text-gray-500">Employees Covered</p><p className="text-lg font-bold text-green-600">{salaryStructures.length}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-full"><TrendingUp className="w-5 h-5 text-purple-600" /></div>
            <div><p className="text-xs text-gray-500">Avg Monthly CTC</p><p className="text-lg font-bold text-purple-600">₹{salaryStructures.length ? Math.round(totalCTC / salaryStructures.length / 12).toLocaleString('en-IN') : 0}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="p-3 bg-orange-100 rounded-full"><Building className="w-5 h-5 text-orange-600" /></div>
            <div><p className="text-xs text-gray-500">Departments</p><p className="text-lg font-bold text-orange-600">{departments.length}</p></div>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-10" placeholder="Search by name, code, department..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Structures List */}
        <Card>
          <CardHeader><CardTitle>Active Salary Structures ({filteredStructures.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredStructures.map(structure => {
                const emp = employees.find(e => e.user_id === structure.user_id);
                const isExpanded = expandedId === structure.id;
                const basicM = structure.basic_salary || 0;
                const hraM = structure.hra || 0;
                const convM = structure.conveyance || 0;
                const medM = structure.medical || 0;
                const ltaM = structure.lta || 0;
                const saM = structure.special_allowance || 0;
                const grossM = basicM + hraM + convM + medM + ltaM + saM;
                const pfM = structure.pf_contribution || 0;
                const esiM = structure.esi_contribution || 0;
                const netM = grossM - pfM - esiM;

                return (
                  <div key={structure.id} className="border rounded-xl overflow-hidden">
                    <div className="flex flex-wrap justify-between items-start gap-4 p-4 bg-white hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-700 font-bold text-lg">{(emp?.display_name || emp?.user?.full_name)?.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-lg">{emp?.display_name || emp?.user?.full_name}</p>
                          <p className="text-sm text-gray-500">{emp?.designation} · {emp?.department} · {emp?.employee_code}</p>
                          <p className="text-xs text-gray-400">Effective: {new Date(structure.effective_from).toLocaleDateString('en-IN')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-right">
                          <p className="text-2xl font-bold text-blue-600">₹{(structure.ctc || 0).toLocaleString('en-IN')}</p>
                          <p className="text-xs text-gray-500">Annual CTC</p>
                          <p className="text-sm font-semibold text-green-600">Net: ₹{netM.toLocaleString('en-IN')}/mo</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleEdit(structure)}>
                            <Edit className="w-3 h-3 mr-1" /> Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => printSalaryStructure(structure, emp)}>
                            <Printer className="w-3 h-3 mr-1" /> Print
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setExpandedId(isExpanded ? null : structure.id)}>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Quick breakdown row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-200">
                      {[
                        { label: 'Basic', val: basicM },
                        { label: 'HRA', val: hraM },
                        { label: 'Conveyance', val: convM },
                        { label: 'Gross/mo', val: grossM, highlight: true }
                        ].map(({ label, val, highlight }) => (
                        <div key={label} className={`p-2 text-center text-sm ${highlight ? 'bg-blue-50' : 'bg-white'}`}>
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className={`font-semibold ${highlight ? 'text-blue-700' : ''}`}>₹{Math.round(val).toLocaleString('en-IN')}</p>
                        </div>
                      ))}
                    </div>

                    {isExpanded && (
                      <div className="p-4 bg-gray-50 border-t">
                        <SalaryBreakdownCard
                          structure={structure}
                          employee={emp}
                          onPrint={() => printSalaryStructure(structure, emp)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredStructures.length === 0 && (
                <p className="text-center text-gray-400 py-10">No salary structures found</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={open => { if (!open) setShowDialog(false); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingStructure ? 'Revise Salary Structure' : 'Create Salary Structure'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Employee & Meta */}
            <div className="grid md:grid-cols-3 gap-4 p-4 bg-blue-50 rounded-lg">
              <div>
                <Label>Employee *</Label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee} disabled={!!editingStructure}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.filter(e => e.status === 'active').map(emp => (
                      <SelectItem key={emp.user_id} value={emp.user_id}>
                        {emp.display_name || emp.user?.full_name} ({emp.employee_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Effective From *</Label>
                <Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
              <div>
                <Label>Annual CTC (₹) *</Label>
                <Input type="number" placeholder="e.g. 600000" value={ctc} onChange={e => setCtc(e.target.value)} className="font-semibold" />
              </div>
              {editingStructure && (
                <div className="md:col-span-3">
                  <Label>Reason for Revision</Label>
                  <Input value={revisionReason} onChange={e => setRevisionReason(e.target.value)} placeholder="e.g. Annual increment, promotion..." />
                </div>
              )}
              {selectedEmployee && (() => {
                const emp = employees.find(e => e.user_id === selectedEmployee);
                return emp ? (
                  <div className="md:col-span-3 grid grid-cols-3 gap-2 text-sm">
                    <div><span className="text-gray-500">Designation:</span> <strong>{emp.designation}</strong></div>
                    <div><span className="text-gray-500">Department:</span> <strong>{emp.department}</strong></div>
                    <div><span className="text-gray-500">DOJ:</span> <strong>{emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en-IN') : 'N/A'}</strong></div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Gratuity toggle */}
            {ctc && (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <Switch checked={gratuityEligible} onCheckedChange={setGratuityEligible} />
                <div>
                  <p className="text-sm font-medium">Gratuity Eligible</p>
                  <p className="text-xs text-gray-500">Employer contributes gratuity (4.81% of Basic). Disable for contract/short-term employees.</p>
                </div>
              </div>
            )}

            {/* Override toggle */}
            {ctc && (
              <div className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <Switch checked={useOverrides} onCheckedChange={setUseOverrides} />
                <div>
                  <p className="text-sm font-medium">Manual Component Override</p>
                  <p className="text-xs text-gray-500">Override auto-calculated values with custom amounts</p>
                </div>
              </div>
            )}

            {/* Component tabs */}
            {ctc && (
              <Tabs defaultValue="earnings">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="earnings">Earnings</TabsTrigger>
                  <TabsTrigger value="deductions">Deductions</TabsTrigger>
                  <TabsTrigger value="contributions">Employer</TabsTrigger>
                </TabsList>

                <TabsContent value="earnings" className="space-y-4 pt-2">
                  {useOverrides ? (
                    <div className="grid md:grid-cols-3 gap-4">
                      {[
                        { key: 'basic_salary', label: 'Basic Salary / month' },
                        { key: 'hra', label: 'HRA / month' },
                        { key: 'conveyance', label: 'Conveyance Allowance / month' },
                        { key: 'performance_bonus', label: 'Bonus/VPP / month' },
                      ].map(({ key, label }) => (
                        <ComponentField key={key} label={label} value={overrides[key]}
                          onChange={v => setOverrides(p => ({ ...p, [key]: v }))} />
                      ))}
                    </div>
                  ) : computed ? (
                    <div className="grid md:grid-cols-3 gap-3">
                      {[
                        { label: 'Basic (50% of CTC)', val: computed.basic_salary, color: 'blue' },
                        { label: 'HRA (40% of Basic)', val: computed.hra, color: 'green' },
                        { label: 'Conveyance (Balance)', val: computed.conveyance, color: 'orange' },
                      ].map(({ label, val, color }) => (
                        <div key={label} className={`p-3 bg-${color}-50 rounded-lg border border-${color}-100`}>
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className={`text-lg font-bold text-${color}-600`}>₹{fmt(val)}<span className="text-xs font-normal text-gray-400">/mo</span></p>
                          <p className="text-xs text-gray-400">₹{fmt(val * 12)}/yr</p>
                        </div>
                      ))}
                      <div className="md:col-span-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="text-sm font-semibold text-gray-700 mb-1">Gross Monthly: <span className="text-blue-700">₹{fmt(computed.grossMonthly)}</span></p>
                        <p className="text-xs text-gray-500">
                          ✓ PF Applicable (All employees){computed.isESIApplicable ? ' · ✓ ESI Applicable (Basic ≤ ₹21,000)' : ''}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="deductions" className="space-y-4 pt-2">
                  {useOverrides ? (
                    <div className="grid md:grid-cols-3 gap-4">
                      <ComponentField label="PF (Employee 12%) / month" value={overrides.pf_contribution} onChange={v => setOverrides(p => ({ ...p, pf_contribution: v }))} />
                      <ComponentField label="ESI (Employee 0.75%) / month" value={overrides.esi_contribution} onChange={v => setOverrides(p => ({ ...p, esi_contribution: v }))} />
                    </div>
                  ) : computed ? (
                    <div className="space-y-3">
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                          <p className="text-xs text-gray-500">PF (12% on ≤₹{PF_CEILING.toLocaleString('en-IN')})</p>
                          <p className="text-lg font-bold text-red-600">₹{fmt(computed.pf_contribution)}/mo</p>
                        </div>
                        {computed.esi_contribution > 0 && (
                          <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                            <p className="text-xs text-gray-500">ESI (0.75% – applicable &lt;₹21,000 gross)</p>
                            <p className="text-lg font-bold text-red-600">₹{fmt(computed.esi_contribution)}/mo</p>
                          </div>
                        )}
                      </div>
                      <div className="p-3 bg-red-100 rounded-lg flex justify-between items-center font-bold">
                        <span>Total Employee Deductions</span>
                        <span className="text-red-700">₹{fmt(computed.totalDeductions)}/mo</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-500">
                    <strong>Compliance Notes:</strong> PF (12% employee, 13% employer) on all components except HRA, capped at ₹15,000 — applicable only when basic &gt; ₹21,000. ESI (0.75% employee, 3.25% employer) on gross — applicable when basic ≤ ₹21,000.
                  </div>
                </TabsContent>

                <TabsContent value="contributions" className="space-y-4 pt-2">
                  {/* Medical contribution input */}
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium">Medical Contribution (Employer) / month</p>
                      <p className="text-xs text-gray-500">Variable employer medical contribution</p>
                    </div>
                    <div className="w-36">
                      <ComponentField label="" value={medicalContrib} onChange={v => setMedicalContrib(v || 0)} />
                    </div>
                  </div>
                  {useOverrides ? (
                    <div className="grid md:grid-cols-3 gap-4">
                      <ComponentField label="Employer PF (13%) / month" value={overrides.employer_pf_contribution} onChange={v => setOverrides(p => ({ ...p, employer_pf_contribution: v }))} />
                      <ComponentField label="Employer ESI (3.25%) / month" value={overrides.employer_esi_contribution} onChange={v => setOverrides(p => ({ ...p, employer_esi_contribution: v }))} />
                      <ComponentField label="Gratuity (4.81% of Basic) / month" value={overrides.gratuity} onChange={v => setOverrides(p => ({ ...p, gratuity: v }))} />
                    </div>
                  ) : computed ? (
                    <div className="grid md:grid-cols-3 gap-3">
                      {computed.employer_pf_contribution > 0 && (
                        <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                          <p className="text-xs text-gray-500">Employer PF (13%)</p>
                          <p className="text-lg font-bold text-green-600">₹{fmt(computed.employer_pf_contribution)}/mo</p>
                        </div>
                      )}
                      {computed.isESIApplicable && computed.employer_esi_contribution > 0 && (
                        <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                          <p className="text-xs text-gray-500">Employer ESI (3.25%)</p>
                          <p className="text-lg font-bold text-green-600">₹{fmt(computed.employer_esi_contribution)}/mo</p>
                        </div>
                      )}
                      <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                        <p className="text-xs text-gray-500">Medical (Employer)</p>
                        <p className="text-lg font-bold text-green-600">₹{fmt(computed.medical_contribution)}/mo</p>
                      </div>
                      <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                        <p className="text-xs text-gray-500">{computed.bonusVPPType}</p>
                        <p className="text-lg font-bold text-yellow-600">₹{fmt(computed.performance_bonus)}/mo</p>
                      </div>
                      {gratuityEligible && (
                        <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                          <p className="text-xs text-gray-500">Gratuity (4.81% of Basic)</p>
                          <p className="text-lg font-bold text-green-600">₹{fmt(computed.gratuity)}/mo</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </TabsContent>
              </Tabs>
            )}

            {/* Summary */}
            {ctc && vals && (
              <div className="grid md:grid-cols-4 gap-3 p-4 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-xl border border-blue-200">
                <div className="text-center">
                  <p className="text-xs text-gray-600">Gross Monthly</p>
                  <p className="text-xl font-bold text-blue-800">₹{fmt(vals.grossMonthly)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-600">Total Deductions</p>
                  <p className="text-xl font-bold text-red-700">₹{fmt((vals.pf_contribution || 0) + (vals.esi_contribution || 0))}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-600">Net Take-Home / Month</p>
                  <p className="text-xl font-bold text-green-700">₹{fmt(vals.grossMonthly - (vals.pf_contribution || 0) - (vals.esi_contribution || 0))}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-600">Annual CTC</p>
                  <p className="text-xl font-bold text-blue-900">₹{parseFloat(ctc).toLocaleString('en-IN')}</p>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button className="bg-green-600 hover:bg-green-700 px-8" onClick={handleSave}>
                {editingStructure ? 'Save Revision' : 'Create Structure'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}