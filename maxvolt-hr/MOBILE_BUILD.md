# Building Maxvolt HR — Android (APK/AAB) and iOS (IPA)

The app ships as a **Capacitor hybrid shell** around the live site at
**https://hr.maxvolt-one.co.in**, plus a small set of real native modules
(push notifications now; geofencing next). This is the "hybrid" model
chosen deliberately over both extremes:

- **not** a plain WebView wrapper — it has real native plugins (push, and
  soon background geofencing) that a bare wrapper can't do
- **not** a full native rewrite — the ~90 HRMS screens are still the one
  web app, so a feature/content change ships by deploying the backend/web
  app as normal; **you only rebuild the APK/IPA when the native shell
  itself changes** (icon, splash screen, a new native plugin, permissions,
  or an OS-forced SDK bump)

App identity: **Maxvolt HR** · package/bundle ID `com.maxvolt.hr`

Both platforms are already scaffolded in this repo: `maxvolt-hr/android/`
and `maxvolt-hr/ios/`. This doc is about building real installable/signed
packages from them.

---

## 0. One-time setup after pulling this repo

```bash
cd maxvolt-hr
npm install
npm run cap:sync     # builds the web app + copies it into both android/ and ios/
```

Run `npm run cap:sync` again any time you change native config (icons,
`capacitor.config.json`, add a plugin) — it is **not** needed for normal
backend/web deploys, since the shell loads the live site over the network.

---

## 1. Android — APK/AAB

### Prerequisites (one-time)
1. **Android Studio** (bundles the SDK): https://developer.android.com/studio
2. A **JDK 17** (Android Studio installs one for you).

### Debug build (quick test on your own phone)
```bash
npm run android:open      # opens android/ in Android Studio
```
In Android Studio: **Build ▸ Build Bundle(s)/APK(s) ▸ Build APK(s)**.
Output: `android/app/build/outputs/apk/debug/app-debug.apk`
Copy it to a phone (enable "Install unknown apps" first) and tap to install.

Or from the command line once the SDK is installed and
`android/local.properties` points at it (Android Studio creates this file
automatically on first open):
```bash
npm run android:apk
```

### Signed release build (required for Play Store, or a "proper" install elsewhere)
In Android Studio: **Build ▸ Generate Signed Bundle / APK**
- First time: create a keystore (`.jks`) and set a strong password.
  **Back this keystore file up somewhere safe outside this repo** — if you
  lose it you cannot publish an update to the same Play Store listing ever
  again, only a brand-new listing.
- Choose **Android App Bundle (.aab)** for Play Store submission (Google
  requires AAB now, not APK), or **APK** if you're distributing directly
  (e.g. via MDM, a company download page, or sideloading).
- Output: `android/app/release/app-release.aab` (or `.apk`).

### Push notifications on Android (real native FCM)
The Gradle project is already wired to apply Google's plugin *if* a config
file is present (`android/app/build.gradle` checks for it and applies
`com.google.gms.google-services` automatically — nothing to edit there):

