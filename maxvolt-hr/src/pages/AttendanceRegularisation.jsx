import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import MobileSelect from '@/components/MobileSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, FileText, AlertCircle, CheckCircle2, XCircle, RotateCcw, Upload, Edit, Calendar } from 'lucide-react';
import MultiDateCalendarPicker from '@/components/attendance/MultiDateCalendarPicker';
import { toast } from 'sonner';
import { format } from 'date-fns';

const REASON_OPTIONS = [
  { value: 'missed_punch', label: 'Missed Punch' },
  { value: 'biometric_failure', label: 'Biometric Failure' },
  { value: 'official_duty', label: 'Official Duty' },
  { value: 'work_from_home', label: 'Work from Home' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'other', label: 'Other' }
];

const statusConfig = {
  pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, label: 'Pending' },
  manager_approved: { color: 'bg-blue-100 text-blue-800', icon: CheckCircle2, label: 'Manager Approved' },
  hr_approved: { color: 'bg-indigo-100 text-indigo-800', icon: CheckCircle2, label: 'HR Approved' },
  completed: { color: 'bg-green-100 text-green-800', icon: CheckCircle2, label: 'Completed' },
  rejected: { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Rejected' },
  sent_back: { color: 'bg-orange-100 text-orange-800', icon: RotateCcw, label: 'Sent Back' }
};

const emptyForm = {
  attendance_date: '',
  requested_check_in: '',
  requested_check_out: '',
  reason_category: '',
  reason: '',
  document_url: ''
};

