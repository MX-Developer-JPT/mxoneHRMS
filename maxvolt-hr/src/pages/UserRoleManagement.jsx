import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Users, Search, Shield, Pencil, ChevronsUpDown, Check, ArrowRightLeft, UserCog, AlertTriangle, Wrench } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from 'sonner';

const ROLES = ['admin', 'hr', 'management', 'manager', 'employee', 'user', 'onboarding_pending', 'gate_admin'];

const DESIGNATION_TIERS = ['executive', 'senior_executive', 'territory_manager', 'manager', 'general_manager', 'director'];

const ROLE_COLORS = {
  admin: 'bg-red-100 text-red-800',
  hr: 'bg-purple-100 text-purple-800',
  management: 'bg-blue-100 text-blue-800',
  manager: 'bg-teal-100 text-teal-800',
  employee: 'bg-green-100 text-green-800',
  user: 'bg-gray-100 text-gray-800',
  onboarding_pending: 'bg-yellow-100 text-yellow-800',
  gate_admin: 'bg-orange-100 text-orange-800',
};

export default function UserRoleManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [departments, setDepartments] = useState([]);

  // Bulk: reassign reporting manager for a whole department
  const [bulkDept, setBulkDept] = useState('');
  const [bulkManagerId, setBulkManagerId] = useState('');
  const [bulkManagerOpen, setBulkManagerOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);

  // Bulk: convert 'management' role to scoped 'manager', except chosen users
  const [keepManagementIds, setKeepManagementIds] = useState(new Set());
  const [roleCleanupApplying, setRoleCleanupApplying] = useState(false);

  const [confirmAction, setConfirmAction] = useState(null); // { title, description, onConfirm }

  // One-time repair: backfill reporting_manager_id from legacy reporting_manager_email
  const [backfillRunning, setBackfillRunning] = useState(false);

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

  const employeeList = Object.values(employees);
  const bulkAffectedEmployees = bulkDept ? employeeList.filter(e => e.department === bulkDept) : [];
  const managementUsers = users.filter(u => (u.custom_role || u.role) === 'management');

  const toggleKeepManagement = (id) => {
    setKeepManagementIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runBulkReassign = async () => {
    setBulkApplying(true);
    try {
      const res = await base44.functions.invoke('bulkReassignReportingManager', {
        department: bulkDept,
        new_manager_user_id: bulkManagerId,
      });
      if (res.data?.success) {
        toast.success(`Reassigned ${res.data.updated} employee(s) in "${bulkDept}"${res.data.promoted_manager ? ' — new manager granted Manager role' : ''}`);
        setBulkDept('');
        setBulkManagerId('');
        await loadUsers();
      } else {
        toast.error(res.data?.error || 'Failed to reassign reporting manager');
      }
    } catch (error) {
      toast.error('Failed to reassign reporting manager');
    } finally {
      setBulkApplying(false);
      setConfirmAction(null);
    }
  };

  const handleBulkReassignClick = () => {
    if (!bulkDept || !bulkManagerId) { toast.error('Select a department and a new reporting manager'); return; }
    const newManagerName = employeeList.find(e => e.user_id === bulkManagerId)?.display_name || 'the selected employee';
    setConfirmAction({
      title: 'Reassign Reporting Manager',
      description: `This will set "${newManagerName}" as the reporting manager for all ${bulkAffectedEmployees.length} active employee(s) in "${bulkDept}". Continue?`,
      onConfirm: runBulkReassign,
    });
  };

  const runConvertManagement = async () => {
    setRoleCleanupApplying(true);
    try {
      const res = await base44.functions.invoke('bulkConvertManagementToManager', {
        keep_management_user_ids: Array.from(keepManagementIds),
      });
      if (res.data?.success) {
        toast.success(`${res.data.converted} converted to Manager, ${res.data.promoted} team lead(s) auto-promoted to Manager, ${res.data.kept_management} kept as Management`);
        setKeepManagementIds(new Set());
        await loadUsers();
      } else {
        toast.error(res.data?.error || 'Failed to convert roles');
      }
    } catch (error) {
      toast.error('Failed to convert roles');
    } finally {
      setRoleCleanupApplying(false);
      setConfirmAction(null);
    }
  };

  const handleConvertManagementClick = () => {
    const toConvert = managementUsers.length - keepManagementIds.size;
    if (toConvert <= 0) { toast.error('Nothing to convert — every Management user is checked to stay Management'); return; }
    setConfirmAction({
      title: 'Convert Management to Manager',
      description: `${keepManagementIds.size} user(s) will stay Management. ${toConvert} user(s) will be converted to Manager (scoped to their own team only). Any other user who is someone's reporting manager will also be promoted to Manager. Continue?`,
      onConfirm: runConvertManagement,
    });
  };

  const runBackfill = async () => {
    setBackfillRunning(true);
    try {
      const res = await base44.functions.invoke('backfillReportingManagerIds', {});
      if (res.data?.success) {
        toast.success(`Linked ${res.data.wired} employee(s) to their manager · ${res.data.promoted_managers} manager(s) granted Manager role · ${res.data.not_found} manager email(s) not found`);
        await loadUsers();
      } else {
        toast.error(res.data?.error || 'Backfill failed');
      }
    } catch (error) {
      toast.error('Backfill failed');
    } finally {
      setBackfillRunning(false);
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p>Admin role required to access User Role Management.</p>
      </div>
    );
  }

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

        {/* One-time data repair */}
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Wrench className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Repair Reporting-Manager Links</p>
                <p className="text-xs text-amber-800/80 mt-0.5">
                  Some older employee records only recorded their manager by email (legacy import), never by ID — those employees are invisible
                  on their manager's dashboard and don't count toward that manager's approval scope. Run this once to link them by ID and
                  auto-grant Manager role to anyone this reveals as a reporting manager. Safe to re-run; already-linked records are skipped.
                </p>
              </div>
            </div>
            <Button variant="outline" className="border-amber-300 shrink-0" disabled={backfillRunning} onClick={runBackfill}>
              {backfillRunning ? 'Running...' : 'Run Repair'}
            </Button>
          </CardContent>
        </Card>

        {/* Bulk Admin Tools */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowRightLeft className="w-4 h-4 text-blue-600" /> Bulk Reassign Reporting Manager
              </CardTitle>
              <p className="text-xs text-gray-500 pt-1">Change the reporting manager for every active employee in a department in one go.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={bulkDept} onValueChange={v => { setBulkDept(v); setBulkManagerId(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d.id} value={d.name}>{d.name} ({d.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {bulkDept && <p className="text-xs text-gray-500">{bulkAffectedEmployees.length} active employee(s) in this department</p>}
              </div>

              <div className="space-y-2">
                <Label>New Reporting Manager</Label>
                <Popover open={bulkManagerOpen} onOpenChange={setBulkManagerOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" disabled={!bulkDept} className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed">
                      <span className={bulkManagerId ? 'text-foreground' : 'text-muted-foreground'}>
                        {bulkManagerId ? (employeeList.find(e => e.user_id === bulkManagerId)?.display_name || bulkManagerId) : 'Select employee...'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search employee..." />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          {employeeList.map(e => (
                            <CommandItem key={e.user_id} value={`${e.display_name || ''} ${e.designation || ''}`} onSelect={() => { setBulkManagerId(e.user_id); setBulkManagerOpen(false); }}>
                              <Check className={`mr-2 h-4 w-4 ${bulkManagerId === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                              {e.display_name || e.user_id} {e.designation ? `· ${e.designation}` : ''}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <Button className="w-full" disabled={!bulkDept || !bulkManagerId || bulkApplying} onClick={handleBulkReassignClick}>
                Reassign All in Department
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCog className="w-4 h-4 text-blue-600" /> Convert Management to Manager
              </CardTitle>
              <p className="text-xs text-gray-500 pt-1">Check who should stay org-wide Management. Everyone else converts to Manager, scoped to their own team.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {managementUsers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No users currently hold the Management role.</p>
              ) : (
                <>
                  <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
                    {managementUsers.map(u => {
                      const emp = employees[u.id];
                      const keep = keepManagementIds.has(u.id);
                      return (
                        <label key={u.id} className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50">
                          <input type="checkbox" checked={keep} onChange={() => toggleKeepManagement(u.id)} className="rounded" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{emp?.display_name || u.full_name}</p>
                            <p className="text-xs text-gray-500 truncate">{u.email}{emp?.department ? ` · ${emp.department}` : ''}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{keepManagementIds.size} stay Management · {managementUsers.length - keepManagementIds.size} convert to Manager</span>
                    {keepManagementIds.size !== 5 && (
                      <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="w-3 h-3" /> Expected 5</span>
                    )}
                  </div>
                  <Button className="w-full" variant="destructive" disabled={roleCleanupApplying} onClick={handleConvertManagementClick}>
                    Convert Unchecked to Manager
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
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
              <Popover open={managerOpen} onOpenChange={setManagerOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                    <span className={editForm.reporting_manager_id ? 'text-foreground' : 'text-muted-foreground'}>
                      {editForm.reporting_manager_id ? (Object.values(employees).find(e => e.user_id === editForm.reporting_manager_id)?.display_name || editForm.reporting_manager_id) : '— None —'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search manager..." />
                    <CommandList>
                      <CommandEmpty>No employee found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="none" onSelect={() => { setEditForm(f => ({ ...f, reporting_manager_id: '' })); setManagerOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${!editForm.reporting_manager_id ? 'opacity-100' : 'opacity-0'}`} /> — None —
                        </CommandItem>
                        {Object.values(employees).filter(e => e.user_id !== editUser?.id).map(e => (
                          <CommandItem key={e.user_id} value={`${e.display_name || ''} ${e.designation || ''}`} onSelect={() => { setEditForm(f => ({ ...f, reporting_manager_id: e.user_id })); setManagerOpen(false); }}>
                            <Check className={`mr-2 h-4 w-4 ${editForm.reporting_manager_id === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                            {e.display_name || e.user_id} {e.designation ? `· ${e.designation}` : ''}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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

      {/* Confirm Dialog for bulk admin actions */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && !bulkApplying && !roleCleanupApplying && setConfirmAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{confirmAction?.title}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmAction?.description}</p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" disabled={bulkApplying || roleCleanupApplying} onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={bulkApplying || roleCleanupApplying} onClick={() => confirmAction?.onConfirm()}>
              {(bulkApplying || roleCleanupApplying) ? 'Applying...' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}