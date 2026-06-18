import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function LeavePolicyManager({ onUpdate }) {
  const [policies, setPolicies] = useState([]);
  const [showDialog, setShowDialog] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    total_days: 0,
    total_leave_per_month: '',
    max_leave_per_month: '',
    renews_in_days: '',
    renewed_leave_balance: '',
    accrual_type: 'yearly',
    probation_period_applicable: false,
    carry_forward: false,
    requires_approval: true,
    is_active: true,
    description: ''
  });

  React.useEffect(() => {
    loadPolicies();
  }, []);

  const loadPolicies = async () => {
    try {
      const data = await base44.entities.LeavePolicy.list();
      setPolicies(data);
    } catch (error) {
      console.error('Error loading policies:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      total_days: 0,
      total_leave_per_month: '',
      max_leave_per_month: '',
      renews_in_days: '',
      renewed_leave_balance: '',
      accrual_type: 'yearly',
      probation_period_applicable: false,
      carry_forward: false,
      requires_approval: true,
      is_active: true,
      description: ''
    });
    setEditingPolicy(null);
  };

  const handleEdit = (policy) => {
    setEditingPolicy(policy);
    setFormData(policy);
    setShowDialog(true);
  };

  const handleDelete = async (policyId) => {
    if (!confirm('Are you sure you want to delete this leave policy?')) return;
    
    try {
      await base44.entities.LeavePolicy.delete(policyId);
      toast.success('Leave policy deleted');
      loadPolicies();
      onUpdate && onUpdate();
    } catch (error) {
      toast.error('Failed to delete policy');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingPolicy) {
        await base44.entities.LeavePolicy.update(editingPolicy.id, formData);
        toast.success('Leave policy updated');
      } else {
        await base44.entities.LeavePolicy.create(formData);
        toast.success('Leave policy created');
      }
      
      setShowDialog(false);
      resetForm();
      loadPolicies();
      onUpdate && onUpdate();
    } catch (error) {
      toast.error('Failed to save policy');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Leave Policies</h2>
        <Button onClick={() => { resetForm(); setShowDialog(true); }} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Leave Type
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {policies.map(policy => (
          <Card key={policy.id}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{policy.name}</CardTitle>
                  <p className="text-sm text-gray-600">{policy.code}</p>
                </div>
                <Badge variant={policy.is_active ? "default" : "secondary"}>
                  {policy.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-2xl font-bold text-blue-600">{policy.total_days} days/yr</p>
              <p className="text-sm text-gray-600 capitalize">{policy.accrual_type} accrual</p>
              {(policy.total_leave_per_month || policy.max_leave_per_month) && (
                <div className="text-xs text-gray-500 space-y-0.5">
                  {policy.total_leave_per_month && <p>Monthly total: <strong>{policy.total_leave_per_month} days</strong></p>}
                  {policy.max_leave_per_month && <p>Monthly max: <strong>{policy.max_leave_per_month} days</strong></p>}
                </div>
              )}
              {(policy.renews_in_days || policy.renewed_leave_balance) && (
                <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                  {policy.renews_in_days && <span>Renews every {policy.renews_in_days} days</span>}
                  {policy.renewed_leave_balance && <span> · +{policy.renewed_leave_balance} days/cycle</span>}
                </div>
              )}
              {policy.description && (
                <p className="text-sm text-gray-500">{policy.description}</p>
              )}
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => handleEdit(policy)}>
                  <Edit2 className="w-3 h-3 mr-1" />
                  Edit
                </Button>
                <Button size="sm" variant="destructive" onClick={() => handleDelete(policy.id)}>
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? 'Edit Leave Policy' : 'Create Leave Policy'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Leave Type Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Casual Leave"
                  required
                />
              </div>
              <div>
                <Label>Code *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., CL"
                  required
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Total Days per Year *</Label>
                <Input
                  type="number"
                  value={formData.total_days}
                  onChange={(e) => setFormData({ ...formData, total_days: parseFloat(e.target.value) })}
                  required
                />
              </div>
              <div>
                <Label>Accrual Type</Label>
                <Select value={formData.accrual_type} onValueChange={(val) => setFormData({ ...formData, accrual_type: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yearly">Yearly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="joining_date">From Joining Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Monthly Limits */}
            <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Monthly Leave Limits & Renewal</p>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Total Leave per Month</Label>
                  <Input
                    type="number"
                    value={formData.total_leave_per_month}
                    onChange={(e) => setFormData({ ...formData, total_leave_per_month: e.target.value ? parseFloat(e.target.value) : '' })}
                    placeholder="e.g., 2"
                  />
                  <p className="text-xs text-gray-500 mt-1">Total days allowed within any month</p>
                </div>
                <div>
                  <Label>Maximum Leave per Month</Label>
                  <Input
                    type="number"
                    value={formData.max_leave_per_month}
                    onChange={(e) => setFormData({ ...formData, max_leave_per_month: e.target.value ? parseFloat(e.target.value) : '' })}
                    placeholder="e.g., 3"
                  />
                  <p className="text-xs text-gray-500 mt-1">Hard cap on leaves in a single month</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Renews In (Days)</Label>
                  <Input
                    type="number"
                    value={formData.renews_in_days}
                    onChange={(e) => setFormData({ ...formData, renews_in_days: e.target.value ? parseFloat(e.target.value) : '' })}
                    placeholder="e.g., 30"
                  />
                  <p className="text-xs text-gray-500 mt-1">Days after which balance refreshes</p>
                </div>
                <div>
                  <Label>Renewed Leave Balance (Days)</Label>
                  <Input
                    type="number"
                    value={formData.renewed_leave_balance}
                    onChange={(e) => setFormData({ ...formData, renewed_leave_balance: e.target.value ? parseFloat(e.target.value) : '' })}
                    placeholder="e.g., 1.5"
                  />
                  <p className="text-xs text-gray-500 mt-1">Days added per renewal cycle</p>
                </div>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
                rows={2}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Applicable During Probation</Label>
                <Switch
                  checked={formData.probation_period_applicable}
                  onCheckedChange={(val) => setFormData({ ...formData, probation_period_applicable: val })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Allow Carry Forward</Label>
                <Switch
                  checked={formData.carry_forward}
                  onCheckedChange={(val) => setFormData({ ...formData, carry_forward: val })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Requires Approval</Label>
                <Switch
                  checked={formData.requires_approval}
                  onCheckedChange={(val) => setFormData({ ...formData, requires_approval: val })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(val) => setFormData({ ...formData, is_active: val })}
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4">
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {editingPolicy ? 'Update' : 'Create'} Policy
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}