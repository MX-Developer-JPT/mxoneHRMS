import React, { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sun, Moon, LogOut, Trash2, Settings, Monitor, MapPin, Plus, X, Pencil, Bell, BellOff, Download, Smartphone, ShieldCheck, FileText, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from "@/components/ui/badge";
import { pushSupported, getPushState, enablePush, disablePush } from '@/utils/pwa';
import { registerNativePush } from '@/lib/nativePush';

export default function AppSettings() {
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [locations, setLocations] = useState([]);
  const [showLocForm, setShowLocForm] = useState(false);
  const [editingLoc, setEditingLoc] = useState(null);
  const [locForm, setLocForm] = useState({ name: '', address: '', city: '', state: '' });

  // PWA / push
  const [pushState, setPushState] = useState('default'); // default | subscribed | denied | unsupported
  const [pushBusy, setPushBusy] = useState(false);
  const [testPushBusy, setTestPushBusy] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    loadData();
    getPushState().then(setPushState).catch(() => {});
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => { setInstalled(true); setInstallEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) setInstalled(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushState === 'subscribed') {
        await disablePush();
        setPushState('default');
        toast.success('Push notifications turned off');
      } else {
        await enablePush();
        setPushState('subscribed');
        toast.success('Push notifications enabled');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setPushBusy(false);
  };

  // Self-diagnostic: sends a real test push and reports exactly where
  // delivery stands (no Firebase configured on the server / no device token
  // registered / a specific per-token FCM rejection) instead of leaving
  // "no notifications showing" as an unexplained dead end.
  const sendTestNotification = async () => {
    setTestPushBusy(true);
    try {
      const res = await base44.functions.invoke('sendTestPush', {});
      const d = res.data || res;
      const fcm = d.fcm || {};
      console.log('[sendTestPush] full diagnostic:', d);
      if (!fcm.attempted) {
        const messages = {
          fcm_not_configured_on_server: 'The server has no Firebase credentials configured (FIREBASE_SERVICE_ACCOUNT_JSON) — ask an admin to set it up.',
          no_device_token_registered: 'This device never registered a push token. Open the app once more, allow the notification permission if prompted, then try again.',
        };
        toast.error(messages[fcm.reason] || `Could not send: ${fcm.reason || 'unknown reason'}`);
      } else if (fcm.sent_ok > 0) {
        toast.success(`Test notification sent to ${fcm.sent_ok}/${fcm.token_count} registered device(s) — check your notification shade.`);
      } else {
        const firstError = fcm.results?.find(r => !r.ok);
        toast.error(`Delivery failed for all ${fcm.token_count} device(s)${firstError ? `: ${firstError.code || firstError.message}` : ''}`);
      }
    } catch (e) {
      toast.error('Test failed: ' + e.message);
    }
    setTestPushBusy(false);
  };

  // Runs the actual client-side registration pipeline (permission check →
  // FCM token fetch → backend registration) right now and reports exactly
  // which step it reached, instead of the generic "never registered" message
  // from Send Test, which can't see WHY the device has no token.
  const registerThisDevice = async () => {
    setRegisterBusy(true);
    try {
      const result = await registerNativePush();
      console.log('[registerNativePush] result:', result);
      const messages = {
        not_native: 'This only applies to the installed app (Android/iOS) — you\'re using it in a browser/PWA, which uses Web Push instead.',
        capacitor_core_missing: 'Internal error: Capacitor core is unavailable in this build.',
        plugin_missing: 'Internal error: the Firebase Messaging plugin is missing from this build — the app may need to be rebuilt.',
        permission_check_failed: `Could not check notification permission: ${result.error || 'unknown error'}`,
        permission_request_failed: `Could not request notification permission: ${result.error || 'unknown error'}`,
        permission_denied: 'Notification permission was not granted. Enable it for Maxvolt One in your device Settings → Apps → Notifications, then try again.',
        token_fetch_failed: `Firebase could not issue a device token: ${result.error || 'unknown error'}. Check that Google Play Services is installed and up to date on this device.`,
        token_empty: 'Firebase returned an empty token — try again in a moment.',
        backend_registration_failed: `Got a device token but the server rejected it: ${result.error || 'unknown error'}`,
        success: `Device registered successfully (token ${result.token_prefix}…). Try Send Test now.`,
      };
      const msg = messages[result.step] || `Unexpected result: ${result.step}`;
      if (result.step === 'success') toast.success(msg);
      else toast.error(msg);
    } catch (e) {
      toast.error('Registration failed: ' + e.message);
    }
    setRegisterBusy(false);
  };

  const handleInstall = async () => {
    if (!installEvt) {
      toast.info('To install: use your browser menu → "Add to Home Screen" / "Install app".');
      return;
    }
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    if (outcome === 'accepted') { setInstalled(true); setInstallEvt(null); }
  };

  const loadData = async () => {
    const [currentUser, locData] = await Promise.all([
      base44.auth.me(),
      base44.entities.AppLocation.list()
    ]);
    setUser(currentUser);
    setLocations(locData);
  };

  const isAdmin = () => user?.role === 'hr' || user?.role === 'admin';
  // Push diagnostics (Register this device / Send Test) are strictly
  // admin-only — not HR, not any other role — per explicit instruction.
  // Unlike isAdmin() above (HR+admin), this is admin role exactly.
  const isSuperAdmin = user?.role === 'admin';

  const handleSaveLocation = async () => {
    if (!locForm.name.trim()) { toast.error('Location name is required'); return; }
    if (editingLoc) {
      await base44.entities.AppLocation.update(editingLoc.id, { ...locForm });
      toast.success('Location updated');
    } else {
      await base44.entities.AppLocation.create({ ...locForm, is_active: true });
      toast.success('Location added');
    }
    setShowLocForm(false);
    setEditingLoc(null);
    setLocForm({ name: '', address: '', city: '', state: '' });
    loadData();
  };

  const handleToggleLocation = async (loc) => {
    await base44.entities.AppLocation.update(loc.id, { is_active: !loc.is_active });
    loadData();
  };

  const openEditLoc = (loc) => {
    setEditingLoc(loc);
    setLocForm({ name: loc.name, address: loc.address || '', city: loc.city || '', state: loc.state || '' });
    setShowLocForm(true);
  };

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      // Mark account as deleted / deactivate
      toast.error('Account deletion requires admin approval. Please contact HR.');
      setShowDeleteConfirm(false);
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
    setDeleting(false);
  };

  const themes = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="w-7 h-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">App Settings</h1>
            <p className="text-gray-500 text-sm">Preferences and account management</p>
          </div>
        </div>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">Choose your preferred theme</p>
            <div className="grid grid-cols-3 gap-3">
              {themes.map(t => {
                const Icon = t.icon;
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      isActive
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
                    <span className={`text-sm font-medium ${isActive ? 'text-blue-600' : 'text-gray-600 dark:text-gray-400'}`}>
                      {t.label}
                    </span>
                    {isActive && (
                      <span className="text-xs text-blue-500 font-medium">Active</span>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Notifications & App */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-600" /> Notifications & App
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Push toggle */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                {pushState === 'subscribed'
                  ? <Bell className="w-5 h-5 text-green-600" />
                  : <BellOff className="w-5 h-5 text-gray-400" />}
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Push notifications</p>
                  <p className="text-xs text-gray-500">
                    {pushState === 'unsupported' ? 'Not supported on this device/browser'
                      : pushState === 'denied' ? 'Blocked — enable notifications in browser settings'
                      : pushState === 'subscribed' ? 'On — you\'ll get approvals, recognition & alerts'
                      : 'Get real-time alerts even when the app is closed'}
                  </p>
                </div>
              </div>
              <Button size="sm" variant={pushState === 'subscribed' ? 'outline' : 'default'}
                disabled={pushBusy || pushState === 'unsupported' || pushState === 'denied'}
                onClick={togglePush}
                className={pushState === 'subscribed' ? '' : 'bg-blue-600 hover:bg-blue-700'}>
                {pushBusy ? '…' : pushState === 'subscribed' ? 'Turn off' : 'Enable'}
              </Button>
            </div>

            {/* Register This Device / Send Test — internal diagnostic tools,
                admin-only. Not shown to any other role at all. Note this does
                NOT affect automatic push registration on login (Layout.jsx /
                initNativePush), which still runs for every user regardless
                of role — only these manual diagnostic actions are gated. */}
            {isSuperAdmin && (
              <>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-5 h-5 text-purple-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Register this device</p>
                      <p className="text-xs text-gray-500">Retry native push registration and see exactly where it fails, if it does</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" disabled={registerBusy} onClick={registerThisDevice}>
                    {registerBusy ? 'Registering…' : 'Register'}
                  </Button>
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-orange-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Test notifications</p>
                      <p className="text-xs text-gray-500">Send yourself a real test push to check delivery</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" disabled={testPushBusy} onClick={sendTestNotification}>
                    {testPushBusy ? 'Sending…' : 'Send Test'}
                  </Button>
                </div>
              </>
            )}

            {/* Install */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-indigo-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Install app</p>
                  <p className="text-xs text-gray-500">
                    {installed ? 'Installed — launch it from your home screen' : 'Add Maxvolt One to your home screen for quick access'}
                  </p>
                </div>
              </div>
              {!installed && (
                <Button size="sm" variant="outline" onClick={handleInstall}>
                  <Download className="w-4 h-4 mr-1" /> Install
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Location Management — HR/Admin only */}
        {isAdmin() && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" /> Location Management
                </CardTitle>
                <Button size="sm" onClick={() => { setEditingLoc(null); setLocForm({ name: '', address: '', city: '', state: '' }); setShowLocForm(true); }}>
                  <Plus className="w-4 h-4 mr-1" /> Add Location
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {locations.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No locations configured yet.</p>
              )}
              {locations.map(loc => (
                <div key={loc.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{loc.name}</p>
                    {(loc.city || loc.state) && (
                      <p className="text-xs text-gray-500">{[loc.city, loc.state].filter(Boolean).join(', ')}</p>
                    )}
                    {loc.address && <p className="text-xs text-gray-400">{loc.address}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={loc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>
                      {loc.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => openEditLoc(loc)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggleLocation(loc)}>
                      {loc.is_active ? <X className="w-3 h-3 text-red-500" /> : <Plus className="w-3 h-3 text-green-500" />}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Account */}
        {/* Legal — required to be reachable in-app for Google Play / App Store */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <a
              href="/PrivacyPolicy"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center gap-3 h-12 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ShieldCheck className="w-5 h-5 text-blue-500" />
              <span className="flex-1 text-sm font-medium">Privacy Policy</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </a>
            <a
              href="/TermsOfService"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center gap-3 h-12 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <FileText className="w-5 h-5 text-blue-500" />
              <span className="flex-1 text-sm font-medium">Terms of Service</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </a>
            <a
              href="/DeleteAccountRequest"
              className="w-full flex items-center gap-3 h-12 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Trash2 className="w-5 h-5 text-red-500" />
              <span className="flex-1 text-sm font-medium">Delete Account &amp; Data</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full justify-start gap-3 h-12 text-gray-700 dark:text-gray-300"
            >
              <LogOut className="w-5 h-5 text-gray-500" />
              Log Out
            </Button>
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="outline"
              className="w-full justify-start gap-3 h-12 text-red-600 border-red-200 hover:bg-red-50"
            >
              <Trash2 className="w-5 h-5 text-red-500" />
              Delete Account
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Location Form Dialog */}
      <Dialog open={showLocForm} onOpenChange={setShowLocForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLoc ? 'Edit Location' : 'Add Location'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Location Name *</Label>
              <Input value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} placeholder="e.g., Mumbai HQ" />
            </div>
            <div>
              <Label>City</Label>
              <Input value={locForm.city} onChange={e => setLocForm({ ...locForm, city: e.target.value })} placeholder="Mumbai" />
            </div>
            <div>
              <Label>State</Label>
              <Input value={locForm.state} onChange={e => setLocForm({ ...locForm, state: e.target.value })} placeholder="Maharashtra" />
            </div>
            <div>
              <Label>Full Address (optional)</Label>
              <Input value={locForm.address} onChange={e => setLocForm({ ...locForm, address: e.target.value })} placeholder="123, Street, Area..." />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowLocForm(false)}>Cancel</Button>
              <Button onClick={handleSaveLocation} className="bg-blue-600 hover:bg-blue-700">Save Location</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently removed.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? 'Processing...' : 'Delete My Account'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}