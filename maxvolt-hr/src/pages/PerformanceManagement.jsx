import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Target, Users, TrendingUp, AlertTriangle, CheckCircle, Clock, Plus, RefreshCw, Star, BookOpen } from 'lucide-react';
import PMSStatCard from '@/components/pms/PMSStatCard';
import GoalCard from '@/components/pms/GoalCard';
import GoalAssignForm from '@/components/pms/GoalAssignForm';
import { ReviewStatusBadge, RatingBadge } from '@/components/pms/ReviewStatusBadge';
import { RatingDistributionChart, TopPerformersChart } from '@/components/pms/TeamPerformanceChart';
import RatingStars from '@/components/pms/RatingStars';
import UnderDevelopmentBanner from '@/components/UnderDevelopmentBanner';

export default function PerformanceManagement() {
  const [user, setUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [goals, setGoals] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [teamData, setTeamData] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [pips, setPips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [dashData, setDashData] = useState(null);

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    const u = await base44.auth.me();
    setUser(u);
    const isHR = u.role === 'admin' || u.role === 'hr';
    const isMgr = u.role === 'management' || isHR;

    const [emps, configsRes] = await Promise.all([
      isMgr ? base44.entities.Employee.filter({ status: 'active' }) : Promise.resolve([]),
      base44.entities.PMSConfiguration.list('-created_date', 20)
    ]);
    setEmployees(emps || []);
    setConfigs(configsRes || []);

    // Only HR/managers can call getAllUsers
    if (isMgr) {
      const usersRes = await base44.functions.invoke('getAllUsers', {});
      setUsers(usersRes?.data?.users || []);
    } else {
      // For employees, just use their own user info for the userMap
      setUsers([{ id: u.id, full_name: u.full_name, email: u.email }]);
    }

    const mode = isHR ? 'hr' : isMgr ? 'manager' : 'employee';
    const dashRes = await base44.functions.invoke('pmsGetDashboard', { target_user_id: u.id, mode });
    const d = dashRes?.data || dashRes;
    setDashData(d);
    setGoals(d?.goals || []);
    setReviews(d?.reviews || []);
    setTeamData(d?.team_data);
    setPips(d?.active_pip ? [d.active_pip] : []);
    setLoading(false);
  };

  const userMap = {};
  for (const u of users) userMap[u.id] = u;

  const isHR = user?.role === 'admin' || user?.role === 'hr';
  const isMgr = user?.role === 'management' || isHR;

  const handleAssignGoal = async (form) => {
    await base44.entities.Goal.create({ ...form, manager_user_id: user.id, status: 'pending_acceptance' });
    setShowGoalForm(false);
    await init();
  };

  const handleGoalUpdate = async (goalId, updates) => {
    await base44.entities.Goal.update(goalId, updates);
    await init();
  };

  const handleAcceptGoal = async (goalId) => {
    await base44.entities.Goal.update(goalId, { status: 'in_progress' });
    await init();
  };

  const handleRejectGoal = async (goalId) => {
    const reason = prompt('Reason for rejection:');
    if (reason !== null) {
      await base44.entities.Goal.update(goalId, { status: 'rejected', rejection_reason: reason });
      await init();
    }
  };

  const handleInitiateReview = async (employeeUserId) => {
    const activeConfig = configs.find(c => c.is_active);
    await base44.entities.PerformanceReview.create({
      employee_user_id: employeeUserId,
      manager_user_id: user.id,
      review_cycle_id: activeConfig?.id || 'manual',
      review_period_start: activeConfig?.review_period_start || new Date().toISOString().split('T')[0],
      review_period_end: activeConfig?.review_period_end || new Date().toISOString().split('T')[0],
      status: 'pending_self'
    });
    await init();
  };

  const handleSubmitSelfAssessment = async (review, score, comment) => {
    await base44.entities.PerformanceReview.update(review.id, {
      self_assessment_score: score,
      self_assessment_comment: comment,
      self_submitted_at: new Date().toISOString(),
      status: 'pending_manager'
    });
    await init();
  };

  const handleSubmitManagerReview = async (review, score, comment) => {
    await base44.entities.PerformanceReview.update(review.id, {
      manager_assessment_score: score,
      manager_assessment_comment: comment,
      manager_submitted_at: new Date().toISOString(),
      status: review.review_cycle_id ? 'pending_hr' : 'completed'
    });
    const r = await base44.functions.invoke('pmsCalculateScore', { review_id: review.id });
    await init();
  };

  const handleApproveReview = async (review) => {
    await base44.entities.PerformanceReview.update(review.id, {
      status: 'completed',
      approved_by: user.id,
      approved_at: new Date().toISOString()
    });
    await init();
  };

  const pendingReviews = reviews.filter(r => r.status !== 'completed');
  const completedReviews = reviews.filter(r => r.status === 'completed');
  const pendingGoals = goals.filter(g => g.status === 'pending_acceptance');
  const activeGoals = goals.filter(g => ['accepted', 'in_progress'].includes(g.status));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <UnderDevelopmentBanner pageName="Performance Management" />
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Performance Management</h1>
            <p className="text-xs text-gray-500">Goals · Appraisals · PIP · Analytics</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isMgr && (
            <Button onClick={() => setShowGoalForm(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
              <Plus className="w-4 h-4" /> Assign Goal
            </Button>
          )}
          <Button variant="outline" onClick={init} size="icon"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="p-6 max-w-screen-xl mx-auto space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <PMSStatCard title="Total Goals" value={dashData?.stats?.total_goals || 0} sub={`${dashData?.stats?.avg_progress || 0}% avg progress`} icon={Target} color="indigo" />
          <PMSStatCard title="Completed Goals" value={dashData?.stats?.completed_goals || 0} sub="This cycle" icon={CheckCircle} color="green" />
          <PMSStatCard title="Overdue Goals" value={dashData?.stats?.overdue_goals || 0} sub="Needs attention" icon={AlertTriangle} color={dashData?.stats?.overdue_goals > 0 ? 'red' : 'green'} />
          <PMSStatCard
            title={isMgr ? 'Team Reviews' : 'My Reviews'}
            value={reviews.length}
            sub={`${completedReviews.length} completed`}
            icon={Star}
            color="purple"
          />
        </div>

        {/* Active PIP Alert */}
        {dashData?.active_pip && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-orange-800">Active Performance Improvement Plan</p>
              <p className="text-sm text-orange-600">
                PIP runs until {new Date(dashData.active_pip.end_date).toLocaleDateString('en-IN')} — {dashData.active_pip.pip_goals?.length || 0} improvement goals defined
              </p>
            </div>
            <Button size="sm" variant="outline" className="ml-auto border-orange-300 text-orange-700" onClick={() => window.location.href = '/PIPManagement'}>
              View PIP
            </Button>
          </div>
        )}

        <Tabs defaultValue="goals">
          <TabsList className="bg-white border">
            <TabsTrigger value="goals">Goals & KPIs</TabsTrigger>
            <TabsTrigger value="appraisals">Appraisals</TabsTrigger>
            {isMgr && <TabsTrigger value="team">Team Analytics</TabsTrigger>}
            {isMgr && <TabsTrigger value="pip">PIP Management</TabsTrigger>}
          </TabsList>

          {/* GOALS TAB */}
          <TabsContent value="goals" className="mt-4 space-y-4">
            {pendingGoals.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-yellow-700 mb-2 flex items-center gap-1"><Clock className="w-4 h-4" /> Pending Acceptance ({pendingGoals.length})</h3>
                <div className="space-y-3">
                  {pendingGoals.map(g => (
                    <GoalCard key={g.id} goal={g} isManager={isMgr} userMap={userMap} onUpdate={handleGoalUpdate} onAccept={handleAcceptGoal} onReject={handleRejectGoal} />
                  ))}
                </div>
              </div>
            )}

            {isMgr && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">My Team's Goals</h3>
                <TeamGoalsView managerId={user?.id} userMap={userMap} employees={employees} onUpdate={handleGoalUpdate} />
              </div>
            )}

            {!isMgr && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Active Goals ({activeGoals.length})</h3>
                <div className="space-y-3">
                  {activeGoals.map(g => (
                    <GoalCard key={g.id} goal={g} isManager={false} userMap={userMap} onUpdate={handleGoalUpdate} onAccept={handleAcceptGoal} onReject={handleRejectGoal} />
                  ))}
                  {activeGoals.length === 0 && <EmptyState icon={Target} text="No active goals assigned yet." />}
                </div>

                {goals.filter(g => g.status === 'completed').length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold text-green-700 mb-2">Completed Goals</h3>
                    <div className="space-y-3">
                      {goals.filter(g => g.status === 'completed').map(g => (
                        <GoalCard key={g.id} goal={g} isManager={false} userMap={userMap} onUpdate={handleGoalUpdate} onAccept={handleAcceptGoal} onReject={handleRejectGoal} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* APPRAISALS TAB */}
          <TabsContent value="appraisals" className="mt-4">
            <div className="space-y-4">
              {isMgr && (
                <div className="bg-white rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-800">Initiate Appraisal Review</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {employees.filter(e => e.reporting_manager_id === user?.id || isHR).slice(0, 9).map(emp => {
                      const u = userMap[emp.user_id];
                      const hasReview = reviews.some(r => r.employee_user_id === emp.user_id);
                      return (
                        <div key={emp.id} className="border rounded-lg p-3 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{u?.full_name || 'N/A'}</p>
                            <p className="text-xs text-gray-400">{emp.designation}</p>
                          </div>
                          {hasReview
                            ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Review Active</span>
                            : <Button size="sm" variant="outline" className="text-xs" onClick={() => handleInitiateReview(emp.user_id)}>Start Review</Button>
                          }
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {pendingReviews.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Active Reviews</h3>
                  <div className="space-y-3">
                    {pendingReviews.map(r => (
                      <ReviewCard
                        key={r.id}
                        review={r}
                        user={user}
                        userMap={userMap}
                        isManager={isMgr}
                        isHR={isHR}
                        onSubmitSelf={handleSubmitSelfAssessment}
                        onSubmitManager={handleSubmitManagerReview}
                        onApprove={handleApproveReview}
                      />
                    ))}
                  </div>
                </div>
              )}

              {completedReviews.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-green-700 mb-3">Completed Reviews</h3>
                  <div className="space-y-3">
                    {completedReviews.map(r => (
                      <ReviewCard key={r.id} review={r} user={user} userMap={userMap} isManager={isMgr} isHR={isHR} readonly />
                    ))}
                  </div>
                </div>
              )}

              {reviews.length === 0 && <EmptyState icon={Star} text="No appraisal reviews yet." />}
            </div>
          </TabsContent>

          {/* TEAM ANALYTICS */}
          {isMgr && (
            <TabsContent value="team" className="mt-4">
              {teamData ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-800 mb-1">Rating Distribution</h3>
                    <p className="text-xs text-gray-400 mb-3">Overall team performance</p>
                    <RatingDistributionChart data={teamData.rating_distribution} />
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <div className="text-center"><p className="text-2xl font-bold text-indigo-600">{teamData.total_reviews}</p><p className="text-xs text-gray-400">Total Reviews</p></div>
                      <div className="text-center"><p className="text-2xl font-bold text-green-600">{teamData.avg_score?.toFixed(2) || '—'}</p><p className="text-xs text-gray-400">Avg Score</p></div>
                      <div className="text-center"><p className="text-2xl font-bold text-red-500">{teamData.low_performers?.length || 0}</p><p className="text-xs text-gray-400">Low Performers</p></div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-800 mb-1">Top Performers</h3>
                    <p className="text-xs text-gray-400 mb-3">Score ≥ 4.0</p>
                    <TopPerformersChart performers={teamData.top_performers} userMap={userMap} />
                  </div>

                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Top Performers</h3>
                    <div className="space-y-2">
                      {(teamData.top_performers || []).map((r, i) => (
                        <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-bold">{i + 1}</span>
                            <div>
                              <p className="font-medium text-sm">{userMap[r.employee_user_id]?.full_name || 'N/A'}</p>
                              <RatingBadge rating={r.overall_rating} />
                            </div>
                          </div>
                          <span className="text-lg font-bold text-green-600">{r.final_score?.toFixed(2)}</span>
                        </div>
                      ))}
                      {(!teamData.top_performers?.length) && <p className="text-sm text-gray-400">No completed reviews yet</p>}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> Needs Attention</h3>
                    <div className="space-y-2">
                      {(teamData.low_performers || []).map(r => (
                        <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div>
                            <p className="font-medium text-sm">{userMap[r.employee_user_id]?.full_name || 'N/A'}</p>
                            <RatingBadge rating={r.overall_rating} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-red-500">{r.final_score?.toFixed(2)}</span>
                            <Button size="sm" variant="outline" className="text-xs text-orange-600 border-orange-200" onClick={() => window.location.href = '/PIPManagement'}>Start PIP</Button>
                          </div>
                        </div>
                      ))}
                      {(!teamData.low_performers?.length) && <p className="text-sm text-gray-400 flex items-center gap-1"><CheckCircle className="w-4 h-4 text-green-500" /> No low performers — great!</p>}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState icon={TrendingUp} text="Complete some reviews to see team analytics." />
              )}
            </TabsContent>
          )}

          {/* PIP TAB */}
          {isMgr && (
            <TabsContent value="pip" className="mt-4">
              <div className="bg-white rounded-xl border p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-800">Performance Improvement Plans</h3>
                  <Button variant="outline" onClick={() => window.location.href = '/PIPManagement'} className="text-sm gap-1">
                    <AlertTriangle className="w-4 h-4" /> Manage PIPs
                  </Button>
                </div>
                <p className="text-sm text-gray-500">Navigate to the dedicated PIP Management page to create and manage improvement plans for underperforming employees.</p>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {showGoalForm && (
        <GoalAssignForm
          employees={employees}
          users={users}
          reviewCycles={configs}
          onSave={handleAssignGoal}
          onClose={() => setShowGoalForm(false)}
        />
      )}
    </div>
  );
}

// Inline review card component
function ReviewCard({ review, user, userMap, isManager, isHR, onSubmitSelf, onSubmitManager, onApprove, readonly }) {
  const [selfScore, setSelfScore] = useState(review.self_assessment_score || 0);
  const [selfComment, setSelfComment] = useState(review.self_assessment_comment || '');
  const [mgrScore, setMgrScore] = useState(review.manager_assessment_score || 0);
  const [mgrComment, setMgrComment] = useState(review.manager_assessment_comment || '');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(!readonly);

  const isMyReview = review.employee_user_id === user?.id;
  const isMyDirectReport = review.manager_user_id === user?.id;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
            {userMap[review.employee_user_id]?.full_name?.charAt(0) || '?'}
          </div>
          <div>
            <p className="font-semibold text-gray-800">{userMap[review.employee_user_id]?.full_name || 'N/A'}</p>
            <p className="text-xs text-gray-400">Period: {review.review_period_start} — {review.review_period_end}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {review.final_score > 0 && <span className="text-lg font-bold text-indigo-600">{review.final_score?.toFixed(2)}/5</span>}
          <RatingBadge rating={review.overall_rating} />
          <ReviewStatusBadge status={review.status} />
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-gray-50 p-4 space-y-4">
          {/* Self Assessment */}
          <div className="bg-white rounded-lg border p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Self Assessment</h4>
            {isMyReview && review.status === 'pending_self' && !readonly ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Your Rating</label>
                  <div className="mt-1"><RatingStars value={selfScore} onChange={setSelfScore} size="lg" /></div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Self Assessment Comment</label>
                  <textarea className="w-full mt-1 border rounded-lg p-2 text-sm resize-none" rows={3} value={selfComment} onChange={e => setSelfComment(e.target.value)} placeholder="Describe your performance, achievements, and areas for improvement..." />
                </div>
                <Button size="sm" disabled={submitting || selfScore === 0} onClick={async () => { setSubmitting(true); await onSubmitSelf(review, selfScore, selfComment); setSubmitting(false); }}>
                  {submitting ? 'Submitting...' : 'Submit Self Assessment'}
                </Button>
              </div>
            ) : review.self_assessment_score > 0 ? (
              <div>
                <RatingStars value={review.self_assessment_score} readonly />
                <p className="text-sm text-gray-600 mt-2">{review.self_assessment_comment || 'No comment'}</p>
              </div>
            ) : <p className="text-sm text-gray-400">Awaiting employee self assessment</p>}
          </div>

          {/* Manager Review */}
          {(review.status !== 'pending_self' || review.manager_assessment_score > 0) && (
            <div className="bg-white rounded-lg border p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Manager Evaluation</h4>
              {isMyDirectReport && review.status === 'pending_manager' && !readonly ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500">Your Rating</label>
                    <div className="mt-1"><RatingStars value={mgrScore} onChange={setMgrScore} size="lg" /></div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Manager Feedback</label>
                    <textarea className="w-full mt-1 border rounded-lg p-2 text-sm resize-none" rows={3} value={mgrComment} onChange={e => setMgrComment(e.target.value)} placeholder="Provide constructive feedback..." />
                  </div>
                  <Button size="sm" disabled={submitting || mgrScore === 0} onClick={async () => { setSubmitting(true); await onSubmitManager(review, mgrScore, mgrComment); setSubmitting(false); }}>
                    {submitting ? 'Submitting...' : 'Submit Manager Review'}
                  </Button>
                </div>
              ) : review.manager_assessment_score > 0 ? (
                <div>
                  <RatingStars value={review.manager_assessment_score} readonly />
                  <p className="text-sm text-gray-600 mt-2">{review.manager_assessment_comment || 'No comment'}</p>
                </div>
              ) : <p className="text-sm text-gray-400">Awaiting manager review</p>}
            </div>
          )}

          {/* HR Approval */}
          {isHR && review.status === 'pending_hr' && !readonly && (
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onApprove(review)}>Approve & Complete</Button>
            </div>
          )}

          {/* Final Score */}
          {review.final_score > 0 && (
            <div className="bg-indigo-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-indigo-600 uppercase">Final Score</p>
                  <p className="text-3xl font-bold text-indigo-700">{review.final_score?.toFixed(2)}<span className="text-base font-normal text-indigo-400">/5</span></p>
                  <RatingBadge rating={review.overall_rating} />
                </div>
                <div className="text-right text-sm text-indigo-700">
                  {review.salary_revision_percentage > 0 && <p>Salary Revision: <strong>+{review.salary_revision_percentage?.toFixed(1)}%</strong></p>}
                  {review.pip_recommended && <p className="text-orange-600 font-medium">⚠ PIP Recommended</p>}
                  {review.promotion_recommended && <p className="text-green-600 font-medium">✓ Promotion Recommended</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamGoalsView({ managerId, userMap, employees, onUpdate }) {
  const [teamGoals, setTeamGoals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Goal.filter({ manager_user_id: managerId }).then(g => { setTeamGoals(g || []); setLoading(false); });
  }, [managerId]);

  if (loading) return <div className="text-sm text-gray-400">Loading team goals...</div>;
  if (!teamGoals.length) return <EmptyState icon={Target} text="No goals assigned to your team yet." />;

  const byEmployee = {};
  for (const g of teamGoals) {
    if (!byEmployee[g.employee_user_id]) byEmployee[g.employee_user_id] = [];
    byEmployee[g.employee_user_id].push(g);
  }

  return (
    <div className="space-y-6">
      {Object.entries(byEmployee).map(([uid, goals]) => (
        <div key={uid}>
          <p className="font-semibold text-gray-700 mb-2">{userMap[uid]?.full_name || uid}</p>
          <div className="space-y-2">
            {goals.map(g => <GoalCard key={g.id} goal={g} isManager userMap={userMap} onUpdate={onUpdate} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="text-center py-12 text-gray-400 bg-white rounded-xl border">
      <Icon className="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
}