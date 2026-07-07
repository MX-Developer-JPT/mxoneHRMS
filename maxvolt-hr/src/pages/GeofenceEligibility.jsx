import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Search, Radar, Users, MapPinned } from 'lucide-react';
import { toast } from 'sonner';

// HR-only control over WHO is tracked for geofence-based auto attendance.
// There is deliberately no employee-facing on/off switch anywhere in the
// app — eligible employees are tracked automatically (background on the
// native app, in-app foreground fallback otherwise) with no way for them to
// disable it. This is the single place that decision is made.
export default function GeofenceEligibility() {
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

  const toggleEligibility = async (emp) => {
    setUpdating(prev => ({ ...prev, [emp.id]: true }));
    const newVal = !emp.geofence_eligible;
    try {
      await base44.entities.Employee.update(emp.id, { geofence_eligible: newVal });
      setEmployees(prev =>
        prev.map(e => e.id === emp.id ? { ...e, geofence_eligible: newVal } : e)
      );
      toast.success(`${emp.display_name || emp.employee_code} is ${newVal ? 'now tracked for' : 'no longer tracked for'} geofence-based attendance`);
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
    setUpdating(prev => ({ ...prev, [emp.id]: false }));
  };

  const filtered = employees.filter(emp =>
    emp.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.department?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.designation?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.work_location?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const eligibleCount = employees.filter(e => e.geofence_eligible).length;

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Geofence Attendance Eligibility</h1>
          <p className="text-gray-600 mt-1">
            Employees switched on here are tracked automatically for geofence-based attendance —
            they get no option to turn this off themselves.
          </p>
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
              <div className="p-3 bg-orange-100 rounded-full">
                <Radar className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Geofence Tracked</p>
                <p className="text-2xl font-bold text-orange-600">{eligibleCount}</p>
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
                  placeholder="Search by name, code, department, location..."
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
                <div key={emp.id} className="flex items-center justify-between p-4 border rounded-lg bg-white hover:bg-gray-50 transition-colors gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 font-semibold">
                        {(emp.display_name || emp.employee_code)?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{emp.display_name || emp.employee_code}</p>
                      <p className="text-sm text-gray-500 truncate">{emp.designation} · {emp.department} · {emp.employee_code}</p>
                      {emp.work_location && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <MapPinned className="w-3 h-3" /> {emp.work_location}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {emp.geofence_eligible && (
                      <Badge className="bg-orange-100 text-orange-800">Tracked</Badge>
                    )}
                    <Switch
                      checked={!!emp.geofence_eligible}
                      onCheckedChange={() => toggleEligibility(emp)}
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
