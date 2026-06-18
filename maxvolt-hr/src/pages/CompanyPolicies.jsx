import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from 'sonner';
import { BookOpen, Plus, Trash2, Edit2, Upload, FileText, Loader2, Eye } from 'lucide-react';

const CATEGORY_LABELS = {
  leave: 'Leave',
  attendance: 'Attendance',
  travel: 'Travel',
  payroll: 'Payroll',
  conduct: 'Conduct',
  safety: 'Safety',
  other: 'Other',
};

const CATEGORY_COLORS = {
  leave: 'bg-green-100 text-green-700',
  attendance: 'bg-blue-100 text-blue-700',
  travel: 'bg-purple-100 text-purple-700',
  payroll: 'bg-yellow-100 text-yellow-700',
  conduct: 'bg-red-100 text-red-700',
  safety: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

const EMPTY_FORM = { title: '', category: 'other', description: '', file_url: '', is_active: true };

export default function CompanyPolicies() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewUrl, setViewUrl] = useState(null);

  useEffect(() => { loadPolicies(); }, []);

  const loadPolicies = async () => {
    try {
      const data = await base44.entities.CompanyPolicy.list('-created_date', 200);
      setPolicies(data);
    } catch (e) {
      toast.error('Failed to load policies');
    }
    setLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (policy) => {
    setEditing(policy);
    setFormData({
      title: policy.title || '',
      category: policy.category || 'other',
      description: policy.description || '',
      file_url: policy.file_url || '',
      is_active: policy.is_active !== false,
    });
    setShowForm(true);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, file_url }));
      toast.success('File uploaded');
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
    }
    setUploading(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const user = await base44.auth.me();
      const payload = { ...formData, uploaded_by: user.id };
      if (editing) {
        await base44.entities.CompanyPolicy.update(editing.id, payload);
        toast.success('Policy updated');
      } else {
        await base44.entities.CompanyPolicy.create(payload);
        toast.success('Policy added');
      }
      setShowForm(false);
      loadPolicies();
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    }
    setSaving(false);
  };

  const handleDelete = async (policy) => {
    if (!confirm(`Delete "${policy.title}"?`)) return;
    await base44.entities.CompanyPolicy.delete(policy.id);
    toast.success('Policy deleted');
    loadPolicies();
  };

  const toggleActive = async (policy) => {
    await base44.entities.CompanyPolicy.update(policy.id, { is_active: !policy.is_active });
    loadPolicies();
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  const active = policies.filter(p => p.is_active !== false);
  const inactive = policies.filter(p => p.is_active === false);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-blue-600" /> Company Policies
            </h1>
            <p className="text-sm text-gray-500 mt-1">Manage policy documents used by AskMax AI assistant</p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" /> Add Policy
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total', value: policies.length, color: 'text-gray-700' },
            { label: 'Active (used by AI)', value: active.length, color: 'text-green-600' },
            { label: 'Inactive', value: inactive.length, color: 'text-gray-400' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Policies list */}
        <Card>
          <CardHeader><CardTitle className="text-base">All Policies</CardTitle></CardHeader>
          <CardContent className="p-0">
            {policies.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No policies added yet. Click "Add Policy" to get started.</p>
              </div>
            ) : (
              <div className="divide-y">
                {policies.map(policy => (
                  <div key={policy.id} className="p-4 flex items-start gap-4 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{policy.title}</span>
                        <Badge className={CATEGORY_COLORS[policy.category] || CATEGORY_COLORS.other}>
                          {CATEGORY_LABELS[policy.category] || policy.category}
                        </Badge>
                        {policy.is_active !== false ? (
                          <Badge className="bg-green-100 text-green-700">Active</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-500">Inactive</Badge>
                        )}
                      </div>
                      {policy.description && <p className="text-sm text-gray-500 truncate">{policy.description}</p>}
                      {policy.file_url && (
                        <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Document attached
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {policy.file_url && (
                        <Button size="sm" variant="outline" onClick={() => setViewUrl(policy.file_url)}>
                          <Eye className="w-3 h-3" />
                        </Button>
                      )}
                      <Switch checked={policy.is_active !== false} onCheckedChange={() => toggleActive(policy)} />
                      <Button size="sm" variant="outline" onClick={() => openEdit(policy)}>
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(policy)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={o => { setShowForm(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Policy' : 'Add Policy'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="e.g., Leave Policy 2024" required />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Brief summary of what this policy covers..." />
            </div>
            <div>
              <Label>Policy Document (PDF)</Label>
              <div className="flex items-center gap-3 mt-1">
                <label className="flex items-center gap-2 cursor-pointer border rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex-1">
                  <Upload className="w-4 h-4 text-gray-400" />
                  {uploading ? 'Uploading...' : formData.file_url ? 'Replace file' : 'Upload PDF'}
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleFileUpload} disabled={uploading} />
                </label>
                {formData.file_url && !uploading && (
                  <span className="text-xs text-green-600 flex items-center gap-1"><FileText className="w-3 h-3" /> Uploaded</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={formData.is_active} onCheckedChange={v => setFormData({ ...formData, is_active: v })} />
              <Label>Active (used by AskMax AI)</Label>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || uploading} className="bg-blue-600 hover:bg-blue-700">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Policy'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Doc Viewer */}
      <Dialog open={!!viewUrl} onOpenChange={() => setViewUrl(null)}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle>Policy Document</DialogTitle></DialogHeader>
          <iframe src={viewUrl} className="flex-1 rounded border" title="Policy Document" />
        </DialogContent>
      </Dialog>
    </div>
  );
}