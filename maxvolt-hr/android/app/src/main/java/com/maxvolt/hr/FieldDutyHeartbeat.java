package com.maxvolt.hr;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Keep-alive for a Field Duty session recorded natively.
 *
 * A parked phone produces no new location fixes (the recorder only reports movement), so with the app closed the server heard
 * nothing and showed the employee as offline / "phone silent" while they sat in a meeting. Once a minute, while a session is being
 * recorded, this tells the server "still here" with the last good fix (type heartbeat: liveness only — it never adds distance or a
 * trail point). It reads the plugin's own recorder state from SharedPreferences ("maxvolt_trip_recorder": active, trip_id, token,
 * api_base, last_fix), so it needs no access to the plugin's package-private classes.
 */
final class FieldDutyHeartbeat {
    private static final String TR_PREFS = "maxvolt_trip_recorder";
    private static final long EVERY_MS = 60_000L;
    private static final long MAX_FIX_AGE_MS = 6L * 3600_000L;   // an older "last fix" no longer says where the phone is
    private static boolean started = false;

    private FieldDutyHeartbeat() {}

    /** Idempotent: starts the once-a-minute loop for the life of this process. */
    static synchronized void start(final Context c) {
        if (started) return;
        started = true;
        final Context app = c.getApplicationContext();
        final Handler h = new Handler(Looper.getMainLooper());
        h.postDelayed(new Runnable() {
            @Override public void run() {
                try { beat(app); } catch (Exception ignored) { /* never break the app for a heartbeat */ }
                h.postDelayed(this, EVERY_MS);
            }
        }, EVERY_MS);
    }

    private static void beat(final Context app) {
        SharedPreferences p = app.getSharedPreferences(TR_PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("active", false)) return;
        final String tripId = p.getString("trip_id", null), token = p.getString("token", null), api = p.getString("api_base", null), lastFix = p.getString("last_fix", null);
        if (tripId == null || token == null || api == null || lastFix == null) return;
        final JSONObject fix;
        try { fix = new JSONObject(lastFix); } catch (Exception e) { return; }
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection conn = null;
                try {
                    SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                    iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                    Date fixAt = iso.parse(fix.optString("t"));
                    if (fixAt == null || System.currentTimeMillis() - fixAt.getTime() > MAX_FIX_AGE_MS) return;
                    JSONObject pt = new JSONObject();
                    pt.put("lat", fix.getDouble("lat")); pt.put("lng", fix.getDouble("lng")); pt.put("acc", fix.optDouble("acc", 0));
                    pt.put("t", iso.format(new Date())); pt.put("hb", true);
                    JSONObject body = new JSONObject();
                    body.put("trip_id", tripId); body.put("points", new JSONArray().put(pt));
                    conn = (HttpURLConnection) new URL(api + "/api/functions/logFieldPoints").openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                    conn.setConnectTimeout(15000); conn.setReadTimeout(20000); conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                    if (conn.getResponseCode() == 200) {
                        java.io.InputStream is = conn.getInputStream();
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        byte[] buf = new byte[1024]; int n;
                        while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
                        String r = bos.toString("UTF-8").toLowerCase(Locale.ROOT);
                        // the server says the session is over (OD check-out, closed, not allowed): stop recording for it
                        if (r.contains("\"success\":false") && (r.contains("not active") || r.contains("not found"))) {
                            app.getSharedPreferences(TR_PREFS, Context.MODE_PRIVATE).edit().putBoolean("active", false).apply();
                        }
                    }
                } catch (Exception ignored) {
                    // offline or server busy: the next minute tries again
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }
}
