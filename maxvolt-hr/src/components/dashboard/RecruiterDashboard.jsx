import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import {
  Briefcase, UserPlus, Calendar, FileSignature, BarChart3, ChevronRight,
  Clock, CheckCircle2, RefreshCw, Building2, MapPin,
} from 'lucide-react';
import { format, isToday, isFuture, parseISO } from 'date-fns';
import { safeDate, safeTime } from '@/lib/dateUtils';

const PIPELINE_STAGES = [
  { key: 'applied',             label: 'Applied' },
  { key: 'screening',           label: 'Screening' },
  { key: 'interview_scheduled', label: 'Interview Scheduled' },
  { key: 'interviewed',         label: 'Interviewed' },
  { key: 'selected',            label: 'Selected' },
  { key: 'offered',             label: 'Offered' },
];

export default function RecruiterDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadData().catch(e => { console.error('RecruiterDashboard:', e.message); setLoading(false); }); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await loadData(); } catch (e) { console.error('RecruiterDashboard refresh:', e.message); }
    setRefreshing(false);
  };

  const loadData = async () => {
    const [jobReqs, candidates, interviews] = await Promise.all([
      base44.entities.JobRequisition.filter({ status: { $in: ['approved', 'published'] } }, '-created_date', 200).catch(() => []),
      base44.entities.Candidate.list('-created_date', 500).catch(() => []),
      base44.entities.Interview.filter({ status: 'scheduled' }, 'scheduled_date', 200).catch(() => []),
    ]);

    const activeCandidates = candidates.filter(c => !['rejected', 'joined', 'offer_declined'].includes(c.status));
    const pipelineCounts = PIPELINE_STAGES.map(s => ({
      ...s,
      count: activeCandidates.filter(c => c.status === s.key).length,
    }));

    const upcomingInterviews = interviews
      .filter(i => i.scheduled_date && (isToday(parseISO(i.scheduled_date)) || isFuture(parseISO(i.scheduled_date))))
      .sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));
    const todaysInterviews = upcomingInterviews.filter(i => isToday(parseISO(i.scheduled_date)));

    const candidateMap = {};
    candidates.forEach(c => { candidateMap[c.id] = c; });

    const pendingOffers = candidates.filter(c => c.status === 'selected');

    setData({
      openPositions: jobReqs.length,
      openPositionsList: jobReqs.slice(0, 6),
      activeCandidatesCount: activeCandidates.length,
      recentCandidates: candidates.slice(0, 6),
      pipelineCounts,
      upcomingInterviews: upcomingInterviews.slice(0, 6),
      todaysInterviewsCount: todaysInterviews.length,
      candidateMap,
      pendingOffersCount: pendingOffers.length,
      pendingOffers: pendingOffers.slice(0, 5),
    });
    setLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-[3px] border-pink-200 dark:border-pink-900 border-t-pink-600 rounded-full animate-spin" />
    </div>
  );
  if (!data) return <div className="p-8 text-center text-gray-400">Could not load dashboard. Please refresh the page.</div>;

  const maxPipeline = Math.max(...data.pipelineCounts.map(s => s.count), 1);

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Recruiter Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome, {user.display_name || user.full_name} · {format(new Date(), 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing} title="Refresh dashboard" className="flex-shrink-0 mt-1">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to={createPageUrl('JobRequisitions')}>
            <Card className="cursor-pointer hover:shadow-md transition-all group h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/60 rounded-xl flex items-center justify-center">
                    <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </div>
                <p className="text-2xl font-bold text-foreground">{data.openPositions}</p>
                <p className="text-sm text-muted-foreground mt-0.5">Open Positions</p>
              </CardContent>
            </Card>
          </Link>

          <Link to={createPageUrl('Recruitment')}>
            <Card className="cursor-pointer hover:shadow-md transition-all group h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-pink-100 dark:bg-pink-950/60 rounded-xl flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </div>
                <p className="text-2xl font-bold text-foreground">{data.activeCandidatesCount}</p>
                <p className="text-sm text-muted-foreground mt-0.5">Active Candidates</p>
              </CardContent>
            </Card>
          </Link>

          <Link to={createPageUrl('InterviewManagement')}>
            <Card className="cursor-pointer hover:shadow-md transition-all group h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950/60 rounded-xl flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  {data.todaysInterviewsCount > 0 && <Badge className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs border-0">Today</Badge>}
                </div>
                <p className="text-2xl font-bold text-foreground">{data.upcomingInterviews.length}</p>
                <p className="text-sm text-muted-foreground mt-0.5">Upcoming Interviews</p>
              </CardContent>
            </Card>
          </Link>

          <Link to={createPageUrl('OfferLetters')}>
            <Card className={`cursor-pointer hover:shadow-md transition-all group h-full ${data.pendingOffersCount > 0 ? 'ring-1 ring-amber-400 dark:ring-amber-700' : ''}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/60 rounded-xl flex items-center justify-center">
                    <FileSignature className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </div>
                <p className="text-2xl font-bold text-foreground">{data.pendingOffersCount}</p>
                <p className="text-sm text-muted-foreground mt-0.5">Awaiting Offer</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Detail Cards Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Candidate Pipeline */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Candidate Pipeline
                <Link to={createPageUrl('Recruitment')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.pipelineCounts.map(s => (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-40 shrink-0">{s.label}</span>
                    <div className="flex-1 bg-muted rounded-full h-2.5">
                      <div className="bg-pink-500 h-2.5 rounded-full transition-all" style={{ width: `${(s.count / maxPipeline) * 100}%` }} />
                    </div>
                    <span className="text-sm font-semibold text-foreground w-6 text-right">{s.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: 'Requisitions', icon: Briefcase,     page: 'JobRequisitions',    bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60' },
                { label: 'Candidates',   icon: UserPlus,      page: 'Recruitment',         bg: 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-950/60' },
                { label: 'Interviews',   icon: Calendar,      page: 'InterviewManagement', bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/60' },
                { label: 'Offer Letters',icon: FileSignature, page: 'OfferLetters',        bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60' },
                { label: 'Analytics',    icon: BarChart3,     page: 'RecruitmentAnalytics',bg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950/60' },
              ].map(a => {
                const Icon = a.icon;
                return (
                  <Link key={a.page} to={createPageUrl(a.page)}>
                    <div className={`p-3 rounded-xl flex items-center gap-2 cursor-pointer transition-colors ${a.bg}`}>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-medium">{a.label}</span>
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          {/* Open Positions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Open Positions
                <Link to={createPageUrl('JobRequisitions')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.openPositionsList.length > 0 ? (
                <div className="space-y-2">
                  {data.openPositionsList.map(jr => (
                    <div key={jr.id} className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{jr.position_title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> {jr.department} · {jr.number_of_positions || 1} opening(s)
                        </p>
                      </div>
                      <Badge className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 capitalize border-0 shrink-0">{jr.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Briefcase className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-muted-foreground text-sm">No open positions</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Interviews */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Upcoming Interviews
                <Link to={createPageUrl('InterviewManagement')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.upcomingInterviews.length > 0 ? (
                <div className="space-y-2">
                  {data.upcomingInterviews.map(iv => {
                    const cand = data.candidateMap[iv.candidate_id];
                    return (
                      <div key={iv.id} className="flex items-center justify-between p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{cand?.full_name || 'Candidate'}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {safeDate(iv.scheduled_date, 'MMM d')} · {safeTime(iv.scheduled_date)}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize shrink-0">{iv.round_type || 'Round ' + (iv.round_number || 1)}</Badge>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Calendar className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-muted-foreground text-sm">No interviews scheduled</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Candidates */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Recent Candidates
                <Link to={createPageUrl('Recruitment')} className="text-sm text-primary font-normal hover:underline">View →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentCandidates.length > 0 ? (
                <div className="space-y-2">
                  {data.recentCandidates.map(c => (
                    <div key={c.id} className="flex items-start justify-between p-2 rounded-lg bg-pink-50 dark:bg-pink-950/40">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.position_applied}</p>
                      </div>
                      <Badge className="text-xs capitalize bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300 shrink-0 border-0">{c.status?.replace(/_/g, ' ')}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <UserPlus className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-muted-foreground text-sm">No candidates yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Pending Offers */}
        {data.pendingOffers.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between text-foreground">
                Selected — Awaiting Offer Letter
                <Link to={createPageUrl('OfferLetters')} className="text-sm text-primary font-normal hover:underline">Send Offers →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              {data.pendingOffers.map(c => (
                <div key={c.id} className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{c.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.position_applied}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
