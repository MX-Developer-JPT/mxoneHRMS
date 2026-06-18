import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { target_user_id, mode } = await req.json();
    const userId = target_user_id || user.id;

    const [goals, reviews, pips, feedbacks, configs] = await Promise.all([
      base44.asServiceRole.entities.Goal.filter({ employee_user_id: userId }),
      base44.asServiceRole.entities.PerformanceReview.filter({ employee_user_id: userId }),
      base44.asServiceRole.entities.PerformanceImprovementPlan.filter({ employee_user_id: userId }),
      base44.asServiceRole.entities.PerformanceFeedback.filter({ receiver_user_id: userId }),
      base44.asServiceRole.entities.PMSConfiguration.filter({ is_active: true })
    ]);

    const activeConfig = configs?.[0] || null;
    const activePIP = pips.find(p => p.status === 'active') || null;
    const latestReview = reviews.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0] || null;

    const totalWeightage = goals.filter(g => g.status !== 'rejected').reduce((s, g) => s + (g.weightage || 0), 0);
    const completedGoals = goals.filter(g => g.status === 'completed').length;
    const overdueGoals = goals.filter(g => g.status === 'overdue' || (g.end_date && new Date(g.end_date) < new Date() && g.status !== 'completed')).length;

    // Team analytics (for managers/HR)
    let teamData = null;
    if (mode === 'manager' || mode === 'hr') {
      const filterKey = mode === 'manager' ? 'manager_user_id' : {};
      const teamReviews = mode === 'manager'
        ? await base44.asServiceRole.entities.PerformanceReview.filter({ manager_user_id: userId })
        : await base44.asServiceRole.entities.PerformanceReview.list('-created_date', 200);

      const ratingDist = { Outstanding: 0, 'Exceeds Expectations': 0, 'Meets Expectations': 0, 'Below Expectations': 0, Unsatisfactory: 0 };
      for (const r of teamReviews) {
        if (r.overall_rating && ratingDist[r.overall_rating] !== undefined) ratingDist[r.overall_rating]++;
      }

      const topPerformers = teamReviews.filter(r => r.final_score >= 4.0).sort((a, b) => b.final_score - a.final_score).slice(0, 5);
      const lowPerformers = teamReviews.filter(r => r.final_score < 2.5 && r.final_score > 0).sort((a, b) => a.final_score - b.final_score).slice(0, 5);
      const avgScore = teamReviews.filter(r => r.final_score > 0).reduce((s, r) => s + r.final_score, 0) / (teamReviews.filter(r => r.final_score > 0).length || 1);

      teamData = { rating_distribution: ratingDist, top_performers: topPerformers, low_performers: lowPerformers, avg_score: Math.round(avgScore * 100) / 100, total_reviews: teamReviews.length };
    }

    return Response.json({
      goals,
      reviews,
      active_pip: activePIP,
      latest_review: latestReview,
      active_config: activeConfig,
      stats: {
        total_goals: goals.length,
        completed_goals: completedGoals,
        overdue_goals: overdueGoals,
        total_weightage_assigned: totalWeightage,
        avg_progress: goals.length > 0 ? Math.round(goals.reduce((s, g) => s + (g.progress_percentage || 0), 0) / goals.length) : 0
      },
      team_data: teamData,
      feedbacks
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});