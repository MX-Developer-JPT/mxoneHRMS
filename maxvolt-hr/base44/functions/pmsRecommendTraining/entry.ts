import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { employee_user_id, review_id } = await req.json();

    const [goals, reviews, programs] = await Promise.all([
      base44.asServiceRole.entities.Goal.filter({ employee_user_id }),
      base44.asServiceRole.entities.PerformanceReview.filter({ employee_user_id }),
      base44.asServiceRole.entities.TrainingProgram.filter({ status: 'published' })
    ]);

    const latestReview = reviews.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];
    const lowGoals = goals.filter(g => g.manager_rating && g.manager_rating < 3);

    const prompt = `You are an HR training specialist for an Indian organization. Based on performance data, recommend specific training programs.

Employee Performance Data:
- Overall Rating: ${latestReview?.overall_rating || 'Not yet reviewed'}
- Final Score: ${latestReview?.final_score || 'N/A'}/5
- Manager Comment: ${latestReview?.manager_assessment_comment || 'None'}
- Low-rated Goals (below 3/5): ${lowGoals.map(g => `${g.title} (KRA: ${g.kra}, Rating: ${g.manager_rating})`).join(', ') || 'None'}
- All Goals: ${goals.map(g => `${g.title} (KPI: ${g.kpi})`).join(', ')}

Available Training Programs: ${programs.map(p => `${p.title} (Category: ${p.category})`).join(', ') || 'No programs listed'}

Provide 3-5 specific training recommendations with:
1. Training topic
2. Why it addresses the gap
3. Priority (High/Medium/Low)
4. Suggested timeline

Format as a concise, actionable list.`;

    const recommendations = await base44.integrations.Core.InvokeLLM({ prompt });

    if (review_id) {
      await base44.asServiceRole.entities.PerformanceReview.update(review_id, {
        training_recommendations: [recommendations]
      });
    }

    return Response.json({ recommendations, low_rated_goals: lowGoals });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});