import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Settings, Save, AlertCircle, CheckCircle2, TrendingDown, Users, FileText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const SALARY_COMPONENTS = [
  { key: 'basic_salary', label: 'Basic Salary' },
  { key: 'hra', label: 'HRA' },
  { key: 'conveyance', label: 'Conveyance' },
  { key: 'medical', label: 'Medical Allowance' },
  { key: 'special_allowance', label: 'Special Allowance' },
  { key: 'lta', label: 'LTA' }
];

const defaultConfig = {
  config_name: 'Default LOP Policy',
  lop_calculation_basis: 'working_days',
  lop_impacted_components: ['basic_salary', 'hra'],
  lop_fixed_components_only: true,
  lop_half_day_enabled: true,
  lop_partial_day_threshold_late_marks: 3,
  lop_partial_day_threshold_early_exit: 3,
  lop_roles_exempt: [],
  lop_designations_exempt: [],
  is_active: true
};

export default function LOPConfiguration() {
  const [config, setConfig] = useState(defaultConfig);
  const [configId, setConfigId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lopReports, setLopReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    loadConfig();
    loadLOPReports();
  }, []);

  const loadConfig = async () => {
    const configs = await base44.entities.PayrollConfiguration.filter({ is_active: true });
    if (configs.length > 0) {
      setConfig(configs[0]);
      setConfigId(configs[0].id);
    }
  };

  const loadLOPReports = async () => {
    setLoadingReports(true);
    try {
      const payrolls = await base44.entities.Payroll.list('-created_date', 200);
      const employees = await base44.entities.Employee.filter({ status: 'active' });
      const users = await base44.entities.User.list();

      const lopRecords = payrolls.filter(p => p.loss_of_pay_days > 0);
      const enriched = lopRecords.map(p => {
        const emp = employees.find(e => e.user_id === p.user_id);
        const u = users.find(u => u.id === p.user_id);
        return { ...p, employee_code: emp?.employee_code || '-', department: emp?.department || '-', full_name: u?.full_name || '-' };
      });
      setLopReports(enriched);
    } finally {
      setLoadingReports(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (configId) {
        await base44.entities.PayrollConfiguration.update(configId, config);
      } else {
        const created = await base44.entities.PayrollConfiguration.create(config);
        setConfigId(created.id);
      }
      toast.success('LOP Configuration saved successfully');
    } catch (e) {
      toast.error('Failed to save: ' + e.message);
    }
    setSaving(false);
  };

  const toggleComponent = (key) => {
    const current = config.lop_impacted_components || [];
    const updated = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    setConfig(prev => ({ ...prev, lop_impacted_components: updated }));
  };

  const filteredReports = lopReports.filter(p => {
    if (selectedMonth && p.month !== selectedMonth) return false;
    if (selectedYear && p.year !== selectedYear) return false;
    return true;
  });

  const totalLopAmount = filteredReports.reduce((s, r) => s + (r.loss_of_pay_amount || 0), 0);
  const totalLopDays = filteredReports.reduce((s, r) => s + (r.loss_of_pay_days || 0), 0);

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Settings className="w-6 h-6 text-red-600" />
        <div>
          <h1 className="text-2xl font-bold">LOP Configuration & Reports</h1>
          <p className="text-sm text-gray-500">Define Loss of Pay deduction rules and view employee-wise LOP summary</p>
        </div>
      </div>

      {/* Policy Config Card */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-orange-500" /> LOP Policy Settings</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Configuration Name</Label>
              <Input value={config.config_name} onChange={e => setConfig(p => ({ ...p, config_name: e.target.value }))} placeholder="e.g., Default LOP Policy" />
            </div>
            <div className="space-y-2">
              <Label>Calculation Basis</Label>
              <Select value={config.lop_calculation_basis} onValueChange={v => setConfig(p => ({ ...p, lop_calculation_basis: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="working_days">Working Days (Recommended)</SelectItem>
                  <SelectItem value="calendar_days">Calendar Days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">Per-day salary = Monthly Gross ÷ {config.lop_calculation_basis === 'working_days' ? 'Working Days' : 'Calendar Days'}</p>
            </div>
          </div>

          {/* Impacted Components */}
          <div>
            <Label className="mb-3 block">Salary Components Impacted by LOP</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {SALARY_COMPONENTS.map(comp => (
                <div key={comp.key} className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50">
                  <Checkbox
                    checked={(config.lop_impacted_components || []).includes(comp.key)}
                    onCheckedChange={() => toggleComponent(comp.key)}
                    id={comp.key}
                  />
                  <label htmlFor={comp.key} className="text-sm font-medium cursor-pointer">{comp.label}</label>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium text-sm">Fixed Components Only</p>
                <p className="text-xs text-gray-500">Exclude variable/performance components from LOP</p>
              </div>
              <Switch checked={config.lop_fixed_components_only} onCheckedChange={v => setConfig(p => ({ ...p, lop_fixed_components_only: v }))} />
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium text-sm">Enable Half-Day LOP</p>
                <p className="text-xs text-gray-500">Apply 0.5 day deduction for partial attendance</p>
              </div>
              <Switch checked={config.lop_half_day_enabled} onCheckedChange={v => setConfig(p => ({ ...p, lop_half_day_enabled: v }))} />
            </div>
          </div>

          {config.lop_half_day_enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-orange-50 rounded-lg border border-orange-100">
              <div className="space-y-2">
                <Label>Late Mark Threshold (for 0.5 LOP)</Label>
                <Input type="number" min={1} value={config.lop_partial_day_threshold_late_marks} onChange={e => setConfig(p => ({ ...p, lop_partial_day_threshold_late_marks: parseInt(e.target.value) }))} />
                <p className="text-xs text-gray-500">e.g., 3 late marks = 0.5 day LOP</p>
              </div>
              <div className="space-y-2">
                <Label>Early Exit Threshold (for 0.5 LOP)</Label>
                <Input type="number" min={1} value={config.lop_partial_day_threshold_early_exit} onChange={e => setConfig(p => ({ ...p, lop_partial_day_threshold_early_exit: parseInt(e.target.value) }))} />
                <p className="text-xs text-gray-500">e.g., 3 early exits = 0.5 day LOP</p>
              </div>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </CardContent>
      </Card>

      {/* LOP Reports */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5 text-red-500" /> LOP Deduction Report</CardTitle>
            <div className="flex gap-2 items-center">
              <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(parseInt(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={loadLOPReports} disabled={loadingReports}>
                <RefreshCw className={`w-4 h-4 ${loadingReports ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-red-50 border border-red-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{filteredReports.length}</p>
              <p className="text-sm text-gray-600">Employees with LOP</p>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{totalLopDays}</p>
              <p className="text-sm text-gray-600">Total LOP Days</p>
            </div>
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-yellow-600">₹{totalLopAmount.toLocaleString('en-IN')}</p>
              <p className="text-sm text-gray-600">Total LOP Amount</p>
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-400" />
              <p>No LOP deductions for {months[selectedMonth - 1]} {selectedYear}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left p-3">Employee</th>
                    <th className="text-left p-3">Department</th>
                    <th className="text-center p-3">LOP Days</th>
                    <th className="text-right p-3">LOP Amount</th>
                    <th className="text-center p-3">Overridden</th>
                    <th className="text-left p-3">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map(r => (
                    <tr key={r.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <p className="font-medium">{r.full_name}</p>
                        <p className="text-xs text-gray-500">{r.employee_code}</p>
                      </td>
                      <td className="p-3 text-gray-600">{r.department}</td>
                      <td className="p-3 text-center">
                        <Badge className="bg-red-100 text-red-700">{r.loss_of_pay_days} days</Badge>
                      </td>
                      <td className="p-3 text-right font-semibold text-red-600">₹{(r.loss_of_pay_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="p-3 text-center">
                        {r.lop_overridden ? (
                          <Badge className="bg-yellow-100 text-yellow-700">Manual</Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700">Auto</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        {r.lop_deduction_breakdown && Object.keys(r.lop_deduction_breakdown).length > 0 ? (
                          <div className="text-xs text-gray-600 space-y-0.5">
                            {Object.entries(r.lop_deduction_breakdown).map(([k, v]) => (
                              <div key={k}>{k.replace(/_/g, ' ')}: ₹{v}</div>
                            ))}
                          </div>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}