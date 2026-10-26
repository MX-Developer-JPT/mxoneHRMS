import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2, FileText, Lock, CheckCircle2, ArrowRight, PauseCircle, Download, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld } from '@/lib/ld';
import { mmss, useWatchClock } from '@/lib/ldTime';
import { downloadBase64 } from '@/lib/mis';

// react-pdf draws every page on a canvas with pure JavaScript, so it also works inside the mobile app's WebView.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const rel = (u) => String(u || '').replace(/^https?:\/\/[^/]+(?=\/api\/upload\/file\/)/, '');

function PdfReader({ url, onReachedEnd }) {
  const box = useRef(null);
  const [pages, setPages] = useState(0);
  const [width, setWidth] = useState(640);
  const [failed, setFailed] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { const m = () => box.current && setWidth(Math.max(280, box.current.clientWidth - 24)); m(); window.addEventListener('resize', m); return () => window.removeEventListener('resize', m); }, []);
  useEffect(() => {
    if (!pages || !endRef.current) return undefined;
    const o = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) onReachedEnd?.(); }, { root: box.current, threshold: 0.2 });
    o.observe(endRef.current);
    return () => o.disconnect();
  }, [pages, onReachedEnd]);
  return (
    <div ref={box} className="rounded-lg border bg-gray-100 overflow-y-auto" style={{ height: 'calc(100vh - 360px)', minHeight: 360 }}>
      {failed ? <div className="p-6 text-sm text-red-600">This policy could not be displayed. Please tell HR.</div> : (
        <Document file={url} onLoadSuccess={({ numPages }) => setPages(numPages)} onLoadError={() => setFailed(true)} loading={<div className="p-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Opening policy…</div>}>
          {Array.from({ length: pages }, (_, i) => <div key={i} className="flex justify-center py-2"><Page pageNumber={i + 1} width={width} renderTextLayer={false} renderAnnotationLayer={false} /></div>)}
          <div ref={endRef} className="h-6 text-center text-[11px] text-gray-400">End of policy</div>
        </Document>
      )}
    </div>
  );
}

