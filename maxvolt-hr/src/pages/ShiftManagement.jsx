import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Clock, Users, Edit, Trash2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
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
      const shiftsData = await base44.entities.Shift.list();
      const empsData = await base44.entities.Employee.list();
      
      // Fetch users to enrich employee data
      const usersResponse = await base44.functions.invoke('getAllUsers', {});
      const allUsers = usersResponse.data.users;
      
      const enrichedEmps = empsData.map(emp => ({
        ...emp,
        user: allUsers.find(u => u.id === emp.user_id)
      }));
      
      setShifts(shiftsData);
      setEmployees(enrichedEmps);
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

  const assignShift = async (employeeId, shiftId) => {
    try {
      await base44.entities.Employee.update(employeeId, { shift_id: shiftId });
      toast.success('Shift assigned successfully');
      loadData();
    } catch (error) {
      console.error('Error assigning shift:', error);
      toast.error('Failed to assign shift');
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
    reader.onload = (ev) => {
      try {
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Shift Management</h1>
            <p className="text-gray-600 mt-1">Create and manage work shifts</p>
          </div>
          <div className="flex gap-2">
            {/* Import Shift Assignments dialog */}
            <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
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
            </Dialog>

            <Dialog open={showDialog} onOpenChange={setShowDialog}>
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
            </Dialog>
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
                  <div className="flex gap-2">
                    <Button size="icon" variant="ghost" onClick={() => handleEdit(shift)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(shift.id)}>
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
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
          <CardHeader>
            <CardTitle>Assign Shifts to Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {employees.filter(e => e.status === 'active').map(emp => (
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
                </div>
              ))}
              {employees.filter(e => e.status === 'active').length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <p>No active employees found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}