import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { safeDate, nowIST } from '@/lib/dateUtils';
import { CheckCircle2, XCircle, Clock, User, History, LogOut, LogIn } from 'lucide-react';
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

export default function GatePassApproval() {
  const [user, setUser] = useState(null);
  const [passes, setPasses] = useState([]);
  const [isHR, setIsHR] = useState(false);
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [filter, setFilter] = useState('pending_approval');
  const [activeTab, setActiveTab] = useState('approvals');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const currentUser = await base44.auth.me();
    setUser(currentUser);

    const role = currentUser.custom_role || currentUser.role;
    const hrUser = ['hr', 'admin', 'management'].includes(role);
    setIsHR(hrUser);

    const [allPasses, allEmployees] = await Promise.all([
      base44.entities.GatePass.list('-created_date', 500),
      base44.entities.Employee.list(),
    ]);

    const empMap = {};
    allEmployees.forEach(e => { empMap[e.user_id] = e; });
    setEmployees(empMap);

    let visiblePasses;
    if (hrUser) {
      // HR sees all passes (except pending_approval which manager hasn't touched)
      visiblePasses = allPasses;
    } else {
      // Manager sees only their direct reports' pending passes
      const myEmpIds = allEmployees
        .filter(e => e.reporting_manager_id === currentUser.id)
        .map(e => e.user_id);
      visiblePasses = allPasses.filter(p => myEmpIds.includes(p.employee_user_id));
    }

    setPasses(visiblePasses);
    setLoading(false);
  };

  const handleAction = async (action) => {
    setActionLoading(true);
    const now = nowIST();
    const isApproved = action === 'approved';
    await base44.entities.GatePass.update(selected.id, {
      manager_approval_status: action,
      manager_user_id: user.id,
      manager_approval_date: now,
      manager_comment: comment,
      status: isApproved ? 'approved' : 'rejected',
    });
    setSelected(null);
    setComment('');
    await loadData();
    setActionLoading(false);
  };

  const filtered = passes.filter(p => filter === 'all' || p.status === filter);
  const pendingCount = passes.filter(p => p.status === 'pending_approval').length;

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Gate Pass Approvals</h1>
      <p className="text-gray-500 text-sm mb-5">
        {isHR ? 'Viewing all employee gate passes (HR view)' : 'Review and approve gate pass requests from your team'}
      </p>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b pb-2">
        <button
          onClick={() => setActiveTab('approvals')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'approvals' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Requests
          {pendingCount > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${activeTab === 'approvals' ? 'bg-white text-blue-600' : 'bg-yellow-100 text-yellow-700'}`}>
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <History className="w-4 h-4" /> Team History
        </button>
      </div>

      {activeTab === 'approvals' && (
        <>
          <div className="flex gap-2 mb-6 flex-wrap">
            {['pending_approval', 'approved', 'rejected', 'departed', 'returned', 'all'].map(f => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : STATUS_LABELS[f]}
              </Button>
            ))}
          </div>

          <div className="space-y-4">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-400">No gate pass requests found.</div>
            )}
            {filtered.map(pass => {
              const emp = employees[pass.employee_user_id];
              return (
                <Card key={pass.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setSelected(pass); setComment(''); }}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="font-semibold text-gray-900">{emp?.display_name || 'Unknown'}</span>
                          {emp && <span className="text-xs text-gray-400">· {emp.designation} · {emp.department}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {pass.outing_type && <Badge variant="outline" className="text-xs">{pass.outing_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</Badge>}
                          {pass.reason && <p className="text-gray-700 dark:text-gray-300">{pass.reason}</p>}
                        </div>
                        <p className="text-sm text-gray-400 mt-1">
                          Requested: {safeDate(pass.created_date, 'dd MMM yyyy, hh:mm a')}
                        </p>
                        {pass.expected_return_time && (
                          <p className="text-sm text-gray-500">
                            Expected return: {safeDate(pass.expected_return_time, 'dd MMM yyyy, hh:mm a')}
                          </p>
                        )}
                        {pass.departure_time && (
                          <p className="text-sm text-orange-600 mt-1 flex items-center gap-1">
                            <LogOut className="w-3 h-3" /> Out: {safeDate(pass.departure_time, 'hh:mm a')}
                          </p>
                        )}
                        {pass.return_time && (
                          <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
                            <LogIn className="w-3 h-3" /> In: {safeDate(pass.return_time, 'hh:mm a')}
                          </p>
                        )}
                      </div>
                      <Badge className={STATUS_COLORS[pass.status]}>{STATUS_LABELS[pass.status]}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'history' && user && (
        <GatePassHistory filterManagerId={user.id} showEmployeeName={true} />
      )}

      <Dialog open={!!selected} onOpenChange={() => { setSelected(null); setComment(''); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gate Pass Request</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <p><span className="font-medium">Employee:</span> {employees[selected.employee_user_id]?.display_name || 'Unknown'}</p>
                <p><span className="font-medium">Outing Type:</span> <Badge variant="outline">{selected.outing_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'N/A'}</Badge></p>
                <p><span className="font-medium">Reason:</span> {selected.reason || '—'}</p>
                <p><span className="font-medium">Requested:</span> {safeDate(selected.created_date, 'dd MMM yyyy, hh:mm a')}</p>
                {selected.expected_return_time && (
                  <p><span className="font-medium">Expected Return:</span> {safeDate(selected.expected_return_time, 'dd MMM yyyy, hh:mm a')}</p>
                )}
                <p><span className="font-medium">Status:</span> <Badge className={STATUS_COLORS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge></p>
              </div>

              {selected.status === 'pending_approval' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Comment (optional)</label>
                    <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment..." rows={2} />
                  </div>
                  <div className="flex gap-3">
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700"
                      onClick={() => handleAction('approved')}
                      disabled={actionLoading}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                    </Button>
                    <Button
                      className="flex-1"
                      variant="destructive"
                      onClick={() => handleAction('rejected')}
                      disabled={actionLoading}
                    >
                      <XCircle className="w-4 h-4 mr-2" /> Reject
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}