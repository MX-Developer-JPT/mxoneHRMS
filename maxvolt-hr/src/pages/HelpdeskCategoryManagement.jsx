import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Settings } from 'lucide-react';
import { toast } from 'sonner';

const emptyForm = { name: '', code: '', default_department_name: '', is_active: true };

export default function HelpdeskCategoryManagement() {
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const [cats, depts] = await Promise.all([
      base44.entities.HelpdeskCategory.list(),
      base44.entities.Department.list()
    ]);
    setCategories(cats);
    setDepartments(depts);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingCategory(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (cat) => {
    setEditingCategory(cat);
    setForm({ name: cat.name, code: cat.code, default_department_name: cat.default_department_name || '', is_active: cat.is_active !== false });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error('Name and code are required'); return; }
    setSaving(true);
    const data = { ...form, code: form.code.toLowerCase().replace(/\s+/g, '_') };
    if (editingCategory) {
      await base44.entities.HelpdeskCategory.update(editingCategory.id, data);
      toast.success('Category updated');
    } else {
      await base44.entities.HelpdeskCategory.create(data);
      toast.success('Category created');
    }
    setSaving(false);
    setDialogOpen(false);
    loadData();
  };

  const handleDelete = async (cat) => {
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    await base44.entities.HelpdeskCategory.delete(cat.id);
    toast.success('Category deleted');
    loadData();
  };

  const toggleActive = async (cat) => {
    await base44.entities.HelpdeskCategory.update(cat.id, { is_active: !cat.is_active });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><Settings className="w-8 h-8 text-blue-600" />Helpdesk Categories</h1>
            <p className="text-gray-600 mt-1">Define ticket categories and their default department routing</p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />New Category
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Categories ({categories.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No categories defined yet. Create one to get started.</p>
            ) : (
              <div className="space-y-3">
                {categories.map(cat => (
                  <div key={cat.id} className="border rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 bg-white">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{cat.name}</p>
                          <Badge variant="outline" className="text-xs font-mono">{cat.code}</Badge>
                          {cat.is_active === false && <Badge className="bg-gray-100 text-gray-500 text-xs">Inactive</Badge>}
                        </div>
                        {cat.default_department_name ? (
                          <p className="text-sm text-gray-500 mt-0.5">
                            Default routing → <strong>{cat.default_department_name}</strong>
                          </p>
                        ) : (
                          <p className="text-sm text-gray-400 mt-0.5">No default department set</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(cat)} className="text-xs">
                        {cat.is_active === false ? 'Enable' : 'Disable'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(cat)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(cat)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCategory ? 'Edit Category' : 'New Category'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Category Name *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. IT Support" />
              </div>
              <div>
                <Label>Code * <span className="text-gray-400 font-normal text-xs">(auto-formatted, used internally)</span></Label>
                <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. it_support" />
              </div>
              <div>
                <Label>Default Department Routing</Label>
                <Select value={form.default_department_name} onValueChange={v => setForm({ ...form, default_department_name: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>None</SelectItem>
                    {departments.map(d => (
                      <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">Tickets of this category will be auto-routed to this department</p>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}