1. In the [Firebase Console](https://console.firebase.google.com), create/open
   a project, add an Android app with package name `com.maxvolt.hr`.
2. Download `google-services.json`, place it at `android/app/google-services.json`.
   (This file is not secret in the sense of API keys — Google's Android config
   files are safe to have in a private repo, but keep the repo private since
   it does identify your Firebase project.)
3. In Firebase Console ▸ Project Settings ▸ Service Accounts, generate a new
   private key (JSON). This one **is** a secret — give its contents to
   whoever manages Railway to set as the `FIREBASE_SERVICE_ACCOUNT_JSON`
   backend env var. Until that's set, the backend silently skips FCM and
   only Web Push fires — nothing breaks either way.
4. `npm run cap:sync`, then rebuild. New installs (or an app restart) will
   register for push automatically (see `src/lib/nativePush.js`) and you'll
   get real system-tray notifications, same as any native app.

Full behavior/design reference: `docs/NATIVE_PUSH_SPEC.md`.

---

## 2. iOS — IPA

### The one hard requirement: you need a Mac

There is no way around this — Apple only allows building/signing iOS apps
with Xcode, which only runs on macOS, and this is enforced by Apple's
tooling and licensing, not something any cross-platform trick avoids. Pick
one:

| Option | Notes |
|---|---|
| **Your own Mac** | Cheapest if you have one. Install Xcode from the Mac App Store (free), then follow §2.2 below. |
| **Borrow/rent a Mac** | A colleague's Mac, or a cloud rental like **MacinCloud** or **MacStadium**, billed hourly/monthly. |
| **Cloud CI build (no Mac needed)** | Services like **Codemagic**, **Ionic Appflow**, or a **GitHub Actions macOS runner** build the IPA in the cloud from this repo — you never touch Xcode directly, just configure signing certs through their UI. Good option if nobody on the team owns a Mac. |

You also need an **Apple Developer Program** account — **$99/year**,
required for both TestFlight and App Store distribution, and for installing
on a physical device beyond a 7-day free-provisioning test build.

### 2.1 What's already done
`ios/` is already scaffolded and synced in this repo (`ios/App/App.xcodeproj`,
Capacitor + push-notifications wired via Swift Package Manager). Whoever has
Mac access just needs to open it and configure signing — no project setup
from scratch.

### 2.2 Building on a Mac
```bash
cd maxvolt-hr
npm install
npm run cap:sync
npm run ios:open        # opens ios/App/App.xcworkspace in Xcode
```
In Xcode:
1. Select the **App** target ▸ **Signing & Capabilities**.
2. Sign in with your Apple ID (Xcode ▸ Settings ▸ Accounts), pick your team.
3. Enable **Automatically manage signing** — Xcode provisions a
   development certificate for you.
4. Plug in an iPhone (or pick a Simulator) ▸ press **Run** to test.
5. For a real distributable build: **Product ▸ Archive**, then
   **Distribute App** ▸ choose **App Store Connect** (for TestFlight/App
   Store) or **Ad Hoc**/**Enterprise** (for direct install on registered
   devices only — Ad Hoc is limited to 100 device UDIDs per year).

### 2.3 Push notifications on iOS — one step short

Capacitor's push-notifications plugin is already installed and will
register the device with **Apple's APNs** directly and hand back a token —
that part works out of the box once you enable the **Push Notifications**
capability in Xcode (Signing & Capabilities ▸ **+ Capability** ▸ *Push
Notifications*, plus **Background Modes ▸ Remote notifications** so it can
receive pushes while backgrounded).

The gap: the backend currently sends push through **Firebase** (Admin SDK),
and a raw APNs token isn't directly usable by Firebase's send API as-is.
The token *is* already being registered against your account (tagged
`apns_ios` in `device_tokens`) so nothing else needs to change later —
pick one of these when you're ready to finish iOS delivery:

- **Option A — add Firebase to iOS too (recommended, reuses 100% of the
  existing backend code).** Add the iOS app to the same Firebase project
  (§1, step 1), download `GoogleService-Info.plist`, add it to the Xcode
  project, add the `FirebaseMessaging` Swift package, and a few lines in
  `AppDelegate.swift` so Firebase exchanges the APNs token for an FCM
  token automatically. Once that FCM token is what gets sent to
  `registerDeviceToken` instead of the raw APNs token, `utils/push.js`
  delivers to iOS with **zero backend changes** — the same
  `sendPushToUser()` already fans out to whatever's in `device_tokens`.
- **Option B — send directly via Apple's APNs API**, bypassing Firebase
  for iOS. Needs an APNs auth key (`.p8`) from the Apple Developer portal
  and a small addition to `utils/push.js` (e.g. the `apn` npm package) to
  send to `apns_ios`-tagged tokens directly. More backend work, no Firebase
  iOS SDK/native code needed.

Either is a contained, well-defined follow-up — ask when you're ready to
wire it and it'll be built against whichever option you pick.

---

## 3. Branding (icon + splash) — do this for both platforms

**Easiest — from a single 1024×1024 PNG:**
```bash
npm install -D @capacitor/assets
mkdir assets
# put a 1024x1024 logo at assets/icon.png (and optionally a 2732x2732 assets/splash.png)
npx @capacitor/assets generate
npm run cap:sync
```
This generates every density/resolution for **both** `android/` and `ios/`
in one pass.

Or per-platform manually:
- **Android**: Android Studio ▸ right-click `app/res` ▸ **New ▸ Image Asset**.
- **iOS**: Xcode ▸ `Assets.xcassets` ▸ **AppIcon** ▸ drag images into each slot.

---

## 4. Changing the target URL / going fully offline-bundled

Both platforms read `server.url` from `capacitor.config.json` — change it
there and re-run `npm run cap:sync` for both to pick it up.

To ship a fully bundled (no-network-shell, offline-capable) build instead of
loading the hosted site live: remove the `server` block from
`capacitor.config.json`, and change the API base in
`src/api/base44Client.js` from a relative `/api` to the absolute
`https://hr.maxvolt-one.co.in/api`, then `npm run cap:sync`. Not recommended
right now — you'd lose the "ship a feature without an app store release"
benefit that's the whole reason for the hybrid model, and both push and any
future native modules still call the backend over the network regardless.

---

## 5. Quick reference — do I need to rebuild the app?

| Change | Rebuild needed? |
|---|---|
| New/changed page, backend feature, bug fix in the ~90 HRMS screens | **No** — live on next load, same as any website deploy |
| App icon, splash screen, display name | Yes |
| New Capacitor plugin (new native capability) | Yes |
| Push notification channel/behavior tweak on native side | Yes |
| Android target/compile SDK bump (Google/Play Store policy forces this ~yearly) | Yes |
| iOS minimum OS version, new Apple-required capability | Yes |
