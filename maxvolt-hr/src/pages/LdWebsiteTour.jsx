import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, Globe, CheckCircle2, ExternalLink, ArrowRight, PauseCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld } from '@/lib/ld';
import { mmss, useWatchClock } from '@/lib/ldTime';

// Step 1 of the induction: browse www.maxvoltenergy.com for 10 minutes. Time counts only while this page is open and in front.
export default function LdWebsiteTour() {
  const [sp] = useSearchParams();
  const id = sp.get('id');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => ld('ld_getInduction', { id }).then(setData).catch(e => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const ind = data?.induction;
  const g = ind?.gates.find(x => x.gate_id === 'W1');
  const t = g?.tasks.find(x => x.type === 'timed');
  const mine = !!ind?._viewer?.is_employee;
  const open = !!g && ['READY', 'IN_PROGRESS', 'OVERDUE'].includes(g.status);
  const enabled = mine && open && !!t && !t.done && !data?.paused;
  const target = t?.target_seconds || 600;
  const clock = useWatchClock({
    enabled, startSeconds: t?.watch?.sec || 0,
    send: (visible) => ld('ld_trackTime', { induction_id: id, gate_id: 'W1', task_id: t.id, visible }),
    onDone: () => load(),
  });

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!data) return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  if (!g || !t) return <div className="p-6 text-gray-600">This induction does not include the website tour.</div>;

  const done = !!t.done || clock.done;
  const secs = done ? target : Math.min(clock.seconds, target);
  const pct = Math.min(100, Math.round((secs / target) * 100));
  const next = ind.gates.find(x => x.gate_id === 'P1');

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 80px)' }}>
      <div className="px-4 md:px-6 pt-4 pb-3 border-b bg-white space-y-2 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-3">
          <Globe className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-bold text-gray-900">Explore the Maxvolt website</h1>
          <span className="text-sm text-gray-500">Products, business, story and people — take your time, read and click around.</span>
          <Link to={createPageUrl('MyLearning')} className="ml-auto text-sm text-blue-700 hover:underline">← My Learning</Link>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-3 rounded-full bg-gray-200 overflow-hidden"><div className={`h-full transition-all ${done ? 'bg-green-500' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} /></div>
          <div className="text-sm font-semibold tabular-nums text-gray-900 w-28 text-right">{mmss(secs)} / {mmss(target)}</div>
        </div>
        {data.paused && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 flex items-center gap-2"><PauseCircle className="w-4 h-4" />Induction training is paused by HR — the timer is not running.</div>}
        {!mine && <div className="text-xs text-gray-500">You are viewing this step; only the employee can complete it.</div>}
        {enabled && !clock.active && <div className="text-xs text-amber-700">The timer is paused because this page is not in front. Come back to this tab to continue.</div>}
        {done && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded p-2.5">
            <CheckCircle2 className="w-4 h-4" />10 minutes complete — well done.
            {next && <Link to={`${createPageUrl('LdPolicyReader')}?id=${id}`} className="ml-auto"><Button size="sm">Continue to HR policies <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}
          </div>
        )}
      </div>
      <div className="flex-1 bg-gray-100">
        <iframe title="Maxvolt Energy website" src={t.url || 'https://www.maxvoltenergy.com'} className="w-full border-0 bg-white" style={{ height: 'calc(100vh - 190px)', minHeight: 480 }} referrerPolicy="no-referrer" />
        <div className="px-4 py-2 text-xs text-gray-500 flex flex-wrap items-center gap-2">
          If a page does not load here, you can open the site in a new tab —
          <a href={t.url || 'https://www.maxvoltenergy.com'} target="_blank" rel="noreferrer" className="text-blue-700 inline-flex items-center gap-1 hover:underline">www.maxvoltenergy.com <ExternalLink className="w-3 h-3" /></a>
          — but time spent there is not counted; keep this page open.
        </div>
      </div>
    </div>
  );
}
