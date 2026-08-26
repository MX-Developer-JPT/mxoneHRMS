import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Users, DollarSign, Building2, MapPin, Briefcase, Landmark, ShieldCheck, Receipt, Wallet } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const ALL = '__all__';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const fmtK = (v) => `₹${((v || 0) / 1000).toFixed(0)}K`;
const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
const netOf = (p) => p.net_salary != null ? p.net_salary : (p.gross_salary || 0) - sum(Object.values(p.deductions || {}), v => v);

export default function PayrollAnalytics() {
  const [payrolls, setPayrolls] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [filterDept, setFilterDept] = useState(ALL);
  const [filterLocation, setFilterLocation] = useState(ALL);
  const [filterDesignation, setFilterDesignation] = useState(ALL);
  const [filterEmployee, setFilterEmployee] = useState(ALL);
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [payrollData, empData, deptData] = await Promise.all([
        base44.entities.Payroll.list('-created_date', 2000),
        base44.entities.Employee.list('-created_date', 2000),
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

  const empByUserId = useMemo(() => new Map(employees.map(e => [e.user_id, e])), [employees]);
  const locations = useMemo(() => [...new Set(employees.map(e => e.work_location).filter(Boolean))].sort(), [employees]);
  const designations = useMemo(() => [...new Set(employees.map(e => e.designation).filter(Boolean))].sort(), [employees]);

  // Employees matching the non-month filters (dept/location/designation/status/specific employee)
  // — applied consistently everywhere a payroll set is built, so every card/table/chart on
  // this page reflects the same filtered population (spec: filters apply org-wide, not per-widget).
  const matchesFilters = (emp) => {
    if (!emp) return false;
    if (filterDept !== ALL && emp.department !== filterDept) return false;
    if (filterLocation !== ALL && emp.work_location !== filterLocation) return false;
    if (filterDesignation !== ALL && emp.designation !== filterDesignation) return false;
    if (filterStatus !== ALL && emp.status !== filterStatus) return false;
    if (filterEmployee !== ALL && emp.user_id !== filterEmployee) return false;
    return true;
  };

  const filterPayrolls = (arr) => arr.filter(p => matchesFilters(empByUserId.get(p.user_id)));

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const currentMonthPayrolls = filterPayrolls(payrolls.filter(p => p.month === selectedMonth && p.year === selectedYear));
  const previousMonthPayrolls = filterPayrolls(payrolls.filter(p =>
    p.month === (selectedMonth === 1 ? 12 : selectedMonth - 1) &&
    p.year === (selectedMonth === 1 ? selectedYear - 1 : selectedYear)
  ));

  // Overall company metrics
  const totalCurrentCost = sum(currentMonthPayrolls, netOf);
  const totalPreviousCost = sum(previousMonthPayrolls, netOf);
  const costChange = totalCurrentCost - totalPreviousCost;
  const costChangePercent = totalPreviousCost > 0 ? ((costChange / totalPreviousCost) * 100).toFixed(1) : 0;

  const totalGross = sum(currentMonthPayrolls, p => p.gross_salary);
  const totalDeductions = sum(currentMonthPayrolls, p => sum(Object.values(p.deductions || {}), v => v));
  const totalPF = sum(currentMonthPayrolls, p => p.deductions?.pf);
  const totalESI = sum(currentMonthPayrolls, p => p.deductions?.esi);
  const totalTDS = sum(currentMonthPayrolls, p => p.deductions?.tds);
  const totalPT = sum(currentMonthPayrolls, p => p.deductions?.professional_tax || p.deductions?.pt);
  const totalLoan = sum(currentMonthPayrolls, p => p.deductions?.loan);
  const totalLOPDays = sum(currentMonthPayrolls, p => p.loss_of_pay_days);
  const avgSalary = currentMonthPayrolls.length ? totalCurrentCost / currentMonthPayrolls.length : 0;
  const employerPF = sum(currentMonthPayrolls, p => p.employer_contributions?.pf);
  const employerESI = sum(currentMonthPayrolls, p => p.employer_contributions?.esi);

  // Department-wise breakdown
  const groupWise = (keyFn) => {
    const map = new Map();
    for (const p of currentMonthPayrolls) {
      const emp = empByUserId.get(p.user_id);
      const key = keyFn(emp) || 'Unspecified';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    const prevMap = new Map();
    for (const p of previousMonthPayrolls) {
      const emp = empByUserId.get(p.user_id);
      const key = keyFn(emp) || 'Unspecified';
      if (!prevMap.has(key)) prevMap.set(key, []);
      prevMap.get(key).push(p);
    }
    return [...map.entries()].map(([name, list]) => {
      const currentCost = sum(list, netOf);
      const previousCost = sum(prevMap.get(name) || [], netOf);
      return { name, currentCost, previousCost, change: currentCost - previousCost, payrollCount: list.length };
    }).sort((a, b) => b.currentCost - a.currentCost);
  };

  const deptWiseData = departments
    .filter(d => filterDept === ALL || d.name === filterDept)
    .map(dept => {
      const deptEmployees = employees.filter(e => e.department === dept.name && matchesFilters(e));
      const deptPayrolls = currentMonthPayrolls.filter(p => deptEmployees.some(e => e.user_id === p.user_id));
      const prevDeptPayrolls = previousMonthPayrolls.filter(p => deptEmployees.some(e => e.user_id === p.user_id));
      const currentCost = sum(deptPayrolls, netOf);
      const previousCost = sum(prevDeptPayrolls, netOf);
      return {
        name: dept.name, code: dept.code, currentCost, previousCost,
        change: currentCost - previousCost, employeeCount: deptEmployees.length, payrollCount: deptPayrolls.length,
      };
    });

  const locationWiseData = groupWise(e => e?.work_location);
  const designationWiseData = groupWise(e => e?.designation);

  // Head-wise salary cost (basic/hra/conveyance/special/pf/esi/tds/etc.)
  const headWise = [
    { name: 'Basic', value: sum(currentMonthPayrolls, p => p.basic_salary) },
    { name: 'HRA', value: sum(currentMonthPayrolls, p => p.hra) },
    { name: 'Conveyance', value: sum(currentMonthPayrolls, p => p.conveyance) },
    { name: 'Special Allowance', value: sum(currentMonthPayrolls, p => p.special_allowance) },
    { name: 'Incentive/Bonus', value: sum(currentMonthPayrolls, p => (p.incentive || 0) + (p.bonus || 0) + (p.overtime || 0)) },
    { name: 'PF', value: totalPF },
    { name: 'ESI', value: totalESI },
    { name: 'TDS', value: totalTDS },
    { name: 'Professional Tax', value: totalPT },
    { name: 'Loan/Advance', value: totalLoan },
  ].filter(h => h.value > 0);

  // Salary distribution — bucket net salary into ranges
  const bucketSize = 20000;
  const distBuckets = new Map();
  for (const p of currentMonthPayrolls) {
    const n = netOf(p);
    const bucket = Math.floor(n / bucketSize) * bucketSize;
    const label = `₹${(bucket / 1000).toFixed(0)}K-${((bucket + bucketSize) / 1000).toFixed(0)}K`;
    distBuckets.set(label, (distBuckets.get(label) || 0) + 1);
  }
  const salaryDistribution = [...distBuckets.entries()]
    .map(([range, count]) => ({ range, count, sortKey: parseInt(range.replace(/[^\d]/g, '')) || 0 }))
    .sort((a, b) => a.sortKey - b.sortKey);

  // New joinings / exits impacting payroll
  const newJoinings = employees.filter(e => {
    if (!matchesFilters(e)) return false;
    const joinDate = new Date(e.date_of_joining);
    return joinDate.getMonth() + 1 === selectedMonth && joinDate.getFullYear() === selectedYear;
  });
  const newJoiningsCost = sum(currentMonthPayrolls.filter(p => newJoinings.some(e => e.user_id === p.user_id)), netOf);

  const exitsThisMonth = employees.filter(e => {
    if (!matchesFilters(e)) return false;
    if (!e.exit_date) return false;
    const exitDate = new Date(e.exit_date);
    return exitDate.getMonth() + 1 === selectedMonth && exitDate.getFullYear() === selectedYear;
  });

  // Attendance impact
  const lowAttendancePayrolls = currentMonthPayrolls.filter(p => p.loss_of_pay_days > 0);
  const lopImpact = sum(lowAttendancePayrolls, p => (p.loss_of_pay_days || 0) * (p.basic_salary || 0) / 30);

  // Month-wise trend (last 6 months) — also drives Employee-wise Salary Trend when one
  // employee is selected via the filter.
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    let month = selectedMonth - i;
    let year = selectedYear;
    if (month <= 0) { month += 12; year -= 1; }
    const monthPayrolls = filterPayrolls(payrolls.filter(p => p.month === month && p.year === year));
    monthlyTrend.push({
      month: `${month}/${year}`,
      cost: sum(monthPayrolls, netOf),
      count: monthPayrolls.length,
    });
  }

  const employeeTrend = filterEmployee !== ALL ? (() => {
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      let month = selectedMonth - i;
      let year = selectedYear;
      if (month <= 0) { month += 12; year -= 1; }
      const p = payrolls.find(x => x.user_id === filterEmployee && x.month === month && x.year === year);
      trend.push({ month: `${month}/${year}`, net: p ? netOf(p) : null, gross: p ? (p.gross_salary || 0) : null });
    }
    return trend;
  })() : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Payroll Analytics</h1>
            <p className="text-gray-600 mt-1 text-sm md:text-base">Analyze payroll trends and insights</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={(i + 1).toString()}>{new Date(2000, i).toLocaleDateString('en', { month: 'short' })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[selectedYear + 1, ...new Set([2024, 2025, 2026, selectedYear])].filter((v, i, a) => a.indexOf(v) === i).sort((a,b)=>b-a).map(year => (
                  <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterDept} onValueChange={setFilterDept}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Departments</SelectItem>
                {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterLocation} onValueChange={setFilterLocation}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Location" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Locations</SelectItem>
                {locations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterDesignation} onValueChange={setFilterDesignation}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Designation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Designations</SelectItem>
                {designations.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Emp. Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="resigned">Resigned</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterEmployee} onValueChange={setFilterEmployee}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Employee" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ALL}>All Employees</SelectItem>
                {employees.slice(0, 500).map(e => <SelectItem key={e.user_id} value={e.user_id}>{e.display_name || e.employee_code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          <SummaryCard icon={DollarSign} color="blue" label="Total Payroll Cost" value={`₹${(totalCurrentCost / 100000).toFixed(2)}L`}
            sub={<TrendBadge change={costChange} percent={costChangePercent} />} />
          <SummaryCard icon={Wallet} color="indigo" label="Total Gross Salary" value={fmtK(totalGross)} />
          <SummaryCard icon={DollarSign} color="green" label="Total Net Salary" value={fmtK(totalCurrentCost)} />
          <SummaryCard icon={TrendingDown} color="red" label="Total Deductions" value={fmtK(totalDeductions)} />
          <SummaryCard icon={ShieldCheck} color="teal" label="Total PF" value={fmtK(totalPF)} />
          <SummaryCard icon={ShieldCheck} color="cyan" label="Total ESI" value={fmtK(totalESI)} />
          <SummaryCard icon={Receipt} color="orange" label="Total TDS" value={fmtK(totalTDS)} />
          <SummaryCard icon={DollarSign} color="purple" label="Average Salary" value={fmtK(avgSalary)} sub={`${currentMonthPayrolls.length} employees`} />
          <SummaryCard icon={Users} color="green" label="New Joinings" value={newJoinings.length} sub={`Cost: ${fmtK(newJoiningsCost)}`} />
          <SummaryCard icon={Users} color="slate" label="Exits This Month" value={exitsThisMonth.length} />
          <SummaryCard icon={TrendingDown} color="orange" label="LOP Impact" value={fmtK(lopImpact)} sub={`${totalLOPDays} LOP days`} />
          <SummaryCard icon={Building2} color="purple" label="Departments" value={deptWiseData.length} />
        </div>

        {/* Statutory Deduction Summary */}
        <Card>
          <CardHeader><CardTitle className="text-base md:text-lg flex items-center gap-2"><Landmark className="w-4 h-4" /> Statutory Deduction Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <StatRow label="Employee PF" value={totalPF} />
              <StatRow label="Employer PF" value={employerPF} />
              <StatRow label="Employee ESI" value={totalESI} />
              <StatRow label="Employer ESI" value={employerESI} />
              <StatRow label="Professional Tax" value={totalPT} />
              <StatRow label="TDS" value={totalTDS} />
              <StatRow label="Loan/Advance" value={totalLoan} />
            </div>
          </CardContent>
        </Card>

        {employeeTrend && (
          <Card>
            <CardHeader><CardTitle className="text-base md:text-lg">Employee-wise Salary Trend (12 months)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={employeeTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => v == null ? 'No payroll' : `₹${v.toLocaleString('en-IN')}`} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="net" stroke="#10b981" name="Net Salary" strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="gross" stroke="#3b82f6" name="Gross Salary" strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base md:text-lg">Month-on-Month Payroll Comparison</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => fmtK(value)} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="cost" stroke="#3b82f6" name="Total Cost" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base md:text-lg">Department-wise Cost Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={deptWiseData} dataKey="currentCost" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={(entry) => `${entry.name}: ${fmtK(entry.currentCost)}`} labelStyle={{ fontSize: '10px' }}>
                    {deptWiseData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => fmtK(value)} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base md:text-lg">Head-wise Salary Cost</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={headWise} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={(entry) => `${entry.name}: ${fmtK(entry.value)}`} labelStyle={{ fontSize: '10px' }}>
                    {headWise.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => fmtK(value)} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base md:text-lg">Salary Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={salaryDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" name="Employees" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <BreakdownTable title="Department-wise Payroll" icon={Building2} data={deptWiseData.map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }))} />
        <BreakdownTable title="Location-wise Payroll" icon={MapPin} data={locationWiseData.map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }))} />
        <BreakdownTable title="Designation-wise Payroll" icon={Briefcase} data={designationWiseData.map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }))} />

        <Card>
          <CardHeader><CardTitle className="text-base md:text-lg">Cost Change Analysis</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <div>
                  <p className="font-semibold text-sm md:text-base">New Employee Joinings</p>
                  <p className="text-xs md:text-sm text-gray-600">{newJoinings.length} new employees</p>
                </div>
                <p className="text-lg md:text-xl font-bold text-green-600">+{fmtK(newJoiningsCost)}</p>
              </div>

              <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                <div>
                  <p className="font-semibold text-sm md:text-base">Low Attendance (LOP)</p>
                  <p className="text-xs md:text-sm text-gray-600">{lowAttendancePayrolls.length} employees affected</p>
                </div>
                <p className="text-lg md:text-xl font-bold text-orange-600">-{fmtK(lopImpact)}</p>
              </div>

              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                <div>
                  <p className="font-semibold text-sm md:text-base">Net Change</p>
                  <p className="text-xs md:text-sm text-gray-600">Compared to previous month</p>
                </div>
                <p className={`text-lg md:text-xl font-bold ${costChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {costChange >= 0 ? '+' : ''}{fmtK(costChange)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TrendBadge({ change, percent }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      {change >= 0 ? <TrendingUp className="w-3 h-3 text-green-600" /> : <TrendingDown className="w-3 h-3 text-red-600" />}
      <span className={`text-xs ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{percent}% vs last month</span>
    </div>
  );
}