export default function LdPolicyReader() {
  const [sp] = useSearchParams();
  const id = sp.get('id');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [ended, setEnded] = useState(false);
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (keep) => {
    try {
      const d = await ld('ld_getPolicyGate', { induction_id: id });
      setData(d);
      setSel(cur => (keep && cur && d.tasks.some(t => t.id === cur) ? cur : (d.tasks.find(t => t.state === 'open') || d.tasks[d.tasks.length - 1] || {}).id || null));
    } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => { setEnded(false); setAgree(false); }, [sel]);

  const task = data?.tasks.find(t => t.id === sel);
  const reading = !!task && task.state === 'open' && data.is_self && !data.paused && !data.locked;
  const clock = useWatchClock({
    enabled: reading, startSeconds: task?.seconds || 0,
    send: (visible) => ld('ld_trackTime', { induction_id: id, gate_id: 'P1', task_id: task.id, visible }),
  });

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!data) return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;

  const signedCount = data.tasks.filter(t => t.state === 'signed').length;
  const allDone = data.tasks.length > 0 && signedCount === data.tasks.length;
  const need = task?.min_read_seconds || 0;
  const secs = task ? (task.state === 'signed' ? need : clock.seconds) : 0;
  const timeOk = secs >= need;
  const canSign = reading && timeOk && ended && agree && name.trim().length >= 3 && !busy;

  const sign = async () => {
    setBusy(true);
    try {
      await ld('ld_acknowledgePolicy', { induction_id: id, task_id: task.id, typed_name: name.trim(), accept: true });
      toast.success('Acknowledgement signed and stored');
      setName('');
      await load(false);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const receipt = async (ackId) => { try { const r = await ld('ld_policyAckReceipt', { id: ackId }); downloadBase64(r.base64, r.filename, 'application/pdf'); } catch (e) { toast.error(e.message); } };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">HR Policies — read and acknowledge</h1>
        <span className="text-sm text-gray-500">{signedCount} of {data.tasks.length} signed</span>
        <Link to={createPageUrl('MyLearning')} className="ml-auto text-sm text-blue-700 hover:underline">← My Learning</Link>
      </div>
      {data.paused && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 flex items-center gap-2"><PauseCircle className="w-4 h-4" />Induction training is paused by HR — reading time is not counted.</div>}
      {data.locked && <div className="text-sm bg-gray-50 border rounded p-3 text-gray-700">This step opens after the website tour is complete.</div>}
      {data.tasks.length === 0 && <div className="text-sm bg-amber-50 border border-amber-200 rounded p-3 text-amber-900">HR is still preparing the policies for the induction. This step will open as soon as they are published.</div>}
      {allDone && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3">
          <CheckCircle2 className="w-5 h-5" />You have read and acknowledged all {data.tasks.length} policies. Your signed acknowledgements are stored permanently.
          <Link to={`${createPageUrl('LdDeptIntro')}?id=${id}`} className="ml-auto"><Button size="sm">Continue to your department introduction <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>
        </div>
      )}
      {data.tasks.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {data.tasks.map((t, i) => (
              <button key={t.id} disabled={t.state === 'locked'} onClick={() => setSel(t.id)} className={`w-full text-left rounded-lg border p-3 flex items-start gap-2.5 ${sel === t.id ? 'border-blue-600 bg-blue-50' : 'bg-white'} ${t.state === 'locked' ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-300'}`}>
                {t.state === 'signed' ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> : t.state === 'locked' ? <Lock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> : <PenLine className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />}
                <div className="min-w-0"><div className="text-sm font-medium text-gray-900">{i + 1}. {t.title}</div><div className="text-[11px] text-gray-500">{t.state === 'signed' ? 'Signed' : t.state === 'locked' ? 'Opens after the previous policy' : 'Read, then sign'}</div></div>
              </button>
            ))}
          </div>
          {task && (
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-semibold text-gray-900">{task.title}</h2>
                {task.state === 'open' && data.is_self && <span className={`text-sm tabular-nums ${timeOk ? 'text-green-700' : 'text-gray-600'}`}>Reading time {mmss(secs)} / {mmss(need)}{!clock.active && ' · paused (page not in front)'}</span>}
                {task.state === 'signed' && task.ack_id && <Button size="sm" variant="outline" onClick={() => receipt(task.ack_id)}><Download className="w-3.5 h-3.5 mr-1" />Receipt (PDF)</Button>}
              </div>
              <PdfReader key={task.id} url={rel(task.file_url)} onReachedEnd={() => setEnded(true)} />
              {task.state === 'open' && data.is_self && (
                <div className="rounded-xl border bg-white p-4 space-y-3">
                  <div className="text-sm text-gray-700">{!timeOk ? `Keep reading — you can sign after ${mmss(need)}.` : !ended ? 'Scroll to the end of the policy to enable signing.' : 'Sign below.'}</div>
                  <label className="flex items-start gap-2 text-sm text-gray-900"><input type="checkbox" className="mt-1" checked={agree} disabled={!timeOk || !ended} onChange={e => setAgree(e.target.checked)} /><span>{data.statement}</span></label>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[220px]">
                      <label className="text-xs text-gray-500">Type your full name as your signature ({data.employee_name})</label>
                      <input className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-base italic" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" disabled={!timeOk || !ended || !agree} autoComplete="off" />
                    </div>
                    <Button onClick={sign} disabled={!canSign}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Sign and continue</Button>
                  </div>
                  <p className="text-[11px] text-gray-500">Your signature, the time, the policy and the document version are stored permanently and cannot be edited or deleted.</p>
                </div>
              )}
              {!data.is_self && <p className="text-xs text-gray-500">You are viewing this employee&apos;s policy step; only they can read and sign.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
