import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Smartphone } from 'lucide-react';
import { toast } from 'sonner';

// Admin switch for the mandatory Android update.
export default function AndroidUpdateCard() {
  const [data, setData] = useState(null);
  const [build, setBuild] = useState('16');
  const [version, setVersion] = useState('1.2.2');
  const [busy, setBusy] = useState(false);

  const take = (d) => { setData(d); if (d.policy.min_build) { setBuild(String(d.policy.min_build)); setVersion(d.policy.min_version); } };
  useEffect(() => { base44.functions.invoke('getAppUpdateSettings', {}).then(r => { const d = r?.data || r; if (d.success) take(d); }).catch(() => {}); }, []);

  const save = async (enabled) => {
    if (enabled && !window.confirm(`Require version ${version} (build ${build}) now?\n\nFirst make sure the Play Store really offers this version to your staff. Every Android user on an older app is blocked until they update.`)) return;
    setBusy(true);
    try {
      const r = await base44.functions.invoke('setAppUpdateSettings', { policy: { enabled, min_build: Number(build), min_version: version } }); const d = r?.data || r;
      if (d.success) { take(d); toast.success(enabled ? 'Update is now mandatory for Android users' : 'Mandatory update switched off'); } else toast.error(d.error || 'Could not save');
    } catch (e) { toast.error(e.message || 'Could not save'); }
    setBusy(false);
  };

  if (!data) return null;
  const on = data.policy.enabled;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Smartphone className="w-4 h-4" />Mandatory Android update</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm font-medium ${on ? 'text-green-700' : 'text-gray-600'}`}>{on ? `On: apps older than version ${data.policy.min_version || '?'} (build ${data.policy.min_build}) are blocked until updated.` : 'Off: nobody is asked to update.'}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Version name</Label><Input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.2.2" /></div>
          <div><Label className="text-xs">Build number (versionCode)</Label><Input type="number" min="1" value={build} onChange={e => setBuild(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" disabled={busy || !(Number(build) > 0)} onClick={() => save(true)}>{on ? 'Save new minimum' : 'Require update now'}</Button>
          {on && <Button size="sm" variant="outline" disabled={busy} onClick={() => save(false)}>Switch off</Button>}
        </div>
        <p className="text-xs text-gray-500">Switch this on only after the version is available in the Play Store (approved and rolled out to everyone). The website and iPhones are not affected.{data.phones?.length ? ` Phones last reported: ${data.phones.map(x => `${x.version || 'older app'} (${x.count})`).join(', ')}.` : ''}</p>
      </CardContent>
    </Card>
  );
}
