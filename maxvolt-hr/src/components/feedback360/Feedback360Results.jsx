import { useEffect, useState, useCallback } from 'react';
import { Loader2, Award, Lock, TrendingUp, MessageSquare, Users, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScoreBar, Overall, REL_LABEL, scoreText } from './shared';

// The results of ONE person for one period: overall, each competency (with the self-assessment marked on the same bar), the
// breakdown by who rated, the trend over periods and the anonymous comments. Used for "My results" and, for HR / admin, for any
// employee. The server decides what may be shown (see backend/utils/feedback360.js) — a hidden result arrives as `hidden: true`.
export default function Feedback360Results({ subjectUserId = null, initialPeriod = null, refreshKey = 0 }) {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async (per) => {
    setErr('');
    try {
      const res = await base44.functions.invoke('get360FeedbackData', { ...(subjectUserId ? { subject_user_id: subjectUserId } : {}), ...(per ? { period: per } : {}) });
      const r = res?.data || res;
      if (r?.success === false || r?.error) throw new Error(r.error || 'Could not load');
      setD(r); setPeriod(r.period);
    } catch (e) { setErr(e.message || 'Could not load the results'); }
  }, [subjectUserId]);
  useEffect(() => { setD(null); load(initialPeriod); }, [load, refreshKey, initialPeriod]);

  if (err) return <div className="text-sm text-red-600 py-6 text-center">{err}</div>;
  if (!d) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  const comps = d.competencies || [];
  const self = d.self;
  const hasAny = d.reviewers > 0 || self;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {d.subject && <div className="min-w-0"><div className="font-semibold text-gray-900 truncate">{d.subject.name}</div><div className="text-xs text-gray-500">{[d.subject.code, d.subject.designation, d.subject.department].filter(Boolean).join(' · ')}</div></div>}
        <div className="sm:ml-auto flex items-center gap-2">
          <label className="text-xs text-gray-500" htmlFor="fb-period">Period</label>
          <select id="fb-period" value={period} onChange={e => { setPeriod(e.target.value); load(e.target.value); }} className="border rounded-md text-sm px-2 py-1.5 bg-white">
            {d.periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {d.hidden && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
          <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold">Results are protected until {d.min_raters} colleagues have rated {d.subject ? 'this person' : 'you'}</div>
            <p className="mt-1">{d.reviewers === 0 ? 'Nobody has rated yet.' : `${d.reviewers} colleague${d.reviewers === 1 ? ' has' : 's have'} rated so far`} — {d.needed} more {d.needed === 1 ? 'is' : 'are'} needed. This keeps every rating anonymous: with only one or two raters it would be easy to guess who said what.</p>
          </div>
        </div>
      )}

      {!hasAny && !d.hidden && <div className="text-center py-10 text-gray-400"><Award className="w-8 h-8 mx-auto mb-2 opacity-40" />No feedback for this period yet.</div>}

      {d.low_sample && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 flex gap-2 items-center"><AlertTriangle className="w-4 h-4 shrink-0" />Low sample — only {d.reviewers} colleague{d.reviewers === 1 ? '' : 's'} rated. The person concerned cannot see these results yet (needs {d.min_raters}); read them with care.</div>
      )}

      {!d.hidden && d.reviewers > 0 && (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex flex-wrap items-center gap-x-4 gap-y-1"><span className="flex items-center gap-2"><Award className="w-4 h-4" />Competency scores</span><span className="text-xs font-normal text-gray-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" />{d.reviewers} rater{d.reviewers === 1 ? '' : 's'}</span></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                <Overall value={d.overall} label="from others" />
                {self && <Overall value={self.overall} label="self-assessment" />}
              </div>
              {comps.map(c => {
                const sc = d.aggregate?.[c.key]; const me = self?.scores?.[c.key]; const gap = d.gap?.[c.key];
                return (
                  <div key={c.key}>
                    <div className="flex justify-between items-baseline mb-1.5 gap-2">
                      <span className="text-sm font-medium text-gray-800">{c.label}</span>
                      <span className="text-sm tabular-nums"><span className={`font-semibold ${scoreText(sc)}`}>{sc == null ? '—' : sc.toFixed(1)}</span>{me != null && <span className="text-gray-500"> · self {me.toFixed(1)}{gap != null && gap !== 0 && <span className={gap > 0 ? 'text-orange-600' : 'text-green-700'}> ({gap > 0 ? '+' : ''}{gap.toFixed(1)})</span>}</span>}</span>
                    </div>
                    <ScoreBar score={sc} marker={me} />
                  </div>
                );
              })}
              {self && <p className="text-xs text-gray-500">{d.subject ? 'The black mark on each bar is their own self-assessment. A positive number in brackets means they rated themselves higher than others did.' : 'The black mark on each bar is your own self-assessment. A positive number in brackets means you rated yourself higher than others did.'}</p>}
            </CardContent>
          </Card>

          {Object.keys(d.by_relationship || {}).length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">By who rated</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1.5 pr-3 font-medium">Group</th><th className="py-1.5 pr-3 font-medium">Raters</th><th className="py-1.5 pr-3 font-medium">Overall</th>{comps.map(c => <th key={c.key} className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.label.split(' ')[0]}</th>)}</tr></thead>
                    <tbody>
                      {Object.entries(d.by_relationship).map(([rel, g]) => (
                        <tr key={rel} className="border-b last:border-0"><td className="py-2 pr-3 font-medium text-gray-800">{REL_LABEL[rel] || rel}</td><td className="py-2 pr-3 tabular-nums">{g.count}</td><td className={`py-2 pr-3 tabular-nums font-semibold ${scoreText(g.overall)}`}>{g.overall?.toFixed(1)}</td>{comps.map(c => <td key={c.key} className="py-2 pr-3 tabular-nums">{g.scores[c.key]?.toFixed(1) ?? '—'}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-2">Groups with fewer than {d.min_raters} raters are not shown separately (except the manager), so no single person can be identified.</p>
              </CardContent>
            </Card>
          )}

          {d.comments?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4" />Comments <span className="text-xs font-normal text-gray-500">anonymous · in no particular order</span></CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {d.comments.map((c, i) => (
                  <div key={i} className="rounded-lg border bg-gray-50 p-3 space-y-1.5 text-sm">
                    <Badge variant="outline" className="text-[10px]">{c.relationship === 'direct_report' ? 'Direct report' : c.relationship === 'manager' ? 'Manager' : 'Peer'}</Badge>
                    {c.strengths && <p><span className="font-semibold text-green-700">Strengths: </span>{c.strengths}</p>}
                    {c.improvements && <p><span className="font-semibold text-blue-700">To improve: </span>{c.improvements}</p>}
                    {c.comment && <p className="text-gray-700">{c.comment}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {self && (self.strengths || self.improvements || self.comments) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{d.subject ? 'Their own words' : 'Your own words'}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {self.strengths && <p><span className="font-semibold text-green-700">Strengths: </span>{self.strengths}</p>}
            {self.improvements && <p><span className="font-semibold text-blue-700">To improve: </span>{self.improvements}</p>}
            {self.comments && <p className="text-gray-700">{self.comments}</p>}
          </CardContent>
        </Card>
      )}

      {d.trend?.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Over time</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.trend.map(t => (
              <div key={t.period} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-gray-600">{t.label}</span>
                <div className="flex-1"><ScoreBar score={t.hidden ? null : t.overall} /></div>
                <span className="w-24 text-right tabular-nums text-gray-700">{t.hidden ? <span className="text-xs text-gray-400">protected</span> : t.overall == null ? '—' : `${t.overall.toFixed(1)} · ${t.reviewers}`}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
