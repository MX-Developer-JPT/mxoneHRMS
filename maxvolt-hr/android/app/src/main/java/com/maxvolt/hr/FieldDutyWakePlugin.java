package com.maxvolt.hr;

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

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("armed", FieldDutyWake.isArmed(getContext()));
        call.resolve(ret);
    }
}
