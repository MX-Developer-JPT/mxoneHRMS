package com.maxvolt.hr;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService;
import java.util.Map;

/**
 * The app's one Firebase messaging service (declared with a higher priority than the plugin's own, see AndroidManifest.xml —
 * Android delivers each push to a single service). It handles the silent "field_duty_start" data message by starting native
 * location recording, and passes EVERYTHING else (normal notifications, token refreshes) to the plugin's service unchanged,
 * so existing push behaviour does not change.
 */
public class FieldDutyMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data != null && "field_duty_start".equals(data.get("type"))) {
            try {
                FieldDutyWake.wake(getApplicationContext(), data.get("trip_id"));
            } catch (Exception ignored) { /* never let a wake attempt break push handling */ }
            return;   // a silent data message: nothing to show
        }
        super.onMessageReceived(message);
    }
}
