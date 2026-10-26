import { useEffect, useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { ld } from '@/lib/ld';
import { SignoffList, AtRiskList, OverdueTrainingList, ExpiringCertList } from '@/components/ldtrainer/TrainerLists';

// Full working lists behind the trainer dashboard, with a switch between "my learners" and everyone.
export default function LdTrainerWorkbench() {
  const [scope, setScope] = useState('mine');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setData(null); setErr(''); ld('ld_getTrainerHome', { scope }).then(setData).catch(e => setErr(e.message)); }, [scope]);
  useEffect(() => { load(); }, [load]);
  const tabs = data ? [
    ['signoff', 'Sign-offs', data.awaiting_signoff, SignoffList], ['risk', 'At risk', data.at_risk, AtRiskList],
    ['overdue', 'Overdue training', data.overdue_assignments, OverdueTrainingList], ['certs', 'Expiring certificates', data.expiring_certs, ExpiringCertList],
  ] : [];
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ClipboardCheck className="w-6 h-6 text-blue-600" />Trainer Workbench</h1>
          <p className="text-sm text-gray-500">Everything waiting on you, in one place. Lists show the 25 most urgent items.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {[['mine', 'My learners'], ['all', 'Everyone']].map(([k, l]) => <button key={k} onClick={() => setScope(k)} className={`px-3 py-1.5 ${scope === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{l}</button>)}
          </div>
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>
      {!data && !err && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}
      {err && <div className="text-sm text-red-600">{err}</div>}
      {data && (
        <Tabs defaultValue="signoff">
          <TabsList className="flex-wrap h-auto">{tabs.map(([k, l, rows]) => <TabsTrigger key={k} value={k}>{l} ({rows.length})</TabsTrigger>)}</TabsList>
          {tabs.map(([k, , rows, View]) => <TabsContent key={k} value={k}><Card><CardContent className="p-4"><View rows={rows} /></CardContent></Card></TabsContent>)}
        </Tabs>
      )}
    </div>
  );
}
