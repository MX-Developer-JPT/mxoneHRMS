import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const RATING_COLORS = {
  Outstanding: '#10B981',
  'Exceeds Expectations': '#3B82F6',
  'Meets Expectations': '#F59E0B',
  'Below Expectations': '#F97316',
  Unsatisfactory: '#EF4444',
};

export function RatingDistributionChart({ data }) {
  const chartData = Object.entries(data || {}).map(([name, value]) => ({ name: name.replace(' ', '\n'), value, color: RATING_COLORS[name] || '#6B7280' }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={chartData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, value }) => value > 0 ? `${value}` : ''}>
          {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TopPerformersChart({ performers, userMap }) {
  const data = (performers || []).map(r => ({
    name: (userMap?.[r.employee_user_id]?.full_name || 'N/A').split(' ')[0],
    score: r.final_score || 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => [v.toFixed(2), 'Score']} />
        <Bar dataKey="score" fill="#3B82F6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}