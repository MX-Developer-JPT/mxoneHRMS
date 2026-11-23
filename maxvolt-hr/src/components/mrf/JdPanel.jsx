import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw, Wand2, ListPlus, Languages, Factory, Globe, Pencil, Eye, Save, Lock, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, fmt } from '@/lib/mrf';
import { parseJd, printJd } from '@/lib/jdPrint';

const ACTIONS = [
  ['improve', 'Improve writing', Wand2], ['expand', 'Expand responsibilities', ListPlus], ['simplify', 'Simplify language', Languages],
  ['industry', 'Add industry skills', Factory], ['portal', 'Optimise for portals', Globe],
];

const META = ['JOB TITLE', 'DEPARTMENT', 'POSITION TIER', 'JOB LOCATION', 'EMPLOYMENT TYPE', 'EXPERIENCE REQUIRED', 'COMPENSATION RANGE'];
/** Read-only rendering of the plain-text JD: a details strip, then each section with real bullets. */
export function JdText({ text }) {
  if (!String(text || '').trim()) return <p className="text-sm text-muted-foreground">No Job Description yet.</p>;
  const sections = parseJd(text);
  const meta = sections.filter((x) => META.includes(x.head));
  const body = sections.filter((x) => !META.includes(x.head));
  const title = meta.find((x) => x.head === 'JOB TITLE')?.lines.join(' ');
  return (
    <div className="space-y-4 text-sm">
      {title && <h2 className="text-xl font-bold">{title}</h2>}
      {meta.filter((x) => x.head !== 'JOB TITLE').length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-amber-50 border-l-4 border-amber-300 px-3 py-2 text-xs">
          {meta.filter((x) => x.head !== 'JOB TITLE').map((x) => <span key={x.head}><b className="capitalize">{x.head.toLowerCase().replace(' required', '')}:</b> {x.lines.join(' ')}</span>)}
        </div>
      )}
      {body.map((sec, i) => {
        const bullets = sec.lines.filter((l) => l.startsWith('•')); const prose = sec.lines.filter((l) => !l.startsWith('•'));
        return (
          <div key={i}>
            {sec.head && <p className="text-xs font-bold tracking-wide border-l-4 border-yellow-400 bg-muted/40 pl-2 py-0.5 mb-1.5">{sec.head}</p>}
            {prose.map((l, j) => <p key={j} className="leading-relaxed mb-1">{l}</p>)}
            {bullets.length > 0 && <ul className="list-disc pl-5 space-y-0.5">{bullets.map((l, j) => <li key={j}>{l.replace(/^•\s*/, '')}</li>)}</ul>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Job Description area. Who may do what is decided by the server; the flags below only decide which buttons to show.
 *   perms.can_generate  AI draft (creator while drafting, or the Hiring Manager)
 *   perms.can_edit      manual edit and AI refinements (the Hiring Manager only)
 */
export default function JdPanel({ rec, ensureSaved, perms, onUpdated }) {
  const [text, setText] = useState(rec?.jd_current_text || '');
  const [mode, setMode] = useState('preview');
  const [busy, setBusy] = useState('');
  useEffect(() => { setText(rec?.jd_current_text || ''); setMode('preview'); }, [rec?.id, rec?.jd_current_text]);
  const approvedText = rec?.approved_jd?.text;
  const dirty = mode === 'edit' && text.trim() !== (rec?.jd_current_text || '').trim();

  const run = async (action) => {
    setBusy(action);
    try {
      const id = await ensureSaved();
      if (!id) { setBusy(''); return; }
      const d = await mrf('mrf_jd_generate', { id, action, text: ['generate', 'regenerate'].includes(action) ? undefined : (dirty ? text : undefined) });
      onUpdated(d.requisition);
      toast.success(d.source === 'template' ? 'Draft created from the form details (AI unavailable)' : 'Job Description updated');
      if (d.invalidated) toast.warning('The earlier approval was voided — the Hiring Manager must approve the new text.');
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const saveManual = async () => {
    setBusy('save');
    try {
      const d = await mrf('mrf_jd_save', { id: rec.id, text });
      onUpdated(d.requisition); setMode('preview');
      toast.success(d.unchanged ? 'No changes' : d.invalidated ? 'Saved — the approval was voided; the Hiring Manager must approve again' : 'Job Description saved');
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const has = !!String(rec?.jd_current_text || '').trim();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {perms.can_generate && (
          <Button size="sm" onClick={() => run(has ? 'regenerate' : 'generate')} disabled={!!busy}>
            {busy === 'generate' || busy === 'regenerate' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : has ? <RefreshCw className="w-4 h-4 mr-1.5" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            {has ? 'Regenerate JD' : 'Generate JD'}
          </Button>
        )}
        {perms.can_edit && has && ACTIONS.map(([k, l, Icon]) => (
          <Button key={k} size="sm" variant="outline" onClick={() => run(k)} disabled={!!busy}>
            {busy === k ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Icon className="w-4 h-4 mr-1.5" />}{l}
          </Button>
        ))}
        {has && (
          <>
            <Button size="sm" variant="outline" onClick={() => printJd(rec, rec.approved_jd?.text || rec.jd_current_text, { letterhead: true })}><Printer className="w-4 h-4 mr-1.5" />Print on letterhead</Button>
            <Button size="sm" variant="ghost" onClick={() => printJd(rec, rec.approved_jd?.text || rec.jd_current_text, { letterhead: false })} title="For pre-printed letterhead paper">Print without letterhead</Button>
          </>
        )}
        {has && (
          <div className="ml-auto inline-flex rounded-md border overflow-hidden text-xs">
            <button type="button" onClick={() => setMode('preview')} className={`px-3 py-1.5 flex items-center gap-1 ${mode === 'preview' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Eye className="w-3.5 h-3.5" />Preview</button>
            <button type="button" disabled={!perms.can_edit} onClick={() => setMode('edit')} title={perms.can_edit ? '' : 'Only the Hiring Manager can edit the JD'} className={`px-3 py-1.5 flex items-center gap-1 border-l disabled:opacity-50 ${mode === 'edit' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Pencil className="w-3.5 h-3.5" />Edit manually</button>
          </div>
        )}
      </div>

      {!perms.can_edit && has && <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> The Hiring Manager owns and edits the Job Description. You can ask the AI to draft it.</p>}
      {!has && <p className="text-sm text-muted-foreground border border-dashed rounded-md p-4 text-center">{perms.can_generate ? 'Fill in the form, then generate the Job Description.' : 'No Job Description yet.'}</p>}

      {has && mode === 'edit' && (
        <div className="space-y-2">
          <textarea className="w-full rounded-md border border-input bg-background p-3 text-sm font-mono min-h-[360px]" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveManual} disabled={!dirty || !!busy}>{busy === 'save' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}Save as new version</Button>
            <Button size="sm" variant="ghost" onClick={() => { setText(rec.jd_current_text || ''); setMode('preview'); }}>Discard</Button>
          </div>
          {rec?.approved_jd && <p className="text-xs text-amber-700">This JD is approved. A change to the wording will void the approval and unpublish the job until you approve it again.</p>}
        </div>
      )}
      {has && mode === 'preview' && (
        <div className="rounded-lg border bg-white p-5 max-h-[520px] overflow-y-auto"><JdText text={rec.jd_current_text} /></div>
      )}
      {approvedText && rec?.approved_jd && (
        <p className="text-xs text-green-700">✓ Version {rec.approved_jd.version} approved by {rec.approved_jd.approved_by_name} on {fmt(rec.approved_jd.approved_at, true)}{approvedText !== rec.jd_current_text ? ' — a newer unapproved version exists.' : ''}</p>
      )}
      {(rec?.jd_versions || []).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Version history ({rec.jd_versions.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {[...rec.jd_versions].reverse().map((v) => (
              <li key={v.version}>v{v.version} · {v.source === 'manual' ? 'edited' : v.source === 'template' ? 'form draft' : 'AI'} ({v.action}) · {v.by_name} · {fmt(v.at, true)}{rec.approved_jd?.version === v.version ? ' · ✓ approved' : ''}{v.note ? ` — ${v.note}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
