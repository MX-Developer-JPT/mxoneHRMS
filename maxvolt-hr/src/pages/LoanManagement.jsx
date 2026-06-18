import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Calendar, Check, X } from 'lucide-react';
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

export default function LoanManagement() {
  const [user, setUser] = useState(null);
  const [loans, setLoans] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [formData, setFormData] = useState({
    loan_type: 'personal',
    loan_amount: '',
    monthly_deduction: '',
    interest_rate: 0,
    start_date: '',
    remarks: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const isHR = currentUser.role === 'hr' || currentUser.role === 'admin';

      let loanRecords;
      if (isHR) {
        loanRecords = await base44.entities.Loan.list('-created_date', 500);
        const empRecords = await base44.entities.Employee.list();
        const users = await base44.entities.User.list();
        const enrichedEmps = empRecords.map(emp => ({
          ...emp,
          user: users.find(u => u.id === emp.user_id)
        }));
        setEmployees(enrichedEmps);
      } else {
        loanRecords = await base44.entities.Loan.filter({ user_id: currentUser.id }, '-created_date');
      }

      setLoans(loanRecords);
      setLoading(false);
    } catch (error) {
      console.error('Error loading loans:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const loanAmount = parseFloat(formData.loan_amount);
      const monthlyDeduction = parseFloat(formData.monthly_deduction);
      
      await base44.entities.Loan.create({
        user_id: user.id,
        loan_type: formData.loan_type,
        loan_amount: loanAmount,
        outstanding_amount: loanAmount,
        monthly_deduction: monthlyDeduction,
        interest_rate: parseFloat(formData.interest_rate) || 0,
        start_date: formData.start_date,
        remarks: formData.remarks,
        status: 'pending'
      });

      toast.success('Loan application submitted');
      setShowDialog(false);
      setFormData({
        loan_type: 'personal',
        loan_amount: '',
        monthly_deduction: '',
        interest_rate: 0,
        start_date: '',
        remarks: ''
      });
      loadData();
    } catch (error) {
      toast.error('Error submitting loan application');
    }
  };

  const handleApprove = async (loanId) => {
    try {
      const loan = loans.find(l => l.id === loanId);
      const tenureMonths = Math.ceil(loan.loan_amount / loan.monthly_deduction);
      const endDate = new Date(loan.start_date);
      endDate.setMonth(endDate.getMonth() + tenureMonths);

      await base44.entities.Loan.update(loanId, {
        status: 'approved',
        approved_by: user.id,
        approved_date: new Date().toISOString(),
        end_date: endDate.toISOString().split('T')[0]
      });
      toast.success('Loan approved');
      loadData();
    } catch (error) {
      toast.error('Error approving loan');
    }
  };

  const handleReject = async (loanId) => {
    try {
      await base44.entities.Loan.update(loanId, { status: 'rejected' });
      toast.success('Loan rejected');
      loadData();
    } catch (error) {
      toast.error('Error rejecting loan');
    }
  };

  const handleActivate = async (loanId) => {
    try {
      await base44.entities.Loan.update(loanId, { status: 'active' });
      toast.success('Loan activated - deductions will begin');
      loadData();
    } catch (error) {
      toast.error('Error activating loan');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const isHR = user.role === 'hr' || user.role === 'admin';

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    active: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
    rejected: 'bg-red-100 text-red-800'
  };

  const activeLoans = loans.filter(l => l.status === 'active');
  const totalOutstanding = activeLoans.reduce((sum, l) => sum + (l.outstanding_amount || 0), 0);
  const monthlyDeduction = activeLoans.reduce((sum, l) => sum + (l.monthly_deduction || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Loan Management</h1>
            <p className="text-gray-600 mt-1">Manage employee loans and advances</p>
          </div>
          {!isHR && (
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <DollarSign className="w-4 h-4 mr-2" />
                  Apply for Loan
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Loan Application</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label>Loan Type</Label>
                    <Select value={formData.loan_type} onValueChange={(v) => setFormData({...formData, loan_type: v})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="personal">Personal</SelectItem>
                        <SelectItem value="vehicle">Vehicle</SelectItem>
                        <SelectItem value="home">Home</SelectItem>
                        <SelectItem value="education">Education</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Loan Amount (₹)</Label>
                    <Input
                      type="number"
                      required
                      value={formData.loan_amount}
                      onChange={(e) => setFormData({...formData, loan_amount: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Monthly Deduction (₹)</Label>
                    <Input
                      type="number"
                      required
                      value={formData.monthly_deduction}
                      onChange={(e) => setFormData({...formData, monthly_deduction: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      required
                      value={formData.start_date}
                      onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Remarks</Label>
                    <Textarea
                      value={formData.remarks}
                      onChange={(e) => setFormData({...formData, remarks: e.target.value})}
                    />
                  </div>
                  <Button type="submit" className="w-full">Submit Application</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-green-100 rounded-full">
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Active Loans</p>
                  <p className="text-2xl font-bold text-green-600">{activeLoans.length}</p>
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
                  <p className="text-sm text-gray-600">Total Outstanding</p>
                  <p className="text-2xl font-bold text-orange-600">₹{totalOutstanding.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-100 rounded-full">
                  <Calendar className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Monthly Deduction</p>
                  <p className="text-2xl font-bold text-blue-600">₹{monthlyDeduction.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Loan Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {loans.map(loan => {
                const emp = employees.find(e => e.user_id === loan.user_id);
                return (
                  <div key={loan.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        {isHR && emp && (
                          <p className="font-semibold">{emp.user?.full_name}</p>
                        )}
                        <p className="text-sm text-gray-600 capitalize">{loan.loan_type} Loan</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Applied: {new Date(loan.created_date).toLocaleDateString()}
                        </p>
                        {loan.remarks && (
                          <p className="text-xs text-gray-600 mt-2">{loan.remarks}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-blue-600">₹{loan.loan_amount?.toLocaleString()}</p>
                        <p className="text-sm text-gray-600">Outstanding: ₹{loan.outstanding_amount?.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">EMI: ₹{loan.monthly_deduction?.toLocaleString()}/month</p>
                        <div className="mt-2 flex gap-2 justify-end">
                          <Badge className={statusColors[loan.status]}>
                            {loan.status.toUpperCase()}
                          </Badge>
                          {isHR && loan.status === 'pending' && (
                            <>
                              <Button size="sm" onClick={() => handleApprove(loan.id)} className="bg-green-600 hover:bg-green-700">
                                <Check className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleReject(loan.id)}>
                                <X className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                          {isHR && loan.status === 'approved' && (
                            <Button size="sm" onClick={() => handleActivate(loan.id)} className="bg-blue-600 hover:bg-blue-700">
                              Activate
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {loans.length === 0 && (
                <p className="text-center text-gray-500 py-8">No loan records found</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}