import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';

export default function InsightCard({ insights = [] }) {
  const config = {
    warning: { icon: AlertTriangle, bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800', icon_color: 'text-yellow-500' },
    danger:  { icon: XCircle,       bg: 'bg-red-50 border-red-200',       text: 'text-red-800',    icon_color: 'text-red-500' },
    info:    { icon: Info,           bg: 'bg-blue-50 border-blue-200',     text: 'text-blue-800',   icon_color: 'text-blue-500' },
    success: { icon: CheckCircle,    bg: 'bg-green-50 border-green-200',   text: 'text-green-800',  icon_color: 'text-green-500' },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-purple-500 inline-block"></span>
        AI-Driven Insights
      </h3>
      <div className="space-y-2">
        {insights.map((ins, i) => {
          const c = config[ins.type] || config.info;
          const Icon = c.icon;
          return (
            <div key={i} className={`flex items-start gap-2 p-3 rounded-lg border ${c.bg}`}>
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${c.icon_color}`} />
              <p className={`text-sm ${c.text}`}>{ins.message}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}