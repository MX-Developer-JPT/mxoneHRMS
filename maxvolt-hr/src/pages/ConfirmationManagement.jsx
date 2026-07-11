import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';
import { Calendar, Loader2, FileText, Search, Plus, UserCheck, Mail, Send } from 'lucide-react';

const CRITERIA = [
  { key: 'work_quality',         label: 'Work Quality' },
  { key: 'productivity',         label: 'Productivity & Target Achievement' },
  { key: 'technical_competence', label: 'Technical Competence' },
  { key: 'communication',        label: 'Communication Skills' },
  { key: 'teamwork',             label: 'Teamwork' },
  { key: 'discipline',           label: 'Behaviour & Discipline' },
  { key: 'learning_ability',     label: 'Learning Ability' },
  { key: 'attendance',           label: 'Attendance & Punctuality' },
];

const STATUS_COLORS = {
  manager_submitted: 'bg-blue-100 text-blue-800',
  hr_approved:       'bg-yellow-100 text-yellow-800',
  confirmed:         'bg-green-100 text-green-800',
  extended:          'bg-orange-100 text-orange-800',
  rejected:          'bg-red-100 text-red-800',
};

const STATUS_LABELS = {
  manager_submitted: 'Pending HR Review',
  hr_approved:       'Pending Management',
  confirmed:         'Confirmed',
  extended:          'Probation Extended',
  rejected:          'Not Confirmed',
};

function ScoreInput({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`w-8 h-8 rounded text-sm font-bold border transition-colors ${
            value >= n
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-400 border-gray-200 hover:border-blue-400'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ form, setForm, isHRInitiated }) {
  const avgScore = () => {
    const vals = Object.values(form.scores || {}).filter(Boolean);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : null;
  };
  return (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-semibold mb-2 block">Recommendation</Label>
        <div className="flex gap-3">
          {[
            { value: 'confirm', label: 'Confirm',         color: 'bg-green-600 hover:bg-green-700' },
            { value: 'extend',  label: 'Extend Probation',color: 'bg-orange-500 hover:bg-orange-600' },
            { value: 'reject',  label: 'Not Confirm',     color: 'bg-red-600 hover:bg-red-700' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setForm(f => ({ ...f, action: opt.value }))}
              className={`flex-1 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                form.action === opt.value ? opt.color : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {form.action === 'extend' && (
        <div>
          <Label className="text-sm font-semibold mb-1 block">Extend Until</Label>
          <Input
            type="date"
            value={form.extended_until}
            onChange={e => setForm(f => ({ ...f, extended_until: e.target.value }))}
            min={format(new Date(), 'yyyy-MM-dd')}
          />
        </div>
      )}

      <div>
        <Label className="text-sm font-semibold mb-3 block">
          Performance Evaluation <span className="font-normal text-gray-500">(1 = Poor, 5 = Excellent)</span>
        </Label>
        <div className="space-y-3">
          {CRITERIA.map(c => (
            <div key={c.key} className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-sm text-gray-700 flex-1 min-w-[120px]">{c.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                <ScoreInput
                  value={form.scores?.[c.key] || 0}
                  onChange={v => setForm(f => ({ ...f, scores: { ...f.scores, [c.key]: v } }))}
                />
                <span className="text-sm font-semibold text-blue-700 w-4">{form.scores?.[c.key] || ''}</span>
              </div>
            </div>
          ))}
        </div>
        {avgScore() && (
          <p className="text-sm text-gray-500 mt-2">
            Average: <span className="font-semibold">{avgScore()}/5</span>
          </p>
        )}
      </div>

      <div>
        <Label className="text-sm font-semibold mb-1 block">
          {isHRInitiated ? 'HR Comments & Evaluation' : 'Comments & Observations'}
        </Label>
        <Textarea
          placeholder="Provide detailed comments about the employee's performance, strengths, and areas of improvement..."
          value={form.comments}
          onChange={e => setForm(f => ({ ...f, comments: e.target.value }))}
          rows={4}
        />
      </div>
    </div>
  );
}

