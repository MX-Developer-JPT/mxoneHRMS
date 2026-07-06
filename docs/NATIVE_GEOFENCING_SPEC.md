# Native Android Geofencing — Technical Specification

> **⚠️ Superseded.** Written when the mobile app was assumed to be a raw WebView
> wrapper needing hand-written Kotlin `GeofencingClient` code. It's actually a
> **Capacitor** app, and background geofencing is now implemented with
> `@capacitor-community/background-geolocation` (continuous background location
> + a JS-side distance check, rather than OS geofence regions) — see
> **`maxvolt-hr/MOBILE_BUILD.md`** and `maxvolt-hr/src/lib/geofenceBackground.js`
> for what's actually wired. The backend contract described below
> (`getMyGeofence`, `nativeGeofenceEvent`, idempotent enter/exit, mock-location
> rejection, multi-session) is still exactly what's live — only the native
> *trigger* mechanism changed from "OS geofence region" to "background location
> watcher + JS distance check". Kept below for the backend API reference and
> original design reasoning.
**Goal:** Employees are checked in automatically when they physically enter their assigned office zone and checked out when they leave — **with the app closed or in the background**. This complements the in-app (foreground) geofencing already live in the PWA; the native layer exists because browsers cannot geolocate in the background.
**Backend status:** ✅ Both server endpoints described here are already deployed. This document is a build spec for the Android wrapper only — no web or backend changes are required.

---

## 1. Architecture overview

```
┌────────────────────────── Android wrapper app ──────────────────────────┐
│                                                                         │
│  WebView (hr.maxvolt-one.co.in)                                         │
│     │  after page load: read JWT from localStorage                      │
│     ▼                                                                   │
│  TokenStore (EncryptedSharedPreferences)                                │
│     │                                                                   │
│  GeofenceManager ── registers fences with ──► GeofencingClient (OS)     │
│     ▲                                              │                    │
│     │ daily refresh (WorkManager)                  │ ENTER / EXIT       │
│     │                                              ▼                    │
│  POST /api/functions/getMyGeofence        GeofenceBroadcastReceiver     │
│                                                    │                    │
│                                            enqueue OneTimeWorkRequest   │
│                                                    ▼                    │
│                                    EventUploadWorker (retry + backoff)  │
│                                                    │                    │
└────────────────────────────────────────────────────┼────────────────────┘
                                                     ▼
                              POST /api/functions/nativeGeofenceEvent
                              (server creates/updates the Attendance row)
```

Key property: **geofencing is OS-managed and battery-cheap.** The app registers circular regions once; Android wakes the receiver only on boundary transitions. There is no continuous GPS polling.

---

## 2. Backend API contract (already live)

