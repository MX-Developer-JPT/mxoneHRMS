import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { PieChartIcon, AlertTriangle, Users, TrendingUp } from 'lucide-react';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function LeaveDashboard() {
  const [loading, setLoading] = useState(true);
  const [deptData, setDeptData] = useState([]);
  const [nearingLimit, setNearingLimit] = useState([]);
  const [stats, setStats] = useState({ totalLeaves: 0, totalEmployees: 0, avgDays: 0 });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentYear = new Date().getFullYear();
      const [me, leaves, leaveBalances, employees, users, leavePolicies] = await Promise.all([
        base44.auth.me(),
        base44.entities.Leave.filter({ status: 'approved' }),
        base44.entities.LeaveBalance.filter({ year: currentYear }),
        base44.entities.Employee.list(),
        base44.entities.User.list(),
        base44.entities.LeavePolicy.list(),
      ]);

      const role = me?.custom_role || me?.role;
      const isManagerOnly = role === 'manager';

      let activeEmp = employees.filter(e => e.status === 'active');
      let scopedLeaves = leaves;
      let scopedBalances = leaveBalances;

      if (isManagerOnly && me?.id) {
        const teamUserIds = new Set(activeEmp.filter(e => e.reporting_manager_id === me.id).map(e => e.user_id));
        activeEmp = activeEmp.filter(e => teamUserIds.has(e.user_id));
        scopedLeaves = leaves.filter(l => teamUserIds.has(l.user_id));
        scopedBalances = leaveBalances.filter(b => teamUserIds.has(b.user_id));
      }
      // hr, admin, management see all employees — no filtering

      const deptMap = {};

      scopedLeaves.forEach(leave => {
        const emp = employees.find(e => e.user_id === leave.user_id);
        const dept = emp?.department || 'Unassigned';
        if (!deptMap[dept]) deptMap[dept] = { department: dept, totalDays: 0, employees: new Set(), count: 0 };
        deptMap[dept].totalDays += leave.total_days || 0;
        deptMap[dept].employees.add(leave.user_id);
        deptMap[dept].count++;
      });

      const deptArray = Object.values(deptMap).map(d => ({
        ...d,
        employees: d.employees.size,
      })).sort((a, b) => b.totalDays - a.totalDays);

      // Employees nearing limit (used >= 80% of allocated)
      const nearing = [];
      scopedBalances.forEach(bal => {
        if (bal.used && bal.total_allocated && bal.total_allocated > 0) {
          const pct = (bal.used / bal.total_allocated) * 100;
          if (pct >= 80) {
            const emp = employees.find(e => e.user_id === bal.user_id);
            const user = users.find(u => u.id === bal.user_id);
            const policy = leavePolicies.find(p => p.id === bal.leave_policy_id);
            nearing.push({
              name: emp?.display_name || user?.full_name || 'Unknown',
              department: emp?.department || '—',
              policy: policy?.name || '—',
              allocated: bal.total_allocated,
              used: bal.used,
              remaining: bal.available || (bal.total_allocated - bal.used),
              pct,
            });
          }
        }
      });
      nearing.sort((a, b) => b.pct - a.pct);

      const totalLeaves = scopedLeaves.length;
      const avgDays = totalLeaves > 0 ? (scopedLeaves.reduce((s, l) => s + (l.total_days || 0), 0) / totalLeaves) : 0;

      setDeptData(deptArray);
      setNearingLimit(nearing.slice(0, 20));
      setStats({ totalLeaves, totalEmployees: activeEmp.length, avgDays: avgDays.toFixed(1) });
      setLoading(false);
    } catch (error) {
      console.error('Error loading leave data:', error);
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64">Loading...</div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Leave Analytics Dashboard</h1>
          <p className="text-muted-foreground mt-1">Department-wise leave consumption & limit alerts</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                  <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Approved Leaves</p>
                  <p className="text-xl font-bold text-foreground">{stats.totalLeaves}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
                  <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Employees</p>
                  <p className="text-xl font-bold text-foreground">{stats.totalEmployees}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-full">
                  <PieChartIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg Leave Duration</p>
                  <p className="text-xl font-bold text-foreground">{stats.avgDays} days</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nearing Limit</p>
                  <p className="text-xl font-bold text-foreground">{nearingLimit.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Department-wise Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Leave Taken by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {deptData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={deptData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="department" angle={-35} textAnchor="end" fontSize={11} interval={0} />
                  <YAxis />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  <Bar dataKey="totalDays" name="Total Leave Days" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="employees" name="Employees" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-12">No leave data available</p>
            )}
          </CardContent>
        </Card>

        {/* Employees Nearing Annual Limit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Employees Nearing Annual Leave Limit (≥80%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nearingLimit.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium text-muted-foreground">Employee</th>
                      <th className="text-left py-3 px-2 font-medium text-muted-foreground">Department</th>
                      <th className="text-left py-3 px-2 font-medium text-muted-foreground">Leave Type</th>
                      <th className="text-right py-3 px-2 font-medium text-muted-foreground">Allocated</th>
                      <th className="text-right py-3 px-2 font-medium text-muted-foreground">Used</th>
                      <th className="text-right py-3 px-2 font-medium text-muted-foreground">Remaining</th>
                      <th className="text-right py-3 px-2 font-medium text-muted-foreground">Usage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {nearingLimit.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/50">
                        <td className="py-3 px-2 font-medium">{item.name}</td>
                        <td className="py-3 px-2 text-muted-foreground">{item.department}</td>
                        <td className="py-3 px-2">{item.policy}</td>
                        <td className="py-3 px-2 text-right">{item.allocated}</td>
                        <td className="py-3 px-2 text-right text-red-600 dark:text-red-400">{item.used}</td>
                        <td className="py-3 px-2 text-right text-green-600 dark:text-green-400">{item.remaining}</td>
                        <td className="py-3 px-2 text-right">
                          <Badge className={item.pct >= 95 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'}>
                            {Math.round(item.pct)}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No employees nearing their leave limit</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}