import React from 'react';

export default function ComplianceStatCard({ title, value, sub, icon: Icon, color = 'blue', status }) {
  const colorMap = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    teal: 'bg-teal-50 border-teal-200 text-teal-700',
  };
  const iconBg = {
    blue: 'bg-blue-100',
    green: 'bg-green-100',
    orange: 'bg-orange-100',
    red: 'bg-red-100',
    purple: 'bg-purple-100',
    teal: 'bg-teal-100',
  };

  return (
    <div className={`border rounded-xl p-4 ${colorMap[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
        </div>
        {Icon && (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBg[color]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      {status && (
        <div className={`mt-2 text-xs font-medium px-2 py-0.5 rounded-full inline-block
          ${status === 'ok' ? 'bg-green-100 text-green-700' : status === 'warning' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
          {status === 'ok' ? '✓ Compliant' : status === 'warning' ? '⚠ Attention Needed' : '✗ Action Required'}
        </div>
      )}
    </div>
  );
}