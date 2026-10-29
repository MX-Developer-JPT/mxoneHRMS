import { useState } from 'react';
import { Star } from 'lucide-react';

export const REL_LABEL = { self: 'Self', manager: 'Manager', peer: 'Peers', direct_report: 'Direct reports' };
// What the person giving feedback IS to the colleague (the dropdown wording).
export const GIVER_ROLES = [
  { value: 'peer', label: 'A peer (we work side by side)' },
  { value: 'manager', label: 'Their manager (they report to me)' },
  { value: 'direct_report', label: 'Their direct report (I report to them)' },
];

export const scoreColor = (s) => (s == null ? 'bg-gray-200' : s >= 4 ? 'bg-green-500' : s >= 3 ? 'bg-blue-500' : s >= 2 ? 'bg-yellow-500' : 'bg-red-400');
export const scoreText = (s) => (s == null ? 'text-gray-400' : s >= 4 ? 'text-green-700' : s >= 3 ? 'text-blue-700' : s >= 2 ? 'text-yellow-700' : 'text-red-600');

export function StarRating({ value, onChange, size = 'w-7 h-7' }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-0.5" role="radiogroup">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} onClick={() => onChange(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} className="p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
          <Star className={`${size} transition-colors ${n <= (hover || value) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-sm text-gray-500">{value}/5</span>}
    </div>
  );
}

// A 0–5 bar. `marker` (optional) draws a second value on the same bar — used for the self-assessment next to what others said.
export function ScoreBar({ score, marker, max = 5 }) {
  const pct = score == null ? 0 : Math.round((score / max) * 100);
  return (
    <div className="relative h-3 bg-gray-100 rounded-full">
      <div className={`h-full ${scoreColor(score)} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      {marker != null && <span title={`Self-assessment ${marker}`} className="absolute -top-0.5 w-1 h-4 bg-gray-900 rounded" style={{ left: `calc(${Math.round((marker / max) * 100)}% - 2px)` }} />}
    </div>
  );
}

export function Overall({ value, label = 'Overall' }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-3xl font-bold tabular-nums ${scoreText(value)}`}>{value == null ? '—' : value.toFixed(1)}</span>
      <span className="text-sm text-gray-500">/ 5 {label}</span>
    </div>
  );
}
