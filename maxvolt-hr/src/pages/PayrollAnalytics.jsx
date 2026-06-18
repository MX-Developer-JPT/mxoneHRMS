import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Users, DollarSign, Building2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function PayrollAnalytics() {
  const [payrolls, setPayrolls] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [payrollData, empData, deptData] = await Promise.all([
        base44.entities.Payroll.list('-created_date', 1000),
        base44.entities.Employee.list(),
        base44.entities.Department.list()
      ]);

      setPayrolls(payrollData);
      setEmployees(empData);
      setDepartments(deptData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading analytics:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  // Filter payrolls for selected month
  const currentMonthPayrolls = payrolls.filter(p => p.month === selectedMonth && p.year === selectedYear);
  const previousMonthPayrolls = payrolls.filter(p => 
    p.month === (selectedMonth === 1 ? 12 : selectedMonth - 1) && 
    p.year === (selectedMonth === 1 ? selectedYear - 1 : selectedYear)
  );

  // Overall company metrics
  const totalCurrentCost = currentMonthPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);
  const totalPreviousCost = previousMonthPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);
  const costChange = totalCurrentCost - totalPreviousCost;
  const costChangePercent = totalPreviousCost > 0 ? ((costChange / totalPreviousCost) * 100).toFixed(1) : 0;

  // Department-wise breakdown
  const deptWiseData = departments.map(dept => {
    const deptEmployees = employees.filter(e => e.department === dept.code);
    const deptPayrolls = currentMonthPayrolls.filter(p => 
      deptEmployees.some(e => e.user_id === p.user_id)
    );
    const prevDeptPayrolls = previousMonthPayrolls.filter(p => 
      deptEmployees.some(e => e.user_id === p.user_id)
    );

    const currentCost = deptPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);
    const previousCost = prevDeptPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);
    
    return {
      name: dept.name,
      code: dept.code,
      currentCost,
      previousCost,
      change: currentCost - previousCost,
      employeeCount: deptEmployees.length,
      payrollCount: deptPayrolls.length
    };
  });

  // New joinings analysis
  const newJoinings = employees.filter(e => {
    const joinDate = new Date(e.date_of_joining);
    return joinDate.getMonth() + 1 === selectedMonth && joinDate.getFullYear() === selectedYear;
  });

  const newJoiningsCost = currentMonthPayrolls.filter(p => 
    newJoinings.some(e => e.user_id === p.user_id)
  ).reduce((sum, p) => sum + (p.net_salary || 0), 0);

  // Attendance impact
  const lowAttendancePayrolls = currentMonthPayrolls.filter(p => p.loss_of_pay_days > 0);
  const lopImpact = lowAttendancePayrolls.reduce((sum, p) => sum + ((p.loss_of_pay_days || 0) * (p.basic_salary || 0) / 30), 0);

  // Month-wise trend (last 6 months)
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    let month = selectedMonth - i;
    let year = selectedYear;
    if (month <= 0) {
      month += 12;
      year -= 1;
    }
    const monthPayrolls = payrolls.filter(p => p.month === month && p.year === year);
    const cost = monthPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);
    monthlyTrend.push({
      month: `${month}/${year}`,
      cost: cost,
      count: monthPayrolls.length
    });
  }

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Payroll Analytics</h1>
            <p className="text-gray-600 mt-1 text-sm md:text-base">Analyze payroll trends and insights</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({length: 12}, (_, i) => (
                  <SelectItem key={i + 1} value={(i + 1).toString()}>
                    {new Date(2000, i).toLocaleDateString('en', { month: 'short' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026].map(year => (
                  <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-full">
                  <DollarSign className="w-6 h-6 md:w-8 md:h-8 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs md:text-sm text-gray-600">Total Payroll Cost</p>
                  <p className="text-xl md:text-3xl font-bold text-blue-600 break-words">₹{(totalCurrentCost / 100000).toFixed(2)}L</p>
                  <div className="flex items-center gap-1 mt-1">
                    {costChange >= 0 ? (
                      <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-green-600" />
                    ) : (
                      <TrendingDown className="w-3 h-3 md:w-4 md:h-4 text-red-600" />
                    )}
                    <span className={`text-xs ${costChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {costChangePercent}% vs last month
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-full">
                  <Users className="w-6 h-6 md:w-8 md:h-8 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs md:text-sm text-gray-600">New Joinings</p>
                  <p className="text-xl md:text-3xl font-bold text-green-600">{newJoinings.length}</p>
                  <p className="text-xs text-gray-600 mt-1">Cost: ₹{(newJoiningsCost / 1000).toFixed(0)}K</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-100 rounded-full">
                  <TrendingDown className="w-6 h-6 md:w-8 md:h-8 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs md:text-sm text-gray-600">Low Attendance Impact</p>
                  <p className="text-xl md:text-3xl font-bold text-orange-600">{lowAttendancePayrolls.length}</p>
                  <p className="text-xs text-gray-600 mt-1">LOP: ₹{(lopImpact / 1000).toFixed(0)}K</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-100 rounded-full">
                  <Building2 className="w-6 h-6 md:w-8 md:h-8 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs md:text-sm text-gray-600">Departments</p>
                  <p className="text-xl md:text-3xl font-bold text-purple-600">{departments.length}</p>
                  <p className="text-xs text-gray-600 mt-1">Active departments</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base md:text-lg">Monthly Payroll Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => `₹${(value / 1000).toFixed(0)}K`} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="cost" stroke="#3b82f6" name="Total Cost" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base md:text-lg">Department-wise Cost Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={deptWiseData}
                    dataKey="currentCost"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry) => `${entry.name}: ₹${(entry.currentCost / 1000).toFixed(0)}K`}
                    labelStyle={{ fontSize: '10px' }}
                  >
                    {deptWiseData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `₹${(value / 1000).toFixed(0)}K`} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base md:text-lg">Department-wise Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 md:space-y-4">
              {deptWiseData.map((dept, idx) => (
                <div key={dept.code} className="border rounded-lg p-3 md:p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <h3 className="font-semibold text-sm md:text-base">{dept.name}</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs md:text-sm text-gray-600">
                        <p>Employees: {dept.employeeCount}</p>
                        <p>Payrolls: {dept.payrollCount}</p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-xl md:text-2xl font-bold text-blue-600">₹{(dept.currentCost / 1000).toFixed(0)}K</p>
                      <div className="flex items-center gap-1 mt-1">
                        {dept.change >= 0 ? (
                          <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-green-600" />
                        ) : (
                          <TrendingDown className="w-3 h-3 md:w-4 md:h-4 text-red-600" />
                        )}
                        <span className={`text-xs ${dept.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ₹{Math.abs(dept.change / 1000).toFixed(0)}K vs last month
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base md:text-lg">Cost Change Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <div>
                  <p className="font-semibold text-sm md:text-base">New Employee Joinings</p>
                  <p className="text-xs md:text-sm text-gray-600">{newJoinings.length} new employees</p>
                </div>
                <p className="text-lg md:text-xl font-bold text-green-600">+₹{(newJoiningsCost / 1000).toFixed(0)}K</p>
              </div>

              <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                <div>
                  <p className="font-semibold text-sm md:text-base">Low Attendance (LOP)</p>
                  <p className="text-xs md:text-sm text-gray-600">{lowAttendancePayrolls.length} employees affected</p>
                </div>
                <p className="text-lg md:text-xl font-bold text-orange-600">-₹{(lopImpact / 1000).toFixed(0)}K</p>
              </div>

              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                <div>
                  <p className="font-semibold text-sm md:text-base">Net Change</p>
                  <p className="text-xs md:text-sm text-gray-600">Compared to previous month</p>
                </div>
                <p className={`text-lg md:text-xl font-bold ${costChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {costChange >= 0 ? '+' : ''}₹{(costChange / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}