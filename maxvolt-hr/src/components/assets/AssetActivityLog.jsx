import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, UserCheck, RotateCcw, Wrench, FileText, Package, History, ArrowRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const FIELD_ICONS = {
  created: Package,
  status: ArrowRight,
  assignment: UserCheck,
  return: RotateCcw,
  condition: Wrench,
  checkout: FileText,
};

const FIELD_LABELS = {
  created: 'Asset Created',
  status: 'Status Change',
  assignment: 'Assignment',
  return: 'Returned',
  condition: 'Condition Update',
  checkout: 'Digital Checkout',
};

export default function AssetActivityLog({ logs }) {
  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="w-5 h-5" /> Activity History</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No activity recorded yet.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-5 h-5 text-primary" /> Activity History
          <Badge variant="secondary" className="text-xs">{logs.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {logs.map(log => {
            const Icon = FIELD_ICONS[log.field_changed] || Clock;
            return (
              <div key={log.id} className="flex gap-3 border rounded-lg p-3 text-sm hover:bg-muted/30">
                <div className="mt-0.5 p-1.5 rounded-full bg-primary/10 shrink-0">
                  <Icon className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {FIELD_LABELS[log.field_changed] || log.field_changed}
                    </Badge>
                    {log.previous_status && <Badge className="bg-gray-100 text-gray-600 text-[10px]">{log.previous_status}</Badge>}
                    {log.new_status && log.previous_status !== log.new_status && (
                      <>
                        <span className="text-gray-400">→</span>
                        <Badge className="bg-blue-100 text-blue-700 text-[10px]">{log.new_status}</Badge>
                      </>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {log.created_date ? format(parseISO(log.created_date), 'dd MMM yyyy, hh:mm a') : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{log.notes}</p>
                  {(log.old_value || log.new_value) && log.field_changed !== 'checkout' && log.field_changed !== 'created' && (
                    <p className="mt-0.5 text-xs">
                      {log.old_value && <span className="text-gray-500 line-through mr-2">{log.old_value}</span>}
                      {log.new_value && <span className="font-medium">{log.new_value}</span>}
                    </p>
                  )}
                  {log.changed_by_name && log.field_changed === 'checkout' && (
                    <p className="text-xs text-green-600 mt-0.5">Signed by: {log.changed_by_name}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}