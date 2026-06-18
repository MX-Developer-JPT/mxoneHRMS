import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { DollarSign, Calculator, CheckCircle2, Download, Loader2 } from 'lucide-react';

export default function FnFSummary({ exitRecord, currentUser, isHR, onRefresh }) {
  const [calculating, setCalculating] = useState(false);
  const [fnfData, setFnfData] = useState(exitRecord.fnf_breakdown || null);

  const handleCalculate = async () => {
    setCalculating(true);
    const res = await base44.functions.invoke('processFnFSettlement', {
      user_id: exitRecord.user_id,
      exit_date: exitRecord.last_working_date
    });
    const breakdown = res.data?.breakdown;
    if (breakdown) {
      await base44.entities.Exit.update(exitRecord.id, {
        fnf_calculated: true,
        fnf_breakdown: breakdown,
        final_settlement_amount: breakdown.net_payable,
        full_and_final_status: 'in_progress'
      });
      setFnfData(breakdown);
      toast.success('F&F calculated successfully');
      onRefresh();
    } else {
      toast.error('Failed to calculate F&F: ' + (res.data?.error || 'Unknown error'));
    }
    setCalculating(false);
  };

  const handleMarkPaid = async () => {
    await base44.entities.Exit.update(exitRecord.id, {
      full_and_final_status: 'completed',
      settlement_date: new Date().toISOString().split('T')[0],
    });
    toast.success('F&F marked as paid');
    onRefresh();
  };

  if (!['fnf_pending', 'clearance_done', 'completed'].includes(exitRecord.status)) {
    return (
      <div className="text-center py-12 text-gray-400">
        <DollarSign className="w-12 h-12 mx-auto mb-3" />
        <p>F&F settlement will be available after clearance is complete.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!fnfData ? (
        <div className="text-center py-10">
          <Calculator className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-600 mb-4">F&F settlement has not been calculated yet.</p>
          {isHR && (
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={handleCalculate} disabled={calculating}>
              {calculating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
              Calculate F&F Settlement
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Full & Final Settlement</h3>
            <Badge className={exitRecord.full_and_final_status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
              {exitRecord.full_and_final_status === 'completed' ? 'Paid' : 'Pending Payment'}
            </Badge>
          </div>

          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Service Duration</p>
            <p className="text-xl font-bold text-green-700">{fnfData.service_years} years</p>
          </div>

          {/* Earnings */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-green-700">Earnings / Credits</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {fnfData.fnf_components && Object.entries(fnfData.fnf_components).map(([key, val]) => val > 0 && (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-600 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-green-700">₹{Math.round(val).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Deductions */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700">Deductions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {fnfData.deductions && Object.entries(fnfData.deductions).map(([key, val]) => val > 0 && (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-600 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-red-600">-₹{Math.round(val).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Net Payable */}
          <div className="bg-blue-600 text-white rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-sm opacity-80">Net Amount Payable</p>
              <p className="text-3xl font-bold mt-1">₹{Math.round(fnfData.net_payable || exitRecord.final_settlement_amount || 0).toLocaleString()}</p>
            </div>
            <DollarSign className="w-12 h-12 opacity-30" />
          </div>

          {isHR && exitRecord.full_and_final_status !== 'completed' && (
            <div className="flex gap-3">
              {isHR && (
                <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={handleCalculate} disabled={calculating} variant="outline">
                  {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
                  Recalculate
                </Button>
              )}
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={handleMarkPaid}>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Mark as Paid
              </Button>
            </div>
          )}
          {exitRecord.full_and_final_status === 'completed' && (
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-medium">F&F Settlement completed on {exitRecord.settlement_date}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}