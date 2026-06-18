import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, BookOpen, Users, Calendar, Edit, Eye, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';

const categoryColors = {
  technical: 'bg-blue-100 text-blue-700',
  soft_skills: 'bg-purple-100 text-purple-700',
  compliance: 'bg-red-100 text-red-700',
  leadership: 'bg-yellow-100 text-yellow-700',
  safety: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

const statusColors = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-red-100 text-red-600',
};

export default function TrainingManagement() {
  const [user, setUser] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editProgram, setEditProgram] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', objective: '', trainer_name: '', trainer_type: 'internal', trainer_contact: '', mode: 'offline', category: 'other', department: '', status: 'draft' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [u, progs, sess, enr, depts] = await Promise.all([
      base44.auth.me(),
      base44.entities.TrainingProgram.list('-created_date', 100),
      base44.entities.TrainingSession.list('-created_date', 200),
      base44.entities.EmployeeTraining.list('-created_date', 500),
      base44.entities.Department.list(),
    ]);
    setUser(u);
    setPrograms(progs);
    setSessions(sess);
    setEnrollments(enr);
    setDepartments(depts);
    setLoading(false);
  };

  const openCreate = () => {
    setEditProgram(null);
    setForm({ title: '', description: '', objective: '', trainer_name: '', trainer_type: 'internal', trainer_contact: '', mode: 'offline', category: 'other', department: '', status: 'draft' });
    setShowForm(true);
  };

  const openEdit = (prog) => {
    setEditProgram(prog);
    setForm({ ...prog });
    setShowForm(true);
  };

  const saveProgram = async () => {
    setSaving(true);
    if (editProgram) {
      await base44.entities.TrainingProgram.update(editProgram.id, form);
    } else {
      await base44.entities.TrainingProgram.create({ ...form, created_by: user.id });
    }
    setShowForm(false);
    setSaving(false);
    loadData();
  };

  const archiveProgram = async (prog) => {
    await base44.entities.TrainingProgram.update(prog.id, { status: 'archived' });
    loadData();
  };

  const publishProgram = async (prog) => {
    await base44.entities.TrainingProgram.update(prog.id, { status: 'published' });
    loadData();
  };

  const filtered = programs.filter(p => {
    const matchSearch = p.title?.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCategory === 'all' || p.category === filterCategory;
    return matchSearch && matchCat;
  });

  const getSessionCount = (programId) => sessions.filter(s => s.training_program_id === programId).length;
  const getEnrollmentCount = (programId) => enrollments.filter(e => e.training_program_id === programId).length;

  const stats = {
    total: programs.length,
    published: programs.filter(p => p.status === 'published').length,
    totalSessions: sessions.length,
    totalEnrollments: enrollments.length,
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Management</h1>
          <p className="text-gray-500 text-sm mt-1">Create and manage employee training programs</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" /> New Program
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Programs', value: stats.total, color: 'text-blue-600' },
          { label: 'Published', value: stats.published, color: 'text-green-600' },
          { label: 'Total Sessions', value: stats.totalSessions, color: 'text-purple-600' },
          { label: 'Enrollments', value: stats.totalEnrollments, color: 'text-orange-600' },
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
          <Input placeholder="Search programs..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {['technical', 'soft_skills', 'compliance', 'leadership', 'safety', 'other'].map(c => (
              <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link to={createPageUrl('TrainingCalendar')}>
          <Button variant="outline"><Calendar className="w-4 h-4 mr-2" />Calendar View</Button>
        </Link>
        <Link to={createPageUrl('TrainingNeeds')}>
          <Button variant="outline"><BookOpen className="w-4 h-4 mr-2" />Training Needs</Button>
        </Link>
      </div>

      {/* Program Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(prog => (
          <Card key={prog.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base line-clamp-2">{prog.title}</CardTitle>
                <Badge className={`text-xs shrink-0 ${statusColors[prog.status]}`}>{prog.status}</Badge>
              </div>
              <div className="flex gap-2 flex-wrap mt-1">
                <Badge className={`text-xs ${categoryColors[prog.category]}`}>{prog.category?.replace('_', ' ')}</Badge>
                <Badge variant="outline" className="text-xs">{prog.mode}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-gray-500 line-clamp-2 mb-3">{prog.objective}</p>
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{getSessionCount(prog.id)} sessions</span>
                <span className="flex items-center gap-1"><Users className="w-3 h-3" />{getEnrollmentCount(prog.id)} enrolled</span>
              </div>
              <p className="text-xs text-gray-400 mb-3">Trainer: {prog.trainer_name || 'TBD'} ({prog.trainer_type})</p>
              <div className="flex gap-2 flex-wrap">
                <Link to={`${createPageUrl('TrainingDetail')}?id=${prog.id}`}>
                  <Button size="sm" variant="outline" className="text-xs"><Eye className="w-3 h-3 mr-1" />View</Button>
                </Link>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => openEdit(prog)}><Edit className="w-3 h-3 mr-1" />Edit</Button>
                {prog.status === 'draft' && (
                  <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => publishProgram(prog)}>Publish</Button>
                )}
                {prog.status !== 'archived' && (
                  <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-700" onClick={() => archiveProgram(prog)}><Archive className="w-3 h-3 mr-1" />Archive</Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-3 text-center text-gray-400 py-16">No training programs found.</div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProgram ? 'Edit Training Program' : 'New Training Program'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Title *</label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Training title" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Objective *</label>
              <textarea value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })} placeholder="What will participants learn?" rows={2} className="mt-1 w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Detailed description" rows={2} className="mt-1 w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['technical', 'soft_skills', 'compliance', 'leadership', 'safety', 'other'].map(c => (
                      <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Mode</label>
                <Select value={form.mode} onValueChange={v => setForm({ ...form, mode: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Trainer Name</label>
                <Input value={form.trainer_name} onChange={e => setForm({ ...form, trainer_name: e.target.value })} placeholder="Trainer's name" className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Trainer Type</label>
                <Select value={form.trainer_type} onValueChange={v => setForm({ ...form, trainer_type: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="external">External</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Department</label>
                <Select value={form.department} onValueChange={v => setForm({ ...form, department: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(dep => (
                      <SelectItem key={dep.id} value={dep.name}>{dep.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Trainer Contact</label>
                <Input value={form.trainer_contact} onChange={e => setForm({ ...form, trainer_contact: e.target.value })} placeholder="Email or phone" className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={saveProgram} disabled={saving || !form.title || !form.objective} className="bg-blue-600 hover:bg-blue-700">
                {saving ? 'Saving...' : editProgram ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}