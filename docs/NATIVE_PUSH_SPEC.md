# Native Android Push Notifications — Technical Specification

**App:** Maxvolt One Android wrapper (`com.maxvolt.hr`)
**Goal:** Real, native push notifications — system tray, sound, vibration, badge, lock-screen, heads-up banner, tap-to-open — exactly like WhatsApp or any native app, including when the app is fully closed/killed. This replaces relying on Web Push (which does not work reliably inside a plain WebView, and is restricted on iOS) with **Firebase Cloud Messaging (FCM)**.
**Backend status:** ✅ Fully deployed already. This document is a build spec for the Android wrapper only.
**Companion doc:** `docs/NATIVE_GEOFENCING_SPEC.md` — read that one first if you haven't; the token-handoff pattern (§3 below) is identical and only needs to be built once and shared by both features.

---

## 1. Why Web Push wasn't enough

The web app already has Web Push (VAPID) wired up for browser tabs and installed PWAs (`utils/pwa.js`, `sw.js`, `/api/push/*`). That keeps working unchanged. But a plain Android WebView wrapper does not get its own independent, OS-integrated push registration the way a real installed PWA or a native app does — notifications don't reliably wake a closed WebView, don't get proper Android notification channels, can't show custom icons/colors per category, and don't behave like "real" app notifications. FCM is the only mechanism that actually delivers native tray notifications on Android with the app fully closed.

**Both systems now run side by side.** Every place in the backend that already sends a push (leave/gate-pass/reimbursement approvals routed to a manager, kudos, pulse surveys, etc.) calls one function — `sendPushToUser(userId, payload)` in `backend/utils/push.js` — and that function now fans out to **both** Web Push subscriptions and FCM device tokens for that user automatically. No other backend code needed to change, and none will need to change for future notification types either.

---

## 2. Backend API contract (already live)

Two new function cases, called the same way as everything else in this app:

```
POST /api/functions/<name>
Authorization: Bearer <JWT>
Content-Type: application/json
```

### 2.1 `registerDeviceToken` — call after every FCM token issue/refresh

```json
{ "token": "<FCM registration token>", "platform": "fcm_android" }
```
```json
{ "success": true }
```

Upserts the token against the signed-in user (from the JWT). Safe to call repeatedly — it's an upsert keyed on the token itself.

### 2.2 `unregisterDeviceToken` — call on logout

```json
{ "token": "<FCM registration token>" }
```
```json
{ "success": true }
```

Deletes the token so a logged-out device stops receiving another user's notifications. **Call this before clearing the local session on logout.**

### 2.3 What a push message looks like

The backend sends via `firebase-admin`'s `messaging(app).send()` with this shape (you don't need to build this — just know what arrives):

```json
{
  "notification": { "title": "Leave Request Approved", "body": "Your leave for 10-12 Jul has been approved." },
  "data": { "link": "/Approvals", "type": "success" },
  "android": {
    "priority": "normal",
    "notification": { "channelId": "updates", "icon": "ic_notification", "color": "#F97316", "tag": "success" }
  }
}
```

- **`data.link`** — an in-app route (e.g. `/Approvals`, `/Recognition`, `/PulseSurveys`, `/`) to open on tap. These are the exact same paths the web app's own router uses.
- **`data.type`** — one of `info` | `success` | `warning` | `error`. Maps to the channel (see §4).
- **`android.notification.channelId`** — always one of the three channels you'll create in §4. Sent from the backend, but **Android requires the channel to already exist on-device** before the notification arrives, or it silently falls back to default/no sound.
- **`android.notification.tag`** — same value as `type`. Passing this as the Android notification `tag` means a second `success`-type notification **replaces** the first instead of stacking, which is intentional (matches how many apps collapse same-category alerts) — see §6 if you want per-thread grouping instead.

---

## 3. Getting a Firebase project + `google-services.json`

1. Create (or reuse) a Firebase project at the Firebase Console, add an Android app with package name `com.maxvolt.hr`.
2. Download `google-services.json`, place it in `app/`.
3. In the Firebase Console → Project Settings → Service Accounts, generate a new private key (JSON). This is a **secret** — do not commit it anywhere.
4. Give that JSON file's *contents* to whoever manages Railway, to be set as the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable on the backend service (the whole JSON, as a single-line string value). Until that env var is set, `sendPushToUser` silently skips FCM and only sends Web Push — nothing breaks, native push just stays off.

Gradle (`app/build.gradle`):
```gradle
plugins {
    id 'com.google.gms.google-services'
}
dependencies {
    implementation platform('com.google.firebase:firebase-bom:33.5.1')
    implementation 'com.google.firebase:firebase-messaging'
}
```
Project-level `build.gradle`:
```gradle
plugins {
    id 'com.google.gms.google-services' version '4.4.2' apply false
}
```

---

## 4. Notification channels (create these on app startup, before any message can arrive)

