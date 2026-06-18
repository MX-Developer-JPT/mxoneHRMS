import React from 'react';
import { Calendar, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function DeadlineCard({ deadline, onMarkComplete }) {
  const { daysLeft } = deadline;

  const urgency = daysLeft < 0 ? 'overdue' : daysLeft <= 3 ? 'critical' : daysLeft <= 7 ? 'warning' : 'ok';
  const urgencyConfig = {
    overdue: { color: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-700', label: `${Math.abs(daysLeft)}d overdue`, icon: AlertTriangle },
    critical: { color: 'bg-orange-50 border-orange-200', badge: 'bg-orange-100 text-orange-700', label: `${daysLeft}d left`, icon: AlertTriangle },
    warning: { color: 'bg-yellow-50 border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', label: `${daysLeft}d left`, icon: Clock },
    ok: { color: 'bg-gray-50 border-gray-200', badge: 'bg-blue-100 text-blue-700', label: `${daysLeft}d left`, icon: Calendar },
  };

  const cfg = urgencyConfig[urgency];
  const Icon = cfg.icon;

  const typeColors = {
    PF: 'bg-indigo-100 text-indigo-700',
    ESI: 'bg-teal-100 text-teal-700',
    TDS: 'bg-purple-100 text-purple-700',
    PT: 'bg-pink-100 text-pink-700',
    LWF: 'bg-cyan-100 text-cyan-700',
    Gratuity: 'bg-amber-100 text-amber-700',
    Bonus: 'bg-green-100 text-green-700',
    Other: 'bg-gray-100 text-gray-700',
  };

  if (deadline.status === 'completed') {
    return (
      <div className="border rounded-xl p-4 bg-green-50 border-green-200 flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-green-800 line-through text-sm">{deadline.title}</p>
          <p className="text-xs text-green-600">Completed on {deadline.completed_date}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[deadline.compliance_type]}`}>
          {deadline.compliance_type}
        </span>
      </div>
    );
  }

  return (
    <div className={`border rounded-xl p-4 ${cfg.color}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1">
          <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm text-gray-800">{deadline.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{deadline.description}</p>
            <p className="text-xs text-gray-600 mt-1">Due: {new Date(deadline.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[deadline.compliance_type]}`}>
            {deadline.compliance_type}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>
            {cfg.label}
          </span>
          {onMarkComplete && (
            <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={() => onMarkComplete(deadline)}>
              Mark Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}