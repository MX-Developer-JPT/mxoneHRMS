// Tells the Android app's native layer who is signed in on this phone, so a silent "field_duty_start" push can start
// location recording even when the app is closed or the phone is locked (see android .../FieldDutyWake.java).
// No-op in a browser and on iOS (no such native plugin there).
import { getGeoDeviceToken } from '@/lib/geoDeviceToken';

export async function armFieldDutyWake() {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    const token = await getGeoDeviceToken({ refresh: true });   // renewed on every app start (30-day token)
    if (!token) return;
    await registerPlugin('FieldDutyWake').arm({ token, apiBase: window.location.origin });
  } catch { /* an older app build without the plugin, or offline: nothing to do */ }
}

export async function disarmFieldDutyWake() {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') await registerPlugin('FieldDutyWake').disarm();
  } catch { /* nothing to do */ }
}
