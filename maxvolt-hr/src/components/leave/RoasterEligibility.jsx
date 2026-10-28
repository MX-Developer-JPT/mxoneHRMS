import { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// HR / admin choose which departments can have the Roaster holiday (Duhai employees only, 1 per month).
export default function RoasterEligibility() {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await base44.functions.invoke('getRoasterConfig', {});
      const d = res?.data || res;
      if (!d?.success) { setDenied(true); return; }
      setData(d);
      setPicked(new Set(d.departments.filter(x => x.eligible).map(x => x.name)));
    } catch { setDenied(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (denied) return null; // only HR / admin can read or change this
  if (!data) return <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  const toggle = (name) => setPicked(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const changed = data.departments.some(d => d.eligible !== picked.has(d.name));
  const affected = data.departments.filter(d => picked.has(d.name)).reduce((n, d) => n + d.duhai_employees, 0);

  const save = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke('setRoasterConfig', { eligible_departments: [...picked] });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Could not save');
      toast.success(`Saved. ${d.credited} employee(s) credited this month${d.revoked ? `, ${d.revoked} unused credit(s) withdrawn` : ''}.`);
      await load();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">Roaster holiday — eligible departments
          {data.is_default && <Badge variant="secondary" className="font-normal">default: all except {data.default_excluded.map(d => d.toLowerCase()).join(', ')}</Badge>}
        </CardTitle>
        <p className="text-xs text-gray-500">Employees working at <b>Duhai</b> in the ticked departments get 1 Roaster each month (Saturdays only; unused one lapses at month end). Un-ticking a department withdraws this month&apos;s unused credit from its employees; ticking one credits them straight away.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {data.departments.map(d => (
            <label key={d.name} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={picked.has(d.name)} onChange={() => toggle(d.name)} />
              <span className="flex-1 truncate">{d.name}</span>
              <span className="text-xs text-gray-400">{d.duhai_employees} at Duhai</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">{affected} Duhai employee(s) are covered by the current selection.</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!changed || saving} onClick={() => setPicked(new Set(data.departments.filter(x => x.eligible).map(x => x.name)))}>Reset</Button>
            <Button size="sm" disabled={!changed || saving} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}Save</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
