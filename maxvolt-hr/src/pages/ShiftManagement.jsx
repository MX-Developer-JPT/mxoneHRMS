import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Clock, Users, Edit, Trash2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Building2, Search } from 'lucide-react';
import { toast } from 'sonner';

export default function ShiftManagement() {
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importFileRef = useRef(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingShift, setEditingShift] = useState(null);
  const [showDeptDialog, setShowDeptDialog] = useState(false);
  const [deptAssignments, setDeptAssignments] = useState({});
  const [deptAssigning, setDeptAssigning] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  // HR/admin/management: full access (shift definitions + assign anyone).
  // A department shift manager (Employee.is_shift_manager): assignment only,
  // scoped to their own department — see loadData/assignEmployeeShift.
  const [isPrivileged, setIsPrivileged] = useState(true);
  const [myDepartment, setMyDepartment] = useState(null);
  const [canAccess, setCanAccess] = useState(true); // false once loadData confirms neither privileged nor a granted shift manager
  const [accessChecked, setAccessChecked] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    start_time: '',
    end_time: '',
    working_hours: 8,
    grace_period_minutes: 15,
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    is_default: false
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [currentUser, shiftsData, empsData] = await Promise.all([
        base44.auth.me(),
        base44.entities.Shift.list(),
        base44.entities.Employee.list(),
      ]);

      // Fetch users to enrich employee data
      const usersResponse = await base44.functions.invoke('getAllUsers', {});
      const allUsers = usersResponse.data.users;

      // NOTE: shift assignment intentionally still includes HR/admin/recruiter
      // — they're operators of the app for org-chart/directory/headcount
      // purposes, but still need a shift assigned for attendance calculation.
      const enrichedEmps = empsData.map(emp => ({
        ...emp,
        user: allUsers.find(u => u.id === emp.user_id)
      }));

      const role = currentUser.custom_role || currentUser.role;
      const privileged = ['hr', 'admin', 'management'].includes(role);
      const ownEmp = enrichedEmps.find(e => e.user_id === currentUser.id) || null;
      const isShiftManager = !privileged && !!ownEmp?.is_shift_manager;
      setIsPrivileged(privileged);
      setCanAccess(privileged || isShiftManager);
      setMyDepartment(ownEmp?.department || null);
      // A department shift manager only ever sees/acts on their own
      // department's roster — the backend enforces this independently
      // (assignEmployeeShift), this is just so the UI doesn't even show
      // employees they couldn't act on anyway. Anyone with neither
      // privileged access nor the shift-manager grant sees nothing at all
      // (this page has no nav-level gate, so it's reachable by direct URL).
      const scopedEmps = privileged
        ? enrichedEmps
        : isShiftManager
          ? enrichedEmps.filter(e => e.department === ownEmp.department)
          : [];

      setShifts(shiftsData);
      setEmployees(scopedEmps);
      setAccessChecked(true);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingShift) {
        await base44.entities.Shift.update(editingShift.id, formData);
        toast.success('Shift updated successfully');
        // Attendance status (late / early-departure / overtime) is computed
        // from raw punches at check-in/out time and stored on the
        // Attendance row — it does NOT recompute itself when the shift's
        // grace period/start-end time changes afterwards. Without this,
        // e.g. widening the grace period from 15 to 30 minutes would leave
        // everyone who already punched in today still marked "late" under
        // the old rule until someone happened to run a reprocess. Refresh
        // the current month now so the change is reflected immediately.
        const now = new Date();
        reprocessCurrentMonth(now.getMonth() + 1, now.getFullYear());
      } else {
        await base44.entities.Shift.create(formData);
        toast.success('Shift created successfully');
      }
      setShowDialog(false);
      setEditingShift(null);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Error saving shift:', error);
      toast.error('Failed to save shift');
    }
  };

  // Fire-and-forget — re-derives status for every non-regularised Attendance
  // row this month from its raw punches using the shift's current settings.
  // Never blocks the save; a failure here just means HR needs to run
  // Reprocess Attendance from Admin Panel manually, same as before this
  // auto-trigger existed.
  const reprocessCurrentMonth = async (month, year) => {
    try {
      const res = await base44.functions.invoke('processMonthAttendance', { month, year, dry_run: false });
      const d = res.data || res;
      if (d.success) toast.success(`Attendance re-checked for this month (${d.processed ?? 0} record(s) updated) to reflect the new shift settings`);
    } catch (err) {
      console.warn('[ShiftManagement] auto-reprocess failed:', err.message);
    }
  };

  const handleEdit = (shift) => {
    setEditingShift(shift);
    setFormData({
      name: shift.name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      working_hours: shift.working_hours,
      grace_period_minutes: shift.grace_period_minutes,
      days: shift.days || [],
      is_default: shift.is_default
    });
    setShowDialog(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this shift?')) return;
    try {
      await base44.entities.Shift.delete(id);
      toast.success('Shift deleted successfully');
      loadData();
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast.error('Failed to delete shift');
    }
  };

  // Both assignment paths go through the assignEmployeeShift function (not
  // a raw Employee.update) so the department-scoped shift-manager
  // authorization is enforced server-side identically for HR/admin and for
  // a granted shift manager — see backend/routes/functions.js.
  const assignShift = async (employeeId, shiftId) => {
    try {
      const res = await base44.functions.invoke('assignEmployeeShift', { employee_ids: [employeeId], shift_id: shiftId === 'none' ? null : shiftId });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Failed to assign shift'); return; }
      toast.success('Shift assigned successfully');
      loadData();
    } catch (error) {
      console.error('Error assigning shift:', error);
      toast.error(error.message || 'Failed to assign shift');
    }
  };

  const handleAssignByDepartment = async () => {
    const toAssign = Object.entries(deptAssignments).filter(([, shiftId]) => shiftId);
    if (toAssign.length === 0) { toast.error('Select a shift for at least one department'); return; }
    setDeptAssigning(true);
    try {
      let count = 0;
      for (const [dept, shiftId] of toAssign) {
        const deptEmpIds = employees.filter(e => e.status === 'active' && e.department === dept).map(e => e.id);
        if (!deptEmpIds.length) continue;
        const res = await base44.functions.invoke('assignEmployeeShift', { employee_ids: deptEmpIds, shift_id: shiftId === 'none' ? null : shiftId });
        const d = res.data || res;
        if (!d.success) throw new Error(d.error || `Failed to assign shift for ${dept}`);
        count += d.updated;
      }
      toast.success(`Shift assigned to ${count} employee${count !== 1 ? 's' : ''} across ${toAssign.length} department${toAssign.length !== 1 ? 's' : ''}`);
      setShowDeptDialog(false);
      setDeptAssignments({});
      loadData();
    } catch (e) {
      toast.error('Failed to assign shifts: ' + e.message);
    } finally {
      setDeptAssigning(false);
    }
  };

  const toggleShiftManager = async (emp) => {
    const next = !emp.is_shift_manager;
    try {
      const res = await base44.functions.invoke('setShiftManager', { employee_id: emp.id, is_shift_manager: next });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Failed to update'); return; }
      toast.success(next
        ? `${emp.display_name || emp.user?.full_name} can now reassign shifts within ${emp.department || 'their department'}`
        : `Shift-management rights revoked for ${emp.display_name || emp.user?.full_name}`);
      loadData();
    } catch (e) {
      toast.error(e.message || 'Failed to update');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      start_time: '',
      end_time: '',
      working_hours: 8,
      grace_period_minutes: 15,
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      is_default: false
    });
  };

  const handleImportFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        // Loaded on demand — xlsx is a ~430KB chunk this page shouldn't pay
        // for until someone actually clicks Import.
        const XLSX = await import('xlsx');
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        // Normalise column names
        const rows = raw.map(r => {
          const keys = Object.keys(r);
          const get = (...names) => {
            for (const n of names) {
              const k = keys.find(k => k.trim().toUpperCase().includes(n.toUpperCase()));
              if (k) return String(r[k]).trim();
            }
            return '';
          };
          return {
            employee_code: get('EMPLOYEE CODE', 'EMP CODE', 'EMPLOYEE ID', 'EMP ID', 'CODE'),
            shift_name:    get('SHIFT NAME', 'SHIFT', 'SHIFT TYPE'),
          };
        }).filter(r => r.employee_code && r.shift_name);
        setImportRows(rows);
        setImportResult(null);
        toast.success(`Loaded ${rows.length} rows from Excel`);
      } catch (err) {
        toast.error('Failed to parse Excel: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImportShifts = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    try {
      const response = await base44.functions.invoke('importShiftAssignments', { rows: importRows });
      const d = response.data;
      setImportResult(d);
      if (d.success) {
        toast.success(`Assigned shifts to ${d.assigned} employees`);
        loadData();
      } else {
        toast.error('Import failed');
      }
    } catch (err) {
      toast.error('Import error: ' + err.message);
    }
    setImporting(false);
  };

  const getEmployeeCountForShift = (shiftId) => {
    return employees.filter(e => e.shift_id === shiftId).length;
  };

  const activeEmployees = employees.filter(e => e.status === 'active');
  const searchQ = employeeSearch.trim().toLowerCase();
  const filteredEmployees = searchQ
    ? activeEmployees.filter(emp => {
        const shiftName = shifts.find(s => s.id === emp.shift_id)?.name || '';
        return [emp.display_name, emp.user?.full_name, emp.employee_code, emp.department, emp.designation, shiftName]
          .some(v => (v || '').toLowerCase().includes(searchQ));
      })
    : activeEmployees;

  if (accessChecked && !canAccess) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <h2 className="font-semibold text-gray-800 mb-1">Access Denied</h2>
          <p className="text-sm text-gray-500">You don't have shift-management access. Ask HR/Admin to grant you shift-manager rights for your department if you need to reassign shifts for your team.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* flex-col on mobile — at full flex-row width the button group sat
            beside the title instead of below it, and once "Shift Management"
            wrapped to two lines at this font size the vertically-centered
            buttons visually overlapped the second line. */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-3xl font-bold">Shift Management</h1>
            <p className="text-gray-600 mt-1">Create and manage work shifts</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Assign by Department dialog */}
            <Dialog open={showDeptDialog} onOpenChange={(open) => { setShowDeptDialog(open); if (!open) setDeptAssignments({}); }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Building2 className="w-4 h-4 mr-2" />
                  Assign by Department
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-600" />
                    Assign Shift by Department
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    Select a shift for one or more departments. All active employees in the chosen departments will be updated at once.
                  </p>
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {[...new Set(employees.filter(e => e.status === 'active' && e.department).map(e => e.department))].sort().map(dept => {
                      const count = employees.filter(e => e.status === 'active' && e.department === dept).length;
                      return (
                        <div key={dept} className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-white hover:bg-gray-50">
                          <div>
                            <p className="font-medium text-sm">{dept}</p>
                            <p className="text-xs text-gray-500">{count} active employee{count !== 1 ? 's' : ''}</p>
                          </div>
                          <Select
                            value={deptAssignments[dept] || ''}
                            onValueChange={(val) => setDeptAssignments(prev => ({ ...prev, [dept]: val }))}
                          >
                            <SelectTrigger className="w-52">
                              <SelectValue placeholder="Select shift…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No Shift</SelectItem>
                              {shifts.map(shift => (
                                <SelectItem key={shift.id} value={shift.id}>
                                  {shift.name} ({shift.start_time}–{shift.end_time})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                    {employees.filter(e => e.status === 'active' && e.department).length === 0 && (
                      <p className="text-center py-6 text-gray-400 text-sm">No departments found in active employees.</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" onClick={() => setShowDeptDialog(false)}>Cancel</Button>
                    <Button
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={handleAssignByDepartment}
                      disabled={deptAssigning || Object.values(deptAssignments).every(v => !v)}
                    >
                      {deptAssigning ? 'Assigning…' : 'Apply to Departments'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Import Shift Assignments dialog — HR/admin only (no per-row
                department check in importShiftAssignments, so this stays
                out of a department shift manager's reduced toolset). */}
            {isPrivileged && <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" onClick={() => { setImportRows([]); setImportResult(null); }}>
                  <Upload className="w-4 h-4 mr-2" />
                  Import Assignments
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-green-600" />
                    Import Shift Assignments from Excel
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                    Excel must have columns: <strong>EMPLOYEE CODE</strong> and <strong>SHIFT NAME</strong>.
                    Shift names must match exactly what's created in this page.
                  </div>
                  <div>
                    <Label>Select Excel File</Label>
                    <input ref={importFileRef} type="file" accept=".xlsx,.xls"
                      className="hidden" onChange={handleImportFileUpload} />
                    <Button variant="outline" className="mt-1 w-full" onClick={() => importFileRef.current?.click()}>
                      <Upload className="w-4 h-4 mr-2" /> Choose File
                    </Button>
                  </div>
                  {importRows.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">{importRows.length} rows loaded — Preview (first 10):</p>
                      <div className="overflow-auto max-h-48 border rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left">Employee Code</th>
                              <th className="px-3 py-2 text-left">Shift Name</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.slice(0, 10).map((r, i) => (
                              <tr key={i} className={i % 2 ? 'bg-gray-50' : ''}>
                                <td className="px-3 py-1 font-mono">{r.employee_code}</td>
                                <td className="px-3 py-1">{r.shift_name}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-xs text-gray-500">Available shifts: {shifts.map(s => s.name).join(', ')}</div>
                      <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleImportShifts} disabled={importing}>
                        {importing ? 'Importing…' : `Assign Shifts for ${importRows.length} Employees`}
                      </Button>
                    </div>
                  )}
                  {importResult && (
                    <div className={`p-3 rounded-lg border ${importResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex items-center gap-2 font-medium text-sm mb-1">
                        {importResult.success ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertCircle className="w-4 h-4 text-red-600" />}
                        {importResult.message}
                      </div>
                      {importResult.not_found_employees?.length > 0 && (
                        <p className="text-xs text-orange-700">Employees not found: {importResult.not_found_employees.join(', ')}</p>
                      )}
                      {importResult.not_found_shifts?.length > 0 && (
                        <p className="text-xs text-orange-700">Shifts not found: {importResult.not_found_shifts.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>}

            {/* Shift definitions (create/edit) stay HR/admin-only — a
                department shift manager may only assign/reassign EXISTING
                shifts, never define new ones or change shared shift settings. */}
            {isPrivileged && <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button onClick={() => { setEditingShift(null); resetForm(); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Shift
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingShift ? 'Edit Shift' : 'Create New Shift'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Shift Name</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Morning Shift"
                      required
                    />
                  </div>
                  <div>
                    <Label>Working Hours</Label>
                    <Input
                      type="number"
                      value={formData.working_hours}
                      onChange={(e) => setFormData({ ...formData, working_hours: parseFloat(e.target.value) })}
                      required
                    />
                  </div>
                  <div>
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      required
                    />
                    {/* Overnight shift note — end <= start (e.g. 20:00 -> 08:00) is fully
                        supported: attendance/late/overtime/gate-pass calculations all
                        correctly anchor the shift's end to the day AFTER it started. */}
                    {formData.start_time && formData.end_time && formData.end_time <= formData.start_time && (
                      <p className="text-xs text-indigo-600 mt-1">Overnight shift — ends at {formData.end_time} the following day.</p>
                    )}
                  </div>
                  <div>
                    <Label>Grace Period (minutes)</Label>
                    <Input
                      type="number"
                      value={formData.grace_period_minutes}
                      onChange={(e) => setFormData({ ...formData, grace_period_minutes: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="flex gap-4 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingShift ? 'Update' : 'Create'} Shift
                  </Button>
                </div>
              </form>
            </DialogContent>
            </Dialog>}
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {shifts.map(shift => (
            <Card key={shift.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {shift.name}
                      {shift.is_default && <Badge>Default</Badge>}
                    </CardTitle>
                    <p className="text-sm text-gray-600 mt-1">
                      <Clock className="w-4 h-4 inline mr-1" />
                      {shift.start_time} - {shift.end_time}
                    </p>
                  </div>
                  {isPrivileged && (
                    <div className="flex gap-2">
                      <Button size="icon" variant="ghost" onClick={() => handleEdit(shift)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(shift.id)}>
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">Working Hours: <strong>{shift.working_hours}h</strong></p>
                  <p className="text-sm text-gray-600">Grace Period: <strong>{shift.grace_period_minutes} mins</strong></p>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span className="text-sm">{getEmployeeCountForShift(shift.id)} employees</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle>Assign Shifts to Employees</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search name, code, department, shift…"
                value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredEmployees.map(emp => (
                <div key={emp.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-3 bg-white hover:bg-gray-50 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-semibold">
                          {(emp.display_name || emp.user?.full_name)?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{emp.display_name || emp.user?.full_name}</p>
                          <Badge variant="outline" className="text-xs">{emp.employee_code}</Badge>
                        </div>
                        <p className="text-sm text-gray-600">{emp.designation} • {emp.department}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select
                      value={emp.shift_id || 'none'}
                      onValueChange={(value) => assignShift(emp.id, value === 'none' ? null : value)}
                    >
                      <SelectTrigger className="w-full sm:w-64">
                        <SelectValue placeholder="Select Shift" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Shift</SelectItem>
                        {shifts.map(shift => (
                          <SelectItem key={shift.id} value={shift.id}>
                            {shift.name} ({shift.start_time} - {shift.end_time})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Grants this employee the right to reassign shifts for
                        their own department's employees — see
                        assignEmployeeShift/setShiftManager on the backend.
                        HR/admin-only control. */}
                    {isPrivileged && (
                      <Button
                        size="sm"
                        variant={emp.is_shift_manager ? 'default' : 'outline'}
                        className={emp.is_shift_manager ? 'bg-indigo-600 hover:bg-indigo-700' : ''}
                        onClick={() => toggleShiftManager(emp)}
                        title={`${emp.is_shift_manager ? 'Revoke' : 'Grant'} shift-management rights for ${emp.department || 'their department'}`}
                      >
                        <Users className="w-3.5 h-3.5 mr-1" />
                        {emp.is_shift_manager ? 'Shift Manager' : 'Make Shift Manager'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {filteredEmployees.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <p>{activeEmployees.length === 0 ? 'No active employees found' : `No employees match "${employeeSearch}"`}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}