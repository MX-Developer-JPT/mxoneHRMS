package com.maxvolt.hr;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Starts Field Duty location recording WITHOUT the app being opened (screen locked, app swiped away).
 *
 * How it works: when HR / the system opens a field-duty session for an employee, the server sends a high-priority data push
 * (type "field_duty_start"). FieldDutyMessagingService receives it even when the app is closed and calls wake() here, which
 * (1) hands the background-geolocation plugin's own native recorder (TripRecorder) the session, using the phone's long-lived
 * device token that the app stored earlier with arm(), and (2) starts that plugin's foreground location service in its
 * "headless" mode — the same path the plugin already uses after a reboot. From then on every fix is stored on the phone and
 * uploaded to logFieldPoints by native code, so the screen can stay off.
 *
 * The recorder talks to the plugin through its SharedPreferences (the plugin's classes are package-private), using exactly
 * the keys TripRecorder.start() writes. Keep them in sync with patches/@capacitor-community+background-geolocation+*.patch.
 */
final class FieldDutyWake {
    private static final String ARM_PREFS = "maxvolt_fieldduty_wake";
    private static final String K_TOKEN = "device_token";
    private static final String K_API = "api_base";

    // TripRecorder's store (plugin, package-private).
    private static final String TR_PREFS = "maxvolt_trip_recorder";
    private static final String SERVICE_CLASS = "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService";
    private static final String ACTION_START_HEADLESS = "com.equimaps.capacitor_background_geolocation.START_HEADLESS";

    private FieldDutyWake() {}

    /** Called by the web app after sign-in: remember who this phone is so a later push can start recording on its own. */
    static void arm(Context c, String deviceToken, String apiBase) {
        c.getApplicationContext().getSharedPreferences(ARM_PREFS, Context.MODE_PRIVATE).edit()
                .putString(K_TOKEN, deviceToken).putString(K_API, apiBase).apply();
    }

    /** Called on sign-out: this phone must not start recording for the next person who uses it. */
    static void disarm(Context c) {
        c.getApplicationContext().getSharedPreferences(ARM_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    static boolean isArmed(Context c) {
        SharedPreferences p = c.getApplicationContext().getSharedPreferences(ARM_PREFS, Context.MODE_PRIVATE);
        String t = p.getString(K_TOKEN, null);
        return t != null && !t.isEmpty();
    }

    /** @return true if recording was started (or was already running for this session). */
    static boolean wake(Context c, String tripId) {
        if (tripId == null || tripId.isEmpty()) return false;
        Context app = c.getApplicationContext();
        SharedPreferences arm = app.getSharedPreferences(ARM_PREFS, Context.MODE_PRIVATE);
        String token = arm.getString(K_TOKEN, null);
        String api = arm.getString(K_API, null);
        if (token == null || token.isEmpty() || api == null || api.isEmpty()) return false;   // never signed in on this phone

        SharedPreferences tr = app.getSharedPreferences(TR_PREFS, Context.MODE_PRIVATE);
        boolean sameTrip = tripId.equals(tr.getString("trip_id", ""));
        SharedPreferences.Editor e = tr.edit()
                .putBoolean("active", true)
                .putString("trip_id", tripId)
                .putString("token", token)
                .putString("api_base", api);
        if (!sameTrip) e.putString("queue", "[]");
        e.apply();

        Intent svc = new Intent();
        svc.setClassName(app, SERVICE_CLASS);
        svc.setAction(ACTION_START_HEADLESS);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(svc);
            else app.startService(svc);
            return true;
        } catch (Exception ex) {
            // Android may refuse a location foreground service from the background (permission "Allow all the time" missing,
            // or the app was force-stopped). The push notification sent alongside still asks the employee to open the app.
            return false;
        }
    }
}
