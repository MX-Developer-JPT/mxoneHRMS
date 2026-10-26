import { useState } from 'react';
import { Mail, MapPin, CalendarDays, Users, ArrowUp } from 'lucide-react';

// Department org chart for the induction. Top level = Management leaders, middle level = the department's leaders who report to
// them, team = everyone else. Top and middle are drawn larger and in colour because those are the people to know first.
const LEVEL = {
  top: { label: 'Top level · Management', ring: 'border-blue-700 bg-blue-50', chip: 'bg-blue-700 text-white', avatar: 'bg-blue-700 text-white' },
  middle: { label: 'Middle level · Department leaders', ring: 'border-teal-600 bg-teal-50', chip: 'bg-teal-600 text-white', avatar: 'bg-teal-600 text-white' },
  team: { label: 'Team', ring: 'border-gray-200 bg-white', chip: 'bg-gray-200 text-gray-700', avatar: 'bg-gray-200 text-gray-700' },
};
const fmtD = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}`; };
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const rel = (u) => (u ? String(u).replace(/^https?:\/\/[^/]+(?=\/api\/upload\/file\/)/, '') : '');

function Avatar({ p, size }) {
  const [bad, setBad] = useState(false);
  const L = LEVEL[p.level] || LEVEL.team;
  const cls = `${size} rounded-full shrink-0 flex items-center justify-center font-semibold overflow-hidden ${L.avatar}`;
  return p.photo && !bad ? <img src={rel(p.photo)} alt="" loading="lazy" className={`${size} rounded-full shrink-0 object-cover`} onError={() => setBad(true)} /> : <div className={cls} aria-hidden="true">{initials(p.name)}</div>;
}

export function PersonCard({ p, big = false }) {
  const L = LEVEL[p.level] || LEVEL.team;
  return (
    <div className={`rounded-xl border-2 ${L.ring} ${big ? 'p-4' : 'p-3'} ${p.is_you ? 'ring-2 ring-amber-400' : ''} min-w-0`}>
      <div className="flex items-start gap-3">
        <Avatar p={p} size={big ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`font-semibold text-gray-900 ${big ? 'text-base' : 'text-sm'}`}>{p.name}</span>
            {p.is_you && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-amber-950 font-semibold">You</span>}
          </div>
          <div className={`${big ? 'text-sm' : 'text-xs'} text-gray-700 font-medium leading-snug`}>{p.designation}</div>
          <div className="mt-1.5 space-y-0.5 text-[11px] text-gray-600">
            <div className="flex items-center gap-1"><CalendarDays className="w-3 h-3 shrink-0" />Joined {fmtD(p.doj)}{p.tenure ? ` · ${p.tenure}` : ''}</div>
            {p.reports_to && p.level !== 'top' && <div className="flex items-center gap-1"><ArrowUp className="w-3 h-3 shrink-0" />Reports to {p.reports_to.split(' — ')[0]}</div>}
            {p.direct_reports > 0 && <div className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0" />{p.direct_reports} direct report{p.direct_reports === 1 ? '' : 's'}</div>}
            {big && p.location && <div className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{p.location}</div>}
            {big && p.email && <div className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{p.email}</span></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// a team member and whoever reports to them (indented)
function TeamBranch({ n, depth = 0 }) {
  return (
    <div className={depth ? 'ml-5 pl-3 border-l-2 border-gray-200' : ''}>
      <PersonCard p={n} />
      {n.children?.length > 0 && <div className="mt-2 space-y-2">{n.children.map(c => <TeamBranch key={c.user_id} n={c} depth={depth + 1} />)}</div>}
    </div>
  );
}

function MiddleBlock({ n }) {
  return (
    <div className="space-y-3">
      <PersonCard p={n} big />
      {n.children?.length > 0 && (
        <div className="ml-4 pl-4 border-l-2 border-teal-300">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Reports to {n.name.split(' ')[0]} · {n.children.length}</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 items-start">{n.children.map(c => <TeamBranch key={c.user_id} n={c} />)}</div>
        </div>
      )}
    </div>
  );
}

function ChartView({ org }) {
  const roots = org.tree || [];
  const topRoots = roots.filter(r => r.level === 'top');
  const stray = roots.filter(r => r.level !== 'top');
  return (
    <div className="space-y-6">
      {topRoots.map(top => (
        <div key={top.user_id} className="space-y-3">
          <div className="max-w-xl"><PersonCard p={top} big /></div>
          {top.children?.length > 0 && (
            <div className="ml-6 pl-5 border-l-4 border-blue-300 space-y-5">
              {top.children.map(m => (m.level === 'middle' ? <MiddleBlock key={m.user_id} n={m} /> : <TeamBranch key={m.user_id} n={m} />))}
            </div>
          )}
        </div>
      ))}
      {stray.length > 0 && <div className="space-y-5">{stray.map(m => (m.level === 'middle' ? <MiddleBlock key={m.user_id} n={m} /> : <TeamBranch key={m.user_id} n={m} />))}</div>}
      {org.loose?.length > 0 && <div className="space-y-2"><div className="text-xs font-medium text-gray-500">Also in this department</div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{org.loose.map(c => <TeamBranch key={c.user_id} n={c} />)}</div></div>}
    </div>
  );
}

function TableView({ org }) {
  const rows = [...org.top, ...org.middle, ...org.team];
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">{['Name', 'Designation', 'Level', 'Date of joining', 'Time in company', 'Reports to', 'Direct reports', 'Location', 'Email'].map(h => <th key={h} className="p-2 whitespace-nowrap font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map(p => (
          <tr key={p.user_id} className={`border-b last:border-0 ${p.level === 'top' ? 'bg-blue-50/60' : p.level === 'middle' ? 'bg-teal-50/60' : ''}`}>
            <td className="p-2 font-medium text-gray-900 whitespace-nowrap">{p.name}{p.is_you && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-amber-950 font-semibold">You</span>}</td>
            <td className="p-2">{p.designation}</td>
            <td className="p-2 whitespace-nowrap"><span className={`text-[11px] px-2 py-0.5 rounded-full ${LEVEL[p.level].chip}`}>{p.level === 'top' ? 'Top' : p.level === 'middle' ? 'Middle' : 'Team'}</span></td>
            <td className="p-2 whitespace-nowrap">{fmtD(p.doj)}</td><td className="p-2 whitespace-nowrap">{p.tenure}</td>
            <td className="p-2">{p.reports_to || (p.level === 'top' ? '—' : '')}</td><td className="p-2 text-center">{p.direct_reports || ''}</td><td className="p-2">{p.location}</td><td className="p-2">{p.email}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function OrgChartView({ org }) {
  const [view, setView] = useState('chart');
  const c = org.counts;
  if (!c.total) return <p className="text-sm text-gray-500 py-6 text-center">There is no org chart to show yet for this department.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {['top', 'middle', 'team'].map(k => <span key={k} className={`text-xs px-2.5 py-1 rounded-full font-medium ${LEVEL[k].chip}`}>{LEVEL[k].label}: {c[k]}</span>)}
        <div className="ml-auto flex rounded-lg border overflow-hidden text-sm">{[['chart', 'Chart'], ['table', 'Table']].map(([id, l]) => <button key={id} onClick={() => setView(id)} className={`px-3 py-1.5 ${view === id ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{l}</button>)}</div>
      </div>
      {view === 'chart' ? <ChartView org={org} /> : <TableView org={org} />}
      {org.leadership?.length > 0 && org.scope === 'department' && (
        <div className="rounded-lg border bg-white p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Maxvolt leadership (Management) — know all five</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-700">{org.leadership.map(l => <span key={l.user_id}><b>{l.name}</b> — {l.designation}</span>)}</div>
        </div>
      )}
    </div>
  );
}