Android requires channels to exist before a notification posts through them, or the OS uses noisy/default behavior. Create all three every app launch (idempotent — `createNotificationChannel` is a no-op if the channel already exists and unchanged):

```kotlin
object NotificationChannels {
    const val ALERTS  = "alerts"   // type: error, warning — approvals needing urgent attention, system issues
    const val UPDATES = "updates"  // type: success — approved/completed actions, kudos received
    const val GENERAL = "general"  // type: info — everything else (surveys, announcements, general FYI)

    fun createAll(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(
            ALERTS, "Alerts & Approvals", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Time-sensitive items needing your attention"
            enableVibration(true)
            enableLights(true)
        })
        nm.createNotificationChannel(NotificationChannel(
            UPDATES, "Updates", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "Approvals, recognition, and status changes" })
        nm.createNotificationChannel(NotificationChannel(
            GENERAL, "General", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "Surveys, announcements, and general updates" })
    }
}
```

Call `NotificationChannels.createAll(context)` once in your `Application.onCreate()`.

This 3-channel taxonomy is deliberately simple and maps 1:1 onto the `type` field the backend already emits everywhere (`info`/`success`/`warning`/`error`) — no backend changes are ever needed to add a new notification type; it always lands in one of these three.

---

## 5. Token registration flow (reuses the same pattern as geofencing)

Exactly the same token handoff described in `NATIVE_GEOFENCING_SPEC.md` §3 — read the JWT from the WebView's `localStorage['base44_access_token']` after `onPageFinished`. Use it here too:

```kotlin
class MyFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        registerTokenWithBackend(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Only fires here when the app is in the FOREGROUND — background/killed
        // notifications are built and shown automatically by the OS from the
        // "notification" + "android.notification" payload the backend sends,
        // using the channel we created in §4. When foregrounded, build it
        // ourselves so it's still visible (otherwise foreground apps see nothing).
        val title = message.notification?.title ?: message.data["title"] ?: "Maxvolt HR"
        val body  = message.notification?.body  ?: message.data["body"]  ?: ""
        val link  = message.data["link"] ?: "/"
        val type  = message.data["type"] ?: "info"
        val channelId = when (type) {
            "error", "warning" -> NotificationChannels.ALERTS
            "success" -> NotificationChannels.UPDATES
            else -> NotificationChannels.GENERAL
        }
        showNotification(applicationContext, title, body, link, channelId, type)
    }
}

fun registerTokenWithBackend(context: Context, token: String) {
    val jwt = TokenStore.get(context) ?: return  // not logged in yet; onNewToken will fire again after login-triggered token refresh, or call this again from the WebView token watcher in MainActivity
    CoroutineScope(Dispatchers.IO).launch {
        try {
            postJson(
                url = "$BASE_URL/api/functions/registerDeviceToken",
                bearer = jwt,
                body = mapOf("token" to token, "platform" to "fcm_android")
            )
        } catch (_: Exception) { /* retry on next app open / next token refresh */ }
    }
}
```

**Important ordering issue:** `onNewToken` can fire before the user has logged in (e.g. first app install, before any JWT exists in the WebView). Handle this the same way the geofencing spec's token watcher does: in `MainActivity`'s `onPageFinished` WebView callback, **also** re-attempt `registerTokenWithBackend` using `FirebaseMessaging.getInstance().token` (an async `Task<String>`) once you detect a token appeared in `localStorage`. That guarantees the token gets registered promptly after login even if `onNewToken` fired earlier with no session to attach it to.

```kotlin
// In the same onPageFinished handler that captures the JWT for geofencing:
if (token != null && token != TokenStore.get(context)) {
    TokenStore.save(context, token)
    GeofenceManager.refresh(context)
    FirebaseMessaging.getInstance().token.addOnSuccessListener { fcmToken ->
        registerTokenWithBackend(context, fcmToken)
    }
}
```

On logout (token becomes `null`): call `unregisterDeviceToken` with the current FCM token **before** clearing `TokenStore`, so a shared/handed-down device doesn't keep receiving the previous user's notifications.

---

## 6. Showing the notification (foreground path) + tap → deep link

```kotlin
fun showNotification(context: Context, title: String, body: String, link: String, channelId: String, type: String) {
    val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra("deep_link", link)   // MainActivity reads this and navigates the WebView
    }
    val pendingIntent = PendingIntent.getActivity(
        context, link.hashCode(), intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val notification = NotificationCompat.Builder(context, channelId)
        .setSmallIcon(R.drawable.ic_notification)
        .setColor(ContextCompat.getColor(context, R.color.brand_orange))
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setContentIntent(pendingIntent)
        .setPriority(if (type == "error" || type == "warning") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        .build()

    NotificationManagerCompat.from(context).notify(type.hashCode(), notification)
    // ^ Using type.hashCode() as the notification ID means same-type notifications
    //   replace each other (collapse), matching the "tag" behavior the backend
    //   payload already signals. If you'd rather stack every notification
    //   individually (never collapse), use a random/incrementing ID instead —
    //   see the grouping note below for the WhatsApp-style middle ground.
}
```

