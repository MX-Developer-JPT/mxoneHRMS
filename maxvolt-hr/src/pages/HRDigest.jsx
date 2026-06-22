import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, Sparkles, Loader2, Users, FileText, TrendingUp, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function HRDigest() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await base44.functions.invoke('getWeeklyHRDigest', {});
      setResult(r.data);
    } catch (e) {
      toast.error('Failed to generate: ' + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <BookOpen className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">HR Digest</h1>
          <p className="text-sm text-gray-500">AI-generated summary of HR metrics for quick review</p>
        </div>
      </div>

      <div className="mb-6">
        <Button onClick={generate} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Generating digest...' : 'Generate HR Digest'}
        </Button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Headcount', value: result.stats.headcount, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'New Joiners', value: result.stats.new_joiners, icon: Users, color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'Pending Leaves', value: result.stats.pending_leaves, icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: 'Open Positions', value: result.stats.open_positions, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-lg p-4 text-center`}>
                <s.icon className={`w-5 h-5 ${s.color} mx-auto mb-1`} />
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {result.stats.high_risk_employees > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">{result.stats.high_risk_employees} employee(s) flagged as high attrition risk</p>
                <p className="text-xs text-red-600 mt-0.5">Review the Attrition Risk page for details.</p>
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                AI HR Digest
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{result.digest}</p>
              <p className="text-xs text-gray-400 mt-4">Generated {new Date().toLocaleString('en-IN')}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
