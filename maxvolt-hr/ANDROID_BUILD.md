# Building the Maxvolt HR Android App (APK)

The app ships as a native Android wrapper (Capacitor) around the live PWA at
**https://hr.maxvolt-one.co.in**. The APK is a thin native shell, so it always
shows the latest deployed version — you don't need to rebuild the app for every
backend/frontend change, only when you want to change the shell itself (icon,
name, native plugins).

App identity: **Maxvolt HR** · package `com.maxvolt.hr`

---

## Option A — Build locally with Android Studio (full control)

**Prerequisites (one-time):**
1. Install **Android Studio** (bundles the Android SDK): https://developer.android.com/studio
2. Install a **JDK 17** (Android Studio includes one).

**Build the APK:**
```bash
cd maxvolt-hr
npm install
npm run cap:sync          # builds web assets + syncs the android project
npm run android:open      # opens the project in Android Studio
```
In Android Studio:
- **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)** → produces a debug APK.
- Output: `maxvolt-hr/android/app/build/outputs/apk/debug/app-debug.apk`
- Install on a phone: enable "Install unknown apps", copy the APK over, tap it.

**Or build a debug APK from the command line** (after the SDK is installed and
`android/local.properties` points at it — Android Studio creates this automatically):
```bash
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

**For a signed RELEASE APK** (required to distribute / put on Play Store):
- In Android Studio: **Build ▸ Generate Signed Bundle / APK**, create a keystore
  the first time and keep it safe (you need the same keystore for every future
  update).

---

## Option B — No local tooling: PWABuilder (fastest)

Because the app is already an installable PWA, you can generate a signed APK in
the cloud with zero setup:

1. Go to **https://www.pwabuilder.com**
2. Enter `https://hr.maxvolt-one.co.in` and click **Start**.
3. Choose **Android ▸ Generate Package**.
4. Download the `.apk` / `.aab` and the signing key it generates (keep the key).

This produces a Trusted Web Activity (TWA) APK — also a thin wrapper around the
same hosted app.

---

## Branding the app icon (recommended)

The scaffolded project uses the default Capacitor icon. To use the Maxvolt logo:

**Easiest — Android Studio:** right-click `app/res` ▸ **New ▸ Image Asset**,
pick the Maxvolt logo, finish. This generates all the launcher icon densities.

**Or with @capacitor/assets** (needs a 1024×1024 PNG):
```bash
cd maxvolt-hr
npm install -D @capacitor/assets
mkdir assets
# put a 1024x1024 logo at assets/icon.png (and optional assets/splash.png 2732x2732)
npx @capacitor/assets generate --android
npm run cap:sync
```

---

## Notes
- The shell loads the live site, so it requires an internet connection (normal
  for an HRMS). Web push, login, and uploads all work through the hosted app.
- To change the target URL, edit `server.url` in `capacitor.config.json`, then
  run `npm run cap:sync`.
- If you later want a fully offline/bundled build, remove `server.url` from the
  config and change the API base in `src/api/base44Client.js` from `/api` to the
  absolute `https://hr.maxvolt-one.co.in/api`, then `npm run cap:sync`.
