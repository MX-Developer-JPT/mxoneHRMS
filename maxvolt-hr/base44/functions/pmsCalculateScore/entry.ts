import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function getRatingLabel(score) {
  if (score >= 4.5) return 'Outstanding';
  if (score >= 3.5) return 'Exceeds Expectations';
  if (score >= 2.5) return 'Meets Expectations';
  if (score >= 1.5) return 'Below Expectations';
  return 'Unsatisfactory';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { review_id } = await req.json();
    if (!review_id) return Response.json({ error: 'review_id required' }, { status: 400 });

    const reviews = await base44.asServiceRole.entities.PerformanceReview.filter({ id: review_id });
    if (!reviews?.length) return Response.json({ error: 'Review not found' }, { status: 404 });
    const review = reviews[0];

    const configs = await base44.asServiceRole.entities.PMSConfiguration.filter({ id: review.review_cycle_id });
    const config = configs?.[0];

    const selfW = (config?.self_assessment_weightage ?? 30) / 100;
    const mgrW = (config?.manager_assessment_weightage ?? 50) / 100;
    const fbW = (config?.feedback_360_weightage ?? 20) / 100;

    // Calculate weighted goal score from manager ratings
    const goals = await base44.asServiceRole.entities.Goal.filter({ employee_user_id: review.employee_user_id, review_cycle_id: review.review_cycle_id });
    let totalWeightage = 0;
    let weightedGoalScore = 0;
    for (const g of goals) {
      if (g.manager_rating && g.weightage) {
        weightedGoalScore += (g.manager_rating * g.weightage);
        totalWeightage += g.weightage;
      }
    }
    const goalScore = totalWeightage > 0 ? weightedGoalScore / totalWeightage : 0;

    const selfScore = review.self_assessment_score || 0;
    const mgrScore = review.manager_assessment_score || goalScore;
    const fbScore = review.feedback_360_score || 0;

    let finalScore;
    if (review.feedback_360_score) {
      finalScore = (selfScore * selfW) + (mgrScore * mgrW) + (fbScore * fbW);
    } else {
      // Redistribute 360 weight between self and manager
      const totalW = selfW + mgrW;
      finalScore = (selfScore * (selfW / totalW)) + (mgrScore * (mgrW / totalW));
    }

    finalScore = Math.round(finalScore * 100) / 100;
    const overallRating = getRatingLabel(finalScore);

    // Determine incentive %
    let incentiveMultiplier = 0;
    if (finalScore >= 4.5) incentiveMultiplier = 0.20;
    else if (finalScore >= 3.5) incentiveMultiplier = 0.15;
    else if (finalScore >= 2.5) incentiveMultiplier = 0.10;
    else if (finalScore >= 1.5) incentiveMultiplier = 0.05;

    const salaryRevision = finalScore >= 3.5 ? (finalScore - 2.5) * 3 : 0;

    await base44.asServiceRole.entities.PerformanceReview.update(review_id, {
      final_score: finalScore,
      overall_rating: overallRating,
      salary_revision_percentage: Math.round(salaryRevision * 10) / 10,
      pip_recommended: finalScore < 2.0
    });

    return Response.json({ success: true, final_score: finalScore, overall_rating: overallRating, salary_revision_percentage: salaryRevision, pip_recommended: finalScore < 2.0 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});