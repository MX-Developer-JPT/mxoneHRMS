import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtDate } from '@/lib/ld';

const Empty = ({ children }) => <div className="text-sm text-gray-400 py-4 text-center">{children}</div>;
const cut = (rows, limit) => (limit ? rows.slice(0, limit) : rows);

export function SignoffList({ rows, limit }) {
  const list = cut(rows, limit);
  if (!list.length) return <Empty>Nothing is waiting for sign-off.</Empty>;
  return <div className="divide-y">{list.map(r => (
    <div key={r.id} className="py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium truncate">{r.name} <span className="text-xs text-gray-400">{r.code}</span></div>
        <div className="text-xs text-gray-500 truncate">{r.current_gate} · {r.department || '—'}{r.due_date ? ` · due ${fmtDate(r.due_date)}` : ''}</div>
      </div>
      <Link to={`/LdInductionDetail?id=${r.id}`}><Button size="sm">Review</Button></Link>
    </div>
  ))}</div>;
}

export function AtRiskList({ rows, limit }) {
  const list = cut(rows, limit);
  if (!list.length) return <Empty>No learner is overdue, blocked or failing.</Empty>;
  return <div className="divide-y">{list.map(r => (
    <div key={r.id} className="py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium truncate">{r.name} <span className="text-xs text-gray-400">{r.code}</span></div>
        <div className="text-xs text-gray-500 truncate">{r.current_gate} · day {r.days_in} · {r.progress ?? 0}% done</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {r.overdue_gates > 0 && <Badge variant="outline" className="border-red-300 text-red-700">{r.overdue_gates} overdue</Badge>}
        {r.failed_gates > 0 && <Badge variant="outline" className="border-orange-300 text-orange-700">{r.failed_gates} failed</Badge>}
        {r.blocked_gates > 0 && <Badge variant="outline" className="border-gray-300 text-gray-700">blocked</Badge>}
        <Link to={`/LdInductionDetail?id=${r.id}`}><Button size="sm" variant="outline">Open</Button></Link>
      </div>
    </div>
  ))}</div>;
}

export function OverdueTrainingList({ rows, limit }) {
  const list = cut(rows, limit);
  if (!list.length) return <Empty>No overdue assignments.</Empty>;
  return <div className="divide-y">{list.map(r => (
    <div key={r.id} className="py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0"><div className="font-medium truncate">{r.employee_name}</div><div className="text-xs text-gray-500 truncate">{r.course} · {r.department || '—'}</div></div>
      <div className="text-xs text-red-600 shrink-0">due {fmtDate(r.due_date)}{r.mandatory ? ' · mandatory' : ''}</div>
    </div>
  ))}</div>;
}

export function ExpiringCertList({ rows, limit }) {
  const list = cut(rows, limit);
  if (!list.length) return <Empty>No certificates expire in the next 30 days.</Empty>;
  return <div className="divide-y">{list.map(r => (
    <div key={r.certificate_id} className="py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0"><div className="font-medium truncate">{r.employee_name}</div><div className="text-xs text-gray-500 truncate">{r.title} · {r.certificate_id}</div></div>
      <div className="text-xs text-amber-700 shrink-0">expires {fmtDate(r.expiry_date)}</div>
    </div>
  ))}</div>;
}
