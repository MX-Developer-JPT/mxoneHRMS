package com.maxvolt.hr;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
    }

    // On Android 8.0 (API 26)+, posting a notification to a channel ID that was
    // never created is silently dropped by the OS — no crash, no log, it just
    // never appears. The backend (backend/utils/push.js) sends FCM notifications
    // tagged with channelId "general" / "alerts" / "updates", but nothing in
    // this native project ever created those channels, so every push
    // notification sent to a built APK was being discarded on-device. These
    // three IDs must exactly match CHANNEL_BY_TYPE in backend/utils/push.js.
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel general = new NotificationChannel(
            "general", "General", NotificationManager.IMPORTANCE_DEFAULT);
        general.setDescription("General HR notifications and updates");

        NotificationChannel alerts = new NotificationChannel(
            "alerts", "Alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Important alerts and warnings requiring attention");

        NotificationChannel updates = new NotificationChannel(
            "updates", "Updates", NotificationManager.IMPORTANCE_DEFAULT);
        updates.setDescription("Approval confirmations and status updates");

        manager.createNotificationChannel(general);
        manager.createNotificationChannel(alerts);
        manager.createNotificationChannel(updates);
    }
}
