# Beginner's Guide: Building the Android AAB and iOS IPA

This guide assumes **zero prior experience** with Android Studio, Xcode, or app store tooling. Follow it top to bottom, in order, the first time. After the first successful build, you'll only need the "Rebuilding after this" mini-sections.

It covers two completely separate machines/toolchains:
- **Part 1 — Android (AAB)**: can be done on Windows (your current machine) or Mac.
- **Part 2 — iOS (IPA)**: **must** be done on your MacBook. Apple does not allow iOS builds on Windows/Linux — this is an Apple restriction, not a limitation of this project.

Read [MOBILE_BUILD.md](MOBILE_BUILD.md) afterward for the quick-reference version once you're comfortable — this document is the "explain every click" version.

---

## Before you start: what you're actually building

This app (Maxvolt HR) is a **Capacitor hybrid app**. That means:
- There's a real native Android project (`maxvolt-hr/android/`) and a real native iOS project (`maxvolt-hr/ios/`).
- Those native projects load your live website (`https://hr.maxvolt-one.co.in`) inside a native WebView, PLUS they include real native code for camera, GPS, and push notifications.
- **Any change to normal screens/pages** (dashboard, leave requests, attendance, etc.) ships the moment you deploy the website — employees see it next time they open the app, no rebuild needed.
- **You only need to rebuild the AAB/IPA when you change**: app icon, splash screen, app name, permissions (camera/location/notifications), native plugins, or the version number for a store release.

Keep that in mind — you are not rebuilding "the app" every time you fix a bug in a screen. You're rebuilding the **native shell** around it.

---

# PART 1 — Android: Building a Signed AAB

An AAB (Android App Bundle, `.aab` file) is what Google Play requires for store uploads. A plain `.apk` is what you'd use to manually install on a test phone. This guide builds the AAB (the guide also tells you how to get a test APK along the way).

## 1.1 Install Android Studio

1. Go to `https://developer.android.com/studio` in your browser.
2. Click the big **Download Android Studio** button. Accept the terms checkbox, then download.
3. Run the downloaded installer.
   - **Windows**: run the `.exe`, click Next through the setup wizard (default options are fine: Android Studio + Android Virtual Device), choose an install location (default is fine), click Install, then Finish.
   - **Mac**: open the `.dmg`, drag the Android Studio icon into the Applications folder, then open Android Studio from Applications (first time, macOS will ask "Are you sure you want to open this app downloaded from the internet?" — click Open).
4. On first launch, you'll see a **"Import Studio Settings"** dialog — choose "Do not import settings" and click OK.
5. The **Android Studio Setup Wizard** appears. Click Next, choose **Standard** installation type, click Next, pick your UI theme, click Next, review the list of components it will download (SDK, SDK Platform-Tools, Android Emulator etc.), click Next, then Finish. This downloads several GB — it can take 10-20 minutes depending on your internet.
6. Once it finishes, you'll land on the **Welcome to Android Studio** screen. Leave it open — you'll use it in a moment.

### Rebuilding after this: skip 1.1, Android Studio only needs installing once.

## 1.2 Confirm Java (JDK) is present

Android Studio bundles its own JDK, so you normally don't need to install Java separately. To confirm:

1. Open a terminal (Windows: search "PowerShell" in the Start menu; Mac: open Terminal from Applications → Utilities).
2. Type `java -version` and press Enter.
3. If you see a version number (e.g. `openjdk version "17..."`), you're fine. If you see "command not found" / "not recognized", that's OK too — Android Studio's Gradle build uses its own bundled JDK internally regardless of your system PATH, so this step is just a sanity check, not a blocker.

## 1.3 Open the project in Android Studio

1. Launch Android Studio.
2. On the Welcome screen, click **Open**.
3. Navigate to `D:\Maxvolt-Jai\Development\HRMS\maxvolt-hr\android` and select that `android` folder (not the parent `maxvolt-hr` folder — specifically the `android` subfolder). Click OK.
4. Android Studio will show "Gradle sync" in progress at the bottom of the window (a progress bar with spinning icon). **Wait for this to finish** — first time can take 5-15 minutes as it downloads Gradle dependencies. Do not close the window during this.
5. If a yellow banner appears saying "Gradle plugin update available" or similar, click **Dismiss** / the X — you don't need to update anything to build.
6. Once the bottom status bar shows nothing spinning and the project file tree appears on the left (folders like `app`, `Gradle Scripts`), sync is complete.

