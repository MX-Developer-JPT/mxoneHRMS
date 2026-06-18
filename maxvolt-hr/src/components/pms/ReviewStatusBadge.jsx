import React from 'react';

const CONFIG = {
  pending_self: { label: 'Pending Self Assessment', color: 'bg-yellow-100 text-yellow-700' },
  pending_manager: { label: 'Pending Manager Review', color: 'bg-blue-100 text-blue-700' },
  pending_360: { label: 'Pending 360° Feedback', color: 'bg-purple-100 text-purple-700' },
  pending_hr: { label: 'Pending HR Approval', color: 'bg-orange-100 text-orange-700' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-600' },
};

const RATING_COLORS = {
  Outstanding: 'bg-emerald-100 text-emerald-700',
  'Exceeds Expectations': 'bg-green-100 text-green-700',
  'Meets Expectations': 'bg-blue-100 text-blue-700',
  'Below Expectations': 'bg-orange-100 text-orange-700',
  Unsatisfactory: 'bg-red-100 text-red-700',
};

export function ReviewStatusBadge({ status }) {
  const cfg = CONFIG[status] || { label: status, color: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>;
}

export function RatingBadge({ rating }) {
  if (!rating) return null;
  const color = RATING_COLORS[rating] || 'bg-gray-100 text-gray-600';
  return <span className={`text-xs px-2 py-1 rounded-full font-semibold ${color}`}>{rating}</span>;
}