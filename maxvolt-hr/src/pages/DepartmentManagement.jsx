import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Building2, Users, Clock } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { toast } from 'sonner';

export default function DepartmentManagement() {
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showManageEmployees, setShowManageEmployees] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    head_user_id: '',
    description: '',
    ot_applicable: false
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [depts, empList] = await Promise.all([
        base44.entities.Department.list('-created_date'),
        base44.entities.Employee.list()
      ]);

      const usersResponse = await base44.functions.invoke('getAllUsers', {});
      const usersList = usersResponse.data.users;

      const enrichedEmps = empList.map(emp => ({
        ...emp,
        user: usersList.find(u => u.id === emp.user_id)
      }));

      setDepartments(depts);
      setUsers(usersList);
      setEmployees(enrichedEmps);
      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);

      if (editingDept) {
        await base44.entities.Department.update(editingDept.id, formData);
        toast.success('Department updated successfully');
      } else {
        await base44.entities.Department.create(formData);
        toast.success('Department created successfully');
      }

      setShowForm(false);
      setEditingDept(null);
      setFormData({ name: '', code: '', head_user_id: '', description: '', ot_applicable: false });
      loadData();
    } catch (error) {
      console.error('Error saving department:', error);
      toast.error('Failed to save department');
      setLoading(false);
    }
  };

  const handleEdit = (dept) => {
    setEditingDept(dept);
    setFormData({
      name: dept.name,
      code: dept.code,
      head_user_id: dept.head_user_id || '',
      description: dept.description || '',
      ot_applicable: dept.ot_applicable || false
    });
    setShowForm(true);
  };

  const handleManageEmployees = (dept) => {
    setSelectedDepartment(dept);
    setShowManageEmployees(true);
  };

  const assignEmployeeToDepartment = async (employeeId, departmentCode) => {
    try {
      await base44.entities.Employee.update(employeeId, { department: departmentCode });
      toast.success('Employee moved to department successfully');
      loadData();
    } catch (error) {
      console.error('Error assigning employee:', error);
      toast.error('Failed to assign employee');
    }
  };

  if (loading && departments.length === 0) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Department Management</h1>
            <p className="text-gray-600 mt-1 text-sm md:text-base">Create and manage departments</p>
          </div>
          <Dialog open={showForm} onOpenChange={(open) => {
            setShowForm(open);
            if (!open) {
              setEditingDept(null);
              setFormData({ name: '', code: '', head_user_id: '', description: '', ot_applicable: false });
            }
          }}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto">
                <Plus className="w-5 h-5 mr-2" />
                New Department
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingDept ? 'Edit Department' : 'Create Department'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Department Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Engineering"
                    required
                  />
                </div>

                <div>
                  <Label>Department Code *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g., ENG"
                    required
                  />
                </div>

                <div>
                  <Label>Department Head</Label>
                  <Select
                    value={formData.head_user_id}
                    onValueChange={(value) => setFormData({ ...formData, head_user_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select head" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(user => {
                        const emp = employees.find(e => e.user_id === user.id);
                        return (
                          <SelectItem key={user.id} value={user.id}>
                            {emp?.display_name || user.full_name} ({user.email})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Department description"
                    rows={3}
                  />
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg bg-orange-50">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <div>
                      <p className="text-sm font-medium">OT Applicable</p>
                      <p className="text-xs text-gray-500">Enable overtime tracking for this department</p>
                    </div>
                  </div>
                  <Switch
                    checked={!!formData.ot_applicable}
                    onCheckedChange={(val) => setFormData({ ...formData, ot_applicable: val })}
                  />
                </div>

                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingDept ? 'Update' : 'Create'}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {departments.map(dept => {
            const head = users.find(u => u.id === dept.head_user_id);
            const deptEmployees = employees.filter(e => e.department === dept.code);

            return (
              <Card key={dept.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-blue-100 rounded-full">
                        <Building2 className="w-6 h-6 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{dept.name}</CardTitle>
                        <p className="text-sm text-gray-600">Code: {dept.code}</p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dept.description && (
                    <p className="text-sm text-gray-600">{dept.description}</p>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4 text-gray-600" />
                      <span className="text-gray-600">{deptEmployees.length} employees</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className={`w-4 h-4 ${dept.ot_applicable ? 'text-orange-500' : 'text-gray-300'}`} />
                      <span className={`text-xs font-medium ${dept.ot_applicable ? 'text-orange-600' : 'text-gray-400'}`}>
                        {dept.ot_applicable ? 'OT Applicable' : 'No OT'}
                      </span>
                      <Switch
                        checked={!!dept.ot_applicable}
                        onCheckedChange={async (val) => {
                          await base44.entities.Department.update(dept.id, { ot_applicable: val });
                          toast.success(`OT ${val ? 'enabled' : 'disabled'} for ${dept.name}`);
                          loadData();
                        }}
                      />
                    </div>
                  </div>

                  {head && (
                    <div className="border-t pt-3">
                      <p className="text-xs text-gray-600 mb-1">Department Head</p>
                      <p className="font-semibold text-sm">{employees.find(e=>e.user_id===head.id)?.display_name || head.full_name}</p>
                      <p className="text-xs text-gray-600">{head.email}</p>
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(dept)}
                      className="flex-1"
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleManageEmployees(dept)}
                      className="flex-1"
                    >
                      Manage Staff
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {departments.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <Building2 className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500">No departments yet</p>
              <p className="text-sm text-gray-400 mt-2">Create your first department to get started</p>
            </CardContent>
          </Card>
        )}

        <Dialog open={showManageEmployees} onOpenChange={setShowManageEmployees}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage Employees - {selectedDepartment?.name}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-3">Current Department Employees</h3>
                <div className="space-y-2">
                  {employees.filter(e => e.department === selectedDepartment?.code).length > 0 ? (
                    employees.filter(e => e.department === selectedDepartment?.code).map(emp => (
                      <div key={emp.id} className="flex items-center justify-between p-3 border rounded-lg bg-blue-50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-blue-600 font-semibold">
                              {(emp.display_name || emp.user?.full_name)?.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-semibold">{emp.display_name || emp.user?.full_name}</p>
                            <p className="text-sm text-gray-600">{emp.employee_code} • {emp.designation}</p>
                          </div>
                        </div>
                        <Select
                          value={emp.department}
                          onValueChange={(value) => assignEmployeeToDepartment(emp.id, value)}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept.id} value={dept.code}>
                                {dept.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-gray-500 py-4">No employees in this department</p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Add Employees from Other Departments</h3>
                <div className="space-y-2">
                  {employees.filter(e => e.department !== selectedDepartment?.code && e.status === 'active').length > 0 ? (
                    employees.filter(e => e.department !== selectedDepartment?.code && e.status === 'active').map(emp => (
                      <div key={emp.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                            <span className="text-gray-600 font-semibold">
                              {(emp.display_name || emp.user?.full_name)?.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-semibold">{emp.display_name || emp.user?.full_name}</p>
                            <p className="text-sm text-gray-600">{emp.employee_code} • {emp.designation} • {emp.department}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => assignEmployeeToDepartment(emp.id, selectedDepartment?.code)}
                        >
                          Move Here
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-gray-500 py-4">All active employees are in this department</p>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}