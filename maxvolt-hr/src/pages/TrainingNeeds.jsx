import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ArrowLeft, Search, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

const priorityColor = { low: 'bg-gray-100 text-gray-600', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-red-100 text-red-700' };
const statusColor = { open: 'bg-blue-100 text-blue-700', in_review: 'bg-yellow-100 text-yellow-700', addressed: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-500' };

export default function TrainingNeeds() {
  const [user, setUser] = useState(null);
  const [needs, setNeeds] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editNeed, setEditNeed] = useState(null);
  const [form, setForm] = useState({ employee_id: '', department: '', skill_gap: '', description: '', priority: 'medium', source: 'other', status: 'open', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [u, ns, users, progs] = await Promise.all([
      base44.auth.me(),
      base44.entities.TrainingNeed.list('-created_date', 200),
      base44.entities.User.list(),
      base44.entities.TrainingProgram.list('-created_date', 100),
    ]);
    setUser(u);
    setNeeds(ns);
    setAllUsers(users);
    setPrograms(progs);
    setLoading(false);
  };

  const getUserName = (id) => {
    const u = allUsers.find(u => u.id === id);
    return u ? (u.display_name || u.full_name) : id;
  };

  const openCreate = () => {
    setEditNeed(null);
    setForm({ employee_id: '', department: '', skill_gap: '', description: '', priority: 'medium', source: 'other', status: 'open', notes: '' });
    setShowForm(true);
  };

  const openEdit = (need) => {
    setEditNeed(need);
    setForm({ ...need });
    setShowForm(true);
  };

  const saveNeed = async () => {
    setSaving(true);
    if (editNeed) {
      await base44.entities.TrainingNeed.update(editNeed.id, form);
    } else {
      await base44.entities.TrainingNeed.create({ ...form, requested_by: user.id });
    }
    setShowForm(false);
    setSaving(false);
    loadData();
  };

  const updateStatus = async (need, status) => {
    await base44.entities.TrainingNeed.update(need.id, { status });
    loadData();
  };

  const filtered = needs.filter(n => {
    const matchSearch = n.description?.toLowerCase().includes(search.toLowerCase()) || n.skill_gap?.toLowerCase().includes(search.toLowerCase()) || n.department?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || n.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const isHR = user?.role === 'hr' || user?.role === 'admin';
  const isManagement = user?.custom_role === 'management' || user?.role === 'management';

  const stats = {
    open: needs.filter(n => n.status === 'open').length,
    in_review: needs.filter(n => n.status === 'in_review').length,
    addressed: needs.filter(n => n.status === 'addressed').length,
    high_priority: needs.filter(n => n.priority === 'high').length,
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={createPageUrl('TrainingManagement')}>
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Training Needs</h1>
          <p className="text-sm text-gray-500">Identify and track skill gaps and training requirements</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2" />Add Need</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Open', value: stats.open, color: 'text-blue-600' },
          { label: 'In Review', value: stats.in_review, color: 'text-yellow-600' },
          { label: 'Addressed', value: stats.addressed, color: 'text-green-600' },
          { label: 'High Priority', value: stats.high_priority, color: 'text-red-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-sm text-gray-500 mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input placeholder="Search needs..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="addressed">Addressed</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Needs List */}
      <div className="space-y-3">
        {filtered.map(need => (
          <Card key={need.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className={`text-xs ${priorityColor[need.priority]}`}>{need.priority} priority</Badge>
                    <Badge className={`text-xs ${statusColor[need.status]}`}>{need.status?.replace('_', ' ')}</Badge>
                    <Badge variant="outline" className="text-xs">{need.source?.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{need.description}</p>
                  <div className="flex gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                    {need.skill_gap && <span>Skill Gap: <strong>{need.skill_gap}</strong></span>}
                    {need.department && <span>Dept: <strong>{need.department}</strong></span>}
                    {need.employee_id && <span>Employee: <strong>{getUserName(need.employee_id)}</strong></span>}
                    <span>By: {getUserName(need.requested_by)}</span>
                    <span>{safeDate(need.created_date, 'MMM d, yyyy')}</span>
                  </div>
                  {need.notes && <p className="text-xs text-gray-400 mt-1 italic">{need.notes}</p>}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => openEdit(need)}>Edit</Button>
                  {(isHR || isManagement) && need.status === 'open' && (
                    <Button size="sm" variant="outline" className="text-xs text-yellow-600 border-yellow-300" onClick={() => updateStatus(need, 'in_review')}>Review</Button>
                  )}
                  {(isHR || isManagement) && need.status === 'in_review' && (
                    <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateStatus(need, 'addressed')}>Address</Button>
                  )}
                  {need.status !== 'closed' && (
                    <Button size="sm" variant="ghost" className="text-xs text-gray-400" onClick={() => updateStatus(need, 'closed')}>Close</Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-16">No training needs found. Add one to get started.</div>
        )}
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editNeed ? 'Edit Training Need' : 'New Training Need'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-medium">Description *</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the training need..." rows={3} className="mt-1 w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Skill Gap</label>
                <Input value={form.skill_gap} onChange={e => setForm({ ...form, skill_gap: e.target.value })} placeholder="e.g. Python, Leadership" className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Department</label>
                <Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Employee (if specific)</label>
              <Select value={form.employee_id || ''} onValueChange={v => setForm({ ...form, employee_id: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Not specific</SelectItem>
                  {allUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.display_name || u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Priority</label>
                <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Source</label>
                <Select value={form.source} onValueChange={v => setForm({ ...form, source: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="performance_review">Performance Review</SelectItem>
                    <SelectItem value="skill_gap">Skill Gap</SelectItem>
                    <SelectItem value="department_need">Department Need</SelectItem>
                    <SelectItem value="self_request">Self Request</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editNeed && (
              <div>
                <label className="text-sm font-medium">Status</label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_review">In Review</SelectItem>
                    <SelectItem value="addressed">Addressed</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes" className="mt-1" />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={saveNeed} disabled={saving || !form.description} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Saving...' : editNeed ? 'Update' : 'Create'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}