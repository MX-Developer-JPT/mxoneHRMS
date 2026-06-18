import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

export default function ValidationSummary({ errors, warnings }) {
  const [expanded, setExpanded] = useState(true);

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <span className="text-sm text-green-700 font-medium">All data validated successfully. Ready to import.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="border border-red-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-sm font-semibold text-red-700">{errors.length} Error(s) — Must fix before importing</span>
            </div>
            {expanded ? <ChevronDown className="w-4 h-4 text-red-500" /> : <ChevronRight className="w-4 h-4 text-red-500" />}
          </button>
          {expanded && (
            <div className="divide-y divide-red-100 max-h-52 overflow-y-auto">
              {errors.map((e, i) => (
                <div key={i} className="px-3 py-2 bg-white text-sm flex items-start gap-2">
                  <Badge variant="destructive" className="text-xs shrink-0">{e.sheet} row {e.row}</Badge>
                  <span className="text-gray-700"><strong>{e.field}:</strong> {e.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="border border-yellow-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 p-3 bg-yellow-50">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm font-semibold text-yellow-700">{warnings.length} Warning(s) — Will be skipped but import can proceed</span>
          </div>
          <div className="divide-y divide-yellow-100 max-h-40 overflow-y-auto">
            {warnings.map((w, i) => (
              <div key={i} className="px-3 py-2 bg-white text-sm flex items-start gap-2">
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs shrink-0">{w.sheet} row {w.row}</Badge>
                <span className="text-gray-600">{w.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}