import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { openLetterheadPrintWindow } from '../utils/letterhead';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import MobileSelect from '@/components/MobileSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Plus, Briefcase, Check, X, Eye, Printer, Loader2,
  Clock, CheckCircle2, XCircle, ChevronRight, Globe, Copy,
  Sparkles, Edit3, FileCheck, Users
} from 'lucide-react';

const STATUS_CONFIG = {
  draft:                    { label: 'Draft',                    color: 'bg-gray-100 text-gray-700' },
  pending_manager_approval: { label: 'Pending Manager Approval', color: 'bg-yellow-100 text-yellow-800' },
  pending_hr_approval:      { label: 'Pending HR Approval',      color: 'bg-blue-100 text-blue-800' },
  manager_rejected:         { label: 'Manager Rejected',         color: 'bg-red-100 text-red-800' },
  hr_rejected:              { label: 'HR Rejected',              color: 'bg-red-100 text-red-800' },
  approved:                 { label: 'Approved',                 color: 'bg-emerald-100 text-emerald-800' },
  published:                { label: 'Published',                color: 'bg-green-100 text-green-800' },
  on_hold:                  { label: 'On Hold',                  color: 'bg-orange-100 text-orange-800' },
  closed:                   { label: 'Closed',                   color: 'bg-gray-200 text-gray-700' },
  cancelled:                { label: 'Cancelled',                color: 'bg-red-200 text-red-900' },
};

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const JD_STATUS_CONFIG = {
  not_generated: { label: 'JD Not Generated', color: 'bg-gray-100 text-gray-600' },
  draft:         { label: 'JD Draft',          color: 'bg-yellow-100 text-yellow-700' },
  approved:      { label: 'JD Approved',       color: 'bg-green-100 text-green-700' },
};

const EMPTY_FORM = {
  position_title: '', department: '', employment_type: 'full_time',
  number_of_positions: 1, job_description: '', required_skills: '',
  experience_required: '', salary_range_min: '', salary_range_max: '',
  location: '', target_hire_date: '', priority: 'medium', hiring_manager_id: ''
};

