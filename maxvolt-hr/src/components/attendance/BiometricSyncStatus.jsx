import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import moment from 'moment';

export default function BiometricSyncStatus() {
  const [syncLog, setSyncLog] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadSyncLog();
  }, []);

  const loadSyncLog = async () => {
    const logs = await base44.entities.BiometricSyncLog.list('-last_sync_time', 1);
    if (logs.length > 0) setSyncLog(logs[0]);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    await loadSyncLog();
    setSyncing(false);
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {syncLog && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {syncLog.status === 'success'
            ? <CheckCircle className="w-4 h-4 text-green-500" />
            : syncLog.status === 'failed'
            ? <XCircle className="w-4 h-4 text-red-500" />
            : <Clock className="w-4 h-4 text-gray-400" />}
          <span>
            Last sync: {moment(syncLog.last_sync_time).fromNow()}
            {syncLog.status === 'success' && ` · ${syncLog.records_synced} records`}
            {syncLog.status === 'failed' && (
              <span className="text-red-500 ml-1">· Failed</span>
            )}
          </span>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleSyncNow}
        disabled={syncing}
        className="gap-2"
      >
        {syncing
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <RefreshCw className="w-4 h-4" />}
        {syncing ? 'Syncing...' : 'Sync Now'}
      </Button>
    </div>
  );
}