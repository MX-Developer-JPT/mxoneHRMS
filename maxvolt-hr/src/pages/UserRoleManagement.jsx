import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Users, Search, Shield, Pencil } from 'lucide-react';
import { toast } from 'sonner';

const ROLES = ['admin', 'hr', 'management', 'employee', 'user', 'onboarding_pending', 'gate_admin'];

const DESIGNATION_TIERS = ['executive', 'senior_executive', 'territory_manager', 'manager', 'general_manager', 'director'];

const ROLE_COLORS = {
  admin: 'bg-red-100 text-red-800',
  hr: 'bg-purple-100 text-purple-800',
  management: 'bg-blue-100 text-blue-800',
  employee: 'bg-green-100 text-green-800',
  user: 'bg-gray-100 text-gray-800',
  onboarding_pending: 'bg-yellow-100 text-yellow-800',
  gate_admin: 'bg-orange-100 text-orange-800',
};

export default function UserRoleManagement() {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState({});
  const [departments, setDepartments] = useState([]);

  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    const term = searchTerm.toLowerCase();
    setFilteredUsers(
      term
        ? users.filter(u =>
            u.full_name?.toLowerCase().includes(term) ||
            u.email?.toLowerCase().includes(term) ||
            (u.custom_role || u.role)?.toLowerCase().includes(term)
          )
        : users
    );
  }, [searchTerm, users]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await base44.functions.invoke('getAllUsers', {});
      const allUsers = response.data.users || [];
      setUsers(allUsers);
      setFilteredUsers(allUsers);

      // Load employee records and departments
      const [empList, deptList] = await Promise.all([
        base44.entities.Employee.list(),
        base44.entities.Department.list()
      ]);
      const empMap = {};
      empList.forEach(e => { empMap[e.user_id] = e; });
      setEmployees(empMap);
      setDepartments(deptList);
    } catch (error) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (user) => {
    const emp = employees[user.id] || {};
    setEditUser(user);
    setEditForm({
      // User fields
      full_name: user.full_name || '',
      role: user.custom_role || user.role || 'user',
      // Employee fields
      display_name: emp.display_name || '',
      employee_code: emp.employee_code || '',
      department: emp.department || '',
      designation: emp.designation || '',
      designation_tier: emp.designation_tier || '',
      phone: emp.phone || '',
      personal_email: emp.personal_email || '',
      work_location: emp.work_location || '',
      reporting_manager_id: emp.reporting_manager_id || '',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const userUpdates = {};
      if (editForm.full_name !== editUser.full_name) userUpdates.full_name = editForm.full_name;
      const currentRole = editUser.custom_role || editUser.role;
      if (editForm.role !== currentRole) userUpdates.role = editForm.role;

      const emp = employees[editUser.id] || {};
      const employeeUpdates = {};
      const empFields = ['display_name', 'employee_code', 'department', 'designation', 'designation_tier', 'phone', 'personal_email', 'work_location', 'reporting_manager_id'];
      empFields.forEach(f => {
        if (editForm[f] !== (emp[f] || '')) employeeUpdates[f] = editForm[f];
      });

      await base44.functions.invoke('updateUserDetails', {
        userId: editUser.id,
        userUpdates,
        employeeUpdates,
      });

      toast.success('User updated successfully');
      setEditUser(null);
      await loadUsers();
    } catch (error) {
      toast.error('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          </div>
          <p className="text-gray-600">Manage user roles and details</p>
        </div>

        {/* Search */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder="Search by name, email, or role..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Users', value: users.length, color: 'text-blue-600' },
            { label: 'Admins', value: users.filter(u => (u.custom_role || u.role) === 'admin').length, color: 'text-red-600' },
            { label: 'HR', value: users.filter(u => (u.custom_role || u.role) === 'hr').length, color: 'text-purple-600' },
            { label: 'Management', value: users.filter(u => (u.custom_role || u.role) === 'management').length, color: 'text-blue-600' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-600">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Users Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((user) => {
            const role = user.custom_role || user.role;
            const emp = employees[user.id];
            return (
              <Card key={user.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-semibold">
                          {(emp?.display_name || user.full_name)?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm truncate">{emp?.display_name || user.full_name}</h3>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(user)}>
                      <Pencil className="w-4 h-4 text-gray-500" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  <Badge className={ROLE_COLORS[role] || 'bg-gray-100 text-gray-800'}>{role || 'No Role'}</Badge>
                  {emp?.department && <p className="text-xs text-gray-500">{emp.department} {emp.designation ? `· ${emp.designation}` : ''}</p>}
                  {emp?.employee_code && <p className="text-xs text-gray-400">Code: {emp.employee_code}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredUsers.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No users found</p>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.full_name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Account</p>

            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={editForm.full_name || ''} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <hr />
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Employee Details</p>

            {['display_name', 'employee_code', 'phone', 'personal_email', 'work_location'].map(field => (
              <div key={field} className="space-y-2">
                <Label className="capitalize">{field.replace(/_/g, ' ')}</Label>
                <Input
                  value={editForm[field] || ''}
                  onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                />
              </div>
            ))}

            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={editForm.department || ''} onValueChange={v => setEditForm(f => ({ ...f, department: v }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.name}>{d.name} ({d.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Designation</Label>
              <Input
                value={editForm.designation || ''}
                placeholder="e.g. Sales Executive"
                onChange={e => setEditForm(f => ({ ...f, designation: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Designation Tier</Label>
              <Select value={editForm.designation_tier || ''} onValueChange={v => setEditForm(f => ({ ...f, designation_tier: v }))}>
                <SelectTrigger><SelectValue placeholder="Select tier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {DESIGNATION_TIERS.map(t => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reporting Manager</Label>
              <Select
                value={editForm.reporting_manager_id || ''}
                onValueChange={v => setEditForm(f => ({ ...f, reporting_manager_id: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select reporting manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {Object.values(employees)
                    .filter(e => e.user_id !== editUser?.id)
                    .map(e => (
                      <SelectItem key={e.user_id} value={e.user_id}>
                        {e.display_name || e.user_id} {e.designation ? `· ${e.designation}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}