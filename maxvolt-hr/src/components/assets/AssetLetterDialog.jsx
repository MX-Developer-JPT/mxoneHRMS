import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Printer, Download, FileText, RefreshCw, AlertTriangle, Eye, PenLine, ShieldCheck } from 'lucide-react';
import SignaturePad from '@/components/SignaturePad';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { al, downloadLetterPdf, letterState, LETTER_STATUS } from '@/lib/assetLetters';
import { assetLetterDocument } from '@/utils/assetLetterHtml';

const PAGE_W = 794;   // 210 mm at 96 dpi
const PAGE_H = 1123;  // 297 mm

/**
 * Generate / preview / print an asset handover letter.
 *   employee  { user_id, display_name, employee_code }
 *   assets    the assets currently assigned to that employee (what the letter can list)
 *   preselect asset entity ids ticked when the dialog opens
 *   letter    an existing letter (summary) to open straight in preview; otherwise HR ticks assets and generates one
 */
export default function AssetLetterDialog({ open, onClose, employee, assets = [], preselect = [], letter: openLetter = null, canManage = true, viewerUserId = null, onChanged }) {
  const [picked, setPicked] = useState(new Set());
  const [issueDate, setIssueDate] = useState('');
  const [letter, setLetter] = useState(null);     // full letter incl. model
  const [mode, setMode] = useState('with');       // 'with' | 'without' letterhead
  const [busy, setBusy] = useState('');
  const [scale, setScale] = useState(1);
  const frameRef = useRef(null);
  const sigRef = useRef(null);
  const [agreed, setAgreed] = useState(false);
  const pendingPrint = useRef(false);

  useEffect(() => {
    if (!open) return;
    setMode('with'); setBusy(''); pendingPrint.current = false;
    const ids = preselect.length ? preselect : assets.map(a => a.id);
    setPicked(new Set(ids));
    const latest = assets.filter(a => ids.includes(a.id)).map(a => String(a.assignment_date || '').slice(0, 10)).filter(Boolean).sort().pop();
    setIssueDate(latest || format(new Date(), 'yyyy-MM-dd'));
    setLetter(null);
    if (openLetter) {
      setBusy('load');
      al('al_get', { id: openLetter.id }).then(d => setLetter(d.letter)).catch(e => { toast.error(e.message); onClose?.(); }).finally(() => setBusy(''));
    }
    const fit = () => setScale(Math.min(1, (Math.min(window.innerWidth, 980) - 64) / PAGE_W));
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, openLetter?.id]);

  const doc = useMemo(() => (letter?.model ? assetLetterDocument(letter.model, mode === 'with', { signature: letter.signature }) : ''), [letter, mode]);
  const canSign = !!letter && !!viewerUserId && letter.user_id === viewerUserId && !letter.signed && letter.status !== 'superseded';

  const sign = async () => {
    if (sigRef.current?.isEmpty?.()) { toast.error('Please draw your signature'); return; }
    if (!agreed) { toast.error('Please tick the box to agree'); return; }
    setBusy('sign');
    try {
      const d = await al('al_sign', { id: letter.id, signature: sigRef.current.toDataURL(), agreed: true });
      setLetter(d.letter); setAgreed(false);
      toast.success('Signed — thank you. HR has been notified.');
      onChanged?.();
    } catch (e) { toast.error(e.message || 'Could not save your signature'); }
    setBusy('');
  };
  const state = letter ? letterState(letter) : null;

  const generate = async (revises) => {
    const ids = revises ? (letter.asset_ids || []).filter(id => assets.some(a => a.id === id)) : [...picked];
    if (!ids.length) { toast.error(revises ? 'None of the assets in this letter are assigned to the employee any more.' : 'Tick at least one asset.'); return; }
    setBusy('gen');
    try {
      const d = await al('al_generate', { user_id: employee.user_id, asset_ids: ids, issue_date: revises ? undefined : issueDate, revises_letter_id: revises || undefined });
      setLetter(d.letter);
      toast.success(d.reused ? `Letter ${d.letter.ref_no} already on record — opened it.` : revises ? `Revised letter ${d.letter.ref_no} generated` : `Letter ${d.letter.ref_no} generated`);
      onChanged?.();
    } catch (e) { toast.error(e.message || 'Could not generate the letter'); }
    setBusy('');
  };

  const doPrint = () => {
    const w = frameRef.current?.contentWindow;
    if (!w) return;
    al('al_event', { id: letter.id, action: 'print', variant: mode === 'with' ? 'with_letterhead' : 'without_letterhead' }).then(() => onChanged?.()).catch(() => {});
    try { w.focus(); w.print(); } catch { toast.error('Printing was blocked by the browser — use Download PDF instead.'); }
  };
  const printAs = (m) => { if (m === mode) doPrint(); else { pendingPrint.current = true; setMode(m); } };
  const onFrameLoad = () => { if (pendingPrint.current) { pendingPrint.current = false; setTimeout(doPrint, 400); } };

  const download = async () => {
    setBusy('pdf');
    try { await downloadLetterPdf(letter, mode === 'with'); onChanged?.(); } catch (e) { toast.error(e.message || 'Could not create the PDF'); }
    setBusy('');
  };

  const toggle = (id) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-[1000px] w-[96vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <FileText className="w-5 h-5" /> Asset Handover Letter{employee?.display_name ? ` — ${employee.display_name}` : ''}
            {letter && <Badge className={`${LETTER_STATUS[state].cls} text-xs`}>{LETTER_STATUS[state].label}</Badge>}
            {letter && <span className="font-mono text-xs text-muted-foreground">{letter.ref_no}</span>}
          </DialogTitle>
        </DialogHeader>

        {busy === 'load' && <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>}

        {!letter && busy !== 'load' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose the assets to list in the letter. Only assets currently assigned to {employee?.display_name || 'the employee'} can be included; the letter is saved as a permanent record with its own reference number.</p>
            {assets.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">No asset is assigned to this employee yet — assign an asset first.</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                {assets.map(a => (
                  <label key={a.id} className="flex items-center gap-3 p-2.5 text-sm cursor-pointer hover:bg-muted/40">
                    <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} className="rounded" />
                    <span className="flex-1 min-w-0"><span className="font-medium">{a.asset_name}</span> <span className="font-mono text-xs text-muted-foreground">{a.asset_id}</span>
                      <span className="block text-xs text-muted-foreground truncate">{a.asset_type_name || ''}{a.serial_number ? ` · S/N ${a.serial_number}` : ''}{a.specs?.imei_1 ? ` · IMEI ${a.specs.imei_1}` : ''}</span></span>
                  </label>
                ))}
              </div>
            )}
            <div className="max-w-[220px]"><Label>Date of issue</Label><Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
            <Button onClick={() => generate(null)} disabled={busy === 'gen' || !canManage || picked.size === 0} className="w-full sm:w-auto">
              {busy === 'gen' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />} Generate letter &amp; preview
            </Button>
            {!canManage && <p className="text-xs text-muted-foreground">Only HR, admin or front desk admin can generate letters.</p>}
          </div>
        )}

        {letter && (
          <div className="space-y-3">
            {letter.outdated && (
              <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">The asset information has changed since this letter was issued.</p>
                  <ul className="list-disc pl-4 text-xs mt-0.5">{letter.outdated_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  <p className="text-xs mt-0.5">This letter stays on record exactly as issued. Generate a revised letter to reflect the new details.</p>
                </div>
              </div>
            )}
            {letter.status === 'superseded' && <p className="text-sm bg-gray-100 border rounded-md p-2.5 text-gray-700">This letter has been replaced by a revised letter. It is kept here as a historical record.</p>}

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Preview mode">
                <button type="button" onClick={() => setMode('with')} className={`px-3 py-1.5 flex items-center gap-1 ${mode === 'with' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Eye className="w-3.5 h-3.5" /> With letterhead</button>
                <button type="button" onClick={() => setMode('without')} className={`px-3 py-1.5 flex items-center gap-1 border-l ${mode === 'without' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Eye className="w-3.5 h-3.5" /> Without letterhead</button>
              </div>
              <Button size="sm" onClick={() => printAs('with')}><Printer className="w-4 h-4 mr-1.5" /> Print with letterhead</Button>
              <Button size="sm" variant="outline" onClick={() => printAs('without')}><Printer className="w-4 h-4 mr-1.5" /> Print without letterhead</Button>
              <Button size="sm" variant="outline" onClick={download} disabled={busy === 'pdf'}>
                {busy === 'pdf' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />} Download PDF ({mode === 'with' ? 'with' : 'without'} letterhead)
              </Button>
              {canManage && letter.status !== 'superseded' && (
                <Button size="sm" variant={letter.outdated ? 'default' : 'ghost'} onClick={() => generate(letter.id)} disabled={busy === 'gen'} className="ml-auto">
                  {busy === 'gen' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />} Generate revised letter
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Both versions carry exactly the same letter — “without letterhead” leaves out only the logo, header and footer so it can be printed on the company’s pre-printed paper (text is placed to clear them). Issued by {letter.generated_by_name || '—'} on {letter.generated_at ? format(new Date(letter.generated_at), 'dd MMM yyyy, hh:mm a') : '—'}
              {letter.acknowledged_at ? ` · acknowledged by the employee ${format(new Date(letter.acknowledged_at), 'dd MMM yyyy')}` : ''}.
            </p>

            {letter.signed && (
              <p className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-md p-2.5 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Signed and acknowledged by {letter.signed_by_name} on {letter.acknowledged_at ? format(new Date(letter.acknowledged_at), 'dd MMM yyyy, hh:mm a') : '—'}.</p>
            )}
            {canSign && (
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
                <p className="text-sm font-semibold flex items-center gap-2"><PenLine className="w-4 h-4" /> Sign to acknowledge receipt of these assets</p>
                <p className="text-xs text-muted-foreground">Read the letter below, then sign with your finger or mouse. Your signature is attached to this letter and to each asset listed in it.</p>
                <SignaturePad ref={sigRef} height={140} />
                <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I have received the asset(s) listed in this letter in the condition stated and agree to the guidelines.</label>
                <Button onClick={sign} disabled={busy === 'sign'}>{busy === 'sign' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <PenLine className="w-4 h-4 mr-1.5" />}Sign &amp; acknowledge</Button>
              </div>
            )}

            <div className="bg-slate-200 rounded-lg p-2 sm:p-4 overflow-hidden flex justify-center">
              <div style={{ width: PAGE_W * scale, height: PAGE_H * scale }}>
                <iframe
                  ref={frameRef} title="Letter preview" srcDoc={doc} onLoad={onFrameLoad}
                  style={{ width: PAGE_W, height: PAGE_H, border: 0, background: '#fff', transform: `scale(${scale})`, transformOrigin: 'top left', boxShadow: '0 2px 10px rgba(0,0,0,.25)' }}
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