Base URL: the same origin the WebView loads (production: `https://<railway-app-domain>`; the WebView URL's origin — derive it at runtime, do not hardcode).

Both endpoints are standard app functions:

```
POST /api/functions/<name>
Authorization: Bearer <JWT>
Content-Type: application/json
```

The JWT is the same token the web app holds in `localStorage["base44_access_token"]` (30-day expiry, issued at login).

### 2.1 `getMyGeofence` — fetch fence configuration

Request body: `{}`

Response:
```json
{
  "success": true,
  "fence": {                    // the employee's assigned office (null if none configured)
    "id": "…",
    "name": "Ghaziabad HQ",
    "latitude": 28.669155,
    "longitude": 77.453758,
    "radius_m": 200
  },
  "all_fences": [ { …same shape… } ],
  "attendance_today": {
    "checked_in": true,
    "checked_out": false,
    "check_in_time": "2026-07-06T09:12:00.000Z",
    "check_out_time": null
  },
  "server_time": "2026-07-06T04:05:00.000Z"
}
```

Rules:
- Register **`fence`** (the assigned office). If `fence` is `null`, unregister everything and do nothing — HR has not configured a geofence for this employee.
- `attendance_today` lets the app suppress redundant events client-side (e.g. don't bother sending `enter` if already checked in). Server is idempotent anyway.

### 2.2 `nativeGeofenceEvent` — report a transition

Request body:
```json
{
  "event": "enter",                          // "enter" | "exit"
  "latitude": 28.66921,                      // from the triggering location fix
  "longitude": 77.45372,
  "accuracy": 18.5,                          // metres
  "occurred_at": "2026-07-06T03:40:12.000Z", // UTC ISO — when the transition fired
  "location_name": "Ghaziabad HQ",           // fence name you registered
  "is_mock": false,                          // Location.isMock() / isFromMockProvider
  "device_id": "Pixel-7a-8f3c",              // stable per-install id (Settings.Secure.ANDROID_ID ok)
  "source": "native_android"                 // always send this literal value from the wrapper app
}
```

Response (success):
```json
{ "success": true, "action": "checked_in",  "session_number": 1, "is_in_progress": true,  "working_hours": 0,    "location": "Ghaziabad HQ" }
{ "success": true, "action": "checked_out", "session_number": 1, "is_in_progress": false, "working_hours": 4.2,  "location": "Ghaziabad HQ" }
{ "success": true, "action": "none", "reason": "already_checked_in" }   // idempotent no-ops
```

Response (rejected — do NOT retry these):
```json
{ "success": false, "code": "MOCK_LOCATION",  "error": "Mock locations are not accepted" }
{ "success": false, "code": "OUTSIDE_FENCE",  "error": "Reported position is 640m from Ghaziabad HQ (allowed 418m)" }
```

Server-side behaviour (for reference):
- **Multi-session, both directions immediate.** Both `enter` and `exit` are applied to today's Attendance the instant they arrive — there is no server-side delay or confirmation window on either transition. Punches are stored on a shared `raw_punches` timeline (the same mechanism biometric devices already use), so a day naturally has session 1 (arrived, later stepped out), session 2 (stepped back in), session 3, etc. `session_number` in the response tells you which session the event just opened/closed; `is_in_progress` tells you whether a session is currently open.
- **enter** → appends an IN punch and rebuilds the day's sessions. Idempotent: if a session is already open (`is_in_progress` was already true), a second `enter` returns `action:"none", reason:"already_checked_in"` — send `enter` as many times as you like, it's a no-op unless a session actually needs opening.
- **exit** → appends an OUT punch and rebuilds the day's sessions, closing whichever session is currently open. Idempotent the same way (`reason:"already_checked_out"` / `"not_checked_in"` if no session is open).
- `working_hours` in the response is the **cumulative total across all of today's sessions**, not just the one that just closed.
- A pre-existing single check-in/check-out on the day (from a manual/selfie punch, or from before this multi-session behaviour) is automatically treated as session 1 the first time a geofence event arrives — nothing is discarded.
- `occurred_at` is honoured if it is ≤ 12 h in the past (covers Doze-delayed delivery); otherwise server time is used.
- Enter events with coordinates are re-validated server-side against the fence (radius + reported accuracy + 200 m slack).
- Records where the day has been manually regularised by HR (`status:"regularised"`) reject all geofence events with `success:false` — HR's correction is the source of truth for that day.
- HTTP 401 → token expired/invalid: stop sending, clear stored token, re-acquire from the WebView on next app open.

**Native-side debounce is spatial, not time-based.** Since check-in and check-out are both immediate server-side, the only thing standing between "at the boundary" and a flapping enter/exit loop is geofence geometry: keep `setNotificationResponsiveness(60_000)` (§5) so the OS itself doesn't fire faster than once a minute per region, and rely on Android's own hysteresis at the transition boundary. Do not add your own artificial delay before calling this endpoint — the product requirement is that stepping in marks present immediately and stepping out checks out immediately.

Retry policy: retry only on network failure / HTTP 5xx (exponential backoff via WorkManager). Never retry `success:false` responses or 401.

---

## 3. Token handoff (WebView → native)

No web-side changes needed. Extract the JWT from the WebView after each page load:

```kotlin
webView.webViewClient = object : WebViewClient() {
    override fun onPageFinished(view: WebView, url: String) {
        view.evaluateJavascript(
            "localStorage.getItem('base44_access_token')"
        ) { raw ->
            val token = raw?.trim('"')?.takeIf { it.isNotBlank() && it != "null" }
            if (token != null && token != TokenStore.get(context)) {
                TokenStore.save(context, token)          // EncryptedSharedPreferences
                GeofenceManager.refresh(context)          // (re)fetch fences + register
            } else if (token == null) {
                TokenStore.clear(context)                 // user logged out
                GeofenceManager.unregisterAll(context)
            }
        }
    }
}
```

- Store in **EncryptedSharedPreferences** (`androidx.security:security-crypto`).
- The token lives 30 days; the web app refreshes it on login. Polling on every `onPageFinished` keeps native in sync with login/logout with zero web changes.

---

## 4. Permissions & Play Store compliance

### Manifest
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />  <!-- API 33+ confirmations -->
```

### Request flow (Android 11+ forces two steps)
1. In-app explainer screen: *“Maxvolt One can mark your attendance automatically when you arrive at the office. To do this it needs location access set to ‘Allow all the time’. Your location is only used to detect entry/exit at your office zone — it is never tracked continuously.”*
2. Request `ACCESS_FINE_LOCATION` (while-in-use).
3. Then request `ACCESS_BACKGROUND_LOCATION` — Android shows the settings page where the user picks **“Allow all the time.”**
4. If the user declines background access, fall back silently to the existing in-app (foreground) auto-attendance. The feature toggle in the app should show “limited — works while app is open.”

### Play Console requirements (mandatory for background location)
- Complete the **Sensitive-permissions declaration** for background location: purpose = employee attendance at employer-defined workplaces, user-initiated opt-in.
- Provide a short **demo video** showing the explainer → permission flow → auto check-in.
- The privacy policy URL must state background-location use. One paragraph on the existing policy page is sufficient.
- In-app: the feature must be **opt-in** (default OFF), with a visible toggle to turn it off (put it on the app’s native settings sheet; mirror the web toggle’s wording “Auto attendance”).

---

## 5. Geofence registration

```kotlin
object GeofenceManager {
    private const val REQ_ID_PREFIX = "mx_office_"

    fun refresh(context: Context) {
        val token = TokenStore.get(context) ?: return
        // 1. POST /api/functions/getMyGeofence
        // 2. unregister all REQ_ID_PREFIX* fences
        // 3. if fence != null → register it
    }

    fun register(context: Context, f: Fence) {
        val geofence = Geofence.Builder()
            .setRequestId(REQ_ID_PREFIX + f.name)
            .setCircularRegion(f.latitude, f.longitude, f.radiusM.toFloat())
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(
                Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT
            )
            .setNotificationResponsiveness(60_000)   // 1 min — battery-friendly
            .setLoiteringDelay(0)
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)  // fire if already inside
            .addGeofence(geofence)
            .build()

        LocationServices.getGeofencingClient(context)
            .addGeofences(request, pendingIntent(context))
    }

    private fun pendingIntent(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context, 0,
            Intent(context, GeofenceBroadcastReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
}
```

Notes:
- **Radius:** use `radius_m` from the server as-is (HR controls it; recommend ≥ 150 m in HR guidance — Android geofencing is unreliable below ~100 m).
- **`INITIAL_TRIGGER_ENTER`** matters: if the employee enables the feature while already sitting in the office, they get checked in immediately.
- Android caps at 100 fences/app; we register 1. If Maxvolt later wants multi-office roaming (check in at any office), register `all_fences` instead — the server already returns them and accepts any fence’s `location_name`.

### Re-registration triggers (fences are lost on these events)
Register a receiver / worker for each:

| Trigger | Mechanism |
|---|---|
| Device reboot | `BOOT_COMPLETED` receiver → `GeofenceManager.refresh()` |
| App update | `MY_PACKAGE_REPLACED` receiver |
| Location services toggled | `PROVIDERS_CHANGED` (or `LocationManager.MODE_CHANGED_ACTION`) |
| Google Play services update / data clear | covered by daily refresh |
| Fence config changed by HR / employee transferred | **daily `PeriodicWorkRequest`** calling `getMyGeofence` and re-registering |
| Login/logout | token watcher in §3 |

---

## 6. Event handling

```kotlin
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return   // log; daily refresh self-heals

        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_EXIT  -> "exit"
            else -> return
        }
        val loc = event.triggeringLocation
        val fenceName = event.triggeringGeofences?.firstOrNull()
            ?.requestId?.removePrefix("mx_office_") ?: ""

        val work = OneTimeWorkRequestBuilder<EventUploadWorker>()
            .setInputData(workDataOf(
                "event" to transition,
                "lat" to (loc?.latitude ?: 0.0),
                "lng" to (loc?.longitude ?: 0.0),
                "acc" to (loc?.accuracy ?: 0f),
                "occurred_at" to Instant.now().toString(),
                "location_name" to fenceName,
                "is_mock" to (loc?.let {
                    if (Build.VERSION.SDK_INT >= 31) it.isMock else @Suppress("DEPRECATION") it.isFromMockProvider
                } ?: false),
            ))
            .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "geofence_evt_${transition}_${System.currentTimeMillis() / 60000}", // 1-min dedup window
            ExistingWorkPolicy.KEEP, work
        )
    }
}
```

`EventUploadWorker`:
1. Read token from `TokenStore`; if absent → `Result.failure()` (drop).
2. `POST /api/functions/nativeGeofenceEvent` with the payload from §2.2 plus `device_id`.
3. Network error / 5xx → `Result.retry()` (WorkManager backoff; events are timestamped, and the server honours `occurred_at` ≤ 12 h).
4. HTTP 401 → clear token, `Result.failure()`.
5. `success:false` → `Result.failure()` (do not retry — it was rejected on purpose).
6. On `action: "checked_in"` / `"checked_out"` → post a local notification: *“✅ Checked in at Ghaziabad HQ, 9:12 AM”* (channel: “Attendance”, `POST_NOTIFICATIONS` runtime permission on API 33+).

---

## 7. Edge cases & decisions

| Case | Handling |
|---|---|
| Employee already checked in manually / via biometric, then walks in | Server treats the existing punch as session 1 and returns `action:"none", reason:"already_checked_in"` if a session is already open — no duplicate. |
| Employee steps out for lunch, then back in | Exit closes session 1 immediately; the next entry opens session 2 automatically. This is expected, correct behaviour, not an edge case to suppress. |
| Brief GPS wobble right at the fence boundary | Both directions are immediate by design, so the only protection against flapping is geometry: `notificationResponsiveness` 60 s (§5) plus Android's own ENTER/EXIT hysteresis. If real flapping is observed in the pilot, the fix is a **larger radius**, not a client-side delay — do not reintroduce a time debounce, it conflicts with the immediate-checkout requirement. |
| Doze / delayed delivery | Events carry `occurred_at`; server accepts up to 12 h late, so the check-in time stays truthful. |
| Fake GPS apps | `is_mock` rejected client-side data is still sent with the flag; server rejects `MOCK_LOCATION`. Consider Play Integrity API later if abuse is suspected. |
| Employee reassigned to another office | Daily refresh worker picks up the new `work_location` fence within 24 h; opening the app refreshes immediately (§3). |
| Multiple check-ins across midnight | Attendance is keyed by IST date server-side; an `exit` after midnight closes *that IST day’s* record only if it exists. |
| Employee with no geofence configured | `fence: null` → nothing registered; feature silently inactive. |
| Battery | Geofencing uses cell/Wi-Fi positioning most of the time; expected drain ≪ 1%/day. Do **not** add a foreground location service. |
| OEM battery killers (Xiaomi/Oppo/Vivo) | Geofencing survives better than services, but aggressive OEMs may still kill Play Services callbacks. Mitigation: the in-app foreground watcher (already live) acts as the fallback when the user opens the app; optionally deep-link users to autostart settings on affected OEMs. |

---

## 8. Files to add to the wrapper project

```
app/src/main/java/com/maxvolt/hr/geo/
 ├─ TokenStore.kt                  // EncryptedSharedPreferences wrapper
 ├─ GeofenceManager.kt             // fetch config, register/unregister
 ├─ GeofenceBroadcastReceiver.kt
 ├─ EventUploadWorker.kt           // WorkManager upload with retry
 ├─ RefreshWorker.kt               // daily PeriodicWorkRequest
 └─ BootReceiver.kt                // BOOT_COMPLETED + MY_PACKAGE_REPLACED
