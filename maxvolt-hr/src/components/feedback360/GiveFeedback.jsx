import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Loader2, Check, CheckCircle2, UserRound, Star, ChevronsUpDown, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { StarRating, GIVER_ROLES } from './shared';

const COMPETENCIES = [
  { key: 'communication', label: 'Communication', hint: 'Explains ideas clearly and listens well' },
  { key: 'collaboration', label: 'Collaboration', hint: 'Works well with others and shares information' },
  { key: 'technical', label: 'Technical Skills', hint: 'Skill and knowledge needed for their role' },
  { key: 'leadership', label: 'Leadership', hint: 'Guides, motivates and takes initiative' },
  { key: 'reliability', label: 'Reliability', hint: 'Delivers on commitments, on time and with quality' },
];
const EMPTY = { communication: 0, collaboration: 0, technical: 0, leadership: 0, reliability: 0, strengths: '', improvements: '', comments: '' };
const REL_SHORT = { peer: 'a peer', manager: 'their manager', direct_report: 'their direct report', self: 'yourself' };

// Who to give feedback to: self-assessment, then your manager, reports and peers (suggested from the org chart), or anyone else.
export default function GiveFeedback({ me, onGiven }) {
  const [tasks, setTasks] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [target, setTarget] = useState(null);          // { user_id, name, relationship, done }
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const lastTarget = useRef(null);            // keeps the title steady while the dialog closes
  if (target) lastTarget.current = target;

  const load = useCallback(async () => {
    try { const r = await base44.functions.invoke('get360Tasks', {}); setTasks(r?.data || r); } catch (e) { toast.error(e.message || 'Could not load'); }
  }, []);
  useEffect(() => { load(); base44.entities.Employee.list().then(l => setEmployees(l || [])).catch(() => {}); }, [load]);

  const suggested = useMemo(() => new Set((tasks?.suggestions || []).map(s => s.user_id)), [tasks]);
  const others = useMemo(() => employees.filter(e => e.user_id && e.user_id !== me?.id && !suggested.has(e.user_id)).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))), [employees, me, suggested]);

  const open = (t) => { setTarget(t); setForm(EMPTY); };
  const submit = async (e) => {
    e.preventDefault();
    if (!target.relationship) { toast.error('Select how you know this person'); return; }
    if (COMPETENCIES.some(c => !form[c.key])) { toast.error('Please rate all five competencies'); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('submit360Feedback', { subject_user_id: target.user_id, relationship: target.relationship, answers: form });
      const r = res?.data || res;
      if (!r?.success) throw new Error(r?.error || 'Could not submit');
      toast.success(r.updated ? 'Your earlier rating was updated' : target.relationship === 'self' ? 'Self-assessment saved' : 'Feedback submitted anonymously');
      setTarget(null); await load(); onGiven?.();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  if (!tasks) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  const done = tasks.suggestions.filter(s => s.done).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-gray-900">Feedback round: {tasks.period_label}</div>
            <p className="text-sm text-gray-500 mt-0.5">You have given feedback to <b>{tasks.given_count}</b> colleague{tasks.given_count === 1 ? '' : 's'} this round{tasks.suggestions.length ? ` (${done} of ${tasks.suggestions.length} suggested)` : ''}.</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Lock className="w-3.5 h-3.5" />Your name is never shown — not to them, their manager or HR.</div>
        </CardContent>
      </Card>

      <Card className={tasks.self_done ? '' : 'border-blue-200'}>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <UserRound className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="flex-1 min-w-[200px]"><div className="font-medium text-gray-900">Your self-assessment</div><div className="text-sm text-gray-500">Rate yourself on the same five competencies — your results then show how your view compares with others.</div></div>
          {tasks.self_done && <span className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />Done</span>}
          <Button size="sm" variant={tasks.self_done ? 'outline' : 'default'} onClick={() => open({ user_id: me.id, name: 'yourself', relationship: 'self', done: tasks.self_done })}>{tasks.self_done ? 'Update' : 'Start'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Suggested colleagues</CardTitle><p className="text-xs text-gray-500">From your reporting line: your manager, the people who report to you and your peers.</p></CardHeader>
        <CardContent className="p-0">
          {tasks.suggestions.length === 0 ? <p className="p-4 text-sm text-gray-500">No colleagues are linked to you in the org chart yet. Use "Rate someone else" below.</p> : (
            <ul className="divide-y">
              {tasks.suggestions.map(s => (
                <li key={s.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[180px]"><div className="text-sm font-medium text-gray-900">{s.name}</div><div className="text-xs text-gray-500">{[s.designation, s.department].filter(Boolean).join(' · ')} · you are {REL_SHORT[s.relationship]}</div></div>
                  {s.done && <span className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />Done</span>}
                  <Button size="sm" variant={s.done ? 'outline' : 'default'} onClick={() => open(s)}>{s.done ? 'Update' : 'Rate'}</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]"><div className="font-medium text-gray-900">Rate someone else</div><div className="text-sm text-gray-500">Anyone you have worked with.</div></div>
          <Popover open={pickOpen} onOpenChange={setPickOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="flex w-full sm:w-72 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent"><span className="text-muted-foreground">Search a colleague…</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="end">
              <Command>
                <CommandInput placeholder="Search colleague..." />
                <CommandList>
                  <CommandEmpty>No colleagues found.</CommandEmpty>
                  <CommandGroup>
                    {others.map(e => (
                      <CommandItem key={e.id} value={`${e.display_name || e.full_name || e.email || ''} ${e.employee_code || ''}`} onSelect={() => { setPickOpen(false); open({ user_id: e.user_id, name: e.display_name || e.full_name || e.email, relationship: '', done: false }); }}>
                        <Check className="mr-2 h-4 w-4 opacity-0" />{e.display_name || e.full_name || e.email}<span className="ml-auto text-xs text-gray-400">{e.department}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{(target || lastTarget.current)?.relationship === 'self' ? 'Self-assessment' : `Feedback for ${(target || lastTarget.current)?.name || ''}`}</DialogTitle></DialogHeader>
          {target && (
            <form onSubmit={submit} className="space-y-5">
              {target.relationship !== 'self' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fb-role">You are this person's… *</label>
                  <select id="fb-role" value={target.relationship} onChange={e => setTarget(t => ({ ...t, relationship: e.target.value }))} className="w-full border rounded-md text-sm px-2 py-2 bg-white">
                    <option value="">Select how you know them</option>
                    {GIVER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              )}
              {target.done && <div className="text-xs rounded-md bg-blue-50 border border-blue-200 text-blue-900 p-2">You already rated {target.relationship === 'self' ? 'yourself' : 'this person'} this round. Submitting again replaces your earlier rating.</div>}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Star className="w-4 h-4" />Rate each competency (1 = needs a lot of improvement, 5 = outstanding)</h3>
                {COMPETENCIES.map(c => (
                  <div key={c.key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div className="w-44 shrink-0"><div className="text-sm text-gray-800">{c.label}</div><div className="text-[11px] text-gray-400 leading-tight">{c.hint}</div></div>
                    <StarRating value={form[c.key]} onChange={v => setForm(f => ({ ...f, [c.key]: v }))} />
                  </div>
                ))}
              </div>
              {[['strengths', 'What do they do really well?'], ['improvements', 'What could they do better?'], ['comments', 'Anything else? (optional)']].map(([k, label]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`fb-${k}`}>{label}</label>
                  <textarea id={`fb-${k}`} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} rows={2} maxLength={1000} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Be specific and constructive" />
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                <p className="text-xs text-gray-500 flex items-center gap-1"><Lock className="w-3 h-3" />{target.relationship === 'self' ? 'Only you and HR can see your self-assessment.' : 'Anonymous — your name is not stored with what they see.'}</p>
                <div className="flex gap-2 w-full sm:w-auto"><Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => setTarget(null)}>Cancel</Button><Button type="submit" disabled={saving} className="flex-1 sm:flex-none">{saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Submit</Button></div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
