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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';
import { CheckCircle, XCircle, Clock, AlertTriangle, User, Calendar, Star, ChevronRight, Loader2, FileText, Timer, AlertCircle } from 'lucide-react';

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

function ScoreInput({ value, onChange, disabled }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`w-8 h-8 rounded text-sm font-bold border transition-colors ${
            value >= n
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-400 border-gray-200 hover:border-blue-400'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export default function ConfirmationManagement() {
  const [user, setUser]     = useState(null);
  const [role, setRole]     = useState('');
  const [loading, setLoading] = useState(true);

  // Data
  const [probationEmps, setProbationEmps] = useState([]);  // employees on probation
  const [reviews, setReviews]             = useState([]);   // ProbationReview records

  // Manager submit dialog
  const [submitDlg, setSubmitDlg]   = useState({ open: false, emp: null });
  const [submitForm, setSubmitForm] = useState({ action: 'confirm', extended_until: '', manager_scores: {}, manager_comments: '' });
  const [submitting, setSubmitting] = useState(false);

  // HR review dialog
  const [hrDlg, setHrDlg]     = useState({ open: false, review: null });
  const [hrForm, setHrForm]   = useState({ hr_action: 'approve', hr_comments: '' });
  const [hrSaving, setHrSaving] = useState(false);

  // Management approval dialog
  const [mgmtDlg, setMgmtDlg]     = useState({ open: false, review: null });
  const [mgmtForm, setMgmtForm]   = useState({ final_action: 'confirmed', management_comments: '', extended_until: '' });
  const [mgmtSaving, setMgmtSaving] = useState(false);

  // Detail view dialog
  const [detailDlg, setDetailDlg] = useState({ open: false, review: null });

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

      const today = new Date();
      const onProbation = emps
        .filter(e => e.employee_status === 'probation')
        .map(e => {
          const endDate = e.probation_end_date
            ? new Date(e.probation_end_date)
            : e.date_of_joining
              ? new Date(new Date(e.date_of_joining).getTime() + 180 * 86400000)
              : null;
          const daysLeft = endDate ? differenceInDays(endDate, today) : null;
          return { ...e, probationEndDate: endDate, daysLeft };
        })
        .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

      setProbationEmps(onProbation);
      setReviews(reviewsRes.data?.reviews || []);
    } catch (e) {
      toast.error('Failed to load data: ' + e.message);
    }
    setLoading(false);
  };

  // Check if employee already has an active review
  const hasActiveReview = (userId) =>
    reviews.some(r => r.user_id === userId && ['manager_submitted', 'hr_approved'].includes(r.status));

  // ── Manager: open submit dialog ──
  const openSubmit = (emp) => {
    setSubmitForm({ action: 'confirm', extended_until: '', manager_scores: {}, manager_comments: '' });
    setSubmitDlg({ open: true, emp });
  };

  const handleSubmitReview = async () => {
    const { emp } = submitDlg;
    const missingScores = CRITERIA.filter(c => !submitForm.manager_scores[c.key]);
    if (missingScores.length) { toast.error('Please rate all criteria'); return; }
    if (!submitForm.manager_comments.trim()) { toast.error('Please add comments'); return; }
    if (submitForm.action === 'extend' && !submitForm.extended_until) { toast.error('Please set extension date'); return; }

    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('submitProbationReview', {
        employee_user_id: emp.user_id,
        action: submitForm.action,
        extended_until: submitForm.extended_until,
        manager_scores: submitForm.manager_scores,
        manager_comments: submitForm.manager_comments,
      });
      if (res.data?.success) {
        toast.success('Probation review submitted to HR');
        setSubmitDlg({ open: false, emp: null });
        loadAll();
      } else {
        toast.error(res.data?.error || 'Submission failed');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setSubmitting(false);
  };

  // ── HR: review ──
  const openHRReview = (review) => {
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
    } catch (e) {
      toast.error(e.message);
    }
    setHrSaving(false);
  };

  // ── Management: final approval ──
  const openMgmtApproval = (review) => {
    setMgmtForm({ final_action: review.action === 'confirm' ? 'confirmed' : review.action === 'extend' ? 'extended' : 'rejected', management_comments: '', extended_until: review.extended_until || '' });
    setMgmtDlg({ open: true, review });
  };

  const handleMgmtApproval = async () => {
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
        toast.success('Confirmation decision recorded');
        setMgmtDlg({ open: false, review: null });
        loadAll();
      } else {
        toast.error(res.data?.error || 'Failed');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setMgmtSaving(false);
  };

  const avgScore = (scores) => {
    const vals = Object.values(scores || {}).filter(Boolean);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : '—';
  };

  const isHR = ['hr', 'admin'].includes(role);
  const isMgmt = role === 'management';
  const isManager = role === 'manager';

  // Which reviews the current user can act on
  const hrPendingReviews   = reviews.filter(r => r.status === 'manager_submitted');
  const mgmtPendingReviews = reviews.filter(r => r.status === 'hr_approved');
  const myTeamEmps = isManager
    ? probationEmps.filter(e => e.reporting_manager_id === user?.id)
    : probationEmps;

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="animate-spin w-6 h-6 text-blue-500 mr-2" /> Loading...
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employment Confirmation</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage probation reviews and confirmation approvals</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'On Probation',       value: probationEmps.length,                                  color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'Due ≤ 15 Days',      value: probationEmps.filter(e => e.daysLeft != null && e.daysLeft <= 15 && e.daysLeft >= 0).length, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Pending HR Review',  value: hrPendingReviews.length,                               color: 'text-blue-600',   bg: 'bg-blue-50' },
            { label: 'Pending Management', value: mgmtPendingReviews.length,                             color: 'text-purple-600', bg: 'bg-purple-50' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className={`p-4 text-center ${s.bg} rounded-lg`}>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-600 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue={isManager ? 'my_team' : isHR ? 'hr_review' : 'mgmt_approval'}>
          <TabsList className="flex flex-wrap gap-1 h-auto">
            {(isManager) && <TabsTrigger value="my_team">My Team</TabsTrigger>}
            {(isHR || isMgmt) && <TabsTrigger value="probation_list">All on Probation</TabsTrigger>}
            {(isHR) && <TabsTrigger value="hr_review">HR Review {hrPendingReviews.length > 0 && <Badge className="ml-1 bg-blue-500 text-white text-xs">{hrPendingReviews.length}</Badge>}</TabsTrigger>}
            {(isMgmt || isHR) && <TabsTrigger value="mgmt_approval">Management Approval {mgmtPendingReviews.length > 0 && <Badge className="ml-1 bg-purple-500 text-white text-xs">{mgmtPendingReviews.length}</Badge>}</TabsTrigger>}
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Manager: My Team probation employees */}
          {isManager && (
            <TabsContent value="my_team">
              <Card>
                <CardHeader><CardTitle>Team Members on Probation</CardTitle></CardHeader>
                <CardContent>
                  {myTeamEmps.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No team members on probation</p>
                  ) : (
                    <div className="space-y-3">
                      {myTeamEmps.map(emp => {
                        const active = hasActiveReview(emp.user_id);
                        const overdue = emp.daysLeft != null && emp.daysLeft < 0;
                        const urgent  = emp.daysLeft != null && emp.daysLeft <= 7 && emp.daysLeft >= 0;
                        return (
                          <div key={emp.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                            <div>
                              <p className="font-medium">{emp.display_name}</p>
                              <p className="text-sm text-muted-foreground">{emp.designation} · {emp.department}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                <span className="text-xs text-gray-500">
                                  Probation ends: {emp.probationEndDate ? format(emp.probationEndDate, 'dd MMM yyyy') : 'N/A'}
                                </span>
                                {overdue && <Badge className="bg-red-100 text-red-700 text-xs">Overdue by {Math.abs(emp.daysLeft)} days</Badge>}
                                {urgent && !overdue && <Badge className="bg-orange-100 text-orange-700 text-xs">{emp.daysLeft} days left</Badge>}
                              </div>
                            </div>
                            <div>
                              {active
                                ? <Badge className="bg-blue-100 text-blue-800">Review Submitted</Badge>
                                : <Button size="sm" onClick={() => openSubmit(emp)}>Submit Review</Button>
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* HR/Mgmt: All probation employees */}
          {(isHR || isMgmt) && (
            <TabsContent value="probation_list">
              <Card>
                <CardHeader><CardTitle>All Employees on Probation</CardTitle></CardHeader>
                <CardContent>
                  {probationEmps.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No employees on probation</p>
                  ) : (
                    <div className="space-y-3">
                      {probationEmps.map(emp => {
                        const overdue = emp.daysLeft != null && emp.daysLeft < 0;
                        const urgent  = emp.daysLeft != null && emp.daysLeft <= 15 && emp.daysLeft >= 0;
                        const active  = hasActiveReview(emp.user_id);
                        return (
                          <div key={emp.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                            <div>
                              <p className="font-medium">{emp.display_name}</p>
                              <p className="text-sm text-muted-foreground">{emp.designation} · {emp.department} · {emp.employee_code}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-xs text-gray-500">
                                  Joined: {emp.date_of_joining ? format(new Date(emp.date_of_joining), 'dd MMM yyyy') : 'N/A'}
                                </span>
                                <span className="text-xs text-gray-500">
                                  Probation ends: {emp.probationEndDate ? format(emp.probationEndDate, 'dd MMM yyyy') : 'N/A'}
                                </span>
                                {overdue && <Badge className="bg-red-100 text-red-700 text-xs">Overdue {Math.abs(emp.daysLeft)}d</Badge>}
                                {urgent && !overdue && <Badge className="bg-orange-100 text-orange-700 text-xs">{emp.daysLeft} days left</Badge>}
                                {active && <Badge className="bg-blue-100 text-blue-800 text-xs">Review in Progress</Badge>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* HR Review tab */}
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
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{review.employee_name}</p>
                                <Badge className={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{review.department}</p>
                              <p className="text-sm mt-1">
                                Manager recommendation: <span className="font-medium capitalize">{review.action === 'confirm' ? 'Confirm' : review.action === 'extend' ? 'Extend Probation' : 'Not Confirm'}</span>
                                {review.action === 'extend' && review.extended_until && ` until ${format(new Date(review.extended_until), 'dd MMM yyyy')}`}
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
                              <Button size="sm" onClick={() => openHRReview(review)}>
                                Review
                              </Button>
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

          {/* Management Approval tab */}
          {(isMgmt || isHR) && (
            <TabsContent value="mgmt_approval">
              <Card>
                <CardHeader><CardTitle>Reviews Awaiting Management Approval</CardTitle></CardHeader>
                <CardContent>
                  {mgmtPendingReviews.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No reviews pending management approval</p>
                  ) : (
                    <div className="space-y-3">
                      {mgmtPendingReviews.map(review => (
                        <div key={review.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{review.employee_name}</p>
                                <Badge className={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{review.department}</p>
                              <p className="text-sm mt-1">
                                Manager recommendation: <span className="font-medium capitalize">{review.action === 'confirm' ? 'Confirm' : review.action === 'extend' ? 'Extend Probation' : 'Not Confirm'}</span>
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Avg Score: <span className="font-semibold">{avgScore(review.manager_scores)}/5</span>
                                {' · '}HR: {review.hr_comments ? '✓ Reviewed' : 'Pending'}
                              </p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button variant="outline" size="sm" onClick={() => setDetailDlg({ open: true, review })}>
                                <FileText className="w-4 h-4 mr-1" /> View
                              </Button>
                              {isMgmt && (
                                <Button size="sm" onClick={() => openMgmtApproval(review)}>
                                  Decide
                                </Button>
                              )}
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

          {/* History */}
          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle>Confirmation History</CardTitle></CardHeader>
              <CardContent>
                {reviews.filter(r => ['confirmed','extended','rejected'].includes(r.status)).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No completed reviews yet</p>
                ) : (
                  <div className="space-y-3">
                    {reviews.filter(r => ['confirmed','extended','rejected'].includes(r.status)).map(review => (
                      <div key={review.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{review.employee_name}</p>
                            <Badge className={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{review.department}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Avg Score: {avgScore(review.manager_scores)}/5
                            {review.management_reviewed_at && ` · Decided: ${format(new Date(review.management_reviewed_at), 'dd MMM yyyy')}`}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setDetailDlg({ open: true, review })}>
                          <FileText className="w-4 h-4 mr-1" /> View
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Manager Submit Review Dialog ── */}
      <Dialog open={submitDlg.open} onOpenChange={open => !open && setSubmitDlg({ open: false, emp: null })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Probation Review — {submitDlg.emp?.display_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {/* Recommendation */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Recommendation</Label>
              <div className="flex gap-3">
                {[
                  { value: 'confirm', label: 'Confirm', color: 'bg-green-600 hover:bg-green-700' },
                  { value: 'extend',  label: 'Extend Probation', color: 'bg-orange-500 hover:bg-orange-600' },
                  { value: 'reject',  label: 'Not Confirm', color: 'bg-red-600 hover:bg-red-700' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSubmitForm(f => ({ ...f, action: opt.value }))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                      submitForm.action === opt.value ? opt.color : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {submitForm.action === 'extend' && (
              <div>
                <Label className="text-sm font-semibold mb-1 block">Extend Until</Label>
                <Input
                  type="date"
                  value={submitForm.extended_until}
                  onChange={e => setSubmitForm(f => ({ ...f, extended_until: e.target.value }))}
                  min={format(new Date(), 'yyyy-MM-dd')}
                />
              </div>
            )}

            {/* Performance Scores */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">Performance Evaluation (1 = Poor, 5 = Excellent)</Label>
              <div className="space-y-3">
                {CRITERIA.map(c => (
                  <div key={c.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-700 w-56">{c.label}</span>
                    <ScoreInput
                      value={submitForm.manager_scores[c.key] || 0}
                      onChange={v => setSubmitForm(f => ({ ...f, manager_scores: { ...f.manager_scores, [c.key]: v } }))}
                    />
                    <span className="text-sm font-semibold text-blue-700 w-4">{submitForm.manager_scores[c.key] || ''}</span>
                  </div>
                ))}
              </div>
              {Object.keys(submitForm.manager_scores).length > 0 && (
                <p className="text-sm text-gray-500 mt-2">
                  Average: <span className="font-semibold">{avgScore(submitForm.manager_scores)}/5</span>
                </p>
              )}
            </div>

            {/* Comments */}
            <div>
              <Label className="text-sm font-semibold mb-1 block">Comments & Observations</Label>
              <Textarea
                placeholder="Provide detailed comments about the employee's performance, strengths, and areas of improvement..."
                value={submitForm.manager_comments}
                onChange={e => setSubmitForm(f => ({ ...f, manager_comments: e.target.value }))}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDlg({ open: false, emp: null })}>Cancel</Button>
            <Button onClick={handleSubmitReview} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit to HR
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
                <p>Manager recommendation: <span className="font-semibold capitalize">{hrDlg.review.action === 'confirm' ? 'Confirm' : hrDlg.review.action === 'extend' ? 'Extend Probation' : 'Not Confirm'}</span></p>
                <p>Average score: <span className="font-semibold">{avgScore(hrDlg.review.manager_scores)}/5</span></p>
                <p>Manager comments: <span className="italic">{hrDlg.review.manager_comments}</span></p>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-2 block">HR Decision</Label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setHrForm(f => ({ ...f, hr_action: 'approve' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${hrForm.hr_action === 'approve' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}
                  >
                    Forward to Management
                  </button>
                  <button
                    type="button"
                    onClick={() => setHrForm(f => ({ ...f, hr_action: 'reject' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${hrForm.hr_action === 'reject' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'}`}
                  >
                    Reject
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-1 block">HR Comments</Label>
                <Textarea
                  placeholder="Add HR comments (attendance, records, document verification notes)..."
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
              {hrSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Management Approval Dialog ── */}
      <Dialog open={mgmtDlg.open} onOpenChange={open => !open && setMgmtDlg({ open: false, review: null })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Management Decision — {mgmtDlg.review?.employee_name}</DialogTitle>
          </DialogHeader>
          {mgmtDlg.review && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p>Manager recommendation: <span className="font-semibold capitalize">{mgmtDlg.review.action === 'confirm' ? 'Confirm' : mgmtDlg.review.action === 'extend' ? 'Extend' : 'Not Confirm'}</span></p>
                <p>Average score: <span className="font-semibold">{avgScore(mgmtDlg.review.manager_scores)}/5</span></p>
                <p>HR comments: <span className="italic">{mgmtDlg.review.hr_comments}</span></p>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-2 block">Final Decision</Label>
                <div className="flex gap-2">
                  {[
                    { value: 'confirmed', label: 'Confirm', color: 'bg-green-600 text-white border-green-600' },
                    { value: 'extended',  label: 'Extend',  color: 'bg-orange-500 text-white border-orange-500' },
                    { value: 'rejected',  label: 'Reject',  color: 'bg-red-600 text-white border-red-600' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMgmtForm(f => ({ ...f, final_action: opt.value }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${mgmtForm.final_action === opt.value ? opt.color : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {mgmtForm.final_action === 'extended' && (
                <div>
                  <Label className="text-sm font-semibold mb-1 block">Extend Until</Label>
                  <Input
                    type="date"
                    value={mgmtForm.extended_until}
                    onChange={e => setMgmtForm(f => ({ ...f, extended_until: e.target.value }))}
                    min={format(new Date(), 'yyyy-MM-dd')}
                  />
                </div>
              )}
              <div>
                <Label className="text-sm font-semibold mb-1 block">Management Comments</Label>
                <Textarea
                  placeholder="Add management comments for the record..."
                  value={mgmtForm.management_comments}
                  onChange={e => setMgmtForm(f => ({ ...f, management_comments: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMgmtDlg({ open: false, review: null })}>Cancel</Button>
            <Button onClick={handleMgmtApproval} disabled={mgmtSaving}>
              {mgmtSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
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
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  <span className="text-sm text-muted-foreground">{r.department}</span>
                </div>

                {/* Manager's evaluation */}
                <div>
                  <p className="font-semibold text-sm mb-2">Manager Evaluation</p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <p className="text-sm">Recommendation: <span className="font-medium capitalize">{r.action === 'confirm' ? 'Confirm' : r.action === 'extend' ? `Extend until ${r.extended_until ? format(new Date(r.extended_until), 'dd MMM yyyy') : '?'}` : 'Not Confirm'}</span></p>
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

                {/* HR review */}
                {r.hr_comments && (
                  <div>
                    <p className="font-semibold text-sm mb-2">HR Review</p>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-sm text-gray-700 italic">{r.hr_comments}</p>
                      {r.hr_reviewed_at && <p className="text-xs text-gray-400 mt-1">Reviewed: {format(new Date(r.hr_reviewed_at), 'dd MMM yyyy')}</p>}
                    </div>
                  </div>
                )}

                {/* Management decision */}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
