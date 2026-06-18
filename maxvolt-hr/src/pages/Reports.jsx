import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Users, Clock, FileText, DollarSign, TrendingUp } from 'lucide-react';

export default function Reports() {
  const [stats, setStats] = useState({
    totalEmployees: 0,
    activeEmployees: 0,
    avgAttendance: 0,
    totalLeaves: 0,
    pendingLeaves: 0,
    totalPayroll: 0
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const users = await base44.entities.User.list();
      const totalEmployees = users.length;
      const activeEmployees = users.filter(u => u.status === 'active').length;

      const attendance = await base44.entities.Attendance.list();
      const presentCount = attendance.filter(a => a.status === 'present').length;
      const avgAttendance = attendance.length > 0 ? (presentCount / attendance.length * 100).toFixed(1) : 0;

      const leaves = await base44.entities.Leave.list();
      const pendingLeaves = leaves.filter(l => l.status === 'pending').length;

      const payrolls = await base44.entities.Payroll.list();
      const totalPayroll = payrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);

      setStats({
        totalEmployees,
        activeEmployees,
        avgAttendance,
        totalLeaves: leaves.length,
        pendingLeaves,
        totalPayroll
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">HR Reports & Analytics</h1>
          <p className="text-gray-600 mt-1">Overview of key HR metrics</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-8 h-8 text-blue-600" />
                <div>
                  <p className="text-3xl font-bold">{stats.totalEmployees}</p>
                  <p className="text-sm text-gray-600">Total Employees</p>
                </div>
              </div>
              <p className="text-sm text-green-600">{stats.activeEmployees} Active</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <Clock className="w-8 h-8 text-green-600" />
                <div>
                  <p className="text-3xl font-bold">{stats.avgAttendance}%</p>
                  <p className="text-sm text-gray-600">Avg Attendance</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-8 h-8 text-purple-600" />
                <div>
                  <p className="text-3xl font-bold">{stats.totalLeaves}</p>
                  <p className="text-sm text-gray-600">Total Leaves</p>
                </div>
              </div>
              <p className="text-sm text-yellow-600">{stats.pendingLeaves} Pending</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="w-8 h-8 text-green-600" />
                <div>
                  <p className="text-2xl font-bold">₹{(stats.totalPayroll / 100000).toFixed(1)}L</p>
                  <p className="text-sm text-gray-600">Total Payroll</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-8 h-8 text-blue-600" />
                <div>
                  <p className="text-3xl font-bold">-</p>
                  <p className="text-sm text-gray-600">Attrition Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <BarChart className="w-8 h-8 text-orange-600" />
                <div>
                  <p className="text-3xl font-bold">-</p>
                  <p className="text-sm text-gray-600">Headcount Trends</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Detailed Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500 text-center py-8">
              Advanced reporting features coming soon
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}