const CARD_COLORS = {
  blue: 'bg-blue-100 text-blue-600', green: 'bg-green-100 text-green-600', orange: 'bg-orange-100 text-orange-600',
  purple: 'bg-purple-100 text-purple-600', indigo: 'bg-indigo-100 text-indigo-600', red: 'bg-red-100 text-red-600',
  teal: 'bg-teal-100 text-teal-600', cyan: 'bg-cyan-100 text-cyan-600', slate: 'bg-slate-100 text-slate-600',
};

function SummaryCard({ icon: Icon, color, label, value, sub }) {
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-full ${CARD_COLORS[color] || CARD_COLORS.blue}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-600">{label}</p>
            <p className="text-lg md:text-xl font-bold break-words">{value}</p>
            {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="border rounded-lg p-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-bold text-slate-800">{fmtK(value)}</p>
    </div>
  );
}

function BreakdownTable({ title, icon: Icon, data }) {
  if (!data.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base md:text-lg flex items-center gap-2"><Icon className="w-4 h-4" /> {title}</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3 md:space-y-4">
          {data.map((row) => (
            <div key={row.name + (row.code || '')} className="border rounded-lg p-3 md:p-4 hover:bg-gray-50 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: row.color }} />
                    <h3 className="font-semibold text-sm md:text-base">{row.name}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs md:text-sm text-gray-600">
                    {row.employeeCount != null && <p>Employees: {row.employeeCount}</p>}
                    <p>Payrolls: {row.payrollCount}</p>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xl md:text-2xl font-bold text-blue-600">{fmtK(row.currentCost)}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {row.change >= 0 ? <TrendingUp className="w-3 h-3 text-green-600" /> : <TrendingDown className="w-3 h-3 text-red-600" />}
                    <span className={`text-xs ${row.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtK(Math.abs(row.change))} vs last month</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
