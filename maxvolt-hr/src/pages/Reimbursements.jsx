import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Receipt, DollarSign } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function Reimbursements() {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [reimbursements, setReimbursements] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewerDoc, setViewerDoc] = useState(null);

  const [formData, setFormData] = useState({
    expense_type: '',
    amount: '',
    expense_date: '',
    description: ''
  });
  const [receiptFile, setReceiptFile] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const [claims, empRecords] = await Promise.all([
        base44.entities.Reimbursement.filter({ user_id: currentUser.id }, '-created_date'),
        base44.entities.Employee.filter({ user_id: currentUser.id })
      ]);
      setEmployee(empRecords[0] || null);
      setReimbursements(claims);
      setLoading(false);
    } catch (error) {
      console.error('Error loading reimbursements:', error);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);

      let receipt_url = '';
      if (receiptFile) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: receiptFile });
        receipt_url = file_url;
      }

      await base44.entities.Reimbursement.create({
        ...formData,
        user_id: user.id,
        amount: parseFloat(formData.amount),
        receipt_url,
        status: 'pending',
        manager_id: employee?.reporting_manager_id || null,
      });

      toast.success('Reimbursement claim submitted successfully');
      setShowForm(false);
      setFormData({ expense_type: '', amount: '', expense_date: '', description: '' });
      setReceiptFile(null);
      loadData();
    } catch (error) {
      console.error('Error submitting reimbursement:', error);
      toast.error('Failed to submit claim');
      setLoading(false);
    }
  };

  if (loading && !user) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    paid: 'bg-blue-100 text-blue-800'
  };

  const expenseTypes = [
    { value: 'travel', label: 'Travel' },
    { value: 'food', label: 'Food' },
    { value: 'accommodation', label: 'Accommodation' },
    { value: 'medical', label: 'Medical' },
    { value: 'office_supplies', label: 'Office Supplies' },
    { value: 'other', label: 'Other' }
  ];

  const totalPending = reimbursements.filter(r => r.status === 'pending').reduce((sum, r) => sum + r.amount, 0);
  const totalApproved = reimbursements.filter(r => r.status === 'approved' || r.status === 'paid').reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Expense Reimbursements</h1>
            <p className="text-gray-600 mt-1">Submit and track your expense claims</p>
          </div>
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-5 h-5 mr-2" />
                New Claim
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit Expense Claim</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Expense Type</Label>
                  <Select
                    value={formData.expense_type}
                    onValueChange={(value) => setFormData({ ...formData, expense_type: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseTypes.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Amount (₹)</Label>
                    <Input
                      type="number"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <Label>Expense Date</Label>
                    <Input
                      type="date"
                      value={formData.expense_date}
                      onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the expense"
                    rows={3}
                    required
                  />
                </div>

                <div>
                  <Label>Upload Receipt (Optional)</Label>
                  <Input
                    type="file"
                    onChange={(e) => setReceiptFile(e.target.files[0])}
                    accept="image/*,.pdf"
                  />
                </div>

                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Submit Claim</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-yellow-100 rounded-full">
                  <DollarSign className="w-8 h-8 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Pending Claims</p>
                  <p className="text-3xl font-bold text-yellow-600">₹{totalPending.toLocaleString()}</p>
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
                  <p className="text-sm text-gray-600">Approved/Paid</p>
                  <p className="text-3xl font-bold text-green-600">₹{totalApproved.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Claims History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {reimbursements.length > 0 ? (
                reimbursements.map(claim => (
                  <div key={claim.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <Receipt className="w-5 h-5 text-gray-600" />
                          <p className="font-semibold capitalize">{(claim.expense_type || '').replace('_', ' ')}</p>
                          <Badge className={statusColors[claim.status]}>
                            {claim.status.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                          {safeDate(claim.expense_date, 'MMM d, yyyy')}
                        </p>
                        <p className="text-sm break-words">{claim.description}</p>
                        {claim.rejection_reason && (
                          <div className="mt-2 p-2 bg-red-50 rounded">
                            <p className="text-sm text-red-800 break-words">
                              <strong>Rejection Reason:</strong> {claim.rejection_reason}
                            </p>
                          </div>
                        )}
                        {claim.receipt_url && (
                          <Button
                            variant="link"
                            onClick={() => setViewerDoc({ url: claim.receipt_url, title: 'Receipt' })}
                            className="px-0 mt-2"
                            size="sm"
                          >
                            View Receipt
                          </Button>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-blue-600">₹{(claim.amount || 0).toLocaleString()}</p>
                        {claim.payment_date && (
                          <p className="text-xs text-gray-500">
                            Paid on {safeDate(claim.payment_date, 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500 py-8">No expense claims yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <DocViewerModal
        open={!!viewerDoc}
        url={viewerDoc?.url}
        title={viewerDoc?.title}
        onClose={() => setViewerDoc(null)}
      />
    </div>
  );
}