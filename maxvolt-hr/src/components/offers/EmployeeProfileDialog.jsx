import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, UserPlus, Link2 } from 'lucide-react';

const call = async (name, args) => { const r = await base44.functions.invoke(name, args); return r?.data || r; };

// After an offer is accepted: create the employee profile from the offer, or link the candidate to the profile that
// already exists. A candidate ever has one employee profile.
export default function EmployeeProfileDialog({ candidate, onClose, onDone }) {
  const [info, setInfo] = useState(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => call('of_matches', { candidate_id: candidate.id }).then(setInfo).catch((e) => { toast.error(e.message); onClose(); });
  useEffect(() => { setInfo(null); setSearch(''); setFound([]); setReason(''); if (candidate) load(); }, [candidate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (search.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => call('of_employees', { candidate_id: candidate.id, search }).then((d) => setFound(d.employees || [])).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (e) => {
    if (!window.confirm(`Link ${candidate.full_name} to employee ${e.name} (${e.employee_code})? This marks the candidate as joined.`)) return;
    setBusy(e.user_id);
    try { await call('of_link_employee', { candidate_id: candidate.id, user_id: e.user_id, reason }); toast.success(`Linked to ${e.name}`); onDone(); await load(); }
    catch (err) { toast.error(err.message); }
    setBusy('');
  };

  const create = async () => {
    setBusy('create');
    try {
      await call('inviteJoinerToApp', { candidate_id: candidate.id }).then((d) => {
        if (!d.use_onboarding) throw new Error(d.error || 'Could not prepare the profile');
        sessionStorage.setItem('onboarding_prefill', JSON.stringify(d.prefill || {}));
        window.location.assign('/OnboardingHR');
      });
    } catch (e) { toast.error(e.message); setBusy(''); }
  };

  const person = (e, extra) => (
    <div key={e.user_id} className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm">
      <div className="flex-1 min-w-0"><p className="font-medium">{e.name} <span className="text-gray-400">{e.employee_code}</span></p>
        <p className="text-xs text-gray-500">{[e.department, e.left ? 'Left' : '', extra].filter(Boolean).join(' · ')}</p></div>
      {info.can_link && <Button size="sm" variant="outline" disabled={!!busy || !!e.linked_candidate_id} onClick={() => link(e)}>{busy === e.user_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Link2 className="w-3 h-3 mr-1" />}Link</Button>}
    </div>
  );

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Employee profile — {candidate?.full_name}</DialogTitle></DialogHeader>
        {!info ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div> : info.linked ? (
          <p className="text-sm bg-green-50 border border-green-200 rounded-lg p-3">Linked to employee <b>{info.linked.name}</b> {info.linked.employee_code}.{info.linked.onboarding_pending ? ' Onboarding is still in progress.' : ''}</p>
        ) : (
          <div className="space-y-4">
            {info.matches.length > 0 && (
              <div className="space-y-2"><p className="text-sm font-medium">Possible existing profiles</p>{info.matches.map((m) => person(m, `${m.reasons.join(', ')}${m.linked_candidate_id ? ', already linked to another candidate' : ''}`))}</div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">Link to another existing employee</p>
              <Input placeholder="Search by name or employee code" value={search} onChange={(e) => setSearch(e.target.value)} />
              {found.map((e) => person(e))}
              {found.length > 0 && info.can_link && <Input placeholder="Reason, needed when email and phone do not match (10+ characters)" value={reason} onChange={(e) => setReason(e.target.value)} />}
              {!info.can_link && <p className="text-xs text-gray-500">{info.is_hr ? 'Linking is possible after the offer is accepted.' : 'Only HR or admin can link a profile.'}</p>}
            </div>
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-medium">New employee</p>
              {info.create_problem && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">{info.create_problem}</p>}
              <Button className="w-full" disabled={!info.is_hr || !!info.create_problem || !!busy} onClick={create}>{busy === 'create' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}Start onboarding with the offer details</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
