import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Search, Mail, Phone, Briefcase, Calendar, Building2, ChevronDown, ChevronRight, Download } from 'lucide-react';
import EmployeeDetailDialog from '../components/employees/EmployeeDetailDialog';
import HREmployeeEditPanel from '../components/employees/HREmployeeEditPanel';
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterType, setFilterType] = useState(null);
  const [collapsedDepts, setCollapsedDepts] = useState({});
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = employees.filter(emp =>
        (emp.user?.display_name || emp.user?.full_name)?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.designation?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredEmployees(filtered);
    } else {
      setFilteredEmployees(employees);
    }
  }, [searchTerm, employees]);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setCurrentUser(currentUser);
      
      const usersResponse = await base44.functions.invoke('getAllUsers', {});
      const users = usersResponse.data.users;
      
      let updatedEmpRecords = await base44.entities.Employee.list('-created_date', 500);

      const userRole = currentUser.custom_role || currentUser.role;
      if (userRole === 'manager' || userRole === 'management') {
        // Show employees where this user is set as reporting manager
        updatedEmpRecords = updatedEmpRecords.filter(e => e.reporting_manager_id === currentUser.id);
      }

      const enrichedEmps = updatedEmpRecords
        .filter(emp => emp.status === 'active')
        .map(emp => {
          const user = users.find(u => u.id === emp.user_id);
          return {
            ...emp,
            user: user ? { ...user, display_name: user.display_name || user.full_name } : user
          };
        });

      setEmployees(enrichedEmps);
      setFilteredEmployees(enrichedEmps);
      setLoading(false);
    } catch (error) {
      console.error('Error loading employees:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    on_leave: 'bg-yellow-100 text-yellow-800',
    resigned: 'bg-red-100 text-red-800',
    terminated: 'bg-gray-100 text-gray-800'
  };

  const stats = {
    total: employees.length,
    active: employees.filter(e => e.status === 'active').length,
    on_leave: employees.filter(e => e.status === 'on_leave').length,
    probation: employees.filter(e => e.employee_status === 'probation').length,
    confirmation: employees.filter(e => e.employee_status === 'confirmation').length,
    trainee: employees.filter(e => e.employee_status === 'trainee').length,
    confirming_this_month: employees.filter(e => {
      if (!e.employee_confirmation_date) return false;
      const confirmDate = new Date(e.employee_confirmation_date);
      const now = new Date();
      return confirmDate.getMonth() === now.getMonth() && 
             confirmDate.getFullYear() === now.getFullYear() &&
             e.employee_status === 'probation';
    }).length
  };

  const handleStatClick = (type) => {
    setFilterType(type);
    let filtered = [];
    switch(type) {
      case 'probation':
        filtered = employees.filter(e => e.employee_status === 'probation');
        break;
      case 'confirmation':
        filtered = employees.filter(e => e.employee_status === 'confirmation');
        break;
      case 'trainee':
        filtered = employees.filter(e => e.employee_status === 'trainee');
        break;
      case 'confirming_this_month':
        filtered = employees.filter(e => {
          if (!e.employee_confirmation_date) return false;
          const confirmDate = new Date(e.employee_confirmation_date);
          const now = new Date();
          return confirmDate.getMonth() === now.getMonth() && 
                 confirmDate.getFullYear() === now.getFullYear() &&
                 e.employee_status === 'probation';
        });
        break;
    }
    setFilteredEmployees(filtered);
    setShowFilterDialog(true);
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      // Fetch salary structures for all employees
      const salaryStructures = await base44.entities.SalaryStructure.filter({ status: 'active' });
      const salaryMap = {};
      for (const s of salaryStructures) {
        if (s.user_id && !salaryMap[s.user_id]) salaryMap[s.user_id] = s;
      }

      const rows = employees.map(emp => {
        const sal = salaryMap[emp.user_id] || {};
        return {
          'Employee Code': emp.employee_code || '',
          'Name': emp.display_name || emp.user?.display_name || emp.user?.full_name || '',
          'Email': emp.user?.email || '',
          'Phone': emp.phone || '',
          'Department': emp.department || '',
          'Designation': emp.designation || '',
          'Designation Tier': emp.designation_tier || '',
          'Employment Type': emp.employment_type || '',
          'Employee Status': emp.employee_status || '',
          'Date of Joining': emp.date_of_joining || '',
          'Confirmation Date': emp.employee_confirmation_date || '',
          'Work Location': emp.work_location || '',
          'Status': emp.status || '',
          'Date of Birth': emp.date_of_birth || '',
          'Gender': emp.gender || '',
          'Blood Group': emp.blood_group || '',
          'Father/Spouse Name': emp.father_spouse_name || '',
          'Personal Email': emp.personal_email || '',
          'Address': emp.address || '',
          'Emergency Contact Name': emp.emergency_contact?.name || '',
          'Emergency Contact Phone': emp.emergency_contact?.phone || '',
          'Emergency Contact Relation': emp.emergency_contact?.relationship || '',
          'PAN Number': emp.pan_number || '',
          'Aadhar Number': emp.aadhar_number || '',
          'UAN Number': emp.uan_number || '',
          'PF Account Number': emp.pf_account_number || '',
          'ESI Applicable': emp.is_esi_applicable ? 'Yes' : 'No',
          'ESI Number': emp.esi_number || '',
          'Bank Account Number': emp.bank_account?.account_number || '',
          'Bank IFSC': emp.bank_account?.ifsc_code || '',
          'Bank Name': emp.bank_account?.bank_name || '',
          'Bank Branch': emp.bank_account?.branch || '',
          'Biometric ID': emp.biometric_id || '',
          // Salary Structure
          'CTC (Annual)': sal.ctc || '',
          'Basic Salary': sal.basic_salary || '',
          'HRA': sal.hra || '',
          'Conveyance': sal.conveyance || '',
          'Medical': sal.medical || '',
          'Special Allowance': sal.special_allowance || '',
          'LTA': sal.lta || '',
          'Performance Bonus': sal.performance_bonus || '',
          'PF Contribution (Employee)': sal.pf_contribution || '',
          'PF Contribution (Employer)': sal.employer_pf_contribution || '',
          'ESI Contribution (Employee)': sal.esi_contribution || '',
          'ESI Contribution (Employer)': sal.employer_esi_contribution || '',
          'Professional Tax': sal.professional_tax || '',
          'Salary Effective From': sal.effective_from || '',
        };
      });

      const headers = Object.keys(rows[0] || {});
      const csv = [
        headers.join(','),
        ...rows.map(row =>
          headers.map(h => {
            const val = String(row[h] ?? '').replace(/"/g, '""');
            return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
          }).join(',')
        )
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `employee_directory_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
    setExporting(false);
  };

  const departmentGroups = filteredEmployees.reduce((groups, emp) => {
    const dept = emp.department || 'Unassigned';
    if (!groups[dept]) groups[dept] = [];
    groups[dept].push(emp);
    return groups;
  }, {});

  const toggleDept = (dept) => {
    setCollapsedDepts(prev => ({ ...prev, [dept]: !prev[dept] }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Employee Directory</h1>
            <p className="text-gray-600 mt-1">Manage and view employee information</p>
          </div>
          {(currentUser?.role === 'admin' || currentUser?.custom_role === 'hr') && (
            <Button onClick={handleExportAll} disabled={exporting} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export All (CSV)'}
            </Button>
          )}
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleStatClick('probation')}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-orange-100 rounded-full">
                  <Users className="w-8 h-8 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">On Probation</p>
                  <p className="text-3xl font-bold text-orange-600">{stats.probation}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleStatClick('confirmation')}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-green-100 rounded-full">
                  <Users className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Confirmed</p>
                  <p className="text-3xl font-bold text-green-600">{stats.confirmation}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleStatClick('trainee')}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-100 rounded-full">
                  <Users className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Trainees</p>
                  <p className="text-3xl font-bold text-blue-600">{stats.trainee}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleStatClick('confirming_this_month')}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-purple-100 rounded-full">
                  <Calendar className="w-8 h-8 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Confirming This Month</p>
                  <p className="text-3xl font-bold text-purple-600">{stats.confirming_this_month}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  placeholder="Search by name, employee code, or designation..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {Object.entries(departmentGroups).sort(([a], [b]) => a.localeCompare(b)).map(([dept, emps]) => (
                <div key={dept} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                    onClick={() => toggleDept(dept)}
                  >
                    <div className="flex items-center gap-3">
                      <Building2 className="w-5 h-5 text-blue-600" />
                      <span className="font-semibold capitalize">{dept.replace(/_/g, ' ')}</span>
                      <Badge variant="outline">{emps.length} employee{emps.length !== 1 ? 's' : ''}</Badge>
                    </div>
                    {collapsedDepts[dept] ? <ChevronRight className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                  </button>
                  {!collapsedDepts[dept] && (
                    <div className="p-4 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {emps.map(emp => (
                        <Card key={emp.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedEmployee(emp)}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                <span className="text-blue-600 font-semibold text-lg">
                                  {(emp.user?.display_name || emp.user?.full_name)?.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold truncate">{emp.user?.display_name || emp.user?.full_name}</p>
                                <p className="text-sm text-gray-600 truncate">{emp.designation}</p>
                                <Badge className={`${statusColors[emp.status]} mt-1`}>
                                  {emp.status?.replace('_', ' ').toUpperCase()}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-3 space-y-2 text-sm">
                              <div className="flex items-center gap-2 text-gray-600">
                                <Briefcase className="w-4 h-4" />
                                <span className="truncate">{emp.employee_code}</span>
                              </div>
                              <div className="flex items-center gap-2 text-gray-600">
                                <Mail className="w-4 h-4" />
                                <span className="truncate">{emp.user?.email}</span>
                              </div>
                              {emp.phone && (
                                <div className="flex items-center gap-2 text-gray-600">
                                  <Phone className="w-4 h-4" />
                                  <span>{emp.phone}</span>
                                </div>
                              )}
                              {emp.date_of_joining && (
                                <div className="pt-2 border-t text-xs text-gray-500">
                                  <p>Joined: {safeDate(emp.date_of_joining, 'MMM yyyy')}</p>
                                </div>
                              )}
                              {emp.is_esi_applicable !== undefined && (
                                <div className="text-xs">
                                  <Badge className={emp.is_esi_applicable ? 'bg-green-100 text-green-700 text-xs' : 'bg-gray-100 text-gray-600 text-xs'}>
                                    ESI: {emp.is_esi_applicable ? 'Yes' : 'No'}
                                  </Badge>
                                </div>
                              )}
                            </div>
                            {(currentUser?.role === 'admin' || currentUser?.custom_role === 'hr') && (
                              <div className="mt-2 flex justify-end" onClick={e => { e.stopPropagation(); setEditingEmployee(emp); }}>
                                <Button size="sm" variant="outline" className="text-xs">Edit UAN/PF</Button>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {filteredEmployees.length === 0 && (
                <div className="text-center py-12">
                  <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-500">No employees found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <EmployeeDetailDialog employee={selectedEmployee} onClose={() => setSelectedEmployee(null)} />
        {(currentUser?.role === 'admin' || currentUser?.custom_role === 'hr') && (
          <HREmployeeEditPanel
            employee={editingEmployee}
            onClose={() => setEditingEmployee(null)}
            onSave={loadData}
          />
        )}

        <Dialog open={showFilterDialog} onOpenChange={setShowFilterDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {filterType === 'probation' && 'Employees on Probation'}
                {filterType === 'confirmation' && 'Confirmed Employees'}
                {filterType === 'trainee' && 'Trainees'}
                {filterType === 'confirming_this_month' && 'Employees Confirming This Month'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {filteredEmployees.map(emp => (
                <Card key={emp.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-semibold text-lg">
                          {(emp.user?.display_name || emp.user?.full_name)?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{emp.user?.display_name || emp.user?.full_name}</p>
                        <p className="text-sm text-gray-600 truncate">{emp.designation}</p>
                        <div className="flex gap-2 mt-2">
                          <Badge className={statusColors[emp.status]}>
                            {emp.status?.replace('_', ' ').toUpperCase()}
                          </Badge>
                          {emp.employee_status && (
                            <Badge variant="outline" className="capitalize">
                              {emp.employee_status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Briefcase className="w-4 h-4" />
                        <span className="truncate">{emp.employee_code}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{emp.user?.email}</span>
                      </div>
                      {emp.employee_confirmation_date && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>Confirmation: {safeDate(emp.employee_confirmation_date, 'MMM dd, yyyy')}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredEmployees.length === 0 && (
                <div className="text-center py-8">
                  <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-500">No employees found in this category</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}