## 1.4 Create your signing keystore (ONE-TIME — do this once, ever, and back the file up forever)

A keystore is a file containing a cryptographic key that proves "this app update really comes from you." **If you lose this file, you can never update your app on the Play Store again under the same listing** — you'd have to publish as a brand-new app. Treat it like a password: back it up in at least two places (e.g., a password manager's file storage + a private cloud drive folder), and never commit it to git.

1. In Android Studio's top menu, click **Build → Generate Signed Bundle / APK...**
2. A dialog appears with two options: "Android App Bundle" and "APK". Select **Android App Bundle**, click Next.
3. Under "Key store path", click **Create new...** (since you don't have one yet).
4. A "New Key Store" dialog opens. Fill in:
   - **Key store path**: click the folder icon, choose a safe location OUTSIDE the project folder (e.g. `D:\Maxvolt-Jai\keystores\`), and type a filename like `maxvolt-hr-release.jks`, click OK.
   - **Password**: create a strong password, type it in both "Password" and "Confirm" boxes. Write this down somewhere safe (e.g. your password manager).
   - **Alias**: type something memorable like `maxvolthr`.
   - **Alias Password**: can be the same as the keystore password — type it in both boxes.
   - **Validity (years)**: leave default (25) or increase to be safe — this determines how long the key itself is valid, should comfortably outlast the app's lifetime.
   - **Certificate** section: fill in at minimum "First and Last Name" (e.g. your name or "Maxvolt Energy"), "Organization" (Maxvolt Energy), "City", "State", "Country Code" (e.g. IN). These don't need to be perfectly accurate — they're just embedded in the certificate metadata, not verified by anyone.
5. Click **OK**. You're back on the previous dialog, now with the keystore path and alias auto-filled, and the passwords remembered for this session.
6. Click **Next**.

**Save these 4 pieces of information somewhere permanent and secure** (e.g. a password manager entry named "Maxvolt HR Android Keystore"):
- Keystore file location (and a backup copy of the actual `.jks` file itself)
- Keystore password
- Key alias
- Key alias password

## 1.5 Build the signed AAB

1. You should now be on a screen titled "Generate Signed Bundle" with **Destination Folder**, **Build Variants**, and **Signature Versions** checkboxes.
2. Destination folder: leave default (it'll be something like `android/app/release`).
3. Build Variants: check **release** (uncheck debug if it's checked).
4. Signature Versions: leave both **V1** and **V2** checked (defaults).
5. Click **Finish**.
6. Android Studio will build in the background — watch the bottom status bar ("Gradle Build Running..."). This can take 2-5 minutes.
7. When done, a small notification popup appears bottom-right: **"Generate Signed Bundle: APK(s) generated successfully"** with a **locate** link. Click **locate** to open the folder in File Explorer/Finder — you'll find `app-release.aab` inside `android/app/release/`.

**This `.aab` file is what you upload to Google Play Console.** It cannot be installed directly on a phone (Play Store converts it into device-specific APKs at download time).

### Getting a test APK to install directly on your phone (not for the Play Store, just for testing)

1. In Android Studio, top menu: **Build → Generate Signed Bundle / APK...**
2. This time choose **APK** instead of Android App Bundle, click Next.
3. Your keystore path/alias/passwords should already be remembered — if not, click **Choose existing...** and select the `.jks` file you created in 1.4, enter the passwords.
4. Click Next, select **release** build variant, check **V1** and **V2** signature versions, click **Finish**.
5. Locate the generated `app-release.apk` (via the "locate" popup link) inside `android/app/release/`.
6. Transfer this file to your Android phone (email it to yourself, use a USB cable, or upload to Google Drive and download on the phone).
7. On the phone, tap the downloaded `.apk` file. Android will likely warn "For your security, your phone is not allowed to install unknown apps from this source" — tap **Settings**, enable **Allow from this source**, go back, and tap Install.
8. The app installs and you can open it directly, fully signed exactly as a store release would be.

### Rebuilding after this (future releases)

1. Bump `versionCode` (must increase every time, e.g. 1 → 2) and `versionName` (e.g. "1.0" → "1.1") in [android/app/build.gradle](android/app/build.gradle) lines 10-11.
2. Run `npx cap sync` from the `maxvolt-hr` folder in a terminal (copies the latest web build + config into the native project).
3. Repeat only step 1.5 above (Build → Generate Signed Bundle / APK...) — this time when it asks for the keystore, click **Choose existing...** and pick your already-created `.jks` file, enter your saved passwords. You never create a new keystore again.

---

# PART 2 — iOS: Building a Signed IPA (on your MacBook)

## 2.1 Enroll in the Apple Developer Program (one-time, $99/year)

You cannot install a real, signed app on an iPhone or submit to the App Store without this. Skip this section if you're already enrolled.

1. On your MacBook, open Safari and go to `https://developer.apple.com/programs/enroll/`.
2. Sign in with your Apple ID (or create one if you don't have one — click "Create yours now" on the Apple ID sign-in page).
3. Click **Start Your Enrollment**.
4. Choose whether you're enrolling as an **Individual** or as an **Organization** (Maxvolt Energy). Organization enrollment requires a D-U-N-S number and takes longer to verify (can be days) but lets the app be published under the company name. Individual is instant-ish (usually approved within 24-48 hours) but the app is published under your personal name as the seller. Pick based on how you want the app to appear in the App Store — if unsure, Individual is the faster path to get started, and you can always create an Organization account later.
5. Follow the prompts, pay the $99 annual fee with a card.
6. Wait for the confirmation email ("Welcome to the Apple Developer Program") before continuing — this can take anywhere from a few minutes to 48 hours.

## 2.2 Install Xcode

1. Open the **App Store** app on your MacBook (it's in the Dock or Applications folder).
2. Search for **Xcode** in the search bar.
3. Click **Get** (or the cloud-download icon), then **Install**. This is a large download (10+ GB) — it can take 30-60+ minutes depending on your internet speed. Let it run in the background.
4. Once installed, open Xcode from Applications. The first launch shows a dialog asking to install **additional required components** — click **Install** and enter your Mac password when prompted. Wait for this to finish (a few minutes).
5. Xcode → top menu → **Xcode → Settings...** (or Preferences on older versions) → **Accounts** tab → click the **+** button bottom-left → **Apple ID** → sign in with the same Apple ID you used for the Developer Program enrollment. This links your Mac to your developer account so Xcode can manage signing certificates automatically.

### Rebuilding after this: skip 2.1 and 2.2, both are one-time setup.

## 2.3 Install Node.js and project dependencies on the Mac

You need the project code on your Mac to build it there (Xcode reads the `ios/` folder generated by Capacitor).

1. Get the project onto your Mac. The cleanest way: open Terminal (Applications → Utilities → Terminal) and clone the repository:
   ```
   git clone https://github.com/MX-Developer-JPT/mxoneHRMS.git
   cd mxoneHRMS/maxvolt-hr
   ```
   (If you don't have git installed, Terminal will prompt you to install the "Command Line Developer Tools" — click Install when the popup appears, wait a few minutes, then re-run the clone command.)
2. Install Node.js: go to `https://nodejs.org` in Safari, download the **LTS** version's macOS installer (`.pkg` file), open it, click Continue/Agree/Install through the wizard (enter your Mac password when asked), Close when done.
3. Back in Terminal, inside the `maxvolt-hr` folder, run:
   ```
   npm install
   ```
   This downloads all the project's JavaScript dependencies — takes a few minutes.
4. Install CocoaPods (manages the iOS native dependencies, like npm but for iOS libraries):
   ```
   sudo gem install cocoapods
   ```
   Enter your Mac password when prompted (it won't show characters as you type — that's normal, just type and press Enter).
5. Build the web app and sync it into the native iOS project:
   ```
   npx vite build
   npx cap sync ios
   ```
6. Install the iOS native pods:
   ```
   cd ios/App
   pod install
   cd ../..
   ```

### Rebuilding after this (future updates): repeat only steps 5 and 6 above (`npx vite build`, `npx cap sync ios`, `pod install`) — no need to reinstall Node/CocoaPods again. If you only changed web/JS code (not native config), you technically don't need to rebuild the IPA at all — the live site updates automatically.

## 2.4 Set up push notifications for iOS (Firebase)

This step is required for push notifications to work on iPhones. Skip only if you've already downloaded and placed `GoogleService-Info.plist` before.

1. Go to `https://console.firebase.google.com` in Safari, open the Maxvolt HR Firebase project (the same one already used for Android push).
2. Click the gear icon (top-left, next to "Project Overview") → **Project settings**.
3. Scroll to the **"Your apps"** section. If there's no iOS app yet, click **Add app** → the iOS icon (Apple logo).
   - **iOS bundle ID**: enter exactly `com.maxvolt.hr`
   - **App nickname**: "Maxvolt HR iOS" (optional, just a label)
   - Click **Register app**.
4. Firebase now shows a **Download GoogleService-Info.plist** button. Click it — this downloads a small file to your Mac's Downloads folder.
5. Open Xcode, open the project: `maxvolt-hr/ios/App/App.xcworkspace` (note: `.xcworkspace`, NOT `.xcodeproj` — CocoaPods requires opening the workspace file, opening the wrong one will cause build errors about missing Pods).
6. In Xcode's left sidebar (Project Navigator), find the **App** folder (blue folder icon, inside the top-level **App** project).
7. Drag the downloaded `GoogleService-Info.plist` from Finder's Downloads folder directly into that **App** folder in Xcode's sidebar.
8. A dialog appears — check **"Copy items if needed"**, ensure **"App"** target is checked under "Add to targets", click **Finish**.
9. Confirm it worked: click on `GoogleService-Info.plist` in the sidebar, it should show readable key-value content (not gibberish) in the editor.

### Enable the Push Notifications capability

1. In Xcode's left sidebar, click the top-level blue **App** project icon.
2. In the main editor area, under **TARGETS**, select **App**.
3. Click the **Signing & Capabilities** tab (top of the editor area).
4. Click **+ Capability** (top-left of that tab).
5. Search for "Push Notifications", double-click it to add.
6. Click **+ Capability** again, search for "Background Modes", double-click it to add.
7. Under the new "Background Modes" section that appears, check: **Location updates**, **Background fetch**, **Remote notifications**.

## 2.5 Configure automatic signing

1. Still in **Signing & Capabilities** tab, under the **Signing** section:
2. Check **"Automatically manage signing"**.
3. **Team**: click the dropdown, select your name / Maxvolt Energy (the team associated with your Apple Developer account from step 2.1/2.2).
4. Xcode will show "Signing Certificate: ..." updating automatically, and may briefly show a red error before resolving — wait a few seconds. If it shows a persistent red error like "Failed to register bundle identifier", it usually means another Apple Developer account already registered `com.maxvolt.hr` — in that case let me know and we'll pick a different bundle ID.

## 2.6 Test on your own iPhone first (do this before any store build)

1. Connect your iPhone to the Mac with a USB/USB-C cable.
2. On the iPhone, if prompted "Trust This Computer?", tap **Trust** and enter your iPhone passcode.
3. In Xcode, top toolbar, there's a device dropdown (next to the Run/Stop buttons) — click it and select your connected iPhone from the list (not a Simulator).
4. Click the **▶ Run** button (top-left, looks like a play triangle).
5. Xcode builds and installs the app directly onto your iPhone. First time, it may show "Could not launch App" with a message about needing to trust the developer — on the iPhone, go to **Settings → General → VPN & Device Management**, tap your developer profile, tap **Trust**.
6. Run it again from Xcode (▶) — it should now launch on your phone.
7. **This is the real device test the background geofencing feature needs** — open the app, log in, go to Mark Attendance, and toggle on **Background Geofence**. Walk in and out of your office's geofenced radius with the app closed/backgrounded, and confirm attendance check-in/check-out still fires (check the Attendance history afterward). This plugin (`@capacitor-community/background-geolocation`) shows a compatibility warning against this project's Capacitor version during sync, so this real-device verification is important to do before rolling it out to employees.

## 2.7 Archive and export the IPA

Once you've confirmed it runs correctly on your own phone:

1. In Xcode's top toolbar, change the device dropdown from your iPhone to **"Any iOS Device (arm64)"**.
2. Top menu: **Product → Archive**. This takes a few minutes — Xcode is compiling a release build.
3. When done, the **Organizer** window opens automatically, showing your new archive listed under "Archives" (dated today, "Maxvolt HR").
4. With that archive selected, click **Distribute App** (right side).
5. A dialog asks for distribution method:
   - **App Store Connect** — choose this if you're publishing to the App Store or using TestFlight (recommended path for rolling out to employees in a controlled way — more on this below).
   - **Ad Hoc** — choose this to generate an installable `.ipa` for specific registered test devices only (max 100 devices per year), without going through App Store review.
   - For your situation (internal company rollout), **App Store Connect → TestFlight** is strongly recommended over Ad Hoc: TestFlight handles installation, updates, and device registration for you, and does not require every employee's device UDID to be manually registered in advance like Ad Hoc does.
6. Click Next, choose default options through the following screens (Xcode manages signing automatically since you set that up in 2.5), click **Upload** (if App Store Connect) or **Export** (if Ad Hoc — this saves an actual `.ipa` file to a folder you choose).
7. If uploading to App Store Connect: wait for the upload to finish (progress bar), then go to `https://appstoreconnect.apple.com` in Safari, sign in, go to **My Apps** (create the app record first if this is the very first upload — see below), and after a short processing wait (10-60 minutes), your build appears under the **TestFlight** tab, ready to invite testers (add employee emails as internal/external testers).

### First-time only: creating the App Store Connect app record

Before your first upload, App Store Connect needs a record to attach the build to:
1. Go to `https://appstoreconnect.apple.com`, sign in, click **My Apps**, click the **+** button, choose **New App**.
2. Platform: **iOS**. Name: "Maxvolt HR". Primary language: English. Bundle ID: select `com.maxvolt.hr` from the dropdown (it appears here because Xcode already registered it in step 2.5). SKU: any unique internal code, e.g. `maxvolthr001`. User Access: Full Access.
3. Click **Create**.

### Rebuilding after this (future releases)

1. Bump the version/build number in Xcode: click the **App** project → **App** target → **General** tab → increase **Version** (e.g. 1.0 → 1.1) and/or **Build** (e.g. 1 → 2).
2. Run `npx vite build && npx cap sync ios` from Terminal in the `maxvolt-hr` folder.
3. Repeat only step 2.7 (Product → Archive → Distribute App). Signing, provisioning, and the app record are already set up — you won't repeat 2.1-2.6 again.

---

## Quick summary table

| | Android | iOS |
|---|---|---|
| Machine needed | Windows or Mac | Mac only |
| One-time setup | Install Android Studio, create keystore | Apple Developer Program ($99/yr), install Xcode, link Apple ID, add GoogleService-Info.plist, enable capabilities |
| Every release | Bump version in `build.gradle`, `npx cap sync`, Build → Generate Signed Bundle | Bump version in Xcode, `npx cap sync ios`, Product → Archive → Distribute |
| Output file | `app-release.aab` (store) / `.apk` (direct install) | Upload via App Store Connect (TestFlight) or exported `.ipa` (Ad Hoc) |
| Rollout to employees | Share `.apk` directly, or Play Store internal testing track | TestFlight (recommended) — invite by email, no manual device registration |

If anything shows a red error you don't recognize at any step, stop and share the exact error text — most of these builds fail for very specific, fixable reasons (a missing file, an unregistered bundle ID, a version number that didn't increase) rather than anything fundamentally wrong with the project.
