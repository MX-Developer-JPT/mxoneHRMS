import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, User, Plus } from 'lucide-react';
import { toast } from 'sonner';

const DEPARTMENTS = emp => [...new Set((emp || []).map(e => e.department).filter(Boolean))];

export default function LeaveAllocationPanel({ employees, leavePolicies }) {
  const [mode, setMode] = useState('individual'); // 'individual' | 'department'
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [days, setDays] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);

  const departments = DEPARTMENTS(employees);

  const targetEmployees = mode === 'department'
    ? employees.filter(e => e.department === selectedDept)
    : employees.filter(e => e.user_id === selectedEmployeeId);

  const handleAllocate = async () => {
    if (!selectedPolicyId || !days || targetEmployees.length === 0) {
      toast.error('Please fill all required fields');
      return;
    }
    const daysNum = parseFloat(days);
    if (isNaN(daysNum) || daysNum <= 0) {
      toast.error('Enter a valid number of days');
      return;
    }
    setSaving(true);
    let success = 0;
    for (const emp of targetEmployees) {
      try {
        const existing = await base44.entities.LeaveBalance.filter({
          user_id: emp.user_id,
          leave_policy_id: selectedPolicyId,
          year: year
        });
        if (existing.length > 0) {
          const lb = existing[0];
          await base44.entities.LeaveBalance.update(lb.id, {
            total_allocated: (lb.total_allocated || 0) + daysNum,
            available: (lb.available || 0) + daysNum,
          });
        } else {
          await base44.entities.LeaveBalance.create({
            user_id: emp.user_id,
            leave_policy_id: selectedPolicyId,
            year: year,
            total_allocated: daysNum,
            available: daysNum,
            used: 0,
            pending_approval: 0,
            carried_forward: 0,
          });
        }
        success++;
      } catch (e) {
        console.error('Error allocating for', emp.user_id, e);
      }
    }
    toast.success(`Allocated ${daysNum} days to ${success} employee(s)`);
    setSaving(false);
    setDays('');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allocate Leave Days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => { setMode('individual'); setSelectedDept(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'individual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              <User className="w-4 h-4" /> Individual
            </button>
            <button
              onClick={() => { setMode('department'); setSelectedEmployeeId(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'department' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              <Users className="w-4 h-4" /> By Department
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {mode === 'individual' ? (
              <div className="space-y-1">
                <Label>Employee *</Label>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map(e => (
                      <SelectItem key={e.user_id} value={e.user_id}>
                        {e.display_name} {e.department ? `· ${e.department}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Department *</Label>
                <Select value={selectedDept} onValueChange={setSelectedDept}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>Leave Type *</Label>
              <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId}>
                <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                <SelectContent>
                  {leavePolicies.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Days to Allocate *</Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                value={days}
                onChange={e => setDays(e.target.value)}
                placeholder="e.g. 12"
              />
            </div>

            <div className="space-y-1">
              <Label>Year *</Label>
              <Select value={year.toString()} onValueChange={v => setYear(parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027].map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preview */}
          {targetEmployees.length > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-sm font-medium text-blue-800 mb-2">
                Will allocate to {targetEmployees.length} employee(s):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {targetEmployees.slice(0, 10).map(e => (
                  <Badge key={e.user_id} variant="outline" className="text-xs">{e.display_name}</Badge>
                ))}
                {targetEmployees.length > 10 && (
                  <Badge variant="outline" className="text-xs">+{targetEmployees.length - 10} more</Badge>
                )}
              </div>
            </div>
          )}

          <Button
            onClick={handleAllocate}
            disabled={saving || targetEmployees.length === 0 || !selectedPolicyId || !days}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            {saving ? 'Allocating...' : `Allocate to ${targetEmployees.length} Employee(s)`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}