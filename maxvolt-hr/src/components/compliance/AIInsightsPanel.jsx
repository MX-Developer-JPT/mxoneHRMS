import React, { useState } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import ReactMarkdown from 'react-markdown';

export default function AIInsightsPanel({ month, year }) {
  const [insights, setInsights] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchInsights = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('getComplianceInsights', { month, year });
    setInsights(res.data?.insights || 'No insights available.');
    setLoaded(true);
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-indigo-900">AI Compliance Insights</h3>
            <p className="text-xs text-indigo-600">Powered by AI — risk predictions & corrective actions</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={fetchInsights}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {loaded ? 'Refresh' : 'Analyze'}
        </Button>
      </div>

      {!loaded && !loading && (
        <div className="flex flex-col items-center justify-center py-8 text-indigo-400">
          <TrendingUp className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm">Click "Analyze" to get AI-driven compliance risk insights</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 gap-3 text-indigo-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <p className="text-sm">Analyzing compliance data...</p>
        </div>
      )}

      {loaded && !loading && (
        <div className="prose prose-sm max-w-none text-indigo-900">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="my-1 text-sm leading-relaxed text-indigo-900">{children}</p>,
              ul: ({ children }) => <ul className="my-1 ml-4 list-disc text-indigo-900">{children}</ul>,
              ol: ({ children }) => <ol className="my-1 ml-4 list-decimal text-indigo-900">{children}</ol>,
              li: ({ children }) => <li className="my-0.5 text-sm text-indigo-900">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-indigo-800">{children}</strong>,
              h1: ({ children }) => <h1 className="text-base font-bold text-indigo-900 mt-3 mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-sm font-bold text-indigo-900 mt-3 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold text-indigo-800 mt-2 mb-1">{children}</h3>,
            }}
          >
            {insights}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}