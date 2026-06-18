import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Search, ShieldOff, Users, CalendarCheck, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { format, getDaysInMonth, getDay } from 'date-fns';

export default function AttendanceExemption() {
  const [employees, setEmployees] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const emps = await base44.entities.Employee.filter({ status: 'active' });
    setEmployees(emps);
    setLoading(false);
  };

  const [markingPresent, setMarkingPresent] = useState(false);
  const [bulkSaturdayLoading, setBulkSaturdayLoading] = useState(false);

  const bulkToggleSaturdays = async (exempt) => {
    setBulkSaturdayLoading(true);
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const daysInMonth = getDaysInMonth(now);
      const saturdays = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(year, month, d);
        if (getDay(day) === 6) saturdays.push(format(day, 'yyyy-MM-dd'));
      }
      // Get or create attendance records for all active employees on each Saturday
      let count = 0;
      for (const empId of employees.map(e => e.user_id)) {
        for (const sat of saturdays) {
          const existing = await base44.entities.Attendance.filter({ user_id: empId, date: sat });
          if (existing.length > 0) {
            await base44.entities.Attendance.update(existing[0].id, { status: exempt ? 'week_off' : 'present' });
          } else if (exempt) {
            await base44.entities.Attendance.create({ user_id: empId, date: sat, status: 'week_off' });
          }
          count++;
        }
      }
      toast.success(`Saturdays ${exempt ? 'marked as Week Off' : 'set to Working'} for ${employees.length} employees (${saturdays.length} Saturdays)`);
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
    setBulkSaturdayLoading(false);
  };

  const markExemptPresent = async () => {
    setMarkingPresent(true);
    try {
      const now = new Date();
      const res = await base44.functions.invoke('markExemptEmployeesPresent', {
        month: now.getMonth() + 1,
        year: now.getFullYear()
      });
      toast.success(res.data?.message || 'Exempt employees marked present');
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
    setMarkingPresent(false);
  };

  const toggleExemption = async (emp) => {
    setUpdating(prev => ({ ...prev, [emp.id]: true }));
    const newVal = !emp.is_attendance_exempt;
    await base44.entities.Employee.update(emp.id, { is_attendance_exempt: newVal });
    setEmployees(prev =>
      prev.map(e => e.id === emp.id ? { ...e, is_attendance_exempt: newVal } : e)
    );
    toast.success(`${emp.display_name || emp.employee_code} is now ${newVal ? 'exempt from' : 'required for'} attendance`);
    setUpdating(prev => ({ ...prev, [emp.id]: false }));
  };

  const filtered = employees.filter(emp =>
    emp.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.department?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.designation?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exemptCount = employees.filter(e => e.is_attendance_exempt).length;

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Attendance Exemption</h1>
            <p className="text-gray-600 mt-1">Employees marked as exempt will not have salary deductions for attendance</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => bulkToggleSaturdays(true)} disabled={bulkSaturdayLoading} variant="outline" className="border-orange-400 text-orange-700 hover:bg-orange-50">
              <Calendar className="w-4 h-4 mr-2" />
              {bulkSaturdayLoading ? 'Processing...' : 'Saturdays → Week Off'}
            </Button>
            <Button onClick={() => bulkToggleSaturdays(false)} disabled={bulkSaturdayLoading} variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-50">
              <Calendar className="w-4 h-4 mr-2" />
              {bulkSaturdayLoading ? 'Processing...' : 'Saturdays → Working'}
            </Button>
            <Button onClick={markExemptPresent} disabled={markingPresent} className="bg-green-600 hover:bg-green-700">
              <CalendarCheck className="w-4 h-4 mr-2" />
              {markingPresent ? 'Marking...' : `Mark Present (${format(new Date(), 'MMM yyyy')})`}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-full">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Active</p>
                <p className="text-2xl font-bold">{employees.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-purple-100 rounded-full">
                <ShieldOff className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Exempt Employees</p>
                <p className="text-2xl font-bold text-purple-600">{exemptCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by name, code, department..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filtered.map(emp => (
                <div key={emp.id} className="flex items-center justify-between p-4 border rounded-lg bg-white hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 font-semibold">
                        {(emp.display_name || emp.employee_code)?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold">{emp.display_name || emp.employee_code}</p>
                      <p className="text-sm text-gray-500">{emp.designation} · {emp.department} · {emp.employee_code}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {emp.is_attendance_exempt && (
                      <Badge className="bg-purple-100 text-purple-800">Exempt</Badge>
                    )}
                    <Switch
                      checked={!!emp.is_attendance_exempt}
                      onCheckedChange={() => toggleExemption(emp)}
                      disabled={!!updating[emp.id]}
                    />
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="text-center py-10 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No employees found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}