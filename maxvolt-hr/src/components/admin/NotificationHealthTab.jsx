import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Bell, Mail, Loader2, CheckCircle2, AlertTriangle, XCircle, Send } from 'lucide-react';

const Row = ({ ok, label, detail }) => (
  <div className="flex items-start gap-2 text-sm py-1.5 border-b last:border-0">
    {ok === true ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> : ok === false ? <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />}
    <div><span className="font-medium">{label}</span>{detail ? <span className="text-muted-foreground"> — {detail}</span> : null}</div>
  </div>
);

const testText = (v) => (typeof v === 'string' ? v : v?.fcm ? (v.fcm.sent_ok > 0 ? `delivered to ${v.fcm.sent_ok} device(s)` : (v.fcm.reason || v.fcm.error || 'no device received it')) : JSON.stringify(v));

export default function NotificationHealthTab() {
  const { user } = useAuth();
  const [checking, setChecking] = useState('');
  const [health, setHealth] = useState(null);

  const [period, setPeriod] = useState('daily');
  const [to, setTo] = useState(user?.email || '');
  const [sending, setSending] = useState('');

  const runCheck = async (sendTest) => {
    setChecking(sendTest ? 'test' : 'check');
    try {
      const res = await base44.functions.invoke('notificationHealthCheck', { send_test: sendTest });
      const d = res?.data || res;
      if (!d?.success) { toast.error(d?.error || 'Health check failed'); setChecking(''); return; }
      setHealth(d);
      toast.success(sendTest ? 'Test notifications sent — check your bell, phone and inbox' : 'Health check complete');
    } catch (e) { toast.error('Health check failed: ' + e.message); }
    setChecking('');
  };

  const sendMis = async (toManagement) => {
    if (!toManagement && !to.trim()) { toast.error('Enter an email address'); return; }
    if (toManagement && !window.confirm(`Send the ${period} MIS report to everyone in the Management department now?`)) return;
    setSending(toManagement ? 'mgmt' : 'me');
    try {
      const res = await base44.functions.invoke('sendMisReportNow', { period, to: toManagement ? undefined : to.trim(), force: toManagement });
      const d = res?.data || res;
      if (!d?.success) toast.error(d?.error || 'Could not send');
      else if (d.skipped) toast.warning(d.skipped === 'no recipients' ? 'No one in the Management department has an email address' : `Not sent: ${d.skipped}`);
      else toast.success(toManagement ? `Sent to ${d.sent} Management user(s)` : `Test MIS sent to ${to.trim()}`);
    } catch (e) { toast.error('Send failed: ' + e.message); }
    setSending('');
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2"><Bell className="w-5 h-5 text-primary" /><h2 className="font-semibold">Check notifications</h2></div>
        <p className="text-sm text-muted-foreground">Checks that in-app, push (Android, iOS, web) and email delivery are set up. "Check + send test" also sends a real test through each channel to you.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => runCheck(false)} disabled={!!checking}>
            {checking === 'check' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Check only
          </Button>
          <Button onClick={() => runCheck(true)} disabled={!!checking}>
            {checking === 'test' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />} Check + send test to me
          </Button>
        </div>
        {health && (
          <div className="rounded-md border bg-muted/20 p-3">
            <Row ok={health.email.api_key_set} label="Email (Brevo)" detail={health.email.api_key_set ? 'API key set' : 'BREVO_API_KEY is missing'} />
            <Row ok={health.native_push.firebase_service_account_set} label="Android / iOS push (Firebase)" detail={health.native_push.firebase_service_account_set ? 'credentials set' : 'FIREBASE_SERVICE_ACCOUNT_JSON is missing'} />
            <Row ok label="Web push" detail={health.web_push.keys_source} />
            <Row ok={health.devices.native_tokens_total > 0 ? true : null} label="Registered phones" detail={`${health.devices.native_tokens_total} total, ${health.devices.native_tokens_for_you} yours`} />
            <Row ok={health.devices.web_subscriptions_total > 0 ? true : null} label="Browser subscriptions" detail={`${health.devices.web_subscriptions_total} total, ${health.devices.web_subscriptions_for_you} yours`} />
            <Row ok={health.notifications_created_last_24h > 0 ? true : null} label="Notifications created in last 24 h" detail={String(health.notifications_created_last_24h)} />
            {health.test && Object.entries(health.test).map(([k, v]) => (
              <Row key={k} ok={!/FAILED|no device|missing|not set|error/i.test(testText(v))} label={`Test — ${k.replace('_', ' ')}`} detail={testText(v)} />
            ))}
            {health.problems?.length > 0 && (
              <div className="mt-3 text-sm text-red-700 space-y-1">{health.problems.map((p, i) => <div key={i}>• {p}</div>)}</div>
            )}
          </div>
        )}
      </div>

      <div className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" /><h2 className="font-semibold">Send MIS email now</h2></div>
        <p className="text-sm text-muted-foreground">Sends the MIS report for the period that just ended (daily = yesterday, weekly = last Mon–Sun, monthly = last month) with the full and department-wise Excel files. The automatic schedule: daily 12:00 AM, Monday 12:10 AM, 1st of the month 12:10 AM.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">Report
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1 flex-1 min-w-[220px]">Test address
            <Input value={to} onChange={e => setTo(e.target.value)} placeholder="you@company.com" />
          </label>
          <Button variant="outline" onClick={() => sendMis(false)} disabled={!!sending}>
            {sending === 'me' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Send test to this address
          </Button>
          <Button onClick={() => sendMis(true)} disabled={!!sending}>
            {sending === 'mgmt' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Send to Management now
          </Button>
        </div>
      </div>
    </div>
  );
}