export default function ConfirmationManagement() {
  const [user, setUser]       = useState(null);
  const [role, setRole]       = useState('');
  const [loading, setLoading] = useState(true);
  const [allEmps, setAllEmps] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [search, setSearch]   = useState('');

  // Manager submit dialog
  const [submitDlg, setSubmitDlg] = useState({ open: false, emp: null });
  const [submitForm, setSubmitForm] = useState({ action: 'confirm', extended_until: '', scores: {}, comments: '' });
  const [submitting, setSubmitting] = useState(false);

  // HR initiate dialog (same form, different backend call)
  const [initiateDlg, setInitiateDlg] = useState({ open: false, emp: null });
  const [initiateForm, setInitiateForm] = useState({ action: 'confirm', extended_until: '', scores: {}, comments: '' });
  const [initiating, setInitiating] = useState(false);

  // HR review dialog
  const [hrDlg, setHrDlg]   = useState({ open: false, review: null });
  const [hrForm, setHrForm] = useState({ hr_action: 'approve', hr_comments: '' });
  const [hrSaving, setHrSaving] = useState(false);

  // Management approval dialog
  const [mgmtDlg, setMgmtDlg]   = useState({ open: false, review: null });
  const [mgmtForm, setMgmtForm] = useState({ final_action: 'confirmed', management_comments: '', extended_until: '' });
  const [mgmtSaving, setMgmtSaving] = useState(false);

  // Detail view
  const [detailDlg, setDetailDlg] = useState({ open: false, review: null });

  // Letter sending
  const [sendingLetter, setSendingLetter] = useState(null); // review id being sent

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);
      const r = me.custom_role || me.role;
      setRole(r);

      const [emps, reviewsRes] = await Promise.all([
        base44.entities.Employee.filter({ status: 'active' }),
        base44.functions.invoke('getProbationReviews', {}),
      ]);

      // Exclude employees who are already confirmed (active + have a confirmation_date)
      const eligibleEmps = emps.filter(e =>
        !(e.employee_status === 'active' && e.confirmation_date)
      );

      const today = new Date();
      const enriched = eligibleEmps.map(e => {
        const endDate = e.probation_end_date
          ? new Date(e.probation_end_date)
          : e.date_of_joining
            ? new Date(new Date(e.date_of_joining).getTime() + 180 * 86400000)
            : null;
        const daysLeft = endDate ? differenceInDays(endDate, today) : null;
        return { ...e, probationEndDate: endDate, daysLeft };
      });

      setAllEmps(enriched);
      setReviews(reviewsRes.data?.reviews || []);
    } catch (e) {
      toast.error('Failed to load data: ' + e.message);
    }
    setLoading(false);
  };

  const hasActiveReview = userId =>
    reviews.some(r => r.user_id === userId && ['manager_submitted', 'hr_approved'].includes(r.status));

  const hasCompletedReview = userId =>
    reviews.some(r => r.user_id === userId && ['confirmed', 'extended', 'rejected'].includes(r.status));

  const avgScore = scores => {
    const vals = Object.values(scores || {}).filter(Boolean);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : '—';
  };

  // ── Manager submit review ──
  const openSubmit = emp => {
    setSubmitForm({ action: 'confirm', extended_until: '', scores: {}, comments: '' });
    setSubmitDlg({ open: true, emp });
  };

  const handleSubmitReview = async () => {
    const { emp } = submitDlg;
    const missingScores = CRITERIA.filter(c => !submitForm.scores[c.key]);
    if (missingScores.length) { toast.error('Please rate all criteria'); return; }
    if (!submitForm.comments.trim()) { toast.error('Please add comments'); return; }
    if (submitForm.action === 'extend' && !submitForm.extended_until) { toast.error('Please set extension date'); return; }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('submitProbationReview', {
        employee_user_id: emp.user_id,
        action: submitForm.action,
        extended_until: submitForm.extended_until,
        manager_scores: submitForm.scores,
        manager_comments: submitForm.comments,
      });
      if (res.data?.success) {
        toast.success('Review submitted to HR');
        setSubmitDlg({ open: false, emp: null });
        loadAll();
      } else {
        toast.error(res.data?.error || 'Submission failed');
      }
    } catch (e) { toast.error(e.message); }
    setSubmitting(false);
  };

  // ── HR initiate confirmation ──
  const openInitiate = emp => {
    setInitiateForm({ action: 'confirm', extended_until: '', scores: {}, comments: '' });
    setInitiateDlg({ open: true, emp });
  };

  const handleInitiate = async () => {
    const { emp } = initiateDlg;
    const missingScores = CRITERIA.filter(c => !initiateForm.scores[c.key]);
    if (missingScores.length) { toast.error('Please rate all criteria'); return; }
    if (!initiateForm.comments.trim()) { toast.error('Please add comments'); return; }
    if (initiateForm.action === 'extend' && !initiateForm.extended_until) { toast.error('Please set extension date'); return; }
    setInitiating(true);
    try {
      const res = await base44.functions.invoke('hrInitiateConfirmation', {
        employee_user_id: emp.user_id,
        action: initiateForm.action,
        extended_until: initiateForm.extended_until,
        scores: initiateForm.scores,
        comments: initiateForm.comments,
      });
      if (res.data?.success) {
        toast.success('Confirmation initiated — sent to Management for final decision');
        setInitiateDlg({ open: false, emp: null });
        loadAll();
      } else {
        toast.error(res.data?.error || 'Failed');
      }
    } catch (e) { toast.error(e.message); }
    setInitiating(false);
  };

  // ── HR review ──
  const openHRReview = review => {
    setHrForm({ hr_action: 'approve', hr_comments: '' });
    setHrDlg({ open: true, review });
  };

  const handleHRReview = async () => {
    if (!hrForm.hr_comments.trim()) { toast.error('Please add comments'); return; }
    setHrSaving(true);
    try {
      const res = await base44.functions.invoke('processProbationHRReview', {
        review_id: hrDlg.review.id,
        hr_action: hrForm.hr_action,
        hr_comments: hrForm.hr_comments,
      });
      if (res.data?.success) {
        toast.success(hrForm.hr_action === 'approve' ? 'Forwarded to Management' : 'Review rejected');
        setHrDlg({ open: false, review: null });
        loadAll();
      } else {
        toast.error(res.data?.error || 'Failed');
      }
    } catch (e) { toast.error(e.message); }
    setHrSaving(false);
  };

  // ── Management final decision ──
  const openMgmt = review => {
    setMgmtForm({
      final_action: review.action === 'confirm' ? 'confirmed' : review.action === 'extend' ? 'extended' : 'rejected',
      management_comments: '',
      extended_until: review.extended_until || '',
    });
    setMgmtDlg({ open: true, review });
  };

  const handleMgmt = async () => {
    if (!mgmtForm.management_comments.trim()) { toast.error('Please add comments'); return; }
    if (mgmtForm.final_action === 'extended' && !mgmtForm.extended_until) { toast.error('Please set extension date'); return; }
    setMgmtSaving(true);
    try {
      const res = await base44.functions.invoke('processProbationManagementApproval', {
        review_id: mgmtDlg.review.id,
        final_action: mgmtForm.final_action,
        management_comments: mgmtForm.management_comments,
        extended_until: mgmtForm.extended_until,
      });
      if (res.data?.success) {
        toast.success('Decision recorded');
        setMgmtDlg({ open: false, review: null });
        loadAll();
      } else {
        toast.error(res.data?.error || 'Failed');
      }
    } catch (e) { toast.error(e.message); }
    setMgmtSaving(false);
  };

  // ── Send confirmation/extension letter ──
  const handleSendLetter = async (reviewId) => {
    setSendingLetter(reviewId);
    try {
      const res = await base44.functions.invoke('sendConfirmationLetter', { review_id: reviewId });
      if (res.data?.success) {
        toast.success(`Letter sent to ${res.data.email_sent_to}`);
        loadAll();
      } else {
        toast.error(res.data?.error || 'Failed to send letter');
      }
    } catch (e) { toast.error(e.message); }
    setSendingLetter(null);
  };

  const isHR     = ['hr', 'admin'].includes(role);
  const isMgmt   = role === 'management';
  const isManager = role === 'manager';

  const hrPendingReviews   = reviews.filter(r => r.status === 'manager_submitted');
  const mgmtPendingReviews = reviews.filter(r => r.status === 'hr_approved');

  // Employees visible to current user
  const myTeamEmps = isManager && user
    ? allEmps.filter(e => e.reporting_manager_id === user.id)
    : allEmps;

  // Filtered by search
  const filteredEmps = myTeamEmps.filter(e => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (e.display_name || '').toLowerCase().includes(s) ||
      (e.employee_code || '').toLowerCase().includes(s) ||
      (e.department || '').toLowerCase().includes(s) ||
      (e.designation || '').toLowerCase().includes(s)
    );
  });

  // For the "employees" tab — show those on probation or recently joined (< 270 days)
  const today = new Date();
  const probationList = filteredEmps.filter(e =>
    e.employee_status === 'probation' ||
    (e.date_of_joining && differenceInDays(today, new Date(e.date_of_joining)) <= 270) ||
    e.probation_end_date
  ).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="animate-spin w-6 h-6 text-blue-500 mr-2" /> Loading...
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employment Confirmation</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage probation reviews and confirmation approvals</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Eligible Employees',   value: probationList.length,                                                            color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'Due ≤ 15 Days',        value: probationList.filter(e => e.daysLeft != null && e.daysLeft <= 15 && e.daysLeft >= 0).length, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Pending HR Review',    value: hrPendingReviews.length,                                                         color: 'text-blue-600',   bg: 'bg-blue-50' },
            { label: 'Pending Management',   value: mgmtPendingReviews.length,                                                       color: 'text-purple-600', bg: 'bg-purple-50' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className={`p-4 text-center ${s.bg} rounded-lg`}>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-600 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue={isHR ? 'employees' : isMgmt ? 'mgmt_approval' : 'my_team'}>
          <TabsList className="flex flex-wrap gap-1 h-auto">
            {/* All roles: their employee view */}
            <TabsTrigger value={isManager ? 'my_team' : 'employees'}>
              {isManager ? 'My Team' : 'Employees'}
            </TabsTrigger>
            {isHR && (
              <TabsTrigger value="hr_review">
                HR Review
                {hrPendingReviews.length > 0 && (
                  <Badge className="ml-1 bg-blue-500 text-white text-xs">{hrPendingReviews.length}</Badge>
                )}
              </TabsTrigger>
            )}
            {(isMgmt || isHR) && (
              <TabsTrigger value="mgmt_approval">
                Management Approval
                {mgmtPendingReviews.length > 0 && (
                  <Badge className="ml-1 bg-purple-500 text-white text-xs">{mgmtPendingReviews.length}</Badge>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* ── Employees tab (HR/management/manager) ── */}
          <TabsContent value={isManager ? 'my_team' : 'employees'}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle>{isManager ? 'My Team' : 'Employees'}</CardTitle>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      className="pl-9 pr-3 py-2 border rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Search by name, code, department..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                {!isManager && (
                  <p className="text-sm text-gray-500">
                    Showing employees on probation or joined within the last 9 months.
                    Use the search to find any specific employee.
                  </p>
                )}
              </CardHeader>
              <CardContent>
                {(isManager ? filteredEmps : probationList).length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <UserCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">{search ? 'No employees match your search' : 'No employees found'}</p>
                    {!search && !isManager && (
                      <p className="text-sm mt-1">Employees on probation or who joined in the last 9 months will appear here.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(isManager ? filteredEmps : probationList).map(emp => {
                      const active    = hasActiveReview(emp.user_id);
                      const completed = hasCompletedReview(emp.user_id);
                      const overdue   = emp.daysLeft != null && emp.daysLeft < 0;
                      const urgent    = emp.daysLeft != null && emp.daysLeft <= 7 && emp.daysLeft >= 0;
                      return (
                        <div key={emp.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{emp.display_name}</p>
                            <p className="text-sm text-muted-foreground">{emp.designation} · {emp.department} {emp.employee_code ? `· ${emp.employee_code}` : ''}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {emp.date_of_joining && (
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  Joined: {format(new Date(emp.date_of_joining), 'dd MMM yyyy')}
                                </span>
                              )}
                              {emp.probationEndDate && (
                                <span className="text-xs text-gray-500">
                                  Probation ends: {format(emp.probationEndDate, 'dd MMM yyyy')}
                                </span>
                              )}
                              {overdue && <Badge className="bg-red-100 text-red-700 text-xs">Overdue {Math.abs(emp.daysLeft)}d</Badge>}
                              {urgent && !overdue && <Badge className="bg-orange-100 text-orange-700 text-xs">{emp.daysLeft} days left</Badge>}
                              {active && <Badge className="bg-blue-100 text-blue-800 text-xs">Review In Progress</Badge>}
                              {completed && <Badge className="bg-green-100 text-green-800 text-xs">Review Completed</Badge>}
                              {emp.employee_status === 'probation' && !active && !completed && (
                                <Badge className="bg-orange-100 text-orange-800 text-xs">On Probation</Badge>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 flex gap-2">
                            {active && (
                              <span className="text-xs text-blue-600 font-medium self-center">In Progress</span>
                            )}
                            {!active && (isManager || isHR) && (
                              <Button
                                size="sm"
                                onClick={() => isHR ? openInitiate(emp) : openSubmit(emp)}
                                className="flex items-center gap-1"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {isHR ? 'Initiate Review' : 'Submit Review'}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── HR Review tab ── */}
          {isHR && (
            <TabsContent value="hr_review">
              <Card>
                <CardHeader><CardTitle>Reviews Awaiting HR Approval</CardTitle></CardHeader>
                <CardContent>
                  {hrPendingReviews.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No reviews pending HR approval</p>
                  ) : (
                    <div className="space-y-3">
                      {hrPendingReviews.map(review => (
                        <div key={review.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium">{review.employee_name}</p>
                                <Badge className={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{review.department}</p>
                              <p className="text-sm mt-1">
                                Recommendation:{' '}
                                <span className="font-medium">
                                  {review.action === 'confirm' ? 'Confirm'
                                    : review.action === 'extend' ? `Extend until ${review.extended_until ? format(new Date(review.extended_until), 'dd MMM yyyy') : '?'}`
                                    : 'Not Confirm'}
                                </span>
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Avg Score: <span className="font-semibold">{avgScore(review.manager_scores)}/5</span>
                                {' · '}Submitted by: {review.manager_name}
                              </p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button variant="outline" size="sm" onClick={() => setDetailDlg({ open: true, review })}>
                                <FileText className="w-4 h-4 mr-1" /> View
                              </Button>
                              <Button size="sm" onClick={() => openHRReview(review)}>Review</Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Management Approval tab ── */}
          {(isMgmt || isHR) && (
            <TabsContent value="mgmt_approval">
              <Card>
                <CardHeader><CardTitle>Reviews Awaiting Management Decision</CardTitle></CardHeader>
                <CardContent>
                  {mgmtPendingReviews.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No reviews pending management decision</p>
                  ) : (
                    <div className="space-y-3">
                      {mgmtPendingReviews.map(review => (
                        <div key={review.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium">{review.employee_name}</p>
                                <Badge className={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{review.department}</p>
                              <p className="text-sm mt-1">
                                Recommendation:{' '}
                                <span className="font-medium">
                                  {review.action === 'confirm' ? 'Confirm' : review.action === 'extend' ? 'Extend Probation' : 'Not Confirm'}
                                </span>
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Avg Score: <span className="font-semibold">{avgScore(review.manager_scores)}/5</span>
                                {' · '}HR: {review.hr_comments ? '✓ Reviewed' : '—'}
                              </p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button variant="outline" size="sm" onClick={() => setDetailDlg({ open: true, review })}>
                                <FileText className="w-4 h-4 mr-1" /> View
                              </Button>
                              {isMgmt && <Button size="sm" onClick={() => openMgmt(review)}>Decide</Button>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── History tab ── */}
          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle>Confirmation History</CardTitle></CardHeader>
              <CardContent>
                {reviews.filter(r => ['confirmed', 'extended', 'rejected'].includes(r.status)).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No completed reviews yet</p>
                ) : (
                  <div className="space-y-3">
                    {reviews.filter(r => ['confirmed', 'extended', 'rejected'].includes(r.status)).map(review => (
                      <div key={review.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{review.employee_name}</p>
                            <Badge className={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Badge>
                            {review.letter_sent && (
                              <Badge className="bg-teal-100 text-teal-800 text-xs flex items-center gap-1">
                                <Mail className="w-3 h-3" /> Letter Sent
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{review.department}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Avg Score: {avgScore(review.manager_scores)}/5
                            {review.management_reviewed_at && ` · Decided: ${format(new Date(review.management_reviewed_at), 'dd MMM yyyy')}`}
                            {review.letter_sent_at && ` · Letter sent: ${format(new Date(review.letter_sent_at), 'dd MMM yyyy')}`}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => setDetailDlg({ open: true, review })}>
                            <FileText className="w-4 h-4 mr-1" /> View
                          </Button>
                          {['confirmed', 'extended'].includes(review.status) && isHR && (
                            <Button
                              size="sm"
                              variant={review.letter_sent ? 'outline' : 'default'}
                              onClick={() => handleSendLetter(review.id)}
                              disabled={sendingLetter === review.id}
                              className="flex items-center gap-1"
                            >
                              {sendingLetter === review.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Send className="w-3.5 h-3.5" />}
                              {review.letter_sent ? 'Resend Letter' : 'Send Letter'}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Manager Submit Dialog ── */}
      <Dialog open={submitDlg.open} onOpenChange={open => !open && setSubmitDlg({ open: false, emp: null })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Probation Review — {submitDlg.emp?.display_name}</DialogTitle>
          </DialogHeader>
          <ReviewForm form={submitForm} setForm={setSubmitForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDlg({ open: false, emp: null })}>Cancel</Button>
            <Button onClick={handleSubmitReview} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Submit to HR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HR Initiate Dialog ── */}
      <Dialog open={initiateDlg.open} onOpenChange={open => !open && setInitiateDlg({ open: false, emp: null })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Initiate Confirmation Review — {initiateDlg.emp?.display_name}</DialogTitle>
            <p className="text-sm text-gray-500 mt-1">
              As HR, you can directly submit this review to Management for final decision.
            </p>
          </DialogHeader>
          <ReviewForm form={initiateForm} setForm={setInitiateForm} isHRInitiated />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInitiateDlg({ open: false, emp: null })}>Cancel</Button>
            <Button onClick={handleInitiate} disabled={initiating}>
              {initiating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send to Management
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HR Review Dialog ── */}
      <Dialog open={hrDlg.open} onOpenChange={open => !open && setHrDlg({ open: false, review: null })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>HR Review — {hrDlg.review?.employee_name}</DialogTitle>
          </DialogHeader>
          {hrDlg.review && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p>Recommendation: <span className="font-semibold capitalize">{hrDlg.review.action === 'confirm' ? 'Confirm' : hrDlg.review.action === 'extend' ? 'Extend Probation' : 'Not Confirm'}</span></p>
                <p>Average score: <span className="font-semibold">{avgScore(hrDlg.review.manager_scores)}/5</span></p>
                <p>Comments: <span className="italic">{hrDlg.review.manager_comments}</span></p>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-2 block">HR Decision</Label>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setHrForm(f => ({ ...f, hr_action: 'approve' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${hrForm.hr_action === 'approve' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}>
                    Forward to Management
                  </button>
                  <button type="button" onClick={() => setHrForm(f => ({ ...f, hr_action: 'reject' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${hrForm.hr_action === 'reject' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'}`}>
                    Reject
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-1 block">HR Comments</Label>
                <Textarea
                  placeholder="Add comments (attendance records, document verification, etc.)..."
                  value={hrForm.hr_comments}
                  onChange={e => setHrForm(f => ({ ...f, hr_comments: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHrDlg({ open: false, review: null })}>Cancel</Button>
            <Button onClick={handleHRReview} disabled={hrSaving}>
              {hrSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Management Decision Dialog ── */}
      <Dialog open={mgmtDlg.open} onOpenChange={open => !open && setMgmtDlg({ open: false, review: null })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Management Decision — {mgmtDlg.review?.employee_name}</DialogTitle>
          </DialogHeader>
          {mgmtDlg.review && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p>Recommendation: <span className="font-semibold">{mgmtDlg.review.action === 'confirm' ? 'Confirm' : mgmtDlg.review.action === 'extend' ? 'Extend' : 'Not Confirm'}</span></p>
                <p>Average score: <span className="font-semibold">{avgScore(mgmtDlg.review.manager_scores)}/5</span></p>
                {mgmtDlg.review.hr_comments && <p>HR: <span className="italic">{mgmtDlg.review.hr_comments}</span></p>}
              </div>
              <div>
                <Label className="text-sm font-semibold mb-2 block">Final Decision</Label>
                <div className="flex gap-2">
                  {[
                    { value: 'confirmed', label: 'Confirm',  style: 'bg-green-600 text-white border-green-600' },
                    { value: 'extended',  label: 'Extend',   style: 'bg-orange-500 text-white border-orange-500' },
                    { value: 'rejected',  label: 'Reject',   style: 'bg-red-600 text-white border-red-600' },
                  ].map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setMgmtForm(f => ({ ...f, final_action: opt.value }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border ${mgmtForm.final_action === opt.value ? opt.style : 'bg-white text-gray-700 border-gray-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {mgmtForm.final_action === 'extended' && (
                <div>
                  <Label className="text-sm font-semibold mb-1 block">Extend Until</Label>
                  <Input type="date" value={mgmtForm.extended_until}
                    onChange={e => setMgmtForm(f => ({ ...f, extended_until: e.target.value }))}
                    min={format(new Date(), 'yyyy-MM-dd')} />
                </div>
              )}
              <div>
                <Label className="text-sm font-semibold mb-1 block">Management Comments</Label>
                <Textarea
                  placeholder="Add comments for the record..."
                  value={mgmtForm.management_comments}
                  onChange={e => setMgmtForm(f => ({ ...f, management_comments: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMgmtDlg({ open: false, review: null })}>Cancel</Button>
            <Button onClick={handleMgmt} disabled={mgmtSaving}>
              {mgmtSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail View Dialog ── */}
      <Dialog open={detailDlg.open} onOpenChange={open => !open && setDetailDlg({ open: false, review: null })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Detail — {detailDlg.review?.employee_name}</DialogTitle>
          </DialogHeader>
          {detailDlg.review && (() => {
            const r = detailDlg.review;
            return (
              <div className="space-y-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  <span className="text-sm text-muted-foreground">{r.department}</span>
                </div>

                <div>
                  <p className="font-semibold text-sm mb-2">Evaluation</p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <p className="text-sm">Recommendation: <span className="font-medium">
                      {r.action === 'confirm' ? 'Confirm'
                        : r.action === 'extend' ? `Extend until ${r.extended_until ? format(new Date(r.extended_until), 'dd MMM yyyy') : '?'}`
                        : 'Not Confirm'}
                    </span></p>
                    <div className="grid grid-cols-2 gap-1 mt-2">
                      {CRITERIA.map(c => (
                        <div key={c.key} className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 text-xs">{c.label}</span>
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map(n => (
                              <span key={n} className={`w-4 h-4 rounded-sm text-[9px] flex items-center justify-center font-bold ${(r.manager_scores?.[c.key] || 0) >= n ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'}`}>{n}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm mt-1">Average: <span className="font-semibold">{avgScore(r.manager_scores)}/5</span></p>
                    <p className="text-sm text-gray-700 italic mt-1">{r.manager_comments}</p>
                    <p className="text-xs text-gray-400">By: {r.manager_name}</p>
                  </div>
                </div>

                {r.hr_comments && (
                  <div>
                    <p className="font-semibold text-sm mb-2">HR Review</p>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-sm text-gray-700 italic">{r.hr_comments}</p>
                      {r.hr_reviewed_at && <p className="text-xs text-gray-400 mt-1">Reviewed: {format(new Date(r.hr_reviewed_at), 'dd MMM yyyy')}</p>}
                    </div>
                  </div>
                )}

                {r.management_comments && (
                  <div>
                    <p className="font-semibold text-sm mb-2">Management Decision</p>
                    <div className={`rounded-lg p-3 ${r.status === 'confirmed' ? 'bg-green-50' : r.status === 'rejected' ? 'bg-red-50' : 'bg-orange-50'}`}>
                      <p className="text-sm font-medium">{STATUS_LABELS[r.status]}</p>
                      <p className="text-sm text-gray-700 italic mt-1">{r.management_comments}</p>
                      {r.management_reviewed_at && <p className="text-xs text-gray-400 mt-1">Decided: {format(new Date(r.management_reviewed_at), 'dd MMM yyyy')}</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {detailDlg.review && ['confirmed', 'extended'].includes(detailDlg.review.status) && isHR && (
            <div className="pt-4 border-t mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {detailDlg.review.status === 'confirmed' ? 'Confirmation Letter' : 'Probation Extension Letter'}
                  </p>
                  {detailDlg.review.letter_sent && (
                    <p className="text-xs text-teal-600 mt-0.5">
                      ✓ Sent {detailDlg.review.letter_sent_at ? `on ${format(new Date(detailDlg.review.letter_sent_at), 'dd MMM yyyy')}` : ''}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={detailDlg.review.letter_sent ? 'outline' : 'default'}
                  onClick={() => handleSendLetter(detailDlg.review.id)}
                  disabled={sendingLetter === detailDlg.review.id}
                  className="flex items-center gap-1.5"
                >
                  {sendingLetter === detailDlg.review.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />}
                  {detailDlg.review.letter_sent ? 'Resend Letter' : 'Generate & Send Letter'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
