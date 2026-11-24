import { useCallback, useEffect, useState } from 'react';
import { Loader2, Clock, Mail, CalendarCheck, CircleDot, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { rh, statusLabel, statusCls, fmtDT, fmtD, DECISION } from '@/lib/hiring';

const ICON = { status: CircleDot, review_decision: Mail, interview: CalendarCheck, note: Clock };

// Activity timeline, CV review history (with "record an emailed reply") and interview history of one candidate.
export default function CandidateActivity({ candidateId, canAct = false, onChanged }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rec, setRec] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await rh('rh_candidate_timeline', { candidate_id: candidateId })); } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, [candidateId]);
  useEffect(() => { if (candidateId) load(); }, [candidateId, load]);

  const record = async () => {
    try { await rh('rh_review_record', rec); toast.success('Outcome recorded'); setRec(null); await load(); onChanged?.(); } catch (e) { toast.error(e.message); }
  };
  const remind = async (batchId) => { try { const r = await rh('rh_review_remind', { batch_id: batchId }); toast.success(r.reminded?.length ? `Reminder sent to ${r.reminded.join(', ')}` : 'No reminder needed'); load(); } catch (e) { toast.error(e.message); } };

  if (loading && !d) return <div className="py-6 text-center text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading activity…</div>;
  if (!d) return null;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${statusCls(d.status)}`}>{d.status_label}</span>
        {d.review_flag === 'conflict' && <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800">Reviewers disagree — HR to resolve</span>}
        {d.review_flag === 'more_info' && <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">A reviewer asked for more information</span>}
        {d.requisition && <span className="text-xs text-gray-500">{d.requisition.mrf_no ? `${d.requisition.mrf_no} · ` : ''}{d.requisition.title}</span>}
      </div>

      {d.batches.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2">CV review history</p>
          <div className="space-y-2">
            {d.batches.map((b) => (
              <div key={b.id} className="border rounded-lg p-3 text-sm">
                <div className="flex justify-between flex-wrap gap-1"><span><b>Batch {b.batch_no}</b> · <span className="font-mono text-xs text-gray-500">{b.id}</span></span><span className="text-xs text-gray-500">sent {fmtDT(b.sent_at)} by {b.created_by_name}</span></div>
                {(b.mine?.remarks) && <p className="text-xs text-gray-600 mt-1">HR remarks: {b.mine.remarks}</p>}
                <div className="mt-2 space-y-1">
                  {b.recipients.map((r) => {
                    const dec = b.mine?.decisions?.[r.role];
                    return (
                      <div key={r.user_id} className="flex justify-between items-center gap-2 flex-wrap text-xs">
                        <span>{r.name} <span className="text-gray-400">({r.role === 'hod' ? 'HOD' : r.role === 'hiring_manager' ? 'Hiring Manager' : 'Reviewer'}, {r.email})</span></span>
                        {dec ? <span className={`px-2 py-0.5 rounded ${DECISION[dec.decision][1]}`}>{DECISION[dec.decision][0]} · {fmtDT(dec.at)}{dec.source === 'manual' ? ' · recorded by HR' : ' · by email'}{dec.comment ? ` — “${dec.comment}”` : ''}</span>
                          : <span className="flex items-center gap-2"><span className="text-gray-400">Awaiting response</span>{canAct && <button className="text-blue-600 underline" onClick={() => setRec({ batch_id: b.id, candidate_id: candidateId, recipient_role: r.role, decision: 'shortlist', comment: '' })}>Record emailed reply</button>}</span>}
                      </div>
                    );
                  })}
                </div>
                {canAct && <Button size="sm" variant="ghost" className="h-7 mt-1 text-xs" onClick={() => remind(b.id)}><BellRing className="w-3 h-3 mr-1" />Send reminder</Button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {rec && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2 text-sm">
          <p className="font-medium">Record the outcome from the emailed reply</p>
          <div className="flex gap-2 flex-wrap">
            <select className="h-9 rounded-md border border-gray-300 bg-white px-2" value={rec.decision} onChange={(e) => setRec({ ...rec, decision: e.target.value })}>
              <option value="shortlist">Shortlist for interview</option><option value="reject">Reject</option><option value="hold">Hold</option><option value="more_info">Request more information</option>
            </select>
            <input className="h-9 flex-1 min-w-[200px] rounded-md border border-gray-300 bg-white px-2" placeholder="Remarks from the reply" value={rec.comment} onChange={(e) => setRec({ ...rec, comment: e.target.value })} />
            <Button size="sm" onClick={record}>Record</Button><Button size="sm" variant="ghost" onClick={() => setRec(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {d.interviews.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2">Interviews</p>
          <div className="space-y-1.5">
            {d.interviews.map((i) => (
              <div key={i.id} className="border rounded-lg px-3 py-2 text-xs flex justify-between gap-2 flex-wrap">
                <span><b>{i.round_name || `Round ${i.round_number}`}</b> · {fmtDT(String(i.scheduled_date).length === 16 ? `${i.scheduled_date}:00+05:30` : i.scheduled_date)} · {(i.interviewer_names || []).join(', ')}</span>
                <span className="text-gray-600">{i.status}{i.reschedule_count ? ` · rescheduled ${i.reschedule_count}×` : ''}{(i.feedbacks || []).length ? ` · ${(i.feedbacks || []).map((f) => `${f.interviewer_name}: ${f.recommendation} ${f.overall}/5`).join('; ')}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold mb-2">Activity timeline</p>
        <ol className="relative border-l-2 border-gray-200 ml-2 space-y-3">
          {d.timeline.length === 0 && <li className="ml-4 text-xs text-gray-400">No activity recorded yet (older candidates only gain history from now on).</li>}
          {d.timeline.map((e, i) => { const Icon = ICON[e.type] || Clock; return (
            <li key={i} className="ml-4">
              <span className="absolute -left-[9px] bg-white"><Icon className="w-4 h-4 text-blue-500" /></span>
              <p className="text-sm text-gray-800">{e.text || `${statusLabel(e.from)} → ${statusLabel(e.to)}`}{e.override && <span className="ml-1 text-xs text-red-600">(authorised override: {e.reason})</span>}</p>
              <p className="text-xs text-gray-400">{fmtDT(e.at)}{e.by_name ? ` · ${e.by_name}` : ''}</p>
            </li>); })}
        </ol>
      </div>
    </div>
  );
}
