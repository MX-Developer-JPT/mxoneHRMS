import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Plus, Check, X, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export default function OffCyclePayments() {
  const [payments, setPayments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    payment_type: 'bonus',
    amount: '',
    reason: '',
    payment_date: new Date().toISOString().split('T')[0],
    payroll_month: new Date().getMonth() + 1,
    payroll_year: new Date().getFullYear(),
  });

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const years = [2024, 2025, 2026, 2027];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const bonusRecords = await base44.entities.Bonus.list('-created_date', 500);
      const empRecords = await base44.entities.Employee.list();
      const users = await base44.entities.User.list();

      const enrichedEmps = empRecords.map(emp => ({
        ...emp,
        user: users.find(u => u.id === emp.user_id)
      }));

      setPayments(bonusRecords);
      setEmployees(enrichedEmps);
      setLoading(false);
    } catch (error) {
      console.error('Error loading payments:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.Bonus.create({
        user_id: formData.user_id,
        bonus_type: formData.payment_type,
        amount: parseFloat(formData.amount),
        reason: formData.reason,
        payment_date: formData.payment_date,
        month: formData.payroll_month,
        year: formData.payroll_year,
        status: 'pending',
        included_in_payroll: false,
        approved_by: null,
        approved_date: null
      });

      toast.success('Off-cycle payment created');
      setShowDialog(false);
      setFormData({
        user_id: '',
        payment_type: 'bonus',
        amount: '',
        reason: '',
        payment_date: new Date().toISOString().split('T')[0],
        payroll_month: new Date().getMonth() + 1,
        payroll_year: new Date().getFullYear(),
      });
      loadData();
    } catch (error) {
      toast.error('Error creating payment');
    }
  };

  const handleApprove = async (paymentId) => {
    try {
      const user = await base44.auth.me();
      await base44.entities.Bonus.update(paymentId, {
        status: 'approved',
        approved_by: user.id,
        approved_date: new Date().toISOString()
      });
      toast.success('Payment approved');
      loadData();
    } catch (error) {
      toast.error('Error approving payment');
    }
  };

  const handleReject = async (paymentId) => {
    try {
      await base44.entities.Bonus.update(paymentId, { status: 'rejected' });
      toast.success('Payment rejected');
      loadData();
    } catch (error) {
      toast.error('Error rejecting payment');
    }
  };

  const handleMarkPaid = async (paymentId) => {
    try {
      await base44.entities.Bonus.update(paymentId, { status: 'paid' });
      toast.success('Marked as paid');
      loadData();
    } catch (error) {
      toast.error('Error updating status');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800'
  };

  const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const paidAmount = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Off-Cycle Payments</h1>
            <p className="text-gray-600 mt-1">Manage special payments outside regular payroll</p>
          </div>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                New Payment
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Off-Cycle Payment</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Employee</Label>
                  <Popover open={empOpen} onOpenChange={setEmpOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent hover:text-accent-foreground">
                        <span className={formData.user_id ? 'text-foreground' : 'text-muted-foreground'}>
                          {formData.user_id
                            ? (() => { const e = employees.find(e => e.user_id === formData.user_id); return e ? `${e.user?.full_name} — ${e.designation}` : 'Select employee'; })()
                            : 'Select employee'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search employee..." />
                        <CommandList>
                          <CommandEmpty>No employee found.</CommandEmpty>
                          <CommandGroup>
                            {employees.map(emp => (
                              <CommandItem
                                key={emp.user_id}
                                value={`${emp.user?.full_name} ${emp.designation} ${emp.employee_code || ''}`}
                                onSelect={() => { setFormData({ ...formData, user_id: emp.user_id }); setEmpOpen(false); }}
                              >
                                <div>
                                  <p className="font-medium">{emp.user?.full_name}</p>
                                  <p className="text-xs text-gray-500">{emp.designation} {emp.employee_code ? `· ${emp.employee_code}` : ''}</p>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label>Payment Type</Label>
                  <Select value={formData.payment_type} onValueChange={(v) => setFormData({...formData, payment_type: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="performance">Performance Bonus</SelectItem>
                      <SelectItem value="festival">Festival Bonus</SelectItem>
                      <SelectItem value="joining">Joining Bonus</SelectItem>
                      <SelectItem value="retention">Retention Bonus</SelectItem>
                      <SelectItem value="referral">Referral Bonus</SelectItem>
                      <SelectItem value="project">Project Completion</SelectItem>
                      <SelectItem value="arrears">Arrears</SelectItem>
                      <SelectItem value="incentive">Sales Incentive</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount (₹)</Label>
                  <Input
                    type="number"
                    required
                    value={formData.amount}
                    onChange={(e) => setFormData({...formData, amount: e.target.value})}
                  />
                </div>
                <div>
                  <Label>Payment Date</Label>
                  <Input
                    type="date"
                    required
                    value={formData.payment_date}
                    onChange={(e) => setFormData({...formData, payment_date: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Payroll Month</Label>
                    <Select value={formData.payroll_month.toString()} onValueChange={(v) => setFormData({...formData, payroll_month: parseInt(v)})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {monthNames.map((name, idx) => (
                          <SelectItem key={idx + 1} value={(idx + 1).toString()}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Payroll Year</Label>
                    <Select value={formData.payroll_year.toString()} onValueChange={(v) => setFormData({...formData, payroll_year: parseInt(v)})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">This payment will be disbursed with the <strong>{monthNames[formData.payroll_month - 1]} {formData.payroll_year}</strong> payroll cycle.</p>
                <div>
                  <Label>Reason</Label>
                  <Textarea
                    required
                    value={formData.reason}
                    onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  />
                </div>
                <Button type="submit" className="w-full">Create Payment</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-100 rounded-full">
                  <DollarSign className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Payments</p>
                  <p className="text-2xl font-bold text-blue-600">{payments.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-orange-100 rounded-full">
                  <DollarSign className="w-8 h-8 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-2xl font-bold text-orange-600">₹{totalAmount.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-green-100 rounded-full">
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Paid Amount</p>
                  <p className="text-2xl font-bold text-green-600">₹{paidAmount.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payment Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {payments.map(payment => {
                const emp = employees.find(e => e.user_id === payment.user_id);
                return (
                  <div key={payment.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-semibold break-words">{emp?.user?.full_name}</p>
                        <p className="text-sm text-gray-600 capitalize">{payment.bonus_type?.replace('_', ' ')} Bonus</p>
                        <p className="text-xs text-gray-500 mt-1 break-words">{payment.reason}</p>
                        <p className="text-xs text-gray-500">
                          Payment Date: {new Date(payment.payment_date).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          Payroll Cycle: {monthNames[(payment.month || 1) - 1]} {payment.year}
                          {payment.included_in_payroll && (
                            <Badge className="ml-2 bg-green-100 text-green-800 text-[10px]">Included in Payroll</Badge>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-green-600">₹{payment.amount?.toLocaleString()}</p>
                        <div className="mt-2 flex gap-2 justify-end items-center flex-wrap">
                          <Badge className={statusColors[payment.status]}>
                            {payment.status.toUpperCase()}
                          </Badge>
                          {payment.status === 'pending' && (
                            <>
                              <Button size="sm" onClick={() => handleApprove(payment.id)} className="bg-green-600 hover:bg-green-700">
                                <Check className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleReject(payment.id)}>
                                <X className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                          {payment.status === 'approved' && (
                            <Button size="sm" onClick={() => handleMarkPaid(payment.id)} className="bg-blue-600 hover:bg-blue-700">
                              Mark Paid
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {payments.length === 0 && (
                <p className="text-center text-gray-500 py-8">No off-cycle payments found</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}