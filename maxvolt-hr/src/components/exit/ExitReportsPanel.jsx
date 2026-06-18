import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts';
import { TrendingDown } from 'lucide-react';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899', '#84cc16'];

const REASON_LABELS = {
  better_opportunity: 'Better Opportunity',
  personal_reasons: 'Personal Reasons',
  higher_education: 'Higher Education',
  relocation: 'Relocation',
  health: 'Health Issues',
  work_environment: 'Work Environment',
  compensation: 'Compensation',
  career_growth: 'Career Growth',
  other: 'Other',
};

export default function ExitReportsPanel({ exits }) {
  const completed = exits.filter(e => e.status !== 'cancelled');

  const byReason = useMemo(() => {
    const counts = {};
    completed.forEach(e => {
      const key = e.reason_category || 'other';
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([key, count]) => ({ name: REASON_LABELS[key] || key, value: count }));
  }, [completed]);

  const byDept = useMemo(() => {
    const counts = {};
    completed.forEach(e => {
      const dept = e.employee?.department || 'Unknown';
      counts[dept] = (counts[dept] || 0) + 1;
    });
    return Object.entries(counts).sort(([, a], [, b]) => b - a).map(([dept, count]) => ({ name: dept.replace('_', ' '), count }));
  }, [completed]);

  const byMonth = useMemo(() => {
    const counts = {};
    completed.forEach(e => {
      if (!e.last_working_date) return;
      const d = new Date(e.last_working_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      counts[key] = { label, count: (counts[key]?.count || 0) + 1 };
    });
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([, v]) => ({ name: v.label, exits: v.count }));
  }, [completed]);

  const statusCounts = {
    pending_approval: exits.filter(e => ['submitted', 'manager_approved'].includes(e.status)).length,
    in_notice: exits.filter(e => e.status === 'in_notice').length,
    clearance: exits.filter(e => ['clearance_pending', 'clearance_done'].includes(e.status)).length,
    fnf: exits.filter(e => e.status === 'fnf_pending').length,
    completed: exits.filter(e => e.status === 'completed').length,
  };

  const avgNoticePeriod = useMemo(() => {
    const served = completed.filter(e => e.notice_served_days > 0);
    if (!served.length) return 0;
    return Math.round(served.reduce((s, e) => s + e.notice_served_days, 0) / served.length);
  }, [completed]);

  const interviewCompletion = useMemo(() => {
    if (!completed.length) return 0;
    return Math.round((completed.filter(e => e.exit_interview_completed).length / completed.length) * 100);
  }, [completed]);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Exits', value: completed.length, color: 'text-gray-700' },
          { label: 'Completed', value: statusCounts.completed, color: 'text-green-700' },
          { label: 'Avg Notice Served', value: `${avgNoticePeriod}d`, color: 'text-blue-700' },
          { label: 'Interview Completion', value: `${interviewCompletion}%`, color: 'text-purple-700' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-gray-500 mt-1">{k.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Reason Pie Chart */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="w-4 h-4" /> Exit Reasons</CardTitle></CardHeader>
          <CardContent>
            {byReason.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={byReason} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                    {byReason.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-center py-12">No data</p>}
          </CardContent>
        </Card>

        {/* Monthly Trend */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Monthly Exit Trend</CardTitle></CardHeader>
          <CardContent>
            {byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="exits" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-center py-12">No data</p>}
          </CardContent>
        </Card>

        {/* Department Breakdown */}
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-sm">Department-wise Exits</CardTitle></CardHeader>
          <CardContent>
            {byDept.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDept} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-center py-8">No data</p>}
          </CardContent>
        </Card>
      </div>

      {/* Detailed List */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Recent Exit Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  {['Employee', 'Department', 'Exit Type', 'Reason', 'LWD', 'Notice Served', 'Interview', 'F&F'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {completed.slice(0, 20).map(ex => (
                  <tr key={ex.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{ex.user?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{ex.employee?.department?.replace('_', ' ') || '—'}</td>
                    <td className="px-4 py-3 capitalize">{ex.exit_type?.replace('_', ' ')}</td>
                    <td className="px-4 py-3 capitalize text-xs">{REASON_LABELS[ex.reason_category] || '—'}</td>
                    <td className="px-4 py-3 text-xs">{ex.last_working_date || '—'}</td>
                    <td className="px-4 py-3">{ex.notice_served_days || 0}d</td>
                    <td className="px-4 py-3">{ex.exit_interview_completed ? '✅' : '❌'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${ex.full_and_final_status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {ex.full_and_final_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}