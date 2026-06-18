import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Calendar, Target, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import RatingStars from './RatingStars';

const STATUS_COLORS = {
  pending_acceptance: 'bg-yellow-100 text-yellow-700',
  accepted: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  rejected: 'bg-gray-100 text-gray-600',
};

export default function GoalCard({ goal, onAccept, onReject, onUpdate, isManager, userMap }) {
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(goal.progress_percentage || 0);
  const [comment, setComment] = useState(goal.employee_comment || '');
  const [achievement, setAchievement] = useState(goal.actual_achievement || '');
  const [saving, setSaving] = useState(false);
  const [managerRating, setManagerRating] = useState(goal.manager_rating || 0);
  const [managerComment, setManagerComment] = useState(goal.manager_comment || '');

  const daysLeft = goal.end_date ? Math.ceil((new Date(goal.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;

  const handleSave = async () => {
    setSaving(true);
    const updates = isManager
      ? { manager_rating: managerRating, manager_comment: managerComment }
      : { progress_percentage: progress, employee_comment: comment, actual_achievement: achievement };
    await onUpdate(goal.id, updates);
    setSaving(false);
  };

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      <div className="p-4 flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-800">{goal.title}</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {goal.kra && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">KRA: {goal.kra}</span>}
                {goal.kpi && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">KPI: {goal.kpi}</span>}
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{goal.weightage}% weight</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[goal.status]}`}>
                {goal.status?.replace(/_/g, ' ')}
              </span>
              {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${goal.progress_percentage >= 100 ? 'bg-green-500' : goal.progress_percentage >= 60 ? 'bg-blue-500' : 'bg-orange-400'}`}
                style={{ width: `${Math.min(goal.progress_percentage || 0, 100)}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-gray-700 w-10 text-right">{goal.progress_percentage || 0}%</span>
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            {goal.end_date && (
              <span className={`flex items-center gap-1 ${daysLeft !== null && daysLeft < 0 ? 'text-red-500' : daysLeft !== null && daysLeft <= 7 ? 'text-orange-500' : ''}`}>
                <Calendar className="w-3 h-3" />
                {daysLeft !== null && daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft !== null ? `${daysLeft}d left` : goal.end_date}
              </span>
            )}
            {goal.manager_rating > 0 && <RatingStars value={goal.manager_rating} readonly size="sm" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-gray-50 p-4 space-y-4">
          {goal.description && <p className="text-sm text-gray-600">{goal.description}</p>}
          {goal.measurable_target && (
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm"><span className="font-medium">Target:</span> {goal.measurable_target}</p>
            </div>
          )}

          {/* Employee actions */}
          {!isManager && goal.status === 'pending_acceptance' && (
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onAccept(goal.id)}>Accept Goal</Button>
              <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => onReject(goal.id)}>Reject</Button>
            </div>
          )}

          {!isManager && goal.status !== 'pending_acceptance' && goal.status !== 'rejected' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Progress (%)</label>
                <div className="flex items-center gap-3 mt-1">
                  <input type="range" min="0" max="100" value={progress} onChange={e => setProgress(Number(e.target.value))} className="flex-1" />
                  <span className="text-sm font-bold w-10 text-center">{progress}%</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Actual Achievement</label>
                <textarea className="w-full mt-1 text-sm border rounded-lg p-2 resize-none" rows={2} value={achievement} onChange={e => setAchievement(e.target.value)} placeholder="Describe your actual achievement..." />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Your Comment</label>
                <textarea className="w-full mt-1 text-sm border rounded-lg p-2 resize-none" rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Add comments..." />
              </div>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Update Progress'}</Button>
            </div>
          )}

          {/* Manager actions */}
          {isManager && (
            <div className="space-y-3">
              {goal.actual_achievement && (
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700">Employee Achievement</p>
                  <p className="text-sm text-blue-900 mt-1">{goal.actual_achievement}</p>
                  {goal.employee_comment && <p className="text-xs text-blue-600 mt-1 italic">"{goal.employee_comment}"</p>}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600">Your Rating</label>
                <div className="mt-1"><RatingStars value={managerRating} onChange={setManagerRating} size="lg" /></div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Manager Comment</label>
                <textarea className="w-full mt-1 text-sm border rounded-lg p-2 resize-none" rows={2} value={managerComment} onChange={e => setManagerComment(e.target.value)} placeholder="Feedback for employee..." />
              </div>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Rating'}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}