**In `MainActivity`**, handle the deep link both on cold start (`getIntent()`) and on an already-running activity receiving a new intent (`onNewIntent`):

```kotlin
override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    intent.getStringExtra("deep_link")?.let { navigateWebViewTo(it) }
}

private fun navigateWebViewTo(path: String) {
    // The WebView is already authenticated (session cookie/localStorage persists across
    // loads in the same WebView instance) — just load the path against your base origin.
    webView.loadUrl("$BASE_URL$path")
}
```

Handle `getIntent()` similarly in `onCreate()` for the cold-start case (app was fully closed, user tapped the notification, `MainActivity` launches fresh).

---

## 7. Grouping (optional, for a closer WhatsApp match)

The simple "collapse by type" behavior in §6 is a reasonable default (three loose buckets). If you want proper **per-conversation-style grouping** (e.g. all pending approvals stack as a group with a summary line, like WhatsApp groups messages per chat), use `setGroup()`:

```kotlin
.setGroup("maxvolt_$channelId")
```
...and post a **summary notification** per group (`setGroupSummary(true)`) that Android auto-updates to show "3 new alerts" etc. This is a nice-to-have — ship without it first, add it once the basic flow is confirmed working end-to-end.

---

## 8. Badges

Android's launcher badge (the little red dot/count on the app icon) is derived automatically from **active, un-dismissed notifications** on API 26+ (Oreo+) for channels with `setShowBadge(true)` (the default). No extra code needed beyond the channels in §4 — as notifications accumulate, the badge appears; it clears as the user dismisses/opens them. Some OEM launchers (Samsung, Xiaomi) implement their own badge count logic on top of this and generally respect it without extra work.

---

## 9. Phase 2 (not required for launch): inline quick actions

WhatsApp-style "reply from the notification" is possible here too — e.g. an "Approve" / "Reject" button directly on a leave-request notification, no need to open the app. This is a larger change than the rest of this spec because it means calling an authenticated approval endpoint **from a `BroadcastReceiver` triggered by a notification action button**, with no UI, and handling the same workflow-chain logic (`ApprovalWorkflow`) the web app already applies. Suggested design if/when you want this:

1. Backend already has the approval logic (e.g. leave/comp-off/expense decisions) behind existing function cases. Reuse them — do **not** build parallel "quick action" endpoints; call the same cases (`decideCompOff`, the Leave approval update, etc.) with the same JWT.
2. Add `NotificationCompat.Action` buttons whose `PendingIntent` targets a small `BroadcastReceiver` (not an Activity — so no UI opens), which reads the entity id + action from the intent extras and posts to the relevant function case using the stored JWT, then updates the notification to show "Approved ✓" via `NotificationManagerCompat.notify()` on the same ID.
3. Only show quick actions on notifications where the signed-in device's role can actually decide (the backend already return 403 for the wrong approver — treat that as "show a toast/notification saying open the app," not a silent failure).

Ship without this first — it adds meaningful complexity (permission edge cases, workflow-chain level matching) for a smaller slice of notifications (approvals only), while §1–§8 already deliver the core "real native push, just like WhatsApp" experience for every notification type in the app.

---

## 10. Test plan

1. **Foreground**: app open, trigger a notification server-side (e.g. approve a leave request from another account) → `onMessageReceived` fires → notification shows via `showNotification()`.
2. **Background**: app minimized (not killed) → OS auto-displays the notification from the FCM payload using the correct channel/icon/color, no app code runs until tapped.
3. **Killed**: force-stop the app from Android settings → trigger a notification → confirm it still arrives (may take longer on some OEMs; see the battery-killer note in the geofencing spec, §7 — the same OEM aggressive-battery-manager caveat applies here).
4. **Tap → deep link**: from each of the three states above, tap the notification and confirm the WebView navigates to the right in-app path.
5. **Channel behavior**: confirm `alerts` (error/warning) is heads-up + sound, `updates`/`general` are quieter, matching what's set in Android system settings for those channels.
6. **Logout**: log out, confirm `unregisterDeviceToken` fires, then confirm a notification sent to the same user afterward does **not** appear on this device.
7. **Multi-device**: log the same user in on two devices, confirm both receive the notification (device_tokens is one row per token, not per user).
8. **Token refresh**: Firebase can rotate the token at any time; confirm `onNewToken` re-registers automatically without user action.

---

## 11. Rollout

1. Set `FIREBASE_SERVICE_ACCOUNT_JSON` in Railway (backend env var) — until this is set, the backend silently only sends Web Push; nothing breaks by shipping the Android code first.
2. Ship the wrapper update with FCM wired per this spec.
3. Verify with the test plan above using a couple of real accounts before wide rollout.
4. Existing Web Push (browser tab / installed PWA users) is completely unaffected — this is additive.
