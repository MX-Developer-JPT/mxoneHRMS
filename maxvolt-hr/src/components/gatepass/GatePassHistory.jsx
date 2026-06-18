import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { LogOut, LogIn, Clock, History, Search, Filter } from 'lucide-react';

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

/**
 * GatePassHistory – shared component for all roles.
 * Props:
 *   filterUserId: string  – if set, only show passes for this user (employee view)
 *   filterManagerId: string – if set, filter to employees under this manager
 *   showEmployeeName: boolean – whether to show employee name column
 */
export default function GatePassHistory({ filterUserId, filterManagerId, showEmployeeName = true }) {
  const [passes, setPasses] = useState([]);
  const [users, setUsers] = useState({});
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [allPasses, allUsers, allEmployees] = await Promise.all([
      base44.entities.GatePass.list('-created_date', 500),
      base44.entities.User.list(),
      base44.entities.Employee.list(),
    ]);

    const userMap = {};
    allUsers.forEach(u => { userMap[u.id] = u; });
    const empMap = {};
    allEmployees.forEach(e => { empMap[e.user_id] = e; });

    let filtered = allPasses;

    if (filterUserId) {
      filtered = allPasses.filter(p => p.employee_user_id === filterUserId);
    } else if (filterManagerId) {
      const myEmpIds = allEmployees
        .filter(e => e.reporting_manager_id === filterManagerId)
        .map(e => e.user_id);
      filtered = allPasses.filter(p => myEmpIds.includes(p.employee_user_id));
    }

    setUsers(userMap);
    setEmployees(empMap);
    setPasses(filtered);
    setLoading(false);
  };

  const filteredPasses = passes.filter(p => {
    const u = users[p.employee_user_id];
    const matchSearch = !search || u?.full_name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    const passDate = p.request_date || p.created_date?.slice(0, 10);
    const matchFrom = !dateFrom || passDate >= dateFrom;
    const matchTo = !dateTo || passDate <= dateTo;
    return matchSearch && matchStatus && matchFrom && matchTo;
  });

  if (loading) return <div className="py-8 text-center text-gray-400">Loading history...</div>;

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
        {showEmployeeName && (
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-auto" placeholder="From date" />
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-auto" placeholder="To date" />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {['all', 'pending_approval', 'approved', 'departed', 'returned', 'rejected'].map(s => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      {/* List */}
      {filteredPasses.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No gate pass records found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPasses.map(pass => {
            const u = users[pass.employee_user_id];
            const emp = employees[pass.employee_user_id];
            return (
              <Card
                key={pass.id}
                className="hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => setSelected(pass)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {showEmployeeName && (
                        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700 text-sm shrink-0">
                          {u?.full_name?.charAt(0) || '?'}
                        </div>
                      )}
                      <div className="min-w-0">
                        {showEmployeeName && (
                          <p className="font-semibold text-gray-900 text-sm">{u?.full_name || 'Unknown'}</p>
                        )}
                        <p className="text-xs text-gray-500 truncate">{pass.reason}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {format(new Date(pass.created_date), 'dd MMM yyyy, hh:mm a')}
                          {emp && showEmployeeName && ` · ${emp.department}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap shrink-0">
                      <div className="text-xs space-y-0.5 text-right">
                        {pass.departure_time && (
                          <p className="text-orange-600 flex items-center gap-1 justify-end">
                            <LogOut className="w-3 h-3" /> Out: {format(new Date(pass.departure_time), 'hh:mm a')}
                          </p>
                        )}
                        {pass.return_time && (
                          <p className="text-green-600 flex items-center gap-1 justify-end">
                            <LogIn className="w-3 h-3" /> In: {format(new Date(pass.return_time), 'hh:mm a')}
                          </p>
                        )}
                        {pass.departure_time && pass.return_time && (
                          <p className="text-gray-400 flex items-center gap-1 justify-end">
                            <Clock className="w-3 h-3" />
                            {Math.round((new Date(pass.return_time) - new Date(pass.departure_time)) / 60000)} min
                          </p>
                        )}
                      </div>
                      <Badge className={STATUS_COLORS[pass.status]}>{STATUS_LABELS[pass.status]}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gate Pass Details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                {showEmployeeName && <p><span className="font-medium">Employee:</span> {users[selected.employee_user_id]?.full_name}</p>}
                {employees[selected.employee_user_id]?.department && (
                  <p><span className="font-medium">Department:</span> {employees[selected.employee_user_id].department}</p>
                )}
                <p><span className="font-medium">Reason:</span> {selected.reason}</p>
                <p><span className="font-medium">Requested On:</span> {format(new Date(selected.created_date), 'dd MMM yyyy, hh:mm a')}</p>
                {selected.expected_return_time && (
                  <p><span className="font-medium">Expected Return:</span> {format(new Date(selected.expected_return_time), 'dd MMM yyyy, hh:mm a')}</p>
                )}
                <p><span className="font-medium">Status:</span> <Badge className={STATUS_COLORS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge></p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-gray-700">Manager Action</p>
                <p><span className="font-medium">Decision:</span> <span className="capitalize">{selected.manager_approval_status || 'pending'}</span></p>
                {selected.manager_approval_date && (
                  <p><span className="font-medium">At:</span> {format(new Date(selected.manager_approval_date), 'dd MMM yyyy, hh:mm a')}</p>
                )}
                {selected.manager_comment && (
                  <p><span className="font-medium">Comment:</span> {selected.manager_comment}</p>
                )}
              </div>

              {(selected.departure_time || selected.return_time) && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <p className="font-semibold text-gray-700">Gate Record</p>
                  {selected.departure_time && (
                    <p className="text-orange-700 flex items-center gap-1">
                      <LogOut className="w-3.5 h-3.5" />
                      <span className="font-medium">Departed:</span> {format(new Date(selected.departure_time), 'dd MMM yyyy, hh:mm a')}
                    </p>
                  )}
                  {selected.return_time && (
                    <p className="text-green-700 flex items-center gap-1">
                      <LogIn className="w-3.5 h-3.5" />
                      <span className="font-medium">Returned:</span> {format(new Date(selected.return_time), 'dd MMM yyyy, hh:mm a')}
                    </p>
                  )}
                  {selected.departure_time && selected.return_time && (
                    <p className="text-gray-600 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-medium">Total Duration:</span>{' '}
                      {Math.round((new Date(selected.return_time) - new Date(selected.departure_time)) / 60000)} minutes
                    </p>
                  )}
                  {selected.gate_admin_notes && (
                    <p><span className="font-medium">Gate Notes:</span> {selected.gate_admin_notes}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}