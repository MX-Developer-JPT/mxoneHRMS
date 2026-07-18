import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UserPlus, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';

export default function HRApplyOnBehalf({ employees, leavePolicies, loadData, user }) {
  const [selectedEmp, setSelectedEmp] = useState('');
  const [hrEmpOpen, setHrEmpOpen] = useState(false);
  const [balances, setBalances] = useState([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    leave_policy_id: '',
    start_date: '',
    end_date: '',
    reason: '',
    half_day: false,
  });

  const activeEmployees = employees.filter(e => e.status === 'active');

  useEffect(() => {
    if (selectedEmp) loadBalances(selectedEmp);
    else setBalances([]);
  }, [selectedEmp]);

  const loadBalances = async (userId) => {
    setLoadingBalances(true);
    try {
      const currentYear = new Date().getFullYear();
      const balData = await base44.entities.LeaveBalance.filter({ user_id: userId, year: currentYear });
      setBalances(balData);
    } catch (err) {
      console.error(err);
    }
    setLoadingBalances(false);
  };

  const getPolicyName = (policyId) => leavePolicies.find(p => p.id === policyId)?.name || policyId;
  const getPolicyCode = (policyId) => leavePolicies.find(p => p.id === policyId)?.code || '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEmp || !form.leave_policy_id || !form.start_date || !form.end_date) {
      toast.error('Please fill all required fields');
      return;
    }

    const start = new Date(form.start_date);
    const end = new Date(form.end_date);
    if (end < start) { toast.error('End date must be after start date'); return; }

    const days = form.half_day ? 0.5 : differenceInDays(end, start) + 1;

    // Check balance
    const bal = balances.find(b => b.leave_policy_id === form.leave_policy_id);
    if (bal && days > (bal.available || 0)) {
      if (!confirm(`This employee only has ${bal.available} day(s) available. Apply anyway?`)) return;
    }

    setSubmitting(true);
    try {
      const policy = leavePolicies.find(p => p.id === form.leave_policy_id);
      await base44.entities.Leave.create({
        user_id: selectedEmp,
        leave_policy_id: form.leave_policy_id,
        start_date: form.start_date,
        end_date: form.end_date,
        total_days: days,
        half_day: form.half_day,
        reason: form.reason || `Applied by HR (${user?.full_name})`,
        status: 'approved',
        approved_by: user?.id,
        approved_date: new Date().toISOString(),
        current_approval_level: 2,
        approval_history: [{
          level: 1,
          approver_id: user.id,
          approver_name: user?.full_name || 'HR',
          status: 'approved',
          comments: 'Applied by HR on behalf of employee',
          timestamp: new Date().toISOString()
        }, {
          level: 2,
          approver_id: user.id,
          approver_name: user?.full_name || 'HR',
          status: 'approved',
          comments: 'Final approval by HR',
          timestamp: new Date().toISOString()
        }],
        applied_on: new Date().toISOString(),
      });

      // Update leave balance (balances[] is already year-scoped — loadBalances
      // fetches with { year: currentYear }, so bal is the right year's row)
      if (bal) {
        await base44.entities.LeaveBalance.update(bal.id, {
          used: (bal.used || 0) + days,
          available: Math.max((bal.available || 0) - days, 0),
        });
      }

      // Auto-mark attendance with status='leave' (not 'present') so this
      // agrees with every other consumer of Attendance status — the report,
      // muster, and payroll's day-tally all branch on the actual leave
      // status, not just "was there any record". Skips a day that already
      // has real check-in data rather than overwriting it.
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const existing = await base44.entities.Attendance.filter({ user_id: selectedEmp, date: dateStr });
        if (existing.length === 0) {
          await base44.entities.Attendance.create({
            user_id: selectedEmp, date: dateStr, status: 'leave',
            auto_marked: true, notes: `Leave applied by HR (${policy?.code || ''})`,
          });
        } else if (!existing[0].check_in_time) {
          await base44.entities.Attendance.update(existing[0].id, {
            status: 'leave', auto_marked: true, notes: `Leave applied by HR (${policy?.code || ''})`,
          });
        }
      }

      toast.success(`Leave applied successfully for ${employees.find(e => e.user_id === selectedEmp)?.display_name}`);
      setForm({ leave_policy_id: '', start_date: '', end_date: '', reason: '', half_day: false });
      loadBalances(selectedEmp);
      if (loadData) loadData();
    } catch (err) {
      toast.error('Failed to apply leave: ' + err.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Apply Leave on Behalf of Employee</h2>
        <p className="text-sm text-gray-500">HR can directly apply and approve leave for any employee</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Employee Selection + Balances */}
        <Card>
          <CardHeader><CardTitle className="text-base">Select Employee</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Employee *</Label>
              <Popover open={hrEmpOpen} onOpenChange={setHrEmpOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                    <span className={selectedEmp ? 'text-foreground' : 'text-muted-foreground'}>
                      {selectedEmp ? (() => { const e = activeEmployees.find(e => e.user_id === selectedEmp); return e ? `${e.display_name} — ${e.employee_code}` : selectedEmp; })() : 'Search employee...'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name, code..." />
                    <CommandList>
                      <CommandEmpty>No employee found.</CommandEmpty>
                      <CommandGroup>
                        {activeEmployees.map(e => (
                          <CommandItem key={e.user_id} value={`${e.display_name || ''} ${e.employee_code || ''} ${e.department || ''}`} onSelect={() => { setSelectedEmp(e.user_id); setHrEmpOpen(false); }}>
                            <Check className={`mr-2 h-4 w-4 ${selectedEmp === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                            <div>
                              <p className="font-medium">{e.display_name}</p>
                              <p className="text-xs text-muted-foreground">{e.employee_code} · {e.department}</p>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedEmp && (
              <div>
                <Label className="mb-2 block">Leave Balances</Label>
                {loadingBalances ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                ) : balances.length === 0 ? (
                  <p className="text-sm text-gray-400">No leave balances found</p>
                ) : (
                  <div className="space-y-2">
                    {balances.map(b => (
                      <div key={b.id} className="flex items-center justify-between text-sm border rounded p-2">
                        <div>
                          <Badge className="mr-2 text-xs">{getPolicyCode(b.leave_policy_id)}</Badge>
                          {getPolicyName(b.leave_policy_id)}
                        </div>
                        <span className="font-semibold text-green-700">{b.available || 0} left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leave Form */}
        <Card>
          <CardHeader><CardTitle className="text-base">Apply Leave</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Leave Type *</Label>
                <Select value={form.leave_policy_id} onValueChange={v => setForm({...form, leave_policy_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                  <SelectContent>
                    {leavePolicies.filter(p => p.is_active !== false).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Date *</Label>
                  <Input type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} />
                </div>
                <div>
                  <Label>End Date *</Label>
                  <Input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} />
                </div>
              </div>
              <div>
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="Reason for leave..." rows={2} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || !selectedEmp}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Apply & Approve Leave
              </Button>
              <p className="text-xs text-gray-400 text-center">Leave will be auto-approved and attendance marked</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}