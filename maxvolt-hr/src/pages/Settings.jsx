import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, Building, Calendar, Users } from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const [departments, setDepartments] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [leavePolicies, setLeavePolicies] = useState([]);
  const [shifts, setShifts] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const depts = await base44.entities.Department.list();
      setDepartments(depts);

      const hols = await base44.entities.Holiday.filter({ year: new Date().getFullYear() });
      setHolidays(hols);

      const policies = await base44.entities.LeavePolicy.list();
      setLeavePolicies(policies);

      const shiftData = await base44.entities.Shift.list();
      setShifts(shiftData);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-gray-600 mt-1">Manage system configuration</p>
        </div>

        <Tabs defaultValue="departments" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="departments">Departments</TabsTrigger>
            <TabsTrigger value="holidays">Holidays</TabsTrigger>
            <TabsTrigger value="leaves">Leave Policies</TabsTrigger>
            <TabsTrigger value="shifts">Shifts</TabsTrigger>
          </TabsList>

          <TabsContent value="departments">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="w-6 h-6" />
                  Departments ({departments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {departments.map(dept => (
                    <Card key={dept.id}>
                      <CardContent className="p-4">
                        <p className="font-semibold">{dept.name}</p>
                        <p className="text-sm text-gray-600">{dept.code}</p>
                        {dept.description && (
                          <p className="text-xs text-gray-500 mt-2">{dept.description}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="holidays">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-6 h-6" />
                  Holidays ({holidays.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {holidays.map(holiday => (
                    <div key={holiday.id} className="border rounded-lg p-3 flex justify-between items-center">
                      <div>
                        <p className="font-semibold">{holiday.name}</p>
                        <p className="text-sm text-gray-600 capitalize">{holiday.type}</p>
                      </div>
                      <p className="text-sm font-medium">{holiday.date}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaves">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-6 h-6" />
                  Leave Policies ({leavePolicies.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {leavePolicies.map(policy => (
                    <Card key={policy.id}>
                      <CardContent className="p-4">
                        <p className="font-semibold">{policy.name}</p>
                        <p className="text-sm text-gray-600">Code: {policy.code}</p>
                        <p className="text-sm text-gray-600">Total Days: {policy.total_days}</p>
                        {policy.description && (
                          <p className="text-xs text-gray-500 mt-2">{policy.description}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shifts">
            <Card>
              <CardHeader>
                <CardTitle>Shift Timings ({shifts.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {shifts.map(shift => (
                    <div key={shift.id} className="border rounded-lg p-4">
                      <p className="font-semibold">{shift.name}</p>
                      <p className="text-sm text-gray-600">
                        {shift.start_time} - {shift.end_time}
                      </p>
                      <p className="text-sm text-gray-600">
                        Working Hours: {shift.working_hours}h
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}