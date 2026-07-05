import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Shield, AlertTriangle, CheckCircle, Edit, Upload, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const INSURANCE_TYPES = ['Group Health', 'Term Life', 'Personal Accident', 'Other'];

export default function InsuranceManagement() {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editEmployee, setEditEmployee] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [cardFile, setCardFile] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [emps, usrs] = await Promise.all([
      base44.entities.Employee.list(),
      base44.entities.User.list()
    ]);
    setEmployees(emps);
    setUsers(usrs);
    setLoading(false);
  };

  const getUserName = (userId) => users.find(u => u.id === userId)?.full_name || 'Unknown';

  const openEdit = (emp) => {
    setCardFile(null);
    setEditEmployee(emp);
    setForm({
      has_insurance: emp.insurance?.has_insurance ?? false,
      insurance_type: emp.insurance?.insurance_type || '',
      insurer_name: emp.insurance?.insurer_name || '',
      policy_number: emp.insurance?.policy_number || '',
      sum_insured: emp.insurance?.sum_insured || '',
      validity_date: emp.insurance?.validity_date || '',
      nominee_name: emp.insurance?.nominee_name || '',
      nominee_relationship: emp.insurance?.nominee_relationship || '',
      nominee_date_of_birth: emp.insurance?.nominee_date_of_birth || '',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    let updatedForm = { ...form, sum_insured: form.sum_insured ? Number(form.sum_insured) : undefined };
    if (cardFile) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: cardFile });
      updatedForm.card_url = file_url;
    }
    await base44.entities.Employee.update(editEmployee.id, { insurance: updatedForm });
    toast.success('Insurance updated successfully');
    await loadData();
    setEditEmployee(null);
    setCardFile(null);
    setSaving(false);
  };

  const isExpiringSoon = (date) => {
    if (!date) return false;
    const d = new Date(date);
    const diff = (d - new Date()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  };

  const isExpired = (date) => {
    if (!date) return false;
    return new Date(date) < new Date();
  };

  const filtered = employees.filter(emp => {
    const name = getUserName(emp.user_id).toLowerCase();
    const code = (emp.employee_code || '').toLowerCase();
    const matchSearch = name.includes(search.toLowerCase()) || code.includes(search.toLowerCase());
    const ins = emp.insurance;
    if (filter === 'insured') return matchSearch && ins?.has_insurance;
    if (filter === 'uninsured') return matchSearch && !ins?.has_insurance;
    if (filter === 'expiring') return matchSearch && ins?.has_insurance && isExpiringSoon(ins?.validity_date);
    if (filter === 'expired') return matchSearch && ins?.has_insurance && isExpired(ins?.validity_date);
    return matchSearch;
  });

  const stats = {
    total: employees.length,
    insured: employees.filter(e => e.insurance?.has_insurance).length,
    expiring: employees.filter(e => e.insurance?.has_insurance && isExpiringSoon(e.insurance?.validity_date)).length,
    expired: employees.filter(e => e.insurance?.has_insurance && isExpired(e.insurance?.validity_date)).length,
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Insurance Management</h1>
        <p className="text-gray-500 text-sm mt-1">Manage employee insurance records</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Employees', value: stats.total, color: 'bg-blue-50 text-blue-700', icon: Shield, filterVal: 'all' },
          { label: 'Insured', value: stats.insured, color: 'bg-green-50 text-green-700', icon: CheckCircle, filterVal: 'insured' },
          { label: 'Expiring (30d)', value: stats.expiring, color: 'bg-yellow-50 text-yellow-700', icon: AlertTriangle, filterVal: 'expiring' },
          { label: 'Expired', value: stats.expired, color: 'bg-red-50 text-red-700', icon: AlertTriangle, filterVal: 'expired' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow ${s.color} ${filter === s.filterVal ? 'ring-2 ring-offset-1 ring-current' : ''}`}
            onClick={() => setFilter(s.filterVal)}>
            <s.icon className="w-6 h-6" />
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search by name or employee code..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Employees</SelectItem>
            <SelectItem value="insured">Insured</SelectItem>
            <SelectItem value="uninsured">Uninsured</SelectItem>
            <SelectItem value="expiring">Expiring Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Insurer</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Policy No.</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Sum Insured</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Validity</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(emp => {
                const ins = emp.insurance || {};
                const expired = ins.has_insurance && isExpired(ins.validity_date);
                const expiring = ins.has_insurance && isExpiringSoon(ins.validity_date);
                return (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{getUserName(emp.user_id)}</p>
                      <p className="text-xs text-gray-400">{emp.employee_code}</p>
                    </td>
                    <td className="px-4 py-3">
                      {ins.has_insurance ? (
                        expired ? <Badge className="bg-red-100 text-red-700 border-0">Expired</Badge>
                          : expiring ? <Badge className="bg-yellow-100 text-yellow-700 border-0">Expiring</Badge>
                            : <Badge className="bg-green-100 text-green-700 border-0">Active</Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-500 border-0">Uninsured</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">{ins.insurer_name || '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">{ins.policy_number || '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                      {ins.sum_insured ? `₹${Number(ins.sum_insured).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-600">{ins.validity_date || '—'}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="outline" onClick={() => openEdit(emp)}>
                        <Edit className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No employees found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editEmployee} onOpenChange={() => setEditEmployee(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Insurance — {editEmployee && getUserName(editEmployee.user_id)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-3">
              <input type="checkbox" id="has_ins" checked={form.has_insurance || false} onChange={e => setForm(f => ({ ...f, has_insurance: e.target.checked }))} className="w-4 h-4" />
              <Label htmlFor="has_ins">Has Insurance</Label>
            </div>
            {form.has_insurance && (
              <>
                <div>
                  <Label>Insurance Type</Label>
                  <Select value={form.insurance_type} onValueChange={v => setForm(f => ({ ...f, insurance_type: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {INSURANCE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Insurer Name</Label>
                    <Input value={form.insurer_name} onChange={e => setForm(f => ({ ...f, insurer_name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Policy Number</Label>
                    <Input value={form.policy_number} onChange={e => setForm(f => ({ ...f, policy_number: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Sum Insured (₹)</Label>
                    <Input type="number" value={form.sum_insured} onChange={e => setForm(f => ({ ...f, sum_insured: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Validity Date</Label>
                    <Input type="date" value={form.validity_date} onChange={e => setForm(f => ({ ...f, validity_date: e.target.value }))} />
                  </div>
                </div>
                <p className="font-medium text-sm text-gray-700 pt-1">Nominee Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Nominee Name</Label>
                    <Input value={form.nominee_name} onChange={e => setForm(f => ({ ...f, nominee_name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Relationship</Label>
                    <Input value={form.nominee_relationship} onChange={e => setForm(f => ({ ...f, nominee_relationship: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Nominee DOB</Label>
                    <Input type="date" value={form.nominee_date_of_birth} onChange={e => setForm(f => ({ ...f, nominee_date_of_birth: e.target.value }))} />
                  </div>
                </div>
              </>
            )}
            {/* Card Upload */}
            <div className="border-t pt-3">
              <Label className="font-medium">Insurance Card / Policy Document</Label>
              <div className="flex items-center gap-3 mt-2">
                {form.card_url && !cardFile && (
                  <a href={form.card_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm flex items-center gap-1 hover:underline">
                    <ExternalLink className="w-3 h-3" /> View current
                  </a>
                )}
                <label className="cursor-pointer">
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => { if (e.target.files[0]) setCardFile(e.target.files[0]); }} />
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="w-3 h-3 mr-1" />{cardFile ? cardFile.name : (form.card_url ? 'Replace' : 'Upload')}</span>
                  </Button>
                </label>
                {cardFile && <span className="text-xs text-green-600">✓ {cardFile.name}</span>}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditEmployee(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}