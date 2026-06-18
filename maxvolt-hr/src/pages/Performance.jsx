import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, TrendingUp, Award } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export default function Performance() {
  const [user, setUser] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const performanceReviews = await base44.entities.Performance.filter(
        { user_id: currentUser.id },
        '-review_date'
      );
      setReviews(performanceReviews);
      setLoading(false);
    } catch (error) {
      console.error('Error loading performance:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const latestReview = reviews[0];

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800',
    submitted: 'bg-blue-100 text-blue-800',
    acknowledged: 'bg-green-100 text-green-800'
  };

  const getRatingColor = (rating) => {
    if (rating >= 4.5) return 'text-green-600';
    if (rating >= 3.5) return 'text-blue-600';
    if (rating >= 2.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Performance</h1>
          <p className="text-gray-600 mt-1">View your performance reviews and ratings</p>
        </div>

        {latestReview && (
          <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-2xl">Latest Review</CardTitle>
                  <p className="text-gray-600">{latestReview.review_period}</p>
                </div>
                <Badge className={statusColors[latestReview.status]}>
                  {latestReview.status.toUpperCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="p-6 bg-white rounded-xl shadow-sm border-2 border-blue-200">
                  <div className="flex items-center gap-3">
                    <Award className="w-8 h-8 text-blue-600" />
                    <div>
                      <p className="text-sm text-gray-600">Overall Rating</p>
                      <p className={`text-4xl font-bold ${getRatingColor(latestReview.overall_rating)}`}>
                        {latestReview.overall_rating?.toFixed(1) || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                  {latestReview.technical_skills && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Technical Skills</p>
                      <div className="flex items-center gap-2">
                        <Progress value={latestReview.technical_skills * 20} className="h-2" />
                        <span className="font-semibold">{latestReview.technical_skills}</span>
                      </div>
                    </div>
                  )}
                  {latestReview.communication && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Communication</p>
                      <div className="flex items-center gap-2">
                        <Progress value={latestReview.communication * 20} className="h-2" />
                        <span className="font-semibold">{latestReview.communication}</span>
                      </div>
                    </div>
                  )}
                  {latestReview.teamwork && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Teamwork</p>
                      <div className="flex items-center gap-2">
                        <Progress value={latestReview.teamwork * 20} className="h-2" />
                        <span className="font-semibold">{latestReview.teamwork}</span>
                      </div>
                    </div>
                  )}
                  {latestReview.leadership && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Leadership</p>
                      <div className="flex items-center gap-2">
                        <Progress value={latestReview.leadership * 20} className="h-2" />
                        <span className="font-semibold">{latestReview.leadership}</span>
                      </div>
                    </div>
                  )}
                  {latestReview.problem_solving && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Problem Solving</p>
                      <div className="flex items-center gap-2">
                        <Progress value={latestReview.problem_solving * 20} className="h-2" />
                        <span className="font-semibold">{latestReview.problem_solving}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {latestReview.strengths && (
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="font-semibold text-green-800 mb-2">Strengths</p>
                    <p className="text-sm text-gray-700">{latestReview.strengths}</p>
                  </div>
                )}
                {latestReview.areas_of_improvement && (
                  <div className="p-4 bg-yellow-50 rounded-lg">
                    <p className="font-semibold text-yellow-800 mb-2">Areas of Improvement</p>
                    <p className="text-sm text-gray-700">{latestReview.areas_of_improvement}</p>
                  </div>
                )}
              </div>

              {latestReview.goals_next_period && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="font-semibold text-blue-800 mb-2">Goals for Next Period</p>
                  <p className="text-sm text-gray-700">{latestReview.goals_next_period}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Performance History</CardTitle>
          </CardHeader>
          <CardContent>
            {reviews.length > 0 ? (
              <div className="space-y-4">
                {reviews.map(review => (
                  <div key={review.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <p className="font-semibold">{review.review_period}</p>
                        <Badge className={statusColors[review.status]}>
                          {review.status.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Overall Rating</p>
                        <p className={`text-3xl font-bold ${getRatingColor(review.overall_rating)}`}>
                          {review.overall_rating?.toFixed(1) || 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Target className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-500">No performance reviews yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}