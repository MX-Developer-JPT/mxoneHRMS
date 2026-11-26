package com.maxvolt.hr;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the web app tell the native side who this phone is (arm) or that nobody is signed in (disarm). */
@CapacitorPlugin(name = "FieldDutyWake")
public class FieldDutyWakePlugin extends Plugin {
    @PluginMethod
    public void arm(PluginCall call) {
        String token = call.getString("token");
        String apiBase = call.getString("apiBase");
        if (token == null || token.isEmpty() || apiBase == null || apiBase.isEmpty()) {
            call.reject("token and apiBase are required.");
            return;
        }
        FieldDutyWake.arm(getContext(), token, apiBase);
        call.resolve();
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        FieldDutyWake.disarm(getContext());
        call.resolve();
    }

    /** The phone's real location-related state, for the app's access gate and the server's audit trail. */
    @PluginMethod
    public void locationState(PluginCall call) {
        Context c = getContext();
        boolean fg = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean bg = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean gps = true;
        try {
            LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                gps = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? lm.isLocationEnabled()
                        : (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            }
        } catch (Exception ignored) {}
        boolean battery = true;
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) battery = pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (Exception ignored) {}
        boolean notif = true;
        try { notif = NotificationManagerCompat.from(c).areNotificationsEnabled(); } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        boolean recording = false; int queued = 0;
        try {
            android.content.SharedPreferences tr = c.getSharedPreferences("maxvolt_trip_recorder", Context.MODE_PRIVATE);
            recording = tr.getBoolean("active", false);
            queued = new org.json.JSONArray(tr.getString("queue", "[]")).length();
        } catch (Exception ignored) {}
        ret.put("fg", fg); ret.put("bg", bg); ret.put("gps", gps); ret.put("battery", battery); ret.put("notif", notif);
        ret.put("recording", recording); ret.put("queued", queued);
        call.resolve(ret);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("armed", FieldDutyWake.isArmed(getContext()));
        call.resolve(ret);
    }
}
