import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, DollarSign, Edit } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';

export default function EmployeeSalaryStructure() {
  const [user, setUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    user_id: '',
    effective_from: new Date().toISOString().split('T')[0],
    ctc: '',
    basic_salary: '',
    hra: '',
    conveyance: '',
    medical: '',
    special_allowance: '',
    pf_contribution: '',
    professional_tax: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const empRecords = await base44.entities.Employee.filter({ status: 'active' });
      const allUsers = await base44.entities.User.list();
      const allSalaries = await base44.entities.SalaryStructure.list('-created_date', 500);

      setEmployees(empRecords);
      setUsers(allUsers);
      setSalaryStructures(allSalaries);
      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const salaryData = {
        ...formData,
        ctc: parseFloat(formData.ctc) || 0,
        basic_salary: parseFloat(formData.basic_salary) || 0,
        hra: parseFloat(formData.hra) || 0,
        conveyance: parseFloat(formData.conveyance) || 0,
        medical: parseFloat(formData.medical) || 0,
        special_allowance: parseFloat(formData.special_allowance) || 0,
        pf_contribution: parseFloat(formData.pf_contribution) || 0,
        professional_tax: parseFloat(formData.professional_tax) || 0,
        status: 'active'
      };

      // Deactivate existing active salary structures for this employee
      const existingStructures = salaryStructures.filter(
        s => s.user_id === formData.user_id && s.status === 'active'
      );

      for (const structure of existingStructures) {
        await base44.entities.SalaryStructure.update(structure.id, { status: 'inactive' });
      }

      if (editMode && formData.id) {
        await base44.entities.SalaryStructure.update(formData.id, salaryData);
        toast.success('Salary structure updated');
      } else {
        await base44.entities.SalaryStructure.create(salaryData);
        toast.success('Salary structure created');
      }

      setShowForm(false);
      setEditMode(false);
      resetForm();
      loadData();
    } catch (error) {
      toast.error('Failed to save salary structure');
    }
  };

  const resetForm = () => {
    setFormData({
      user_id: '',
      effective_from: new Date().toISOString().split('T')[0],
      ctc: '',
      basic_salary: '',
      hra: '',
      conveyance: '',
      medical: '',
      special_allowance: '',
      pf_contribution: '',
      professional_tax: ''
    });
  };

  const handleEdit = (salary) => {
    setFormData({
      ...salary,
      id: salary.id,
      ctc: (salary.ctc || 0).toString(),
      basic_salary: (salary.basic_salary || 0).toString(),
      hra: (salary.hra || 0).toString(),
      conveyance: (salary.conveyance || 0).toString(),
      medical: (salary.medical || 0).toString(),
      special_allowance: (salary.special_allowance || 0).toString(),
      pf_contribution: (salary.pf_contribution || 0).toString(),
      professional_tax: (salary.professional_tax || 0).toString()
    });
    setEditMode(true);
    setShowForm(true);
  };

  const calculateCTC = () => {
    const basic = parseFloat(formData.basic_salary) || 0;
    const hra = parseFloat(formData.hra) || 0;
    const conveyance = parseFloat(formData.conveyance) || 0;
    const medical = parseFloat(formData.medical) || 0;
    const special = parseFloat(formData.special_allowance) || 0;
    const pf = parseFloat(formData.pf_contribution) || 0;

    const monthlyCTC = basic + hra + conveyance + medical + special + pf;
    const annualCTC = monthlyCTC * 12;

    setFormData({ ...formData, ctc: annualCTC.toString() });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const isHR = user.role === 'hr' || user.role === 'admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Employee Salary Structures</h1>
            <p className="text-gray-600 mt-1">Configure individual salary components for employees</p>
          </div>
          {isHR && (
            <Dialog open={showForm} onOpenChange={(open) => {
              setShowForm(open);
              if (!open) {
                setEditMode(false);
                resetForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-5 h-5 mr-2" />
                  Configure Salary
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editMode ? 'Edit' : 'Configure'} Salary Structure</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <Label>Employee *</Label>
                      <Select 
                        value={formData.user_id} 
                        onValueChange={(v) => setFormData({ ...formData, user_id: v })}
                        disabled={editMode}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map(emp => {
                            const empUser = users.find(u => u.id === emp.user_id);
                            return (
                              <SelectItem key={emp.id} value={emp.user_id}>
                                {empUser?.full_name} ({emp.employee_code})
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Effective From *</Label>
                      <Input
                        type="date"
                        value={formData.effective_from}
                        onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                        required
                      />
                    </div>

                    <div>
                      <Label>Basic Salary (Monthly) *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.basic_salary}
                        onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
                        onBlur={calculateCTC}
                        required
                      />
                    </div>

                    <div>
                      <Label>HRA (Monthly)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.hra}
                        onChange={(e) => setFormData({ ...formData, hra: e.target.value })}
                        onBlur={calculateCTC}
                      />
                    </div>

                    <div>
                      <Label>Conveyance (Monthly)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.conveyance}
                        onChange={(e) => setFormData({ ...formData, conveyance: e.target.value })}
                        onBlur={calculateCTC}
                      />
                    </div>

                    <div>
                      <Label>Medical Allowance (Monthly)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.medical}
                        onChange={(e) => setFormData({ ...formData, medical: e.target.value })}
                        onBlur={calculateCTC}
                      />
                    </div>

                    <div>
                      <Label>Special Allowance (Monthly)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.special_allowance}
                        onChange={(e) => setFormData({ ...formData, special_allowance: e.target.value })}
                        onBlur={calculateCTC}
                      />
                    </div>

                    <div>
                      <Label>PF Contribution (Monthly)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.pf_contribution}
                        onChange={(e) => setFormData({ ...formData, pf_contribution: e.target.value })}
                        onBlur={calculateCTC}
                      />
                    </div>

                    <div>
                      <Label>Professional Tax (Monthly)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.professional_tax}
                        onChange={(e) => setFormData({ ...formData, professional_tax: e.target.value })}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <Label>Annual CTC (Auto-calculated)</Label>
                      <div className="text-2xl font-bold text-green-600 mt-2">
                        ₹{parseFloat(formData.ctc || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end">
                    <Button type="button" variant="outline" onClick={() => {
                      setShowForm(false);
                      setEditMode(false);
                      resetForm();
                    }}>
                      Cancel
                    </Button>
                    <Button type="submit">{editMode ? 'Update' : 'Create'} Salary Structure</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Salary Structures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {employees.map(emp => {
                const empUser = users.find(u => u.id === emp.user_id);
                const salary = salaryStructures.find(s => s.user_id === emp.user_id && s.status === 'active');

                return (
                  <div key={emp.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-blue-600 font-semibold">
                              {empUser?.full_name?.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-semibold">{empUser?.full_name}</p>
                            <p className="text-sm text-gray-600">{emp.employee_code} • {emp.designation}</p>
                          </div>
                        </div>

                        {salary ? (
                          <div className="ml-13 grid md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-gray-600">Annual CTC</p>
                              <p className="font-semibold text-lg text-green-600">₹{salary.ctc?.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Basic Salary</p>
                              <p className="font-semibold">₹{salary.basic_salary?.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">HRA</p>
                              <p className="font-semibold">₹{salary.hra?.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Total Allowances</p>
                              <p className="font-semibold">
                                ₹{((salary.conveyance || 0) + (salary.medical || 0) + (salary.special_allowance || 0)).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="ml-13 text-sm text-gray-500 italic">No salary structure configured</p>
                        )}
                      </div>

                      {isHR && (
                        <Button
                          size="sm"
                          variant={salary ? "outline" : "default"}
                          onClick={() => salary ? handleEdit(salary) : setShowForm(true)}
                        >
                          <Edit className="w-3 h-3 mr-1" />
                          {salary ? 'Edit' : 'Configure'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {employees.length === 0 && (
                <p className="text-center text-gray-500 py-8">No employees found</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}