import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Trash2, Mail } from 'lucide-react';
import { toast } from 'sonner';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ACTIONS = { added: 'Added', updated: 'Changed', removed: 'Removed', options: 'Copy settings changed' };

// Maps each HR account to its real mailbox. The server applies the mapping and the HR copy to every system email.
export default function HrEmailTab({ adminFetch }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await adminFetch('/hr-emails');
      setData(d); setError('');
      setDraft(Object.fromEntries(d.accounts.map((a) => [a.user_id, a.email])));
    } catch (e) { setError(e.message); }
  }, [adminFetch]);
  useEffect(() => { load(); }, [load]);

  const act = async (key, fn, done) => {
    setBusy(key);
    try { await fn(); toast.success(done); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const saveOptions = (next) => act('options', () => adminFetch('/hr-email-options', { method: 'PUT', body: JSON.stringify(next) }), 'Saved');

  if (error) return <p className="py-8 text-center text-sm text-red-600">{error}</p>;
  if (!data) return <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const mapped = data.accounts.filter((a) => a.active && a.email).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" />HR email addresses</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">Enter the real mailbox of each HR account. Mail addressed to the account's login goes to this mailbox instead, and the mailbox is copied on system emails. Changes apply from the next email.</p>
          {mapped === 0 && <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">No HR mailbox is configured yet. Emails are still sent, without an HR copy.</p>}
          {data.accounts.length === 0 && <p className="text-sm text-gray-500">There are no active HR accounts.</p>}
          {data.accounts.map((a) => (
            <div key={a.user_id} className="flex flex-col md:flex-row md:items-center gap-2 border rounded-lg p-3">
              <div className="md:w-72 min-w-0">
                <p className="text-sm font-medium truncate">{a.name} {!a.active && <Badge className="bg-gray-100 text-gray-600 ml-1">Not an active HR account</Badge>}</p>
                <p className="text-xs text-gray-500 truncate">Login: {a.login_email}</p>
              </div>
              <Input type="email" className="h-9 flex-1" placeholder="actual.address@maxvoltenergy.com" disabled={!a.active} value={draft[a.user_id] ?? ''} onChange={(e) => setDraft((p) => ({ ...p, [a.user_id]: e.target.value }))} />
              <div className="flex gap-2">
                {a.active && <Button size="sm" disabled={busy === a.user_id || !(draft[a.user_id] || '').trim() || (draft[a.user_id] || '').trim().toLowerCase() === a.email}
                  onClick={() => act(a.user_id, () => adminFetch(`/hr-emails/${a.user_id}`, { method: 'PUT', body: JSON.stringify({ email: draft[a.user_id] }) }), 'Email address saved')}>
                  {busy === a.user_id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}{a.email ? 'Update' : 'Add'}</Button>}
                {a.email && <Button size="sm" variant="outline" className="text-red-600" disabled={busy === a.user_id}
                  onClick={() => { if (window.confirm(`Remove ${a.email}? It will no longer receive or be copied on emails.`)) act(a.user_id, () => adminFetch(`/hr-emails/${a.user_id}`, { method: 'DELETE' }), 'Email address removed'); }}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">HR copy</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={data.cc_enabled} disabled={busy === 'options'} onChange={(e) => saveOptions({ cc_enabled: e.target.checked, excluded_types: data.excluded_types })} />Copy all configured HR mailboxes on system emails</label>
          {data.cc_enabled && data.optional_types.map((t) => (
            <label key={t.key} className="flex items-center gap-2 pl-6"><input type="checkbox" disabled={busy === 'options'} checked={!data.excluded_types.includes(t.key)}
              onChange={(e) => saveOptions({ cc_enabled: true, excluded_types: e.target.checked ? data.excluded_types.filter((k) => k !== t.key) : [...data.excluded_types, t.key] })} />{t.label}</label>))}
          <p className="text-xs text-gray-500 pt-1">For security, one-time codes and password reset emails are never copied. Emails with a private link (onboarding invite, offer acceptance, document upload, CV decisions) reach HR as a separate copy with the link removed.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Change history</CardTitle></CardHeader>
        <CardContent>
          {data.audit.length === 0 ? <p className="text-sm text-gray-500">No changes yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1.5 pr-3">When</th><th className="pr-3">Administrator</th><th className="pr-3">Change</th><th className="pr-3">HR account</th><th className="pr-3">Previous</th><th>New</th></tr></thead>
              <tbody>{data.audit.map((r) => <tr key={r.id} className="border-b last:border-0"><td className="py-1.5 pr-3 whitespace-nowrap">{when(r.at)}</td><td className="pr-3">{r.actor_name}</td><td className="pr-3">{ACTIONS[r.action] || r.action}</td><td className="pr-3">{r.hr_name || '—'}</td><td className="pr-3">{r.previous_email || '—'}</td><td>{r.new_email || '—'}</td></tr>)}</tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
