import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import { LogOut, LogIn, Clock, CheckCircle2, XCircle, AlertCircle, Plus, History } from 'lucide-react';
import GatePassHistory from '@/components/gatepass/GatePassHistory';

const STATUS_COLORS = {
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  departed: 'bg-orange-100 text-orange-800',
  returned: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const STATUS_LABELS = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  departed: 'Departed',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

const OUTING_TYPES = [
  { value: 'official_outing', label: 'Official Outing', desc: 'No LOP deduction — full day present' },
  { value: 'unofficial_outing', label: 'Unofficial Outing', desc: 'Half day LOP deducted' },
  { value: 'half_day', label: 'Half Day', desc: 'Half day LOP deducted' },
  { value: 'short_break', label: 'Short Break', desc: 'No deduction if returned within 3 hours, else half day LOP' },
  { value: 'early_leave', label: 'Early Leave', desc: 'Half day LOP deducted' },
];

export default function GatePassRequest() {
  const [user, setUser] = useState(null);
  const [myPasses, setMyPasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ outing_type: 'unofficial_outing', reason: '', expected_return_time: '' });
  const [activeTab, setActiveTab] = useState('active');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const currentUser = await base44.auth.me();
    setUser(currentUser);
    const passes = await base44.entities.GatePass.filter({ employee_user_id: currentUser.id });
    passes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    setMyPasses(passes);
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const empRecords = await base44.entities.Employee.filter({ user_id: user.id });
    const emp = empRecords[0];
    await base44.entities.GatePass.create({
      employee_user_id: user.id,
      outing_type: form.outing_type,
      reason: form.reason,
      expected_return_time: form.expected_return_time || null,
      request_date: format(new Date(), 'yyyy-MM-dd'),
      status: 'pending_approval',
      manager_approval_status: 'pending',
      manager_user_id: emp?.reporting_manager_id || null,
      lop_deduction_days: 0,
    });
    setForm({ outing_type: 'unofficial_outing', reason: '', expected_return_time: '' });
    setShowForm(false);
    await loadData();
    setSubmitting(false);
  };

  const getOutingLabel = (type) => OUTING_TYPES.find(o => o.value === type)?.label || type;

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  const activePasses = myPasses.filter(p => ['pending_approval', 'approved', 'departed'].includes(p.status));

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <LogOut className="w-6 h-6 text-blue-600" /> My Gate Passes
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Request permission to leave office premises</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="w-4 h-4" /> New Request
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg">New Gate Pass Request</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Outing Type *</Label>
                <Select value={form.outing_type} onValueChange={v => setForm(f => ({ ...f, outing_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTING_TYPES.map(ot => (
                      <SelectItem key={ot.value} value={ot.value}>
                        <span className="font-medium">{ot.label}</span>
                        <span className="text-xs text-gray-400 ml-2">— {ot.desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  {OUTING_TYPES.find(o => o.value === form.outing_type)?.desc}
                </p>
              </div>
              <div>
                <Label>Reason (optional)</Label>
                <Textarea
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Enter reason or details..."
                  rows={3}
                />
              </div>
              <div>
                <Label>Expected Return Time (optional)</Label>
                <Input
                  type="datetime-local"
                  value={form.expected_return_time}
                  onChange={e => setForm(f => ({ ...f, expected_return_time: e.target.value }))}
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b dark:border-gray-700 pb-2">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'active' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          Active Passes
          {activePasses.length > 0 && (
            <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${activeTab === 'active' ? 'bg-white text-blue-600' : 'bg-blue-100 text-blue-700'}`}>
              {activePasses.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <History className="w-4 h-4" /> History
        </button>
      </div>

      {activeTab === 'active' && (
        <div className="space-y-4">
          {activePasses.length === 0 && (
            <div className="text-center py-12 text-gray-400">No active gate pass requests.</div>
          )}
          {activePasses.map(pass => (
            <Card key={pass.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{getOutingLabel(pass.outing_type)}</Badge>
                    </div>
                    {pass.reason && <p className="font-medium text-gray-900 dark:text-gray-100">{pass.reason}</p>}
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Requested: {safeDate(pass.created_date, 'dd MMM yyyy, hh:mm a')}
                    </p>
                    {pass.expected_return_time && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Expected return: {safeDate(pass.expected_return_time, 'dd MMM yyyy, hh:mm a')}
                      </p>
                    )}
                    {pass.manager_comment && (
                      <p className="text-sm text-orange-600 mt-1">Manager: {pass.manager_comment}</p>
                    )}
                    {pass.departure_time && (
                      <p className="text-sm text-orange-600 mt-1 flex items-center gap-1">
                        <LogOut className="w-3.5 h-3.5" /> Departed: {safeDate(pass.departure_time, 'hh:mm a')}
                      </p>
                    )}
                    {pass.return_time && (
                      <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
                        <LogIn className="w-3.5 h-3.5" /> Returned: {safeDate(pass.return_time, 'hh:mm a')}
                      </p>
                    )}
                  </div>
                  <Badge className={STATUS_COLORS[pass.status]}>
                    {STATUS_LABELS[pass.status]}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'history' && user && (
        <GatePassHistory filterUserId={user.id} showEmployeeName={false} />
      )}
    </div>
  );
}