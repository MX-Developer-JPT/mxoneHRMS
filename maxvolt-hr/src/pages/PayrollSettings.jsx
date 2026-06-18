import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PayrollSettings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const configs = await base44.entities.PayrollConfiguration.list();
      if (configs.length > 0) {
        setConfig(configs[0]);
      } else {
        // Initialize default config
        const currentYear = new Date().getFullYear();
        const defaultConfig = {
          financial_year: `${currentYear}-${currentYear + 1}`,
          pf_employer_rate: 12,
          pf_employee_rate: 12,
          pf_ceiling: 15000,
          esi_employer_rate: 3.25,
          esi_employee_rate: 0.75,
          esi_wage_ceiling: 21000,
          professional_tax_slab: [
            { min: 0, max: 10000, tax: 0 },
            { min: 10001, max: 15000, tax: 175 },
            { min: 15001, max: 999999, tax: 200 }
          ],
          gratuity_rate: 4.81,
          gratuity_min_years: 5,
          tds_slabs: [
            { min: 0, max: 250000, rate: 0 },
            { min: 250001, max: 500000, rate: 5 },
            { min: 500001, max: 1000000, rate: 20 },
            { min: 1000001, max: 999999999, rate: 30 }
          ],
          overtime_multiplier: 2,
          late_penalty_per_minute: 0,
          working_days_per_month: 26,
          paid_holidays_per_year: 12
        };
        const created = await base44.entities.PayrollConfiguration.create(defaultConfig);
        setConfig(created);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading config:', error);
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { id, created_date, updated_date, created_by, ...updateData } = config;
      await base44.entities.PayrollConfiguration.update(id, updateData);
      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Error saving settings: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Payroll Settings</h1>
            <p className="text-gray-600 mt-1">Configure payroll parameters and policies</p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>

        <Tabs defaultValue="statutory" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="statutory">Statutory</TabsTrigger>
            <TabsTrigger value="tax">Tax Slabs</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="benefits">Benefits</TabsTrigger>
          </TabsList>

          <TabsContent value="statutory">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Financial Year</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-w-xs">
                    <Label>Financial Year</Label>
                    <Input
                      value={config.financial_year || ''}
                      onChange={(e) => setConfig({...config, financial_year: e.target.value})}
                      placeholder="e.g., 2025-2026"
                    />
                    <p className="text-xs text-gray-500 mt-1">Format: YYYY-YYYY (e.g., 2025-2026)</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Provident Fund (PF)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Employee Contribution (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={config.pf_employee_rate}
                      onChange={(e) => setConfig({...config, pf_employee_rate: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Employer Contribution (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={config.pf_employer_rate}
                      onChange={(e) => setConfig({...config, pf_employer_rate: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>PF Ceiling (₹)</Label>
                    <Input
                      type="number"
                      value={config.pf_ceiling}
                      onChange={(e) => setConfig({...config, pf_ceiling: parseFloat(e.target.value)})}
                    />
                    <p className="text-xs text-gray-500 mt-1">Maximum basic salary for PF calculation</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Employee State Insurance (ESI)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Employee Contribution (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={config.esi_employee_rate}
                      onChange={(e) => setConfig({...config, esi_employee_rate: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Employer Contribution (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={config.esi_employer_rate}
                      onChange={(e) => setConfig({...config, esi_employer_rate: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>ESI Wage Ceiling (₹)</Label>
                    <Input
                      type="number"
                      value={config.esi_wage_ceiling}
                      onChange={(e) => setConfig({...config, esi_wage_ceiling: parseFloat(e.target.value)})}
                    />
                    <p className="text-xs text-gray-500 mt-1">Maximum monthly salary for ESI applicability</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="tax">
            <Card>
              <CardHeader>
                <CardTitle>Income Tax Slabs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {config.tds_slabs?.map((slab, idx) => (
                    <div key={idx} className="flex gap-4 items-center border p-3 rounded-lg">
                      <div className="flex-1">
                        <Label className="text-xs">Min Income (₹)</Label>
                        <Input
                          type="number"
                          value={slab.min}
                          onChange={(e) => {
                            const updated = [...config.tds_slabs];
                            updated[idx].min = parseInt(e.target.value);
                            setConfig({...config, tds_slabs: updated});
                          }}
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs">Max Income (₹)</Label>
                        <Input
                          type="number"
                          value={slab.max}
                          onChange={(e) => {
                            const updated = [...config.tds_slabs];
                            updated[idx].max = parseInt(e.target.value);
                            setConfig({...config, tds_slabs: updated});
                          }}
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs">Tax Rate (%)</Label>
                        <Input
                          type="number"
                          value={slab.rate}
                          onChange={(e) => {
                            const updated = [...config.tds_slabs];
                            updated[idx].rate = parseFloat(e.target.value);
                            setConfig({...config, tds_slabs: updated});
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="attendance">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Working Days & Overtime</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Working Days per Month</Label>
                    <Input
                      type="number"
                      value={config.working_days_per_month}
                      onChange={(e) => setConfig({...config, working_days_per_month: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Overtime Pay Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={config.overtime_multiplier}
                      onChange={(e) => setConfig({...config, overtime_multiplier: parseFloat(e.target.value)})}
                    />
                    <p className="text-xs text-gray-500 mt-1">Hourly rate multiplier for overtime</p>
                  </div>
                  <div>
                    <Label>Late Arrival Penalty (₹/min)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={config.late_penalty_per_minute}
                      onChange={(e) => setConfig({...config, late_penalty_per_minute: parseFloat(e.target.value)})}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Leave & Holidays</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Paid Holidays per Year</Label>
                    <Input
                      type="number"
                      value={config.paid_holidays_per_year}
                      onChange={(e) => setConfig({...config, paid_holidays_per_year: parseInt(e.target.value)})}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="benefits">
            <Card>
              <CardHeader>
                <CardTitle>Gratuity Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Gratuity Rate</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={config.gratuity_rate}
                    onChange={(e) => setConfig({...config, gratuity_rate: parseFloat(e.target.value)})}
                  />
                  <p className="text-xs text-gray-500 mt-1">Formula: (Last salary × Years of service × Rate) / 26</p>
                </div>
                <div>
                  <Label>Minimum Years for Gratuity</Label>
                  <Input
                    type="number"
                    value={config.gratuity_min_years}
                    onChange={(e) => setConfig({...config, gratuity_min_years: parseInt(e.target.value)})}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}