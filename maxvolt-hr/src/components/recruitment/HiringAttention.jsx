import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { rh } from '@/lib/hiring';

const SEV = { High: 'bg-red-100 text-red-700 border-red-200', Medium: 'bg-amber-100 text-amber-800 border-amber-200', Low: 'bg-gray-100 text-gray-600 border-gray-200' };

// "What needs attention": the stuck things in hiring, in order of urgency, each with where to fix it.
export default function HiringAttention() {
  const [d, setD] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => { rh('rh_mis', { filters: {} }).then(setD).catch(() => setD({ attention: [] })); }, []);
  if (!d) return <div className="rounded-xl border bg-white p-4 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Checking what needs attention…</div>;
  const items = d.attention || [];
  const shown = all ? items : items.slice(0, 4);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="font-semibold text-gray-900">What needs attention in hiring {items.length > 0 && <span className="text-sm font-normal text-gray-500">({items.length})</span>}</p>
        {d.kpis && <span className="text-xs text-gray-500 hidden sm:block">{d.kpis.open_mrfs} open requisitions · {d.kpis.applications} applications · {d.kpis.cvs_sent} CVs sent for review · {d.kpis.joined} joined</span>}
      </div>
      {items.length === 0 ? <p className="text-sm text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />Nothing is stuck right now.</p> : (
        <>
          <ul className="space-y-2">
            {shown.map((a, i) => (
              <li key={i} className="flex items-start gap-3 bg-white rounded-lg border p-3">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${SEV[a.severity] || SEV.Low}`}>{a.severity}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900">{a.title}</p>{a.detail && <p className="text-xs text-gray-500 mt-0.5 break-words">{a.detail}</p>}</div>
                {a.link && <Link to={a.link} className="text-xs text-blue-700 hover:underline whitespace-nowrap mt-0.5">Fix it →</Link>}
              </li>))}
          </ul>
          {items.length > 4 && <button className="mt-2 text-xs text-blue-700 flex items-center gap-1" onClick={() => setAll((v) => !v)}>{all ? <>Show fewer <ChevronUp className="w-3 h-3" /></> : <>Show all {items.length} <ChevronDown className="w-3 h-3" /></>}</button>}
        </>
      )}
    </div>
  );
}
