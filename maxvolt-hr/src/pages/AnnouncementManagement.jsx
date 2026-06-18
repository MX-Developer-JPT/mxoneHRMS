import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Plus, Megaphone, Trash2, Eye, Edit, Archive, Paperclip, X, FileText, Image, Upload } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';

const categoryConfig = {
  general: { color: 'bg-blue-100 text-blue-800', label: 'General' },
  policy: { color: 'bg-purple-100 text-purple-800', label: 'Policy' },
  event: { color: 'bg-green-100 text-green-800', label: 'Event' },
  holiday: { color: 'bg-orange-100 text-orange-800', label: 'Holiday' },
  urgent: { color: 'bg-red-100 text-red-800', label: 'Urgent' }
};

const statusColors = {
  draft: 'bg-gray-100 text-gray-800',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-yellow-100 text-yellow-800'
};

const emptyForm = {
  title: '',
  content: '',
  category: 'general',
  target_audience: 'all',
  target_departments: [],
  status: 'draft',
  attachment_url: ''
};

export default function AnnouncementManagement() {
  const [announcements, setAnnouncements] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [filterStatus, setFilterStatus] = useState('all');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [viewerDoc, setViewerDoc] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [announcementData, deptData] = await Promise.all([
        base44.entities.Announcement.list('-created_date'),
        base44.entities.Department.list()
      ]);
      setAnnouncements(announcementData);
      setDepartments(deptData);
    } catch (error) {
      console.error('Error loading announcements:', error);
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const user = await base44.auth.me();
      const data = {
        ...formData,
        published_by: user.id,
        publish_date: formData.status === 'published' ? new Date().toISOString() : null
      };

      if (editingAnnouncement) {
        await base44.entities.Announcement.update(editingAnnouncement.id, data);
        toast.success('Announcement updated');
      } else {
        await base44.entities.Announcement.create(data);
        toast.success('Announcement created');
      }

      setShowForm(false);
      setEditingAnnouncement(null);
      setFormData(emptyForm);
      loadData();
    } catch (error) {
      toast.error('Failed to save announcement');
    }
  };

  const handlePublish = async (id) => {
    await base44.entities.Announcement.update(id, { status: 'published', publish_date: new Date().toISOString() });
    toast.success('Announcement published');
    loadData();
  };

  const handleArchive = async (id) => {
    await base44.entities.Announcement.update(id, { status: 'archived' });
    toast.success('Announcement archived');
    loadData();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this announcement permanently?')) return;
    await base44.entities.Announcement.delete(id);
    toast.success('Announcement deleted');
    loadData();
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, attachment_url: file_url }));
      setUploadedFileName(file.name);
      toast.success('File uploaded successfully');
    } catch (err) {
      toast.error('Failed to upload file');
    }
    setUploadingFile(false);
  };

  const handleRemoveAttachment = () => {
    setFormData(prev => ({ ...prev, attachment_url: '' }));
    setUploadedFileName('');
  };

  const handleEdit = (ann) => {
    setEditingAnnouncement(ann);
    setUploadedFileName(ann.attachment_url ? 'Existing attachment' : '');
    setFormData({
      title: ann.title,
      content: ann.content,
      category: ann.category,
      target_audience: ann.target_audience || 'all',
      target_departments: ann.target_departments || [],
      status: ann.status,
      attachment_url: ann.attachment_url || ''
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAnnouncement(null);
    setFormData(emptyForm);
    setUploadedFileName('');
  };

  if (loading && announcements.length === 0) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  const filtered = filterStatus === 'all' ? announcements : announcements.filter(a => a.status === filterStatus);
  const stats = { published: announcements.filter(a => a.status === 'published').length, draft: announcements.filter(a => a.status === 'draft').length, archived: announcements.filter(a => a.status === 'archived').length };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Announcement Management</h1>
            <p className="text-gray-600 mt-1">Create and manage company-wide communications</p>
          </div>
          <Dialog open={showForm} onOpenChange={open => { if (!open) closeForm(); else setShowForm(true); }}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto">
                <Plus className="w-5 h-5 mr-2" /> New Announcement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Title *</Label>
                  <Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Announcement title" required />
                </div>

                <div>
                  <Label>Content *</Label>
                  <Textarea value={formData.content} onChange={e => setFormData({ ...formData, content: e.target.value })} placeholder="Write your announcement here..." rows={6} required />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Category *</Label>
                    <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="policy">Policy</SelectItem>
                        <SelectItem value="event">Event</SelectItem>
                        <SelectItem value="holiday">Holiday</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Target Audience *</Label>
                    <Select value={formData.target_audience} onValueChange={v => setFormData({ ...formData, target_audience: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Employees</SelectItem>
                        <SelectItem value="specific_departments">Specific Departments</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {formData.target_audience === 'specific_departments' && (
                  <div>
                    <Label>Select Departments</Label>
                    <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto bg-gray-50">
                      {departments.map(dept => (
                        <label key={dept.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded">
                          <input type="checkbox" className="rounded"
                            checked={formData.target_departments.includes(dept.code || dept.name)}
                            onChange={e => {
                              const key = dept.code || dept.name;
                              setFormData(prev => ({
                                ...prev,
                                target_departments: e.target.checked
                                  ? [...prev.target_departments, key]
                                  : prev.target_departments.filter(d => d !== key)
                              }));
                            }}
                          />
                          <span className="text-sm">{dept.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-sm font-medium">Attachment <span className="text-gray-400 font-normal">(optional)</span></Label>
                  {formData.attachment_url ? (
                    <div className="mt-1 flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        {/\.(jpg|jpeg|png|gif|webp)$/i.test(formData.attachment_url)
                          ? <Image className="w-5 h-5 text-blue-600" />
                          : <FileText className="w-5 h-5 text-blue-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-800 truncate">{uploadedFileName || 'Attachment'}</p>
                        <button type="button" onClick={() => setViewerDoc({ url: formData.attachment_url, title: uploadedFileName || 'Attachment' })} className="text-xs text-blue-500 hover:underline text-left">Preview file</button>
                      </div>
                      <button type="button" onClick={handleRemoveAttachment} className="p-1 hover:bg-blue-100 rounded-full transition-colors">
                        <X className="w-4 h-4 text-blue-600" />
                      </button>
                    </div>
                  ) : (
                    <label className="mt-1 flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 hover:border-blue-400 transition-all">
                      {uploadingFile ? (
                        <div className="flex items-center gap-2 text-blue-600">
                          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-sm">Uploading...</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Upload className="w-6 h-6 text-gray-400" />
                          <span className="text-sm text-gray-500">Click to upload file</span>
                          <span className="text-xs text-gray-400">PDF, images, documents</span>
                        </div>
                      )}
                      <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploadingFile} />
                    </label>
                  )}
                </div>

                <div>
                  <Label>Status *</Label>
                  <Select value={formData.status} onValueChange={v => setFormData({ ...formData, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Save as Draft</SelectItem>
                      <SelectItem value="published">Publish Now</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-3 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700">{editingAnnouncement ? 'Update' : 'Create'}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Published', count: stats.published, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Drafts', count: stats.draft, color: 'text-gray-600', bg: 'bg-gray-50' },
            { label: 'Archived', count: stats.archived, color: 'text-yellow-600', bg: 'bg-yellow-50' }
          ].map(s => (
            <Card key={s.label} className={`${s.bg} border-0`}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-sm text-gray-600">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {['all', 'published', 'draft', 'archived'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border'}`}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="space-y-3">
          {filtered.map(ann => (
            <Card key={ann.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <CardTitle className="text-base">{ann.title}</CardTitle>
                      <Badge className={`${(categoryConfig[ann.category] || categoryConfig.general).color} text-xs`}>
                        {ann.category.toUpperCase()}
                      </Badge>
                      <Badge className={`${statusColors[ann.status]} text-xs`}>
                        {ann.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500">
                      {ann.publish_date ? `Published ${format(new Date(ann.publish_date), 'MMM d, yyyy')}` : `Created ${format(new Date(ann.created_date), 'MMM d, yyyy')}`}
                      {' · '}
                      {ann.target_audience === 'all' ? 'All employees' : `Depts: ${ann.target_departments?.join(', ') || 'None selected'}`}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {ann.status === 'draft' && (
                      <Button size="sm" onClick={() => handlePublish(ann.id)} className="bg-green-600 hover:bg-green-700 text-xs h-7">
                        <Eye className="w-3 h-3 mr-1" /> Publish
                      </Button>
                    )}
                    {ann.status === 'published' && (
                      <Button size="sm" variant="outline" onClick={() => handleArchive(ann.id)} className="text-xs h-7">
                        <Archive className="w-3 h-3 mr-1" /> Archive
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleEdit(ann)} className="text-xs h-7">
                      <Edit className="w-3 h-3 mr-1" /> Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(ann.id)} className="text-xs h-7">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-700 text-sm line-clamp-2">{ann.content}</p>
                {ann.attachment_url && (
                  <button
                    onClick={() => setViewerDoc({ url: ann.attachment_url, title: ann.title })}
                    className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-md text-xs hover:bg-blue-100 transition-colors border border-blue-200">
                    <Paperclip className="w-3 h-3" /> View Attachment
                  </button>
                )}
              </CardContent>
            </Card>
          ))}

          {filtered.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <Megaphone className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No announcements {filterStatus !== 'all' ? `with status "${filterStatus}"` : ''}</p>
              </CardContent>
            </Card>
          )}
        </div>
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