app/src/main/java/com/maxvolt/hr/ui/
 └─ AutoAttendanceSettingsSheet.kt // opt-in toggle + permission explainer
```

Dependencies:
```gradle
implementation "com.google.android.gms:play-services-location:21.3.0"
implementation "androidx.work:work-runtime-ktx:2.9.1"
implementation "androidx.security:security-crypto:1.1.0-alpha06"
```

---

## 9. Test plan

1. **Unit:** payload building, token extraction parsing, backoff policy.
2. **Emulator:** set GPS via extended controls; verify ENTER fires → `checked_in` response → notification. Repeat ENTER → `action:none`.
3. **Field test (one device, office site):** walk in with app killed → check-in appears in HR “All Attendance” with `Source: Geofence`. Walk out to > radius+100 m → checkout within ~2 min. Verify working hours.
4. **Reboot test:** reboot phone, do not open app, walk in → still checks in.
5. **Mock location test:** enable a fake-GPS app → event rejected, no attendance row.
6. **Token expiry test:** clear web session → native stops posting (401 path) and recovers after next login.
7. **Pilot:** 5–10 employees (mixed OEMs: Samsung + one Xiaomi/Oppo) for one week before company-wide rollout; compare geofence check-ins against biometric punches for the same days.

---

## 10. Rollout

1. Ship wrapper update with the feature **default OFF**.
2. HR verifies office coordinates + radius in Location Master (stand at the office centre, use “Use my current location”, radius ≥ 150 m).
3. Pilot group enables the toggle; week-long comparison vs biometric.
4. Company-wide announcement with the one-tap enable flow.
5. Keep biometric + manual + in-app auto modes running — geofence is an additional source; the attendance record merges them (first check-in of the day wins, server is idempotent).
