package com.maxvolt.hr;

import android.app.Application;

/**
 * Runs whenever the app's process is created — including when Android restarts the location service with no screen open — so the
 * Field Duty keep-alive loop (FieldDutyHeartbeat) is alive exactly as long as the process that is recording.
 */
public class MaxvoltApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        FieldDutyHeartbeat.start(this);
    }
}
