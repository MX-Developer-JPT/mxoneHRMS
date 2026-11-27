import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { checkAppUpdate } from '@/lib/appUpdate';

// Blocks the Android app (and only the Android app) while an update is required. It covers the sign-in screen too. It is only a
// screen on top: location tracking already running underneath carries on.
export default function UpdateGate() {
  const [needed, setNeeded] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      setNeeded(await checkAppUpdate({
        platform: Capacitor.getPlatform(),
        getInfo: async () => (await import('@capacitor/app')).App.getInfo(),
        fetchPolicy: async (body) => { const r = await base44.functions.invoke('getAppUpdatePolicy', body); return r?.data || r; },
        storage: window.localStorage,
      }));
    } catch { /* never break the app because the check failed */ }
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(check, 15 * 60000);
    const onShow = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, [check]);

  if (!needed) return null;
  return (
    <div role="alertdialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center p-6 bg-white dark:bg-gray-950 overflow-y-auto" style={{ zIndex: 100001, pointerEvents: 'auto' }}>
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="mx-auto w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center"><Download className="w-8 h-8 text-orange-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Update required</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{needed.message || `Please update Maxvolt One${needed.min_version ? ' to version ' + needed.min_version : ''} to continue. Attendance and field duty tracking work correctly only on the new version.`}</p>
        </div>
        <div className="space-y-2">
          {/* an address outside the app: Android hands it to the Play Store */}
          <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white" onClick={() => { window.location.href = needed.store_url; }}>Update from Play Store</Button>
          <Button variant="outline" className="w-full" disabled={busy} onClick={() => { setBusy(true); check().finally(() => setBusy(false)); }}>{busy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}I have updated - check again</Button>
        </div>
        <p className="text-xs text-gray-500">If the Play Store shows no update yet, wait a little and try again, or contact HR.</p>
      </div>
    </div>
  );
}