export default function AttendanceRegularisation() {
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [existingAttendance, setExistingAttendance] = useState(null);
  const [fetchingAttendance, setFetchingAttendance] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkDates, setBulkDates] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const reqs = await base44.entities.AttendanceRegularisation.filter({ user_id: currentUser.id }, '-created_date', 200);
      setRequests(reqs);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const fetchAttendanceForDate = async (date) => {
    if (!date || !user) return;
    setFetchingAttendance(true);
    try {
      const records = await base44.entities.Attendance.filter({ user_id: user.id, date });
      setExistingAttendance(records[0] || null);
      if (records[0]) {
        setFormData(prev => ({
          ...prev,
          requested_check_in: records[0].check_in_time ? format(new Date(records[0].check_in_time), 'HH:mm') : '',
          requested_check_out: records[0].check_out_time ? format(new Date(records[0].check_out_time), 'HH:mm') : ''
        }));
      }
    } catch (e) { console.error(e); }
    setFetchingAttendance(false);
  };

  const handleDateChange = (date) => {
    setFormData(prev => ({ ...prev, attendance_date: date }));
    fetchAttendanceForDate(date);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, document_url: file_url }));
      toast.success('Document uploaded');
    } catch (err) { toast.error('Upload failed'); }
    setUploading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.reason_category || !formData.reason.trim()) {
      toast.error('Reason is mandatory');
      return;
    }
    setSaving(true);
    try {
      // Get employee info for manager routing
      const empRecords = await base44.entities.Employee.filter({ user_id: user.id });
      const emp = empRecords[0];

      const datesToProcess = bulkMode
        ? bulkDates
        : [formData.attendance_date];

      if (!datesToProcess.length || (!bulkMode && !formData.attendance_date)) {
        toast.error('Please select a date');
        setSaving(false);
        return;
      }

      // Check for duplicates
      for (const date of datesToProcess) {
        const existing = requests.find(r => r.attendance_date?.split('T')[0] === date && r.status !== 'rejected');
        if (existing) {
          toast.error(`A request already exists for ${date}`);
          setSaving(false);
          return;
        }
      }

      const attRecords = await base44.entities.Attendance.filter({ user_id: user.id });

      for (const date of datesToProcess) {
        const attForDate = attRecords.find(a => a.date?.split('T')[0] === date || a.date === date);
        const payload = {
          user_id: user.id,
          attendance_date: date,
          existing_status: attForDate?.status || 'absent',
          existing_check_in: attForDate?.check_in_time || null,
          existing_check_out: attForDate?.check_out_time || null,
          requested_check_in: formData.requested_check_in,
          requested_check_out: formData.requested_check_out,
          reason_category: formData.reason_category,
          reason: formData.reason,
          document_url: formData.document_url || null,
          manager_id: emp?.reporting_manager_id || null,
          status: 'pending',
          audit_log: [{
            actor_id: user.id,
            actor_name: user.full_name,
            action: 'created',
            comment: formData.reason,
            timestamp: new Date().toISOString(),
            before: { status: attForDate?.status, check_in: attForDate?.check_in_time, check_out: attForDate?.check_out_time },
            after: { requested_check_in: formData.requested_check_in, requested_check_out: formData.requested_check_out }
          }]
        };

        if (editingRequest) {
          await base44.entities.AttendanceRegularisation.update(editingRequest.id, payload);
        } else {
          await base44.entities.AttendanceRegularisation.create(payload);
        }
      }

      toast.success(editingRequest ? 'Request updated' : `${datesToProcess.length} request(s) submitted`);
      setShowForm(false);
      setEditingRequest(null);
      setFormData(emptyForm);
      setBulkDates([]);
      setBulkMode(false);
      setExistingAttendance(null);
      loadData();
    } catch (err) {
      toast.error('Failed to submit: ' + err.message);
    }
    setSaving(false);
  };

  const handleEdit = (req) => {
    setEditingRequest(req);
    setFormData({
      attendance_date: req.attendance_date?.split('T')[0] || '',
      requested_check_in: req.requested_check_in || '',
      requested_check_out: req.requested_check_out || '',
      reason_category: req.reason_category || '',
      reason: req.reason || '',
      document_url: req.document_url || ''
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingRequest(null);
    setFormData(emptyForm);
    setBulkDates([]);
    setBulkMode(false);
    setExistingAttendance(null);
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  const stats = {
    pending: requests.filter(r => r.status === 'pending' || r.status === 'sent_back').length,
    approved: requests.filter(r => r.status === 'completed').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    inProgress: requests.filter(r => r.status === 'manager_approved').length
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Attendance Regularisation</h1>
            <p className="text-gray-600 mt-1">Raise requests to correct missing or incorrect attendance</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Request
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending', count: stats.pending, color: 'text-yellow-600', bg: 'bg-yellow-50' },
            { label: 'In Progress', count: stats.inProgress, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Completed', count: stats.approved, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Rejected', count: stats.rejected, color: 'text-red-600', bg: 'bg-red-50' }
          ].map(s => (
            <Card key={s.label} className={`${s.bg} border-0`}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-sm text-gray-600">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Requests List */}
        <Card>
          <CardHeader><CardTitle>My Requests</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {requests.map(req => {
                const cfg = statusConfig[req.status] || statusConfig.pending;
                const StatusIcon = cfg.icon;
                return (
                  <div key={req.id} className="border rounded-xl p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Calendar className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-semibold">{format(new Date(req.attendance_date), 'EEE, MMM d, yyyy')}</p>
                          <p className="text-sm text-gray-500 capitalize">{REASON_OPTIONS.find(r => r.value === req.reason_category)?.label || req.reason_category}</p>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{req.reason}</p>
                          <div className="flex gap-3 mt-1 text-xs text-gray-500">
                            {req.requested_check_in && <span>In: {req.requested_check_in}</span>}
                            {req.requested_check_out && <span>Out: {req.requested_check_out}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${cfg.color} flex items-center gap-1`}>
                          <StatusIcon className="w-3 h-3" />
                          {cfg.label}
                        </Badge>
                        {(req.status === 'pending' || req.status === 'sent_back') && (
                          <Button size="sm" variant="outline" onClick={() => handleEdit(req)} className="min-h-[44px] text-xs">
                            <Edit className="w-3 h-3 mr-1" /> Edit
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* Manager/HR comment */}
                    {(req.manager_comment || req.hr_comment) && (
                      <div className="mt-3 pt-3 border-t space-y-1">
                        {req.manager_comment && (
                          <p className="text-xs text-gray-500"><span className="font-medium">Manager:</span> {req.manager_comment}</p>
                        )}
                        {req.hr_comment && (
                          <p className="text-xs text-gray-500"><span className="font-medium">HR:</span> {req.hr_comment}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {requests.length === 0 && (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500">No regularisation requests yet</p>
                  <p className="text-sm text-gray-400">Click "New Request" to raise one</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Form Dialog */}
        <Dialog open={showForm} onOpenChange={open => { if (!open) closeForm(); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRequest ? 'Edit Request' : 'New Regularisation Request'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Bulk mode toggle */}
              {!editingRequest && (
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <button type="button" onClick={() => setBulkMode(false)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${!bulkMode ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>
                    Single Day
                  </button>
                  <button type="button" onClick={() => setBulkMode(true)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${bulkMode ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>
                    Multiple Days
                  </button>
                </div>
              )}

              {bulkMode ? (
                <div>
                  <Label className="mb-2 block">Select Dates *</Label>
                  <MultiDateCalendarPicker
                    selectedDates={bulkDates}
                    onChange={setBulkDates}
                    maxDate={new Date().toISOString().split('T')[0]}
                  />
                  <p className="text-xs text-gray-500 mt-1">Same check-in/out time and reason will apply to all selected dates</p>
                </div>
              ) : (
                <div>
                  <Label>Date *</Label>
                  <Input type="date" value={formData.attendance_date}
                    onChange={e => handleDateChange(e.target.value)} required max={new Date().toISOString().split('T')[0]} />
                </div>
              )}

              {/* Existing attendance display */}
              {existingAttendance && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <p className="font-medium text-amber-800 mb-1">Current Attendance Record</p>
                  <div className="grid grid-cols-3 gap-2 text-xs text-amber-700">
                    <div><span className="font-medium">Status:</span> {existingAttendance.status}</div>
                    <div><span className="font-medium">In:</span> {existingAttendance.check_in_time ? format(new Date(existingAttendance.check_in_time), 'HH:mm') : 'N/A'}</div>
                    <div><span className="font-medium">Out:</span> {existingAttendance.check_out_time ? format(new Date(existingAttendance.check_out_time), 'HH:mm') : 'N/A'}</div>
                  </div>
                </div>
              )}
              {fetchingAttendance && <p className="text-xs text-gray-400">Fetching attendance record...</p>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Corrected Check-In *</Label>
                  <Input type="time" value={formData.requested_check_in}
                    onChange={e => setFormData(p => ({ ...p, requested_check_in: e.target.value }))} required />
                </div>
                <div>
                  <Label>Corrected Check-Out *</Label>
                  <Input type="time" value={formData.requested_check_out}
                    onChange={e => setFormData(p => ({ ...p, requested_check_out: e.target.value }))} required />
                </div>
              </div>

              <div>
                <Label>Reason Category *</Label>
                <MobileSelect
                  value={formData.reason_category}
                  onValueChange={v => setFormData(p => ({ ...p, reason_category: v }))}
                  placeholder="Select a reason"
                  label="Select Reason"
                  options={REASON_OPTIONS}
                />
              </div>

              <div>
                <Label>Detailed Reason *</Label>
                <Textarea value={formData.reason} onChange={e => setFormData(p => ({ ...p, reason: e.target.value }))}
                  placeholder="Explain why regularisation is needed..." rows={3} required />
              </div>

              <div>
                <Label>Supporting Document <span className="text-gray-400 font-normal">(optional)</span></Label>
                {formData.document_url ? (
                  <div className="flex items-center gap-2 mt-1">
                    <a href={formData.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm hover:underline">View uploaded document</a>
                    <Button type="button" variant="ghost" size="sm" className="text-xs text-red-500" onClick={() => setFormData(p => ({ ...p, document_url: '' }))}>Remove</Button>
                  </div>
                ) : (
                  <div className="mt-1">
                    <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-300 rounded-lg p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <Upload className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{uploading ? 'Uploading...' : 'Click to upload'}</span>
                      <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} accept="image/*,.pdf,.doc,.docx" />
                    </label>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
                  {saving ? 'Submitting...' : editingRequest ? 'Update Request' : 'Submit Request'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}