export default function JobRequisitions() {
  const [user, setUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewRequisition, setViewRequisition] = useState(null);
  const [generatingJD, setGeneratingJD] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState('all');
  const [publishDialog, setPublishDialog] = useState(null);
  const [applicationDeadline, setApplicationDeadline] = useState('');
  // JD workflow state
  const [jdDialog, setJdDialog] = useState(null); // req for JD editing
  const [editedJD, setEditedJD] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [currentUser, allRequisitions, deptData, usersRes, locData] = await Promise.all([
        base44.auth.me(),
        base44.entities.JobRequisition.list('-created_date', 500),
        base44.entities.Department.list(),
        base44.functions.invoke('getAllUsers', {}),
        base44.entities.AppLocation.filter({ is_active: true })
      ]);
      setUser(currentUser);
      setRequisitions(allRequisitions);
      setDepartments(deptData);
      setLocations(locData);
      const usersArray = Array.isArray(usersRes?.data) ? usersRes.data : Array.isArray(usersRes) ? usersRes : [];
      setAllUsers(usersArray);
      if (deptData.length > 0 && !formData.department) {
        setFormData(prev => ({ ...prev, department: deptData[0].name }));
      }
    } catch (error) {
      console.error('Error loading requisitions:', error);
    }
    setLoading(false);
  };

  const getUserName = (userId) => {
    if (!userId) return '—';
    const u = allUsers.find(u => u.id === userId);
    return u ? u.full_name : userId;
  };

  // Determine approval flow based on who created and who is assigned as manager
  const getApprovalFlow = (creatorRole, hiringManagerId) => {
    // If management created → HR must approve
    // If HR created → hiring manager must approve (if assigned), else auto-skip to approved
    if (creatorRole === 'management') {
      return {
        status: 'pending_hr_approval',
        manager_approval_status: 'approved', // skip manager
        hr_approval_status: 'pending'
      };
    }
    // HR or admin created
    if (hiringManagerId) {
      return {
        status: 'pending_manager_approval',
        manager_approval_status: 'pending',
        hr_approval_status: 'pending'
      };
    }
    return {
      status: 'pending_hr_approval',
      manager_approval_status: 'approved',
      hr_approval_status: 'pending'
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const skills = formData.required_skills.split(',').map(s => s.trim()).filter(Boolean);
      const hiringManagerId = formData.hiring_manager_id && formData.hiring_manager_id !== 'none' ? formData.hiring_manager_id : '';
      const creatorRole = user.custom_role || user.role;
      const flow = getApprovalFlow(creatorRole, hiringManagerId);

      await base44.entities.JobRequisition.create({
        ...formData,
        required_skills: skills,
        number_of_positions: parseInt(formData.number_of_positions) || 1,
        salary_range_min: parseFloat(formData.salary_range_min) || 0,
        salary_range_max: parseFloat(formData.salary_range_max) || 0,
        hiring_manager_id: hiringManagerId,
        requested_by: user.id,
        requested_by_role: creatorRole,
        jd_status: 'not_generated',
        ...flow
      });
      toast.success('Job requisition submitted for approval.');
      setShowForm(false);
      setFormData({ ...EMPTY_FORM, department: departments[0]?.name || '' });
      loadData();
    } catch (error) {
      toast.error('Failed to create requisition');
    }
  };

  const handleManagerApprove = async (req) => {
    await base44.entities.JobRequisition.update(req.id, {
      manager_approval_status: 'approved',
      manager_approved_by: user.id,
      manager_approved_date: new Date().toISOString(),
      status: 'pending_hr_approval'
    });
    toast.success('Approved — sent to HR for final approval');
    loadData();
  };

  const handleHrApprove = async (req) => {
    await base44.entities.JobRequisition.update(req.id, {
      hr_approval_status: 'approved',
      hr_approved_by: user.id,
      hr_approved_date: new Date().toISOString(),
      approved_by: user.id,
      approved_date: new Date().toISOString(),
      status: 'approved'
    });
    toast.success('Requisition approved! Generate & approve JD before publishing.');
    loadData();
  };

  const openRejectDialog = (req, role) => {
    setRejectDialog({ req, role });
    setRejectReason('');
  };

  const handleConfirmReject = async () => {
    const { req, role } = rejectDialog;
    if (role === 'manager') {
      await base44.entities.JobRequisition.update(req.id, {
        manager_approval_status: 'rejected',
        manager_approved_by: user.id,
        manager_approved_date: new Date().toISOString(),
        manager_rejection_reason: rejectReason,
        rejection_reason: rejectReason,
        status: 'manager_rejected'
      });
    } else {
      await base44.entities.JobRequisition.update(req.id, {
        hr_approval_status: 'rejected',
        hr_approved_by: user.id,
        hr_approved_date: new Date().toISOString(),
        rejection_reason: rejectReason,
        status: 'hr_rejected'
      });
    }
    setRejectDialog(null);
    toast.error('Requisition rejected');
    loadData();
  };

  const handlePublish = async () => {
    const req = publishDialog;
    if (!req.ai_job_description || req.jd_status !== 'approved') {
      toast.error('Please generate and approve the JD before publishing.');
      setPublishDialog(null);
      return;
    }
    await base44.entities.JobRequisition.update(req.id, {
      status: 'published',
      is_published: true,
      published_date: new Date().toISOString(),
      application_deadline: applicationDeadline ? new Date(applicationDeadline).toISOString() : null
    });
    toast.success('Job published! Share the link with candidates.');
    setPublishDialog(null);
    setApplicationDeadline('');
    loadData();
  };

  const getJobLink = (req) => `https://maxvolt-one.co.in/ApplyForJob?jobId=${req.id}`;
  const copyLink = (req) => {
    navigator.clipboard.writeText(getJobLink(req));
    toast.success('Application link copied!');
  };

  // ---- JD Workflow ----
  const openJdDialog = async (req) => {
    setJdDialog(req);
    setEditedJD(req.ai_job_description || '');
  };

  const handleGenerateJD = async () => {
    setGeneratingJD(true);
    try {
      const req = jdDialog;
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a professional Job Description for the following position. Format it in a structured, formal manner. Include sections: About the Role, Key Responsibilities (bullet points), Required Qualifications (bullet points), Preferred Skills (bullet points), What We Offer. Keep it professional and concise.

Position: ${req.position_title}
Department: ${req.department}
Employment Type: ${req.employment_type?.replace('_', ' ')}
Experience Required: ${req.experience_required || 'Not specified'}
Location: ${req.location || 'Not specified'}
Number of Positions: ${req.number_of_positions}
Salary Range: ${req.salary_range_min > 0 ? `₹${req.salary_range_min.toLocaleString()} - ₹${req.salary_range_max.toLocaleString()} per annum` : 'Competitive'}
Required Skills: ${Array.isArray(req.required_skills) ? req.required_skills.join(', ') : req.required_skills || 'Not specified'}
Additional Notes: ${req.job_description || ''}

Return ONLY the job description content as plain text with clear section headers (no HTML tags). Use bullet points with • symbol.`,
        model: 'claude_sonnet_4_6'
      });
      const jdContent = typeof result === 'string' ? result : result?.content || JSON.stringify(result);
      setEditedJD(jdContent);
      // Save as draft
      await base44.entities.JobRequisition.update(req.id, {
        ai_job_description: jdContent,
        jd_status: 'draft'
      });
      setJdDialog(prev => ({ ...prev, ai_job_description: jdContent, jd_status: 'draft' }));
      setRequisitions(prev => prev.map(r => r.id === req.id ? { ...r, ai_job_description: jdContent, jd_status: 'draft' } : r));
      toast.success('JD generated! Review and edit, then approve.');
    } catch (error) {
      toast.error('Failed to generate JD: ' + error.message);
    }
    setGeneratingJD(false);
  };

  const handleSaveJDDraft = async () => {
    await base44.entities.JobRequisition.update(jdDialog.id, {
      ai_job_description: editedJD,
      jd_status: 'draft'
    });
    setRequisitions(prev => prev.map(r => r.id === jdDialog.id ? { ...r, ai_job_description: editedJD, jd_status: 'draft' } : r));
    toast.success('JD saved as draft');
  };

  const handleApproveJD = async () => {
    await base44.entities.JobRequisition.update(jdDialog.id, {
      ai_job_description: editedJD,
      jd_status: 'approved',
      jd_approved_by: user.id,
      jd_approved_date: new Date().toISOString()
    });
    setRequisitions(prev => prev.map(r => r.id === jdDialog.id ? { ...r, ai_job_description: editedJD, jd_status: 'approved' } : r));
    toast.success('JD approved! You can now publish the job.');
    setJdDialog(null);
    loadData();
  };

  const handlePrintJD = async (req) => {
    const jdContent = req.ai_job_description;
    if (!jdContent) {
      toast.error('Please generate and approve the JD first.');
      return;
    }
    const htmlContent = jdContent.replace(/\n/g, '<br/>');
    const contentHtml = `
      <div style="margin-bottom:10px;">
        <div style="font-size:12px;text-align:right;color:#888;">Date: ${format(new Date(), 'dd MMMM yyyy')} | Human Resources Department</div>
        <h2 style="font-size:20px;font-weight:bold;color:#e87722;margin:8px 0 4px;">${req.position_title}</h2>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:9px 12px;background:#fff8f0;border-left:3px solid #e87722;border-radius:3px;margin-bottom:12px;">
          <span style="font-size:11px;color:#555;"><strong style="color:#e87722;">Department:</strong> ${req.department}</span>
          <span style="font-size:11px;color:#555;"><strong style="color:#e87722;">Type:</strong> ${req.employment_type?.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
          <span style="font-size:11px;color:#555;"><strong style="color:#e87722;">Experience:</strong> ${req.experience_required || 'Open'}</span>
          <span style="font-size:11px;color:#555;"><strong style="color:#e87722;">Location:</strong> ${req.location || 'As per company policy'}</span>
          <span style="font-size:11px;color:#555;"><strong style="color:#e87722;">Positions:</strong> ${req.number_of_positions}</span>
          ${req.salary_range_min > 0 ? `<span style="font-size:11px;color:#555;"><strong style="color:#e87722;">CTC:</strong> ₹${req.salary_range_min.toLocaleString()} – ₹${req.salary_range_max.toLocaleString()} p.a.</span>` : ''}
        </div>
        <div style="font-size:11px;line-height:1.8;">${htmlContent}</div>
        <div style="margin-top:36px;display:flex;justify-content:space-between;font-size:10px;color:#888;border-top:1px solid #f0e0d0;padding-top:10px;">
          <span>Maxvolt Energy Industries Limited | Confidential</span>
          <span>This document is generated for recruitment purposes only.</span>
        </div>
      </div>`;
    openLetterheadPrintWindow(`Job Description - ${req.position_title}`, contentHtml, '', false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  const isHR = user?.role === 'hr' || user?.role === 'admin';
  const isManagement = ['management', 'hr', 'admin'].includes(user?.role) || ['management', 'hr', 'admin'].includes(user?.custom_role);
  const userRole = user?.custom_role || user?.role;
  const isManagementOnly = userRole === 'management';

  // Can create: HR, admin, management
  const canCreate = isManagement;

  const filtered = filterStatus === 'all' ? requisitions : requisitions.filter(r => r.status === filterStatus);

  const stats = {
    total: requisitions.length,
    pendingManager: requisitions.filter(r => r.status === 'pending_manager_approval').length,
    pendingHR: requisitions.filter(r => r.status === 'pending_hr_approval').length,
    published: requisitions.filter(r => r.status === 'published').length,
  };

  // Managers (for hiring manager dropdown): management + hr + admin roles
  const managerOptions = allUsers.filter(u =>
    ['management', 'hr', 'admin'].includes(u.role) || ['management', 'hr', 'admin'].includes(u.custom_role)
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Job Requisitions</h1>
            <p className="text-gray-500 text-sm mt-1">Manage hiring requests through an approval & JD workflow</p>
          </div>
          {canCreate && (
            <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" /> New Requisition
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'text-gray-700', bg: 'bg-gray-100', filter: 'all' },
            { label: 'Pending Manager', value: stats.pendingManager, color: 'text-yellow-700', bg: 'bg-yellow-100', filter: 'pending_manager_approval' },
            { label: 'Pending HR', value: stats.pendingHR, color: 'text-blue-700', bg: 'bg-blue-100', filter: 'pending_hr_approval' },
            { label: 'Published', value: stats.published, color: 'text-green-700', bg: 'bg-green-100', filter: 'published' },
          ].map(s => (
            <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterStatus(s.filter)}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-3 rounded-full ${s.bg}`}>
                  <Briefcase className={`w-5 h-5 ${s.color}`} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-2 flex-wrap">
          {['all', 'pending_manager_approval', 'pending_hr_approval', 'approved', 'published', 'manager_rejected', 'hr_rejected', 'closed'].map(s => (
            <Button key={s} size="sm" variant={filterStatus === s ? 'default' : 'outline'}
              onClick={() => setFilterStatus(s)}
              className={filterStatus === s ? 'bg-blue-600' : ''}>
              {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
            </Button>
          ))}
        </div>

        {/* Requisitions List */}
        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="text-center text-gray-400 py-12">No requisitions found</p>
            ) : (
              <div className="divide-y">
                {filtered.map(req => {
                  const sc = STATUS_CONFIG[req.status] || { label: req.status, color: 'bg-gray-100 text-gray-700' };
                  const jdSc = JD_STATUS_CONFIG[req.jd_status || 'not_generated'];
                  const isManagerForReq = req.hiring_manager_id === user?.id;
                  const canManagerAct = isManagerForReq && req.status === 'pending_manager_approval';
                  // Management-created → HR approves. HR-created → hiring manager approves
                  const canHRAct = isHR && req.status === 'pending_hr_approval';
                  const canPublish = isHR && req.status === 'approved';
                  const canManageJD = (isHR || isManagerForReq) && ['approved', 'published'].includes(req.status);

                  return (
                    <div key={req.id} className="p-5 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="font-semibold text-gray-900">{req.position_title}</h3>
                            <Badge className={sc.color}>{sc.label}</Badge>
                            <Badge className={PRIORITY_COLORS[req.priority] || 'bg-gray-100 text-gray-600'}>
                              {req.priority?.toUpperCase()}
                            </Badge>
                            <Badge className={jdSc.color}>{jdSc.label}</Badge>
                          </div>
                          <div className="text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                            <span>{req.department}</span>
                            <span>{req.employment_type?.replace('_', ' ')}</span>
                            <span>{req.number_of_positions} position(s)</span>
                            {req.experience_required && <span>{req.experience_required}</span>}
                            {req.location && <span>📍 {req.location}</span>}
                          </div>

                          {/* Approval Trail */}
                          <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
                            <span className="text-gray-400">Created by:</span>
                            <span className="font-medium text-gray-600">{getUserName(req.requested_by)}</span>
                            {req.requested_by_role && <span className="text-gray-400">({req.requested_by_role})</span>}
                            <ChevronRight className="w-3 h-3 text-gray-300" />
                            <span className="text-gray-400">Manager:</span>
                            <span className={`font-medium ${req.manager_approval_status === 'approved' ? 'text-green-600' : req.manager_approval_status === 'rejected' ? 'text-red-600' : 'text-yellow-600'}`}>
                              {req.manager_approval_status === 'approved' ? `✓ ${getUserName(req.manager_approved_by) || (req.hiring_manager_id ? getUserName(req.hiring_manager_id) : 'Skipped')}` :
                                req.manager_approval_status === 'rejected' ? `✗ Rejected` : `⏳ ${getUserName(req.hiring_manager_id) || 'Unassigned'}`}
                            </span>
                            <ChevronRight className="w-3 h-3 text-gray-300" />
                            <span className="text-gray-400">HR:</span>
                            <span className={`font-medium ${req.hr_approval_status === 'approved' ? 'text-green-600' : req.hr_approval_status === 'rejected' ? 'text-red-600' : 'text-gray-400'}`}>
                              {req.hr_approval_status === 'approved' ? `✓ ${getUserName(req.hr_approved_by)}` :
                                req.hr_approval_status === 'rejected' ? `✗ Rejected` : '⏳ Pending'}
                            </span>
                          </div>

                          {req.rejection_reason && (
                            <p className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                              Rejection reason: {req.rejection_reason}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                          <Button size="sm" variant="outline" onClick={() => setViewRequisition(req)}>
                            <Eye className="w-3 h-3 mr-1" /> View
                          </Button>
                          {canManagerAct && (
                            <>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleManagerApprove(req)}>
                                <Check className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => openRejectDialog(req, 'manager')}>
                                <X className="w-3 h-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {canHRAct && (
                            <>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleHrApprove(req)}>
                                <Check className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => openRejectDialog(req, 'hr')}>
                                <X className="w-3 h-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {canManageJD && (
                            <Button size="sm" variant="outline" className="border-indigo-300 text-indigo-700" onClick={() => openJdDialog(req)}>
                              <FileCheck className="w-3 h-3 mr-1" /> JD
                            </Button>
                          )}
                          {canPublish && (
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700"
                              onClick={() => { setPublishDialog(req); setApplicationDeadline(''); }}>
                              <Globe className="w-3 h-3 mr-1" /> Publish
                            </Button>
                          )}
                          {req.status === 'published' && (
                            <Button size="sm" variant="outline" onClick={() => copyLink(req)}>
                              <Copy className="w-3 h-3 mr-1" /> Copy Link
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Form Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { setShowForm(o); if (!o) setFormData({ ...EMPTY_FORM, department: departments[0]?.name || '' }); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Job Requisition</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Position Title *</Label>
                <Input value={formData.position_title} onChange={e => setFormData({ ...formData, position_title: e.target.value })} required />
              </div>
              <div>
                <Label>Department *</Label>
                <MobileSelect
                  value={formData.department}
                  onValueChange={v => setFormData({ ...formData, department: v })}
                  placeholder="Select department"
                  label="Select Department"
                  options={departments.map(d => ({ value: d.name, label: d.name }))}
                />
              </div>
              <div>
                <Label>Employment Type</Label>
                <MobileSelect
                  value={formData.employment_type}
                  onValueChange={v => setFormData({ ...formData, employment_type: v })}
                  placeholder="Employment Type"
                  label="Select Employment Type"
                  options={[
                    { value: 'full_time', label: 'Full Time' },
                    { value: 'part_time', label: 'Part Time' },
                    { value: 'contract', label: 'Contract' },
                    { value: 'intern', label: 'Intern' },
                  ]}
                />
              </div>
              <div>
                <Label>Number of Positions</Label>
                <Input type="number" min="1" value={formData.number_of_positions} onChange={e => setFormData({ ...formData, number_of_positions: e.target.value })} />
              </div>
              <div>
                <Label>Hiring Manager (optional)</Label>
                <MobileSelect
                  value={formData.hiring_manager_id}
                  onValueChange={v => setFormData({ ...formData, hiring_manager_id: v })}
                  placeholder="Select hiring manager"
                  label="Select Hiring Manager"
                  options={[
                    { value: 'none', label: 'None (skip to HR)' },
                    ...managerOptions.map(u => ({ value: u.id, label: u.full_name }))
                  ]}
                />
              </div>
              <div>
                <Label>Priority</Label>
                <MobileSelect
                  value={formData.priority}
                  onValueChange={v => setFormData({ ...formData, priority: v })}
                  placeholder="Priority"
                  label="Select Priority"
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'urgent', label: 'Urgent' },
                  ]}
                />
              </div>
              <div>
                <Label>Experience Required</Label>
                <Input placeholder="e.g., 2-5 years" value={formData.experience_required} onChange={e => setFormData({ ...formData, experience_required: e.target.value })} />
              </div>
              <div>
                <Label>Location</Label>
                <MobileSelect
                  value={formData.location || '_none'}
                  onValueChange={v => setFormData({ ...formData, location: v === '_none' ? '' : v })}
                  placeholder="Select location"
                  label="Select Location"
                  options={[
                    { value: '_none', label: 'Not specified' },
                    ...locations.map(l => ({ value: l.name, label: l.name }))
                  ]}
                />
              </div>
              <div>
                <Label>Salary Range Min (₹)</Label>
                <Input type="number" value={formData.salary_range_min} onChange={e => setFormData({ ...formData, salary_range_min: e.target.value })} />
              </div>
              <div>
                <Label>Salary Range Max (₹)</Label>
                <Input type="number" value={formData.salary_range_max} onChange={e => setFormData({ ...formData, salary_range_max: e.target.value })} />
              </div>
              <div>
                <Label>Target Hire Date</Label>
                <Input type="date" value={formData.target_hire_date} onChange={e => setFormData({ ...formData, target_hire_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Job Brief / Notes *</Label>
              <Textarea rows={4} placeholder="Describe the role, key expectations, or any specific requirements. AI will use this to generate a detailed JD." value={formData.job_description} onChange={e => setFormData({ ...formData, job_description: e.target.value })} required />
            </div>
            <div>
              <Label>Required Skills (comma separated)</Label>
              <Input placeholder="e.g., React, Node.js, Communication" value={formData.required_skills} onChange={e => setFormData({ ...formData, required_skills: e.target.value })} />
            </div>
            {isManagementOnly && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                <strong>Note:</strong> As Management, this requisition will go directly to HR for approval.
              </div>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Submit for Approval</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* JD Workflow Dialog */}
      {jdDialog && (
        <Dialog open={!!jdDialog} onOpenChange={() => setJdDialog(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Job Description — {jdDialog.position_title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* JD Status Badge */}
              <div className="flex items-center gap-3">
                <Badge className={JD_STATUS_CONFIG[jdDialog.jd_status || 'not_generated']?.color}>
                  {JD_STATUS_CONFIG[jdDialog.jd_status || 'not_generated']?.label}
                </Badge>
                {jdDialog.jd_status === 'approved' && (
                  <span className="text-xs text-gray-500">Approved by {getUserName(jdDialog.jd_approved_by)}</span>
                )}
              </div>

              {/* Workflow Steps */}
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
                <span className={`font-medium ${!jdDialog.jd_status || jdDialog.jd_status === 'not_generated' ? 'text-blue-600' : 'text-gray-400'}`}>1. Generate</span>
                <ChevronRight className="w-3 h-3" />
                <span className={`font-medium ${jdDialog.jd_status === 'draft' ? 'text-blue-600' : 'text-gray-400'}`}>2. Verify & Edit</span>
                <ChevronRight className="w-3 h-3" />
                <span className={`font-medium ${jdDialog.jd_status === 'approved' ? 'text-green-600' : 'text-gray-400'}`}>3. Approve</span>
                <ChevronRight className="w-3 h-3" />
                <span className="font-medium text-gray-400">4. Publish</span>
              </div>

              {/* Generate Button */}
              <Button
                onClick={handleGenerateJD}
                disabled={generatingJD}
                variant="outline"
                className="w-full border-indigo-300 text-indigo-700 hover:bg-indigo-50"
              >
                {generatingJD ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating JD...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" />{editedJD ? 'Regenerate JD' : 'Generate JD with AI'}</>
                )}
              </Button>

              {/* Editable JD */}
              {editedJD && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="flex items-center gap-2"><Edit3 className="w-4 h-4" /> Job Description (editable)</Label>
                      <Button size="sm" variant="outline" onClick={handleSaveJDDraft}>Save Draft</Button>
                    </div>
                    <Textarea
                      rows={18}
                      value={editedJD}
                      onChange={e => setEditedJD(e.target.value)}
                      className="font-mono text-sm"
                      placeholder="Generated JD will appear here..."
                    />
                  </div>

                  <div className="flex gap-3 pt-2 border-t">
                    <Button
                      onClick={handleApproveJD}
                      className="bg-green-600 hover:bg-green-700"
                      disabled={jdDialog.jd_status === 'approved' && editedJD === jdDialog.ai_job_description}
                    >
                      <FileCheck className="w-4 h-4 mr-2" />
                      {jdDialog.jd_status === 'approved' ? 'Re-Approve JD' : 'Approve JD'}
                    </Button>
                    <Button variant="outline" onClick={() => handlePrintJD({ ...jdDialog, ai_job_description: editedJD })}>
                      <Printer className="w-4 h-4 mr-2" /> Print JD
                    </Button>
                    <Button variant="outline" onClick={() => setJdDialog(null)}>Close</Button>
                  </div>
                </>
              )}

              {!editedJD && (
                <div className="text-center text-gray-400 py-6 text-sm">
                  Click "Generate JD with AI" to create a professional job description based on the requisition details.
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject Requisition</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Please provide a reason for rejection.</p>
            <div>
              <Label>Rejection Reason *</Label>
              <Textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Enter reason..." />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
              <Button variant="destructive" disabled={!rejectReason.trim()} onClick={handleConfirmReject}>Confirm Reject</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={!!publishDialog} onOpenChange={() => setPublishDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Publish Job Opening</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This will make <strong>{publishDialog?.position_title}</strong> publicly visible to candidates.
            </p>
            {publishDialog && (!publishDialog.ai_job_description || publishDialog.jd_status !== 'approved') && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                ⚠️ JD has not been approved yet. Please generate and approve the JD before publishing.
              </div>
            )}
            <div>
              <Label>Application Deadline (optional)</Label>
              <Input type="date" value={applicationDeadline} onChange={e => setApplicationDeadline(e.target.value)} />
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
              <p className="font-semibold mb-1">Public Application Link:</p>
              <p className="break-all">{publishDialog ? getJobLink(publishDialog) : ''}</p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setPublishDialog(null)}>Cancel</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!publishDialog?.ai_job_description || publishDialog?.jd_status !== 'approved'}
                onClick={handlePublish}
              >
                <Globe className="w-4 h-4 mr-2" /> Publish & Get Link
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Detail Dialog */}
      {viewRequisition && (
        <Dialog open={!!viewRequisition} onOpenChange={() => setViewRequisition(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{viewRequisition.position_title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge className={STATUS_CONFIG[viewRequisition.status]?.color}>{STATUS_CONFIG[viewRequisition.status]?.label}</Badge>
                <Badge className={PRIORITY_COLORS[viewRequisition.priority]}>{viewRequisition.priority?.toUpperCase()}</Badge>
                <Badge className={JD_STATUS_CONFIG[viewRequisition.jd_status || 'not_generated']?.color}>
                  {JD_STATUS_CONFIG[viewRequisition.jd_status || 'not_generated']?.label}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Department:</span> <span className="font-medium">{viewRequisition.department}</span></div>
                <div><span className="text-gray-500">Type:</span> <span className="font-medium">{viewRequisition.employment_type?.replace('_', ' ')}</span></div>
                <div><span className="text-gray-500">Experience:</span> <span className="font-medium">{viewRequisition.experience_required || '—'}</span></div>
                <div><span className="text-gray-500">Location:</span> <span className="font-medium">{viewRequisition.location || '—'}</span></div>
                <div><span className="text-gray-500">Positions:</span> <span className="font-medium">{viewRequisition.number_of_positions}</span></div>
                <div><span className="text-gray-500">Hiring Manager:</span> <span className="font-medium">{getUserName(viewRequisition.hiring_manager_id)}</span></div>
                {viewRequisition.target_hire_date && <div><span className="text-gray-500">Target Date:</span> <span className="font-medium">{viewRequisition.target_hire_date}</span></div>}
                {viewRequisition.salary_range_min > 0 && (
                  <div className="col-span-2"><span className="text-gray-500">Salary:</span> <span className="font-medium">₹{viewRequisition.salary_range_min.toLocaleString()} – ₹{viewRequisition.salary_range_max.toLocaleString()}</span></div>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Approval Trail</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                    <span className="text-gray-500">Created by:</span>
                    <span className="font-medium">{getUserName(viewRequisition.requested_by)}</span>
                    {viewRequisition.requested_by_role && <Badge variant="outline" className="text-xs">{viewRequisition.requested_by_role}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    {viewRequisition.manager_approval_status === 'approved' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                      viewRequisition.manager_approval_status === 'rejected' ? <XCircle className="w-4 h-4 text-red-500" /> :
                        <Clock className="w-4 h-4 text-yellow-500" />}
                    <span className="text-gray-500">Manager approval:</span>
                    <span className="font-medium capitalize">{viewRequisition.manager_approval_status || 'pending'}</span>
                    {viewRequisition.manager_approved_by && <span className="text-gray-400 text-xs">by {getUserName(viewRequisition.manager_approved_by)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {viewRequisition.hr_approval_status === 'approved' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                      viewRequisition.hr_approval_status === 'rejected' ? <XCircle className="w-4 h-4 text-red-500" /> :
                        <Clock className="w-4 h-4 text-yellow-500" />}
                    <span className="text-gray-500">HR approval:</span>
                    <span className="font-medium capitalize">{viewRequisition.hr_approval_status || 'pending'}</span>
                    {viewRequisition.hr_approved_by && <span className="text-gray-400 text-xs">by {getUserName(viewRequisition.hr_approved_by)}</span>}
                  </div>
                </div>
                {viewRequisition.rejection_reason && (
                  <p className="mt-3 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">Rejection: {viewRequisition.rejection_reason}</p>
                )}
              </div>
              <div>
                <Label>Job Brief / Notes</Label>
                <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1 bg-gray-50 p-3 rounded-lg">{viewRequisition.job_description}</p>
              </div>
              {viewRequisition.ai_job_description && (
                <div>
                  <Label>Approved Job Description</Label>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1 bg-indigo-50 p-3 rounded-lg border border-indigo-100">{viewRequisition.ai_job_description}</p>
                </div>
              )}
              {viewRequisition.required_skills?.length > 0 && (
                <div>
                  <Label>Required Skills</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {viewRequisition.required_skills.map((s, i) => <Badge key={i} variant="outline">{s}</Badge>)}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2 border-t flex-wrap">
                {viewRequisition.ai_job_description && (
                  <Button onClick={() => handlePrintJD(viewRequisition)} className="bg-indigo-600 hover:bg-indigo-700">
                    <Printer className="w-4 h-4 mr-2" /> Print JD
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewRequisition(null)}>Close</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}