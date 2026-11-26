package com.maxvolt.hr;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.os.Build;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import org.json.JSONObject;

/**
 * Keeps Field Duty tracking alive without anyone opening the app - after a reboot, an app update, the phone sleeping for a long time
 * or Android removing the app's process. A system alarm (allowed to fire while the phone dozes) runs this every few minutes:
 *   a session is being recorded      -> make sure the location service is running (and send a keep-alive)
 *   signed in, nothing being recorded -> ask the server whether a session is open (OD check-in made, push never arrived); if so, start
 * It does not depend on push messages. Nothing can run after the user presses "Force stop" in Android settings.
 */
public class FieldDutyWatchdog extends BroadcastReceiver {
    private static final String TAG = "FieldDutyWatchdog";
    private static final String ACTION_TICK = "com.maxvolt.hr.FIELD_DUTY_TICK";
    private static final long RECORDING_EVERY_MS = 9 * 60_000L;   // Android allows about one such alarm per 9 minutes while dozing
    private static final long IDLE_EVERY_MS = 15 * 60_000L;       // battery: one tiny request per quarter hour, daytime only
    private static final int FROM_HOUR = 6, TO_HOUR = 23;

    /** Sets (or replaces) the next tick. Does nothing - and cancels - when nobody is signed in and nothing is being recorded. */
    static void schedule(Context c) {
        Context app = c.getApplicationContext();
        AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        boolean recording = FieldDutyWake.isRecording(app);
        if (!recording && !FieldDutyWake.isArmed(app)) { am.cancel(tick(app)); return; }
        long at = System.currentTimeMillis() + (recording ? RECORDING_EVERY_MS : IDLE_EVERY_MS);
        try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, tick(app)); }
        catch (Exception e) { Log.w(TAG, "could not schedule: " + e); }
    }

    private static PendingIntent tick(Context app) {
        Intent i = new Intent(app, FieldDutyWatchdog.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(app, 4107, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                try { check(app); }
                catch (Exception e) { Log.w(TAG, "check failed: " + e); }
                finally { schedule(app); pending.finish(); }
            }
        }).start();
    }

    // Office arrivals / departures that could not be sent, and the office fences Android forgets when location is switched off.
    private static void geofenceUpkeep(Context app) {
        try {
            com.equimaps.capacitor_background_geolocation.GeoOutbox.flushAsync(app);
            LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return;
            boolean on = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? lm.isLocationEnabled() : lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
            SharedPreferences p = app.getSharedPreferences("maxvolt_watchdog", Context.MODE_PRIVATE);
            if (!on) p.edit().putBoolean("location_was_off", true).apply();
            else if (p.getBoolean("location_was_off", false)) {
                com.equimaps.capacitor_background_geolocation.GeofenceReceiver.refresh(app);
                p.edit().putBoolean("location_was_off", false).apply();
            }
        } catch (Exception e) { Log.w(TAG, "geofence upkeep failed: " + e); }
    }

    private static void check(Context app) throws Exception {
        geofenceUpkeep(app);
        if (FieldDutyWake.isRecording(app)) {
            Log.i(TAG, "session recording: making sure the location service runs");
            FieldDutyWake.startService(app);
            FieldDutyHeartbeat.beatNow(app);
            return;
        }
        if (!FieldDutyWake.isArmed(app)) return;
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        if (hour < FROM_HOUR || hour >= TO_HOUR) return;
        SharedPreferences arm = app.getSharedPreferences(FieldDutyWake.ARM_PREFS, Context.MODE_PRIVATE);
        String token = arm.getString(FieldDutyWake.K_TOKEN, null), api = arm.getString(FieldDutyWake.K_API, null);
        if (token == null || api == null) return;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(api + "/api/functions/getMyFieldSession").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setConnectTimeout(4000); conn.setReadTimeout(4000); conn.setDoOutput(true);   // a broadcast has about 10 s in all
            try (OutputStream os = conn.getOutputStream()) { os.write("{}".getBytes(StandardCharsets.UTF_8)); }
            if (conn.getResponseCode() != 200) { Log.i(TAG, "session check answered " + conn.getResponseCode()); return; }
            InputStream is = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[1024]; int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            JSONObject active = new JSONObject(bos.toString("UTF-8")).optJSONObject("active");
            if (active != null) { Log.i(TAG, "a session is open on the server: starting"); FieldDutyWake.wake(app, active.optString("id")); }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
